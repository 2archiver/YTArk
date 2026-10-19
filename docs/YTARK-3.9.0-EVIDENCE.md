# YTArk 3.9.0 candidate evidence

**Disposition:** candidate review only. This branch has not been merged and no
release or tag has been created. Device/runtime claims below are limited to
what was actually executed.

## Candidate identity and repository state

| Field | Candidate |
|---|---|
| Branch | `arena/f3a73947-ytark` |
| Base commit | `95561381ef259848aee4de69c9bc1015e4eefd60` |
| Package | `io.github.twoarchiver.ytark` |
| Version / display version | `3.9.0` / `3.9` |
| Version code | `3090000` |
| Planned release tag / userscript tag | `v3.9.0` / `s40` |
| Unchanged base | TizenTubeCobalt `v2.0.2` |
| APK target | `YTArk-v3.9.0-armeabi-v7a.apk` (ARMv7 only) |

Before editing, the live repository was checked: `main` was at the base commit,
`v3.8.0` was the latest published release, no PR was open, and remote tags
`v3.9.0` and `s40` did not exist. A later recheck before PR creation confirmed
that `main` remained at the base and those two tags remained absent. No tag was
created or moved. The PR candidate workflow is non-publishing; merge/release
publication is not authorized by this task.

## Executed checks

