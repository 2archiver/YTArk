#!/usr/bin/env python3
"""Validate YTArk's ARMv7 APK, updater metadata, and GitHub release contract."""

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
    b"io/github/twoarchiver/ytark/updater/UpdateCheckJobService",
)
ANDROID_14_API = 34
# YTArk publishes exactly one architecture: 32-bit ARM (armeabi-v7a). The
# ARM64 jobs, assets and documentation were removed in 2.1.2; a 64-bit CPU does
# not by itself mean the Android userspace can run 32-bit native code, so the
# updater checks Android's own ABI list before offering a download.
ARCHITECTURES = {
    "armv7": {"abi": "armeabi-v7a", "key": "APK_ARMV7", "upstream": "cobalt-arm.apk"},
}
REQUIRED_BASE_APKS = ("cobalt-arm.apk",)
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


def _own_attribute_lines(block: str) -> list[str]:
    """Attribute lines that belong to the element itself, never to descendants.

    ``aapt dump xmltree`` prints an element's own attributes between its ``E:``
    line and the first nested child ``E:`` line. Searching the whole block (as
    ``_attribute_line`` does) can also match a descendant's attribute, which a
    scoped declaration check must never do.
    """
    own: list[str] = []
    for line in block.splitlines()[1:]:
        if re.match(r"^\s*E: ", line):
            break
        if re.match(r"^\s*A: ", line):
            own.append(line)
    return own


def _own_attribute_line(block: str, name: str) -> str | None:
    """This element's own ``android:<name>`` attribute line, or None."""
    pattern = re.compile(rf"^\s*A: android:{re.escape(name)}(?:\([^)]*\))?=.*$")
    for line in _own_attribute_lines(block):
        if pattern.match(line):
            return line
    return None


def _direct_element_blocks(parent_block: str, tag: str) -> list[str]:
    """Blocks of the ``E: <tag>`` elements that are direct children of an element.

    ``_element_blocks`` finds a tag at any depth; declaration checks need the
    manifest-level elements only, so deeper nested lookalikes never match.
    """
    lines = parent_block.splitlines()
    if not lines:
        return []
    parent_indent = len(lines[0]) - len(lines[0].lstrip())
    child_indent: int | None = None
    for line in lines[1:]:
        if re.match(r"^\s*E: ", line):
            child_indent = len(line) - len(line.lstrip())
            break
    if child_indent is None or child_indent <= parent_indent:
        return []
    expression = re.compile(rf"^\s*E: {re.escape(tag)}(?:\s|$)")
    blocks: list[str] = []
    for start, line in enumerate(lines):
        if not expression.match(line):
            continue
        if len(line) - len(line.lstrip()) != child_indent:
            continue
        end = len(lines)
        for index in range(start + 1, len(lines)):
            if re.match(r"^\s*E: ", lines[index]):
                current_indent = len(lines[index]) - len(lines[index].lstrip())
                if current_indent <= child_indent:
                    end = index
                    break
        blocks.append("\n".join(lines[start:end]))
    return blocks


def _quoted_attribute_value(line: str | None) -> str | None:
    """The first quoted value after ``=`` in an attribute line, exactly.

    Compiled string attributes print as ``="value" (Raw: "value")``; returning
    the quoted value lets callers compare names exactly instead of matching a
    substring of the whole line.
    """
    if not line:
        return None
    _, _, value = line.partition("=")
    match = re.match(r'\s*"([^"]*)"', value)
    return match.group(1) if match else None


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


UPDATER_ACTIVITY_NAME = "io.github.twoarchiver.ytark.updater.UpdateActivity"
UPDATER_LAUNCHER_ACTIVITY_NAME = "io.github.twoarchiver.ytark.updater.UpdateLauncherActivity"
UPDATER_SCREEN_PERMISSION = "io.github.twoarchiver.ytark.permission.OPEN_NATIVE_SCREEN"
# Android's ProtectionLevel.SIGNATURE is the exact numeric value 2. aapt2/apktool
# compile android:protectionLevel="signature" into that integer, so the literal
# word "signature" never survives into the binary manifest.
SIGNATURE_PROTECTION_LEVEL = 2
SIGNATURE_PROTECTION_SYMBOL = "signature"


