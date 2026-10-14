YTArk 2.9

Repaired ARMv7 release build, safer update installation, and settings and OLED fixes.

- The 2.9 release build failure is fixed.
- Installer success is confirmed against installed package metadata.
- Updater failures report the phase that actually failed.

**Draft — not built, not published; no signed candidate APK or device run exists.**

ARMv7 (armeabi-v7a): [Download APK](https://github.com/2archiver/YTArk/releases/download/v2.9.0/YTArk-v2.9.0-armv7.apk). Not for arm64-v8a-only devices; a 64-bit CPU alone is insufficient. 4K does not select an APK architecture.

Known issues: in-page native screen links are not dispatched by the pinned
Cobalt base; open YTArk Updates from the TV apps row, which offers Cache &
Storage. Keyboard and installer need device verification.

<!-- Package io.github.twoarchiver.ytark; 2.9.0; versionCode 2090000; base TizenTubeCobalt v2.0.2. -->
