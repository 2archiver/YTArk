# YTArk

YTArk is a standalone Android TV / Google TV application based on
[TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt), with YTArk Quick
Controls and a native, user-confirmed updater. The repository also includes the
complete modified TizenTube userscript source.

## Current release identity

| Component | Value |
|---|---|
| Android package ID | `io.github.twoarchiver.ytark` |
| Android launcher label | `YTArk` |
| Release title | `YTArk` |
| Version | `2.0.3-ytark.15` |
| Google TV OS 14 / 4K APK | `YTArk-v2.0.3-ytark.15-arm64.apk` |

## Automatic Android TV updates

YTArk checks the latest **published stable** YTArk release when its Android
process starts and every six hours while it is running. The native updater:

- Selects the single 64-bit ARM APK built for Google TV OS 14 / Android 14
  from the official [YTArk Releases](https://github.com/2archiver/YTArk/releases).
- Offers remote-friendly **Update Now**, **Later**, and **Check for Updates**
  controls in its Android TV notification and update screen.
- Resumes interrupted downloads from app-private storage and checks the
  published SHA-256, package ID, version name/code, ABI and pinned signing
  certificate before continuing.
- Uses Android's `PackageInstaller`; the user must explicitly select **Install
  Update** and confirm the standard Android installer prompt. It never installs
  silently or grants unknown-app permission on the user's behalf.
- Opens the Android unknown-app installation permission screen when needed.

Open **YTArk Quick Controls → YTArk Updates → Check for Updates** to run a check
manually. YTArk also preserves settings and app data when a later build is
installed over the same package ID with the same production signing key.

The first production build establishes the permanent signing identity. If an
older installation uses a different package ID, install the first production
build as a new app; Android isolates data between package IDs, so that one-time
migration cannot transfer the old app's private data. If an older build already
uses this package ID but has a temporary signing certificate, Android requires
uninstalling it before the production-signed build can be installed. Uninstalling
removes that old app's private data. After the production build is installed,
subsequent YTArk updates preserve settings and app data in place.

## Signing and release setup

Every release must be signed with the same production keystore. The private
keystore and passwords are never committed; GitHub Actions requires these
repository secrets and fails rather than creating an ephemeral signing key:

- `YTARK_KEYSTORE_B64` — base64-encoded PKCS#12 keystore.
- `YTARK_KEYSTORE_PASSWORD` — keystore password.
- `YTARK_KEY_ALIAS` — key alias (`ytark-release` when provisioned by the helper).
- `YTARK_KEY_PASSWORD` — private-key password.

After GitHub Actions secret-write access is available, provision the production
key exactly once with:

```bash
bash tools/provision_signing_key.sh
```

The helper generates the PKCS#12 keystore in a protected temporary directory,
sets the Actions secrets, exports only the public certificate and SHA-256
fingerprint to `signing/`, and deletes the temporary private material. Commit
`signing/YTArk-release-cert.pem` and `signing/YTArk-cert-sha256.txt`; never
commit a `.p12`, `.jks`, private key, password, or base64 keystore.

## Building and releasing

The supported production build runs from **Actions → Build YTArk APK for Google
TV OS 14**. It builds and tests the userscript, compiles the native updater,
downloads the pinned 64-bit ARM TizenTubeCobalt base APK, and repacks, signs and
validates the single Google TV OS 14 / Android 14 APK. It creates a **draft**
release first; publication follows only after validation. An ARM64 Android 14
emulator validates installation and the updater deep link. Once a previous
production-signed YTArk APK exists, the workflow installs it and verifies an
in-place upgrade; the first release uses a clean install because the earlier
package identity is different.

Update `release/version.properties` for each subsequent production release.
The required version format is `<semver>-ytark.<serial>`; the serial increases by
one and determines Android `versionCode` (`20000 + serial`). For example, the
current `2.0.3-ytark.15` build uses versionCode `20015`.

Local userscript development:

```bash
cd TizenTube/mods
npm ci --no-audit --no-fund
node --test tests/tv-controls.test.mjs
npm run build
```

A full APK build requires Android SDK platform/build tools, Java 17, Apktool,
and the production signing secrets.

## Upstream attribution

YTArk retains attribution to **TizenTubeCobalt** as its Android/Cobalt base and
to **TizenTube** for the GPL-3.0-only userscript. See `TizenTube/LICENSE`, the
release `NOTICE.md`, and the upstream project notices. YTArk is an independent
project and is not affiliated with YouTube, Google, TizenTube, or
TizenTubeCobalt.
