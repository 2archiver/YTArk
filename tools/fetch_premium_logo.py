#!/usr/bin/env python3
"""Fetch, verify and sanitize the YouTube Premium 2024 vector wordmark.

Source (pinned, public domain on Wikimedia Commons — simple geometry and
non-copyrightable lettering; trademarks remain with Google LLC):

    https://commons.wikimedia.org/wiki/File:YouTube_Premium_logo_2024.svg
    https://upload.wikimedia.org/wikipedia/commons/8/88/YouTube_Premium_logo_2024.svg

The asset is fetched once at build time (CI or a developer machine) and never at
runtime. The userscript bundles the sanitized geometry; no device requests the
logo from Wikimedia or from any other external image host.

The download is verified against the SHA-1 that Wikimedia Commons records for
this exact revision (3561 bytes, 101x20 nominal pixels). A different byte
stream — a re-upload, a mirror or a preview render — is rejected instead of
being silently accepted.

Outputs (inside --out-dir):

    youtube-premium-logo-2024.source.svg       byte-exact original download
    youtube-premium-logo-2024.svg              sanitized, self-contained vector
    youtube-premium-logo-2024.provenance.json  provenance, hashes, sanitization log

Usage:

    python3 tools/fetch_premium_logo.py --out-dir TizenTube/mods/assets
    python3 tools/fetch_premium_logo.py --verify-only --out-dir TizenTube/mods/assets
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

SOURCE_PAGE = "https://commons.wikimedia.org/wiki/File:YouTube_Premium_logo_2024.svg"
SOURCE_URL = (
    "https://upload.wikimedia.org/wikipedia/commons/8/88/YouTube_Premium_logo_2024.svg"
)
SOURCE_API = (
    "https://commons.wikimedia.org/w/api.php?action=query&format=json"
    "&prop=imageinfo&iiprop=url%7Csize%7Csha1%7Cmime"
    "&titles=File:YouTube_Premium_logo_2024.svg"
)
SOURCE_SHA1 = "9ec3ad62f293d10e98cb637d0303a7e7e4188947"
SOURCE_SIZE = 3561
SOURCE_WIDTH = 101
SOURCE_HEIGHT = 20
LICENSE = (
    "Public domain on Wikimedia Commons (PD-simple / PD-text: simple geometry and "
    "non-copyrightable lettering). Trademark rights remain with Google LLC; the mark "
    "is rendered locally as a cosmetic header preference only."
)

FORBIDDEN_TAGS = {
    "script", "foreignobject", "iframe", "audio", "video", "canvas", "animate",
    "animatetransform", "animatemotion", "set", "handler", "use", "image",
    "filter", "mask", "font", "font-face", "@font-face",
}
IGNORED_TAGS = {"title", "desc", "metadata", "defs", "style", "namedview", "sodipodi:namedview"}
DRAWABLE_TAGS = {"path", "polygon", "polyline", "rect", "circle", "ellipse", "line"}
FORBIDDEN_ATTRIBUTE_VALUES = re.compile(
    r"(?i)(javascript:|data:text/html|<script|<!entity|<!doctype)"
)
EXTERNAL_REFERENCE = re.compile(r"(?i)(https?:)?//|@import")
FORBIDDEN_RASTER = re.compile(r"(?i)data:image/(?:png|jpe?g|gif|webp)")

GEOMETRY_ATTRIBUTES = {
    "d", "transform", "fill", "fill-rule", "clip-rule", "stroke", "stroke-width",
    "stroke-linejoin", "stroke-linecap", "opacity", "fill-opacity", "stroke-opacity",
    "points", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "style",
}
PAINT_TOKENS = re.compile(r"(?i)(fill|stroke)\s*:")


def log(message: str) -> None:
    print(f"[premium-logo] {message}")


def sha1_of(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download(url: str, timeout: int = 120) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": "YTArk-build/1.0 (vector asset provenance check)"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def verify_bytes(data: bytes, *, expected_sha1: str | None, expected_size: int | None) -> None:
    if expected_size is not None and len(data) != expected_size:
        raise SystemExit(
            f"ERROR: the downloaded asset is {len(data)} bytes; Commons records "
            f"{expected_size} bytes for this revision. Refusing an unverified file."
        )
    if expected_sha1 is not None:
        actual = sha1_of(data)
        if actual != expected_sha1:
            raise SystemExit(
                f"ERROR: SHA-1 mismatch for the Wikimedia asset: got {actual}, expected "
                f"{expected_sha1}. The file may have been re-uploaded; review the change "
                f"before updating SOURCE_SHA1."
            )
    log(f"verified SHA-1 {expected_sha1} and size {len(data)} bytes")


def reject_unsafe(text: str, label: str) -> None:
    lowered = text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise SystemExit(f"ERROR: {label} contains a DTD/entity declaration.")
    match = FORBIDDEN_ATTRIBUTE_VALUES.search(text)
    if match:
        raise SystemExit(f"ERROR: {label} contains active content: {match.group(0)!r}")
    if "<script" in lowered:
        raise SystemExit(f"ERROR: {label} contains a <script> element.")
    if FORBIDDEN_RASTER.search(text):
        raise SystemExit(f"ERROR: {label} embeds raster image data.")


def parse_style_rules(style_text: str) -> dict[str, dict[str, str]]:
    """Parse the small class -> declaration map Illustrator-style exports use."""
    rules: dict[str, dict[str, str]] = {}
    for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", style_text):
        properties: dict[str, str] = {}
        for declaration in declarations.split(";"):
            if ":" not in declaration:
                continue
            name, value = declaration.split(":", 1)
            properties[name.strip().lower()] = value.strip()
        if not properties:
            continue
        for single in selector.split(","):
            for class_name in re.findall(r"\.([A-Za-z0-9_-]+)", single):
                rules.setdefault(class_name, {}).update(properties)
    return rules


def element_style(element: ET.Element, rules: dict[str, dict[str, str]]) -> dict[str, str]:
    """Merge class rules with presentation attributes (attributes win)."""
    merged: dict[str, str] = {}
    for class_name in str(element.get("class", "")).split():
        merged.update(rules.get(class_name, {}))
    for name, value in element.attrib.items():
        if name in GEOMETRY_ATTRIBUTES:
            merged[name] = value
    style = str(merged.pop("style", ""))
    for declaration in style.split(";"):
        if ":" not in declaration:
            continue
        name, value = declaration.split(":", 1)
        merged[name.strip().lower()] = value.strip()
    return {name: value for name, value in merged.items() if value}


def flatten(root: ET.Element, rules: dict[str, dict[str, str]]) -> list[dict]:
    """Return drawable elements in document order with inherited paint/transform."""
    shapes: list[dict] = []

    def walk(node: ET.Element, inherited: dict[str, str], inherited_transform: str) -> None:
        if not isinstance(node.tag, str):
            return
        tag = node.tag.split("}")[-1].lower()
        if tag in FORBIDDEN_TAGS:
            raise SystemExit(f"ERROR: the source SVG contains a forbidden <{tag}> element.")
        if tag == "svg" and node is root:
            for child in list(node):
                walk(child, inherited, inherited_transform)
            return
        if tag in IGNORED_TAGS:
            return
        for name in node.attrib:
            lowered = name.split("}")[-1].lower()
            if lowered.startswith("on"):
                raise SystemExit(
                    f"ERROR: the source SVG carries an event handler attribute: {name}"
                )
            if lowered in {"href", "src"}:
                raise SystemExit(
                    f"ERROR: the source SVG references another resource: {name}"
                )
        style = dict(inherited)
        style.update(element_style(node, rules))
        transform = style.pop("transform", "")
        combined = " ".join(part for part in (inherited_transform, transform) if part)
        if tag in DRAWABLE_TAGS:
            entry = dict(style)
            if combined:
                entry["transform"] = combined
            entry["tag"] = tag
            entry["removed_hooks"] = [
                name for name in ("id", "class") if node.get(name)
            ]
            shapes.append(entry)
            return
        if tag != "g":
            raise SystemExit(f"ERROR: unexpected SVG element <{tag}> in the source asset.")
        for child in list(node):
            walk(child, style, combined)

    walk(root, {}, "")
    return shapes


def rebuild_svg(shapes: list[dict], view_box: str) -> str:
    """Emit a deterministic, self-contained SVG that keeps the source geometry."""
    lines = [
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{view_box}" width="{SOURCE_WIDTH}" height="{SOURCE_HEIGHT}">'
    ]
    for entry in shapes:
        attributes = []
        for name in ("transform", "d", "points", "x", "y", "width", "height",
                     "cx", "cy", "r", "rx", "ry"):
            if entry.get(name) is not None:
                attributes.append(f'{name}="{entry[name]}"')
        for name in ("fill", "fill-rule", "clip-rule", "stroke", "stroke-width"):
            if entry.get(name) is not None:
                attributes.append(f'{name}="{entry[name]}"')
        if not any(attribute.startswith("fill=") for attribute in attributes):
            attributes.append('fill="#000000"')
        lines.append(f"<{entry['tag']} {' '.join(attributes)}/>")
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def sanitize(raw: bytes, source_label: str) -> tuple[str, dict]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SystemExit(f"ERROR: the source SVG is not UTF-8 XML: {error}") from error
    reject_unsafe(text, source_label)
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise SystemExit(f"ERROR: the source is not valid SVG XML: {error}") from error
    if root.tag.split("}")[-1].lower() != "svg":
        raise SystemExit("ERROR: the downloaded file is not an SVG document root.")

    view_box = str(root.get("viewBox", "")).strip()
    if not view_box:
        raise SystemExit("ERROR: the source SVG has no viewBox to preserve.")
    numbers = [float(value) for value in re.split(r"[,\s]+", view_box) if value]
    if len(numbers) != 4 or numbers[2] <= 0 or numbers[3] <= 0:
        raise SystemExit(f"ERROR: the source viewBox is unusable: {view_box!r}")

    rules: dict[str, dict[str, str]] = {}
    for node in root.iter():
        if not isinstance(node.tag, str):
            continue
        if node.tag.split("}")[-1].lower() == "style":
            reject_unsafe(node.text or "", "an embedded <style> block")
            rules.update(parse_style_rules(node.text or ""))
    log(f"resolved {len(rules)} class rule(s) from the embedded stylesheet")

    shapes = flatten(root, rules)
    if not shapes:
        raise SystemExit("ERROR: the source SVG contains no drawable geometry.")

    sanitized = rebuild_svg(shapes, view_box)
    reject_unsafe(sanitized, "the sanitized asset")
    references = EXTERNAL_REFERENCE.search(re.sub(r"xmlns=\"[^\"]*\"", "", sanitized))
    if references:
        raise SystemExit(
            f"ERROR: the sanitized asset still references an external resource: "
            f"{references.group(0)!r}"
        )
    report = {"viewBox": view_box, "elements": shapes}
    return sanitized, report


def structure_report(path: Path) -> dict:
    """Describe the bundled asset so a reviewer can audit the geometry."""
    root = ET.parse(path).getroot()
    report = {"viewBox": root.get("viewBox", ""), "elements": []}
    for node in root.iter():
        if not isinstance(node.tag, str):
            continue
        tag = node.tag.split("}")[-1].lower()
        if tag == "svg":
            continue
        entry = {"tag": tag}
        for name, value in node.attrib.items():
            if name == "d":
                entry["subpaths"] = value.count("M") + value.count("m")
            entry[name] = value
        report["elements"].append(entry)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, help="directory for the bundled assets")
    parser.add_argument("--url", default=SOURCE_URL)
    parser.add_argument("--verify-only", action="store_true",
                        help="re-verify the checked-in asset without downloading")
    parser.add_argument("--allow-revision-change", action="store_true",
                        help="skip the pinned SHA-1 comparison (requires review)")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sanitized_path = out_dir / "youtube-premium-logo-2024.svg"
    source_path = out_dir / "youtube-premium-logo-2024.source.svg"
    provenance_path = out_dir / "youtube-premium-logo-2024.provenance.json"

    if args.verify_only:
        if not sanitized_path.is_file() or not provenance_path.is_file():
            raise SystemExit("ERROR: the bundled asset or its provenance file is missing.")
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        if provenance.get("source_page") != SOURCE_PAGE:
            raise SystemExit("ERROR: the bundled asset provenance points elsewhere.")
        data = sanitized_path.read_bytes()
        if sha256_of(data) != provenance.get("sanitized_sha256"):
            raise SystemExit("ERROR: the bundled vector asset does not match its provenance.")
        log(f"bundled asset verified ({len(data)} bytes, {provenance['sanitized_sha256']})")
        print(json.dumps(structure_report(sanitized_path), indent=2))
        return

    raw = download(args.url)
    log(f"downloaded {len(raw)} bytes from {args.url}")
    expected_sha1 = None if args.allow_revision_change else SOURCE_SHA1
    expected_size = None if args.allow_revision_change else SOURCE_SIZE
    verify_bytes(raw, expected_sha1=expected_sha1, expected_size=expected_size)

    sanitized, report = sanitize(raw, "the downloaded SVG")
    source_path.write_bytes(raw)
    sanitized_path.write_text(sanitized, encoding="utf-8")
    provenance = {
        "title": "YouTube Premium logo 2024",
        "author": "Google, Inc.",
        "source_page": SOURCE_PAGE,
        "source_metadata_api": SOURCE_API,
        "source_url": args.url,
        "retrieved_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "retrieved_sha1": sha1_of(raw),
        "retrieved_sha256": sha256_of(raw),
        "retrieved_bytes": len(raw),
        "sanitized_sha256": sha256_of(sanitized.encode("utf-8")),
        "sanitized_bytes": len(sanitized.encode("utf-8")),
        "viewBox": report["viewBox"],
        "nominal_width": SOURCE_WIDTH,
        "nominal_height": SOURCE_HEIGHT,
        "license": LICENSE,
        "trademark_notice": (
            "YouTube and YouTube Premium are trademarks of Google LLC. YTArk renders "
            "the mark locally as a cosmetic header preference and is not affiliated "
            "with, endorsed by, or entitled by Google or YouTube."
        ),
        "sanitization": [
            "rejected DTD/entity declarations, scripts and active content",
            "resolved embedded <style> class rules into explicit paint attributes",
            "flattened group transforms onto their drawable children",
            "dropped id/class hooks that are not needed for painting",
            "kept viewBox, path data, transforms and paint rules verbatim",
            "kept no external references, scripts, raster fallbacks or fonts",
        ],
        "elements": [
            {
                "tag": entry["tag"],
                "fill": entry.get("fill", ""),
                "transform": entry.get("transform", ""),
                "subpaths": (entry.get("d", "").count("M") + entry.get("d", "").count("m"))
                if entry.get("d") else 0,
                "removed_hooks": entry.get("removed_hooks", []),
            }
            for entry in report["elements"]
        ],
    }
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {sanitized_path.name}, {source_path.name}, {provenance_path.name}")
    print(json.dumps(structure_report(sanitized_path), indent=2))


if __name__ == "__main__":
    main()
