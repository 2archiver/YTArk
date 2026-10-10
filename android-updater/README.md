# Native YTArk updater

The Android classes here are compiled to DEX by `tools/build_android_updater.sh`
and injected into the pinned TizenTubeCobalt APK during repackaging. The
updater, notifications, permissions, and installer handoff are additive; the
base app's Cobalt classes, YouTube account stack, and playback libraries are not
replaced.

## Stable release contract

The updater requests GitHub's canonical
`https://api.github.com/repos/2archiver/YTArk/releases/latest` endpoint and
accepts only releases with explicit `draft=false` and `prerelease=false` flags.
For YTArk 2.1, the stable tag is `v2.1.0`, the release title is `YTArk 2.1`,
the display version is `2.1`, and Android uses versionName `2.1.0` with
versionCode `2010000`. The version code is checked against every published
stable release, including historical tags. Release assets are named
`YTArk-v2.1.0-armv7.apk` and `YTArk-v2.1.0-arm64.apk`.

The updater selects only the APK matching the ABI embedded in the installed
YTArk APK. It verifies the exact official asset URL, release flags, tag and
version, versionCode, asset size, SHA-256, package ID, native library ABI, and
signer before exposing Android's PackageInstaller. GitHub's asset digest is
used when available; otherwise a required entry in `SHA256SUMS.txt` is used.
There is no guessed download URL or silent installation path.

## TV-friendly update screen

The YTArk settings menu opens a native `YTArk Updates` screen designed for
remote/D-pad navigation. It shows the installed version, last/next check and
retry status, stable release notes, and update/download/verification/install
states. The user can check again, retry or resume a matching interrupted
transfer, cancel a download, skip a release, choose Later, or enable Android 13+
notifications from the screen. Network failures and GitHub rate limits do not
become false “up to date” results.

Checks use persisted timing: a six-hour successful-check interval, bounded
retry delay after failures, and Retry-After / GitHub rate-limit reset deadlines.
They occur shortly after app-process startup when eligible, and periodically
while that process is alive. Notification permission is requested only after
the user chooses **Enable Update Notifications**. Downloaded APKs and partial
files remain in private app storage and are matched against the current release
metadata before reuse.

Before handing the APK to Android, YTArk rechecks the official checksum,
package ID, version, ABI, and pinned signing certificate. Android's standard
installer requires the user to confirm the in-place update. YTArk does not
uninstall the app, clear app data, or claim silent installation. The installed
package ID and signing identity are held constant so Android can preserve local
settings and the Cobalt login/cookie store during a compatible update.

## Signing identity warning

The certificate fingerprint is
`b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae`, matching
Hearth's intentionally public community keystore. Its private key and passwords
are public; the pin proves signer continuity, **not publisher authenticity**.
The updater rejects another signer, but anyone with that public key can produce
a signer-matching APK. Install release assets only from the official YTArk
repository. The key is retained to avoid stranding existing installs; rotating
it casually would make an in-place update fail and could require an uninstall
that erases app data. See `docs/SIGNING.md` for the disclosed exposure and
coordinated migration options.

## Contract tests

Host-JRE tests exercise SemVer ordering, historical versionCode comparison,
ABI selection (including armv7), stable release flags, official URLs, SHA-256
fallback, interrupted-download resume metadata, and persisted retry/rate-limit
scheduling. These tests do not replace a signed APK build, Android Package
Installer exercise, physical-TV navigation, or a login-preserving in-place
upgrade test; those results must be reported separately.
