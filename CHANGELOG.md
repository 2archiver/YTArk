# Changelog

All notable changes to YTArk are recorded here, newest first.

This file is the single source for the in-app **Changelog / What's new** reader
(generated into `TizenTube/mods/assets/changelog.generated.js` by
`python3 tools/build_changelog.py --write`, checked in CI with `--check`) and for
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

## [2.8.0] — Unreleased

> Not yet published. Planned tag `v2.8.0` · versionCode 2080000 · userscript `s27` · one ARMv7 APK (armeabi-v7a) on TizenTubeCobalt v2.0.2. This is intended as a direct, signed in-place update to published 2.7.0; package ID, signing identity and app data directory stay unchanged.

Safer storage, opt-in playback recovery and hourly updates.

### Added
- **Cache & Storage for the TV remote.** Measures Android's app-cache directories off the UI thread and can clear only old files there; recently modified or unstatable files are retained. The updater's private files are a separate control. The operation does not scan profile or local-storage directories outside those cache roots, or touch cookies, account data, preferences, databases, watch position, downloads or installer-held APKs. Pause playback first.
- **Opt-in playback recovery.** Uses the existing player state and `PlayerService.loadVideo` contract, with bounded retries for sustained buffering and recoverable media errors. Supported VOD/DVR positions and live-edge intent are preserved; user pauses, seeking, completion, navigation, hidden/PiP playback and offline state stop retries. Player text that identifies sign-in/age/region restrictions stops retries; other errors remain bounded to three attempts. Android and YouTube UI are not reloaded.
- **Persistent stable-release update automation.** Android JobScheduler requests an hourly network-connected check and can download/resume and validate a compatible stable APK in the background. Checks and downloads can each be disabled. Download, validation, permission, installer hand-off and installed-version reconciliation remain separate persisted states; only Android's installer can request the user's install confirmation.

### Changed
- **Cache cleanup is scoped to Android cache roots.** Update downloads and pending installer files live separately; obsolete updater files can be cleared only when no download, install request or installer hand-off is active. Results report measured and deleted bytes rather than a guessed reclaimed amount.
- **Navigation includes startup-animation availability.** This build has no optional YTArk startup animation or removable delay, so the row is informational only—not a toggle and not a promise to remove Android's system splash or YouTube UI. Initialization, injection, session restore and migrations remain unchanged.
- **Updater automation is explicit and best-effort.** New defaults enable automatic stable checks and downloads; users can turn either off. JobScheduler may defer work, and Android confirmation remains required before installation.

### Defaults and migration
- Userscript settings schema 4 adds `enablePlaybackRecovery`, default **off**. Existing explicit preferences are preserved; only a missing recovery key receives the default. No account/session data or other stored setting is migrated or reset.
- Native automatic checks and downloads default **on** for this new updater preference. Explicit off choices are retained. The update remains compatible with the published 2.7.0 package and signing identity; no uninstall, data-directory change or Cobalt engine rebuild is part of this update.

### Fixed
- Automatic download selection respects skipped/cancelled releases and preserves matching partial files for an explicit resume. Work interrupted by an app restart is reconciled without treating an installer hand-off as a completed install.
- Playback recovery cancels scheduled attempts on navigation and suspends them during PiP; an error arriving after a media load event is not mistaken for healthy playback.

### Known limitations
- **Not device-verified.** The Android app-cache layout, active playback/file-handle behavior, playback recovery, JobScheduler timing, PackageInstaller hand-off and signed in-place upgrade from 2.7.0 have not been exercised on a physical TV in this worktree. Android may defer hourly jobs.
- The pinned base remains TizenTubeCobalt v2.0.2; the Cobalt engine and YouTube TV frontend are not upgraded here. Only ARMv7 (`armeabi-v7a`) is supported by the published release line.

### Validation
- This 2.8.0 entry is unpublished. Test, build and device-run results for the candidate are recorded separately; no release has been published from this work.

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

- `v2.2.0-probeJ` and `v2.2.0-probeK` are draft releases without assets, created on 2026-10-11 while diagnosing the 2.2 publication pipeline. They were never published and are not versions.
- `s5` to `s13` are userscript tags pushed on 2026-10-09 while the first build pipeline was set up; no published APK used them. Each later `sNN` tag belongs to the release that lists it above.
- The 2.0.3-ytark.15 release notes described automatic update prompts; later releases narrowed that claim until the native updater's device path is verified.

## Upstream base and inherited capabilities

- Android and Cobalt base: TizenTubeCobalt v2.0.2 (synced with Cobalt 27 LTS), changed by YTArk only through repackaging, branding, the userscript address and the native updater.
- Inherited from the TizenTube userscript (GPL-3.0-only): client-side ad blocking, SponsorBlock with segment markers, DeArrow, video queueing, preferred quality, speed and codec, sidebar ordering, startup destination, the clock, inactivity screen dimming, watched-video filtering and player button controls. YTArk maintains and extends them but did not create them.
- The YouTube TV frontend, sign-in, playback and account features come from YouTube's own service.
