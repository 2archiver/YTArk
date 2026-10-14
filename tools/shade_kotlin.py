#!/usr/bin/env python3
"""Isolate updater Kotlin bytecode from the pinned Cobalt Kotlin runtime.

Relocate classfile UTF-8 constants (internal names, descriptors, signatures,
annotations and reflective class names), not arbitrary binary byte offsets.
Run on BOTH the compiled updater and stdlib before D8. No Kotlin reflection or
runtime resource loading is used by the updater; D8 consumes class entries only.
"""
import struct
import sys
import zipfile

INTERNAL = b'io/github/twoarchiver/ytark/internal/kotlin/'
DOTTED = INTERNAL.replace(b'/', b'.')
# Constant-pool payload sizes, excluding each entry's tag byte.
SIZES = {3: 4, 4: 4, 5: 8, 6: 8, 7: 2, 8: 2, 9: 4, 10: 4,
         11: 4, 12: 4, 15: 3, 16: 2, 17: 4, 18: 4, 19: 2, 20: 2}


def relocate_class(data):
    if len(data) < 10 or data[:4] != b'\xca\xfe\xba\xbe':
        raise ValueError('Invalid Java class header')
    count = struct.unpack_from('>H', data, 8)[0]
    output = bytearray(data[:10])
    offset, index = 10, 1
    while index < count:
        tag = data[offset]
        output.append(tag)
        offset += 1
        if tag == 1:
            size = struct.unpack_from('>H', data, offset)[0]
            offset += 2
            value = data[offset:offset + size]
            if len(value) != size:
                raise ValueError('Truncated class UTF-8 constant')
            offset += size
            value = value.replace(b'kotlin/', INTERNAL).replace(b'kotlin.', DOTTED)
            output.extend(struct.pack('>H', len(value)))
            output.extend(value)
        else:
            size = SIZES.get(tag)
            if size is None:
                raise ValueError(f'Unsupported class constant tag {tag}')
            if offset + size > len(data):
                raise ValueError('Truncated class constant')
            output.extend(data[offset:offset + size])
            offset += size
            if tag in (5, 6):
                index += 1
        index += 1
    output.extend(data[offset:])
    return bytes(output)


def relocate_jar(source, destination):
    count = 0
    with zipfile.ZipFile(source) as jar, zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as shaded:
        for entry in jar.infolist():
            # Module descriptors and non-class resources aren't D8 program inputs.
            if not entry.filename.endswith('.class') or entry.filename.startswith('META-INF/'):
                continue
            name = entry.filename
            if name.startswith('kotlin/'):
                name = INTERNAL.decode('ascii') + name[len('kotlin/'):]
            shaded.writestr(name, relocate_class(jar.read(entry)))
            count += 1
    if not count:
        raise ValueError('No classes to relocate')
    print(f'Isolated Kotlin references in {count} classes: {destination}')


if __name__ == '__main__':
    relocate_jar(*sys.argv[1:])
