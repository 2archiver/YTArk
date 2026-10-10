#!/usr/bin/env python3
"""Validate YTArk's dual-ABI APKs, updater metadata, and GitHub release contract."""

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
RELEASE_NAME = "YTArk 2.1"
CLEAN_VERSION_PATTERN = re.compile(r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)$")
HISTORICAL_VERSION_PATTERN = re.compile(
    r"^(?P<semver>\d+\.\d+\.\d+)-(?P<channel>ytark|personal)\.(?P<serial>[1-9]\d*)$"
)
TAG_VERSION_PATTERN = re.compile(
    r"^v(?P<version>\d+\.\d+\.\d+(?:-(?:ytark|personal)\.[1-9]\d*)?)$"
)
APK_DESCRIPTORS = (
    b"io/github/twoarchiver/ytark/updater/UpdateBootstrapProvider",
    b"io/github/twoarchiver/ytark/updater/PendingUpdateProvider",
    b"io/github/twoarchiver/ytark/updater/UpdateActivity",
)
ANDROID_14_API = 34
ARCHITECTURES = {
    "armv7": {"abi": "armeabi-v7a", "key": "APK_ARMV7", "upstream": "cobalt-arm.apk"},
    "arm64": {"abi": "arm64-v8a", "key": "APK_ARM64", "upstream": "cobalt-arm64.apk"},
}
REQUIRED_BASE_APKS = ("cobalt-arm.apk", "cobalt-arm64.apk")
OPTIONAL_TV_FEATURES = {
    "android.hardware.camera", "android.hardware.camera.any", "android.hardware.camera.front",
    "android.hardware.camera.autofocus", "android.hardware.camera.flash",
    "android.hardware.telephony", "android.hardware.telephony.gsm", "android.hardware.telephony.cdma",
    "android.hardware.location", "android.hardware.location.gps", "android.hardware.location.network",
    "android.hardware.gps",
}


def apk_filename(version: str, architecture: str) -> str:
    if architecture not in ARCHITECTURES:
        raise ValueError(f"Unsupported architecture: {architecture}")
    if not CLEAN_VERSION_PATTERN.fullmatch(version):
        raise ValueError(f"APK asset versions must use clean SemVer: {version}")
    return f"YTArk-v{version}-{architecture}.apk"


def version_code_for_release(version: str) -> int:
    """Map clean SemVer to a monotonic Android code; read legacy published tags too."""
    historical = HISTORICAL_VERSION_PATTERN.fullmatch(version)
    if historical:
        return 20_000 + int(historical.group("serial"))

    match = CLEAN_VERSION_PATTERN.fullmatch(version)
    if not match:
        raise ValueError(f"Invalid stable YTArk version: {version}")
    major, minor, patch = (int(match.group(name)) for name in ("major", "minor", "patch"))
    # Reserve two decimal digits each for minor/patch and one hundred code points
    # per patch release. This keeps numeric SemVer ordering aligned with Android.
    if major <= 0 or minor >= 100 or patch >= 100:
        raise ValueError("SemVer components exceed the YTArk Android versionCode mapping")
    code = major * 1_000_000 + minor * 10_000 + patch * 100
    if code <= 0 or code > 2_100_000_000:
        raise ValueError("The derived Android versionCode exceeds the platform limit")
    return code


