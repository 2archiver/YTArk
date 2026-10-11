#!/usr/bin/env python3
"""Generate the bundled vector data module from the verified Premium wordmark.

Input : TizenTube/mods/assets/youtube-premium-logo-2024.svg   (sanitized vector)
        TizenTube/mods/assets/youtube-premium-logo-2024.provenance.json
Output: TizenTube/mods/assets/youtubePremiumLogo.generated.js

The generated module is the *only* thing the userscript imports at runtime, so
the geometry is bundled inside the script bundle: no runtime request, no
`<img>`, no font and no provider asset is involved.

Paint classification (explicit, deterministic and auditable):

  red            -> `icon-red`   keeps the source colour verbatim
  white          -> `icon-white` keeps the source colour verbatim
  anything else  -> `ink`        painted with the theme ink token
                                 (`currentColor` on the wrapper)

The icon therefore never changes colour between themes, while the lettering
follows the native header foreground. Path data, transforms and ordering are
copied byte-for-byte from the sanitized source; nothing is retyped, traced or
re-drawn.

Usage:
    python3 tools/build_logo_asset.py                 # write the module
    python3 tools/build_logo_asset.py --check         # fail if it is out of date
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "TizenTube" / "mods" / "assets"
SOURCE_SVG = ASSET_DIR / "youtube-premium-logo-2024.svg"
PROVENANCE = ASSET_DIR / "youtube-premium-logo-2024.provenance.json"
GENERATED = ASSET_DIR / "youtubePremiumLogo.generated.js"

SHAPE_TAGS = ("path", "polygon", "polyline", "rect", "circle", "ellipse", "line")
GEOMETRY_ORDER = ("transform", "d", "points", "x", "y", "width", "height",
                  "cx", "cy", "r", "rx", "ry")
NAMED_COLOURS = {
    "white": (255, 255, 255), "black": (0, 0, 0), "red": (255, 0, 0),
    "none": None,
}


def parse_colour(value: str | None):
    """Return (r, g, b) in 0..255, or None for `none`/unparsable paints."""
    if value is None:
        return None
    text = value.strip().lower()
    if text in NAMED_COLOURS:
        return NAMED_COLOURS[text]
    hex_match = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", text)
    if hex_match:
        digits = hex_match.group(1)
        if len(digits) == 3:
            digits = "".join(character * 2 for character in digits)
        return tuple(int(digits[index:index + 2], 16) for index in (0, 2, 4))
    rgb_match = re.fullmatch(r"rgba?\(([^)]*)\)", text)
    if rgb_match:
        parts = [part.strip() for part in rgb_match.group(1).split(",")]
        if len(parts) >= 3:
            try:
                return tuple(int(round(float(part))) for part in parts[:3])
            except ValueError:
                return None
    return None


def classify(fill: str | None) -> str:
    rgb = parse_colour(fill)
    if rgb is None:
        return "ink"
    red, green, blue = rgb
    if red >= 150 and green <= 90 and blue <= 90:
        return "icon-red"
    if min(rgb) >= 229:
        return "icon-white"
    return "ink"


def js_string(value: str) -> str:
    """Quote a string for a JavaScript module (no templating, ES5-safe)."""
    escaped = (value.replace("\\", "\\\\").replace("'", "\\'")
               .replace("\n", "\\n").replace("\r", "\\r"))
    return f"'{escaped}'"


def collect_paths(svg_path: Path) -> list[dict]:
    root = ET.parse(svg_path).getroot()
    paths: list[dict] = []
    for node in root.iter():
        if not isinstance(node.tag, str):
            continue
        tag = node.tag.split("}")[-1].lower()
        if tag == "svg":
            continue
        if tag == "g":
            continue
        if tag not in SHAPE_TAGS:
            raise SystemExit(f"ERROR: the bundled asset contains an unsupported <{tag}> node.")
        fill = node.get("fill")
        entry = {
            "tag": tag,
            "paint": classify(fill),
            "fill": (fill or "#000000"),
            "geometry": [(name, node.get(name)) for name in GEOMETRY_ORDER if node.get(name)],
        }
        if not any(name == "d" or name == "points" for name, _value in entry["geometry"]):
            # Non path-based primitives are tolerated only when they carry real geometry.
            if not any(name in {"x", "y", "cx", "cy", "width", "height", "r", "rx", "ry", "points"}
                       for name, _value in entry["geometry"]):
                raise SystemExit(f"ERROR: a <{tag}> in the bundled asset has no geometry.")
        paths.append(entry)
    if not paths:
        raise SystemExit("ERROR: the bundled asset contains no drawable geometry.")
    if not any(entry["paint"] == "icon-red" for entry in paths):
        raise SystemExit("ERROR: the bundled asset has no red play emblem to preserve.")
    if not any(entry["paint"] == "icon-white" for entry in paths):
        raise SystemExit("ERROR: the bundled asset has no white play triangle to preserve.")
    if not any(entry["paint"] == "ink" for entry in paths):
        raise SystemExit("ERROR: the bundled asset has no wordmark lettering geometry.")
    return paths


def render_module(paths: list[dict], provenance: dict) -> str:
    lines = [
        "// Generated by tools/build_logo_asset.py — do not edit by hand.",
        "//",
        "// YouTube Premium 2024 wordmark geometry, bundled locally so the header",
        "// never requests an external image, font or SVG document at runtime.",
        "//",
        f"// Source page : {provenance['source_page']}",
        f"// Asset origin: {provenance['source_url']}",
        f"// Retrieved   : {provenance['retrieved_utc']}",
        f"// Revision    : SHA-1 {provenance['retrieved_sha1']} "
        f"({provenance['retrieved_bytes']} bytes), bundled SHA-256 "
        f"{provenance['sanitized_sha256']}",
        f"// Licence     : {provenance['license']}",
        f"// Trademark   : {provenance['trademark_notice']}",
        "//",
        "// Paint tokens: 'icon-red' (literal source red) and 'icon-white' (literal",
        "// play triangle) keep the emblem identical in every theme; 'ink' paths are",
        "// lettering and are painted with the native header foreground colour.",
        "",
        "export const YOUTUBE_PREMIUM_WORDMARK = Object.freeze({",
        "  label: 'YouTube Premium',",
        f"  viewBox: '{provenance['viewBox']}',",
        f"  width: {int(provenance['nominal_width'])},",
        f"  height: {int(provenance['nominal_height'])},",
        f"  inkTokens: Object.freeze({{ dark: '#f1f1f1', light: '#0f0f0f' }}),",
        "  paths: Object.freeze([",
    ]
    for entry in paths:
        attributes = ", ".join(
            f"{name}: {js_string(value)}" for name, value in entry["geometry"]
        )
        lines.append("    Object.freeze({")
        lines.append(f"      tag: '{entry['tag']}',")
        lines.append(f"      paint: '{entry['paint']}',")
        lines.append(f"      fill: {js_string(entry['fill'])},")
        lines.append(f"      attributes: Object.freeze({{ {attributes} }}),")
        lines.append("    }),")
    lines += [
        "  ]),",
        "  provenance: Object.freeze({",
        f"    sourcePage: {js_string(provenance['source_page'])},",
        f"    sourceUrl: {js_string(provenance['source_url'])},",
        f"    retrievedUtc: {js_string(provenance['retrieved_utc'])},",
        f"    revisionSha1: {js_string(provenance['retrieved_sha1'])},",
        f"    bundledSha256: {js_string(provenance['sanitized_sha256'])},",
        f"    licence: {js_string(provenance['license'])},",
        f"    trademark: {js_string(provenance['trademark_notice'])},",
        "  }),",
        "});",
        "",
        "export default YOUTUBE_PREMIUM_WORDMARK;",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="verify the committed module is up to date")
    parser.add_argument("--svg", default=str(SOURCE_SVG))
    parser.add_argument("--provenance", default=str(PROVENANCE))
    parser.add_argument("--out", default=str(GENERATED))
    args = parser.parse_args()

    svg_path = Path(args.svg)
    provenance_path = Path(args.provenance)
    if not svg_path.is_file() or not provenance_path.is_file():
        raise SystemExit(
            "ERROR: the bundled vector asset is missing. Run "
            "tools/fetch_premium_logo.py --out-dir TizenTube/mods/assets first."
        )
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    for key in ("source_page", "source_url", "retrieved_utc", "retrieved_sha1",
                "sanitized_sha256", "viewBox", "license", "trademark_notice"):
        if not provenance.get(key):
            raise SystemExit(f"ERROR: the provenance file is missing {key!r}.")
    paths = collect_paths(svg_path)
    module = render_module(paths, provenance)
    out_path = Path(args.out)

    if args.check:
        if not out_path.is_file():
            raise SystemExit(f"ERROR: {out_path.relative_to(ROOT)} has not been generated.")
        if out_path.read_text(encoding="utf-8") != module:
            raise SystemExit(
                f"ERROR: {out_path.relative_to(ROOT)} is out of date. "
                "Run python3 tools/build_logo_asset.py and commit the result."
            )
        print(f"Bundled vector module is current ({len(paths)} paths, "
              f"viewBox {provenance['viewBox']}).")
        return

    out_path.write_text(module, encoding="utf-8")
    paints = {}
    for entry in paths:
        paints[entry["paint"]] = paints.get(entry["paint"], 0) + 1
    print(f"Wrote {out_path.relative_to(ROOT)}: {len(paths)} paths "
          f"({', '.join(f'{name}={count}' for name, count in sorted(paints.items()))}), "
          f"viewBox {provenance['viewBox']}.")


if __name__ == "__main__":
    main()
