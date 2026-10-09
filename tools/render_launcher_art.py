#!/usr/bin/env python3
"""Render the YTArk Alternative 2 launcher artwork from one geometry source.

The selected branding (Alternative 2) is a light/white rounded-square tile with
a red video play emblem and a red orbital swoosh that passes behind the emblem
at its upper-left and crosses in front at the lower-right with a white keyline.
This script is the single source of truth for that artwork: it emits the master
SVG, the Android vector drawables (adaptive foreground/background, TV banner),
the adaptive-icon XML, and correctly sized mipmap PNG variants. Nothing in the
artwork includes concept-poster text or patch notes.

Modes:
  --write   (re)generate every committed artifact
  --check   regenerate in memory and fail if any committed artifact differs

Pure Python standard library only (deterministic PNG encoding via zlib).
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Brand geometry (normalized units, y-down, origin top-left of a unit square)
# ---------------------------------------------------------------------------

TILE_RADIUS = 0.22
TILE_FILL = "#FFFFFF"
TILE_STROKE = "#E7E9ED"
TILE_STROKE_WIDTH = 0.012

EMBLEM = (0.22, 0.29, 0.78, 0.71)  # x0, y0, x1, y1
EMBLEM_RADIUS = 0.115
EMBLEM_FILL = "#ED1C24"

PLAY = ((0.462, 0.385), (0.462, 0.615), (0.605, 0.500))
PLAY_FILL = "#FFFFFF"

RING_CENTER = (0.5, 0.51)
RING_RX = 0.425
RING_RY = 0.255
RING_ROTATION = -33.0  # degrees; major axis runs lower-left to upper-right
RING_STROKE_WIDTH = 0.045
RING_FILL = "#ED1C24"
KEYLINE_FILL = "#FFFFFF"
KEYLINE_EXTRA = 0.012  # keyline grows the stroke by this much on each side

# Ellipse-frame degrees (y-down): t=0 sits at the ring's upper-right tip.
# Front arc: over the emblem, white-keylined (crosses its lower-right).
# Back arc: under the emblem (left wing, tucking behind its upper-left corner).
# The undrawn sector between them is the orbit gap across the top.
RING_FRONT = (8.0, 108.0)
RING_BACK = (108.0, 258.0)
# Keyline spans only the over-emblem crossing so its ends stay invisible
# against the white tile (no notch where the front and back arcs meet).
KEYLINE_RANGE = (32.0, 104.0)

ADAPTIVE_VIEWPORT = 108.0
ADAPTIVE_SCALE = 0.62  # keeps the mark inside the adaptive safe zone

BANNER_W = 320.0
BANNER_H = 180.0
BANNER_BG = "#F5F6F8"
BANNER_TILE = (36.0, 32.0, 152.0, 148.0)  # square card holding the mark
BANNER_TEXT_FILL = "#14181F"

MIPMAPS = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
PREVIEW_SIZE = 512


def _rotate(x: float, y: float, degrees: float) -> tuple[float, float]:
    a = math.radians(degrees)
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a))


def ring_point(t_deg: float) -> tuple[float, float]:
    """Point on the orbital ring midline for parametric angle t (ellipse frame)."""
    a = math.radians(t_deg)
    x, y = RING_RX * math.cos(a), RING_RY * math.sin(a)
    x, y = _rotate(x, y, RING_ROTATION)
    return (RING_CENTER[0] + x, RING_CENTER[1] + y)


def ring_arc_path(start_deg: float, end_deg: float, unit: float) -> str:
    """SVG/Android pathData for a ring arc inside a unit*unit box."""
    sweep = end_deg - start_deg
    sx, sy = ring_point(start_deg)
    ex, ey = ring_point(end_deg)
    large_arc = 1 if abs(sweep) > 180.0 else 0
    return (
        f"M {sx * unit:.4f},{sy * unit:.4f} "
        f"A {RING_RX * unit:.4f} {RING_RY * unit:.4f} "
        f"{RING_ROTATION:.2f} {large_arc} 1 "
        f"{ex * unit:.4f},{ey * unit:.4f}"
    )


def rounded_rect_path(x0: float, y0: float, x1: float, y1: float,
                      radius: float, unit: float) -> str:
    x0, y0, x1, y1, r = x0 * unit, y0 * unit, x1 * unit, y1 * unit, radius * unit
    return (
        f"M {x0 + r:.4f},{y0:.4f} "
        f"H {x1 - r:.4f} A {r:.4f},{r:.4f} 0 0 1 {x1:.4f},{y0 + r:.4f} "
        f"V {y1 - r:.4f} A {r:.4f},{r:.4f} 0 0 1 {x1 - r:.4f},{y1:.4f} "
        f"H {x0 + r:.4f} A {r:.4f},{r:.4f} 0 0 1 {x0:.4f},{y1 - r:.4f} "
        f"V {y0 + r:.4f} A {r:.4f},{r:.4f} 0 0 1 {x0 + r:.4f},{y0:.4f} Z"
    )


def triangle_path(points: tuple[tuple[float, float], ...], unit: float) -> str:
    coords = [f"{x * unit:.4f},{y * unit:.4f}" for x, y in points]
    return f"M {coords[0]} L {coords[1]} L {coords[2]} Z"


# ---------------------------------------------------------------------------
# Deterministic PNG rasterization (signed-distance coverage, no dependencies)
# ---------------------------------------------------------------------------

def _rounded_rect_sdf(px: float, py: float, x0: float, y0: float,
                      x1: float, y1: float, r: float) -> float:
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    hw = max((x1 - x0) / 2.0 - r, 0.0)
    hh = max((y1 - y0) / 2.0 - r, 0.0)
    qx = abs(px - cx) - hw
    qy = abs(py - cy) - hh
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def _triangle_sdf(px: float, py: float, a: tuple[float, float],
                  b: tuple[float, float], c: tuple[float, float]) -> float:
    """Signed distance to a convex triangle (negative inside)."""
    cx = (a[0] + b[0] + c[0]) / 3.0
    cy = (a[1] + b[1] + c[1]) / 3.0

    def edge(p: tuple[float, float], q: tuple[float, float]) -> float:
        ex, ey = q[0] - p[0], q[1] - p[1]
        length = math.hypot(ex, ey) or 1.0
        nx, ny = ey / length, -ex / length
        d = nx * (px - p[0]) + ny * (py - p[1])
        if nx * (cx - p[0]) + ny * (cy - p[1]) > 0:  # normal points inward
            d = -d
        return d

    return max(edge(a, b), edge(b, c), edge(c, a))


def _ring_sdf(px: float, py: float, start_deg: float, end_deg: float) -> float:
    """Signed distance to a ring arc midline (0 on the arc)."""
    dx, dy = px - RING_CENTER[0], py - RING_CENTER[1]
    ux, uy = _rotate(dx, dy, -RING_ROTATION)
    nx, ny = ux / RING_RX, uy / RING_RY
    nlen = math.hypot(nx, ny)
    if nlen == 0.0:
        return float("inf")
    angle = math.degrees(math.atan2(ny, nx))
    sweep = end_deg - start_deg
    rel = (angle - start_deg) % 360.0 if sweep > 0 else (start_deg - angle) % 360.0
    if rel <= abs(sweep):
        # On the drawn arc: distance scaled by the ellipse gradient so the
        # stroke keeps an even width around the whole orbit (no tip scallops).
        gradient = math.hypot(ux / (RING_RX * RING_RX), uy / (RING_RY * RING_RY))
        if gradient == 0.0:
            return float("inf")
        return abs(nlen - 1.0) * nlen / gradient
    # Outside the arc span: distance to the nearest round cap endpoint.
    cap_a = ring_point(start_deg)
    cap_b = ring_point(end_deg)
    return min(math.hypot(px - cap_a[0], py - cap_a[1]),
               math.hypot(px - cap_b[0], py - cap_b[1]))


def _hex_rgba(color: str, alpha: float = 1.0) -> tuple[int, int, int, float]:
    value = color.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


def _blend(dst: list[int], src: tuple[int, int, int, float]) -> None:
    sa = src[3]
    if sa <= 0.0:
        return
    if sa >= 1.0:
        dst[0], dst[1], dst[2], dst[3] = src[0], src[1], src[2], 255
        return
    da = dst[3] / 255.0
    out_a = sa + da * (1.0 - sa)
    for i in range(3):
        dst[i] = int(round((src[i] * sa + dst[i] * da * (1.0 - sa)) / (out_a or 1.0)))
    dst[3] = int(round(out_a * 255))


def _stroke_coverage(dist: float, width: float, pixel: float) -> float:
    return min(max(0.5 - (dist - width / 2.0) / pixel, 0.0), 1.0)


def render_icon_rgba(size: int) -> bytes:
    """Render the full Alternative 2 tile into an RGBA8888 buffer.

    Edge antialiasing is analytic (signed-distance coverage), so the render is
    smooth at every size and stays deterministic without supersampling.
    """
    pixel = 1.0 / size
    buffer = [[0, 0, 0, 0] for _ in range(size * size)]
    keyline_width = RING_STROKE_WIDTH + 2.0 * KEYLINE_EXTRA

    for row in range(size):
        py = (row + 0.5) * pixel
        for col in range(size):
            px = (col + 0.5) * pixel
            cell = buffer[row * size + col]

            tile_sdf = _rounded_rect_sdf(px, py, 0.0, 0.0, 1.0, 1.0, TILE_RADIUS)
            cov = min(max(0.5 - tile_sdf / pixel, 0.0), 1.0)
            if cov > 0.0:
                _blend(cell, _hex_rgba(TILE_FILL, cov))
            cov = min(max(0.5 - (abs(tile_sdf) - TILE_STROKE_WIDTH / 2.0)
                          / pixel, 0.0), 1.0)
            if cov > 0.0:
                _blend(cell, _hex_rgba(TILE_STROKE, cov))

            if 0.10 <= px <= 0.90 and 0.20 <= py <= 0.88:
                cov = _stroke_coverage(
                    _ring_sdf(px, py, RING_BACK[0], RING_BACK[1]),
                    RING_STROKE_WIDTH, pixel)
                if cov > 0.0:
                    _blend(cell, _hex_rgba(RING_FILL, cov))

            if EMBLEM[0] - 0.02 <= px <= EMBLEM[2] + 0.02 and \
                    EMBLEM[1] - 0.02 <= py <= EMBLEM[3] + 0.02:
                cov = min(max(0.5 - _rounded_rect_sdf(
                    px, py, EMBLEM[0], EMBLEM[1], EMBLEM[2], EMBLEM[3],
                    EMBLEM_RADIUS) / pixel, 0.0), 1.0)
                if cov > 0.0:
                    _blend(cell, _hex_rgba(EMBLEM_FILL, cov))

            if 0.44 <= px <= 0.63 and 0.37 <= py <= 0.63:
                cov = min(max(0.5 - _triangle_sdf(px, py, PLAY[0], PLAY[1], PLAY[2])
                              / pixel, 0.0), 1.0)
                if cov > 0.0:
                    _blend(cell, _hex_rgba(PLAY_FILL, cov))

            if 0.33 <= px <= 0.92 and 0.20 <= py <= 0.88:
                cov = _stroke_coverage(
                    _ring_sdf(px, py, KEYLINE_RANGE[0], KEYLINE_RANGE[1]),
                    keyline_width, pixel)
                if cov > 0.0:
                    _blend(cell, _hex_rgba(KEYLINE_FILL, cov))
                cov = _stroke_coverage(
                    _ring_sdf(px, py, RING_FRONT[0], RING_FRONT[1]),
                    RING_STROKE_WIDTH, pixel)
                if cov > 0.0:
                    _blend(cell, _hex_rgba(RING_FILL, cov))

    out = bytearray()
    for px in buffer:
        out.extend((px[0], px[1], px[2], px[3]))
    return bytes(out)


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def encode_png(size: int, rgba: bytes) -> bytes:
    rows = bytearray()
    stride = size * 4
    for row in range(size):
        rows.append(0)  # filter: none
        rows.extend(rgba[row * stride:(row + 1) * stride])
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + _png_chunk(b"IHDR", header)
            + _png_chunk(b"IDAT", zlib.compress(bytes(rows), 9))
            + _png_chunk(b"IEND", b""))


def render_png(size: int) -> bytes:
    return encode_png(size, render_icon_rgba(size))


# ---------------------------------------------------------------------------
# Vector / XML emitters
# ---------------------------------------------------------------------------

VECTOR_HEADER = (
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
    '    android:width="{width}dp"\n'
    '    android:height="{height}dp"\n'
    '    android:viewportWidth="{vw}"\n'
    '    android:viewportHeight="{vh}">\n'
)
ARGB = {
    "#FFFFFF": "#FFFFFFFF",
    "#E7E9ED": "#FFE7E9ED",
    "#ED1C24": "#FFED1C24",
    "#14181F": "#FF14181F",
    "#F5F6F8": "#FFF5F6F8",
}


def _mark_paths(unit: float, indent: str = "    ") -> str:
    """Emblem, play triangle and orbital ring inside a unit*unit box.

    Draw order preserves the artwork's depth: the ring's back arc tucks behind
    the emblem, the front arc crosses over it with a white keyline.
    """
    keyline_width = RING_STROKE_WIDTH + 2.0 * KEYLINE_EXTRA
    lines = [
        # back arc: under the emblem (left wing + tuck behind the upper-left)
        f'{indent}<path android:fillColor="#00000000"\n'
        f'{indent}    android:strokeColor="{ARGB[RING_FILL]}"\n'
        f'{indent}    android:strokeWidth="{RING_STROKE_WIDTH * unit:.4f}"\n'
        f'{indent}    android:strokeLineCap="round"\n'
        f'{indent}    android:pathData="{ring_arc_path(RING_BACK[0], RING_BACK[1], unit)}" />',
        f'{indent}<path android:fillColor="{ARGB[EMBLEM_FILL]}"\n'
        f'{indent}    android:pathData="{rounded_rect_path(*EMBLEM, EMBLEM_RADIUS, unit)}" />',
        f'{indent}<path android:fillColor="{ARGB[PLAY_FILL]}"\n'
        f'{indent}    android:pathData="{triangle_path(PLAY, unit)}" />',
        # keyline separating the front arc from the emblem
        f'{indent}<path android:fillColor="#00000000"\n'
        f'{indent}    android:strokeColor="{ARGB[KEYLINE_FILL]}"\n'
        f'{indent}    android:strokeWidth="{keyline_width * unit:.4f}"\n'
        f'{indent}    android:strokeLineCap="butt"\n'
        f'{indent}    android:pathData="{ring_arc_path(KEYLINE_RANGE[0], KEYLINE_RANGE[1], unit)}" />',
        # front arc: over the emblem's lower-right
        f'{indent}<path android:fillColor="#00000000"\n'
        f'{indent}    android:strokeColor="{ARGB[RING_FILL]}"\n'
        f'{indent}    android:strokeWidth="{RING_STROKE_WIDTH * unit:.4f}"\n'
        f'{indent}    android:strokeLineCap="round"\n'
        f'{indent}    android:pathData="{ring_arc_path(RING_FRONT[0], RING_FRONT[1], unit)}" />',
    ]
    return "\n".join(lines)


def launcher_fg_vector() -> str:
    """Adaptive foreground: the mark scaled into the 108dp safe zone."""
    unit = ADAPTIVE_VIEWPORT * ADAPTIVE_SCALE
    offset = (ADAPTIVE_VIEWPORT - unit) / 2.0
    body = _mark_paths(unit, indent="        ")
    return (
        VECTOR_HEADER.format(width=108, height=108, vw=108, vh=108)
        + f'    <group android:translateX="{offset:.4f}" android:translateY="{offset:.4f}">\n'
        + body + "\n"
        + "    </group>\n</vector>\n"
    )


def launcher_bg_vector() -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<shape xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:shape="rectangle">\n'
        f'    <solid android:color="{ARGB[TILE_FILL]}" />\n'
        "</shape>\n"
    )


def adaptive_icon_xml() -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@drawable/ytark_launcher_bg" />\n'
        '    <foreground android:drawable="@drawable/ytark_launcher_fg" />\n'
        "</adaptive-icon>\n"
    )


def banner_vector() -> str:
    """320x180 Android TV banner: light card with the mark and YTArk lettering."""
    x0, y0, x1, y1 = BANNER_TILE
    unit = x1 - x0
    # The wordmark letters below spell Y-T-A-r-k in self-contained strokes.
    letters = (
        "M 169,73 L 181,87 L 193,73 M 181,87 V 113 "
        "M 201,73 H 222 M 211.5,73 V 113 "
        "M 229,113 L 236,73 H 247 L 254,113 M 232,98 H 251 "
        "M 264,88 V 113 M 264,95 C 270,85 277,85 282,88 "
        "M 291,88 V 113 M 291,100 L 302,88 M 294,98 L 305,113"
    )
    return (
        VECTOR_HEADER.format(width=320, height=180, vw=320, vh=180)
        + f'    <path android:fillColor="{ARGB[BANNER_BG]}"\n'
        + f'        android:pathData="M 0,0 H {BANNER_W:.0f} V {BANNER_H:.0f} H 0 Z" />\n'
        + f'    <group android:translateX="{x0:.4f}" android:translateY="{y0:.4f}">\n'
        + f'        <path android:fillColor="{ARGB[TILE_FILL]}"\n'
        + f'            android:strokeColor="{ARGB[TILE_STROKE]}"\n'
        + f'            android:strokeWidth="{TILE_STROKE_WIDTH * unit:.4f}"\n'
        + f'            android:pathData="{rounded_rect_path(0, 0, 1, 1, TILE_RADIUS, unit)}" />\n'
        + _mark_paths(unit, indent="        ") + "\n"
        + "    </group>\n"
        + '    <path android:fillColor="#00000000"\n'
        + f'        android:strokeColor="{ARGB[BANNER_TEXT_FILL]}"\n'
        + '        android:strokeWidth="5"\n'
        + '        android:strokeLineCap="round"\n'
        + '        android:strokeLineJoin="round"\n'
        + f'        android:pathData="{letters}" />\n'
        + "</vector>\n"
    )


def master_svg() -> str:
    unit = 512.0
    keyline_width = RING_STROKE_WIDTH + 2.0 * KEYLINE_EXTRA
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
        "  <!-- YTArk Alternative 2 launcher master: light rounded-square tile, -->",
        "  <!-- red video play emblem, red orbital swoosh with over/under pass. -->",
        "  <!-- No text, no watermarks, no concept-poster content. -->",
        f'  <path fill="{TILE_FILL}" stroke="{TILE_STROKE}" '
        f'stroke-width="{TILE_STROKE_WIDTH * unit:.2f}" '
        f'd="{rounded_rect_path(0, 0, 1, 1, TILE_RADIUS, unit)}" />',
        f'  <path fill="none" stroke="{RING_FILL}" '
        f'stroke-width="{RING_STROKE_WIDTH * unit:.2f}" stroke-linecap="round" '
        f'd="{ring_arc_path(RING_BACK[0], RING_BACK[1], unit)}" />',
        f'  <path fill="{EMBLEM_FILL}" '
        f'd="{rounded_rect_path(*EMBLEM, EMBLEM_RADIUS, unit)}" />',
        f'  <path fill="{PLAY_FILL}" d="{triangle_path(PLAY, unit)}" />',
        f'  <path fill="none" stroke="{KEYLINE_FILL}" '
        f'stroke-width="{keyline_width * unit:.2f}" stroke-linecap="butt" '
        f'd="{ring_arc_path(KEYLINE_RANGE[0], KEYLINE_RANGE[1], unit)}" />',
        f'  <path fill="none" stroke="{RING_FILL}" '
        f'stroke-width="{RING_STROKE_WIDTH * unit:.2f}" stroke-linecap="round" '
        f'd="{ring_arc_path(RING_FRONT[0], RING_FRONT[1], unit)}" />',
        "</svg>",
        "",
    ]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Artifact table
# ---------------------------------------------------------------------------

def artifacts() -> dict[Path, bytes]:
    files: dict[Path, bytes] = {
        ROOT / "branding" / "ytark-launcher.svg": master_svg().encode("utf-8"),
        ROOT / "branding" / f"ytark-launcher-{PREVIEW_SIZE}.png": render_png(PREVIEW_SIZE),
        ROOT / "android-updater" / "ytark_launcher_fg.xml": launcher_fg_vector().encode("utf-8"),
        ROOT / "android-updater" / "ytark_launcher_bg.xml": launcher_bg_vector().encode("utf-8"),
        ROOT / "android-updater" / "ytark_banner.xml": banner_vector().encode("utf-8"),
        ROOT / "android-updater" / "mipmap-anydpi-v26" / "ytark_launcher.xml":
            adaptive_icon_xml().encode("utf-8"),
    }
    for density, size in MIPMAPS.items():
        files[ROOT / "android-updater" / f"mipmap-{density}" / "ytark_launcher.png"] = \
            render_png(size)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="write all generated artifacts")
    mode.add_argument("--check", action="store_true",
                      help="verify committed artifacts match the geometry source")
    args = parser.parse_args()

    mismatched = []
    for path, data in artifacts().items():
        if args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            print(f"wrote {path.relative_to(ROOT)} ({len(data)} bytes)")
        else:
            if not path.is_file():
                mismatched.append(f"missing: {path.relative_to(ROOT)}")
            elif path.read_bytes() != data:
                mismatched.append(f"stale:   {path.relative_to(ROOT)}")

    if args.check:
        if mismatched:
            print("YTArk branding artifacts do not match tools/render_launcher_art.py:",
                  file=sys.stderr)
            for line in mismatched:
                print("  " + line, file=sys.stderr)
            print("Run: python3 tools/render_launcher_art.py --write", file=sys.stderr)
            return 1
        print(f"All {len(artifacts())} YTArk branding artifacts match the geometry source.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
