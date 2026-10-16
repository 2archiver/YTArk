# YTArk 3.6.0 candidate evidence report

Status: **candidate on `arena/30326b60-ytark`; not merged or published.** This is a
source-and-host-test snapshot prepared before opening the draft pull request,
not an Android package or device-validation report. Hosted pull-request checks
were not yet available at this snapshot and are not claimed here; their result
will be visible on the pull request.
No candidate APK was produced in this environment, so there is no candidate APK
hash to record. No tag, release, asset, or main-branch publication was created
or changed.

This report distinguishes what was verified from what remains **NOT RUN**. The
permission-return and playback changes address conditions confirmed from source
and host policy/state tests; they do not claim a widespread or device-reproduced
user failure. `docs/YTARK-3.5.2-EVIDENCE.md` remains an unchanged, dated snapshot
of that earlier candidate cycle.

## 0. Candidate identity and preserved lineage

| Item | Candidate value / evidence |
|---|---|
| `versionName` / display | `3.6.0` / `3.6` |
| `versionCode` | `3060000`, using the existing `major*1,000,000 + minor*10,000 + patch*100` mapping |
| Planned release tag / userscript tag | `v3.6.0` / `s37` |
| Package | `io.github.twoarchiver.ytark` (unchanged) |
| Signing lineage | Existing pinned community certificate in `signing/YTArk-cert-sha256.txt`; no key rotation |
| Base / ABI | TizenTubeCobalt `v2.0.2`; `armeabi-v7a` only |
| SDK / build system | Existing Android SDK 34 / target contract and current Kotlin, D8, and APK-repack build path; no Gradle migration |
| Current upstream release | `v3.5.2`, published `2026-10-16T09:07:53Z`; the live GitHub release API and remote refs were rechecked on 2026-10-16 |
| Candidate-ref availability | Live `git ls-remote` found `v3.6.0` and `s37` unused; existing `v3.5.2` and `s36` were left untouched |

Generated packaging metadata is sourced from `release/version.properties` and
checked in `TizenTube/mods/assets/buildInfo.generated.js`. The historical
publication date and release record for 3.5.2 are preserved in `CHANGELOG.md`;
3.6.0 remains explicitly unreleased.

## 1. Browser diagnostics

`TizenTube/mods/features/browserDiagnostics.js` is an opt-in recorder. Config
schema 6 adds `recordBrowserDiagnostics: false`; missing-key migration keeps the
default off without replacing any existing explicit settings. When off at
bootstrap it does not open the diagnostics keys, install diagnostic listeners,
create sampling timers, or collect events. Viewing or clearing saved reports is
an explicit user action and may then open only the recorder's local storage.

When enabled, the browser recorder accepts fixed event names, outcomes, clock
quality, and bounded numeric values. Context is reduced to allowlisted build
metadata, existing startup-option booleans, and a destination category; the
userscript does not expose or infer the installed Android package version. No
account, cookie, URL, video identifier/title, path, raw exception, request
payload, or free-form device field is persisted. Nothing is uploaded
automatically.

A complete `launch` capture starts at userscript bootstrap on the **next**
launch after opt-in. Enabling while the app is already open starts a clearly
labeled `partial` sample; earlier events are not reconstructed. Measurements
include startup/readiness marks, recognized D-pad/OK/Back categories, synchronous
handler duration, a request-animation-frame opportunity, playback `playing`
events, optional video-frame callbacks, and bounded buffering intervals. These
are proxies: there is no claim of input-to-photon latency, a displayed/rendered
frame, or a usable Home time.

The browser clock uses `performance.now()` when it behaves monotonically. A
`Date.now()` fallback is labeled degraded and is invalidated on rollback or an
unexpected jump. Values are relative to one browser sample only; the report
never subtracts Android `elapsedRealtime`, compares separate sessions, or
substitutes zero for missing data. Unsupported and unobserved marks are shown as
such.

Bounds are enforced before persistence: at most **10 sessions including the
active draft**, **200 events per session**, **256 KiB combined** for history and
draft, and **5 minutes per sample**. Draft writes are batched at 750 ms. Disable
closes collection immediately, discards the unfinished sample, and retains
completed reports; failures to save the opt-out or remove a draft are surfaced
rather than described as success. Clear removes only the browser-recorder
history and draft keys. Its confirmation explicitly excludes settings, accounts,
cookies, playback state, app cache, downloads, and native updater reports.
Reports are readable on screen with the D-pad, OK, and Back; there is no invented
clipboard, export, download, native bridge, or network path.

## 2. Native updater diagnostics

`AndroidDiagnostics.kt` and `NativeDiagnosticsCore.kt` implement a separate,
opt-in Android updater recorder in app-private `SharedPreferences`. The default
is off for fresh installs and upgrades. Its report and controls live in Android
Updates; the browser page cannot inspect native state, and native controls cannot
change browser diagnostics. No new permission or telemetry endpoint was added.

The native allowlist records one native bootstrap mark and first-activity-resumed
milestone, updater-page visibility, check/download and APK validation outcomes,
permission-route ownership and return outcomes, and installer handoff/status
categories. Native startup milestones are not reconstructed; the user must enable collection
before the next launch to capture a complete startup sequence. The prior
always-on `YTArkStartup` logcat marks are removed. The recorder never
persists activity class names, URLs, raw system settings, file paths, package
lists, accounts, or raw exception/status text. The report uses Android
`elapsedRealtime` offsets and durations only within a process sample; it makes
no browser-clock or cross-sample comparison and sends nothing automatically.

