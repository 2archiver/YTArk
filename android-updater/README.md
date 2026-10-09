# Native YTArk updater

The Android classes here are compiled to DEX by `tools/build_android_updater.sh`
and injected into the TizenTubeCobalt APK during repackaging. No Java classes or
Android framework libraries from the base application are replaced.

## Release contract (Hearth-style)

The updater requests GitHub's canonical
`https://api.github.com/repos/2archiver/YTArk/releases/latest` endpoint. A
published stable release must have the title `YTArk`, a `v<version>` tag, a
parseable `versionCode` in its release notes, and the versioned ARM64 asset
`YTArk-v<version>-arm64.apk`. It uses the asset URL and size returned by GitHub,
requires the exact official YTArk download URL, and reads the APK SHA-256 from
GitHub's asset digest or `SHA256SUMS.txt`. It does not guess a download URL or
continue without a full checksum. The workflow only marks the release latest
after metadata, asset, APK, and Android install validation succeed.

`UpdateReleaseContractTest` exercises this public release metadata contract,
including the Hearth-style versionCode parsing, versioned asset URL, strict
SHA-256 parsing, and checksum-file fallback. The build and PR workflows run it
without requiring an Android runtime.

## Verification and installation

The updater checks for updates on app-process startup and every six hours while
the process is alive. It requires a 64-bit ARM device and selects the single APK
built for Android 14 / Google TV OS 14. Before offering or installing an update,
it validates the published SHA-256, package ID, version name and code, native
ABI, official release URL, and the pinned YTArk signing certificate. It also
checks that the installed app uses that same certificate. The fingerprint is
`b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae`, shared with
Hearth's intentionally public community signing key. This pin establishes signer
continuity, not publisher identity: because the private key is public, only install
builds from the official YTArk release page.

The updater never installs silently: the user must choose **Update Now**, then
**Install Update**, and confirm Android's standard installer prompt. Unknown-app
installation permission is checked and, when needed, opened through Android
Settings. The APK and interrupted partial download are held in app-private
storage. `PackageInstaller` applies an in-place update under the same package ID
and signing key, leaving app data intact.

A `ytark://updates` deep link exposes the remote-friendly update screen from the
YTArk settings menu. The update notification also offers **Update Now**, **Later**
and **Check for Updates** actions.
