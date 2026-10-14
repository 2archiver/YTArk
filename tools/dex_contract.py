"""Check class DEFINITIONS, duplicate classes and the actual JNI bridge method body in DEX."""
import re
import struct
import zipfile

class Dex:
    def __init__(self, data):
        self.data = data
        if not data.startswith(b'dex\n') or len(data) < 112:
            raise ValueError('Invalid DEX header')
        self.strings = []
        count, offset = self.u32(56), self.u32(60)
        for i in range(count):
            pos = self.u32(offset + 4*i)
            _, pos = self.uleb(pos)
            self.strings.append(data[pos:data.index(b'\0', pos)].decode('utf-8', 'replace'))
        self.types = [self.strings[self.u32(self.u32(68)+4*i)] for i in range(self.u32(64))]
        self.methods = []
        for i in range(self.u32(88)):
            cls, proto, name = struct.unpack_from('<HHI', data, self.u32(92)+8*i)
            self.methods.append((self.types[cls], self.strings[name]))
        self.classes = {}
        for i in range(self.u32(96)):
            pos = self.u32(100)+32*i
            self.classes[self.types[self.u32(pos)]] = self.u32(pos+24)
    def u32(self, pos): return struct.unpack_from('<I', self.data, pos)[0]
    def uleb(self, pos):
        value=0
        for shift in range(0,35,7):
            byte=self.data[pos]; pos+=1; value |= (byte & 127) << shift
            if byte<128: return value,pos
        raise ValueError('Invalid DEX uleb')
    def code(self, descriptor, method):
        pos=self.classes.get(descriptor,0)
        if not pos: raise ValueError('Class has no data')
        sizes=[]
        for _ in range(4):
            size,pos=self.uleb(pos); sizes.append(size)
        for _ in range(sizes[0]+sizes[1]):
            _,pos=self.uleb(pos); _,pos=self.uleb(pos)
        for size in sizes[2:]:
            index=0
            for _ in range(size):
                diff,pos=self.uleb(pos); index+=diff
                _,pos=self.uleb(pos); code,pos=self.uleb(pos)
                if self.methods[index] == (descriptor,method):
                    n=self.u32(code+12)
                    return list(struct.unpack_from('<'+'H'*n,self.data,code+16))
        raise ValueError('JNI bridge method missing')

def verify_apk_dex(apk):
    defined={}; dexes=[]
    with zipfile.ZipFile(apk) as z:
        for name in z.namelist():
            if not re.fullmatch(r'classes\d*\.dex',name): continue
            dex=Dex(z.read(name)); dexes.append(dex)
            for cls in dex.classes:
                if cls in defined: raise ValueError(f'Duplicate DEX class {cls}')
                defined[cls]=dex
    required=['UpdateActivity','UpdateBootstrapProvider','PendingUpdateProvider','UpdateCheckJobService','UpdateCoordinator','UpdateState','UpdateRepository','DownloadController','ApkValidator','InstallCoordinator','UpdateSchedule','NativeUpdatesBridge','UpdaterBuildConfig']
    for cls in [f'Lio/github/twoarchiver/ytark/updater/{n};' for n in required]+['Lio/github/twoarchiver/ytark/internal/kotlin/jvm/internal/Intrinsics;','Lio/github/twoarchiver/ytark/internal/kotlin/collections/CollectionsKt;','Lio/github/twoarchiver/ytark/internal/kotlin/Metadata;','Lcom/android/apksig/ApkVerifier;']:
        if cls not in defined: raise ValueError(f'Missing Kotlin updater/runtime definition {cls}')
    updater = defined['Lio/github/twoarchiver/ytark/updater/UpdateCoordinator;']
    if any(name.lstrip('[').startswith('Lkotlin/') for name in updater.types):
        raise ValueError('Updater still references the host Kotlin runtime')
    host='Ldev/cobalt/coat/StarboardBridge;'
    if host not in defined: raise ValueError('Missing Cobalt host bridge')
    dex=defined[host]; code=dex.code(host,'installAppFromURL')
    # invoke-static {p1}, NativeUpdatesBridge.open ; move-result v0 ; return v0
    if len(code)!=5 or code[0]&255!=0x71 or code[3]!=0x000a or code[4]!=0x000f:
        raise ValueError('Final JNI bridge is not the constrained screen-only body')
    if dex.methods[code[1]] != ('Lio/github/twoarchiver/ytark/updater/NativeUpdatesBridge;','open'):
        raise ValueError('JNI bridge calls an unexpected target')
    print(f'Verified {len(defined)} unique DEX class definitions, Kotlin runtime and screen-only JNI method.')
