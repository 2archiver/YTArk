# Native YTArk updater

The Android classes here are compiled to DEX by `tools/build_android_updater.sh`
and injected into the TizenTubeCobalt APK during repackaging. No Java classes or
Android framework libraries from the base application are replaced.

The updater checks the latest published stable release on app-process startup
and every six hours while the process is alive. It requires a 64-bit ARM device
and selects the single APK built for Android 14 / Google TV OS 14. It validates
the release metadata and SHA-256, checks package ID,
version code, ABI and the pinned production signing-certificate fingerprint,
then submits the verified package to Android's `PackageInstaller`.

The updater never installs silently: the user must choose **Update Now**, then
**Install Update**, and finally confirm Android's standard installer prompt.
Unknown-app installation permission is checked and, when needed, opened through
Android Settings. The APK and interrupted partial download are held in app-private
storage. `PackageInstaller` applies an in-place update under the same package ID
and signing key, leaving app data intact.

A `ytark://updates` deep link exposes the remote-friendly update screen from the
YTArk settings menu. The update notification also offers **Update Now**, **Later**
and **Check for Updates** actions.
