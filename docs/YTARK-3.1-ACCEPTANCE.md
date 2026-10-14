# YTArk 3.1 candidate — implementation and acceptance evidence

## Baseline (2026-10-14)

- Starting commit: `43566afa7ca484b4b9c9ca9d69853477c11da5fa` (published 3.0).
- Latest stable: v3.0.0, code 3000000, s29; release run **38548250208** succeeded.
  The prior run **38547734939** failed in prior-version APK validation, not native
  compilation; the latest commit fixes that. The stale StorageActivity reference
  is already absent and was not resurrected.
- Baseline JavaScript: **262/262 passing**. Python baseline passed (JDK-dependent
  test skipped before obtaining a toolchain).
- Static reproduction: Settings action → `window.location.href=ytark://updates`
  → Cobalt default external-protocol handler drops navigation → timed Apps-row
  instruction. The old manifest declares a separate launcher proxy. No Android
  device was available to reproduce a remote click at runtime.
- Host inspection at upstream v2.0.2: C++ H5vccTizentubeImpl::InstallAppFromURL →
  StarboardBridge → protected Java installAppFromURL(String). This established
  transport is now a screen-only Kotlin bridge. No new Cobalt native API is assumed.

## Local evidence (updated as checks finish)

- All production Kotlin files compile against Android API 34 using JDK 17 and
  Kotlin 2.1.20. The only current compiler warning is the supported but deprecated
  ACTION_INSTALL_PACKAGE path (Android consent is retained).
- All **11 original Java assertion suites** pass against Kotlin production
  policies, plus **17 Kotlin state/schedule/permission assertions**.
- JavaScript suite: **266/266** after startup-path and routing tests were added.
- Full Android SDK/D8/sign/package validation is being run on the session branch.
  Do not interpret the local class JAR as a signed Android artifact.

The sandbox has no device, adb/emulator or Android SDK installation. GitHub release
binary redirects and raw Actions logs are blocked by its host allowlist. A JDK and
Kotlin compiler were obtainable from locked npm distributions; API 34 stubs were
read from the Sable/android-platforms GitHub mirror. CI uses Google's actual SDK.
The pinned, intentionally public community signer remains authorized by the
repository's existing release configuration; no new key was generated.

## Permission/API review

The developer.android.com host is unavailable in this sandbox. The official AOSP
Android 14 source mirror was checked instead:

- `aosp-mirror/platform_frameworks_base`, tag `android-14.0.0_r1`,
  `core/java/android/content/pm/PackageManager.java`, canRequestPackageInstalls:
  API26-targeting callers must declare REQUEST_INSTALL_PACKAGES; false means
  installation is blocked until the user trusts the source.
- Same tag, `core/java/android/provider/Settings.java`,
  ACTION_MANAGE_UNKNOWN_APP_SOURCES: optional `package:actual.package` input,
  **no success output**. Returning from Settings is not permission evidence.
- Intent/content-URI installation is used, not PackageInstaller sessions; no
  PendingIntent callback or silent-install privilege is assumed. A URI lease is
  kept until installation is reconciled, not deleted on activity return.

## Acceptance matrix

Statuses below are deliberately conservative. Tests of policies are not device
passes. “NOT RUN” rows will be updated with exact branch-build results.

| Requirement | Status | Evidence / remaining gate |
|---|---|---|
| Kotlin production updater compiles and is in final APK | NOT RUN | API34 Kotlin compile passes; final D8/APK gate pending |
| Cold start and Updates without missing classes/resources | BLOCKED | No Android device; static DEX definition gate implemented |
| Direct working Updates page with three controls | BLOCKED | Host patch + private screen implemented; runtime click needed |
| No Apps-row workaround/helper/extra icon | NOT RUN | Source removed; compiled manifest gate pending |
| Manual check/download/install through real UI | BLOCKED | Requires Android TV and a newer test candidate |
| Missing permission → grant → same APK → installer | BLOCKED | Candidate-bound one-shot continuation implemented; real UI unexercised |
| Already-granted permission skips only Settings | BLOCKED | Policy tests pass; real UI unexercised |
| Deny/Back/revoke/installer cancel retry | BLOCKED | APK retained and return reconciled; real UI unexercised |
| Repeated clicks/resumes cannot duplicate flows | BLOCKED | Atomic work gate and foreground flow guard; Android race tests needed |
| Automatic check/download; Never cancels job | BLOCKED | Kotlin schedule rules pass; JobScheduler device evidence needed |
| Background download never launches system UI | BLOCKED | Background call graph has no UI path; playback test needed |
| Process death/reboot/version reconciliation | BLOCKED | Snapshot/revalidation implemented; force-stop/reboot test needed |
| Wrong ABI/package/signer/downgrade/corruption/network/full disk | BLOCKED | Policy coverage + implementation; fault-injection/device tests needed |
| Faster startup alternate path/default/fallback | PASS | Executable timer tests: opt-in 0/50ms polling, normal 250ms, bounded fallback and crash marker |
| Startup speed claims supported or unverified | PASS | Benefit explicitly **unverified**, no measured speed claim |
| D-pad/Back/focus across screens | BLOCKED | Stable native view tree, saved focus; physical remote checks needed |
| Removed settings remain removed; search/playback/session | BLOCKED | Existing JS suites pass; real playback/login tests needed |
| Signed ARMv7 identity/ABI/alignment/signature | NOT RUN | Branch candidate workflow pending |
| In-place upgrade from actual 3.0 retains login/settings | BLOCKED | No owner TV / representative signed-in installation |
| Final-commit CI / publication accurately reported | NOT RUN | Review branch only; no merge/tag/publication authorized here |

## Faster startup methodology for the owner TV

The engine launch, Android splash, YouTube DOM creation, userscript injection and
session restore are unchanged. The actual alternate path reduces the optional
250ms polling wait for mod controls/resolver readiness to an immediate attempt and
50ms retries for two seconds. After that it uses normal cadence, stopping at 40s.
A persisted in-progress marker forces normal startup after an interrupted attempt.
It does not hide a splash, manufacture a ready state, reload, or initialize twice.

On the **same signed candidate bytes** and same TV/network/account: perform five
force-stop cold launches Off, then five On (alternate order on a second run).
Record monotonic timestamps from launcher intent to visible home with a successful
D-pad move/select; include first-launch outliers separately. Perform five warm
background/resume cycles for each mode. Record median and range, not an invented
percentage. Also kill the process during accelerated initialization and verify the
next launch follows the normal path. No timing measurements have been made here.

## Publication and candidate usability

Do not merge or publish until the owner reviews remaining gates. Branch builds
cannot publish because the existing publish job requires refs/heads/main. The APK
is bound to s30; the unchanged host loads the userscript remotely. Until authorized
publication makes that immutable endpoint live, the candidate is a **static
package-validation artifact**, not a fully usable runtime upgrade. Do not install
it over the owner's signed-in TV before arranging the script and runtime checks.
