#!/usr/bin/env python3
"""Package the original YTArk artwork without redrawing it.

Install tools/requirements-branding.txt, then use --write or --check.
The source PNG is immutable; only size and placement change for Android.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'branding/ytark-launcher-source.png'
SOURCE_SHA256 = 'de815a58125d65b5e0dd8faab7e80cbeaa9d9a06025575b72968dd0884db4e28'
FONT = ROOT / 'branding/fonts/BarlowCondensed-Bold.ttf'
FONT_SHA256 = 'e476562ec9c1e16cf16475895b511f08c804f438cc9a9f80a44ea50a0eeb5b65'
MIPMAPS = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
# Android masks operate on the center 72dp of the 108dp layer. The image's
# entire supplied image's visible pixels fit within the 66dp safe circle.
ADAPTIVE_SIZE = 62
XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>\n'


def source_image():
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('Original launcher artwork changed; restore the supplied source PNG')
    with Image.open(SOURCE) as image:
        if image.size != (1254, 1254) or image.mode != 'RGBA':
            raise ValueError('Expected the original 1254x1254 RGBA artwork')
        return image.copy()


def png(image):
    output = io.BytesIO()
    image.save(output, format='PNG', compress_level=9)
    return output.getvalue()


def render_png(size):
    return png(source_image().resize((size, size), Image.Resampling.LANCZOS))


def launcher_fg_xml():
    return XML_HEADER + f'''<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:width="{ADAPTIVE_SIZE}dp" android:height="{ADAPTIVE_SIZE}dp" android:gravity="center">
        <bitmap android:src="@drawable/ytark_artwork" android:gravity="fill" android:filter="true" />
    </item>
</layer-list>
'''


def launcher_bg_xml():
    return XML_HEADER + '''<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFFFFFFF" />
</shape>
'''


def adaptive_icon_xml():
    return XML_HEADER + '''<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ytark_launcher_bg" />
    <foreground android:drawable="@drawable/ytark_launcher_fg" />
    <monochrome android:drawable="@drawable/ytark_launcher_monochrome" />
</adaptive-icon>
'''


def banner_png():
    # Immutable logo plus pinned OFL Barlow Condensed Bold (not YouTube's font).
    # BASIC layout avoids host-specific shaping engines for this ASCII wordmark.
    if hashlib.sha256(FONT.read_bytes()).hexdigest() != FONT_SHA256:
        raise ValueError('Bundled banner font changed; restore the pinned font')
    image = Image.new('RGBA', (640, 360), '#F5F6F8')
    icon = source_image().resize((288, 288), Image.Resampling.LANCZOS)
    image.alpha_composite(icon, (24, 36))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), size=112, layout_engine=ImageFont.Layout.BASIC)
    bounds = draw.textbbox((0, 0), 'YTArk', font=font)
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    # Optical center within the space to the logo's right; never stretch glyphs.
    x = 328 + (288 - width) // 2 - bounds[0]
    y = (360 - height) // 2 - bounds[1]
    draw.text((x, y), 'YTArk', font=font, fill='#14181F')
    return png(image)


def artifacts():
    android = ROOT / 'android-updater'
    files = {
        ROOT / 'branding/ytark-launcher-512.png': render_png(512),
        android / 'drawable-nodpi/ytark_artwork.png': SOURCE.read_bytes(),
        android / 'drawable-nodpi/ytark_tv_banner.png': banner_png(),
        android / 'ytark_launcher_fg.xml': launcher_fg_xml().encode(),
        android / 'ytark_launcher_bg.xml': launcher_bg_xml().encode(),
        android / 'ytark_banner.xml': (XML_HEADER + '<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/ytark_tv_banner" android:gravity="fill" android:filter="true" />\n').encode(),
        android / 'mipmap-anydpi-v26/ytark_launcher.xml': adaptive_icon_xml().encode(),
    }
    for density, size in MIPMAPS.items():
        files[android / f'mipmap-{density}/ytark_launcher.png'] = render_png(size)
    return files


def artifact_matches(path, data):
    if not path.is_file():
        return False
    if path.suffix == '.png' and path.name != 'ytark_artwork.png':
        # Pillow wheels can use different zlib implementations on Windows and
        # Linux. Require identical pixels, mode and dimensions, not identical
        # lossless compression. The original supplied PNG stays byte-exact.
        try:
            with Image.open(path) as actual, Image.open(io.BytesIO(data)) as expected:
                return (actual.mode == expected.mode and actual.size == expected.size
                        and actual.tobytes() == expected.tobytes())
        except OSError:
            return False
    return path.read_bytes() == data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    files = artifacts()
    stale = []
    for path, data in files.items():
        if args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            print(f'wrote {path.relative_to(ROOT)}')
        elif not artifact_matches(path, data):
            stale.append(str(path.relative_to(ROOT)))
    if stale:
        print('Stale branding artifacts: ' + ', '.join(stale), file=sys.stderr)
        return 1
    print(f'All {len(files)} artwork resources match the supplied source image.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