def _numeric_version_key(version: str) -> tuple[int, int, int, int, int]:
    historical = HISTORICAL_VERSION_PATTERN.fullmatch(version)
    clean = historical.group("semver") if historical else version
    match = CLEAN_VERSION_PATTERN.fullmatch(clean)
    if not match:
        raise ValueError(f"The published YTArk tag has an invalid numeric version: {version}")
    major, minor, patch = (int(match.group(name)) for name in ("major", "minor", "patch"))
    # Historical serial releases sort below clean SemVer releases with the same
    # numeric components. The old 'personal' channel is recognized only while
    # auditing already-published releases; new configuration requires clean SemVer.
    return (major, minor, patch, 0 if historical else 1,
            int(historical.group("serial")) if historical else 0)


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
    match = CLEAN_VERSION_PATTERN.fullmatch(version)
    if not match:
        raise ValueError("versionName must be clean stable SemVer in MAJOR.MINOR.PATCH form")
    version_code = version_code_for_release(version)
    configured_code = properties.get("versionCode", "")
    if not configured_code.isdigit() or int(configured_code) != version_code:
        raise ValueError("versionCode must match the monotonic numeric SemVer mapping")

    display_version = properties.get("displayVersion", "")
    expected_display = f"{match.group('major')}.{match.group('minor')}" \
        if match.group("patch") == "0" else version
    if display_version != expected_display:
        raise ValueError(f"displayVersion must be {expected_display} for versionName {version}")

    tag = properties.get("versionTag", "")
    if tag != f"v{version}":
        raise ValueError("versionTag must be exactly v plus the clean versionName")
    base_tag = properties.get("baseTag", "")
    if not re.fullmatch(r"v\d+\.\d+\.\d+", base_tag):
        raise ValueError("baseTag must be a pinned upstream tag such as v2.0.2")
    script_tag = properties.get("scriptTag", "")
    if not re.fullmatch(r"s[0-9]{1,7}", script_tag) or len(script_tag) > 8:
        raise ValueError("scriptTag must fit the immutable userscript URL byte-length budget")

    return {
        "VERSION_NAME": version,
        "DISPLAY_VERSION": display_version,
        "VERSION_CODE": str(version_code),
        "VERSION_TAG": tag,
        "RELEASE_NAME": f"YTArk {display_version}",
        "APK_ARMV7": apk_filename(version, "armv7"),
        "APK_ARM64": apk_filename(version, "arm64"),
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
    print("Release environment loaded:", config["DISPLAY_VERSION"], config["VERSION_CODE"])


def parse_release_version_code(body: str) -> int | None:
    match = re.search(r"(?i)version\s*code\s*[:=]?\s*(\d+)", body or "")
    return int(match.group(1)) if match else None


def _flatten_release_records(payload: object):
    if isinstance(payload, dict):
        yield payload
    elif isinstance(payload, list):
        for entry in payload:
            yield from _flatten_release_records(entry)
    else:
        raise ValueError("The GitHub releases list has an unexpected JSON shape")


def _published_release_version(release: dict[str, object]) -> tuple[str, str, int] | None:
    if release.get("draft") is True or release.get("prerelease") is True:
        return None
    if release.get("draft") is not False or release.get("prerelease") is not False:
        raise ValueError("A historical release is missing its stable-publication flags")
    tag = release.get("tag_name", "")
    tag_match = TAG_VERSION_PATTERN.fullmatch(tag if isinstance(tag, str) else "")
    if not tag_match:
        raise ValueError(f"A published release has an unrecognized YTArk version tag: {tag}")
    version = tag_match.group("version")
    code = parse_release_version_code(release.get("body", ""))
    if code is None:
        raise ValueError(f"Published release {tag} is missing versionCode metadata")
    expected = version_code_for_release(version)
    if code != expected:
        raise ValueError(f"Published release {tag} has versionCode {code}, expected {expected}")
    return tag, version, code


def check_version(latest_path: str, releases_path: str | None = None) -> None:
    config = load_config()
    current = int(config["VERSION_CODE"])
    current_version = config["VERSION_NAME"]
    latest = json.loads(Path(latest_path).read_text(encoding="utf-8"))
    if not isinstance(latest, dict):
        raise ValueError("The latest GitHub release response must be a JSON object")
    no_latest = latest.get("message") == "Not Found"
    if not no_latest and (latest.get("draft") is not False or latest.get("prerelease") is not False):
        raise ValueError("The version comparison input is not a published stable release")

    if releases_path:
        records_payload = json.loads(Path(releases_path).read_text(encoding="utf-8"))
        releases = list(_flatten_release_records(records_payload))
    else:
        releases = [] if no_latest else [latest]

    previous_releases: list[tuple[str, str, int]] = []
    current_tag_already_published = False
    seen_tags: set[str] = set()
    for record in releases:
        parsed = _published_release_version(record)
        if parsed is None:
            continue
        tag, version, code = parsed
        if tag in seen_tags:
            raise ValueError(f"The GitHub releases list contains duplicate published tag {tag}")
        seen_tags.add(tag)
        if tag == config["VERSION_TAG"]:
            if version != current_version or code != current:
                raise ValueError("The already-published YTArk tag disagrees with this build's version contract")
            current_tag_already_published = True
            continue
        if _numeric_version_key(current_version) <= _numeric_version_key(version):
            raise ValueError(f"The new numeric version must be newer: {current_version} after {version}")
        if current <= code:
            raise ValueError(f"versionCode must exceed every published release: new {current}, published {code} ({tag})")
        previous_releases.append((tag, version, code))

    latest_tag = latest.get("tag_name", "") if not no_latest else ""
    if latest_tag and releases_path and latest_tag not in seen_tags:
        raise ValueError("The GitHub latest stable release is missing from the complete releases list")
    if latest_tag == config["VERSION_TAG"]:
        current_tag_already_published = True

    if current_tag_already_published:
        print(f"The configured release {config['VERSION_TAG']} is already published; its version contract was verified.")
        return
    if not previous_releases:
        if no_latest:
            print("No previous published release; versionCode seed is accepted.")
            return
        parsed_latest = _published_release_version(latest)
        if parsed_latest is not None:
            previous_releases.append(parsed_latest)

    if not previous_releases:
        print("No previous published release; versionCode seed is accepted.")
        return
    previous_tag, previous_version, previous_code = max(
        previous_releases, key=lambda entry: _numeric_version_key(entry[1]))
    print(f"Numeric version and versionCode exceed published releases: {previous_version} "
          f"({previous_code}, {previous_tag}) -> {current_version} ({current}).")


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


def _element_blocks(tree: str, tag: str) -> list[str]:
    lines = tree.splitlines()
    starts: list[tuple[int, int]] = []
    expression = re.compile(rf"^(\s*)E: {re.escape(tag)}(?:\s|$)")
    for index, line in enumerate(lines):
        match = expression.match(line)
        if match:
            starts.append((index, len(match.group(1))))
    blocks = []
    for start, indent in starts:
        end = len(lines)
        for index in range(start + 1, len(lines)):
            if re.match(r"^\s*E: ", lines[index]):
                current_indent = len(lines[index]) - len(lines[index].lstrip())
                if current_indent <= indent:
                    end = index
                    break
        blocks.append("\n".join(lines[start:end]))
    return blocks


def _attribute_line(block: str, name: str) -> str | None:
    pattern = re.compile(rf"^\s*A: android:{re.escape(name)}(?:\([^)]*\))?=.*$", re.M)
    match = pattern.search(block)
    return match.group(0) if match else None


def _boolean_attribute_is_true(line: str | None) -> bool:
    if not line:
        return False
    lowered = line.lower()
    return "0xffffffff" in lowered or re.search(r"=\s*true(?:\s|$)", lowered) is not None


def _resource_id(line: str | None) -> str | None:
    if not line:
        return None
    ids = re.findall(r"@?(0x[0-9a-fA-F]{8})", line)
    # The first 0x value is the Android attribute id (0x0101...); use the last
    # one, which is the actual compiled resource reference.
    return ids[-1].lower() if ids else None


def _validate_resource_reference(block: str, attribute: str, resource_name: str,
                                 resources_dump: str, description: str) -> None:
    line = _attribute_line(block, attribute)
    if not line:
        raise ValueError(f"Compiled manifest {description} does not declare android:{attribute}")
    resource_id = _resource_id(line)
    if resource_id:
        entry_pattern = re.compile(rf"resource\s+{re.escape(resource_id)}\b[^\n]*{re.escape(resource_name)}", re.I)
        if not entry_pattern.search(resources_dump):
            # Some aapt builds print a separate resource header and file path.
            if resource_name not in resources_dump:
                raise ValueError(f"Compiled {description} {attribute} does not resolve to {resource_name}")
    elif resource_name not in resources_dump:
        raise ValueError(f"Compiled {description} {attribute} does not resolve to {resource_name}")


def validate_compiled_manifest(apk: Path, aapt: str) -> None:
    tree = run([aapt, "dump", "xmltree", str(apk), "AndroidManifest.xml"])
    resources = run([aapt, "dump", "resources", str(apk)])
    application_blocks = _element_blocks(tree, "application")
    if not application_blocks:
        raise ValueError("Compiled Android manifest has no application element")
    application = application_blocks[0]
    activity_blocks = _element_blocks(application, "activity")

    launcher = None
    launcher_filter = None
    for activity in activity_blocks:
        filters = _element_blocks(activity, "intent-filter")
        for intent_filter in filters:
            if ("android.intent.action.MAIN" in intent_filter
                    and "android.intent.category.LEANBACK_LAUNCHER" in intent_filter):
                launcher = activity
                launcher_filter = intent_filter
                break
        if launcher:
            break
    if not launcher or not launcher_filter:
        raise ValueError("Compiled manifest has no real MAIN + LEANBACK_LAUNCHER activity")
    if not _boolean_attribute_is_true(_attribute_line(launcher, "exported")):
        raise ValueError("The compiled TV launcher activity must be explicitly android:exported=true")
    launcher_name = _attribute_line(launcher, "name")
    if not launcher_name or APP_ID not in launcher_name and "dev.cobalt.app.MainActivity" not in launcher_name:
        raise ValueError("The compiled TV launcher does not resolve to the original Cobalt activity")

    _validate_resource_reference(application, "icon", "ytark_launcher", resources, "application")
    _validate_resource_reference(application, "banner", "ytark_banner", resources, "application")
    _validate_resource_reference(launcher, "icon", "ytark_launcher", resources, "launcher activity")
    if "ytark_launcher_monochrome" not in resources:
        raise ValueError("Compiled adaptive icon has no YTArk monochrome launcher layer")

    feature_blocks = _element_blocks(tree, "uses-feature")
    touchscreen = []
    for block in feature_blocks:
        name_line = _attribute_line(block, "name")
        if name_line and "android.hardware.touchscreen" in name_line:
            touchscreen.append(block)
    if not touchscreen or any(_boolean_attribute_is_true(_attribute_line(block, "required"))
                              for block in touchscreen):
        raise ValueError("Compiled manifest must declare touchscreen as not required")
    for block in feature_blocks:
        name_line = _attribute_line(block, "name")
        if not name_line:
            continue
        feature = re.search(r'"([^"]+)"', name_line)
        if not feature:
            continue
        feature_name = feature.group(1)
        if (feature_name in OPTIONAL_TV_FEATURES or feature_name.startswith("android.hardware.sensor.")) \
                and _boolean_attribute_is_true(_attribute_line(block, "required")):
            raise ValueError(f"Unnecessary TV-incompatible feature is marked required: {feature_name}")
    print(f"Verified compiled TV launcher: {launcher_name.strip()}, MAIN + LEANBACK_LAUNCHER, exported, YTArk launcher icon and banner.")


def validate_apk(path: str, architecture: str, expected_cert_file: str,
                 aapt: str, apksigner: str) -> None:
    config = load_config()
    apk = Path(path)
    if not apk.is_file():
        raise ValueError(f"APK is missing: {apk}")
    if architecture not in ARCHITECTURES:
        raise ValueError(f"Unsupported architecture: {architecture}")
    expected_name = config[ARCHITECTURES[architecture]["key"]]
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
    if not min_sdk:
        raise ValueError("aapt could not read the APK minimum SDK")
    if int(min_sdk.group(1)) > ANDROID_14_API:
        raise ValueError("The APK minimum SDK is newer than Android 14 / Google TV OS 14")
    max_sdk = re.search(r"^maxSdkVersion:'(\d+)'", badging, re.M)
    if max_sdk and int(max_sdk.group(1)) < ANDROID_14_API:
        raise ValueError("The APK explicitly excludes Android 14 / Google TV OS 14")

    abi = ARCHITECTURES[architecture]["abi"]
    native_line = re.search(r"^native-code:(.*)$", badging, re.M)
    reported_abis = re.findall(r"'([^']+)'", native_line.group(1)) if native_line else []
    if reported_abis != [abi]:
        raise ValueError(f"APK badging must report only {abi}; got {reported_abis or 'no native ABI'}")
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        required_library = f"lib/{abi}/libchrobalt.so"
        if required_library not in names or archive.getinfo(required_library).file_size <= 0:
            raise ValueError(f"APK is missing the required native library for {abi}")
        native_abis = {
            name.split("/")[1] for name in names
            if name.startswith("lib/") and name.endswith(".so") and len(name.split("/")) >= 3
        }
        if native_abis != {abi}:
            raise ValueError(f"APK contains native libraries for unexpected ABIs: {sorted(native_abis)}")
        for native_path in (name for name in names if name.startswith("lib/") and name.endswith(".so")):
            if archive.getinfo(native_path).compress_type != zipfile.ZIP_STORED:
                raise ValueError(f"Native library is compressed instead of directly loadable: {native_path}")
        if "resources.arsc" not in names or archive.getinfo("resources.arsc").compress_type != zipfile.ZIP_STORED:
            raise ValueError("resources.arsc must be present and stored uncompressed")
        for artwork in (
            "res/drawable/ytark_launcher_fg.xml",
            "res/drawable/ytark_launcher_bg.xml",
            "res/drawable/ytark_launcher_monochrome.xml",
            "res/drawable/ytark_banner.xml",
            "res/mipmap-anydpi-v26/ytark_launcher.xml",
            "res/mipmap-mdpi/ytark_launcher.png",
            "res/mipmap-hdpi/ytark_launcher.png",
            "res/mipmap-xhdpi/ytark_launcher.png",
            "res/mipmap-xxhdpi/ytark_launcher.png",
            "res/mipmap-xxxhdpi/ytark_launcher.png",
        ):
            if artwork not in names:
                raise ValueError(f"APK is missing YTArk artwork resource: {artwork}")
        dex_files = [name for name in names if re.fullmatch(r"classes\d*\.dex", name)]
        if not dex_files:
            raise ValueError("APK has no DEX files")
        missing_updater_classes = [
            descriptor.decode("ascii")
            for descriptor in APK_DESCRIPTORS
            if not any(descriptor in archive.read(name) for name in dex_files)
        ]
        if missing_updater_classes:
            raise ValueError("Native updater classes are missing from APK DEX files: "
                             + ", ".join(missing_updater_classes))

    validate_compiled_manifest(apk, aapt)
    manifest = run([aapt, "dump", "xmltree", str(apk), "AndroidManifest.xml"])
    for required in (
        "io.github.twoarchiver.ytark.updater.UpdateActivity",
        "io.github.twoarchiver.ytark.updater.UpdateBootstrapProvider",
        "io.github.twoarchiver.ytark.updater.PendingUpdateProvider",
        "io.github.twoarchiver.ytark.updater.UpdateActionReceiver",
        "android.permission.REQUEST_INSTALL_PACKAGES",
        "android.permission.POST_NOTIFICATIONS",
        "ytarkupdater.files",
        "android:grantUriPermissions",
        "/update.apk",
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


def parse_checksum_file(checksum_file: str) -> dict[str, str]:
    expected: dict[str, str] = {}
    for line_number, line in enumerate(Path(checksum_file).read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split(None, 1)
        if len(parts) != 2:
            raise ValueError(f"Malformed checksum entry at line {line_number}")
        digest, name = parts[0].lower(), parts[1].strip().lstrip("*")
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"Invalid SHA-256 checksum at line {line_number}")
        if not name or name in expected:
            raise ValueError(f"Duplicate or empty checksum filename at line {line_number}")
        expected[name] = digest
    return expected


def check_checksums(checksum_file: str, armv7_apk: str, arm64_apk: str,
                    user_script: str | None = None) -> None:
    expected = parse_checksum_file(checksum_file)
    files = [Path(armv7_apk), Path(arm64_apk)]
    if user_script:
        files.append(Path(user_script))
    for path in files:
        if path.name not in expected:
            raise ValueError(f"{path.name} is missing from SHA256SUMS.txt")
        actual = file_sha256(path)
        if actual != expected[path.name]:
            raise ValueError(f"SHA-256 mismatch for {path.name}")
    print("SHA256SUMS.txt matches both ARMv7 and ARM64 APKs" + (" and the userscript." if user_script else "."))


def check_base_checksums(checksum_file: str, base_dir: str) -> None:
    expected = parse_checksum_file(checksum_file)
    directory = Path(base_dir)
    for name in REQUIRED_BASE_APKS:
        path = directory / name
        if not path.is_file() or name not in expected:
            raise ValueError(f"Pinned upstream base checksum or APK is missing: {name}")
        if file_sha256(path) != expected[name]:
            raise ValueError(f"Pinned upstream base checksum does not match: {name}")
    print("Both pinned TizenTubeCobalt base APK checksums verified.")


def verify_release(release_path: str, state: str, latest_path: str | None) -> None:
    config = load_config()
    release = json.loads(Path(release_path).read_text(encoding="utf-8"))
    if release.get("name") != config["RELEASE_NAME"]:
        raise ValueError(f"Release title must be exactly {config['RELEASE_NAME']}")
    if release.get("tag_name") != config["VERSION_TAG"]:
        raise ValueError("Release tag does not match release/version.properties")
    if state == "draft" and release.get("draft") is not True:
        raise ValueError("Release should still be a draft while validation is running")
    if release.get("prerelease") is not False:
        raise ValueError("YTArk release must not be marked as a prerelease")
    if state == "published" and release.get("draft") is not False:
        raise ValueError("Release must be published as a stable non-draft release")

    body = release.get("body", "") or ""
    if re.search(r"personal\s+tube\s+tv", body, re.I):
        raise ValueError("Release notes contain deprecated product branding")
    for required in (
        APP_ID, config["DISPLAY_VERSION"], config["VERSION_NAME"], config["VERSION_CODE"],
        "TizenTubeCobalt", config["APK_ARMV7"], config["APK_ARM64"],
        "4K does not select an APK architecture", "arm64-v8a", "armeabi-v7a",
    ):
        if required not in body:
            raise ValueError(f"Release notes are missing required metadata/guidance: {required}")
    parsed_code = parse_release_version_code(body)
    if parsed_code != int(config["VERSION_CODE"]):
        raise ValueError("Release notes versionCode is missing or does not match the APK versionCode")

    expected_names = {
        config["APK_ARMV7"], config["APK_ARM64"], "SHA256SUMS.txt",
        "base-apk-sha256.txt", "NOTICE.md", "userScript.js",
    }
    assets = release.get("assets", [])
    actual_names = [asset.get("name") for asset in assets]
    actual_name_set = set(actual_names)
    if len(actual_names) != len(actual_name_set):
        raise ValueError("GitHub Release contains duplicate asset names")
    missing = expected_names - actual_name_set
    if missing:
        raise ValueError("Release is missing assets: " + ", ".join(sorted(missing)))
    expected_apks = {config["APK_ARMV7"], config["APK_ARM64"]}
    for name in actual_name_set:
        if name.lower().endswith(".apk") and name not in expected_apks:
            raise ValueError(f"Release contains an unexpected APK asset: {name}")

    for architecture in ARCHITECTURES:
        name = config[ARCHITECTURES[architecture]["key"]]
        asset = next(item for item in assets if item.get("name") == name)
        try:
            size = int(asset.get("size", 0))
        except (TypeError, ValueError):
            size = 0
        if size <= 0:
            raise ValueError(f"The {architecture} YTArk APK must have a positive published asset size")
        digest = asset.get("digest", "")
        if digest and not parse_sha256_digest(digest):
            raise ValueError(f"The {architecture} YTArk APK has an invalid GitHub SHA-256 digest")

    for asset in assets:
        name = asset.get("name", "")
        if name not in expected_names:
            continue
        actual_url = asset.get("browser_download_url", "")
        expected_url = f"https://github.com/2archiver/YTArk/releases/download/{config['VERSION_TAG']}/{name}"
        draft_pattern = re.compile(
            rf"^https://github\.com/2archiver/YTArk/releases/download/(?:{re.escape(config['VERSION_TAG'])}|untagged-[0-9a-fA-F]+)/{re.escape(name)}$"
        )
        if state == "draft":
            if not draft_pattern.fullmatch(actual_url):
                raise ValueError(f"Invalid draft download URL for {name}: {actual_url}")
        elif actual_url != expected_url:
            raise ValueError(f"Invalid official download URL for {name}: {actual_url}")

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
    version_parser.add_argument("--releases-json")

    apk_parser = commands.add_parser("check-apk")
    apk_parser.add_argument("--apk", required=True)
    apk_parser.add_argument("--architecture", choices=tuple(ARCHITECTURES), required=True)
    apk_parser.add_argument("--cert-file", required=True)
    apk_parser.add_argument("--aapt", default="aapt")
    apk_parser.add_argument("--apksigner", default="apksigner")

    checksum_parser = commands.add_parser("check-checksums")
    checksum_parser.add_argument("--checksums", required=True)
    checksum_parser.add_argument("--armv7", required=True)
    checksum_parser.add_argument("--arm64", required=True)
    checksum_parser.add_argument("--user-script")

    base_checksum_parser = commands.add_parser("check-base-checksums")
    base_checksum_parser.add_argument("--checksums", required=True)
    base_checksum_parser.add_argument("--base-dir", required=True)

    release_parser = commands.add_parser("verify-release")
    release_parser.add_argument("--release-json", required=True)
    release_parser.add_argument("--state", choices=("draft", "published"), required=True)
    release_parser.add_argument("--latest-json")

    args = parser.parse_args()
    try:
        if args.command == "emit-env":
            emit_env(args.file)
        elif args.command == "check-version":
            check_version(args.latest_json, args.releases_json)
        elif args.command == "check-apk":
            validate_apk(args.apk, args.architecture, args.cert_file, args.aapt, args.apksigner)
        elif args.command == "check-checksums":
            check_checksums(args.checksums, args.armv7, args.arm64, args.user_script)
        elif args.command == "check-base-checksums":
            check_base_checksums(args.checksums, args.base_dir)
        elif args.command == "verify-release":
            verify_release(args.release_json, args.state, args.latest_json)
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
