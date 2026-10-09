#!/usr/bin/env python3
"""Release-contract checks for YTArk APKs and GitHub Releases."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "release" / "version.properties"
APP_ID = "io.github.twoarchiver.ytark"
APP_NAME = "YTArk"
VERSION_PATTERN = re.compile(r"^(?P<major>\d+\.\d+\.\d+)-ytark\.(?P<serial>\d+)$")
APK_DESCRIPTOR = b"io/github/twoarchiver/ytark/updater/UpdateBootstrapProvider"
ANDROID_14_API = 34


def load_config() -> dict[str, str]:
    properties: dict[str, str] = {}
    for raw in VERSION_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Malformed version configuration: {line}")
        key, value = line.split("=", 1)
        properties[key.strip()] = value.strip()

    version = properties.get("versionName", "")
    match = VERSION_PATTERN.fullmatch(version)
    if not match:
        raise ValueError("versionName must use the required <semver>-ytark.<serial> format")
    serial = int(match.group("serial"))
    if serial <= 0:
        raise ValueError("The YTArk release serial must be positive")
    version_code = 20000 + serial
    if version_code > 2_100_000_000:
        raise ValueError("The derived Android versionCode exceeds the platform limit")

    base_tag = properties.get("baseTag", "")
    if not re.fullmatch(r"v\d+\.\d+\.\d+", base_tag):
        raise ValueError("baseTag must be a pinned upstream tag such as v2.0.2")
    script_tag = f"s{serial}"
    if len(script_tag) > 8:
        raise ValueError("The userscript tag exceeds the byte-length budget in the base APK")

    return {
        "VERSION_NAME": version,
        "VERSION_CODE": str(version_code),
        "VERSION_TAG": f"v{version}",
        "APK_ARM64": f"YTArk-v{version}-arm64.apk",
        "SCRIPT_TAG": script_tag,
        "BASE_TAG": base_tag,
        "APP_ID": APP_ID,
        "APP_NAME": APP_NAME,
    }


def emit_env(path: str) -> None:
    config = load_config()
    with open(path, "a", encoding="utf-8") as output:
        for key, value in config.items():
            if "\n" in value or "\r" in value:
                raise ValueError(f"Unsafe line break in {key}")
            output.write(f"{key}={value}\n")
    print("Release environment loaded:", config["VERSION_NAME"], config["VERSION_CODE"])


def parse_release_version_code(body: str) -> int | None:
    match = re.search(r"(?i)version\s*code\s*[:=]?\s*(\d+)", body or "")
    return int(match.group(1)) if match else None


def check_version(latest_path: str) -> None:
    config = load_config()
    current = int(config["VERSION_CODE"])
    latest = json.loads(Path(latest_path).read_text(encoding="utf-8"))
    if latest.get("message") == "Not Found":
        print("No previous published release; versionCode seed is accepted.")
        return
    if latest.get("draft") or latest.get("prerelease"):
        raise ValueError("The version comparison input is not a published stable release")
    previous = parse_release_version_code(latest.get("body", ""))
    if previous is None:
        raise ValueError("The previous stable release is missing its versionCode metadata")
    if latest.get("tag_name") == config["VERSION_TAG"] and current == previous:
        print(f"Rebuilding current release {config['VERSION_TAG']} (versionCode {current}).")
        return
    if current <= previous:
        raise ValueError(f"versionCode must increase: new {current}, published {previous}")
    if latest.get("tag_name") == config["VERSION_TAG"]:
        raise ValueError("This version tag has already been published")
    print(f"versionCode increment verified: {previous} -> {current}")


def parse_sha256_digest(value: object) -> str | None:
    """Normalize GitHub's ``sha256:<hex>`` field or a bare checksum."""
    if not isinstance(value, str):
        return None
    digest = value.strip().lower()
    if digest.startswith("sha256:"):
        digest = digest[len("sha256:"):]
    return digest if re.fullmatch(r"[0-9a-f]{64}", digest) else None


def read_expected_fingerprint(path: str) -> str:
    values = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            values.append(line)
    if len(values) != 1:
        raise ValueError("Expected one public certificate SHA-256 fingerprint")
    fingerprint = re.sub(r"[^0-9a-fA-F]", "", values[0]).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
        raise ValueError("The public certificate fingerprint is invalid or not initialized")
    return fingerprint


def run(command: list[str]) -> str:
    return subprocess.check_output(command, text=True, stderr=subprocess.STDOUT)