Native bounds are **6 sessions**, **32 events per session**, **160 total events**,
**16,384 serialized characters**, **24 hours** maximum offset, and **10 minutes**
maximum duration. Disable closes the in-process gate before trying to persist the
opt-out, so collection stops immediately even if saving fails; the UI warns that
the opt-out may not survive restart. Clear removes only the native diagnostic
event key and preserves the enable choice, update preferences, accounts,
cookies, browser reports, and downloaded or staged installer APKs. The native
report is on-screen and scrollable; no clipboard, share intent, APK path, or
other export was introduced.

## 3. Startup readiness and permission-route changes

- Guide refresh now waits for both the command executor and its command
  constructor. Missing dependencies remain pending until a later bounded
  readiness tick; construction or dispatch failure is terminal to avoid
  duplicate side effects. Tests cover late readiness, constructor failure,
  executor failure, and the bounded timeout.
- Startup navigation remains one-shot and waits for its real resolver. Readiness
  deadlines use a monotonic clock when available and a scheduled-tick ceiling as
  a hard bound when that clock is unavailable or invalid. Existing startup
  destination priority, explicit settings, and readiness cadence are preserved.
- Native permission detours now carry explicit `ENTRY` or `INSTALL` ownership,
  request identity, candidate identity, launch/departure/return state, and
  one-shot continuation acceptance. Versioned Activity/SharedPreferences
  snapshots restore the newest route state, so an older Bundle cannot erase a
  newer durable owner. An install can join its existing entry Settings route
  without stacking another screen; a joined route returns via the request code
  belonging to the route owner. A matching ActivityResult can restore genuine
  launch/return evidence if process recreation interrupted the last save.
- A continuation requires observed departure or the matching activity result,
  rechecks the same candidate and Android authorization, and is accepted into
  serialized updater work even while that worker is busy. APK validation still
  happens before installer handoff. If process restoration leaves updater state
  without its Activity-owned route, the stale permission request is cleared and
  the verified APK remains retryable.

These statements describe source behavior and host tests, not an observed TV
failure or a device-confirmed repair. They do not claim a permission grant, an
installation, an upgrade, or successful playback on hardware.

## 4. Exact-source CI prerequisite for publication

`tools/require_source_ci.py` requires a completed successful `ci.yml` run for
the exact full commit SHA on the trusted `2archiver/YTArk` `main` branch. It
rejects pull-request runs, other repositories, other branches, other commits,
other workflows, and failed/cancelled runs; it fails closed on API errors or a
bounded wait timeout. It is wired into both the trusted main publication
workflow and the manual recovery workflow, before candidate build/publication
steps. Workflow-policy and helper tests cover these constraints. The gate is
automatic CI, not a device-test or manual-approval gate.

## 5. Verification performed for this candidate source

- `node --test tests/*.test.mjs` from `TizenTube/mods`: **334 passed, 0 failed,
  0 skipped** across the full userscript suite. This includes diagnostics privacy,
  bounds, off-state behavior and clear/report actions; clock rollback; guide
  executor/constructor readiness; and startup navigation/readiness coverage.
- `npm run build`: passed. `node --check TizenTube/dist/userScript.js` and
  `tools/check_bundle_contract.py` passed against the locally built userscript
  (45 required contract symbols). The ignored `dist` bundle is a local build
  output, not a release asset or signed candidate.
- `python3 -m py_compile tools/*.py tools/tests/*.py`: passed.
- `python3 -m unittest discover -s tools/tests -v`: **245 passed, 0 failed, 1
  skipped**. The skipped test is the Java/Kotlin host runner, because this
  environment has no host JDK.
- Passed `bash -n tools/*.sh`, `tools/repack_apk.py --self-test`, launcher-art
  checks, repository/history secret scan, workflow-policy checks, generated
  build-info/changelog checks, and `tools/apk_manifest.py --self-test`.
- Release metadata emission matched `3.6.0`, display `3.6`, code `3060000`,
  tag `v3.6.0`, script `s37`, and the ARMv7-only asset name. The pinned signing
  certificate checksum, package, enabled ad-filter settings, premium-logo
  setting, base tag, and absence of ARM64 release plumbing were checked.
- Live GitHub release data passed `tools/validate_release.py check-version`:
  3.6.0 exceeds the published 3.5.2 release. Live remote tag refs confirmed
  `v3.6.0` and `s37` are unused. No remote tag or release was created or moved.
- `git diff --check`: passed.

## 6. NOT RUN / NOT CLAIMED

- **NOT RUN:** Java/Kotlin host policy tests in this sandbox (no `java`/`javac`);
  they are included in CI and the Python runner-wiring test was the single
  skipped test above.
- **NOT RUN:** Android SDK API 34 Kotlin compilation, D8, repacking, signing,
  candidate APK manifest/signature/alignment inspection, or a signed candidate
  artifact. The manifest self-test is an in-memory parser test, not a packaged
  APK check.
- **NOT RUN:** any TV/device test: install, in-place upgrade, Settings
  permission departure/return, D-pad report navigation, guide refresh in the
  real Cobalt runtime, playback, buffering, or frame-callback behavior.
- No startup-speed improvement, input-to-photon latency, rendered-frame time,
  usable Home time, permission-switch persistence, or successful installation
  is claimed.
- No release, userscript tag, APK asset, publication, main-branch update, or
  merge occurred.
