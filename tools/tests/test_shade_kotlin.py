"""Classfile relocation must update pool lengths/references, not opcodes."""
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shade_kotlin import INTERNAL, DOTTED, relocate_class, relocate_jar


def utf8(value):
    return b'\x01' + struct.pack('>H', len(value)) + value


def classfile(entries, count=None):
    return b'\xca\xfe\xba\xbe\x00\x00\x00\x34' + struct.pack('>H', count or len(entries) + 1) + b''.join(entries)


class KotlinIsolationTests(unittest.TestCase):
    def test_descriptors_signatures_metadata_and_reflection(self):
        names = [b'kotlin/Metadata', b'(Lkotlin/Pair;)Lkotlin/Unit;',
                 b'Ljava/util/List<Lkotlin/Pair;>;', b'kotlin.jvm.internal.Intrinsics',
                 b'io/github/twoarchiver/ytark/updater/UpdateActivity']
        tail = b'\x00\x21\x00\x02\x00\x03'
        original = classfile([utf8(name) for name in names]) + tail
        expected = classfile([utf8(name.replace(b'kotlin/', INTERNAL).replace(b'kotlin.', DOTTED)) for name in names]) + tail
        self.assertEqual(relocate_class(original), expected)

    def test_non_utf8_constants_and_double_slot_entries_are_preserved(self):
        # CONSTANT_Long uses two pool slots; its binary bytes aren't text.
        entries = [b'\x05kotlin/X', b'\x07\x00\x04', utf8(b'kotlin/Unit')]
        original = classfile(entries, count=5) + b'BODY'
        expected = classfile(entries[:2] + [utf8(INTERNAL + b'Unit')], count=5) + b'BODY'
        self.assertEqual(relocate_class(original), expected)

    def test_class_paths_and_caller_references_are_relocated(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'source.jar', Path(directory) / 'shaded.jar'
            with zipfile.ZipFile(source, 'w') as jar:
                jar.writestr('kotlin/Unit.class', classfile([utf8(b'kotlin/Unit')]))
                jar.writestr('example/Caller.class', classfile([utf8(b'Lkotlin/Unit;')]))
                jar.writestr('META-INF/versions/9/module-info.class', b'not a D8 input')
            relocate_jar(source, target)
            with zipfile.ZipFile(target) as jar:
                self.assertEqual(set(jar.namelist()), {INTERNAL.decode() + 'Unit.class', 'example/Caller.class'})
                self.assertIn(b'L' + INTERNAL + b'Unit;', jar.read('example/Caller.class'))

    def test_invalid_class_rejected(self):
        for data in [b'not a class', classfile([b'\x63']), classfile([b'\x01\x00\x10short'])]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                relocate_class(data)
