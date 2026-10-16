# YTArk 3.5.2 evidence report

Status: **candidate on branch `arena/f407bd23-ytark`, not merged, not published.**
This report records what was implemented, what was actually verified, and what remains
**NOT RUN**. Nothing here claims that 3.5.2 fixes the historical "Allow from this source"
switch reset on the user's TV, that it installs, upgrades, or starts faster on any device.

User correction carried through this whole cycle: **3.5.1 was never tested on the user's
TV.** No statement in this report or the changelog says or implies that 3.5.1 resets the
permission switch, fails installation, or starts slowly on a device. The switch-reset and
slow-startup observations belong to earlier versions (≤ 3.5.0) and remain unexplained for
any specific device.

## 0. Identity

| Item | Value |
|---|---|
| versionName / display | 3.5.2 |
| versionCode | 3050200 (mapping `major*1e6 + minor*1e4 + patch*100`, checked by `tools/validate_release.py`) |
| Planned tag | `v3.5.2` (does not exist on the remote as of 2026-10-16) |
| Userscript tag | `s36` — verified unused against `git ls-remote --tags` on 2026-10-16 (highest existing is `s35`); `s35` and all release tags are untouched |
| Package | `io.github.twoarchiver.ytark` (unchanged) |
| Signing identity | pinned community identity `signing/YTArk-cert-sha256.txt` (unchanged lineage; no new key) |
| Base / ABI | TizenTubeCobalt `v2.0.2`, `armeabi-v7a` only (unchanged; no ARM64 claim) |

## 1. Baseline verification performed in this environment

- Remote state re-checked live: `v3.5.1` is the published latest release
  (2026-10-16T05:38:03Z, publication run recorded in `docs/YTARK-3.5.1-EVIDENCE.md`);
  tags `v3.5.1` and `s35` exist; `s36`/`v3.5.2` do not.
- The published 3.5.1 APK bytes could **not** be re-downloaded here: this sandbox only
  reaches `github.com`/`api.github.com`, and release assets redirect to
  `release-assets.githubusercontent.com`, which is blocked. The packaged-manifest facts
  (target API 36, minSdk 24, uncapped `REQUEST_INSTALL_PACKAGES`, ARMv7, signer digest)
  are therefore taken from the repository-recorded 3.5.1 evidence, not re-measured:
  **APK re-inspection NOT RUN** in this sandbox; CI re-runs the packaged-manifest and
  signer gates on the new candidate instead.
- No TV or matching test device is available in this environment, so the §2 baseline
  device test of the genuine signed 3.5.1 APK (install in place, capture
  `canRequestPackageInstalls()`, AppOp, UserManager restrictions, Settings route) was
  **NOT RUN**. The historical switch-reset symptom was **not reproduced** here and its
  cause remains an open question with the classification defined in the implementation
  brief (A: works / B: stale UI / C: app defect / D: profile restriction / E: unknown).
  This candidate ships fixes for defects that are **provable from source** (below) and
  does not claim to resolve outcome D or E.

## 2. Defects confirmed from source and fixed (root cause, not hypothesis)

Each item lists the defect, the evidence that it is real, and the fix. "Confirmed"
means reproducible from the source in this repository (and, where noted, by a host
test), not observed on a TV.

### 2.1 Startup navigation was silently lost when the command resolver was absent

