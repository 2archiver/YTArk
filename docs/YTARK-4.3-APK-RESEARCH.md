# Official YouTube TV ARMv7 compatibility research

Checked 22 October 2026 (Brisbane). Keep TizenTubeCobalt v2.0.3 as the 4.3 base. An official APK with the same native library filename is not evidence that its JNI/Starboard contracts, injection hooks or updater bridge are interchangeable.

## Selected files and provenance

The [APKMirror catalog](https://www.apkmirror.com/apk/google-inc/youtube-for-android-tv-android-tv/) listed 7.27.302 as newest stable and 7.29.300 as beta. Selected [7.27.302 standalone ARMv7 / Android 7.0+ / nodpi variant](https://www.apkmirror.com/apk/google-inc/youtube-for-android-tv-android-tv/youtube-for-android-tv-7-27-302-release/youtube-for-android-tv-7-27-302-3-android-apk-download/), not the same-code APKM bundle or ARM64 variant. The actual linked download was fetched and checked as a ZIP/APK, not saved HTML.

- Official file: 76,441,681 bytes. SHA-256 `496fab358ee39dfc7c9881c2a838c0d7d90275dfa44ad1aae47ae2a56398aa44`.
- Actual aapt manifest: `com.google.android.youtube.tv`, versionName 7.27.302, code 727302320, minimum API 24, target API 36, launcher `com.google.android.apps.youtube.tv.activity.ShellActivity`.
- apksigner verifies v2 and v3 signatures and source stamp. Actual Google certificate SHA-256 `21199d112cece428c82cb0df221da24ff8674c7a982a83a17a970eec43305b4a`, matching [published certificate metadata](https://www.apkmirror.com/apk/google-inc/youtube-for-android-tv-android-tv/youtube-for-android-tv-7-27-302-release/). This certificate fingerprint is distinct from the APK file hash above.
- Native inventory: six libraries, all ELF32 / e_machine 40 (ARM), only `armeabi-v7a`: libchrobalt.so, libchrome_crashpad_handler.so, libframesequence.so, libmemorymappedbufferjni.so, libnative_crash_handler_jni.so and libnativecrashdetectorutil.so. DEX and resources are present locally in this standalone APK. No split requirement was observed in its manifest. Installation was not attempted.
- Current base: [TizenTubeCobalt v2.0.3](https://github.com/reisxd/TizenTubeCobalt/releases/tag/v2.0.3), downloaded through the repository's metadata/size/digest/ABI verifier. Actual upstream package io.gh.reisxd.tizentube.cobalt, version 2.0.3/code 203, minimum API 24/target 36, launcher dev.cobalt.app.MainActivity. Actual signer fingerprint `378ea3935af1b95c32f6ce193f4ff7f420cdc2d7160c8c866d28d6a91042ec9a`. YTArk repacks and signs with its separate existing pinned community identity.

## Compatibility table

| Interface | TizenTubeCobalt 2.0.3 | Official stable 7.27.302 | Optional 7.29.300 beta |
|---|---|---|---|
| ABI / OS | ARMv7 ELF32, API 24 minimum | ARMv7 ELF32, API 24 minimum; actual APK verified | Catalog ARMv7/code 729300320; not downloaded, binary evidence UNVERIFIED |
| Loader / libraries | Cobalt MainActivity; two native libraries | ShellActivity; six native libraries | UNVERIFIED |
| Main ELF dependencies | libdl, libm, libandroid, liblog, libGLESv2, libjnigraphics, libEGL, libmediandk, libc | Same DT_NEEDED list for libchrobalt; additional libraries/dependencies in official inventory | UNVERIFIED |
| Start URL / assets | Native youtube.com/tv literal; TizenTube userscript CDN literals | Native youtube.com/tv literal; no tested TizenTube script URL literal | UNVERIFIED |
| JS/native bridge | h5vcc/TizenTube markers and InstallAppFromURL literal; audited BaseStarboardBridge method patch | Generic h5vcc/Cobalt markers present, but TizenTube/InstallAppFromURL markers absent from inspected native/DEX files | UNVERIFIED |
| Userscript injection | Exact 69-byte compiled URL is the repacker's verified injection path | Exact injection URL absent; existing patcher would reject the official library | No integration mechanism established |
| Native updater | Repacker audits and replaces the pinned install method, injects updater DEX | No evidence of the same audited method contract or handoff | UNVERIFIED |
| Package/signing | YTArk preserves io.github.twoarchiver.ytark and its pinned signer after repack | Google package and Google signer differ; cannot be installed as an in-place YTArk update | Catalog only |
| Decision | Retain for 4.3 candidate | Research only; no hybrid APK/experimental integration branch | No beta integration attempted |

The official libchrobalt.so is 62,621,244 bytes with SHA-256 `a3c259cfda71fc157d534c4c58cbca5e30f38c74e53a88a4d867352869b2d281`. Shared dependencies and a shared filename do not validate JNI symbol, Starboard or bytecode compatibility. The two packages' DEX payloads also differ. String-marker absence supports rejection of the existing exact patch mechanism; it is not a proof that no future source-based integration could exist.

## Supported path and limits

No integration mechanism was demonstrated, so no native library was transplanted and no Google-signed APK was modified or redistributed. Downloaded proprietary bytes and unpacked content remain in work/apk-research, outside the Git source tree and deliverable patch. The comparison JSON contains metadata/hashes/dependencies only.

A source-based upgrade would start from the TizenTubeCobalt source and its compatible Cobalt/Chromium revision, then forward-port the Blink Document::ImplicitClose userscript injection/CSP path, h5vcc.tizentube Mojo/JNI contracts, Android host activity/Starboard bridge and native updater handoff together. It requires rebuilding the full matching ARMv7 shell/native stack, auditing the generated bridge method, and rerunning the listed device/upgrade tests. It is a proposed engineering path, not a completed newer engine or a measured improvement. There is no claim that 7.27.302 yields newer served UI, better codec support, sharper playback or higher FPS.

Tools used: Android SDK aapt/apksigner 36.0.0 for initial research, Java 17.0.20.1, Python ZIP/ELF header and dynamic-section inspection; candidate build uses CI-pinned SDK API 34/build-tools 34.0.0, Kotlin 2.1.20-release-217, Apktool 3.0.3 with repository-pinned digest. Tool SDK downloads were checked against the official Google repository metadata, JDK against Adoptium release metadata. Full exported native symbols were not analyzed; dynamic dependencies and ELF architectures were. No physical TV test was possible.
