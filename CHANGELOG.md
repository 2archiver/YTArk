# Changelog

All notable changes to YTArk are recorded here, newest first.

This file is the single source for the in-app **Changelog / What's new** reader
(generated into `TizenTube/mods/assets/changelog.generated.js` by
`python3 tools/build_changelog.py --write`, alongside the shared native
`ReleaseHighlights.generated.kt` summaries/details; checked in CI with `--check`) and for
the "What changed in this release" section of each GitHub release
(`tools/render_release_notes.sh`).

Conventions:

- Each published version links its GitHub release. Dates and times are the
  GitHub publication time in UTC, taken from the release records.
- Each version opens with one short, user-facing summary line; the in-app
  reader shows it as `<version> — <summary>` (for example
  "2.6 — Added Full Auto Updating").
- "Unreleased" marks changes in this source tree that have not been published.
- Nothing is described as tested on a physical TV unless a device run is
  recorded (see `docs/RUNTIME-CHECKLIST.md`).
- Capabilities inherited from TizenTube and TizenTubeCobalt are listed under
  "Upstream base and inherited capabilities", not as YTArk additions.

## [3.8.0] — Unreleased

> Not yet published. Planned tag `v3.8.0` · versionCode 3080000 · userscript `s39` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Reliable updater errors, one ARMv7 APK, clear upgrades.

### Added
- Updater errors now carry specific categories, messages and reference codes instead of one generic failure.
  - TLS/SSL failures, timeouts, rate limits, metadata problems and incompatible APKs are classified distinctly.
  - The unexpected-error fallback reports the stable reference code `[EUNEXPECTED]` so users can report it.
### Changed
- Releases attach one ARMv7 APK with the full ABI.
  - The legacy `armv7` suffix stays accepted for historical releases during the transition.
  - GitHub-generated source archives are never update candidates.
### Fixed
- Update checks report specific TLS, timeout and rate-limit errors.
  - Wrapped causes, stages and sanitized technical details stay available in the Updates panel.
- Missing checksums produce clear metadata errors, not generic failures.
  - The release response is retried instead of pretending the check succeeded.
### Known limitations
- Upgrading from 3.7 or earlier needs a manual APK install; the installed updater selects only `armv7` filenames.
- Physical-TV update-check, download, permission-return, playback and Shorts/settings checks are NOT RUN.
### Validation
- Kotlin and Node regression tests cover version comparison, error classification, asset selection with mixed historical names and metadata parsing.
- Release/Android checks and physical-device evidence are recorded separately; mocks and static checks are not TV verification.

## [3.7.0] — 2026-10-17