`ui.js` ran `execute_once_dom_loaded()` as soon as `document.body` existed and marked
`startupSteps.navigation = true` **before** calling `resolveCommand()`. The default
`resolveCommand()` iterates `window._yttv` and returns `undefined` without error when no
module exposes a resolver instance — so the startup destination (`launchToOnStartup`) or
the `reloadHomeOnStartup` soft reload dispatched at that moment vanished without a trace,
and the step flag prevented any retry. Confirmed by reading
`mods/resolveCommand.js` (the `for (const key in window._yttv)` loop) and covered by the
new unit test `tests/startup-navigation.test.mjs` ("navigation is deferred while the
resolver is absent and dispatched once it appears").

Fix: navigation moved to `features/startupNavigation.js`. It is dispatched exactly once,
only when a resolver instance exists, keeps the explicit-destination priority over the
soft reload, keeps `reloadHomeOnStartup=false` a no-op, and is part of the readiness
contract (`tick` returns ready only after navigation completed). If the resolver never
appears, the bounded 40 s window now reports the give-up (`onGiveUp` in
`features/startupReadiness.js`) instead of ending silently. The guide refresh
(`reloadGuideAction`) moved to the same resolver-ready moment for the same reason —
`getCommandExecutor()` finds nothing before `window._yttv` exists — and it is now
idempotent across controls-initialization retries (it previously re-ran on every retry).

The cadence of the experimental faster-startup poll (50 ms for the first 2 s, then
250 ms, first attempt at 0/250 ms, 40 s bound, interruption marker) is **unchanged**:
there is no measurement yet establishing when the DOM and resolver actually become
available on a TV, so changing the cadence would be guesswork.

### 2.2 `resolveActivity` precheck could block a usable Settings route

`InstallAuthorizationAccess.openSettings()` filtered the ordered Settings intents
through `intent.resolveActivity(pm)` before trying to launch. On modern Android,
package-visibility filtering can make `resolveActivity` answer `null` for a screen that
`startActivityForResult` opens normally; the precheck then reported "no supported
install-authorization screen" without ever attempting the launch. This is exactly the
"intent visibility differs from launchability" failure mode, and it could present to a
user as "YTArk says nothing can change the switch".

Fix: launch-and-catch. Each route is attempted in order; outcomes are classified by the
new pure policy `InstallPermissionEntryPolicy.openOutcome` (`launched` / `not-found` /
`blocked` → `null` / `unavailable` / `blocked`), host-tested in
`InstallCapabilityPolicyTest.java` and `StateTest.kt`. No `QUERY_ALL_PACKAGES` and no new
manifest `<queries>` were added; the package-scoped URI still uses runtime
`context.packageName`, and the list-screen and legacy Security-settings fallbacks stay.

### 2.3 API 24–25 capability classification applied the Android 8+ rule

`InstallCapabilityPolicy.canHoldAuthorization(targetSdk, declaresPermission)` and
`state(...)` encoded the *per-source* prerequisites (target ≥ 26, declared
`REQUEST_INSTALL_PACKAGES`) with no OS parameter, while `routeForApi` sends API 24–25 to
the legacy global Security setting. On a legacy device the packaged-manifest facts are
irrelevant to the global setting: a package with target < 26 or a missing declaration
would have been classified `target-too-old` / `permission-not-declared` and the Updates
screen would have refused the legacy route that could actually have worked, with an
explanation describing a per-app switch that does not exist on Android 7.

Fix: API-aware overloads `canHoldAuthorization(api, …)` and `state(api, …)` plus
`explanation(state, api)`; on API 24–25 the classification depends only on the readable
legacy setting (granted / not-authorized / unreadable), below API 24 there is no route,
and the legacy explanation names the one global setting. `InstallAuthorizationAccess`
passes `Build.VERSION.SDK_INT`. The previous signatures keep modern semantics and the
existing tests keep passing; new host tests pin the legacy behavior
(`InstallCapabilityPolicyTest.java`, `StateTest.kt`). Existing API guards
(`routeForApi`, the `SDK_INT in 24..25` legacy read of `INSTALL_NON_MARKET_APPS`) are
preserved.

### 2.4 The two permission entry paths could race and stack Settings screens

Entry route (fresh Updates entry, request code `ENTRY_PERMISSION`) and install route
(validated download → `InstallCoordinator.openPermission`, request code `PERMISSION`)
tracked in-flight state independently. Windows existed where both could launch a
Settings screen (e.g. the posted entry-route launch firing after an install request had
already opened its own route), stacking screens and racing their returns.

Fix: `UpdateActivity.installerRouteOwnsSettings()` (phase `AwaitingPermission` /
`AwaitingInstaller`) blocks the entry route from starting or launching, and
`openPermission` skips its own launch while `permissionRouteInFlight` is set — the
pending install then continues from the entry route's return via `resumed()`. One
permission request per deliberate fresh entry is preserved (`permissionEntryAttempted`,
restored across recreation).

### 2.5 Pending install could be cleared (or continued) without a genuine external return

`InstallCoordinator.resumed()` acted on any state notification with phase
`AwaitingPermission` and a pending identity once `flow` was false. A state update while
the activity was still visible — before the user ever left for Settings — is not proof
of a return, but it was treated as one.

Fix: `UpdateActivity.departedForExternal` models "the external screen actually left the
app": set in `onPause` while a system-screen detour is pending and by an
`onActivityResult` for the detour request codes (proof of return even across process
death), persisted in the saved instance state. `PendingInstallPolicy.mayContinue` gained
a `departed` parameter and a new `shouldClear`; without departure evidence `resumed()`
neither continues nor clears. Lifecycle transitions are host-tested at the policy level
(`StateTest.kt`); the Activity wiring itself is only verifiable on a device (**NOT
RUN**).

### 2.6 Focus and accessibility on the Updates screen

- When a grant hid the "Allow installs" button, `render()` moved focus to
  `checkButton` unconditionally; if a check was in flight (`checkButton` disabled) focus
  fell to nowhere. `requestFallbackFocus()` now picks the first enabled, visible action
  in remote order.
- The status line kept `ACCESSIBILITY_LIVE_REGION_POLITE` while download progress
  repainted it every tick, announcing byte counts continuously. The live region is now
  `NONE` during `Downloading` and `POLITE` for phase-level messages.

### 2.7 Startup measurement instrumentation (new, measurement-only)

- `features/startupTiming.js`: monotonic marks (`performance.now()` where supported,
  Date.now-relative fallback), idempotent per name, log-only (`[YTArk][startup] <mark>
  t=<ms>` in the JS console/logcat): `script-eval`, `dom-body`, `controls-ready`,
  `resolver-ready`, `startup-navigation` (with `soft-reload` / `explicit-destination` /
  `disabled` detail), `first-remote-key`, `first-playback`, and
  `startup-navigation-given-up`. Host-tested (`tests/startup-timing.test.mjs`).
- Native `StartupTimeline` (updater): one-shot `elapsedRealtime` marks for
  `process-start` (bootstrap provider creation) and `first-activity-resumed`, logcat tag
  `YTArkStartup`.
- The two clocks are deliberately never subtracted: native and JS timelines are read
  side by side, and joining them requires an explicit calibration event. This is the
  instrumentation the §5 startup acceptance protocol measures with; it is not itself a
  speed change.

## 3. Things deliberately NOT changed

- `reloadHomeOnStartup` stays default-on and its soft reload still dispatches on cold
  start (now reliably, see 2.1). Whether that reload is a redundant request on the
  initial Home is a measurement question; the `startup-navigation` mark records which
  command was issued so a device run can answer it. Turning the preference off to
  manufacture a benchmark win is explicitly not done. Measurement: **NOT RUN**.
- Faster startup stays **opt-in, off by default**, and remains a polling-cadence
  optimization only. It does not accelerate Cobalt loading, the system splash,
  authentication or network response time, and no speedup percentage is claimed.
- The interruption marker in `startupReadiness.js` still forces one normal-paced launch
  after an interrupted accelerated boot; wording now states that an interruption is not
  necessarily a crash and never disables the setting permanently (behavior unchanged).
- The 30 s deferral of optional automatic checks after resume already existed in
  `NativeComponents.kt` and is not re-claimed as new.
- No change to `applicationId`, target/min SDK, signing lineage, package identity,
  AdBlock/response-interception order, login or profile selection, or script
  verification. No companion updater app, no privileged permissions, no
  `QUERY_ALL_PACKAGES`.
- `release-notes.md` at the repository root is rendered by the publication pipeline and
  was left untouched, consistent with the 3.5.x cycles.

## 4. Verification actually run for this candidate

Host environment: Node 22.22.3, Python 3.11.2; **no JVM, no Android SDK and no device in
this sandbox** (release-asset and SDK hosts are unreachable), so every Android-side gate
runs in hosted CI on the pull request, exactly as in the 3.5.1 cycle.

Run locally (this worktree, candidate commit):

| Check | Result |
|---|---|
| `node --test tests/*.test.mjs` (TizenTube/mods) | **312/312 pass** (was 300; +12 new startup navigation/timing/give-up tests) |
| `npm run build` + `node --check dist/userScript.js` | pass (bundle 781,873 chars) |
| `tools/check_bundle_contract.py` | pass (45 contract symbols) |
| `python3 -m unittest discover -s tools/tests` | **234 tests, OK (1 skipped)** after updating the pinned identity literals (3.5.2/3050200/s36, next-patch 3.5.3/3050300, published-record 3.5.1) |
| `tools/build_changelog.py --check` / `--write`, `release-notes --version 3.5.2` | pass (three concise sentences, ≤ 65 words; About highlights ≤ 132 chars) |
| `tools/build_buildinfo.py --check` / `--write` | pass (3.5.2 / 3050200 / s36) |
| `tools/validate_release.py emit-env` | pass: VERSION_NAME=3.5.2, VERSION_CODE=3050200, VERSION_TAG=v3.5.2, SCRIPT_TAG=s36, APK_ARMV7=YTArk-v3.5.2-armv7.apk, no ARM64 |
| `tools/repack_apk.py --self-test`, `tools/apk_manifest.py` self-test, `check_workflow_policy.py`, `render_launcher_art.py --check`, `build_logo_asset.py --check`, `fetch_premium_logo.py --verify-only`, `check_no_secrets.py --history`, `bash -n tools/*.sh` | all pass |
| Kotlin policy suite (`tools/test_android_updater.sh`) | **NOT RUN locally (no JVM)**; runs inside CI's full-source build step |
| Full-source Kotlin compile vs real API-34 `android.jar`, D8, repack, zipalign, signature and packaged-manifest gates | run by `ci.yml` / `build-candidate.yml` on the PR — see §4.1 |

### 4.1 Hosted CI results (filled from the actual runs)

- `ci.yml` validation run: _(pending — see the PR checks; to be recorded here)_
- `build-candidate.yml` run: _(pending)_
- Candidate APK `YTArk-v3.5.2-armv7.apk` SHA-256: _(pending from the candidate run)_
- Signer SHA-256 equality with `signing/YTArk-cert-sha256.txt`: _(pending)_
- Packaged manifest facts (package / versionCode / minSdk / targetSdk / install capability): _(pending)_

## 5. Device acceptance protocol (smallest targeted checklist) — ALL NOT RUN

No device was available for this cycle. When the user's TV (or a matching test device)
is available, this is the smallest checklist that answers the open questions. Record
device model, Android API, firmware, profile, installed package/version and the APK
SHA-256 before starting. Do not uninstall or clear app data at any point.

**Baseline first (genuine signed 3.5.1 APK, in place):**

1. Install 3.5.1 over the existing build; confirm version, session and preferences.
2. Open Updates → Allow installs; enable "Allow from this source" and **stay on the
   system page ≥ 10 s**; note whether the switch stays on, flips back while on the page,
   or stays on but is reported stale after returning (outcomes A/B/C/D/E per the brief).
3. Reopen the system page, relaunch the app, reboot the TV; verify the grant and the
   matching YTArk state each time.

**3.5.2 candidate:**

4. Real signed in-place upgrade 3.5.1 → 3.5.2; confirm versionCode 3050200 via the
   Updates screen and PackageManager, settings and Google session retained. (If the
   installed 3.5.1 cannot authorize itself on this device, the first corrected APK may
   need an already-authorized installer for the in-place upgrade — that is a documented
   bootstrap constraint, never an uninstall.)
5. Permission flows: deny, cancel, retry, grant, revoke, retry — no loops, no duplicate
   Settings screens, no double install; recreate/kill the updater during a Settings
   detour and recover with exactly one continuation.
6. Focus: with the Allow button visible, grant the permission and confirm focus lands on
   an enabled action; run a download and confirm no repeated screen-reader announcements.
7. Faster startup off and on: ≥ 10 process-cold launches per condition, alternating
   order, same device/firmware/network/account, force-stopped (data never cleared);
   record raw samples, median and range for usable Home and remote responsiveness from
   the `[YTArk][startup]` marks (JS) and `YTArkStartup` marks (logcat), warm launches
   separately; verify playback, hooks, profile selection, offline recovery and explicit
   startup destinations; check whether the `startup-navigation soft-reload` mark shows a
   redundant Home request on cold start.
8. Returning from Android Settings resumes Updates (never a Home reload or a second
   cold-boot interpretation).

## 6. Release acceptance status (honest boundary)

1. Source/tests passed — **PASS** locally for JS/Python; Kotlin/D8/manifest gates run in
   CI (§4.1).
2. Final APK built and statically verified — **CI result, see §4.1** (candidate only;
   publication is a separate, deliberate step that this branch must not trigger).
3. Real install and upgrade verified — **NOT RUN** (no device).
4. Permission persistence verified on identified TV hardware — **NOT RUN** (no device);
   the historical switch-reset cause remains **UNVERIFIED/unknown** for the user's TV.
5. Startup improvement measured — **NOT RUN**; 3.5.2 ships the instrumentation to make
   this measurable and claims no speedup.

A known failing check blocks release; an unavailable test is NOT RUN, not PASS. If the
device-specific switch issue remains unverified after §5, 3.5.2 must not be described as
a guaranteed fix — it is a candidate with source-proven repairs, honest reporting and a
measurement path.
