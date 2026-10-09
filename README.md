# YTArk — Personal Tube TV

Personalized TizenTubeCobalt build with custom TV controls, built entirely by
GitHub Actions — inspired by the YouMod / YTKACE one-click build pipelines.

## One-click build (YouMod style)

1. Go to **Actions** → **Build Personal Tube TV APKs** → **Run workflow**
2. Keep the defaults (or change app name / id / base version) and run
3. Wait ~15–25 min; grab the APKs from **Releases** (or the run's artifacts)

Every build:
- compiles the custom userscript from this repo (16 unit tests run first),
- publishes it to a jsDelivr-servable tag (`s<N>`),
- downloads the official TizenTubeCobalt base APKs (size-verified against
  the upstream release metadata),
- repacks them: new app id + label + version, custom userscript URL patched
  into `libchrobalt.so` (same byte length → CSP allowlist stays valid),
- signs, verifies (signature + badging + patched URL) and publishes a
  GitHub Release with both ABIs.

Pushing a tag matching `apk-v*` triggers the same pipeline hands-free.

## Install

- **Google TV 4K / Chromecast with Google TV / most modern boxes** → `arm64-v8a`
- Older 32-bit devices → `armeabi-v7a`
- Sideload with Downloader by AFTVnews, `adb install`, or a file manager.
- Installs **alongside** the official app (`io.github.personal.tubetv`).

## What's inside

- 🎛️ **TV Quick Controls** — first item in the in-app settings
  - Presets: **Clean TV** (hides Shorts, previews, end cards, related),
    **Midnight Blue**, **Classic Dark**
  - One-level **Undo** for the last preset
  - **Quick Quality**: Auto / 2160p / 1440p / 1080p / 720p with
    largest-below-target fallback
- 🚫 **Upstream updater disabled** (it would otherwise try to install the
  official APK over this one)
- 🛡️ **Resilient config** — corrupt/null/array storage, failed writes and
  missing keys all fall back safely
- Everything else from upstream TizenTubeCobalt v2.0.2 (ad block,
  SponsorBlock, DeArrow, speed control, themes, casting)

## Signing (important)

By default each build is signed with an **ephemeral** key generated in CI and
never persisted — safe, but you must **uninstall before installing a newer
build**. For in-place updates, configure these repository secrets once
(Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | `base64 -w0 your.keystore` of a PKCS12/JKS keystore you generate locally |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | key password |

Generate a keystore locally (never commit it):

```bash
keytool -genkeypair -v -keystore personaltv.jks -storetype PKCS12 \
  -alias personaltv -keyalg RSA -keysize 2048 -validity 10950
base64 -w0 personaltv.jks   # paste into ANDROID_KEYSTORE_B64
```

## How the APK mod works

The upstream APK loads its userscript by injecting
`<script src="https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?v=<timestamp>">`
from `Document::ImplicitClose()` (blink `document.cc`, compiled into
`libchrobalt.so`), and its CSP allowlist already permits `cdn.jsdelivr.net`.

The build therefore:
1. publishes the custom userscript to a repo tag → served at
   `https://cdn.jsdelivr.net/gh/2archiver/YTArk@s<N>/userScript.js`
2. binary-patches the URL literal in `libchrobalt.so` — the replacement is
   the **same host** and **same byte length** (zero-padded `?v=` query), so
   no CSP patching and no ELF surgery beyond the string itself
3. renames the package (`io.gh.reisxd.tizentube.cobalt` →
   `io.github.personal.tubetv`), the FileProvider authority, and the app
   label via apktool (resources + dex are kept raw — minimal decode)
4. stores native libs uncompressed + `zipalign -p` for modern Android

`tools/configure_cobalt.py` remains available for full source builds.

## Repo layout

| Path | What |
|---|---|
| `.github/workflows/build-apk.yml` | The whole build pipeline |
| `tools/repack_apk.py` | APK repack logic (has a `--self-test`) |
| `tools/publish_script_tag.sh` | Publishes userscript to a jsDelivr tag |
| `tools/sign_apks.sh` | Secret/ephemeral signing |
| `tools/create_release.sh` | Release notes + asset publishing |
| `tools/configure_cobalt.py` | URL replacement for Cobalt **source** builds |
| `TizenTube/` | Modified TizenTube source (upstream `9dd70a7` + mods) |
| `TizenTube/mods/tests/tv-controls.test.mjs` | 16 unit tests |
| `personal-tv.patch` | Diff against pinned upstream |

## Local JS development

```bash
cd TizenTube/mods
npm ci --no-audit --no-fund
node tests/tv-controls.test.mjs   # 16 tests
npm run build                     # → ../dist/userScript.js
```

## Provenance & licenses

- Base APK: [reisxd/TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt)
  v2.0.2 (Cobalt/Chromium — Apache-2.0/BSD; see upstream LICENSE)
- Userscript: modified [TizenTube](https://github.com/reisxd/TizenTube)
  (GPL-3.0-only) — complete corresponding source is this repository; every
  release additionally ships `NOTICE.md`, the exact `userScript.js`, and
  checksums. GitHub attaches the source archive automatically.
- This project is for personal use; it is not affiliated with YouTube,
  Google, TizenTube or TizenTubeCobalt.
