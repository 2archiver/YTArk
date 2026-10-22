# Local 4.3 candidate artifacts

NOT PUBLISHED. Not installed or device-tested. Three native test programs failed on this Windows host; rerun them in Linux CI before release approval.

- APK: `candidate/YTArk-v4.3.0-armeabi-v7a.apk` (82,907,446 bytes).
- APK SHA-256: `5218ae2a028fd4f7aa49a0ab4b9c55fc5e21bcae6856218da9b1150e378cd49d`.
- Tested userscript: `userScript.js`; SHA-256 `d28782393b6141f4dc14370ebe2c86bdc8b2106959315d86d0158ddf3ac21cd6`.
- Package/version: `io.github.twoarchiver.ytark` / 4.3.0 / 4030000; ARMv7 only; minimum SDK 24, target SDK 36 retained from the upstream manifest.
- Signer: existing pinned YTArk community certificate, SHA-256 `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae`.
- PASS: SDK validator, 28,110 unique DEX classes, private relocated Kotlin runtime, screen-only JNI updater bridge, compiled manifest, MAIN/LEANBACK launcher/exported flags, icon/banner references, v2/v3 signature, ZIP integrity and zipalign `-p 4`.
- PASS: static upgrade eligibility against the downloaded published 4.2 ARMv7 APK (package, ABI, signer and increasing versionCode); no installation was performed.
- PASS: initial repack audited all 26,571 upstream host class disassemblies and verified exact native bytes except the fixed-length userscript URL replacement. The appended updater DEX was then refreshed from the final generated changelog, re-signed and revalidated; upstream DEX/native payloads were unchanged by that refresh.
- PASS: extracted TV banner pixels match the generated banner after decoding Android's lossless RGBA-to-RGB optimization. Extracted logo pixels match the immutable original. `banner-extracted-from-apk.png` was visually inspected.
- IMPORTANT: native engine fetches `https://cdn.jsdelivr.net/gh/2archiver/YTArk@s44/userScript.js?v=`; s44 remains unpublished. The APK does not embed the new JavaScript. Installing it alone will not activate the sidebar/thumbnail fixes until the script is made available through the supported delivery path.

See implementation-report.md for source changes and device checklist, APK-compatibility-report.md for official APK evidence, native-test-results.json for all native test-program outcomes, and SHA256SUMS.txt for copyable checksums.
