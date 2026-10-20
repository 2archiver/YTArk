#!/usr/bin/env python3
"""Independently check the emitted release environment against the contract.

``tools/validate_release.py emit-env`` renders ``release/version.properties``
into the KEY=VALUE environment that CI, the repacker and the publisher consume.
The pinned ``grep -Fx 'VERSION_NAME=3.9.0' ...`` assertions in ci.yml were a
second, hand-maintained copy of that identity: they were not updated at the
4.0 bump and blocked every main CI run after PR #71.

This checker replaces that duplicated pin. It re-derives every emitted field
from ``release/version.properties`` with its own implementation of the release
contract -- the clean-SemVer rule, the monotonic versionCode mapping
(major*1,000,000 + minor*10,000 + patch*100), the displayVersion rule, the
v-prefixed release tag, the script-tag length budget, the pinned upstream tag
format and the derived ARMv7 APK filename -- and then compares the derived
values against the emitted environment, field by field, reporting every
mismatch.

It deliberately does NOT import ``tools/validate_release.py``: re-implementing
the contract is what makes this check independent, so a bug in either
derivation is caught instead of echoed. ``tools/tests/test_release_contract.py``
still pins the literal identity of the current release; this file only enforces
the shape of the contract, so a future version bump cannot leave another stale
workflow assertion behind.

Usage:
    python3 tools/check_release_metadata.py --env "$RUNNER_TEMP/ytark-release.env"
    python3 tools/check_release_metadata.py --env FILE --properties PATH
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROPERTIES = ROOT / "release" / "version.properties"

CLEAN_VERSION = re.compile(r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)$")
SCRIPT_TAG = re.compile(r"^s[0-9]{1,7}$")
BASE_TAG = re.compile(r"^v\d+\.\d+\.\d+$")

APP_ID = "io.github.twoarchiver.ytark"
APP_NAME = "YTArk"
ABI_SUFFIX = "armeabi-v7a"

# Every field tools/validate_release.py emit-env must export, and how each is
# re-derived here from the parsed version.properties.
EXPECTED_KEYS = (
    "VERSION_NAME", "DISPLAY_VERSION", "VERSION_CODE", "VERSION_TAG",
    "RELEASE_NAME", "APK_ARMV7", "SCRIPT_TAG", "BASE_TAG", "APP_ID", "APP_NAME",
)
PROPERTY_KEYS = ("versionName", "versionCode", "displayVersion", "versionTag", "scriptTag", "baseTag")


class ContractError(Exception):
    """One rejected field or malformed input."""


def parse_properties(path: Path) -> dict[str, str]:
    """Parse a strict KEY=VALUE properties file with '#' comments."""
    if not path.is_file():
        raise ContractError(f"version properties file is missing: {path}")
    properties: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ContractError(f"{path.name}:{number}: malformed line (expected KEY=VALUE): {line!r}")
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not key or not value:
            raise ContractError(f"{path.name}:{number}: empty key or value: {line!r}")
        if key in properties:
            raise ContractError(f"{path.name}:{number}: duplicate key {key!r}")
        properties[key] = value
    missing = [key for key in PROPERTY_KEYS if key not in properties]
    if missing:
        raise ContractError(f"{path.name}: missing required key(s): {', '.join(missing)}")
    unknown = sorted(set(properties) - set(PROPERTY_KEYS))
    if unknown:
        raise ContractError(f"{path.name}: unexpected key(s) (typo?): {', '.join(unknown)}")
    return properties


def derive_expected(properties: dict[str, str]) -> dict[str, str]:
    """Re-derive every emitted field from version.properties, independently.

    The release contract lives here in full so this checker never needs to
    trust the emitter it audits.
    """
    version = properties["versionName"]
    match = CLEAN_VERSION.fullmatch(version)
    if not match:
        raise ContractError(f"versionName must be clean stable SemVer MAJOR.MINOR.PATCH, got {version!r}")
    major, minor, patch = (int(match.group(name)) for name in ("major", "minor", "patch"))
    if major <= 0 or minor >= 100 or patch >= 100:
        raise ContractError(f"versionName {version!r} exceeds the versionCode mapping (major>=1, minor/patch<100)")
    code = major * 1_000_000 + minor * 10_000 + patch * 100
    if code <= 0 or code > 2_100_000_000:
        raise ContractError(f"derived versionCode {code} exceeds the Android platform limit")

    configured_code = properties["versionCode"]
    if not configured_code.isdigit() or int(configured_code) != code:
        raise ContractError(
            f"versionCode {configured_code!r} does not match the documented mapping of {version!r} ({code})"
        )

    display = properties["displayVersion"]
    expected_display = f"{major}.{minor}" if patch == 0 else version
    if display != expected_display:
        raise ContractError(f"displayVersion must be {expected_display!r} for versionName {version!r}, got {display!r}")

    tag = properties["versionTag"]
    if tag != f"v{version}":
        raise ContractError(f"versionTag must be exactly v{version}, got {tag!r}")

    script_tag = properties["scriptTag"]
    if not SCRIPT_TAG.fullmatch(script_tag) or len(script_tag) > 8:
        raise ContractError(f"scriptTag must be s plus 1-7 digits (short URL budget), got {script_tag!r}")

    base_tag = properties["baseTag"]
    if not BASE_TAG.fullmatch(base_tag):
        raise ContractError(f"baseTag must be a pinned upstream tag such as v2.0.2, got {base_tag!r}")

    return {
        "VERSION_NAME": version,
        "DISPLAY_VERSION": display,
        "VERSION_CODE": str(code),
        "VERSION_TAG": tag,
        "RELEASE_NAME": f"YTArk {display}",
        "APK_ARMV7": f"YTArk-v{version}-{ABI_SUFFIX}.apk",
        "SCRIPT_TAG": script_tag,
        "BASE_TAG": base_tag,
        "APP_ID": APP_ID,
        "APP_NAME": APP_NAME,
    }


def parse_env(path: Path) -> dict[str, str]:
    """Parse the emitted KEY=VALUE environment, rejecting malformed input."""
    if not path.is_file():
        raise ContractError(f"emitted release environment file is missing: {path}")
    emitted: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        if "=" not in line:
            raise ContractError(f"{path.name}:{number}: malformed line (expected KEY=VALUE): {line!r}")
        key, value = line.split("=", 1)
        if not key.strip() or not value.strip():
            raise ContractError(f"{path.name}:{number}: empty key or value: {line!r}")
        if key in emitted:
            raise ContractError(f"{path.name}:{number}: {key} emitted twice (emit-env appends; use a fresh file)")
        emitted[key] = value
    return emitted


def check(env_path: Path, properties_path: Path = DEFAULT_PROPERTIES) -> list[str]:
    """Return one human-readable failure per rejected field; empty means pass."""
    failures: list[str] = []
    try:
        expected = derive_expected(parse_properties(properties_path))
    except ContractError as error:
        return [f"release/version.properties: {error}"]
    try:
        emitted = parse_env(env_path)
    except ContractError as error:
        return [str(error)]

    for key in EXPECTED_KEYS:
        if key not in emitted:
            failures.append(f"emitted environment is missing {key}")
            continue
        if emitted[key] != expected[key]:
            failures.append(
                f"{key}: emitted {emitted[key]!r} but release/version.properties derives {expected[key]!r}"
            )
    for key in sorted(set(emitted) - set(EXPECTED_KEYS)):
        failures.append(f"emitted environment has unexpected key {key}={emitted[key]!r}")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env", required=True, type=Path,
                        help="emitted release environment file (validate_release.py emit-env output)")
    parser.add_argument("--properties", type=Path, default=DEFAULT_PROPERTIES,
                        help="authoritative version properties (default: release/version.properties)")
    args = parser.parse_args(argv)

    failures = check(args.env, args.properties)
    if failures:
        for failure in failures:
            print(f"release metadata contract: {failure}", file=sys.stderr)
        named = ", ".join(sorted({f.split(":", 1)[0].split(" ", 1)[0] for f in failures})[:10])
        print(f"::error title=Release metadata contract::"
              f"{len(failures)} rejected field(s)/line(s): {named}", file=sys.stderr)
        return 1
    expected = derive_expected(parse_properties(args.properties))
    print("Release metadata contract OK: "
          f"{expected['VERSION_NAME']} (code {expected['VERSION_CODE']}, "
          f"tag {expected['VERSION_TAG']}, APK {expected['APK_ARMV7']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