def validate_apk(path: str, architecture: str, expected_cert_file: str,
                 aapt: str, apksigner: str) -> None:
    config = load_config()
    apk = Path(path)
    if not apk.is_file():
        raise ValueError(f"APK is missing: {apk}")
    if architecture != "arm64":
        raise ValueError("YTArk publishes a single ARM64 APK for Google TV OS 14")
    expected_name = config["APK_ARM64"]
    if apk.name != expected_name:
        raise ValueError(f"Expected APK filename {expected_name}, got {apk.name}")

    badging = run([aapt, "dump", "badging", str(apk)])
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'", badging, re.M)
    if not package:
        raise ValueError("aapt could not read package/version metadata from the APK")
    if package.group(1) != APP_ID:
        raise ValueError(f"Wrong package ID: {package.group(1)}")
    if int(package.group(2)) != int(config["VERSION_CODE"]):
        raise ValueError(f"Wrong versionCode: {package.group(2)}")
    if package.group(3) != config["VERSION_NAME"]:
        raise ValueError(f"Wrong versionName: {package.group(3)}")
    if f"application-label:'{APP_NAME}'" not in badging:
        raise ValueError("The Android launcher label is not YTArk")
    min_sdk = re.search(r"^sdkVersion:'(\d+)'", badging, re.M)
    if min_sdk and int(min_sdk.group(1)) > ANDROID_14_API:
        raise ValueError("The APK minimum SDK is newer than Android 14 / Google TV OS 14")
    max_sdk = re.search(r"^maxSdkVersion:'(\d+)'", badging, re.M)
    if max_sdk and int(max_sdk.group(1)) < ANDROID_14_API:
        raise ValueError("The APK explicitly excludes Android 14 / Google TV OS 14")

    abi = "arm64-v8a"
    if f"native-code: '{abi}'" not in badging:
        raise ValueError(f"APK does not report required native ABI {abi}")
    with zipfile.ZipFile(apk) as archive:
        if f"lib/{abi}/libchrobalt.so" not in archive.namelist():
            raise ValueError(f"APK is missing native library for {abi}")
        for artwork in ("res/drawable/ytark_launcher.xml", "res/drawable/ytark_banner.xml"):
            if artwork not in archive.namelist():
                raise ValueError(f"APK is missing YTArk launcher artwork: {artwork}")
        dex_files = [name for name in archive.namelist()
                     if re.fullmatch(r"classes\d*\.dex", name)]
        if not dex_files:
            raise ValueError("APK has no DEX files")
        if not any(APK_DESCRIPTOR in archive.read(name) for name in dex_files):
            raise ValueError("Native updater bootstrap provider is missing from the APK DEX files")

    manifest = run([aapt, "dump", "xmltree", str(apk), "AndroidManifest.xml"])
    for required in (
        "io.github.twoarchiver.ytark.updater.UpdateActivity",
        "io.github.twoarchiver.ytark.updater.UpdateBootstrapProvider",
        "io.github.twoarchiver.ytark.updater.UpdateActionReceiver",
        "android.permission.REQUEST_INSTALL_PACKAGES",
        "android.permission.POST_NOTIFICATIONS",
        "ytark",
    ):
        if required not in manifest:
            raise ValueError(f"Android manifest is missing required updater entry: {required}")

    signature = run([apksigner, "verify", "--print-certs", str(apk)])
    cert_match = re.search(r"certificate SHA-256 digest:\s*([0-9a-fA-F:]+)", signature, re.I)
    if not cert_match:
        raise ValueError("apksigner did not report an APK signing certificate")
    actual_cert = re.sub(r"[^0-9a-fA-F]", "", cert_match.group(1)).lower()
    expected_cert = read_expected_fingerprint(expected_cert_file)
    if actual_cert != expected_cert:
        raise ValueError(f"APK signing certificate mismatch: got {actual_cert}, expected {expected_cert}")

    print(f"Verified {apk.name}: {APP_ID} {config['VERSION_NAME']} ({config['VERSION_CODE']}), {abi}, certificate {actual_cert}")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_checksums(checksum_file: str, arm64_apk: str,
                    user_script: str | None = None) -> None:
    expected: dict[str, str] = {}
    for line in Path(checksum_file).read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        name = parts[1].strip().lstrip("*")
        digest = parts[0].lower()
        if re.fullmatch(r"[0-9a-f]{64}", digest):
            expected[name] = digest

    files = [Path(arm64_apk)]
    if user_script:
        files.append(Path(user_script))
    for path in files:
        if path.name not in expected:
            raise ValueError(f"{path.name} is missing from SHA256SUMS.txt")
        actual = file_sha256(path)
        if actual != expected[path.name]:
            raise ValueError(f"SHA-256 mismatch for {path.name}")
    print("SHA256SUMS.txt matches the Google TV ARM64 APK and userscript asset.")