def _parse_protection_level(line: str) -> tuple[str, object]:
    """Parse an ``android:protectionLevel`` attribute line after the ``=``.

    Returns ``(kind, value)`` with kind ``numeric``, ``symbolic`` or
    ``unresolved``. Compiled aapt output annotates the data type in front of the
    value — ``A: android:protectionLevel(0x01010009)=(type 0x11)0x2`` — and aapt
    prints every integer payload as ``0x…``; the resource id in front of the
    ``=`` and the ``0x11`` type marker are never the attribute value. Decoded
    textual dumps keep the raw symbol instead: ``="signature" (Raw: "signature")``.
    Anything else (a resource reference, a missing value, malformed text) is
    reported as ``unresolved`` so callers can fail closed.
    """
    _, _, raw = line.partition("=")
    value = raw.strip()
    symbol = re.match(r'^"([^"]*)"', value)
    if symbol:
        return "symbolic", symbol.group(1)
    typed = re.match(r"^\(type\s+0x[0-9a-fA-F]+\)\s*(\S.*?)\s*$", value)
    if typed:
        value = typed.group(1).strip()
    token = value.split()[0] if value.split() else ""
    number = re.fullmatch(r"0x([0-9a-fA-F]+)|(\d+)", token)
    if number:
        if number.group(1) is not None:
            return "numeric", int(number.group(1), 16)
        return "numeric", int(number.group(2))
    return "unresolved", value


def _screen_permission_declarations(tree: str) -> list[str]:
    """Manifest-level ``E: permission`` blocks naming exactly the screen permission.

    Only a direct child ``E: permission`` element of the manifest whose own
    ``android:name`` equals :data:`UPDATER_SCREEN_PERMISSION` counts. An
    ``E: uses-permission`` request, an activity attribute, a prefix/suffix
    lookalike name, a nested element or another permission's declaration never
    matches.
    """
    manifest_blocks = _element_blocks(tree, "manifest")
    if not manifest_blocks:
        raise ValueError("Compiled Android manifest has no manifest element")
    declarations: list[str] = []
    for block in _direct_element_blocks(manifest_blocks[0], "permission"):
        if _quoted_attribute_value(_own_attribute_line(block, "name")) == UPDATER_SCREEN_PERMISSION:
            declarations.append(block)
    return declarations


def require_declared_signature_permission(tree: str) -> None:
    """Fail closed unless the compiled manifest declares the screen permission signature-only.

    The previous global text search required the literal word ``signature`` to
    appear somewhere in the dump. apktool/aapt2 compile the enum into the
    numeric flags value ``(type 0x11)0x2``, so a correctly built APK failed the
    release gate, while an unrelated occurrence of the word anywhere else in the
    manifest could wrongly satisfy it. This check reads the protection level
    from the one declaration it validated, and nothing else.
    """
    requirement = "Native screen routes must be protected by a declared signature permission: "
    declarations = _screen_permission_declarations(tree)
    if not declarations:
        raise ValueError(
            requirement
            + f"the compiled manifest declares no manifest-level <permission> whose "
              f"android:name is exactly {UPDATER_SCREEN_PERMISSION}"
        )
    if len(declarations) > 1:
        raise ValueError(
            requirement
            + f"{UPDATER_SCREEN_PERMISSION} is declared {len(declarations)} times; "
              f"duplicate or conflicting declarations are rejected"
        )
    level_line = _own_attribute_line(declarations[0], "protectionLevel")
    if level_line is None:
        raise ValueError(
            requirement
            + f"the declaration of {UPDATER_SCREEN_PERMISSION} carries no "
              f"android:protectionLevel attribute"
        )
    kind, value = _parse_protection_level(level_line)
    signature_only = (
        (kind == "numeric" and value == SIGNATURE_PROTECTION_LEVEL)
        or (kind == "symbolic" and value == SIGNATURE_PROTECTION_SYMBOL)
    )
    if not signature_only:
        raise ValueError(
            requirement
            + f"{UPDATER_SCREEN_PERMISSION} has an unexpected android:protectionLevel "
              f"{value!r} ({kind}); only the exact signature-only value is accepted "
              f"(numeric {SIGNATURE_PROTECTION_LEVEL} or \"signature\"), never "
              f"normal/dangerous/signatureOrSystem or combined flags"
        )


