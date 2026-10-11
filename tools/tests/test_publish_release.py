"""Release-state and publication tests for tools/publish_release.py.

These cover the production helper the workflows call: absent release, matching
draft resume, complete stable no-op, stable missing APK, conflicting asset,
immutable release and non-404 API failures.
"""

from __future__ import annotations

import hashlib
import json
import re
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import publish_release  # noqa: E402
import validate_release  # noqa: E402

CONFIG = validate_release.load_config()
APK = CONFIG["APK_ARMV7"]
SCRIPT = "userScript.js"
SUMS = "SHA256SUMS.txt"
BASE_SUMS = "base-apk-sha256.txt"
NOTICE = "NOTICE.md"
ALL_ASSETS = [APK, SCRIPT, SUMS, BASE_SUMS, NOTICE]

APK_BYTES = b"signed-armv7-apk-bytes"
REBUILD_BYTES = b"a-different-rebuilt-armv7-apk"
SCRIPT_BYTES = b"// YTArk userscript bundle\n"
BASE_SUMS_BYTES = b"base-checksums\n"
NOTICE_BYTES = b"# YTArk notices and provenance\n"
_RENDERED_NOTICE: bytes | None = None
COMMIT = "a" * 40
RUN_ID = "38120854970"
ASSET_ID_BASE = 700


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def rendered_notice() -> bytes:
    """Render the real NOTICE.md once, exactly as the publish job does."""
    global _RENDERED_NOTICE
    if _RENDERED_NOTICE is not None:
        return _RENDERED_NOTICE
    with tempfile.TemporaryDirectory() as temp:
        scratch = Path(temp) / "scratch"
        (scratch / "tools").mkdir(parents=True)
        shutil.copyfile(
            ROOT / "tools" / "render_release_notes.sh",
            scratch / "tools" / "render_release_notes.sh",
        )
        (scratch / "release-assets").mkdir(parents=True)
        (scratch / "release-assets" / APK).write_bytes(APK_BYTES)
        with patch.object(publish_release, "ROOT", scratch), patch.dict(
            os.environ, {"GH_TOKEN": "t", "GITHUB_REPOSITORY": "2archiver/YTArk"}, clear=False
        ):
            publish_release.render_notes(CONFIG, COMMIT, "f" * 64)
        _RENDERED_NOTICE = (scratch / "release-assets" / "NOTICE.md").read_bytes()
    return _RENDERED_NOTICE


def payloads(apk_bytes: bytes = APK_BYTES, notice_bytes: bytes | None = None) -> dict[str, bytes]:
    return {
        APK: apk_bytes,
        SCRIPT: SCRIPT_BYTES,
        SUMS: f"{sha256(apk_bytes)}  {APK}\n{sha256(SCRIPT_BYTES)}  {SCRIPT}\n".encode(),
        BASE_SUMS: BASE_SUMS_BYTES,
        NOTICE: notice_bytes if notice_bytes is not None else rendered_notice(),
    }


class Response(publish_release.Response):
    def __init__(self, status: int = 200, body: bytes | dict | list = b"", headers: dict | None = None):
        raw = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        super().__init__(status, headers or {}, bytes(raw))


def default_body() -> str:
    return (
        f"# YTArk {CONFIG['DISPLAY_VERSION']}\n"
        f"Android package `{validate_release.APP_ID}`\n"
        f"Version {CONFIG['DISPLAY_VERSION']} ({CONFIG['VERSION_NAME']}; "
        f"versionCode {CONFIG['VERSION_CODE']})\n"
        f"TizenTubeCobalt {CONFIG['BASE_TAG']}\n"
        f"`{CONFIG['APK_ARMV7']}` armeabi-v7a\n"
        "Only ARMv7 is published; an Android userspace whose abilist contains only\n"
        "arm64-v8a (a 64-bit system) cannot install this release.\n"
        "4K does not select an APK architecture.\n"
    )


def identity_body(candidate: publish_release.Candidate) -> str:
    return (
        default_body()
        + "\n\n<!-- ytark-release-identity/v1 "
        + json.dumps(candidate.identity(), sort_keys=True)
        + " -->\n"
    )


