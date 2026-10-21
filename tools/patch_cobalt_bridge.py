"""Minimal JNI-preserving host patch. All other upstream smali must round-trip unchanged."""
from pathlib import Path
import difflib
import hashlib
import re

ORIGINAL_METHOD_SHA256 = '46bd854348db35426c5d04699803286a03172ee39ded48dee61bf1f45b367cae'
HOST_BRIDGE = 'BaseStarboardBridge.smali'

METHOD = re.compile(r'^\.method protected installAppFromURL\(Ljava/lang/String;\)Z\n.*?^\.end method', re.M | re.S)
BODY = '''.method protected installAppFromURL(Ljava/lang/String;)Z
    .locals 1

    invoke-static {p1}, Lio/github/twoarchiver/ytark/updater/NativeUpdatesBridge;->open(Ljava/lang/String;)Z
    move-result v0
    return v0
.end method'''


def patch(decoded):
    paths = list(Path(decoded).glob('smali*/dev/cobalt/coat/' + HOST_BRIDGE))
    if len(paths) != 1:
        raise ValueError('Expected exactly one pinned BaseStarboardBridge class')
    path = paths[0]
    # Cobalt 27 moved the implementation to the shared base class. Preserve
    # StarboardBridge and its inheritance; replace only the audited method.
    wrapper = path.with_name('StarboardBridge.smali')
    if not wrapper.is_file() or '.super Ldev/cobalt/coat/BaseStarboardBridge;' not in wrapper.read_text():
        raise ValueError('Pinned StarboardBridge inheritance changed')
    source = path.read_text()
    methods = METHOD.findall(source)
    if len(methods) != 1 or hashlib.sha256(canonical_smali(methods[0]).encode()).hexdigest() != ORIGINAL_METHOD_SHA256:
        raise ValueError('Pinned installAppFromURL method changed; inspect upstream before patching')
    path.write_text(METHOD.sub(lambda _: BODY, source))
    return path


# DEX encoded_array may omit trailing static fields with their type's default
# value. Smali drops these redundant initializers when reassembling (e.g. the
# pinned Chromium IS_EXTENSIBLE:Z = false becomes IS_EXTENSIBLE:Z). This is not
# a code change. Do not normalize instance fields, nonzero values or -0.0.
STATIC_FIELD = re.compile(r'^(\.field\s+[^\n]*\bstatic\b[^\n]*:[^\s=]+)\s+=\s+(\S+)$')
DEFAULT_VALUES = {
    'Z': 'false', 'B': '0x0t', 'S': '0x0s', 'C': "'\\u0000'",
    'I': '0x0', 'J': '0x0L', 'F': '0.0f', 'D': '0.0',
}


def canonical_smali(source):
    lines = []
    for line in source.splitlines():
        line = line.strip()
        match = STATIC_FIELD.fullmatch(line)
        if match:
            declaration, value = match.groups()
            descriptor = declaration.rsplit(':', 1)[1]
            default = 'null' if descriptor.startswith(('L', '[')) else DEFAULT_VALUES.get(descriptor)
            if value == default:
                line = declaration
        if line:
            lines.append(line)
    # Ignore indentation/blank lines, but preserve spaces inside string literals.
    return '\n'.join(lines)


def verify_roundtrip(before, after):
    """Fail closed on host changes except equivalent DEX static defaults.

    No opcodes, non-default constants, annotations or classes may change.
    """
    count = 0
    for original in Path(before).glob('smali*/**/*.smali'):
        relative = original.relative_to(before)
        built = Path(after) / relative
        if not built.is_file():
            raise ValueError(f'Base class missing after packaging: {relative}')
        a, b = original.read_text(), built.read_text()
        if relative.as_posix().endswith('/dev/cobalt/coat/' + HOST_BRIDGE):
            # The original tree already contains the constrained patch.
            if len(METHOD.findall(b)) != 1 or 'NativeUpdatesBridge;->open' not in METHOD.findall(b)[0]:
                raise ValueError('Final DEX lacks the JNI Updates screen bridge')
        if canonical_smali(a) != canonical_smali(b):
            diff = '\n'.join(list(difflib.unified_diff(a.splitlines(), b.splitlines(), n=1))[:16])
            raise ValueError(f'Unexpected host DEX change after assembly: {relative}\n{diff}')
        count += 1
    if count == 0:
        raise ValueError('No original host classes to verify')
    print(f'Verified {count} host class disassemblies; only the audited bridge replacement is allowed.')
