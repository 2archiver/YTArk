"""Minimal JNI-preserving host patch. All other upstream smali must round-trip unchanged."""
from pathlib import Path
import re

METHOD = re.compile(r'^\.method protected installAppFromURL\(Ljava/lang/String;\)Z\n.*?^\.end method', re.M | re.S)
BODY = '''.method protected installAppFromURL(Ljava/lang/String;)Z
    .locals 1

    invoke-static {p1}, Lio/github/twoarchiver/ytark/updater/NativeUpdatesBridge;->open(Ljava/lang/String;)Z
    move-result v0
    return v0
.end method'''


def patch(decoded):
    paths = list(Path(decoded).glob('smali*/dev/cobalt/coat/StarboardBridge.smali'))
    if len(paths) != 1:
        raise ValueError('Expected exactly one pinned StarboardBridge class')
    path = paths[0]
    source = path.read_text()
    methods = METHOD.findall(source)
    if len(methods) != 1 or 'Ljava/util/concurrent/Executors;->newSingleThreadExecutor' not in methods[0]:
        raise ValueError('Pinned installAppFromURL method changed; inspect upstream before patching')
    path.write_text(METHOD.sub(lambda _: BODY, source))
    return path


def verify_roundtrip(before, after):
    """Assembler may renumber labels? Fail closed instead of assuming equivalence.

    Native base and all non-bridge methods must survive byte-for-byte textual
    disassembly. Only whitespace is ignored; no opcodes, constants or classes are.
    """
    count = 0
    for original in Path(before).glob('smali*/**/*.smali'):
        relative = original.relative_to(before)
        built = Path(after) / relative
        if not built.is_file():
            raise ValueError(f'Base class missing after packaging: {relative}')
        a, b = original.read_text(), built.read_text()
        if relative.as_posix().endswith('/dev/cobalt/coat/StarboardBridge.smali'):
            # The original tree already contains the constrained patch.
            if len(METHOD.findall(b)) != 1 or 'NativeUpdatesBridge;->open' not in METHOD.findall(b)[0]:
                raise ValueError('Final DEX lacks the JNI Updates screen bridge')
        if ''.join(a.split()) != ''.join(b.split()):
            raise ValueError(f'Unexpected host DEX change after assembly: {relative}')
        count += 1
    if count == 0:
        raise ValueError('No original host classes to verify')
    print(f'Verified {count} host class disassemblies; only the audited bridge replacement is allowed.')