def release_payload(
    *,
    tag: str = CONFIG["VERSION_TAG"],
    name: str = CONFIG["RELEASE_NAME"],
    draft: bool = False,
    prerelease: bool = False,
    assets: list[str] | None = None,
    body: str | None = None,
    digests: dict[str, str] | None = None,
    apk_bytes: bytes = APK_BYTES,
) -> dict:
    """Build a GitHub release payload whose asset bytes are served on download."""
    digests = digests or {}
    contents = payloads(apk_bytes)
    asset_list = []
    for index, asset_name in enumerate(ALL_ASSETS if assets is None else assets):
        asset_list.append({
            "id": ASSET_ID_BASE + index,
            "name": asset_name,
            "size": len(contents[asset_name]),
            "state": "uploaded",
            "digest": "sha256:" + digests.get(asset_name, sha256(contents[asset_name])),
            "browser_download_url": (
                f"https://github.com/2archiver/YTArk/releases/download/{tag}/{asset_name}"
            ),
            "_bytes": contents[asset_name],
        })
    return {
        "id": 409_000_001,
        "name": name,
        "tag_name": tag,
        "draft": draft,
        "prerelease": prerelease,
        "body": body if body is not None else default_body(),
        "assets": asset_list,
    }


class CandidateFactory:
    """Build a real candidate tree (files on disk) plus its manifest."""

    def __init__(
        self,
        root: Path,
        *,
        commit: str = COMMIT,
        run_id: str = RUN_ID,
        apk_bytes: bytes = APK_BYTES,
    ):
        self.commit = commit
        self.run_id = run_id
        self.aroot = root / "candidate"
        assets = self.aroot / "release-assets"
        assets.mkdir(parents=True)
        (assets / APK).write_bytes(apk_bytes)
        (assets / SCRIPT).write_bytes(SCRIPT_BYTES)
        (assets / BASE_SUMS).write_bytes(BASE_SUMS_BYTES)
        (assets / SUMS).write_bytes(payloads(apk_bytes)[SUMS])
        # NOTICE.md is rendered at publication time, exactly as
        # stage_release_assets() does in the workflow.
        self.notice = self.aroot / NOTICE
        self.notice.write_bytes(payloads(apk_bytes)[NOTICE])
        self.manifest = self.aroot / "candidate-manifest.json"
        publish_release.write_manifest(
            self.manifest, candidate_dir=self.aroot, commit=commit,
            run_id=run_id, repository="2archiver/YTArk",
        )

    def candidate(self, *, origin: str = "artefact") -> publish_release.Candidate:
        candidate = publish_release.load_candidate(
            self.manifest, candidate_dir=self.aroot, commit=self.commit,
            run_id=self.run_id, repository="2archiver/YTArk",
        )
        notice_bytes = self.notice.read_bytes()
        candidate.files[NOTICE] = publish_release.CandidateFile(
            name=NOTICE, path=self.notice, sha256=sha256(notice_bytes), size=len(notice_bytes)
        )
        candidate.origin = origin
        return candidate


def public(release: dict) -> dict:
    """Strip the private asset payload before it is serialised as an API body."""
    clone = json.loads(json.dumps({k: v for k, v in release.items() if k != "assets"}))
    clone["assets"] = [
        {key: value for key, value in asset.items() if not key.startswith("_")}
        for asset in release.get("assets", [])
    ]
    return clone