def validate_updater_background_components(tree: str) -> None:
    """Require the persistent JobScheduler updater service."""
    application_blocks = _element_blocks(tree, "application")
    if not application_blocks:
        raise ValueError("Compiled Android manifest has no application element")
    app = application_blocks[0]
    if "io.github.twoarchiver.ytark.updater.StorageActivity" in tree:
        raise ValueError("Compiled manifest still declares the removed YTArk Cache & Storage activity")

    service_found = False
    for service in _element_blocks(app, "service"):
        name = _attribute_line(service, "name") or ""
        if "io.github.twoarchiver.ytark.updater.UpdateCheckJobService" not in name:
            continue
        service_found = True
        if "android.permission.BIND_JOB_SERVICE" not in (_attribute_line(service, "permission") or ""):
            raise ValueError("The periodic updater service must require BIND_JOB_SERVICE")
        if _boolean_attribute_is_true(_attribute_line(service, "exported")):
            raise ValueError("The periodic updater service must not be exported")
        break
    if not service_found:
        raise ValueError("Compiled manifest has no persistent updater JobService")
    if "android.permission.RECEIVE_BOOT_COMPLETED" not in tree:
        raise ValueError("Persistent updater scheduling requires RECEIVE_BOOT_COMPLETED")


def validate_updater_launcher(tree: str) -> None:
    """3.1 uses a private JNI-opened screen, never a second launcher or public route."""
    apps = _element_blocks(tree, "application")
    if not apps:
        raise ValueError("Compiled Android manifest has no application element")
    activities = _element_blocks(apps[0], "activity")
    screens = [a for a in activities if UPDATER_ACTIVITY_NAME in (_attribute_line(a, "name") or "")]
    if len(screens) != 1:
        raise ValueError("Expected exactly one YTArk Updates activity")
    screen = screens[0]
    exported = _own_attribute_line(screen, "exported") or ""
    if not re.search(r'(?:\(type 0x12\)0x0|="false")', exported):
        raise ValueError("YTArk Updates must be explicitly non-exported")
    if _element_blocks(screen, "intent-filter"):
        raise ValueError("Private Updates screen must have no external routes")
    if UPDATER_LAUNCHER_ACTIVITY_NAME in tree:
        raise ValueError("Obsolete updater launcher proxy is forbidden")
    for block in activities + _element_blocks(apps[0], "activity-alias"):
        if "ytark.updater" in (_attribute_line(block, "name") or "") and "LAUNCHER" in block:
            raise ValueError("Updater-specific launcher entries are forbidden")
    print("Verified private YTArk Updates screen; no updater launcher or exported route.")


MIN_TARGET_SDK_FOR_REQUEST_INSTALL_PACKAGES = 26

def packaged_manifest_expectation(config: dict | None = None):
    """The manifest contract every published YTArk package must satisfy."""
    import apk_manifest
    config = config or load_config()
    return apk_manifest.Expectation(
        package=APP_ID,
        version_code=int(config["VERSION_CODE"]),
        version_name=config["VERSION_NAME"],
    )


def validate_packaged_manifest(path: str, config: dict | None = None):
    """Inspect the compiled manifest inside a packaged APK without the SDK.

    ``aapt`` remains the reference tool above, but a release must not depend on
    a single reader for the capability that decides whether Android can ever
    grant the in-app updater install authorization. This reads the binary
    manifest itself and fails closed on:

    * a package id, versionCode or versionName that differs from release metadata;
    * a target SDK below API 26, where Android refuses the authorization outright;
    * an absent or SDK-capped ``REQUEST_INSTALL_PACKAGES`` declaration;
    * an updater screen that is not private, or an obsolete launcher proxy;
    * provider authorities that do not match the package that hosts them.
    """
    import apk_manifest
    facts = apk_manifest.inspect_apk(path)
    problems = apk_manifest.check_facts(facts, packaged_manifest_expectation(config))
    capability = facts.install_capability()
    if problems:
        raise ValueError(
            "Packaged AndroidManifest.xml does not satisfy the YTArk contract: "
            + "; ".join(problems))
    print(
        f"Verified packaged manifest: {facts.package} {facts.version_name} "
        f"({facts.version_code}), target SDK {facts.target_sdk}, install "
        f"authorization can be granted (target >= "
        f"{apk_manifest.MIN_TARGET_SDK_FOR_INSTALL_CAPABILITY})"
    )
    return facts


