"""Regression for the pinned base's DEX static-default round trip."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from patch_cobalt_bridge import canonical_smali, verify_roundtrip


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