class Scenario:
    """Stateful fake for both the GitHub REST reads and the `gh` mutations."""

    def __init__(self, release: dict | None = None, failures: dict[str, str] | None = None):
        self.release = release
        self.failures = failures or {}
        self.calls: list[list[str]] = []
        self.requests: list[str] = []
        self.next_asset_id = 900
        # GitHub does not always surface a freshly created draft in the tag or
        # list lookups; the by-id route always works.
        self.list_visibility = True
        # tag name -> commit sha, as GitHub's git refs API would report it.
        self.tags: dict[str, str] = {}
        # Simulate GitHub rewriting a release tag to untagged-<sha>.
        self.rewrite_tag = False

    # -- GitHub REST ------------------------------------------------------- #

    def __call__(self, request: urllib.request.Request) -> Response:
        url = request.full_url
        self.requests.append(url)
        mutation = self._mutate(request, request.get_method())
        if mutation is not None:
            return mutation
        if "/releases/tags/" in url:
            if self.release and self.list_visibility:
                return Response(200, public(self.release))
            return Response(404, {"message": "Not Found"})
        if "/releases/latest" in url:
            if self.release and not self.release.get("draft"):
                return Response(200, public(self.release))
            return Response(404, {"message": "Not Found"})
        if "/releases?" in url:
            if self.release and self.list_visibility:
                return Response(200, [public(self.release)])
            return Response(200, [])
        if re.search(r"/releases/\d+$", url):
            # A freshly created or mutated release is only reliably readable by id.
            wanted = int(url.rsplit("/", 1)[-1])
            if self.release and int(self.release["id"]) == wanted:
                return Response(200, public(self.release))
            return Response(404, {"message": "Not Found"})
        if "/git/matching-refs/tags/" in url:
            wanted = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            return Response(200, [
                {"ref": f"refs/tags/{name}", "object": {"type": "commit", "sha": sha}}
                for name, sha in self.tags.items() if name.startswith(wanted)
            ])
        if "/git/ref/tags/" in url:  # singular route: one ref, or 404
            name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            if name in self.tags:
                return Response(200, {
                    "ref": f"refs/tags/{name}",
                    "object": {"type": "commit", "sha": self.tags[name]},
                })
            return Response(404, {"message": "Not Found"})
        if "/releases/assets/" in url:
            asset_id = int(url.rsplit("/", 1)[-1])
            for asset in (self.release or {}).get("assets", []):
                if asset["id"] == asset_id:
                    return Response(200, asset["_bytes"])
            return Response(404, {"message": "Not Found"})
        raise AssertionError(f"unexpected GitHub request: {url}")

    def as_transport(self):
        def transport(_client, request):
            return self(request)

        return transport

    # -- release mutations -------------------------------------------------- #

    def _mutate(self, request: urllib.request.Request, method: str) -> Response | None:
        url = request.full_url
        if method == "POST" and url.startswith("https://uploads.github.com/"):
            name = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["name"][0]
            data = request.data
            payload = data.read() if hasattr(data, "read") else (data or b"")
            self.calls.append(["upload", name])
            if any(fragment in name for fragment in self.failures):
                raise publish_release.ImmutableRelease(self.failures[name])
            asset = {
                "id": self.next_asset_id,
                "name": name,
                "size": len(payload),
                "state": "uploaded",
                "digest": "sha256:" + sha256(payload),
                "browser_download_url": (
                    f"https://github.com/2archiver/YTArk/releases/download/"
                    f"{CONFIG['VERSION_TAG']}/{name}"
                ),
                "_bytes": payload,
            }
            self.release["assets"].append(asset)
            self.next_asset_id += 1
            return Response(201, {k: v for k, v in asset.items() if k != "_bytes"})
        if method == "POST" and url.endswith("/releases"):
            body = json.loads((request.data or b"{}").decode())
            self.calls.append(
                ["create", body["tag_name"]]
                + [f"--{key}={value}" for key, value in sorted(body.items())]
            )
            self.release = release_payload(
                draft=True, assets=[], body=body["body"], name=body["name"],
                tag="untagged-7b746ba5cc9cc9db7e5e" if self.rewrite_tag else body["tag_name"],
            )
            return Response(201, public(self.release))
        if method == "PATCH" and "/releases/" in url:
            body = json.loads((request.data or b"{}").decode())
            self.calls.append(
                ["edit"] + [f"--{key}={value}" for key, value in sorted(body.items())]
            )
            for key, value in body.items():
                if key == "make_latest":
                    continue
                self.release[key] = value
            return Response(200, public(self.release))
        if method == "POST" and url.endswith("/git/refs"):
            body = json.loads((request.data or b"{}").decode())
            name = body["ref"].removeprefix("refs/tags/")
            if name in self.tags:
                return Response(422, {"message": "Reference already exists"})
            self.tags[name] = body["sha"]
            self.calls.append(["create-tag", name, body["sha"]])
            return Response(
                201, {"ref": body["ref"], "object": {"type": "commit", "sha": body["sha"]}}
            )
        if method == "PATCH" and "/git/refs/tags/" in url:
            body = json.loads((request.data or b"{}").decode())
            name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            self.tags[name] = body["sha"]
            self.calls.append(["move-tag", name, body["sha"]])
            return Response(
                200, {"ref": f"refs/tags/{name}", "object": {"type": "commit", "sha": body["sha"]}}
            )
        if method == "DELETE" and "/releases/" in url:
            self.calls.append(["delete", url.rsplit("/", 1)[-1]])
            # GitHub removes a tag that the deleted release had created.
            if self.release:
                self.tags.pop(self.release.get("tag_name"), None)
            self.release = None
            return Response(204, b"")
        return None

    def uploads(self) -> list[list[str]]:
        return [call for call in self.calls if call[0] == "upload"]

    def called_with(self, fragment: str) -> bool:
        return any(fragment in " ".join(call) for call in self.calls)