def verify_release(release_path: str, state: str, latest_path: str | None) -> None:
    config = load_config()
    release = json.loads(Path(release_path).read_text(encoding="utf-8"))
    if release.get("name") != APP_NAME:
        raise ValueError(f"Release title must be exactly {APP_NAME}")
    if release.get("tag_name") != config["VERSION_TAG"]:
        raise ValueError("Release tag does not match release/version.properties")
    if state == "draft" and not release.get("draft"):
        raise ValueError("Release should still be a draft while validation is running")
    if state == "published" and (release.get("draft") or release.get("prerelease")):
        raise ValueError("Release must be published as a stable non-draft release")

    body = release.get("body", "") or ""
    if re.search(r"personal\s+tube\s+tv", body, re.I):
        raise ValueError("Release notes contain deprecated product branding")
    for required in (APP_ID, config["VERSION_NAME"], config["VERSION_CODE"], "TizenTubeCobalt"):
        if required not in body:
            raise ValueError(f"Release notes are missing required metadata: {required}")
    parsed_code = parse_release_version_code(body)
    if parsed_code != int(config["VERSION_CODE"]):
        raise ValueError(
            "Release notes versionCode is missing or does not match the APK versionCode; "
            "the in-app updater will reject this release"
        )

    expected_names = {
        config["APK_ARM64"], "SHA256SUMS.txt", "base-apk-sha256.txt",
        "NOTICE.md", "userScript.js",
    }
    assets = release.get("assets", [])
    actual_names = {asset.get("name") for asset in assets}
    missing = expected_names - actual_names
    if missing:
        raise ValueError("Release is missing assets: " + ", ".join(sorted(missing)))
    apk_asset = next((asset for asset in assets if asset.get("name") == config["APK_ARM64"]), None)
    try:
        asset_size = int(apk_asset.get("size", 0)) if apk_asset else 0
    except (TypeError, ValueError):
        asset_size = 0
    if asset_size <= 0:
        raise ValueError("The YTArk update APK must have a positive published asset size")
    published_digest = apk_asset.get("digest", "")
    if published_digest and not parse_sha256_digest(published_digest):
        raise ValueError("The YTArk update APK has an invalid GitHub SHA-256 digest")

    for asset in assets:
        name = asset.get("name", "")
        if name.lower().endswith(".apk") and name != config["APK_ARM64"]:
            raise ValueError(f"Release must contain only the Google TV ARM64 APK, found: {name}")
        expected_url = f"https://github.com/2archiver/YTArk/releases/download/{config['VERSION_TAG']}/{name}"
        draft_url_pattern = re.compile(
            rf"^https://github\.com/2archiver/YTArk/releases/download/(?:{re.escape(config['VERSION_TAG'])}|untagged-[0-9a-fA-F]+)/{re.escape(name)}$"
        )
        actual_url = asset.get("browser_download_url", "")
        if name in expected_names:
            if state == "draft":
                if not draft_url_pattern.fullmatch(actual_url):
                    raise ValueError(f"Invalid draft download URL for {name}: {actual_url}")
            elif actual_url != expected_url:
                raise ValueError(f"Invalid download URL for {name}: {actual_url}")

    if state == "published" and latest_path:
        latest = json.loads(Path(latest_path).read_text(encoding="utf-8"))
        if latest.get("tag_name") != config["VERSION_TAG"]:
            raise ValueError("The published YTArk release is not the GitHub latest stable release")
        if latest.get("draft") or latest.get("prerelease"):
            raise ValueError("The latest YTArk release is not stable/published")
    print(f"Verified GitHub {state} release metadata and {len(expected_names)} required assets.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    env_parser = commands.add_parser("emit-env")
    env_parser.add_argument("--file", required=True)

    version_parser = commands.add_parser("check-version")
    version_parser.add_argument("--latest-json", required=True)

    apk_parser = commands.add_parser("check-apk")
    apk_parser.add_argument("--apk", required=True)
    apk_parser.add_argument("--architecture", choices=("arm64",), required=True)
    apk_parser.add_argument("--cert-file", required=True)
    apk_parser.add_argument("--aapt", default="aapt")
    apk_parser.add_argument("--apksigner", default="apksigner")

    checksum_parser = commands.add_parser("check-checksums")
    checksum_parser.add_argument("--checksums", required=True)
    checksum_parser.add_argument("--arm64", required=True)
    checksum_parser.add_argument("--user-script")

    release_parser = commands.add_parser("verify-release")
    release_parser.add_argument("--release-json", required=True)
    release_parser.add_argument("--state", choices=("draft", "published"), required=True)
    release_parser.add_argument("--latest-json")

    args = parser.parse_args()
    try:
        if args.command == "emit-env":
            emit_env(args.file)
        elif args.command == "check-version":
            check_version(args.latest_json)
        elif args.command == "check-apk":
            validate_apk(args.apk, args.architecture, args.cert_file, args.aapt, args.apksigner)
        elif args.command == "check-checksums":
            check_checksums(args.checksums, args.arm64, args.user_script)
        elif args.command == "verify-release":
            verify_release(args.release_json, args.state, args.latest_json)
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
