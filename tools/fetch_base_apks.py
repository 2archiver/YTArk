#!/usr/bin/env python3
"""Download and verify the pinned ARM64 TizenTubeCobalt base APK."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from pathlib import Path

import validate_release


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "YTArk-release-builder"})
    with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-json", required=True)
    parser.add_argument("--base-tag", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--checksums-out", required=True)
    args = parser.parse_args()

    try:
        release = json.loads(Path(args.release_json).read_text(encoding="utf-8"))
        if release.get("tag_name") != args.base_tag or release.get("draft") or release.get("prerelease"):
            raise ValueError("The upstream base metadata does not match the pinned stable tag")
        assets = {asset.get("name"): asset for asset in release.get("assets", [])}
        directory = Path(args.output_dir)
        directory.mkdir(parents=True, exist_ok=True)
        checksums = []
        for asset_name in ("cobalt-arm64.apk",):
            asset = assets.get(asset_name)
            if not asset:
                raise ValueError(f"Pinned upstream release is missing {asset_name}")
            expected_url = f"https://github.com/reisxd/TizenTubeCobalt/releases/download/{args.base_tag}/{asset_name}"
            if asset.get("browser_download_url") != expected_url:
                raise ValueError(f"Untrusted upstream download URL for {asset_name}")
            destination = directory / asset_name
            download(expected_url, destination)
            if destination.stat().st_size != int(asset.get("size", -1)):
                raise ValueError(f"Downloaded {asset_name} size does not match GitHub release metadata")
            actual_digest = sha256(destination)
            raw_digest = asset.get("digest", "")
            expected_digest = validate_release.parse_sha256_digest(raw_digest)
            if raw_digest and not expected_digest:
                raise ValueError(f"GitHub returned an invalid SHA-256 digest for {asset_name}")
            if expected_digest and actual_digest != expected_digest:
                raise ValueError(f"Downloaded {asset_name} failed GitHub's SHA-256 digest check")
            checksums.append(f"{actual_digest}  {asset_name}")
            print(f"Verified upstream asset {asset_name} ({destination.stat().st_size} bytes, SHA-256 {actual_digest}).")

        Path(args.checksums_out).write_text("\n".join(checksums) + "\n", encoding="utf-8")
    except (OSError, ValueError, KeyError) as error:
        print(f"Upstream base verification failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
