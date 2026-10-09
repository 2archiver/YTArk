#!/usr/bin/env python3
"""Prepare an ARM64 install-over-update smoke test when a prior YTArk release exists."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

import validate_release


def output(message: str) -> None:
    print(message)


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "YTArk-release-validation"})
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latest-json", required=True)
    parser.add_argument("--artifact-dir", required=True)
    parser.add_argument("--output", required=True, help="GitHub Actions GITHUB_OUTPUT path")
    parser.add_argument("--cert-file", required=True)
    parser.add_argument("--aapt", default="aapt")
    parser.add_argument("--apksigner", default="apksigner")
    args = parser.parse_args()

    try:
        latest = json.loads(Path(args.latest_json).read_text(encoding="utf-8"))
        if latest.get("message") == "Not Found":
            Path(args.output).write_text("eligible=false\n", encoding="utf-8")
            output("No prior stable release; install-over-update smoke test is not applicable.")
            return
        if latest.get("draft") or latest.get("prerelease"):
            raise ValueError("The previous release metadata is not a published stable release")

        config = validate_release.load_config()
        body = latest.get("body", "") or ""
        app_match = re.search(r"(?:App ID|Android package)\s*(?:\||:)\s*`([^`]+)`", body, re.I)
        if not app_match:
            raise ValueError("The previous release is missing its app ID metadata")
        previous_app_id = app_match.group(1)
        if previous_app_id != validate_release.APP_ID:
            Path(args.output).write_text("eligible=false\n", encoding="utf-8")
            output("The previous stable release uses a different application ID; install-over-update smoke test is not applicable to this initial YTArk package migration.")
            return

        assets = {asset.get("name"): asset for asset in latest.get("assets", [])}
        apk_candidates = [asset for name, asset in assets.items()
                          if name and name.endswith("-arm64.apk") and name.startswith("YTArk-v")]
        if len(apk_candidates) != 1:
            raise ValueError("The previous YTArk stable release must contain exactly one ARM64 APK")
        asset = apk_candidates[0]
        url = asset.get("browser_download_url", "")
        tag = latest.get("tag_name", "")
        expected_url_prefix = f"https://github.com/2archiver/YTArk/releases/download/{tag}/"
        if not url.startswith(expected_url_prefix):
            raise ValueError("The previous ARM64 APK URL is not from the official YTArk release")

        directory = Path(args.artifact_dir)
        directory.mkdir(parents=True, exist_ok=True)
        previous_apk = directory / "previous-production-arm64.apk"
        download(url, previous_apk)

        if asset.get("size") and previous_apk.stat().st_size != int(asset["size"]):
            raise ValueError("The previous production APK download is incomplete")
        raw_digest = asset.get("digest", "")
        digest = validate_release.parse_sha256_digest(raw_digest)
        if raw_digest and not digest:
            raise ValueError("The previous ARM64 APK has an invalid GitHub SHA-256 digest")
        if not digest:
            checksum_asset = assets.get("SHA256SUMS.txt")
            if not checksum_asset:
                raise ValueError("The previous stable release has no APK SHA-256 metadata")
            checksum_path = directory / "previous-SHA256SUMS.txt"
            download(checksum_asset.get("browser_download_url", ""), checksum_path)
            for line in checksum_path.read_text(encoding="utf-8").splitlines():
                fields = line.strip().split(None, 1)
                if len(fields) == 2 and fields[1].strip().lstrip("*") == asset["name"]:
                    digest = validate_release.parse_sha256_digest(fields[0])
                    break
        if not digest:
            raise ValueError("Could not find a valid SHA-256 checksum for the previous APK")
        sha = hashlib.sha256()
        with previous_apk.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                sha.update(block)
        if sha.hexdigest() != digest:
            raise ValueError("The previous APK failed its published SHA-256 check")

        badging = subprocess.check_output(
            [args.aapt, "dump", "badging", str(previous_apk)], text=True,
            stderr=subprocess.STDOUT)
        package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'", badging, re.M)
        if not package or package.group(1) != validate_release.APP_ID:
            raise ValueError("The previous APK package ID is not YTArk's production package ID")
        if "native-code: 'arm64-v8a'" not in badging:
            raise ValueError("The previous production APK is not an ARM64 build")
        with zipfile.ZipFile(previous_apk) as archive:
            if "lib/arm64-v8a/libchrobalt.so" not in archive.namelist():
                raise ValueError("The previous production APK has no ARM64 Cobalt library")
        cert_output = subprocess.check_output(
            [args.apksigner, "verify", "--print-certs", str(previous_apk)], text=True,
            stderr=subprocess.STDOUT)
        cert_match = re.search(r"certificate SHA-256 digest:\s*([0-9a-fA-F:]+)", cert_output, re.I)
        if not cert_match:
            raise ValueError("Could not read the previous APK signing certificate")
        actual_cert = re.sub(r"[^0-9a-fA-F]", "", cert_match.group(1)).lower()
        if actual_cert != validate_release.read_expected_fingerprint(args.cert_file):
            raise ValueError("The previous YTArk APK is not signed by the permanent release certificate")

        current_code = int(config["VERSION_CODE"])
        previous_code = int(package.group(2))
        if latest.get("tag_name") == config["VERSION_TAG"]:
            if previous_code > current_code:
                raise ValueError("The new versionCode must not be lower than the current release versionCode")
        elif previous_code >= current_code:
            raise ValueError("The new versionCode must exceed the previous production versionCode")
        output(f"Verified previous production APK {asset['name']} ({previous_code}); update install smoke test is enabled.")
        with open(args.output, "a", encoding="utf-8") as result:
            result.write("eligible=true\n")
            result.write(f"previous_apk={previous_apk}\n")
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Update smoke preparation failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
