#!/usr/bin/env python3
"""Download and validate the pinned ARMv7 and ARM64 TizenTubeCobalt APK bases."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

import validate_release

UPSTREAM_REPOSITORY = "reisxd/TizenTubeCobalt"
BASE_ASSETS = {
    "armv7": {
        "filename": "cobalt-arm.apk",
        "abi": "armeabi-v7a",
        "library": "lib/armeabi-v7a/libchrobalt.so",
        "size": 97_195_140,
        "sha256": "ff90c6e85c37246b809cca80282910509782c1384eccfbb6066da3b497dd9fd2",
    },
    "arm64": {
        "filename": "cobalt-arm64.apk",
        "abi": "arm64-v8a",
        "library": "lib/arm64-v8a/libchrobalt.so",
        "size": 168_173_905,
        "sha256": "0e8a9cffc77a08cd116d38e262c3e9d7f261ba2093b5b2d2ef905f509c99133c",
    },
}


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "YTArk-release-builder"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_release_asset(release: dict, base_tag: str, architecture: str) -> dict:
    if architecture not in BASE_ASSETS:
        raise ValueError(f"Unsupported base architecture: {architecture}")
    if release.get("tag_name") != base_tag or release.get("draft") or release.get("prerelease"):
        raise ValueError("The upstream base metadata does not match the pinned stable tag")
    spec = BASE_ASSETS[architecture]
    found = [asset for asset in release.get("assets", []) if asset.get("name") == spec["filename"]]
    if len(found) != 1:
        raise ValueError(f"Pinned upstream release must contain exactly one {spec['filename']}")
    asset = found[0]
    expected_url = (
        f"https://github.com/{UPSTREAM_REPOSITORY}/releases/download/{base_tag}/{spec['filename']}"
    )
    if asset.get("browser_download_url") != expected_url:
        raise ValueError(f"Untrusted upstream download URL for {spec['filename']}")
    size = int(asset.get("size", -1))
    if size != spec["size"]:
        raise ValueError(
            f"Pinned upstream size changed for {spec['filename']}: "
            f"expected {spec['size']}, got {size}"
        )
    raw_digest = asset.get("digest", "")
    metadata_digest = validate_release.parse_sha256_digest(raw_digest)
    if metadata_digest != spec["sha256"]:
        raise ValueError(
            f"Pinned upstream SHA-256 changed or is missing for {spec['filename']}: "
            f"expected {spec['sha256']}, got {metadata_digest or 'invalid/missing'}"
        )
    return {**asset, "expected_url": expected_url, "expected_digest": spec["sha256"], **spec}


def verify_base_native_abi(path: Path, architecture: str) -> None:
    spec = BASE_ASSETS.get(architecture)
    if not spec:
        raise ValueError(f"Unsupported base architecture: {architecture}")
    if not zipfile.is_zipfile(path):
        raise ValueError(f"Upstream asset is not a valid APK/ZIP archive: {path.name}")
    with zipfile.ZipFile(path) as apk:
        names = apk.namelist()
        library = apk.getinfo(spec["library"]) if spec["library"] in names else None
        if library is None or library.file_size <= 0:
            raise ValueError(
                f"{path.name} does not contain the required {spec['abi']} Cobalt library "
                f"{spec['library']}"
            )
        wrong_cobalt_libraries = [
            name for name in names
            if name.startswith("lib/") and name.endswith("/libchrobalt.so")
            and name != spec["library"]
        ]
        if wrong_cobalt_libraries:
            raise ValueError(
                f"{path.name} contains Cobalt libraries for unexpected ABIs: "
                + ", ".join(wrong_cobalt_libraries)
            )
        dex_files = [name for name in names if name.startswith("classes") and name.endswith(".dex")]
        if not dex_files:
            raise ValueError(f"{path.name} has no DEX files")


def fetch_one(release: dict, base_tag: str, architecture: str, output_dir: Path) -> tuple[Path, str]:
    metadata = validate_release_asset(release, base_tag, architecture)
    destination = output_dir / metadata["filename"]
    download(metadata["expected_url"], destination)
    if destination.stat().st_size != int(metadata["size"]):
        destination.unlink(missing_ok=True)
        raise ValueError(f"Downloaded {metadata['filename']} size does not match GitHub release metadata")
    actual_digest = sha256(destination)
    expected_digest = metadata["expected_digest"]
    if expected_digest and actual_digest != expected_digest:
        destination.unlink(missing_ok=True)
        raise ValueError(f"Downloaded {metadata['filename']} failed GitHub's SHA-256 digest check")
    verify_base_native_abi(destination, architecture)
    print(
        f"Verified upstream {architecture} asset {metadata['filename']} "
        f"({destination.stat().st_size} bytes, {metadata['abi']}, SHA-256 {actual_digest})."
    )
    return destination, actual_digest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-json", required=True)
    parser.add_argument("--base-tag", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--checksums-out", required=True)
    args = parser.parse_args()

    try:
        release = json.loads(Path(args.release_json).read_text(encoding="utf-8"))
        directory = Path(args.output_dir)
        directory.mkdir(parents=True, exist_ok=True)
        checksums = []
        for architecture in ("armv7", "arm64"):
            _path, digest = fetch_one(release, args.base_tag, architecture, directory)
            checksums.append(f"{digest}  {BASE_ASSETS[architecture]['filename']}")
        Path(args.checksums_out).write_text("\n".join(checksums) + "\n", encoding="utf-8")
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(f"Upstream base verification failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
