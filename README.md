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

Like Hearth, YTArk checks GitHub's canonical `releases/latest` API endpoint
when its Android process starts and every six hours while it is running. The
release workflow marks the validated YTArk build as the latest stable release.
The native updater:

- Selects the version-named, 64-bit ARM APK built for Google TV OS 14 / Android
  14 from the official [YTArk Releases](https://github.com/2archiver/YTArk/releases).
- Requires the release title, version tag, `versionCode`, APK filename, URL,
  size, and SHA-256 to satisfy the checked-in release contract; it never guesses
  an asset URL or accepts an unverified checksum.
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

YTArk uses the **same signing certificate as Hearth** so releases keep one
stable Android signing identity. Its pinned SHA-256 fingerprint is
`b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae`; the public
certificate is checked in under `signing/`. The updater checks both the
candidate APK and the installed app against this fingerprint before handing an
update to Android, as well as checking the official release URL, SHA-256,
package ID, version, and ARM64 ABI.

This is Hearth's intentionally public **community** PKCS#12 signer, not a
private production key: the keystore, alias, and password are published in the
Hearth source. Anyone can build an APK with this signing identity. That is the
explicit trade-off for using the same key; install YTArk only from the official
[YTArk Releases](https://github.com/2archiver/YTArk/releases). The APK updater
still rejects files from non-official release URLs, mismatched checksums,
package metadata, architecture, or signer certificates. Because the community
key is public, the certificate pin guarantees signer continuity and Android
install compatibility—not the publisher's identity; use only the official
YTArk release page. The signer is pinned to a specific Hearth commit and Git
blob in `release/signing.properties`, and the build verifies the extracted
certificate against the checked-in fingerprint before signing.

The production workflow uses this pinned community key automatically when the
four optional `YTARK_*` Actions secrets are absent. If all four are configured,
they must hold the same signing identity or the build fails; partial or
mismatched configuration is never allowed. To cache the pinned key in Actions
secrets, `bash tools/provision_signing_key.sh` is optional. It will not generate
or rotate a key. Keep `signing/YTArk-release-cert.pem` and
`signing/YTArk-cert-sha256.txt` in source control; never add another keystore or
change the pinned certificate without a deliberate migration plan.

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
OpenSSL, and GitHub access to fetch the pinned public community keystore. Matching
`YTARK_*` Actions secrets are optional.

## Upstream attribution

YTArk retains attribution to **TizenTubeCobalt** as its Android/Cobalt base and
to **TizenTube** for the GPL-3.0-only userscript. See `TizenTube/LICENSE`, the
release `NOTICE.md`, and the upstream project notices. YTArk is an independent
project and is not affiliated with YouTube, Google, TizenTube, or
TizenTubeCobalt.
