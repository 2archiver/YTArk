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
| **PASS** | Static release/package contracts | Included in the 256-test Python run: version ordering, package/base/manifest constraints, pinned base checksum, release-asset/digest rules, and candidate workflow policy. These are host/static checks, not an APK build or installation. |

The official published `v3.8.0` GitHub release metadata was also inspected before
editing: one ARMv7 APK, GitHub SHA-256 digest
`da475dcbd8e69c310cfb2e104b1ae8c9283066f09b6cbbf5655c5263e9841dc1`, and no
checksum-sidecar asset. The checked-in fixture is
`android-updater/src/test/resources/github-v3.8.0-release.json`.

## Unverified checks and limits

| Result | Check | Why it is unverified |
|---|---|---|
| **UNVERIFIED** | Kotlin updater host tests, including `UpdateCoordinatorStorageWiringTest` | `java` and `javac` are absent. The one skipped Python test records this same limitation. Run `tools/test_android_updater.sh` with a JDK to execute it. |
| **UNVERIFIED** | Full Kotlin Android compilation and DEX build | `java`, `javac`, `sdkmanager`, and `adb` are unavailable; `ANDROID_HOME`/`ANDROID_SDK_ROOT` is unset. Run `ANDROID_HOME=<Android-SDK> API_LEVEL=34 BUILD_TOOLS=34.0.0 tools/build_android_updater.sh` in an Android build environment. |
| **UNVERIFIED** | Signed 3.9.0 ARMv7 candidate artifact identity/content | No candidate artifact exists in this workspace yet. The same-repository PR workflow is intended to build, sign, verify and upload it. If it succeeds, inspect the exact head-matched artifact and candidate report before marking this row PASS; do not infer signature/content from a source build. |
| **UNVERIFIED** | Android/Google TV runtime and in-place upgrade | No `adb`, emulator or device was available. No ABI, Android API level, installed candidate, or runtime scenario was observed. The required device record must name the model, ABI, Android/API version, package/versionCode and exact APK SHA-256, then cover preserved account/preferences, update check/download/hash/cancel, permission return, Android installer result, focus/Back, startup, playback/navigation, and Google TV separately. |

No Android compile, emulator/device test, APK install, install-permission grant,
installer success, in-place upgrade, playback result, or Google TV result is
claimed by this report. The source/test additions improve coverage but do not
replace those checks.

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
- [x] Run all available JS, Python, build, generator, release-policy and hygiene checks recorded above.
- [ ] Compile and execute Android updater tests — **UNVERIFIED**, host JDK unavailable.
- [ ] Build and inspect signed ARMv7 candidate — **UNVERIFIED** pending PR workflow artifact.
- [ ] Validate behavior on Android TV / Google TV — **UNVERIFIED**, no device evidence.
- [ ] Merge or publish — **not requested and not done**.
