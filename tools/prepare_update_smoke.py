#!/usr/bin/env python3
"""Prepare a same-ABI prior-release candidate for static install/update checks."""

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

RELEASE_PREFIX = "https://github.com/2archiver/YTArk/releases/download/"
ARCHITECTURES = {
    "armv7": {"abi": "armeabi-v7a", "suffix": "armv7"},
    "arm64": {"abi": "arm64-v8a", "suffix": "arm64"},
}


def output(message: str) -> None:
    print(message)


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "YTArk-release-validation"})
    with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_ineligible(output_path: str, architecture: str, message: str) -> None:
    with open(output_path, "a", encoding="utf-8") as result:
        result.write(f"eligible_{architecture}=false\n")
    output(message)


def official_asset_url(tag: str, name: str, url: str) -> str:
    expected = RELEASE_PREFIX + tag + "/" + name
    if url != expected:
        raise ValueError(f"Prior APK URL is not the exact official YTArk release asset: {url}")
    return expected


def native_abi_from_apk(apk: Path, architecture: str) -> None:
    expected_abi = ARCHITECTURES[architecture]["abi"]
    expected_library = f"lib/{expected_abi}/libchrobalt.so"
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if expected_library not in names or archive.getinfo(expected_library).file_size <= 0:
            raise ValueError(f"Prior APK is missing its {expected_abi} Cobalt library")
        abis = {
            name.split("/")[1] for name in names
            if name.startswith("lib/") and name.endswith(".so") and len(name.split("/")) >= 3
        }
        if abis != {expected_abi}:
            raise ValueError(f"Prior APK contains wrong native ABI directories: {sorted(abis)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latest-json", required=True)
    parser.add_argument("--architecture", choices=tuple(ARCHITECTURES), required=True)
    parser.add_argument("--artifact-dir", required=True)
    parser.add_argument("--output", required=True, help="GitHub Actions GITHUB_OUTPUT path")
    parser.add_argument("--cert-file", required=True)
    parser.add_argument("--aapt", default="aapt")
    parser.add_argument("--apksigner", default="apksigner")
    args = parser.parse_args()
    architecture = args.architecture

    try:
        latest = json.loads(Path(args.latest_json).read_text(encoding="utf-8"))
        if latest.get("message") == "Not Found":
            write_ineligible(args.output, architecture, "No previous stable release; same-ABI update smoke is not applicable.")
            return
        if latest.get("draft") or latest.get("prerelease"):
            raise ValueError("The previous release metadata is not a published stable release")

        config = validate_release.load_config()
        body = latest.get("body", "") or ""
        app_match = re.search(r"(?:App ID|Android package)\s*(?:\||:)\s*`([^`]+)`", body, re.I)
        if not app_match:
            raise ValueError("The previous release is missing its app ID metadata")
        if app_match.group(1) != validate_release.APP_ID:
            write_ineligible(args.output, architecture, "The previous stable release uses another package ID; update validation is not applicable.")
            return

        tag = latest.get("tag_name", "")
        if not re.fullmatch(r"v\d+\.\d+\.\d+-ytark\.[1-9]\d*", tag):
            raise ValueError("The previous YTArk release tag is invalid")
        assets = latest.get("assets", [])
        expected_suffix = "-" + ARCHITECTURES[architecture]["suffix"] + ".apk"
        candidates = [asset for asset in assets
                      if str(asset.get("name", "")).startswith("YTArk-v")
                      and str(asset.get("name", "")).endswith(expected_suffix)]
        if not candidates:
            write_ineligible(
                args.output,
                architecture,
                f"No prior {architecture} YTArk APK exists. A 64-bit-only history cannot validate ARMv7 upgrades; test ARMv7 with a clean install first.",
            )
            return
        if len(candidates) != 1:
            raise ValueError(f"The previous stable release has multiple {architecture} APK candidates")

        asset = candidates[0]
        asset_name = asset.get("name", "")
        version_match = re.fullmatch(
            rf"YTArk-v(\d+\.\d+\.\d+-ytark\.[1-9]\d*){re.escape(expected_suffix)}", asset_name
        )
        if not version_match or "v" + version_match.group(1) != tag:
            raise ValueError("The prior APK filename does not match its release tag/version")
        version = version_match.group(1)
        previous_code = validate_release.parse_release_version_code(body)
        if previous_code is None or previous_code != 20000 + int(version.rsplit(".", 1)[1]):
            raise ValueError("The previous release notes versionCode does not match the version serial")

        url = official_asset_url(tag, asset_name, asset.get("browser_download_url", ""))
        directory = Path(args.artifact_dir)
        directory.mkdir(parents=True, exist_ok=True)
        previous_apk = directory / f"previous-production-{architecture}.apk"
        download(url, previous_apk)

        size = int(asset.get("size", 0))
        if size <= 0 or previous_apk.stat().st_size != size:
            raise ValueError("The previous production APK download is incomplete or has invalid size metadata")
        raw_digest = asset.get("digest", "")
        digest = validate_release.parse_sha256_digest(raw_digest)
        if raw_digest and not digest:
            raise ValueError("The previous APK has an invalid GitHub SHA-256 digest")
        if not digest:
            checksum_assets = [item for item in assets if item.get("name") == "SHA256SUMS.txt"]
            if len(checksum_assets) != 1:
                raise ValueError("The previous stable release needs exactly one SHA256SUMS.txt asset")
            checksum_asset = checksum_assets[0]
            checksum_url = official_asset_url(tag, "SHA256SUMS.txt", checksum_asset.get("browser_download_url", ""))
            checksum_path = directory / f"previous-SHA256SUMS-{architecture}.txt"
            download(checksum_url, checksum_path)
            digest = validate_release.parse_checksum_file(str(checksum_path)).get(asset_name)
        if not digest or file_sha256(previous_apk) != digest:
            raise ValueError("The previous production APK failed its published SHA-256 check")

        badging = subprocess.check_output(
            [args.aapt, "dump", "badging", str(previous_apk)], text=True,
            stderr=subprocess.STDOUT)
        package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'", badging, re.M)
        expected_abi = ARCHITECTURES[architecture]["abi"]
        native_line = re.search(r"^native-code:(.*)$", badging, re.M)
        reported_abis = re.findall(r"'([^']+)'", native_line.group(1)) if native_line else []
        if not package or package.group(1) != validate_release.APP_ID:
            raise ValueError("The previous APK package ID is not YTArk's production package ID")
        if reported_abis != [expected_abi]:
            raise ValueError(f"The previous APK does not report the selected {expected_abi} ABI")
        native_abi_from_apk(previous_apk, architecture)

        cert_output = subprocess.check_output(
            [args.apksigner, "verify", "--print-certs", str(previous_apk)], text=True,
            stderr=subprocess.STDOUT)
        cert_match = re.search(r"certificate SHA-256 digest:\s*([0-9a-fA-F:]+)", cert_output, re.I)
        if not cert_match:
            raise ValueError("Could not read the previous APK signing certificate")
        actual_cert = re.sub(r"[^0-9a-fA-F]", "", cert_match.group(1)).lower()
        if actual_cert != validate_release.read_expected_fingerprint(args.cert_file):
            raise ValueError("The previous YTArk APK is not signed by the permanent release certificate")

        previous_code = int(package.group(2))
        current_code = int(config["VERSION_CODE"])
        if latest.get("tag_name") == config["VERSION_TAG"]:
            if previous_code > current_code:
                raise ValueError("The current release versionCode must not be lower than the existing asset")
        elif previous_code >= current_code:
            raise ValueError("The new versionCode must exceed the previous same-ABI production APK")
        with open(args.output, "a", encoding="utf-8") as result:
            result.write(f"eligible_{architecture}=true\n")
            result.write(f"previous_apk_{architecture}={previous_apk}\n")
        output(f"Verified prior {architecture} production APK {asset_name} ({previous_code}); static package comparison is available.")
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Update smoke preparation failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
