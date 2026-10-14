> **Historical record.** This review documents the abandoned 2.9.1 split of the
> 2.9 work. That version line was never published: its build runs failed in the
> userscript step before repacking, so no APK, tag, artefact or release exists
> for `2.9.1`, `2090100` or `s29`. The identity values in the tables below are
> the draft's, not the current release contract. See
> [`SETTINGS-2.9-RECOVERY-REVIEW.md`](SETTINGS-2.9-RECOVERY-REVIEW.md) for the
> consolidated 2.9 candidate and current evidence.

# YTArk 2.9.1 implementation review

**Review date:** 2026-10-14 (Australia/Brisbane)  
**Candidate state:** unpublished source candidate; not merge-ready until the blocked integration and device evidence below are resolved.

This review records implemented code as well as the limits of the evidence. A
JavaScript URL assignment, an Android intent filter, a mocked action, or a
successful Python/Node suite is not evidence that pinned Cobalt launches an
Android activity. No Android build, signed candidate APK, installer exercise or
physical-device result exists in this worktree.

## Release identity and compatibility boundary

| Property (abandoned draft identity) | Draft target / evidence |
|---|---|
| `versionName` / `displayVersion` | `2.9.1` / `2.9.1` |
| `versionCode` | `2090100`; exceeds published v2.8.0 (`2080000`) |
| Release tag | `v2.9.1` (not created) |
| Userscript tag | `s29` (unused on the remote at the last tag check; published `s27` for v2.8.0 is unchanged) |
| Planned APK | `YTArk-v2.9.1-armv7.apk`; ARMv7 / `armeabi-v7a` only; not built |
| Package | `io.github.twoarchiver.ytark` |
| Android base | TizenTubeCobalt `v2.0.2`; no Cobalt version/dependency upgrade |
| In-place update base | Published v2.8.0; same package, signing setup and app-data path are configured |
| Published history | v2.8.0 was published 2026-10-13 as “YTArk 2.8”, versionCode 2080000, script `s27`; its history is retained in `CHANGELOG.md` |

`tools/validate_release.py emit-env`, `tools/build_buildinfo.py --check`, and
release-contract tests confirm the source metadata. The checked-in public
certificate fingerprint is verified by the secret scan/build support checks.
This does **not** prove that a new signed APK was produced, that Android accepts
its signer/version, or that a real 2.8.0 user's account and preferences survive
an update. No uninstall, data reset, credential clearing or preference reset is
used or proposed as a workaround.

## Requirement status

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| 2.9.1 identity, ARMv7-only target, package and pinned base | **PASS — source contract only** | Release properties, generated build metadata and Python release-contract tests agree. The signed APK/package boundary is not built or checked. |
| Reconcile history with published v2.8.0; keep 2.9.1 notes to new changes | **PASS — source/docs** | `CHANGELOG.md`, generated in-app data and `release-notes.md` now distinguish published 2.8.0 from the unpublished 2.9.1 candidate. |
| Preserve existing updater; real release source, signer, package/version/ABI/integrity validation | **PARTIAL — source/static tests and host-JRE policy tests** | Existing updater remains the implementation. Python/Node tests and the pure-Java policy suite passed. GitHub Actions compiled/runs the host-JRE policy classes; Android-specific code, real APK validation and system-installer behavior remain unverified. |
| Installer state recovery, cancellation/retry and installed-version confirmation | **PARTIAL — pure-Java policy tests passed; Android integration not run** | `InstallerResultPolicy` covers return outcomes, durable target fallback, installed-version comparison and bounded cleanup; `UpdateActivity` polls PackageManager instead of trusting a result code. The pure-Java policy tests passed on the GitHub runner. Process recreation and device flows remain **NOT RUN**. |
| `installerUnavailable` reports the correct failure phase | **FIXED IN SOURCE; policy tests passed** | Validation failures retain the validation phase; unavailable system installer remains install phase. The host-JRE regression test passed in GitHub Actions; Android integration remains uncompiled here. |
| Persistent/foreground updater checks and explicit opt-outs | **PARTIAL — source only** | Existing JobScheduler and foreground-resume flow remains; the candidate preserves separate automatic-check/download preferences. Scheduler timing, duplicate-work behavior and process recovery are not Android-tested. |
| Updates and Storage settings actions reach the native activities in pinned Cobalt | **BLOCKED / NOT VERIFIED** | Node tests prove only the exact URI assignment and its fallback UI; Python tests prove only manifest declarations. See “Cobalt dispatch investigation” below. No claim of working native navigation is made. |
| Restrict native route inputs and external callers | **PARTIAL — source/static manifest tests** | `NativeRoutePolicy` accepts only the matching screen URI and optional `theme=oled|youtube`; route activities require an app-signature permission, and a separate public Leanback launcher proxy opens Updates. The package permission does not authenticate the initiating web-page origin. Java compile and device dispatch are unverified. |
| Native theme handoff / synchronize OLED and YouTube palettes | **PARTIAL — source only** | Native screens persist only a valid theme from a matching route and use scoped native colors. Route dispatch, preference durability across Android recreation and device appearance are untested. |
| OLED styling reversible and safe for media/artwork/captions/focus | **PARTIAL — userscript source tests** | Styling remains scoped and keeps player scrim independent. Node tests pass; full YouTube surfaces, focus, media/artwork/captions and 720p/1080p/4K coverage remain **NOT RUN**. |
| Settings/search/focus and required viewports | **PARTIAL — userscript tests** | Source tests pass for search and focus behavior. TV IME, DPAD operation, viewport scaling and return-focus behavior remain **NOT RUN** on hardware. |
| Cache cleanup, pending/resumable APK protection, path/symlink safety | **PARTIAL — source/static tests** | Existing private-directory and confirmation boundaries remain; route/activity and cleanup behavior are not compiled or exercised on Android. No data, account, cookie, database or unrelated offline-content deletion is allowed. |
| Preserve sign-in, existing preferences and watch state on update | **NOT VERIFIED** | No signed APK or device upgrade exists. This cannot be established from source tests. |
| Signed ARMv7 candidate build | **BLOCKED IN THIS WORKSPACE** | No JDK/Javac, D8, apktool or Android SDK; `ANDROID_HOME` and `ANDROID_SDK_ROOT` are unset. No candidate APK was created. |
| Physical Android TV / Google TV acceptance | **NOT RUN** | No device or matching APK test evidence exists. |