| Result | Check | Actual result |
|---|---|---|
| **PASS** | JavaScript regression suite: `cd TizenTube/mods && node --test tests/*.test.mjs` | 374 tests passed, 0 failed, 0 skipped (82 suites). |
| **PASS** | Userscript build: `cd TizenTube/mods && npm run build && node --check ../dist/userScript.js && python3 ../../tools/check_bundle_contract.py` | Rollup build and bundle contract passed; 45 required symbols, 837,445 characters. Existing Browserslist-age, circular-dependency, and Rollup `preventAssignment` warnings remain. |
| **PASS** | Python suite: `python3 -m unittest discover -s tools/tests` | 256 tests ran, no failures, 1 skipped. The skipped test invokes the shared Java/Kotlin runner and requires a host JDK. |
| **PASS** | Generated metadata | `python3 tools/build_buildinfo.py --check` and `python3 tools/build_changelog.py --check`; changelog is current with 27 versions, newest `3.9.0`. |
| **PASS** | Release identity | `python3 tools/validate_release.py emit-env --file /tmp/ytark-release.env` emitted `3.9.0`, display `3.9`, code `3090000`, `v3.9.0`, `s40`, base `v2.0.2`, and package `io.github.twoarchiver.ytark`. |
| **PASS** | Release-note contract | The publish template renders 109 words; its contract test passes, including ARMv7-only guidance, the manual signed-3.9-over-3.8 bootstrap route, and unchanged package/signing/base identity. |
| **PASS** | Repository policy and hygiene | `bash -n tools/*.sh`, `python3 tools/check_workflow_policy.py`, `python3 tools/check_no_secrets.py`, and `git diff --check` passed. |
| **PASS** | Static release/package contracts | Included in the 256-test Python run: version ordering, package/base/manifest constraints, pinned base checksum, release-asset/digest rules, and candidate workflow policy. |
| **PASS** | Remote source-validation workflow | Run [39267758209](https://github.com/2archiver/YTArk/actions/runs/39267758209), head `f9f5bc4eda96b1954f838e90577884407efb02cf`: userscript, Python/shell checks, Kotlin updater tests, full updater compilation/D8, unsigned ARMv7 repack integration, JNI bridge and manifest/install-authorization checks all succeeded. |
| **PASS** | Signed ARMv7 candidate workflow | Run [39267758174](https://github.com/2archiver/YTArk/actions/runs/39267758174), same head: build, Kotlin production-contract tests, repack, alignment/signature/package validation, checksum creation/verification, static in-place-upgrade eligibility and artifact upload all succeeded. No release was published. |
| **PASS** | Candidate package identity/content reported by CI | APK `YTArk-v3.9.0-armeabi-v7a.apk`, SHA-256 `3495988ee94164781d81d5f3b60ad09e27f7d3b1040e137a6614fb41da855d8a`; package `io.github.twoarchiver.ytark`, version `3.9.0`, code `3090000`, native ABI `armeabi-v7a`, signer certificate SHA-256 `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae`. CI reports `eligible_armv7=true` against the prior published APK. The uploaded artifact `ytark-3.9.0-armv7-candidate-f9f5bc4eda96b1954f838e90577884407efb02cf` is 58,773,975 bytes (GitHub archive SHA-256 `83b110dc6ba637ab6c4ba31b988f198bb416da1e14fca967014fe6b0f056967d`). |

The official published `v3.8.0` GitHub release metadata was also inspected before
editing: one ARMv7 APK, GitHub SHA-256 digest
`da475dcbd8e69c310cfb2e104b1ae8c9283066f09b6cbbf5655c5263e9841dc1`, and no
checksum-sidecar asset. The checked-in fixture is
`android-updater/src/test/resources/github-v3.8.0-release.json`.

## Unverified checks and limits

| Result | Check | Actual limit |
|---|---|---|
| **PASS (remote); UNVERIFIED locally** | Kotlin updater host tests, including `UpdateCoordinatorStorageWiringTest` | Both remote workflows passed on the exact head. The local machine has no `java`/`javac`, so one local Python wiring test skips; `tools/test_android_updater.sh` is reproducible on a JDK host. |
| **PASS (remote); UNVERIFIED locally** | Full Kotlin Android compilation and DEX build | The source-validation workflow compiled all updater sources and produced DEX; the candidate workflow also passed production updater contract tests. Local Java/Android SDK tools are absent. |
| **PASS (CI validation); UNVERIFIED (independent extraction)** | Signed 3.9.0 ARMv7 candidate | The candidate workflow passed its signer, badging/ABI, archive-integrity, alignment, checksum and static upgrade-eligibility checks; the CI annotation and GitHub artifact metadata are recorded above. I attempted `gh run download 39267758174 -D /tmp/ytark-candidate-39267758174`, but GitHub redirected the 58,773,975-byte archive to `productionresultssa3.blob.core.windows.net`, which is outside this sandbox's network allowlist and returned `EOF`. Thus I could not independently extract the uploaded ZIP, inspect its manifest/report/files or rerun the APK checksums locally. No independent byte-level inspection beyond GitHub's reported metadata is claimed. |
| **UNVERIFIED** | Android/Google TV runtime and in-place upgrade | No `adb`, emulator or device was available. No device ABI, Android API level, installed candidate, or runtime scenario was observed. A device record must name the model, ABI, Android/API version, package/versionCode and exact APK SHA-256, then cover preserved account/preferences, update check/download/hash/cancel, permission return, Android installer result, focus/Back, startup, playback/navigation, and Google TV separately. |

The remote workflows prove build-time checks only. No APK was installed; no
install-permission grant, installer success, in-place upgrade, playback, startup
or Google TV runtime result is claimed by this report.

## Reproduction commands

From the repository root:

```sh
python3 -m unittest discover -s tools/tests
python3 tools/build_buildinfo.py --check
python3 tools/build_changelog.py --check
python3 tools/validate_release.py emit-env --file /tmp/ytark-release.env
bash -n tools/*.sh
python3 tools/check_workflow_policy.py
python3 tools/check_no_secrets.py
git diff --check
```

Remote CI evidence is available from [source-validation run 39267758209](https://github.com/2archiver/YTArk/actions/runs/39267758209) and [candidate run 39267758174](https://github.com/2archiver/YTArk/actions/runs/39267758174). When GitHub artifact downloads are reachable, independently extract and re-check the exact candidate with:

```sh
gh run download 39267758174 -D /tmp/ytark-candidate
APK="$(find /tmp/ytark-candidate -name 'YTArk-v3.9.0-armeabi-v7a.apk' -print -quit)"
test -n "$APK"
sha256sum "$APK"  # expected 3495988ee94164781d81d5f3b60ad09e27f7d3b1040e137a6614fb41da855d8a
"$ANDROID_HOME/build-tools/$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"
"$ANDROID_HOME/build-tools/$BUILD_TOOLS/aapt" dump badging "$APK"
unzip -tq "$APK"
"$ANDROID_HOME/build-tools/$BUILD_TOOLS/zipalign" -c -p 4 "$APK"
```

For the Java/Kotlin host runner, use `tools/test_android_updater.sh`. For the
Android/D8 build, use `ANDROID_HOME=<Android-SDK> API_LEVEL=34
BUILD_TOOLS=34.0.0 tools/build_android_updater.sh`. On a real ARMv7 Android TV,
record device/build identifiers and each scenario result before changing any
runtime row from **UNVERIFIED**. An emulator is not Google TV evidence.

## Checklist

- [x] Preserve package/base/version/signing configuration and ARMv7-only target.
- [x] Implement retryable updater storage/controller wiring and explicit failure states.
- [x] Validate official release digest metadata and retain checksum-sidecar fallback coverage.
- [x] Migrate the old profile booleans to one reversible Off/On choice; preserve manual account/sign-in flows.
- [x] Reduce About → Diagnostics to the four requested rows; keep valid older samples readable and bound native overlay text/focus behavior.
- [x] Remove guest sign-in reminder runtime behavior and retired diagnostic controls/commands.
- [x] Regenerate 3.9.0 build/changelog assets and prepare release notes.
- [x] Run available JS, Python, build, generator, release-policy and hygiene checks; both remote CI workflows pass on the PR head.
- [x] Build/sign and CI-verify the ARMv7 candidate; record its package identity, APK SHA-256, ABI, signer fingerprint, archive digest and upgrade-eligibility result.
- [ ] Independently download/extract/re-verify the uploaded artifact — **UNVERIFIED**, signed artifact storage host is outside this sandbox's network allowlist.
- [ ] Validate behavior on Android TV / Google TV — **UNVERIFIED**, no device evidence.
- [ ] Merge or publish — **not requested and not done**.
