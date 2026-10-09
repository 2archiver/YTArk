# YTArk — Personal TizenTube TV Build

## Status

**This is NOT an installable custom APK.** The JavaScript mods are implemented and tested. The native APK rebuild (Cobalt integration) has not been completed — this environment lacks the Android SDK/NDK/Gradle toolchain and Chromium/Cobalt build dependencies required for a full native build.

## What's Done

### JavaScript mods (complete, tested, built)

- **TV Quick Controls** — first item in the TizenTube settings UI, using the existing TV modal and command framework
- **Clean TV preset** — hides Shorts, previews, end cards, and player related-video UI; preserves adaptive quality and speed controls
- **Midnight Blue and Classic Dark themes** — single stylesheet (never accumulates overrides)
- **One-level undo** — reverts the most recently applied preset
- **Quick Quality** — Auto / 2160p / 1440p / 1080p / 720p in the settings submenu
- **Quality fallback** — selects largest available ≤ requested; if none below, picks lowest available
- **Auto quality** — calls `setPlaybackQualityRange('auto', 'auto')` (needs on-device verification)
- **Resilient config** — corrupt/null/array localStorage fallback; non-crashing writes when storage is full
- **Updater disabled** — prevents installing incompatible upstream signing/package variant
- **16 unit tests** passing (Node.js `node:test`)

### Files

| File | Description |
|------|-------------|
| `TizenTube/` | Modified TizenTube source (upstream at `9dd70a7` + mods) |
| `TizenTube/dist/userScript.js` | Built custom bundle (658 KB) |
| `TizenTube/mods/package-lock.json` | Dependency lock |
| `personal-tv.patch` | Diff against pinned upstream commit |
| `tools/configure_cobalt.py` | Source helper to replace userscript URL |
| `evidence/` | Build and test logs |
| `SHA256SUMS.txt` | File hashes |

## Reproduce JavaScript Work

```bash
cd TizenTube/mods
npm ci --no-audit --no-fund
node tests/tv-controls.test.mjs
npm run build
node --check ../dist/userScript.js
```

Build emits upstream warnings (circular deps, old Browserslist, Rollup replace plugin). These are expected and do not affect the output.

## What Remains — APK Build

The critical path to an installable APK:

### 1. Download TizenTubeCobalt v2.0.2 APKs

- ARM: https://github.com/reisxd/TizenTubeCobalt/releases/download/v2.0.2/cobalt-arm.apk (97 MB)
- ARM64: https://github.com/reisxd/TizenTubeCobalt/releases/download/v2.0.2/cobalt-arm64.apk (168 MB)

### 2. Replace the userscript

The upstream `libchrobalt.so` contains:

```
https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?v=
```

Find it with:
```bash
git clone https://github.com/reisxd/TizenTubeCobalt.git
git checkout v2.0.2
git grep -n -F 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?v='
```

**Preferred approach:** Bundle `TizenTube/dist/userScript.js` directly into the APK and patch the native loader URL to a local asset path. This avoids network dependency at runtime.

**Alternate:** Host the bundle at an immutable HTTPS URL and use `tools/configure_cobalt.py`:
```bash
python3 tools/configure_cobalt.py /path/to/TizenTubeCobalt https://your-cdn.example.com/userScript.js
```

### 3. Repackage the APK

```bash
# Decompile
apktool d cobalt-arm64.apk -o cobalt-arm64-decoded

# Replace the userscript (bundled approach) or rebuild from source (URL approach)
# ...

# Recompile
apktool b cobalt-arm64-decoded -o personal-tubetv-arm64-unsigned.apk

# Sign with a persistent key (generate once, keep secure)
keytool -genkey -v -keystore personal-tubetv.keystore -alias personal-tubetv -keyalg RSA -keysize 2048 -validity 10000
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore personal-tubetv.keystore personal-tubetv-arm64-unsigned.apk personal-tubetv

# Align
zipalign -v 4 personal-tubetv-arm64-unsigned.apk personal-tubetv-arm64.apk
```

### 4. Build requirements

- Java 17+
- apktool 2.10+
- Android SDK (build-tools for zipalign + apksigner)
- OR: full Cobalt source checkout + Chromium build toolchain for source-level integration

### 5. Integration checklist

- [ ] Distinct application ID (e.g. `io.github.personal.tubetv`)
- [ ] Update ALL matching provider authorities / package references
- [ ] Visible name (e.g. "Personal Tube TV")
- [ ] Persistent release signing key (not ephemeral)
- [ ] Upstream APK updater disabled (done in JS; verify native path also blocked)
- [ ] Leanback launcher category in manifest
- [ ] Both ARM ABIs built and verified
- [ ] Min SDK, native ABI, signature verification

### 6. On-device testing

- [ ] Launch twice, D-pad navigation, Back button
- [ ] Toggle each TV Quick Control
- [ ] Apply all presets and undo
- [ ] Restart to check persistence
- [ ] Sign in / switch profiles
- [ ] Playback on known content
- [ ] Quality switching (fixed + Auto)
- [ ] SponsorBlock
- [ ] Sleep/resume, cold start, offline errors

## Upstream References

- TizenTube source: https://github.com/reisxd/TizenTube (commit `9dd70a7`, v1.15.1, GPL-3.0-only)
- Cobalt source: https://github.com/reisxd/TizenTubeCobalt (release v2.0.2)
- Original APKs: cobalt-arm.apk (97,195,140 bytes), cobalt-arm64.apk (168,173,905 bytes)

## License

Upstream TizenTube is GPL-3.0-only. Preserve the LICENSE file and provide corresponding source with any redistributed builds.