## Cobalt dispatch investigation

The pinned v2.0.2 source was inspected through GitHub's API. In
`cobalt/android/apk/app/src/main/java/dev/cobalt/coat/CobaltActivity.java`,
`initializeJavaBridge()` registers `HTMLMediaElementExtension` through
`JavascriptInjector`; no YTArk navigation bridge is registered there. The same
source has a TODO about deep-link handling in Cobalt. The inspected
`cobalt/shell/android/java/src/dev/cobalt/shell/Shell.java` does not establish a
custom URI-to-Activity dispatch path, and the upstream shell manifest's main
Activity filters cover HTTP/HTTPS URLs. These observations do **not** prove that
all Chromium/Cobalt runtime paths reject the URI; they mean no working dispatch
path has been established from the pinned integration source.

Current userscript routing assigns only `ytark://updates` or `ytark://storage`
with the current OLED/YouTube theme. A visible-page fallback toast advises users
to open the updater from the TV apps row or retry. Native code revalidates the
matching route; arbitrary actions, package names, component names, paths and
query parameters are not accepted. A signature-level Android permission blocks
launch by callers signed with a different certificate. That is not a web-origin
check: if an untrusted page inside the trusted YTArk process could reach Cobalt's
external-intent handler, this manifest boundary alone would not identify the
page origin.

**The Updates and Storage routes remain unaccepted as working until a signed
candidate is tested end-to-end on the pinned Cobalt runtime.** If the custom
scheme does not reach Android, the fix needs a supported, origin-restricted
Cobalt-to-native dispatch mechanism (not another manifest filter or JavaScript
URL assignment). The Settings Updates card remains read-only; no
`window.ytarkUpdater` bridge has been added.

## Changes implemented in this candidate

- Integrated pure installer-return and failure-phase policies into the existing
  updater; kept success dependent on the installed package version and
  cancellation recoverable when the verified APK remains available.
- Fixed `installerUnavailable` phase classification so failed final APK
  validation remains a validation failure, not an installer failure.
- Added `UpdateLauncherActivity` as a separate public Leanback proxy. The
  Updates/Storage route activities require a YTArk app-signature permission;
  route URI parsing remains exact and screen-only.
- Restricted theme persistence to a valid matching `updates`/`storage` route;
  refreshed persisted schedule summaries after installer return.
- Preserved pending/resumable cleanup boundaries and retained separate update
  preferences; no settings schema migration is introduced for 2.9.1.
- Reconciled changelog and active acceptance docs with published v2.8.0, updated
  candidate notes, and added this review.

## Validation performed in the worktree

| Check | Result |
|---|---|
| `node --test --test-reporter=tap tests/*.test.mjs` in `TizenTube/mods` | **282 passed, 0 failed, 0 skipped** |
| `npm run build` in `TizenTube/mods` | **Passed**; userscript output 850,192 bytes |
| `node --check ../dist/userScript.js` and bundle content checks | **Passed** |
| `python3 -m unittest discover -s tools/tests` | **128 passed, 0 failed** |
| `python3 tools/repack_apk.py --self-test` | **Passed** (manifest/zip/DEX-injection self-tests; not a real APK repack) |
| `python3 tools/build_changelog.py --check` and release-notes render | **Passed** |
| `python3 tools/build_buildinfo.py --check` | **Passed** |
| `python3 tools/build_logo_asset.py --check`; `python3 tools/render_launcher_art.py --check` | **Passed** |
| `python3 tools/check_no_secrets.py --history`; `python3 tools/check_workflow_policy.py` | **Passed** |
| Python compile checks, shell syntax checks and `validate_release.py emit-env` | **Passed** |
| [GitHub Actions PR check at `3f09d57`](https://github.com/2archiver/YTArk/actions/runs/38512914154) | **Passed** — userscript build/tests, Python/release checks, and the Java 8 host-policy suite all succeeded |
| Android-specific Java compilation, DEX generation, APK repack/signing | **NOT RUN** — no local Android SDK/JDK/D8/apktool; no candidate APK |
| Cobalt-to-Android dispatch, PackageInstaller, upgrade continuity and TV viewport tests | **NOT RUN** |

Rollup emitted existing non-fatal warnings for circular module dependencies,
old Browserslist data and the `@rollup/plugin-replace` `preventAssignment`
default. No dependency upgrade was made for those warnings.

## Review / merge disposition

This source change is suitable for review, but **not ready to merge** against the
active acceptance criteria: actual Cobalt route delivery and device-side updater,
installer, upgrade-continuity, cache and OLED results are missing, and the Android
candidate is not built or signed. Do not publish, tag `v2.9.1` or `s29`, claim
full completion, or merge to `main` until the blocking evidence is supplied.
