"""Regression for the pinned base's DEX static-default round trip."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from patch_cobalt_bridge import canonical_smali, verify_roundtrip, patch, BODY


class Cobalt203BridgeTests(unittest.TestCase):
    # Extracted with pinned Apktool 3.0.3 from cobalt-arm.apk v2.0.3,
    # SHA-256 72a3527f520db3a1b414916ad96481244e451c41e272ae33344ae5e79abb37dd.
    original = (Path(__file__).parent / 'data/smali/cobalt-2.0.3-installAppFromURL.smali').read_text(encoding='utf-8')

    def make_host(self, root, method=None, parent='BaseStarboardBridge'):
        directory = root / 'smali_classes2/dev/cobalt/coat'
        directory.mkdir(parents=True)
        base = directory / 'BaseStarboardBridge.smali'
        base.write_text('.class public Ldev/cobalt/coat/BaseStarboardBridge;\n'
                        '.super Ljava/lang/Object;\n' + (method or self.original), encoding='utf-8')
        wrapper = directory / 'StarboardBridge.smali'
        wrapper.write_text('.class public Ldev/cobalt/coat/StarboardBridge;\n'
                           f'.super Ldev/cobalt/coat/{parent};\n', encoding='utf-8')
        return base, wrapper

    def test_patches_the_real_cobalt27_parent_method_and_preserves_subclass(self):
        with tempfile.TemporaryDirectory() as temp:
            base, wrapper = self.make_host(Path(temp))
            original_wrapper = wrapper.read_bytes()
            self.assertEqual(patch(temp), base)
            self.assertIn(BODY, base.read_text(encoding='utf-8'))
            self.assertEqual(wrapper.read_bytes(), original_wrapper)
            with self.assertRaisesRegex(ValueError, 'method changed'):
                patch(temp)

    def test_upstream_opcode_changes_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            self.make_host(Path(temp), self.original.replace('const/4 v2, 0x1', 'const/4 v2, 0x0'))
            with self.assertRaisesRegex(ValueError, 'method changed'):
                patch(temp)

    def test_upstream_inheritance_changes_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            self.make_host(Path(temp), parent='AnotherBridge')
            with self.assertRaisesRegex(ValueError, 'inheritance changed'):
                patch(temp)


class CobaltRoundtripTests(unittest.TestCase):
    def test_real_chromium_boolean_default(self):
        # Observed with Apktool 3.0.3 on pinned v2.0.2, PR CI run 38556930714:
        # org/chromium/handwriting/mojom/HandwritingRecognitionType.smali
        before = '.field private static final IS_EXTENSIBLE:Z = false'
        after = '.field private static final IS_EXTENSIBLE:Z'
        self.assertEqual(canonical_smali(before), canonical_smali(after))
        self.check_roundtrip(before, after)

    def test_static_defaults(self):
        for descriptor, value in [('Z', 'false'), ('B', '0x0t'), ('S', '0x0s'),
                                  ('C', "'\\u0000'"), ('I', '0x0'), ('J', '0x0L'),
                                  ('F', '0.0f'), ('D', '0.0'),
                                  ('Ljava/lang/String;', 'null'), ('[I', 'null')]:
            with self.subTest(descriptor=descriptor):
                field = f'.field public static value:{descriptor}'
                self.assertEqual(canonical_smali(field), canonical_smali(field + ' = ' + value))

    def test_real_changes_are_rejected(self):
        for before, after in [
            ('.field static flag:Z = false', '.field static flag:Z = true'),
            ('.field static value:I = 0x0', '.field static value:I = 0x1'),
            ('.field static value:F = 0.0f', '.field static value:F = -0.0f'),
            ('.field static value:D = 0.0', '.field static value:D = -0.0'),
            ('.field value:I = 0x0', '.field value:I'),
            ('const/4 v0, 0x0', 'const/4 v0, 0x1'),
            ('const-string v0, "a b"', 'const-string v0, "ab"'),
        ]:
            with self.subTest(before=before), self.assertRaisesRegex(ValueError, 'Unexpected host DEX change'):
                self.check_roundtrip(before, after)

    def test_missing_class_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            before, after = Path(directory) / 'before', Path(directory) / 'after'
            path = before / 'smali' / 'Example.smali'
            path.parent.mkdir(parents=True)
            path.write_text('.class public LExample;')
            with self.assertRaisesRegex(ValueError, 'Base class missing'):
                verify_roundtrip(before, after)

    def check_roundtrip(self, original, rebuilt):
        with tempfile.TemporaryDirectory() as directory:
            before, after = Path(directory) / 'before', Path(directory) / 'after'
            for root, text in [(before, original), (after, rebuilt)]:
                path = root / 'smali' / 'Example.smali'
                path.parent.mkdir(parents=True)
                path.write_text(text)
            verify_roundtrip(before, after)
