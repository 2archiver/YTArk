#!/usr/bin/env python3
"""Check the built userscript bundle against the checked-in bundle contract.

Both release workflows used to carry their own copy of this list. When the 2.9
settings work retired the ``YTARK_YTS_EDITOR`` command, ``ci.yml`` was updated
but ``build-apk.yml`` kept requiring the retired symbol, so every 2.9/2.9.1 run
failed in the userscript step — before the repack, signing, upload and
publication steps — and no 2.9 APK was ever produced. The list now lives in
``release/bundle-contract.json`` and this tool is the only consumer, so the two
workflows cannot drift apart again.

Usage::

    python3 tools/check_bundle_contract.py
    python3 tools/check_bundle_contract.py --bundle TizenTube/dist/userScript.js \\
        --contract release/bundle-contract.json

The exit status is a build gate: a missing required symbol, a surviving retired
symbol, a stray file or a markup rule match fails with the exact offending entry
named on stderr.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTRACT = ROOT / "release" / "bundle-contract.json"
DEFAULT_BUNDLE = ROOT / "TizenTube" / "dist" / "userScript.js"
SCHEMA = 1


class ContractError(ValueError):
    """The contract or the artifact under test is unusable."""


def _string_list(container: dict, key: str, where: str) -> list[str]:
    value = container.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ContractError(f"{where}.{key} must be a list of non-empty strings")
    return value


def load_contract(path: Path) -> dict:
    """Read and validate the contract itself before checking any artifact."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ContractError(f"the bundle contract is missing: {path}") from error
    except json.JSONDecodeError as error:
        raise ContractError(f"the bundle contract is not valid JSON ({path}): {error}") from error
    if not isinstance(raw, dict):
        raise ContractError("the bundle contract must be a JSON object")
    if raw.get("schema") != SCHEMA:
        raise ContractError(f"the bundle contract schema must be {SCHEMA}, got {raw.get('schema')!r}")

    bundle = raw.get("bundle")
    if not isinstance(bundle, dict):
        raise ContractError("bundle must be an object with required/forbidden lists")
    required = _string_list(bundle, "required", "bundle")
    forbidden = _string_list(bundle, "forbidden", "bundle")
    retired = _string_list(raw, "retiredActions", "retiredActions")
    if not required:
        raise ContractError("bundle.required must name at least one symbol to check")
    overlap = sorted(set(required) & set(forbidden))
    if overlap:
        raise ContractError(f"the contract contradicts itself; both required and forbidden: {overlap}")
    overlap = sorted(set(required) & set(retired))
    if overlap:
        raise ContractError(f"the contract contradicts itself; a retired action is required: {overlap}")

    files = raw.get("files", {})
    sources = raw.get("sources", {})
    if not isinstance(files, dict) or not isinstance(sources, dict):
        raise ContractError("files and sources must be objects when present")
    _string_list(files, "forbidden", "files")
    _string_list(sources, "forbidden", "sources")
    _string_list(sources, "excludeDirs", "sources")
    _string_list(sources, "excludeFiles", "sources")
    source_dir = sources.get("dir", "TizenTube/mods")
    if not isinstance(source_dir, str) or not source_dir:
        raise ContractError("sources.dir must be a non-empty path")
    if not (ROOT / source_dir).is_dir():
        raise ContractError(f"sources.dir does not exist: {source_dir}")

    for where, key in (("markup", "forbiddenPattern"), ("branding", "forbiddenPattern")):
        section = raw.get(where, {})
        if not isinstance(section, dict):
            raise ContractError(f"{where} must be an object")
        _string_list(section, "required", where)
        pattern = section.get(key)
        if pattern is None:
            continue
        if not isinstance(pattern, str) or not pattern:
            raise ContractError(f"{where}.{key} must be a non-empty string")
        try:
            re.compile(pattern)
        except re.error as error:
            raise ContractError(f"{where}.{key} is not a valid regular expression: {error}") from error
    return raw


def read_bundle(path: Path) -> str:
    if not path.is_file():
        raise ContractError(
            f"the built userscript is missing: {path}\n"
            "Build it first: cd TizenTube/mods && npm ci && npm run build"
        )
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        raise ContractError(f"the built userscript is empty: {path}")
    return text


def check_bundle(text: str, contract: dict, failures: list[str]) -> int:
    bundle = contract["bundle"]
    checked = 0
    for needle in bundle.get("required", []):
        checked += 1
        if needle not in text:
            failures.append(f"the bundle is missing the required symbol: {needle}")
    for needle in bundle.get("forbidden", []) + contract.get("retiredActions", []):
        checked += 1
        if needle in text:
            failures.append(f"the bundle still carries retired code: {needle}")
    return checked


def check_markup(text: str, contract: dict, failures: list[str]) -> None:
    markup = contract.get("markup")
    if not markup:
        return
    flags = re.IGNORECASE if markup.get("caseInsensitive") else 0
    pattern = re.compile(markup["forbiddenPattern"], flags)
    match = pattern.search(text)
    if match:
        failures.append(
            "the bundle carries text/raster/external logo content (matched "
            f"{match.group(0)!r}); the wordmark must stay vector geometry drawn locally"
        )


def check_branding(text: str, contract: dict, failures: list[str]) -> None:
    branding = contract.get("branding")
    if not branding:
        return
    for needle in branding.get("required", []):
        if needle not in text:
            failures.append(f"the bundle is missing required branding content: {needle}")
    pattern = branding.get("forbiddenPattern")
    if pattern:
        flags = re.IGNORECASE if branding.get("caseInsensitive") else 0
        if re.search(pattern, text, flags):
            failures.append("the bundle still carries the deprecated product branding")


def check_sources(contract: dict, failures: list[str]) -> None:
    files = contract.get("files", {})
    for relative in files.get("forbidden", []):
        if (ROOT / relative).exists():
            failures.append(f"a file retired in 2.5 is back in the sources: {relative}")

    sources = contract.get("sources")
    if not sources:
        return
    directory = ROOT / sources.get("dir", "TizenTube/mods")
    excluded_dirs = set(sources.get("excludeDirs", []))
    excluded_files = set(sources.get("excludeFiles", []))
    for path in sorted(directory.rglob("*.js")):
        relative = path.relative_to(directory)
        if excluded_dirs & set(relative.parts):
            continue
        if path.name in excluded_files:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for needle in sources.get("forbidden", []) + contract.get("retiredActions", []):
            if needle in text:
                failures.append(
                    f"removed functionality is still in the shipped sources: {needle} "
                    f"(packaged through {relative.as_posix()})"
                )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--contract", default=str(DEFAULT_CONTRACT), help="bundle contract JSON")
    parser.add_argument("--bundle", default=str(DEFAULT_BUNDLE), help="built userscript to check")
    args = parser.parse_args(argv)

    try:
        contract = load_contract(Path(args.contract))
        text = read_bundle(Path(args.bundle))
    except ContractError as error:
        print(f"bundle contract: {error}", file=sys.stderr)
        return 1

    failures: list[str] = []
    checked = check_bundle(text, contract, failures)
    check_markup(text, contract, failures)
    check_branding(text, contract, failures)
    check_sources(contract, failures)

    if failures:
        for failure in failures:
            print(f"bundle contract: {failure}", file=sys.stderr)
        print(
            f"bundle contract: FAILED with {len(failures)} problem(s); "
            f"checked {checked} symbols in {Path(args.bundle).name}",
            file=sys.stderr,
        )
        return 1

    print(
        f"Bundle contract OK: {checked} symbols in {Path(args.bundle).name} "
        f"({len(text)} characters), contract {Path(args.contract).name}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