def namespace(**values):
    return type("Args", (), values)


class PublishReleaseTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.factory = CandidateFactory(self.root)
        self.candidate = self.factory.candidate()
        # Render the real release notes/NOTICE into a scratch tree so the
        # repository checkout is never modified by a test.
        self.scratch = self.root / "scratch"
        (self.scratch / "tools").mkdir(parents=True)
        shutil.copyfile(
            ROOT / "tools" / "render_release_notes.sh",
            self.scratch / "tools" / "render_release_notes.sh",
        )
        (self.scratch / "signing").mkdir(parents=True)
        shutil.copyfile(
            ROOT / "signing" / "YTArk-cert-sha256.txt",
            self.scratch / "signing" / "YTArk-cert-sha256.txt",
        )
        (self.scratch / "release-assets").mkdir(parents=True)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def args(self, **overrides):
        values = {
            "repository": "2archiver/YTArk",
            "token": "test-token",
            "api_url": "https://api.github.com",
            "command": "publish",
            "commit": self.factory.commit,
            "run_id": self.factory.run_id,
            "candidate_dir": str(self.factory.aroot),
            "manifest": str(self.factory.manifest),
            "workdir": str(self.root / "publish-work"),
            "aapt": "aapt",
            "apksigner": "apksigner",
            "skip_static_checks": True,
            "device_test_notes": "",
        }
        values.update(overrides)
        return namespace(**values)

    def run_publish(self, release, *, scenario: Scenario | None = None, **overrides):
        scenario = scenario or Scenario(release)
        with patch.object(publish_release.GitHub, "_default_transport", scenario.as_transport()), \
             patch.object(publish_release, "ROOT", self.scratch), \
             patch.object(publish_release, "publish_script_tag", lambda candidate: None), \
             patch.dict(
                 os.environ,
                 {"GH_TOKEN": "test-token", "GITHUB_REPOSITORY": "2archiver/YTArk",
                  "GITHUB_STEP_SUMMARY": str(self.root / "summary.md")},
                 clear=False,
             ):
            result = publish_release.publish_command(self.args(**overrides))
        return result, scenario


