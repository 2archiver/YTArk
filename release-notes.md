YTArk 3.9

Reliable updates, simpler profiles, compact diagnostics.

- Updater storage initialization and recovery are serialized and retryable. Metadata checks remain available when optional cleanup cannot run; downloading and installing require usable private storage.
- Release metadata validates the official single ARMv7 APK digest directly. A checksum sidecar is not required when GitHub supplies the digest.
- Three old Who’s watching settings migrate to one Off/On control. Off suppresses automatic profile prompts only; manual account and sign-in flows remain available.
- About → Diagnostics contains four controls: Android updater, Recording, Startup summary, and Clear diagnostic data. Guest sign-in reminders and retired diagnostic reports/labels are removed.

ARMv7 (armeabi-v7a): [Download APK](https://github.com/2archiver/YTArk/releases/download/v3.9.0/YTArk-v3.9.0-armeabi-v7a.apk). Not for arm64-v8a-only devices; a 64-bit CPU alone is insufficient. 4K does not select an APK architecture.

Upgrade over the installed app. If the 3.8 updater cannot recover, manually install the signed 3.9 APK once; do not uninstall or clear app data. Package/signing identity and the TizenTubeCobalt v2.0.2 engine remain unchanged.
Notices and licenses: https://github.com/2archiver/YTArk/blob/main/NOTICE.md

Known limitations: Android SDK compilation and signed-candidate inspection, Android TV permission/install behavior, in-place device upgrade, playback, and Google TV behavior remain unverified until the checks in `docs/YTARK-3.9.0-EVIDENCE.md` are completed.

<!-- Package io.github.twoarchiver.ytark; 3.9.0; versionCode 3090000; base TizenTubeCobalt v2.0.2. -->
