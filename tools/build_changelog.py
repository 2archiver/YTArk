#!/usr/bin/env python3
"""Single source of truth for the YTArk changelog.

``CHANGELOG.md`` at the repository root is parsed into one structured model
that feeds the JS reader, native Updates screen and release notes:

* the bundled, offline in-app reader data
  (``TizenTube/mods/assets/changelog.generated.js``), and
* the native offline summaries/details (``ReleaseHighlights.generated.kt``), and
* the "What changed in this release" section of the GitHub release notes
  (``tools/render_release_notes.sh``).

Usage::

    python3 tools/build_changelog.py --write            # regenerate the bundled module
    python3 tools/build_changelog.py --check            # validate + fail if the module is stale
    python3 tools/build_changelog.py release-notes --version 2.3.0
    python3 tools/build_changelog.py json               # print the parsed model

Format (validated)::

    ## [2.2.0] — 2026-10-11            published version (UTC publication date)
    ## [2.3.0] — Unreleased            changes not yet published (newest only)
    > Published 2026-10-11 11:01 UTC as [YTArk 2.2](https://github.com/...) · tag `v2.2.0` · versionCode 2020000 · userscript `s21` · ARMv7 APK
    Optional one-paragraph summary.
    ### Added | Changed | Fixed | Removed | Security | Defaults and migration | Known limitations | Validation | Notes
    - bullet (continuation lines indented by two spaces, one nested level)
    ## Any other title                 a note section (drafts, upstream attribution)
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANGELOG = ROOT / "CHANGELOG.md"
OUTPUT = ROOT / "TizenTube" / "mods" / "assets" / "changelog.generated.js"
NATIVE_OUTPUT = ROOT / "android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/ReleaseHighlights.generated.kt"
SUMMARY_FALLBACK = "No short highlights available for this version."
VERSION_FILE = ROOT / "release" / "version.properties"

SCHEMA = 1
SECTION_ORDER = (
    "Added",
    "Changed",
    "Defaults and migration",
    "Fixed",
    "Removed",
    "Security",
    "Known limitations",
    "Validation",
    "Notes",
)
VERSION_HEADER = re.compile(
    r"^##\s+\[(?P<version>\d+\.\d+\.\d+(?:-(?:ytark|personal)\.[1-9]\d*)?)\]\s*[—–-]\s*"
    r"(?P<when>\d{4}-\d{2}-\d{2}|Unreleased)\s*$"
)
NOTE_HEADER = re.compile(r"^##\s+(?P<title>[^\[].*?)\s*$")
SECTION_HEADER = re.compile(r"^###\s+(?P<title>.+?)\s*$")
BULLET = re.compile(r"^(?P<indent>\s*)-\s+(?P<text>.+?)\s*$")
HISTORICAL = re.compile(r"^(?P<semver>\d+\.\d+\.\d+)-(?:ytark|personal)\.(?P<serial>[1-9]\d*)$")
CLEAN = re.compile(r"^(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)$")
RELEASE_URL = re.compile(r"\((https://github\.com/2archiver/YTArk/releases/tag/(v[^)\s]+))\)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
DEPRECATED_BRANDING = re.compile(r"personal\s+tube\s+tv", re.I)


class ChangelogError(ValueError):
    """CHANGELOG.md does not follow the documented structure."""


def version_key(version: str) -> tuple[int, int, int, int, int]:
    historical = HISTORICAL.fullmatch(version)
    clean = historical.group("semver") if historical else version
    match = CLEAN.fullmatch(clean)
    if not match:
        raise ChangelogError(f"Invalid version: {version}")
    major, minor, patch = (int(match.group(name)) for name in ("major", "minor", "patch"))
    return (major, minor, patch, 0 if historical else 1, int(historical.group("serial")) if historical else 0)


def display_version(version: str) -> str:
    match = CLEAN.fullmatch(version)
    if match and match.group("patch") == "0":
        return f"{match.group('major')}.{match.group('minor')}"
    return version


def plain_text(markdown: str) -> str:
    """Markdown inline text -> plain text for the TV reader (no markup survives)."""
    text = LINK.sub(lambda m: m.group(1), markdown)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


def short_summary(value: str) -> str:
    """One shared, TV-sized summary for Kotlin Updates and the JS About reader.

    Use only the maintained summary, never a verbose release body or metadata.
    Word boundaries are preserved; even an unbroken oversized token is omitted.
    """
    text = html.unescape(value)
    text = re.sub(r"<!--.*?-->|<[^>]*>", "", text, flags=re.S)
    text = re.sub(r"(?m)^\s*(?:#{1,6}|[-*+]|\d+[.)])\s+", "", text)
    text = plain_text(text)
    text = re.sub(r"[\x00-\x1f\x7f<>*_~#]", "", text).strip()
    words = text.split()
    kept = []
    for word in words[:40]:
        if len(" ".join(kept + [word])) > 239:
            break
        kept.append(word)
    if not kept:
        return SUMMARY_FALLBACK
    return " ".join(kept) + ("…" if len(kept) < len(words) else "")


def parse_metadata(line: str, version: str) -> dict:
    body = line[1:].strip()
    meta: dict = {"raw": body}
    published = re.search(r"Published (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC", body)
    if published:
        meta["publishedAt"] = published.group(1).replace(" ", "T") + "Z"
    tag = re.search(r"tag `(v[^`]+)`", body)
    if tag:
        meta["tag"] = tag.group(1)
    code = re.search(r"versionCode (\d+)", body)
    if code:
        meta["versionCode"] = int(code.group(1))
    script = re.search(r"userscript `(s\d+)`", body)
    if script:
        meta["scriptTag"] = script.group(1)
    url = RELEASE_URL.search(body)
    if url:
        meta["releaseUrl"] = url.group(1)
        if url.group(2) != meta.get("tag", url.group(2)):
            raise ChangelogError(f"{version}: release link tag {url.group(2)} differs from tag {meta.get('tag')}")
    title = LINK.search(body)
    if title:
        meta["title"] = title.group(1)
    return meta


def parse(text: str) -> dict:
    entries: list[dict] = []
    notes: list[dict] = []
    current: dict | None = None
    section: dict | None = None
    item_target: list | None = None
    in_preamble = True

    def close_item_target():
        nonlocal item_target
        item_target = None

    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip()
        if not line.strip():
            close_item_target()
            continue
        if line.startswith("# ") and in_preamble:
            continue
        version_match = VERSION_HEADER.match(line)
        if version_match:
            in_preamble = False
            version = version_match.group("version")
            when = version_match.group("when")
            current = {
                "kind": "version",
                "version": version,
                "display": display_version(version),
                "status": "unreleased" if when == "Unreleased" else "published",
                "date": None if when == "Unreleased" else when,
                "summary": "",
                "sections": [],
                "meta": {},
                "line": number,
            }
            entries.append(current)
            section = None
            close_item_target()
            continue
        note_match = NOTE_HEADER.match(line) if line.startswith("## ") else None
        if note_match:
            in_preamble = False
            current = {"kind": "note", "title": note_match.group("title"), "items": [], "line": number}
            notes.append(current)
            section = None
            close_item_target()
            continue
        if in_preamble or current is None:
            continue
        if line.startswith("> ") and current["kind"] == "version":
            if current["meta"]:
                raise ChangelogError(f"line {number}: {current['version']} has more than one metadata line")
            current["meta"] = parse_metadata(line, current["version"])
            continue
        section_match = SECTION_HEADER.match(line)
        if section_match:
            if current["kind"] != "version":
                raise ChangelogError(f"line {number}: sub-sections are only allowed inside versions")
            title = section_match.group("title")
            if title not in SECTION_ORDER:
                raise ChangelogError(f"line {number}: unknown section '{title}' (allowed: {', '.join(SECTION_ORDER)})")
            if any(existing["heading"] == title for existing in current["sections"]):
                raise ChangelogError(f"line {number}: duplicate section '{title}' in {current['version']}")
            section = {"heading": title, "items": [], "markdown": []}
            current["sections"].append(section)
            close_item_target()
            continue
        bullet = BULLET.match(line)
        if bullet:
            nested = len(bullet.group("indent")) >= 2
            text_value = bullet.group("text")
            target = section if current["kind"] == "version" else current
            if target is None:
                raise ChangelogError(f"line {number}: bullet outside a section in {current.get('version')}")
            if nested and not target["items"]:
                raise ChangelogError(f"line {number}: nested bullet without a parent")
            item = {"text": text_value, "nested": nested}
            target["items"].append(item)
            item_target = [item]
            continue
        if raw.startswith("  ") and item_target:
            item_target[0]["text"] += " " + line.strip()
            continue
        if current["kind"] == "version" and section is None:
            current["summary"] = (current["summary"] + " " + line.strip()).strip()
            continue
        raise ChangelogError(f"line {number}: unexpected text '{line.strip()[:60]}'")

    return {"entries": entries, "notes": notes}


def validate(model: dict, configured_version: str | None = None) -> None:
    entries = model["entries"]
    if not entries:
        raise ChangelogError("CHANGELOG.md has no version entries")
    seen = set()
    for entry in entries:
        version = entry["version"]
        if version in seen:
            raise ChangelogError(f"duplicate version {version}")
        seen.add(version)
        meta = entry["meta"]
        if not meta:
            raise ChangelogError(f"{version}: missing the '> ' metadata line")
        expected_tag = f"v{version}"
        if meta.get("tag") != expected_tag:
            raise ChangelogError(f"{version}: metadata tag must be `{expected_tag}`")
        if "versionCode" not in meta or "scriptTag" not in meta:
            raise ChangelogError(f"{version}: metadata needs versionCode and userscript tag")
        if entry["status"] == "published":
            if "publishedAt" not in meta or not meta["publishedAt"].startswith(entry["date"]):
                raise ChangelogError(f"{version}: published entries need 'Published <date> <time> UTC' matching the header date")
            if "releaseUrl" not in meta:
                raise ChangelogError(f"{version}: published entries must link their GitHub release")
        elif "publishedAt" in meta:
            raise ChangelogError(f"{version}: an unreleased entry cannot carry a publication time")
        # A version is either a full entry with sections or a one-line summary
        # (the simplified, user-facing history for older releases). It may not
        # be an empty heading.
        if not entry["summary"] and not any(section["items"] for section in entry["sections"]):
            raise ChangelogError(f"{version}: needs a summary line or a section with items")
    keys = [version_key(entry["version"]) for entry in entries]
    if keys != sorted(keys, reverse=True):
        raise ChangelogError("versions must be listed newest first")
    unreleased = [entry for entry in entries if entry["status"] == "unreleased"]
    if len(unreleased) > 1 or (unreleased and entries[0] is not unreleased[0]):
        raise ChangelogError("only the newest entry may be Unreleased")
    newest = entries[0]
    if newest["status"] == "unreleased" and not any(section["items"] for section in newest["sections"]):
        # The newest entry is the source of the GitHub release notes, so it
        # keeps the real sectioned notes even though older versions are one-liners.
        raise ChangelogError(f"{newest['version']}: the newest entry needs sections with items for the release notes")
    for entry in entries + model["notes"]:
        items = entry.get("items", []) + [item for section in entry.get("sections", []) for item in section["items"]]
        texts = [item["text"] for item in items] + [entry.get("summary", ""), entry.get("meta", {}).get("raw", "")]
        for value in texts:
            if "<" in value or ">" in value:
                raise ChangelogError(f"{entry.get('version', entry.get('title'))}: use plain text, not angle brackets: {value[:60]}")
            if DEPRECATED_BRANDING.search(value):
                raise ChangelogError(f"{entry.get('version', entry.get('title'))}: deprecated product branding")
    if configured_version and configured_version not in seen:
        raise ChangelogError(f"release/version.properties versionName {configured_version} has no CHANGELOG.md entry")


def configured_version() -> str | None:
    if not VERSION_FILE.exists():
        return None
    for raw in VERSION_FILE.read_text(encoding="utf-8").splitlines():
        if raw.startswith("versionName="):
            return raw.split("=", 1)[1].strip()
    return None


def bundle_model(model: dict, source_text: str) -> dict:
    def section_out(section: dict) -> dict:
        return {
            "heading": section["heading"],
            "items": [("– " if item["nested"] else "") + plain_text(item["text"]) for item in section["items"]],
        }

    entries = []
    for entry in model["entries"]:
        meta = entry["meta"]
        entries.append({
            "version": entry["version"],
            "display": entry["display"],
            "status": entry["status"],
            "date": entry["date"],
            "publishedAt": meta.get("publishedAt"),
            "tag": meta.get("tag"),
            "versionCode": meta.get("versionCode"),
            "scriptTag": meta.get("scriptTag"),
            "title": meta.get("title") or f"YTArk {entry['display']}",
            "releaseUrl": meta.get("releaseUrl"),
            "facts": plain_text(meta.get("raw", "")),
            "summary": short_summary(entry["summary"]),
            "sections": [section_out(section) for section in entry["sections"]],
        })
    notes = [{"title": note["title"], "items": [plain_text(item["text"]) for item in note["items"]]}
             for note in model["notes"]]
    return {
        "schema": SCHEMA,
        "source": "CHANGELOG.md",
        "summaryFallback": SUMMARY_FALLBACK,
        "sourceSha256": hashlib.sha256(source_text.encode("utf-8")).hexdigest(),
        "entries": entries,
        "notes": notes,
    }


def render_module(model: dict, source_text: str) -> str:
    payload = json.dumps(bundle_model(model, source_text), ensure_ascii=False, indent=2)
    return (
        "// Generated by tools/build_changelog.py from CHANGELOG.md. Do not edit by hand:\n"
        "// edit CHANGELOG.md, then run `python3 tools/build_changelog.py --write`.\n"
        f"export const YTARK_CHANGELOG = {payload};\n"
        "export default YTARK_CHANGELOG;\n"
    )


def render_native(model: dict, source_text: str) -> str:
    """Native offline notes use exactly the same summary field as the JS bundle."""
    def quote(value: str) -> str:
        return json.dumps(value, ensure_ascii=False).replace("$", "\\$")

    entries = bundle_model(model, source_text)["entries"]
    summaries = []
    details = []
    for entry in entries:
        summaries.append(f'        {quote(entry["version"])} to {quote(entry["summary"])}')
        lines = [entry["summary"]]
        for section in entry["sections"]:
            lines += [section["heading"]] + ["• " + item for item in section["items"]]
        details.append(f'        {quote(entry["version"])} to {quote(chr(10).join(lines))}')
    return (
        "// Generated by tools/build_changelog.py from CHANGELOG.md. Do not edit.\n"
        "package io.github.twoarchiver.ytark.updater\n\n"
        "object ReleaseHighlights {\n"
        f"    const val FALLBACK = {quote(SUMMARY_FALLBACK)}\n"
        "    private val summaries = mapOf(\n" + ",\n".join(summaries) + "\n    )\n"
        "    private val details = mapOf(\n" + ",\n".join(details) + "\n    )\n"
        '    fun summary(version: String) = summaries[version.removePrefix("v")] ?: FALLBACK\n'
        '    fun details(version: String) = details[version.removePrefix("v")]\n'
        "}\n"
    )


def release_notes_section(model: dict, version: str) -> str:
    entry = next((item for item in model["entries"] if item["version"] == version), None)
    if entry is None:
        raise ChangelogError(f"CHANGELOG.md has no entry for {version}")
    # Release pages are summaries, not copies of the technical changelog.
    lines = [entry["summary"], ""] if entry["summary"] else []
    bullets = []
    priority = {"Fixed": 0, "Changed": 1, "Added": 2, "Removed": 3, "Security": 4}
    for section in sorted(entry["sections"], key=lambda part: priority.get(part["heading"], 9)):
        if section["heading"] not in ("Added", "Changed", "Fixed", "Removed", "Security"):
            continue
        for item in section["items"]:
            if item["nested"]:
                continue
            text = item["text"]
            headline = re.match(r"\*\*(.+?)\*\*", text)
            sentence = headline.group(1) if headline else re.split(r"(?<=[.!?])\s+", text)[0]
            # Never truncate a sentence into a misleading claim. Long technical
            # items stay in CHANGELOG.md rather than the public release body.
            if len(sentence.split()) <= 16 and sentence not in bullets:
                bullets.append(sentence)
            if len(bullets) == 3:
                break
        if len(bullets) == 3:
            break
    lines.extend("- " + bullet for bullet in bullets)
    if len(bullets) != 3 or len(" ".join(lines).split()) > 65:
        raise ChangelogError("Release notes need three concise change sentences and a short summary (65 words maximum).")
    return "\n".join(lines).rstrip() + "\n"



def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load(path: Path = CHANGELOG) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    model = parse(text)
    validate(model, configured_version())
    return model, text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="regenerate the bundled module")
    parser.add_argument("--check", action="store_true", help="fail when the bundled module is stale")
    sub = parser.add_subparsers(dest="command")
    notes = sub.add_parser("release-notes", help="print the What changed section for a version")
    notes.add_argument("--version", required=True)
    sub.add_parser("json", help="print the parsed model")
    args = parser.parse_args(argv)

    try:
        model, text = load()
    except (OSError, ChangelogError) as error:
        print(f"CHANGELOG.md is invalid: {error}", file=sys.stderr)
        return 1

    if args.command == "release-notes":
        try:
            sys.stdout.write(release_notes_section(model, args.version))
        except ChangelogError as error:
            print(error, file=sys.stderr)
            return 1
        return 0
    if args.command == "json":
        print(json.dumps(bundle_model(model, text), ensure_ascii=False, indent=2))
        return 0

    outputs = {OUTPUT: render_module(model, text), NATIVE_OUTPUT: render_native(model, text)}
    for path, expected in outputs.items():
        if args.write:
            path.write_text(expected, encoding="utf-8")
            print(f"Wrote {display_path(path)} ({len(model['entries'])} versions).")
        elif not path.exists() or path.read_text(encoding="utf-8") != expected:
            print(f"{display_path(path)} is stale: run `python3 tools/build_changelog.py --write`.", file=sys.stderr)
            return 1
    if not args.write:
        print(f"Changelog modules are current ({len(model['entries'])} versions, newest {model['entries'][0]['version']}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