> Published 2026-10-17 02:59 UTC as [YTArk 3.7](https://github.com/2archiver/YTArk/releases/tag/v3.7.0) · tag `v3.7.0` · versionCode 3070000 · userscript `s38` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Explicit Settings access, honest local startup comparisons, and retryable update checks.

### Added
- Startup summary reports the narrow userscript-module-to-controls interval and compares only complete, matched local samples.
- Browser diagnostics retain at most 20 bounded local sessions; advanced event details remain separate from the concise summary.
### Changed
- About removes the inline What's New wall while retaining the full Changelog, Technical details, Credits & licenses, and Project link.
- Faster startup remains opt-in; reports show the actual readiness mode and make no speedup promise.
### Fixed
- Guide-row Settings opens only on explicit OK/click; scrolling past the row no longer opens the panel.
- Open Settings modals keep D-pad, OK, Back, and color shortcuts within the active panel.
- Already-current update checks show installed/latest versions, clear prior errors, and remain retryable.
- Startup routes are fixed and allowlisted, and delayed navigation cancels when the user starts navigating.
### Known limitations
- The browser interval is a UI-bootstrap proxy, not Android app start, full YouTube readiness, playback-ready, or first frame; no Faster startup benefit is claimed.
- Physical-TV Settings access, guide activation, remote focus, normal playback, deliberate Shorts access, permission return, clean install, and in-place upgrade checks are NOT RUN.
- Startup comparisons need at least three complete matched launches in each actual mode; five alternating pairs are recommended, without promising a benefit.
### Validation
- Node regression tests cover modal ownership, targeted guide activation, startup cancellation/readiness, diagnostics bounds/comparisons, About, and CSS scope.
- Release/Android checks and physical-device evidence are recorded separately; mocks and static checks are not TV verification.

## [3.6.0] — 2026-10-16

> Published 2026-10-16 14:57 UTC as [YTArk 3.6](https://github.com/2archiver/YTArk/releases/tag/v3.6.0) · tag `v3.6.0` · versionCode 3060000 · userscript `s37` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Opt-in local diagnostics, safer startup, and reliable permission returns.

### Added
- Browser diagnostics are off by default; allowlisted startup, input, playback and buffering proxies stay in bounded local storage.
- Native diagnostics have separate opt-in, report and clear controls in Updates; startup marks leave always-on logcat.
- Reports are readable with the D-pad, OK and Back and explain sample scope, clock quality and unavailable measurements.
### Changed
- Disable stops collection immediately; Clear removes only that recorder's data and leaves settings, accounts, cookies, caches and installer APKs untouched.
- Browser and Android reports remain separate, use app-private/local storage, and are never uploaded automatically.
- Timing reports label media, frame callbacks and render opportunities as proxies, not input-to-photon or display latency.
### Fixed
- Guide refresh waits for both the executor and command constructor before dispatching once.
- Permission detours have explicit entry/install ownership and require a genuine return before continuation.
- Permission continuation is accepted against the same validated candidate even while serialized updater work is busy.
### Known limitations
- A complete browser launch capture begins on the next launch; enabling diagnostics now starts a labeled partial sample. Native startup milestones are not reconstructed; enable before the next launch to capture them.
- Browser storage is capped at 10 sessions, 200 events per session, 256 KiB combined and five minutes per sample; native storage is separately bounded.
- Device permission-return, D-pad and playback checks remain unverified; no speed, rendered-frame or cross-clock comparison is claimed.
### Validation
- Host tests cover default-off behavior, privacy allowlists, bounded storage, clock rollback, guide readiness and permission ownership/continuation.
- Android SDK compilation, signed candidate APK evidence and device checks are reported separately; host tests are not device validation.

## [3.5.2] — 2026-10-16

> Published 2026-10-16 09:07 UTC as [YTArk 3.5.2](https://github.com/2archiver/YTArk/releases/tag/v3.5.2) · tag `v3.5.2` · versionCode 3050200 · userscript `s36` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Reliable permission routes, safer startup navigation, and startup measurement.

### Fixed
- Startup navigation is no longer silently lost when the TV command resolver is not ready yet. It waits, then runs once.
- Updates never stacks two Android settings screens. The entry and install routes take turns; neither double-launches Settings.
- A pending install waits for a genuine return from the system screen. A visible repaint or state update is not a return.
- Android's install-authorization screens are launched and caught: an intent-visibility precheck no longer blocks a route that actually opens.
- Android 7 (API 24–25) reports the legacy global unknown-sources setting; the Android 8+ per-app packaging prerequisites no longer classify or disable the legacy flow.
- Remote focus moves to an enabled, visible action when the Allow installs button disappears after a grant.
- Download progress no longer repeats an accessibility announcement on every tick.
- The guide refresh runs when the command resolver exists instead of being silently lost at DOM-ready.
### Added
- Lightweight monotonic startup marks (script start, DOM, controls, resolver, navigation, first remote key, first playback) so startup can be measured, not guessed.
- One-shot native launch marks in logcat (tag `YTArkStartup`) on Android's monotonic clock; native and script timelines are read side by side, never subtracted without calibration.
### Changed
- Faster startup (Experimental) stays opt-in with the same polling cadence; when its bounded window expires without readiness, that is now reported instead of ending silently.
### Known limitations
- TV permission persistence, in-place upgrades and startup timing still need device testing; 3.5.1 has no TV test result either. See the dated 3.5.2 evidence report.
- The startup marks enable a measured comparison; no startup speed improvement is claimed for 3.5.2 itself.
- Userscript `s36` is the published immutable script tag.
### Validation
- JavaScript: `node --test` over the TizenTube mods suite, including the startup-navigation, startup-timing and readiness give-up tests.
- Java and Kotlin updater policy suite: API-aware capability classification, launch-outcome classification and departure-aware pending-install transitions.
- ARMv7 APK build, signature, alignment and manifest checks ran in the candidate workflow; they are not device tests.

## [3.5.1] — 2026-10-16

> Published 2026-10-16 05:38 UTC as [YTArk 3.5.1](https://github.com/2archiver/YTArk/releases/tag/v3.5.1) · tag `v3.5.1` · versionCode 3050100 · userscript `s35` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Honest install-authorization reporting, and an experimental faster startup.

### Fixed
- Updates explains why Android cannot keep the install authorization.
- Updates stops offering TV Settings when the installed build or the TV profile cannot hold the authorization.
### Changed
- Experimental faster startup shortens the optional readiness polling delay, with one timer and one fallback.
- Updates keeps authorization, download and installation apart; an installer opening is never reported as an installed update.
### Added
- The release build refuses a candidate Android could never authorize.
- Updates reports what Android answers for this build: the declared install permission, the target SDK, the system install app-op the TV Settings switch writes, and any profile restriction.
### Known limitations
- Permission screens, faster startup, session-preserving upgrades and the ARMv7 runtime still need device testing; see the 3.5.1 evidence report.
- A first in-place upgrade from a build Android will not authorize needs an already permitted installer; the updater cannot bootstrap its own authorization.
- Userscript `s35` is the candidate script tag and becomes live only through the release publication workflow.
### Validation
- Java and Kotlin updater policy suite for the permission, download and install transitions.
- Compiled-manifest tests over real aapt-produced manifests plus the aapt cross-check in the release pipeline.
- ARMv7 APK build, signature, alignment and manifest checks: see the candidate evidence; they are not device tests.

## [3.5.0] — 2026-10-15

> Published 2026-10-15 15:04 UTC as [YTArk 3.5](https://github.com/2archiver/YTArk/releases/tag/v3.5.0) · tag `v3.5.0` · versionCode 3050000 · userscript `s34` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Privacy-corrected DeArrow lookups, applied before the page renders.

### Changed
- DeArrow title lookups use the hash-prefix endpoint; the full video ID is no longer sent.
- DeArrow uses the first trusted, non-original title and thumbnail, never a runner-up.
- DeArrow applies before browse, search and next results render; lookups are cached.
- High-quality thumbnails keep a DeArrow thumbnail chosen for the same tile.
- Thumbnail replacement sends the video ID to dearrow-thumb.ajay.app (see PRIVACY.md).
### Fixed
- Turning DeArrow off stops new lookups and discards results still in flight.
### Known limitations
- DeArrow changes have unit coverage only; the visible replacement on a TV is not yet device-verified.
- Thumbnail replacement sends the video ID to `dearrow-thumb.ajay.app`; title lookups do not.
- The in-app updater's install path and the ARMv7 runtime still need device testing; see the 3.5 evidence report.
- Userscript `s34` becomes live only through the existing release publication workflow.
### Validation
- JavaScript: `node --test` over the TizenTube mods suite, including the DeArrow boundary tests.
- Java and Kotlin updater policy suite with the sandbox JDK substitute (CI uses JDK 17).
- ARMv7 APK build, signature, alignment and manifest checks: NOT RUN in this environment.

## [3.4.0] — 2026-10-15

> Published 2026-10-15 08:34 UTC as [YTArk 3.4](https://github.com/2archiver/YTArk/releases/tag/v3.4.0) · tag `v3.4.0` · versionCode 3040000 · userscript `s33` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Cleaner About and settings, permission-ready Updates, and clearer release checks.

### Added
- Updates asks for install authorization on entry; denial leaves a manual action and never blocks checks.
### Changed
- About and settings are cleaner; the row reads “YouTube Premium” and faster startup stays opt-in.
### Fixed
- Release checks distinguish offline, timeout, HTTP, metadata and runtime failures with sanitized diagnostics.
### Validation
- Conditional responses, malformed metadata, empty-cache first runs and incompatible assets have explicit fixture coverage.
- API 24–25, denied-return, fresh-entry, duplicate-prompt and permission-revocation decisions have policy coverage.
### Known limitations
- TV permission screens, startup speed, session-preserving upgrades and ARMv7 runtime still need device testing.
- A download does not continue across process death; a partial resumes only when its stored ETag still matches.
- Userscript `s33` is the published script tag.

## [3.3.0] — 2026-10-15

> Published 2026-10-15 07:03 UTC as [YTArk 3.3](https://github.com/2archiver/YTArk/releases/tag/v3.3.0) · tag `v3.3.0` · versionCode 3030000 · userscript `s32` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Recovers from GitHub rate limits, incomplete downloads and installer errors.

### Changed
- Updates keeps the dark page and adds on-demand technical details.
### Fixed
- GitHub rate limits show a retry time and the saved release age.
- Incomplete downloads stay partial, then verify before install.
- Installer cancel, block, storage and signature errors stay distinct.
- Error details are scrubbed of URLs and credentials; timeouts and offline failures now give distinct guidance.
- A rate limit is detected from real evidence only, and a server retry deadline is never shortened.
### Known limitations
- Physical TV install, permission screens and upgrades still need device verification.
- A download does not continue across process death. A leftover partial can resume only when the stored ETag still matches.

## [3.2.0] — 2026-10-14

> Published 2026-10-14 17:34 UTC as [YTArk 3.2](https://github.com/2archiver/YTArk/releases/tag/v3.2.0) · tag `v3.2.0` · versionCode 3020000 · userscript `s31` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

YouTube-style Updates, restored About changelog and compact release highlights.

### Changed
- Matched Updates to the YouTube dark theme with compact controls and clear remote focus.
### Fixed
- Restored Changelog / Version history in About YTArk.
- Kept current-version highlights short, with release details behind an explicit action.
### Known limitations
- Physical TV focus, Android installation and session-preserving upgrades still need device verification.
- The s31 userscript endpoint becomes live only through the existing release publication workflow.

## [3.1.0] — 2026-10-14

> Published 2026-10-14 11:46 UTC as [YTArk 3.1](https://github.com/2archiver/YTArk/releases/tag/v3.1.0) · tag `v3.1.0` · versionCode 3010000 · userscript `s30` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Kotlin updater, direct Updates entry and opt-in faster mod readiness.

### Added
- Kotlin updater with one persisted state, hourly or three-hourly automatic check/download, and Never.
- Faster startup (Experimental) reduces optional mod-readiness polling delay, with a bounded normal fallback; Off by default.
### Fixed
- Settings opens the private Updates activity through a constrained host bridge instead of unsupported external navigation.
- Verified download retention, install-permission continuation and installed-version reconciliation.
### Removed
- The updater-specific launcher icon and intermediate Updates menu. Other settings, Google sessions and playback are not reset.
### Known limitations
- Real Android permission/installer UI, in-place upgrade and ARMv7 TV runtime checks remain unverified. Startup speed benefit is unverified; no percentage gain is claimed.
- The candidate userscript revision is published only with an authorized release; the unchanged Cobalt engine still loads its userscript from the release CDN.

## [3.0.0] — 2026-10-14

> Published 2026-10-14 10:17 UTC as [YTArk 3.0](https://github.com/2archiver/YTArk/releases/tag/v3.0.0) · tag `v3.0.0` · versionCode 3000000 · userscript `s29`

Removed settings search, Cache & Storage and OLED Black; repaired the 3.0 Android build.

## [2.9.0] — 2026-10-14

> Published 2026-10-14 06:35 UTC as [YTArk 2.9](https://github.com/2archiver/YTArk/releases/tag/v2.9.0) · tag `v2.9.0` · versionCode 2090000 · userscript `s28` · one ARMv7 APK (armeabi-v7a) on TizenTubeCobalt v2.0.2. A direct, signed in-place update to published 2.8.0; package ID, signing identity and app data directory stay unchanged.

Repaired ARMv7 release build, safer update installation, and settings and OLED fixes.

## [2.8.0] — 2026-10-13

> Published 2026-10-13 11:13 UTC as [YTArk 2.8](https://github.com/2archiver/YTArk/releases/tag/v2.8.0) · tag `v2.8.0` · versionCode 2080000 · userscript `s27` · one ARMv7 APK

Safer storage, opt-in playback recovery and hourly updates.

## [2.7.0] — 2026-10-13

> Published 2026-10-13 08:10 UTC as [YTArk 2.7](https://github.com/2archiver/YTArk/releases/tag/v2.7.0) · tag `v2.7.0` · versionCode 2070000 · userscript `s26` · one ARMv7 APK

TV keyboard search, a readable About dialog and a simpler changelog.

## [2.6.0] — 2026-10-13

> Published 2026-10-13 05:33 UTC as [YTArk 2.6](https://github.com/2archiver/YTArk/releases/tag/v2.6.0) · tag `v2.6.0` · versionCode 2060000 · userscript `s25` · one ARMv7 APK

Added Full Auto Updating.

## [2.5.0] — 2026-10-11

> Published 2026-10-11 23:41 UTC as [YTArk 2.5](https://github.com/2archiver/YTArk/releases/tag/v2.5.0) · tag `v2.5.0` · versionCode 2050000 · userscript `s24` · ARMv7 APK

Settings cleanup and UX repair on the same base as 2.4.

## [2.4.0] — 2026-10-11

> Published 2026-10-11 20:38 UTC as [YTArk 2.4](https://github.com/2archiver/YTArk/releases/tag/v2.4.0) · tag `v2.4.0` · versionCode 2040000 · userscript `s23` · one ARMv7 APK

A safer updater and a tidier settings home on the same base as 2.3.

## [2.3.0] — 2026-10-11

> Published 2026-10-11 13:46 UTC as [YTArk 2.3](https://github.com/2archiver/YTArk/releases/tag/v2.3.0) · tag `v2.3.0` · versionCode 2030000 · userscript `s22` · one ARMv7 APK

OLED Black, cleaner playback and searchable settings.

## [2.2.0] — 2026-10-11

> Published 2026-10-11 11:01 UTC as [YTArk 2.2](https://github.com/2archiver/YTArk/releases/tag/v2.2.0) · tag `v2.2.0` · versionCode 2020000 · userscript `s21` · one ARMv7 APK

Maintenance and UX release on the same TizenTubeCobalt v2.0.2 ARMv7 base.

## [2.1.2] — 2026-10-11

> Published 2026-10-11 05:34 UTC as [YTArk 2.1.2](https://github.com/2archiver/YTArk/releases/tag/v2.1.2) · tag `v2.1.2` · versionCode 2010200 · userscript `s20` · one ARMv7 APK

Real Premium vector artwork and ARMv7-only releases.

## [2.1.1] — 2026-10-11

> Published 2026-10-11 04:22 UTC as [YTArk 2.1.1](https://github.com/2archiver/YTArk/releases/tag/v2.1.1) · tag `v2.1.1` · versionCode 2010100 · userscript `s19` · ARMv7 and ARM64 APKs

Premium wordmark fix and honest updater failures.

## [2.1.0] — 2026-10-10

> Published 2026-10-10 06:03 UTC as [YTArk 2.1](https://github.com/2archiver/YTArk/releases/tag/v2.1.0) · tag `v2.1.0` · versionCode 2010000 · userscript `s18` · ARMv7 and ARM64 APKs

YTArk naming, clean SemVer, launcher artwork and a D-pad updater.

## [2.0.4-ytark.17] — 2026-10-09

> Published 2026-10-09 19:40 UTC as [YTArk](https://github.com/2archiver/YTArk/releases/tag/v2.0.4-ytark.17) · tag `v2.0.4-ytark.17` · versionCode 20017 · userscript `s17` · ARMv7 and ARM64 APKs

Launcher branding, privacy hardening and safer release workflows.

## [2.0.4-ytark.16] — 2026-10-09

> Published 2026-10-09 17:57 UTC as [YTArk](https://github.com/2archiver/YTArk/releases/tag/v2.0.4-ytark.16) · tag `v2.0.4-ytark.16` · versionCode 20016 · userscript `s16` · ARMv7 and ARM64 APKs

Matching ARMv7 and ARM64 APKs, plus more client-side controls.

## [2.0.3-ytark.15] — 2026-10-09

> Published 2026-10-09 11:19 UTC as [YTArk](https://github.com/2archiver/YTArk/releases/tag/v2.0.3-ytark.15) · tag `v2.0.3-ytark.15` · versionCode 20015 · userscript `s15` · one ARM64 APK

First release under the YTArk name.

## [2.0.2-personal.14] — 2026-10-09

> Published 2026-10-09 08:41 UTC as the [pre-YTArk build](https://github.com/2archiver/YTArk/releases/tag/v2.0.2-personal.14) (package `io.github.personal.tubetv`, assets named personal-tubetv) · tag `v2.0.2-personal.14` · versionCode 20014 · userscript `s14` · ARMv7 and ARM64 APKs

The repository's first published build, before the YTArk name.

## Unpublished drafts and other tags

- `2.9.0` / `v2.9.0` / versionCode `2090000` / userscript `s28` was an unpublished draft in the source tree, never a published Android release. Its two publication attempts (the 2.9 settings work and the separate 2.9.1 updater work, whose draft metadata used versionCode `2090100` and userscript `s29`) both failed in the userscript build step before repacking, so neither produced an APK, an Actions artefact, a tag or a release. Both lines were folded back into the single `2.9` release recorded above, which reuses the still-unused `2090000` code and the still-unused `s28` revision; no published tag, asset or APK was moved, relabeled or overwritten.
- `v2.2.0-probeJ` and `v2.2.0-probeK` are draft releases without assets, created on 2026-10-11 while diagnosing the 2.2 publication pipeline. They were never published and are not versions.
- `s5` to `s13` are userscript tags pushed on 2026-10-09 while the first build pipeline was set up; no published APK used them. Each later `sNN` tag belongs to the release that lists it above.
- The 2.0.3-ytark.15 release notes described automatic update prompts; later releases narrowed that claim until the native updater's device path is verified.

## Upstream base and inherited capabilities

- Android and Cobalt base: TizenTubeCobalt v2.0.2 (synced with Cobalt 27 LTS), changed by YTArk only through repackaging, branding, the userscript address and the native updater.
- Inherited from the TizenTube userscript (GPL-3.0-only): client-side ad blocking, SponsorBlock with segment markers, DeArrow, video queueing, preferred quality, speed and codec, sidebar ordering, startup destination, the clock, inactivity screen dimming, watched-video filtering and player button controls. YTArk maintains and extends them but did not create them.
- The YouTube TV frontend, sign-in, playback and account features come from YouTube's own service.
