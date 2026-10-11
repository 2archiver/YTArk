#!/usr/bin/env python3
"""Publish, resume, repair or verify the YTArk ARMv7 GitHub release.

The public YTArk release is produced from exactly one verified candidate:

    build-apk.yml  ->  trusted ARMv7 build, package checks, Actions artefact
    this helper    ->  release-state decision + publication of those exact bytes

Three entry points are used by the workflows:

    write-manifest   Record the candidate artefact layout (paths + sha256) so the
                     publisher never guesses where the downloaded artefact put
                     its files.
    plan             Read-only release-state classification for the build guard.
                     "Already published" means the required assets *and* the
                     release metadata actually validate; an empty or partial
                     release never suppresses a rebuild/repair.
    publish          Create, resume, repair or verify the release, then promote
                     it to a stable, non-draft, non-prerelease, latest release
                     and verify the public bytes.

Reads and mutations both go through the REST API, keyed by release id, with
explicit status handling: a confirmed 404 means "no such release", while
403/rate-limit/network/malformed responses are hard errors and are never
mistaken for "absent". Asset names are always checked first, so no upload ever
clobbers published bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import validate_release  # noqa: E402  (sys.path is configured above)

MANIFEST_SCHEMA = "ytark-candidate-manifest/v1"
IDENTITY_SCHEMA = "ytark-release-identity/v1"
IDENTITY_MARKER = re.compile(
    r"<!--\s*ytark-release-identity/v1\s+(\{.*?\})\s*-->", re.DOTALL
)

# Logical asset keys. "apk" resolves to the configured ARMv7 asset name; the
# rest are literal file names. NOTICE.md is rendered by the release helper at
# publication time, so it never comes from the build artefact.
ASSET_KEYS = ("apk", "userScript.js", "SHA256SUMS.txt", "base-apk-sha256.txt", "NOTICE.md")
ARTEFACT_KEYS = ("apk", "userScript.js", "SHA256SUMS.txt", "base-apk-sha256.txt")

RELEASE_NOTES = "release-notes.md"
IDENTITY_NOTES = "release-notes.identity.md"

TRUSTED_REPOSITORY = "2archiver/YTArk"


class ReleaseError(RuntimeError):
    """An actionable release problem that must fail the job."""


class GitHubApiError(ReleaseError):
    """A non-404 GitHub API failure (403, rate limit, network, malformed JSON)."""

    def __init__(self, message: str, status: int | None = None, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class ReleaseConflict(ReleaseError):
    """Published bytes/tag disagree with the verified candidate."""


class ImmutableRelease(ReleaseError):
    """The release could not be mutated (immutable releases, protected tag, 403/422)."""


# --------------------------------------------------------------------------- #
# GitHub REST reads
# --------------------------------------------------------------------------- #


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes


class GitHub:
    """Minimal read-only GitHub REST client with explicit failure handling."""

    def __init__(
        self,
        token: str,
        repository: str,
        api_url: str = "https://api.github.com",
        transport: Callable[[urllib.request.Request], Response] | None = None,
        retries: int = 3,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.token = token
        self.repository = repository
        self.api_url = api_url.rstrip("/")
        self._transport = transport
        self.retries = retries
        self._sleep = sleep

    # -- plumbing ---------------------------------------------------------- #

    def _default_transport(self, request: urllib.request.Request) -> Response:
        try:
            with urllib.request.urlopen(request, timeout=120) as raw:
                return Response(
                    status=int(raw.status),
                    headers={key.lower(): value for key, value in raw.headers.items()},
                    body=raw.read(),
                )
        except urllib.error.HTTPError as error:  # HTTP status >= 400
            body = b""
            try:
                body = error.read()
            except Exception:  # pragma: no cover - body already consumed
                pass
            return Response(
                status=int(error.code),
                headers={key.lower(): value for key, value in (error.headers or {}).items()},
                body=body,
            )

    def request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        accept: str = "application/vnd.github+json",
        allow_404: bool = False,
        data: Any = None,
        headers: dict[str, str] | None = None,
        retries: int | None = None,
    ) -> Response | None:
        url = path if path.startswith("http") else f"{self.api_url}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        retries = self.retries if retries is None else retries
        attempt = 0
        while True:
            attempt += 1
            request = urllib.request.Request(url=url, method=method, data=data)
            request.add_header("Accept", accept)
            request.add_header("X-GitHub-Api-Version", "2022-11-28")
            request.add_header("User-Agent", "ytark-release-publisher")
            if self.token:
                request.add_header("Authorization", f"Bearer {self.token}")
            for name, value in (headers or {}).items():
                request.add_header(name, value)
            transport = self._transport or self._default_transport
            try:
                response = transport(request)
            except urllib.error.URLError as error:
                if attempt <= retries:
                    self._sleep(2 ** attempt)
                    continue
                raise GitHubApiError(
                    f"GitHub request to {method} {path} failed: {error}"
                ) from error
            status = response.status
            if status == 404 and allow_404:
                return None
            if status in (429, 500, 502, 503, 504) and attempt <= retries:
                delay = 2 ** attempt
                retry_after = response.headers.get("retry-after")
                try:
                    if retry_after:
                        delay = max(delay, float(retry_after))
                except ValueError:
                    pass
                self._sleep(delay)
                continue
            if status >= 400:
                raise self._error_for(status, response, method, path)
            return response

    def _error_for(self, status: int, response: Response, method: str, path: str) -> ReleaseError:
        body = response.body.decode("utf-8", "replace")[:2000]
        message = f"GitHub API {method} {path} failed with HTTP {status}"
        if status == 404:
            return GitHubApiError(message + " (not found)", status, body)
        remaining = response.headers.get("x-ratelimit-remaining")
        if status == 403 and remaining == "0":
            return GitHubApiError(
                message + " (rate limit exhausted; this is NOT 'release does not exist')",
                status,
                body,
            )
        try:
            payload = json.loads(response.body.decode("utf-8", "replace"))
            if isinstance(payload, dict) and payload.get("message"):
                message = f"{message}: {payload['message']}"
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        if method != "GET" and status in (403, 422):
            return ImmutableRelease(message + " (release assets are immutable, or the "
                                    "mutation was refused)", status, body)
        return GitHubApiError(message, status, body)

    def json(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.request(method, path, **kwargs)
        if response is None:
            return None
        try:
            return json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GitHubApiError(
                f"Malformed JSON from GitHub for {method} {path}: {error}"
            ) from error

    # -- release mutations (never keyed by tag: drafts 404 on /releases/tags) #

    def _json_body(self, payload: dict[str, Any]) -> bytes:
        return json.dumps(payload).encode("utf-8")

    def create_release(self, tag: str, commit: str, title: str, body: str) -> dict[str, Any]:
        payload = self.json(
            "POST", f"/repos/{self.repository}/releases",
            data=self._json_body({
                "tag_name": tag,
                "target_commitish": commit,
                "name": title,
                "body": body,
                "draft": True,
                "prerelease": False,
            }),
            headers={"Content-Type": "application/json"},
        )
        if not isinstance(payload, dict):
            raise GitHubApiError("Release creation returned an unexpected JSON shape")
        return payload

    def patch_release(self, release_id: Any, **fields: Any) -> dict[str, Any]:
        payload = self.json(
            "PATCH", f"/repos/{self.repository}/releases/{release_id}",
            data=self._json_body(fields),
            headers={"Content-Type": "application/json"},
        )
        if not isinstance(payload, dict):
            raise GitHubApiError("Release update returned an unexpected JSON shape")
        return payload

    def delete_release(self, release_id: Any) -> None:
        self.request("DELETE", f"/repos/{self.repository}/releases/{release_id}")

    def upload_asset(self, release_id: Any, path: Path, name: str) -> dict[str, Any]:
        """Upload one asset by release id, streaming the file and never clobbering."""
        url = (
            f"https://uploads.github.com/repos/{self.repository}/releases/{release_id}"
            f"/assets?name={urllib.parse.quote(name)}"
        )
        last_error: ReleaseError | None = None
        for attempt in range(1, self.retries + 2):
            with path.open("rb") as stream:
                try:
                    payload = self.json(
                        "POST", url, data=stream, retries=0,
                        headers={
                            "Content-Type": "application/octet-stream",
                            "Content-Length": str(path.stat().st_size),
                        },
                    )
                    break
                except ImmutableRelease:
                    raise
                except GitHubApiError as error:
                    last_error = error
                    if error.status not in (429, 500, 502, 503, 504) or attempt > self.retries:
                        raise
                    self._sleep(2 ** attempt)
        else:  # pragma: no cover - the loop above either breaks or raises
            raise last_error or GitHubApiError(f"Upload of {name} failed")
        if not isinstance(payload, dict):
            raise GitHubApiError(f"Upload of {name} returned an unexpected JSON shape")
        return payload

    # -- release reads ------------------------------------------------------ #

    def release_by_tag(self, tag: str) -> dict[str, Any] | None:
        """Return the release for ``tag`` or None for a confirmed 404.

        Drafts are frequently 404 on ``/releases/tags/{tag}`` even for an
        authenticated caller, so the paginated list is used as the fallback and
        the source of truth.
        """
        payload = self.json(
            "GET", f"/repos/{self.repository}/releases/tags/{urllib.parse.quote(tag)}",
            allow_404=True,
        )
        if isinstance(payload, dict) and payload.get("tag_name"):
            return payload
        for release in self.list_releases():
            if release.get("tag_name") == tag:
                return release
        return None

    def list_releases(self, max_pages: int = 10) -> list[dict[str, Any]]:
        releases: list[dict[str, Any]] = []
        page = 1
        while page <= max_pages:
            payload = self.json(
                "GET", f"/repos/{self.repository}/releases",
                params={"per_page": 100, "page": page},
            )
            if not isinstance(payload, list):
                raise GitHubApiError("The GitHub releases list returned an unexpected JSON shape")
            releases.extend(item for item in payload if isinstance(item, dict))
            if len(payload) < 100:
                break
            page += 1
        return releases

    def latest_release(self) -> dict[str, Any] | None:
        payload = self.json(
            "GET", f"/repos/{self.repository}/releases/latest", allow_404=True
        )
        return payload if isinstance(payload, dict) and payload.get("tag_name") else None

    def tag_commit(self, tag: str) -> str | None:
        payload = self.json(
            "GET", f"/repos/{self.repository}/git/matching-refs/tags/{urllib.parse.quote(tag)}",
            allow_404=True,
        )
        if not isinstance(payload, list):
            return None
        for ref in payload:
            if ref.get("ref") == f"refs/tags/{tag}":
                obj = ref.get("object", {})
                if obj.get("type") == "tag":
                    deref = self.json("GET", f"/repos/{self.repository}/git/tags/{obj.get('sha')}")
                    if isinstance(deref, dict):
                        return str(deref.get("object", {}).get("sha"))
                    return None
                return str(obj.get("sha"))
        return None

    def download_asset(self, asset: dict[str, Any], destination: Path) -> Path:
        asset_id = asset.get("id")
        if not asset_id:
            raise ReleaseError(f"Release asset {asset.get('name')!r} has no id")
        response = self.request(
            "GET",
            f"/repos/{self.repository}/releases/assets/{asset_id}",
            accept="application/octet-stream",
        )
        if response is None or not response.body:
            raise ReleaseError(f"Release asset {asset.get('name')!r} downloaded empty")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(response.body)
        return destination


# --------------------------------------------------------------------------- #
# Candidate handling
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class CandidateFile:
    name: str
    path: Path
    sha256: str
    size: int

    def verify(self) -> None:
        if not self.path.is_file():
            raise ReleaseError(f"Candidate asset {self.name} is missing at {self.path}")
        actual = file_sha256(self.path)
        if actual != self.sha256:
            raise ReleaseError(
                f"Candidate asset {self.name} changed after the build: manifest "
                f"{self.sha256}, on disk {actual}"
            )
        if self.path.stat().st_size != self.size:
            raise ReleaseError(
                f"Candidate asset {self.name} has an unexpected size: manifest "
                f"{self.size}, on disk {self.path.stat().st_size}"
            )


@dataclass
class Candidate:
    files: dict[str, CandidateFile]
    commit: str
    run_id: str
    config: dict[str, str]
    origin: str = "artefact"

    @property
    def apk(self) -> CandidateFile:
        return self.files["apk"]

    def identity(self) -> dict[str, Any]:
        return {
            "schema": IDENTITY_SCHEMA,
            "commit": self.commit,
            "run_id": str(self.run_id),
            "version_tag": self.config["VERSION_TAG"],
            "version_name": self.config["VERSION_NAME"],
            "version_code": int(self.config["VERSION_CODE"]),
            "script_tag": self.config["SCRIPT_TAG"],
            "base_tag": self.config["BASE_TAG"],
            "apk_name": self.apk.name,
            "apk_sha256": self.apk.sha256,
            "user_script_sha256": self.files["userScript.js"].sha256,
        }

    def identity_matches(self, other: dict[str, Any] | None) -> bool:
        if not other:
            return False
        mine = self.identity()
        return all(
            str(other.get(key)) == str(value)
            for key, value in mine.items()
            if key in ("commit", "run_id", "apk_sha256", "user_script_sha256", "version_tag")
        )


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def asset_name(key: str, config: dict[str, str]) -> str:
    return config["APK_ARMV7"] if key == "apk" else key


def write_manifest(
    output: Path,
    *,
    candidate_dir: Path,
    commit: str,
    run_id: str,
    repository: str,
    config: dict[str, str] | None = None,
) -> Path:
    """Record the artefact layout and digests of the built candidate."""
    config = config or validate_release.load_config()
    files: dict[str, dict[str, Any]] = {}
    for key in ARTEFACT_KEYS:
        name = asset_name(key, config)
        path = candidate_dir / "release-assets" / name
        if not path.is_file():
            raise ReleaseError(
                f"Candidate asset {name} is missing from {path}. Artefact layout: "
                + ", ".join(sorted(str(p) for p in candidate_dir.rglob("*") if p.is_file())[:20])
            )
        files[name] = {
            "key": key,
            "path": str(path.relative_to(candidate_dir)),
            "sha256": file_sha256(path),
            "size": path.stat().st_size,
        }
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "repository": repository,
        "commit": commit,
        "run_id": str(run_id),
        "config": {key: config[key] for key in (
            "VERSION_NAME", "DISPLAY_VERSION", "VERSION_CODE", "VERSION_TAG",
            "SCRIPT_TAG", "BASE_TAG", "RELEASE_NAME", "APK_ARMV7", "APP_ID", "APP_NAME",
        )},
        "files": files,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote candidate manifest {output} for {commit} (run {run_id}).")
    return output


def load_candidate(
    manifest_path: Path,
    *,
    candidate_dir: Path,
    commit: str,
    run_id: str,
    repository: str,
) -> Candidate:
    if not manifest_path.is_file():
        raise ReleaseError(
            f"Candidate manifest {manifest_path} is missing. The downloaded artefact "
            "layout did not match the expected upload root."
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ReleaseError(f"Candidate manifest {manifest_path} is not valid JSON: {error}") from error
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise ReleaseError(f"Unsupported candidate manifest schema: {manifest.get('schema')!r}")
    if manifest.get("repository") != repository:
        raise ReleaseError(
            f"Candidate manifest belongs to {manifest.get('repository')!r}, not {repository!r}"
        )
    if manifest.get("commit") != commit:
        raise ReleaseError(
            f"Candidate manifest was built from {manifest.get('commit')!r}, not the "
            f"expected commit {commit!r}"
        )
    if str(manifest.get("run_id")) != str(run_id):
        raise ReleaseError(
            f"Candidate manifest belongs to run {manifest.get('run_id')!r}, not run {run_id!r}"
        )

    config = validate_release.load_config()
    for key, value in manifest.get("config", {}).items():
        if key in config and str(config[key]) != str(value):
            raise ReleaseError(
                f"Candidate manifest {key} {value!r} disagrees with "
                f"release/version.properties ({config[key]!r})"
            )

    files: dict[str, CandidateFile] = {}
    for name, entry in manifest.get("files", {}).items():
        key = entry.get("key") or ("apk" if name == config["APK_ARMV7"] else name)
        path = candidate_dir / str(entry.get("path"))
        files[key] = CandidateFile(
            name=name, path=path, sha256=str(entry["sha256"]), size=int(entry["size"])
        )
    missing = [key for key in ARTEFACT_KEYS if key not in files]
    if missing:
        raise ReleaseError(
            "Candidate manifest is missing assets: " + ", ".join(sorted(missing))
        )
    candidate = Candidate(files=files, commit=commit, run_id=str(run_id), config=config)
    # Fail fast when the artefact was extracted somewhere unexpected: the whole
    # point of the manifest is that the publisher never guesses a path.
    for file in candidate.files.values():
        if not file.path.is_file():
            raise ReleaseError(
                f"Candidate asset {file.name} is not at the recorded path {file.path}. "
                "The artefact layout changed; the upload root and the manifest disagree."
            )
    return candidate


# --------------------------------------------------------------------------- #
# Release-state planning
# --------------------------------------------------------------------------- #

ACTION_CREATE = "create"
ACTION_RESUME = "resume"
ACTION_REPLACE_DRAFT = "replace-draft"
ACTION_REPAIR = "repair"
ACTION_VERIFY_ONLY = "verify-only"
ACTION_FAIL = "fail"


@dataclass
class Plan:
    state: str
    action: str
    build_needed: bool
    release: dict[str, Any] | None = None
    missing: list[str] = field(default_factory=list)
    conflicting: list[str] = field(default_factory=list)
    detail: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "action": self.action,
            "build_needed": self.build_needed,
            "missing": self.missing,
            "conflicting": self.conflicting,
            "detail": self.detail,
            "release_id": (self.release or {}).get("id"),
            "draft": bool((self.release or {}).get("draft")),
        }


def release_assets(release: dict[str, Any]) -> dict[str, dict[str, Any]]:
    assets: dict[str, dict[str, Any]] = {}
    for asset in release.get("assets") or []:
        name = asset.get("name")
        if isinstance(name, str):
            assets[name] = asset
    return assets


def asset_sha256(asset: dict[str, Any]) -> str | None:
    return validate_release.parse_sha256_digest(asset.get("digest"))


def required_asset_names(config: dict[str, str]) -> list[str]:
    return [asset_name(key, config) for key in ASSET_KEYS]


def parse_identity(release: dict[str, Any] | None) -> dict[str, Any] | None:
    if not release:
        return None
    match = IDENTITY_MARKER.search(release.get("body", "") or "")
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def classify(
    release: dict[str, Any] | None,
    config: dict[str, str],
    *,
    head_sha: str | None = None,
    candidate: Candidate | None = None,
) -> Plan:
    """Classify the release state. ``candidate`` enables digest comparisons."""
    if release is None:
        return Plan(
            state="absent",
            action=ACTION_CREATE,
            build_needed=True,
            detail=f"No release exists for {config['VERSION_TAG']}.",
        )

    required = required_asset_names(config)
    assets = release_assets(release)
    present = [name for name in required if name in assets]
    missing = [name for name in required if name not in assets]

    conflicting: list[str] = []
    if candidate is not None:
        for name in present:
            entry = candidate.files.get("apk" if name == config["APK_ARMV7"] else name)
            if entry is None or entry.name != name:
                # Not part of this candidate yet (NOTICE.md is rendered later).
                continue
            digest = asset_sha256(assets[name])
            if digest is None:
                conflicting.append(f"{name} (missing GitHub SHA-256 digest)")
            elif digest != entry.sha256:
                conflicting.append(f"{name} (published {digest[:12]}…, candidate {entry.sha256[:12]}…)")

    draft = bool(release.get("draft"))
    identity = parse_identity(release)
    tag = release.get("tag_name")

    if draft:
        matches = False
        if candidate is not None:
            matches = candidate.identity_matches(identity)
        elif identity and head_sha:
            matches = str(identity.get("commit")) == head_sha
        if matches:
            return Plan(
                state="draft-match" if not missing else "draft-incomplete-match",
                action=ACTION_RESUME,
                build_needed=bool(missing),
                release=release,
                missing=missing,
                detail=(
                    f"Draft {tag} matches the verified candidate; "
                    + ("uploading missing assets." if missing else "promoting the staged draft.")
                ),
            )
        return Plan(
            state="draft-mismatch",
            action=ACTION_REPLACE_DRAFT,
            build_needed=True,
            release=release,
            missing=missing,
            detail=(
                f"Draft {tag} was staged from a different candidate "
                f"(commit {identity.get('commit') if identity else 'unknown'}); "
                "the unpublished draft is replaced with the verified candidate."
            ),
        )

    if conflicting:
        version, code = next_patch_version(config)
        return Plan(
            state="published-conflict",
            action=ACTION_FAIL,
            build_needed=False,
            release=release,
            conflicting=conflicting,
            detail=(
                f"Published release {tag} already contains different bytes for: "
                + ", ".join(conflicting)
                + ". Published bytes are never silently overwritten. Publish the next "
                f"patch version instead (versionName {version}, versionCode {code} in "
                "release/version.properties); never move an existing tag or lower the "
                "versionCode."
            ),
        )
    if missing:
        return Plan(
            state="published-incomplete",
            action=ACTION_REPAIR,
            build_needed=True,
            release=release,
            missing=missing,
            detail=f"Published release {tag} is missing: " + ", ".join(missing) + ".",
        )
    return Plan(
        state="published-complete",
        action=ACTION_VERIFY_ONLY,
        build_needed=False,
        release=release,
        detail=f"Release {tag} is published with every required asset.",
    )


def next_patch_version(config: dict[str, str]) -> tuple[str, int]:
    major, minor, patch = (int(part) for part in config["VERSION_NAME"].split("."))
    version = f"{major}.{minor}.{patch + 1}"
    return version, validate_release.version_code_for_release(version)


# --------------------------------------------------------------------------- #
# Static verification
# --------------------------------------------------------------------------- #


def verify_candidate_static(
    candidate: Candidate,
    *,
    aapt: str,
    apksigner: str,
    cert_file: Path,
    skip: bool = False,
) -> None:
    """Re-run the packaging checks on the exact bytes that will be published."""
    if skip:
        print("Static packaging checks skipped by request.")
        return
    for file in candidate.files.values():
        file.verify()
    validate_release.validate_apk(
        candidate.apk.path,
        "armv7",
        str(cert_file),
        aapt,
        apksigner,
    )
    validate_release.check_checksums(
        str(candidate.files["SHA256SUMS.txt"].path),
        str(candidate.apk.path),
        str(candidate.files["userScript.js"].path),
    )
    verify_script_binding(candidate.apk.path, script_url(candidate.config))


def script_url(config: dict[str, str], repository: str = TRUSTED_REPOSITORY) -> str:
    return f"https://cdn.jsdelivr.net/gh/{repository}@{config['SCRIPT_TAG']}/userScript.js?v="


def verify_script_binding(apk: Path, url: str) -> None:
    needle = url.encode()
    with zipfile.ZipFile(apk) as archive:
        hits = [
            info.filename
            for info in archive.infolist()
            if needle in archive.read(info.filename)
        ]
    if not hits:
        raise ReleaseError(
            f"The candidate APK does not load the expected immutable userscript URL {url}"
        )
    print("Immutable userscript URL bound in:", ", ".join(hits))


# --------------------------------------------------------------------------- #
# GitHub CLI mutations
# --------------------------------------------------------------------------- #

# Release mutations all go through the REST API with the release id: GitHub
# returns 404 on /releases/tags/{tag} for a draft, so tag-keyed commands (such
# as `gh release upload <tag>`) cannot stage assets on an unpublished release.


def create_draft_release(
    github: GitHub,
    tag: str,
    *,
    commit: str,
    title: str,
    notes_file: Path,
) -> None:
    github.create_release(tag, commit, title, notes_file.read_text(encoding="utf-8"))


def delete_draft(github: GitHub, release: dict[str, Any], tag: str) -> None:
    github.delete_release(release["id"])


def upload_assets(
    github: GitHub, release: dict[str, Any], files: Iterable[tuple[str, Path]]
) -> None:
    """Upload each missing asset by name; an existing name is never clobbered."""
    for name, path in files:
        github.upload_asset(release["id"], path, name)


def edit_release(
    github: GitHub,
    release: dict[str, Any],
    *,
    title: str | None = None,
    notes_file: Path | None = None,
    draft: bool | None = None,
    prerelease: bool | None = None,
    make_latest: bool | None = None,
) -> None:
    fields: dict[str, Any] = {}
    if title is not None:
        fields["name"] = title
    if notes_file is not None:
        fields["body"] = notes_file.read_text(encoding="utf-8")
    if draft is not None:
        fields["draft"] = draft
    if prerelease is not None:
        fields["prerelease"] = prerelease
    if make_latest:
        fields["make_latest"] = "true"
    github.patch_release(release["id"], **fields)


# --------------------------------------------------------------------------- #
# Notes / identity
# --------------------------------------------------------------------------- #


def render_notes(config: dict[str, str], commit: str, cert_sha256: str) -> Path:
    """Render release notes and NOTICE.md through the existing release helper."""
    environment = dict(os.environ)
    environment.update({
        key: config[key]
        for key in (
            "VERSION_NAME", "DISPLAY_VERSION", "VERSION_CODE", "VERSION_TAG",
            "SCRIPT_TAG", "BASE_TAG", "APK_ARMV7",
        )
    })
    environment.update({
        "GH_TOKEN": environment.get("GH_TOKEN", ""),
        "GITHUB_REPOSITORY": environment.get("GITHUB_REPOSITORY", TRUSTED_REPOSITORY),
        "GITHUB_SHA": commit,
        "APP_ID": config["APP_ID"],
        "APP_NAME": config["APP_NAME"],
        "SIGNING_CERT_SHA256": cert_sha256,
    })
    result = subprocess.run(
        ["bash", "tools/render_release_notes.sh"],
        cwd=str(ROOT),
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )
    if result.returncode != 0:
        raise ReleaseError(
            "tools/render_release_notes.sh failed: "
            + ((result.stderr or result.stdout or "").strip())
        )
    notes = ROOT / RELEASE_NOTES
    if not notes.is_file():
        raise ReleaseError(f"{RELEASE_NOTES} was not rendered")
    notice = ROOT / "release-assets" / "NOTICE.md"
    if not notice.is_file():
        raise ReleaseError("release-assets/NOTICE.md was not rendered")
    return notes


def stage_release_assets(candidate: Candidate) -> None:
    """Mirror the exact candidate bytes into ./release-assets for the helpers."""
    stage = ROOT / "release-assets"
    stage.mkdir(parents=True, exist_ok=True)
    for key in ARTEFACT_KEYS:
        source = candidate.files[key]
        destination = stage / source.name
        shutil.copyfile(source.path, destination)
    notice = stage / "NOTICE.md"
    if notice.is_file():
        candidate.files["NOTICE.md"] = CandidateFile(
            name="NOTICE.md", path=notice, sha256=file_sha256(notice),
            size=notice.stat().st_size,
        )


def with_identity(notes: Path, candidate: Candidate, output: Path) -> Path:
    body = notes.read_text(encoding="utf-8")
    body = IDENTITY_MARKER.sub("", body).rstrip() + "\n\n"
    body += (
        "<!-- ytark-release-identity/v1 "
        + json.dumps(candidate.identity(), sort_keys=True)
        + " -->\n"
    )
    output.write_text(body, encoding="utf-8")
    return output


# --------------------------------------------------------------------------- #
# jsDelivr verification
# --------------------------------------------------------------------------- #


def verify_script_tag_served(url: str, expected: Path, attempts: int = 20, pause: float = 15.0) -> None:
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                served = response.read()
            if hashlib.sha256(served).hexdigest() == file_sha256(expected):
                print(f"jsDelivr serves the exact immutable userscript: {url}")
                return
        except (urllib.error.URLError, TimeoutError) as error:
            print(f"jsDelivr lookup failed ({attempt}/{attempts}): {error}")
        time.sleep(pause)
    raise ReleaseError(
        f"jsDelivr did not serve the exact immutable userscript bytes from {url}"
    )


# --------------------------------------------------------------------------- #
# Publication
# --------------------------------------------------------------------------- #


def summarise(lines: Iterable[str]) -> None:
    text = "\n".join(lines)
    print(text)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as stream:
            stream.write(text + "\n")


def plan_command(args: argparse.Namespace) -> int:
    config = validate_release.load_config()
    github = GitHub(token=args.token, repository=args.repository, api_url=args.api_url)
    release = github.release_by_tag(config["VERSION_TAG"])
    plan = classify(release, config, head_sha=args.head_sha)
    if plan.state == "published-complete":
        latest = github.latest_release()
        try:
            validate_release.verify_release_record(
                release,
                "published",
                latest if (latest or {}).get("tag_name") == config["VERSION_TAG"] else None,
            )
        except ValueError as error:
            plan = Plan(
                state="published-invalid",
                action=ACTION_FAIL,
                build_needed=False,
                release=release,
                detail=str(error),
            )
    if args.file:
        with open(args.file, "a", encoding="utf-8") as stream:
            stream.write(f"state={plan.state}\n")
            stream.write(f"action={plan.action}\n")
            stream.write(f"build_needed={str(plan.build_needed).lower()}\n")
            stream.write(f"missing={','.join(plan.missing)}\n")
    report = [
        f"## YTArk release plan for {config['VERSION_TAG']}",
        f"- Release state: **{plan.state}**",
        f"- Next action: **{plan.action}**",
        f"- Candidate build needed: **{str(plan.build_needed).lower()}**",
        f"- Configured versionCode: `{config['VERSION_CODE']}`",
        f"- Configured userscript tag: `{config['SCRIPT_TAG']}`",
        f"- Detail: {plan.detail}",
    ]
    if plan.missing:
        report.append("- Missing required assets: " + ", ".join(plan.missing))
    if plan.conflicting:
        report.append("- Conflicting assets: " + ", ".join(plan.conflicting))
    if plan.state == "published-complete":
        report.append("- Nothing to publish: the published release already validates.")
    summarise(report)
    if plan.action == ACTION_FAIL:
        return 1
    return 0


def publish_command(args: argparse.Namespace) -> int:
    config = validate_release.load_config()
    cert_sha256 = validate_release.read_expected_fingerprint(
        str(ROOT / "signing" / "YTArk-cert-sha256.txt")
    )
    if args.repository != TRUSTED_REPOSITORY:
        raise ReleaseError(
            f"Refusing to publish for {args.repository!r}: the YTArk release is only "
            f"published from {TRUSTED_REPOSITORY}."
        )
    github = GitHub(token=args.token, repository=args.repository, api_url=args.api_url)

    release = github.release_by_tag(config["VERSION_TAG"])

    if args.candidate_dir and args.manifest:
        candidate = load_candidate(
            Path(args.manifest),
            candidate_dir=Path(args.candidate_dir),
            commit=args.commit,
            run_id=args.run_id,
            repository=args.repository,
        )
    else:
        candidate = candidate_from_release(
            release, config, github, commit=args.commit, run_id=args.run_id,
            workdir=Path(args.workdir),
        )

    plan = classify(release, config, head_sha=args.commit, candidate=candidate)
    print(f"Release plan: {json.dumps(plan.as_dict(), indent=2, sort_keys=True)}")

    if plan.action == ACTION_FAIL:
        raise ReleaseConflict(plan.detail)

    if plan.action == ACTION_REPLACE_DRAFT:
        if not (release or {}).get("draft"):
            raise ReleaseConflict(
                "Refusing to replace a published release. " + plan.detail
            )
        summarise([
            "## Replacing an unpublished draft",
            f"- Draft `{release.get('tag_name')}` (id {release.get('id')}) was staged from "
            f"a different candidate: {plan.detail}",
            "- The draft was never public, so its staged assets are discarded and "
            "replaced with the currently verified candidate.",
        ])
        delete_draft(github, release, config["VERSION_TAG"])
        release = None
        plan = classify(None, config, head_sha=args.commit, candidate=candidate)

    if plan.action == ACTION_REPAIR:
        check_repair_compatibility(release, candidate, github, workdir=Path(args.workdir))

    verify_candidate_static(
        candidate,
        aapt=args.aapt,
        apksigner=args.apksigner,
        cert_file=ROOT / "signing" / "YTArk-cert-sha256.txt",
        skip=args.skip_static_checks,
    )

    publish_script_tag(candidate)

    stage_release_assets(candidate)
    notes = render_notes(config, args.commit, cert_sha256)
    stage_release_assets(candidate)
    notes_with_identity = with_identity(notes, candidate, ROOT / IDENTITY_NOTES)

    if plan.action == ACTION_CREATE:
        existing_tag = github.tag_commit(config["VERSION_TAG"])
        if existing_tag and existing_tag != args.commit:
            raise ReleaseConflict(
                f"Git tag {config['VERSION_TAG']} exists at {existing_tag}, not at the "
                f"reviewed commit {args.commit}. Tags are never moved."
            )
        create_draft_release(
            github,
            config["VERSION_TAG"],
            commit=args.commit,
            title=config["RELEASE_NAME"],
            notes_file=notes_with_identity,
        )
        release = github.release_by_tag(config["VERSION_TAG"])
        if release is None:
            raise ReleaseError(f"Draft release {config['VERSION_TAG']} was not created")
        plan = classify(release, config, head_sha=args.commit, candidate=candidate)

    # Upload whatever is genuinely missing, by name, never clobbering.
    if plan.missing:
        assets = release_assets(release or {})
        to_upload: list[tuple[str, Path]] = []
        for name in plan.missing:
            if name in assets:
                raise ReleaseConflict(
                    f"Refusing to overwrite the existing release asset {name}"
                )
            key = "apk" if name == config["APK_ARMV7"] else name
            path = candidate.files[key].path
            if path.name != name:
                raise ReleaseError(
                    f"Candidate file {path} does not match the release asset name {name}"
                )
            to_upload.append((name, path))
        upload_assets(github, release, to_upload)
        release = github.release_by_tag(config["VERSION_TAG"])
        if release is None:
            raise ReleaseError(f"Release {config['VERSION_TAG']} disappeared after upload")
        plan = classify(release, config, head_sha=args.commit, candidate=candidate)

    if plan.action == ACTION_VERIFY_ONLY or not (release or {}).get("draft"):
        # Either it was already published (and now repaired/verified) or there was
        # nothing to do: the public state is verified below.
        return verify_published(github, candidate, config, args)

    # Refresh the draft's title and notes so the published body always carries
    # this candidate's identity.
    edit_release(
        github, release,
        title=config["RELEASE_NAME"],
        notes_file=notes_with_identity,
    )

    # Verify the staged draft before it becomes public.
    release = github.release_by_tag(config["VERSION_TAG"])
    try:
        validate_release.verify_release_record(release, "draft")
    except ValueError as error:
        raise ReleaseError(
            f"Staged release {config['VERSION_TAG']} failed validation, refusing to "
            f"publish it: {error}"
        ) from error
    summarise([
        "## Staged draft verified",
        f"- `{config['VERSION_TAG']}` holds the exact candidate bytes as a draft.",
        f"- APK sha256 `{candidate.apk.sha256}`.",
    ])

    edit_release(
        github, release, draft=False, prerelease=False, make_latest=True,
        title=config["RELEASE_NAME"], notes_file=notes_with_identity,
    )
    return verify_published(github, candidate, config, args)


def publish_script_tag(candidate: Candidate) -> None:
    script = candidate.files["userScript.js"]
    environment = dict(os.environ)
    environment.update({
        "GH_TOKEN": candidate_token(),
        "GITHUB_REPOSITORY": os.environ.get("GITHUB_REPOSITORY", TRUSTED_REPOSITORY),
        "SCRIPT_TAG": candidate.config["SCRIPT_TAG"],
    })
    result = subprocess.run(
        ["bash", "tools/publish_script_tag.sh", str(script.path)],
        cwd=str(ROOT), check=False, capture_output=True, text=True, env=environment,
    )
    if result.returncode != 0:
        raise ReleaseError(
            "tools/publish_script_tag.sh failed: "
            + ((result.stderr or result.stdout or "").strip())
        )
    print((result.stdout or "").strip())
    verify_script_tag_served(
        script_url(candidate.config, os.environ.get("GITHUB_REPOSITORY", TRUSTED_REPOSITORY)),
        script.path,
    )


def candidate_token() -> str:
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        raise ReleaseError("GH_TOKEN is required to publish the userscript tag")
    return token


def candidate_from_release(
    release: dict[str, Any] | None,
    config: dict[str, str],
    github: GitHub,
    *,
    commit: str,
    run_id: str,
    workdir: Path,
) -> Candidate:
    """Rebuild the candidate from a draft that already holds all of its assets."""
    if release is None:
        raise ReleaseError(
            "No candidate artefact was supplied and no existing release holds one."
        )
    if not release.get("draft"):
        raise ReleaseError(
            "Refusing to treat a published release as its own candidate source; "
            "supply the verified build artefact."
        )
    identity = parse_identity(release)
    if not identity:
        raise ReleaseError(
            f"Draft {release.get('tag_name')} does not record a candidate identity; "
            "re-run the build so the candidate artefact is available."
        )
    if str(identity.get("commit")) != commit:
        raise ReleaseError(
            f"Draft {release.get('tag_name')} was staged from {identity.get('commit')}, "
            f"not {commit}."
        )
    assets = release_assets(release)
    workdir.mkdir(parents=True, exist_ok=True)
    files: dict[str, CandidateFile] = {}
    for key in ASSET_KEYS:
        name = asset_name(key, config)
        asset = assets.get(name)
        if asset is None:
            raise ReleaseError(
                f"Draft {release.get('tag_name')} is missing {name}; a rebuild is required."
            )
        destination = workdir / name
        github.download_asset(asset, destination)
        digest = file_sha256(destination)
        published = asset_sha256(asset)
        if published and digest != published:
            raise ReleaseError(
                f"Downloaded draft asset {name} sha256 {digest} does not match the "
                f"published digest {published}"
            )
        files[key] = CandidateFile(
            name=name, path=destination, sha256=digest, size=destination.stat().st_size
        )
    candidate = Candidate(files=files, commit=commit, run_id=str(run_id), config=config,
                          origin="draft-assets")
    if not candidate.identity_matches(identity):
        raise ReleaseConflict(
            f"Draft {release.get('tag_name')} identity does not match its own assets."
        )
    return candidate


def check_repair_compatibility(
    release: dict[str, Any], candidate: Candidate, github: GitHub, *, workdir: Path
) -> None:
    """A published release may only be repaired with bytes its own checksums accept."""
    assets = release_assets(release)
    sums = assets.get("SHA256SUMS.txt")
    if not sums:
        return
    workdir.mkdir(parents=True, exist_ok=True)
    published = workdir / "published-SHA256SUMS.txt"
    github.download_asset(sums, published)
    try:
        expected = validate_release.parse_checksum_file(str(published))
    except ValueError as error:
        raise ReleaseError(
            f"Published SHA256SUMS.txt for {release.get('tag_name')} is unreadable: {error}"
        ) from error
    for key in ARTEFACT_KEYS:
        name = candidate.files[key].name
        if name in assets:
            continue
        recorded = expected.get(name)
        if recorded and recorded != candidate.files[key].sha256:
            version, code = next_patch_version(candidate.config)
            raise ReleaseConflict(
                f"The published SHA256SUMS.txt for {release.get('tag_name')} records "
                f"{name} as {recorded}, but the rebuilt candidate is "
                f"{candidate.files[key].sha256}. A byte-exact repair needs the original "
                f"candidate artefact; without it, publish the next patch version "
                f"instead: set versionName={version}, versionCode={code} and a new "
                f"versionTag/scriptTag in release/version.properties. Never move an "
                f"existing tag or lower the versionCode."
            )


def verify_published(
    github: GitHub,
    candidate: Candidate,
    config: dict[str, str],
    args: argparse.Namespace,
) -> int:
    """Verify the public release, then re-download and re-verify every asset."""
    tag = config["VERSION_TAG"]
    release = github.release_by_tag(tag)
    if release is None:
        raise ReleaseError(f"Release {tag} does not exist after publication")
    latest = github.latest_release()
    if (latest or {}).get("tag_name") != tag:
        raise ReleaseError(
            f"{tag} is not the GitHub latest stable release (latest is "
            f"{(latest or {}).get('tag_name')!r})"
        )
    try:
        validate_release.verify_release_record(release, "published", latest)
    except ValueError as error:
        raise ReleaseError(f"Published release {tag} failed validation: {error}") from error

    assets = release_assets(release)
    downloaded: list[str] = []
    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    for key in ASSET_KEYS:
        name = asset_name(key, config)
        asset = assets.get(name)
        if asset is None:
            raise ReleaseError(f"Published release {tag} is missing asset {name}")
        if int(asset.get("size", 0)) <= 0:
            raise ReleaseError(f"Published asset {name} has a zero size")
        digest = asset_sha256(asset)
        if digest and digest != candidate.files[key].sha256:
            raise ReleaseConflict(
                f"Published asset {name} sha256 {digest} does not match the verified "
                f"candidate {candidate.files[key].sha256}"
            )
        destination = workdir / f"published-{name}"
        github.download_asset(asset, destination)
        actual = file_sha256(destination)
        if actual != candidate.files[key].sha256:
            raise ReleaseConflict(
                f"Downloaded public asset {name} sha256 {actual} does not match the "
                f"verified candidate {candidate.files[key].sha256}"
            )
        downloaded.append(name)

    public_apk = workdir / f"published-{config['APK_ARMV7']}"
    if not args.skip_static_checks:
        validate_release.validate_apk(
            public_apk, "armv7", str(ROOT / "signing" / "YTArk-cert-sha256.txt"),
            args.aapt, args.apksigner,
        )
        validate_release.check_checksums(
            str(workdir / "published-SHA256SUMS.txt"),
            str(public_apk),
            str(workdir / "published-userScript.js"),
        )
    apk_url = (
        f"https://github.com/{TRUSTED_REPOSITORY}/releases/download/{tag}/{config['APK_ARMV7']}"
    )
    summarise([
        f"## YTArk {config['DISPLAY_VERSION']} published",
        f"- Release: `{tag}` — draft=false, prerelease=false, and it resolves as GitHub latest.",
        f"- ARMv7 APK: [`{config['APK_ARMV7']}`]({apk_url})",
        f"  - sha256 `{candidate.apk.sha256}`, {candidate.apk.size} bytes, `armeabi-v7a` only.",
        f"- Candidate source: {candidate.origin}"
        + (f" (run `{candidate.run_id}`, commit `{candidate.commit}`)" if candidate.origin == "artefact" else ""),
        f"- Immutable userscript tag `{config['SCRIPT_TAG']}` serves the exact bundled script.",
        "- Re-downloaded and re-verified public assets: " + ", ".join(downloaded) + ".",
        "- Static packaging checks are not device tests: no install, launch, playback or",
        "  in-place-update behaviour is claimed for this build.",
    ])
    if args.device_test_notes:
        summarise([
            "",
            "### Optional device-test notes (self-reported, not verified by this run)",
            "",
            args.device_test_notes,
        ])
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _shared_options(parser: argparse.ArgumentParser) -> None:
    """Options accepted by every subcommand: `publish_release.py <command> ...`."""
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", TRUSTED_REPOSITORY))
    parser.add_argument("--token", default=os.environ.get("GH_TOKEN", ""))
    parser.add_argument("--api-url", default=os.environ.get("GITHUB_API_URL", "https://api.github.com"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        epilog="usage: publish_release.py <write-manifest|plan|publish> [options]",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    manifest = commands.add_parser("write-manifest", help="record the candidate artefact layout")
    _shared_options(manifest)
    manifest.add_argument("--output", required=True)
    manifest.add_argument("--candidate-dir", default=".")
    manifest.add_argument("--commit", required=True)
    manifest.add_argument("--run-id", default="")

    plan_cmd = commands.add_parser("plan", help="classify the release state (read-only)")
    _shared_options(plan_cmd)
    plan_cmd.add_argument("--file", default="")
    plan_cmd.add_argument("--head-sha", default=os.environ.get("GITHUB_SHA", ""))

    publish_cmd = commands.add_parser("publish", help="publish, resume, repair or verify")
    _shared_options(publish_cmd)
    publish_cmd.add_argument("--commit", required=True)
    publish_cmd.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID", ""))
    publish_cmd.add_argument("--candidate-dir", default="")
    publish_cmd.add_argument("--manifest", default="")
    publish_cmd.add_argument("--workdir", default="publish-work")
    publish_cmd.add_argument("--aapt", default="aapt")
    publish_cmd.add_argument("--apksigner", default="apksigner")
    publish_cmd.add_argument("--skip-static-checks", action="store_true")
    publish_cmd.add_argument("--device-test-notes", default="")

    commands.add_parser(
        "self-check",
        help="exercise the release state machine and the trust boundary offline",
    )
    return parser


def self_check() -> int:
    """Exercise the production entry points without touching GitHub.

    Run by ci.yml so a regression in the release state machine or in the
    trust boundary fails PR validation, not a release.
    """
    config = validate_release.load_config()
    required = required_asset_names(config)

    refused = build_parser().parse_args([
        "publish", "--repository", "notytark/YTArk", "--commit", "0" * 40,
        "--workdir", tempfile.mkdtemp(prefix="ytark-selfcheck-"),
    ])
    try:
        publish_command(refused)
    except ReleaseError as error:
        if "Refusing to publish" not in str(error):
            raise ReleaseError(f"unexpected publication refusal: {error}") from error
    else:
        raise ReleaseError("publication must refuse a repository other than "
                           f"{TRUSTED_REPOSITORY}")

    absent = classify(None, config, head_sha="0" * 40)
    assert absent.action == ACTION_CREATE and absent.build_needed, absent

    empty = {"tag_name": config["VERSION_TAG"], "draft": False, "prerelease": False,
             "assets": [], "body": ""}
    incomplete = classify(empty, config, head_sha="0" * 40)
    assert incomplete.action == ACTION_REPAIR and incomplete.build_needed, incomplete
    assert sorted(incomplete.missing) == sorted(required), incomplete

    complete = dict(empty, assets=[
        {"name": name, "size": 10, "digest": "sha256:" + "a" * 64,
         "browser_download_url":
             f"https://github.com/{TRUSTED_REPOSITORY}/releases/download/"
             f"{config['VERSION_TAG']}/{name}"}
        for name in required
    ], body="")
    finished = classify(complete, config, head_sha="0" * 40)
    assert finished.action == ACTION_VERIFY_ONLY and not finished.build_needed, finished

    version, code = next_patch_version(config)
    if code <= int(config["VERSION_CODE"]):
        raise ReleaseError("the suggested next patch versionCode must increase")

    with tempfile.TemporaryDirectory() as temp:
        factory_root = Path(temp)
        assets = factory_root / "release-assets"
        assets.mkdir()
        (assets / config["APK_ARMV7"]).write_bytes(b"apk")
        (assets / "userScript.js").write_bytes(b"script")
        (assets / "SHA256SUMS.txt").write_bytes(b"sums")
        (assets / "base-apk-sha256.txt").write_bytes(b"base")
        manifest = factory_root / "candidate-manifest.json"
        write_manifest(manifest, candidate_dir=factory_root, commit="a" * 40,
                       run_id="1", repository=TRUSTED_REPOSITORY)
        candidate = load_candidate(manifest, candidate_dir=factory_root,
                                   commit="a" * 40, run_id="1",
                                   repository=TRUSTED_REPOSITORY)
        if candidate.apk.sha256 != hashlib.sha256(b"apk").hexdigest():
            raise ReleaseError("the candidate manifest lost the APK digest")
        try:
            load_candidate(manifest, candidate_dir=factory_root, commit="b" * 40,
                           run_id="1", repository=TRUSTED_REPOSITORY)
        except ReleaseError:
            pass
        else:
            raise ReleaseError("a manifest from another commit must be rejected")

    print(f"publish_release self-check OK (next patch after "
          f"{config['VERSION_NAME']} would be {version}/{code}).")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "self-check":
        return self_check()
    if args.command == "write-manifest":
        write_manifest(
            Path(args.output),
            candidate_dir=Path(args.candidate_dir),
            commit=args.commit,
            run_id=args.run_id,
            repository=args.repository,
        )
        return 0
    if args.command == "plan":
        return plan_command(args)
    if args.command == "publish":
        return publish_command(args)
    raise SystemExit(f"unknown command {args.command}")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ReleaseError as error:
        print(f"Release publication failed: {error}", file=sys.stderr)
        sys.exit(1)