def audit_packaged_manifest(path: str, expect_package: str | None = None,
                            require_capability: bool = False) -> dict:
    """Report a packaged manifest's install capability, for any APK.

    Used on the published artefact, not only on freshly built bytes: a package
    that Android will never authorize (a pre-API-26 target, a missing or capped
    declaration) is a finding in its own right, whether or not it was built
    here.
    """
    import apk_manifest
    facts = apk_manifest.inspect_apk(path)
    capability = facts.install_capability()
    if expect_package and facts.package != expect_package:
        raise ValueError(
            f"Expected package {expect_package}, found {facts.package} in {path}")
    verdict = (
        f"package {facts.package} {facts.version_name} ({facts.version_code}), "
        f"min SDK {facts.min_sdk}, target SDK {facts.target_sdk}, install capability "
        f"{'grantable' if capability['can_be_granted'] else 'NOT grantable'}"
        + (f" ({', '.join(capability['reasons'])})" if capability["reasons"] else "")
    )
    print(f"Audited {path}: {verdict}")
    if require_capability and not capability["can_be_granted"]:
        raise ValueError(
            "Android cannot grant this package the install-unknown-apps "
            f"capability: {verdict}")
    return {"facts": facts, "capability": capability}



def validate_install_unknown_sources_target_sdk(badging: str) -> int:
    """API 26+ per-source authorization requires a target SDK of at least 26."""
    target = re.search(r"^targetSdkVersion:'(\d+)'", badging, re.M)
    if not target:
        raise ValueError("aapt could not read the APK target SDK required for install authorization")
    target_sdk = int(target.group(1))
    if target_sdk < MIN_TARGET_SDK_FOR_REQUEST_INSTALL_PACKAGES:
        raise ValueError(
            "REQUEST_INSTALL_PACKAGES unknown-source authorization requires targetSdkVersion >= 26; "
            f"the APK targets {target_sdk}"
        )
    return target_sdk


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
    target_sdk = validate_install_unknown_sources_target_sdk(badging)
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
            if name.startswith("lib/") and len(name.split("/")) >= 3
        }
        if native_abis != {abi}:
            raise ValueError(
                f"APK contains native libraries for unexpected ABIs: {sorted(native_abis)}; "
                f"this release is {abi} only"
            )
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
        from dex_contract import verify_apk_dex
        verify_apk_dex(apk)


    facts = validate_packaged_manifest(str(apk), config)
    # Two independent readers must agree about the applied identity and target
    # SDK; a disagreement means one of them is looking at the wrong bytes.
    if facts.package != APP_ID or facts.version_code != int(config["VERSION_CODE"]):
        raise ValueError("aapt and the manifest reader disagree about package identity")
    if facts.target_sdk != target_sdk:
        raise ValueError(
            f"aapt reports target SDK {target_sdk} but the packaged manifest "
            f"declares {facts.target_sdk}")

    validate_compiled_manifest(apk, aapt)
    manifest = run([aapt, "dump", "xmltree", str(apk), "AndroidManifest.xml"])
    validate_updater_launcher(manifest)
    validate_updater_background_components(manifest)
    for required in (
        "io.github.twoarchiver.ytark.updater.UpdateActivity",
        "io.github.twoarchiver.ytark.updater.UpdateBootstrapProvider",
        "io.github.twoarchiver.ytark.updater.PendingUpdateProvider",
        "io.github.twoarchiver.ytark.updater.UpdateCheckJobService",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.REQUEST_INSTALL_PACKAGES",
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

    print(f"Verified {apk.name}: {APP_ID} {config['VERSION_NAME']} ({config['VERSION_CODE']}), {abi}, target SDK {target_sdk}, certificate {actual_cert}")


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


def check_checksums(checksum_file: str, apk: str, user_script: str | None = None) -> None:
    expected = parse_checksum_file(checksum_file)
    files = [Path(apk)]
    if user_script:
        files.append(Path(user_script))
    for path in files:
        if path.name not in expected:
            raise ValueError(f"{path.name} is missing from SHA256SUMS.txt")
        actual = file_sha256(path)
        if actual != expected[path.name]:
            raise ValueError(f"SHA-256 mismatch for {path.name}")
    unexpected = sorted(set(expected) - {path.name for path in files})
    if unexpected:
        raise ValueError("SHA256SUMS.txt lists files that are not part of this release: "
                         + ", ".join(unexpected))
    print("SHA256SUMS.txt matches the ARMv7 APK" + (" and the userscript." if user_script else "."))


def check_base_checksums(checksum_file: str, base_dir: str) -> None:
    expected = parse_checksum_file(checksum_file)
    directory = Path(base_dir)
    for name in REQUIRED_BASE_APKS:
        path = directory / name
        if not path.is_file() or name not in expected:
            raise ValueError(f"Pinned upstream base checksum or APK is missing: {name}")
        if file_sha256(path) != expected[name]:
            raise ValueError(f"Pinned upstream base checksum does not match: {name}")
    print("The pinned TizenTubeCobalt ARMv7 base APK checksum verified.")


def verify_release_record(
    release: dict, state: str, latest: dict | None = None
) -> None:
    """Validate an already-fetched GitHub release payload.

    Both the CLI (``verify-release``) and ``tools/publish_release.py`` call this,
    so the release contract tests cover the production publication path too.
    """
    config = load_config()
    if not isinstance(release, dict):
        raise ValueError("The GitHub release response must be a JSON object")
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
        "TizenTubeCobalt", config["APK_ARMV7"],
        "4K does not select an APK architecture", "arm64-v8a", "armeabi-v7a",
        "ARMv7", "64-bit",
    ):
        if required not in body:
            raise ValueError(f"Release notes are missing required metadata/guidance: {required}")
    parsed_code = parse_release_version_code(body)
    if parsed_code != int(config["VERSION_CODE"]):
        raise ValueError("Release notes versionCode is missing or does not match the APK versionCode")

    expected_names = {
        config["APK_ARMV7"], "SHA256SUMS.txt",
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
    expected_apks = {config["APK_ARMV7"]}
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

    if state == "published" and latest is not None:
        if not isinstance(latest, dict):
            raise ValueError("The latest GitHub release response must be a JSON object")
        if latest.get("tag_name") != config["VERSION_TAG"]:
            raise ValueError("The published YTArk release is not the GitHub latest stable release")
        if latest.get("draft") or latest.get("prerelease"):
            raise ValueError("The latest YTArk release is not stable/published")
    print(f"Verified GitHub {state} release metadata and {len(expected_names)} required assets.")


def verify_release(release_path: str, state: str, latest_path: str | None) -> None:
    """CLI wrapper: validate a GitHub release payload stored on disk."""
    release = json.loads(Path(release_path).read_text(encoding="utf-8"))
    latest = json.loads(Path(latest_path).read_text(encoding="utf-8")) if latest_path else None
    verify_release_record(release, state, latest)


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

    audit_parser = commands.add_parser("audit-apk")
    audit_parser.add_argument("--apk", required=True)
    audit_parser.add_argument("--expect-package")
    audit_parser.add_argument(
        "--require-capability", action="store_true",
        help="fail when Android could never grant install authorization")

    checksum_parser = commands.add_parser("check-checksums")
    checksum_parser.add_argument("--checksums", required=True)
    checksum_parser.add_argument("--armv7", required=True)
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
        elif args.command == "audit-apk":
            audit_packaged_manifest(args.apk, args.expect_package,
                                   args.require_capability)
        elif args.command == "check-checksums":
            check_checksums(args.checksums, args.armv7, args.user_script)
        elif args.command == "check-base-checksums":
            check_base_checksums(args.checksums, args.base_dir)
        elif args.command == "verify-release":
            verify_release(args.release_json, args.state, args.latest_json)
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
