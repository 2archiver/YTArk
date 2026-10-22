"""Guard image fidelity, mask safety and the APK resource graph."""
import hashlib
import io
import math
from pathlib import Path
import re
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import render_launcher_art as art
import repack_apk

ANDROID = '{http://schemas.android.com/apk/res/android}'


class LauncherArtworkTests(unittest.TestCase):
    def test_lossless_png_compression_can_vary_but_pixels_cannot(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'derived.png'
            expected = art.render_png(48)
            with Image.open(io.BytesIO(expected)) as image:
                image.save(path, compress_level=0)
                self.assertNotEqual(path.read_bytes(), expected)
                self.assertTrue(art.artifact_matches(path, expected))
                image.putpixel((24, 24), (0, 0, 0, 255))
                image.save(path)
                self.assertFalse(art.artifact_matches(path, expected))

    def test_packaged_art_is_the_exact_supplied_image(self):
        source = art.SOURCE.read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(),
                         'de815a58125d65b5e0dd8faab7e80cbeaa9d9a06025575b72968dd0884db4e28')
        self.assertEqual((art.ROOT / 'android-updater/drawable-nodpi/ytark_artwork.png').read_bytes(), source)
        for density, size in art.MIPMAPS.items():
            path = art.ROOT / f'android-updater/mipmap-{density}/ytark_launcher.png'
            with Image.open(path) as icon:
                self.assertEqual(icon.size, (size, size))
                self.assertEqual(icon.mode, 'RGBA')
                self.assertEqual(icon.getpixel((0, 0))[3], 0)

    def test_banner_font_is_pinned_and_wordmark_has_clear_separation(self):
        self.assertEqual(hashlib.sha256(art.FONT.read_bytes()).hexdigest(), art.FONT_SHA256)
        self.assertIn('SIL OPEN FONT LICENSE', (art.FONT.parent / 'OFL.txt').read_text())
        banner = Image.open(io.BytesIO(art.banner_png()))
        self.assertEqual(banner.size, (640, 360))
        # Compare the logo's entire left region to an independently placed copy.
        expected = Image.new('RGBA', (640, 360), '#F5F6F8')
        expected.alpha_composite(art.source_image().resize((288, 288), Image.Resampling.LANCZOS), (24, 36))
        self.assertEqual(banner.crop((0, 0, 320, 360)).tobytes(), expected.crop((0, 0, 320, 360)).tobytes())
        # The typeset region must have breathing room on every edge at TV size.
        small = banner.resize((320, 180), Image.Resampling.LANCZOS).convert('RGB')
        area = small.crop((160, 0, 320, 180))
        ink = ImageChops.difference(area, Image.new('RGB', area.size, '#F5F6F8')).getbbox()
        self.assertIsNotNone(ink)
        self.assertGreater(ink[0], 6)
        self.assertGreater(ink[1], 30)
        self.assertLess(ink[2], 154)
        self.assertLess(ink[3], 150)

    def test_visible_art_fits_adaptive_safe_circle(self):
        layer = ET.fromstring(art.launcher_fg_xml()).find('item')
        self.assertEqual(layer.get(ANDROID + 'gravity'), 'center')
        size = int(layer.get(ANDROID + 'width').removesuffix('dp'))
        image = art.source_image()
        width = image.width
        # Test original alpha pixels, including stray edge flecks. This catches
        # a scale that looks fine in a square but crops in a circular TV menu.
        radius = max(math.hypot(i % width - width / 2, i // width - width / 2)
                     for i, alpha in enumerate(image.getchannel('A').get_flattened_data()) if alpha > 127)
        self.assertLessEqual(radius * size / width, 33)

    def test_repack_installs_every_referenced_drawable_and_round_icon(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'AndroidManifest.xml').write_text(
                '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
                '<application><activity android:name="Main" android:icon="@drawable/old" />'
                '</application></manifest>', encoding='utf-8')
            repack_apk.patch_launcher_icon(temp)
            app = ET.parse(root / 'AndroidManifest.xml').find('application')
            self.assertEqual(app.get(ANDROID + 'roundIcon'), '@mipmap/ytark_launcher')
            self.assertEqual(app.find('activity').get(ANDROID + 'icon'), '@mipmap/ytark_launcher')
            for path in (root / 'res').rglob('*.xml'):
                for kind, name in re.findall(r'@(drawable|mipmap)/([\w]+)', path.read_text(encoding='utf-8')):
                    self.assertTrue(any((root / 'res').glob(f'{kind}*/{name}.*')), (path, kind, name))
            self.assertEqual((root / 'res/drawable-nodpi/ytark_artwork.png').read_bytes(), art.SOURCE.read_bytes())
            with Image.open(root / 'res/drawable-nodpi/ytark_tv_banner.png') as banner:
                self.assertEqual(banner.size, (640, 360))


if __name__ == '__main__':
    unittest.main()