class ReleaseStateTests(PublishReleaseTestCase):
    def test_absent_release_builds_and_creates(self):
        plan = publish_release.classify(None, CONFIG, head_sha=COMMIT)
        self.assertEqual(plan.state, "absent")
        self.assertEqual(plan.action, publish_release.ACTION_CREATE)
        self.assertTrue(plan.build_needed)

    def test_matching_draft_is_resumed_not_recreated(self):
        draft = release_payload(draft=True, body=identity_body(self.candidate))
        plan = publish_release.classify(
            draft, CONFIG, head_sha=COMMIT, candidate=self.candidate
        )
        self.assertEqual(plan.state, "draft-match")
        self.assertEqual(plan.action, publish_release.ACTION_RESUME)
        self.assertFalse(plan.build_needed)
        self.assertEqual(plan.missing, [])

    def test_incomplete_matching_draft_uploads_only_what_is_missing(self):
        draft = release_payload(
            draft=True, assets=[SCRIPT, SUMS, BASE_SUMS, NOTICE],
            body=identity_body(self.candidate),
        )
        plan = publish_release.classify(
            draft, CONFIG, head_sha=COMMIT, candidate=self.candidate
        )
        self.assertEqual(plan.action, publish_release.ACTION_RESUME)
        self.assertTrue(plan.build_needed)
        self.assertEqual(plan.missing, [APK])

    def test_draft_from_another_candidate_is_replaced(self):
        stale = identity_body(self.candidate).replace(COMMIT, "b" * 40)
        draft = release_payload(draft=True, body=stale)
        plan = publish_release.classify(
            draft, CONFIG, head_sha=COMMIT, candidate=self.candidate
        )
        self.assertEqual(plan.state, "draft-mismatch")
        self.assertEqual(plan.action, publish_release.ACTION_REPLACE_DRAFT)
        self.assertTrue(plan.build_needed)

    def test_complete_stable_release_is_a_no_op(self):
        published = release_payload(draft=False, body=identity_body(self.candidate))
        plan = publish_release.classify(
            published, CONFIG, head_sha=COMMIT, candidate=self.candidate
        )
        self.assertEqual(plan.state, "published-complete")
        self.assertEqual(plan.action, publish_release.ACTION_VERIFY_ONLY)
        self.assertFalse(plan.build_needed)

    def test_stable_release_missing_the_apk_is_repaired(self):
        published = release_payload(
            draft=False, assets=[SCRIPT, SUMS, BASE_SUMS, NOTICE],
            body=identity_body(self.candidate),
        )
        plan = publish_release.classify(
            published, CONFIG, head_sha=COMMIT, candidate=self.candidate
        )
        self.assertEqual(plan.state, "published-incomplete")
        self.assertEqual(plan.action, publish_release.ACTION_REPAIR)
        self.assertTrue(plan.build_needed)
        self.assertEqual(plan.missing, [APK])

    def test_conflicting_published_asset_blocks_publication(self):
        published = release_payload(
            draft=False, digests={APK: "b" * 64}, body=identity_body(self.candidate)
        )
        plan = publish_release.classify(
            published, CONFIG, head_sha=COMMIT, candidate=self.candidate
        )
        self.assertEqual(plan.state, "published-conflict")
        self.assertEqual(plan.action, publish_release.ACTION_FAIL)
        self.assertFalse(plan.build_needed)
        self.assertIn("never silently overwritten", plan.detail)

    def test_empty_published_release_does_not_suppress_repair(self):
        """An empty release must never look like 'already published'."""
        empty = release_payload(draft=False, assets=[])
        plan = publish_release.classify(empty, CONFIG, head_sha=COMMIT)
        self.assertEqual(plan.state, "published-incomplete")
        self.assertTrue(plan.build_needed)
        self.assertEqual(sorted(plan.missing), sorted(ALL_ASSETS))


class ApiFailureTests(unittest.TestCase):
    def test_rate_limit_is_not_treated_as_absent(self):
        def transport(request):
            return Response(403, {"message": "API rate limit exceeded"},
                           headers={"x-ratelimit-remaining": "0"})

        github = publish_release.GitHub(
            token="t", repository="2archiver/YTArk", transport=transport, retries=0
        )
        with self.assertRaises(publish_release.GitHubApiError) as caught:
            github.release_by_tag(CONFIG["VERSION_TAG"])
        self.assertEqual(caught.exception.status, 403)
        self.assertIn("rate limit", str(caught.exception))

    def test_server_error_is_not_treated_as_absent(self):
        github = publish_release.GitHub(
            token="t", repository="2archiver/YTArk",
            transport=lambda request: Response(500, b"boom"),
            retries=0, sleep=lambda _: None,
        )
        with self.assertRaises(publish_release.GitHubApiError):
            github.release_by_tag(CONFIG["VERSION_TAG"])

    def test_malformed_json_is_not_treated_as_absent(self):
        github = publish_release.GitHub(
            token="t", repository="2archiver/YTArk",
            transport=lambda request: Response(200, b"<html>not json</html>"),
            sleep=lambda _: None,
        )
        with self.assertRaises(publish_release.GitHubApiError) as caught:
            github.release_by_tag(CONFIG["VERSION_TAG"])
        self.assertIn("Malformed JSON", str(caught.exception))

    def test_network_failure_is_not_treated_as_absent(self):
        def boom(request):
            raise urllib.error.URLError("connection reset")

        github = publish_release.GitHub(
            token="t", repository="2archiver/YTArk", transport=boom,
            retries=0, sleep=lambda _: None,
        )
        with self.assertRaises(publish_release.GitHubApiError):
            github.release_by_tag(CONFIG["VERSION_TAG"])

    def test_confirmed_404_means_absent(self):
        def transport(request):
            if "/releases/tags/" in request.full_url:
                return Response(404, {"message": "Not Found"})
            return Response(200, [])

        github = publish_release.GitHub(
            token="t", repository="2archiver/YTArk", transport=transport, sleep=lambda _: None
        )
        self.assertIsNone(github.release_by_tag(CONFIG["VERSION_TAG"]))


class PublicationTests(PublishReleaseTestCase):
    def test_absent_release_is_staged_then_promoted(self):
        result, scenario = self.run_publish(None)
        self.assertEqual(result, 0)
        self.assertTrue(scenario.called_with(f"create {CONFIG['VERSION_TAG']}"))
        self.assertTrue(scenario.called_with("--draft=True"))
        self.assertTrue(scenario.called_with("--draft=False"))
        self.assertTrue(scenario.called_with("--prerelease=False"))
        self.assertTrue(scenario.called_with("--make_latest=true"))
        self.assertEqual(len(scenario.uploads()), len(ALL_ASSETS))
        for name in ALL_ASSETS:
            self.assertTrue(any(call[1] == name for call in scenario.uploads()), name)
        self.assertFalse(scenario.release["draft"])
        self.assertFalse(scenario.release["prerelease"])

    def test_matching_draft_is_promoted_without_recreating_it(self):
        draft = release_payload(draft=True, body=identity_body(self.candidate))
        result, scenario = self.run_publish(draft)
        self.assertEqual(result, 0)
        self.assertFalse(scenario.called_with("create"))
        self.assertFalse(scenario.called_with("delete"))
        self.assertEqual(scenario.uploads(), [])
        self.assertTrue(scenario.called_with("--draft=False"))
        self.assertFalse(scenario.release["draft"])

    def test_complete_stable_release_changes_nothing(self):
        published = release_payload(draft=False, body=identity_body(self.candidate))
        result, scenario = self.run_publish(published)
        self.assertEqual(result, 0)
        self.assertEqual(scenario.calls, [])

    def test_stable_release_missing_apk_is_repaired_from_the_candidate(self):
        published = release_payload(
            draft=False, assets=[SCRIPT, SUMS, BASE_SUMS, NOTICE],
            body=identity_body(self.candidate),
        )
        result, scenario = self.run_publish(published)
        self.assertEqual(result, 0)
        self.assertFalse(scenario.called_with("create"))
        uploads = scenario.uploads()
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0][1], APK)

    def test_conflicting_published_asset_is_refused(self):
        published = release_payload(
            draft=False, digests={APK: "b" * 64}, body=identity_body(self.candidate)
        )
        with self.assertRaises(publish_release.ReleaseConflict):
            self.run_publish(published)

    def test_conflicting_asset_is_never_overwritten_even_when_others_are_missing(self):
        published = release_payload(
            draft=False, assets=[APK], digests={APK: "b" * 64},
            body=identity_body(self.candidate),
        )
        with self.assertRaises(publish_release.ReleaseConflict):
            self.run_publish(published)

    def test_stale_draft_is_replaced_and_the_replacement_is_recorded(self):
        stale = identity_body(self.candidate).replace(COMMIT, "b" * 40)
        draft = release_payload(draft=True, body=stale)
        result, scenario = self.run_publish(draft)
        self.assertEqual(result, 0)
        self.assertTrue(scenario.called_with("delete"))
        self.assertTrue(scenario.called_with(f"create {CONFIG['VERSION_TAG']}"))
        summary = (self.root / "summary.md").read_text(encoding="utf-8")
        self.assertIn("Replacing an unpublished draft", summary)

    def test_published_release_with_foreign_notes_is_not_rewritten(self):
        published = release_payload(draft=False, body="stale body without identity")
        with self.assertRaises(publish_release.ReleaseError):
            self.run_publish(published)

    def test_immutable_release_upload_is_reported_with_the_next_patch_version(self):
        scenario = Scenario(None, failures={APK: "asset upload refused"})
        with self.assertRaises(publish_release.ImmutableRelease) as caught:
            self.run_publish(None, scenario=scenario)
        self.assertIn("asset upload refused", str(caught.exception))
        version, code = publish_release.next_patch_version(CONFIG)
        self.assertEqual((version, code), ("2.2.1", 2020100))

    def test_repair_refuses_a_rebuild_that_disagrees_with_published_checksums(self):
        published = release_payload(
            draft=False, assets=[SCRIPT, SUMS, BASE_SUMS, NOTICE],
            body=identity_body(self.candidate),
        )
        rebuilt = CandidateFactory(self.root / "rebuild", run_id="999", apk_bytes=REBUILD_BYTES)
        with self.assertRaises(publish_release.ReleaseConflict) as caught:
            self.run_publish(
                published, candidate_dir=str(rebuilt.aroot),
                manifest=str(rebuilt.manifest), run_id=rebuilt.run_id,
            )
        self.assertIn("next patch version", str(caught.exception))
        self.assertIn("2020100", str(caught.exception))

    def test_repair_guard_rejects_bytes_the_published_checksums_refuse(self):
        """The published checksum file decides whether a rebuild may repair an APK."""
        published = release_payload(draft=False, assets=[SUMS])
        rebuilt = CandidateFactory(self.root / "rebuild2", run_id="998", apk_bytes=REBUILD_BYTES)
        github = publish_release.GitHub(
            token="t", repository="2archiver/YTArk", transport=Scenario(published),
            sleep=lambda _: None,
        )
        with self.assertRaises(publish_release.ReleaseConflict) as caught:
            publish_release.check_repair_compatibility(
                published, rebuilt.candidate(), github, workdir=self.root / "repair-work"
            )
        self.assertIn("next patch version", str(caught.exception))
        self.assertIn(sha256(APK_BYTES), str(caught.exception))

    def test_publication_requires_the_trusted_repository(self):
        with self.assertRaises(publish_release.ReleaseError):
            self.run_publish(None, repository="evil/YTArk")

    def test_a_freshly_created_draft_is_read_back_by_id(self):
        """A draft that the tag/list lookups miss must still be published."""
        scenario = Scenario(None)
        scenario.list_visibility = False
        result, scenario = self.run_publish(None, scenario=scenario)
        self.assertEqual(result, 0)
        self.assertFalse(scenario.release["draft"])
        self.assertEqual(len(scenario.release["assets"]), len(ALL_ASSETS))

    def test_the_release_tag_is_created_before_the_release(self):
        result, scenario = self.run_publish(None)
        self.assertEqual(result, 0)
        self.assertEqual(scenario.tags.get(CONFIG["VERSION_TAG"]), COMMIT)
        self.assertTrue(scenario.called_with("create-tag"))

    def test_a_rewritten_tag_is_rejected_and_the_draft_is_discarded(self):
        """GitHub silently renames a release to untagged-<sha>; that must fail."""
        scenario = Scenario(None)
        scenario.rewrite_tag = True
        with self.assertRaises(publish_release.ReleaseError) as raised:
            self.run_publish(None, scenario=scenario)
        self.assertIn("untagged-7b746ba5cc9cc9db7e5e", str(raised.exception))
        # The unusable draft is deleted so the next run starts from scratch.
        self.assertIsNone(scenario.release)

    def test_a_stray_untagged_draft_is_recovered_and_replaced(self):
        """A draft no tag lookup can find must still be replaced, not duplicated."""
        stray = release_payload(tag="untagged-7b746ba5cc9cc9db7e5e", draft=True)
        result, scenario = self.run_publish(stray)
        self.assertEqual(result, 0)
        self.assertFalse(scenario.release["draft"])
        self.assertEqual(scenario.release["tag_name"], CONFIG["VERSION_TAG"])

    def test_assets_are_uploaded_by_release_id_not_by_tag(self):
        """Drafts 404 on /releases/tags/{tag}, so uploads must use the release id."""
        _, scenario = self.run_publish(None)
        uploads = [url for url in scenario.requests if "uploads.github.com" in url]
        self.assertEqual(len(uploads), len(ALL_ASSETS))
        for url in uploads:
            self.assertIn("/releases/409000001/assets", url)
            self.assertNotIn("/releases/tags/", url)

    def test_summary_only_links_the_apk_after_public_verification(self):
        self.run_publish(None)
        summary = (self.root / "summary.md").read_text(encoding="utf-8")
        self.assertIn(f"/releases/download/{CONFIG['VERSION_TAG']}/{APK}", summary)
        self.assertIn("draft=false", summary)
        self.assertIn("not device tests", summary)


class ScriptBindingTests(unittest.TestCase):
    def test_apk_must_reference_the_immutable_script_tag(self):
        with tempfile.TemporaryDirectory() as temp:
            apk = Path(temp) / "candidate.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr(
                    "assets/userScript.js",
                    b'const url = "' + publish_release.script_url(CONFIG).encode() + b'";',
                )
            publish_release.verify_script_binding(apk, publish_release.script_url(CONFIG))

            wrong = Path(temp) / "wrong.apk"
            with zipfile.ZipFile(wrong, "w") as archive:
                archive.writestr("assets/userScript.js", b"https://example.invalid/script.js")
            with self.assertRaises(publish_release.ReleaseError):
                publish_release.verify_script_binding(wrong, publish_release.script_url(CONFIG))


class ManifestTests(unittest.TestCase):
    def test_manifest_round_trip_and_identity_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            factory = CandidateFactory(Path(temp))
            candidate = factory.candidate()
            self.assertEqual(candidate.apk.sha256, sha256(APK_BYTES))
            self.assertEqual(candidate.identity()["commit"], COMMIT)
            self.assertTrue(candidate.identity_matches(candidate.identity()))
            forged = dict(candidate.identity(), apk_sha256="c" * 64)
            self.assertFalse(candidate.identity_matches(forged))

    def test_manifest_rejects_another_run_commit_or_repository(self):
        with tempfile.TemporaryDirectory() as temp:
            factory = CandidateFactory(Path(temp))
            with self.assertRaises(publish_release.ReleaseError):
                publish_release.load_candidate(
                    factory.manifest, candidate_dir=factory.aroot,
                    commit="d" * 40, run_id=RUN_ID, repository="2archiver/YTArk",
                )
            with self.assertRaises(publish_release.ReleaseError):
                publish_release.load_candidate(
                    factory.manifest, candidate_dir=factory.aroot,
                    commit=COMMIT, run_id="1", repository="2archiver/YTArk",
                )
            with self.assertRaises(publish_release.ReleaseError):
                publish_release.load_candidate(
                    factory.manifest, candidate_dir=factory.aroot,
                    commit=COMMIT, run_id=RUN_ID, repository="other/YTArk",
                )
            with self.assertRaises(publish_release.ReleaseError):
                publish_release.load_candidate(
                    factory.manifest, candidate_dir=factory.aroot / "missing",
                    commit=COMMIT, run_id=RUN_ID, repository="2archiver/YTArk",
                )

    def test_manifest_fails_loudly_when_the_artefact_layout_moves(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(publish_release.ReleaseError) as caught:
                publish_release.write_manifest(
                    root / "candidate-manifest.json", candidate_dir=root,
                    commit=COMMIT, run_id=RUN_ID, repository="2archiver/YTArk",
                )
            self.assertIn("missing from", str(caught.exception))


class ReleaseNotesTests(unittest.TestCase):
    def test_identity_marker_round_trip(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            scratch = root / "scratch"
            (scratch / "tools").mkdir(parents=True)
            shutil.copyfile(
                ROOT / "tools" / "render_release_notes.sh",
                scratch / "tools" / "render_release_notes.sh",
            )
            (scratch / "release-assets").mkdir(parents=True)
            (scratch / "release-assets" / APK).write_bytes(APK_BYTES)
            factory = CandidateFactory(root)
            candidate = factory.candidate()
            with patch.object(publish_release, "ROOT", scratch), patch.dict(
                os.environ, {"GH_TOKEN": "t", "GITHUB_REPOSITORY": "2archiver/YTArk"}, clear=False
            ):
                notes = publish_release.render_notes(CONFIG, COMMIT, "f" * 64)
                marked = publish_release.with_identity(notes, candidate, scratch / "notes.md")
                body = marked.read_text(encoding="utf-8")
                parsed = publish_release.parse_identity({"body": body})
            self.assertEqual(parsed["apk_sha256"], sha256(APK_BYTES))
            self.assertTrue(candidate.identity_matches(parsed))
            # The rendered notes satisfy the release contract with the marker added.
            validate_release.verify_release_record(
                release_payload(draft=True, body=body), "draft"
            )


if __name__ == "__main__":
    unittest.main()
