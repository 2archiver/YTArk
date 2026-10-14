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

## [2.9.0] — Unreleased

> Not yet published. Planned tag `v2.9.0` · versionCode 2090000 · userscript `s28` · one ARMv7 APK (armeabi-v7a) on TizenTubeCobalt v2.0.2. This is intended as a direct, signed in-place update to published 2.8.0; package ID, signing identity and app data directory stay unchanged.

Repaired ARMv7 release build, safer update installation, and settings and OLED fixes.

### Added
- **Cache & Storage for the TV remote.** Measures Android's app-cache directories off the UI thread and can clear only old files there; recently modified or unstatable files are retained. Downloaded update packages are a separate control with its own measured figure. Profile and local-storage directories outside those cache roots are not scanned, and cookies, account data, preferences, databases, watch position, downloads and installer-held APKs are never touched. Pause playback first.
- **Opt-in playback recovery.** Uses the existing player state and `PlayerService.loadVideo` contract with bounded retries for sustained buffering and recoverable media errors. Supported VOD/DVR positions and live-edge intent are preserved; user pauses, seeking, completion, navigation, hidden or picture-in-picture playback and offline state stop retries, as does player text identifying sign-in, age or region restrictions. Android and the YouTube UI are not reloaded.
- **Persistent stable-release update automation.** Android JobScheduler requests an hourly network-connected check and can download, resume and validate a compatible stable APK in the background. Checks and downloads can each be disabled, and Android may defer scheduled work.
- **Screen-only Updates and Storage URI contracts.** The userscript emits only `ytark://updates` or `ytark://storage`, with an optional `theme=oled` or `theme=youtube`. Exported screen routes require YTArk's app-signature permission and accept only the matching URI; arbitrary actions, packages, components and parameters are rejected. The native Updates screen also has a **Cache & Storage** button, so the storage screen stays reachable from the TV apps row even where the base cannot dispatch the scheme in-page.

### Changed
- **Cache cleanup is scoped to Android cache roots.** Results report measured and deleted bytes rather than a guessed reclaimed amount, and partial or unavailable measurements are labelled instead of being presented as complete.
- **Native screens follow a validated theme value.** Updates and Storage persist only `oled` or `youtube` when a matching route supplies it; YouTube's own theme, playback and app data are unchanged.
- **Release redirects and partial-download resumes are revalidated.** Every redirect hop must stay on the exact HTTPS allowlist, and a resume requires matching URL, digest, size and ABI metadata.
- **Foreground updater checks share persisted cadence and single-flight work.** Explicit automatic-check and automatic-download opt-outs remain respected, and a user-cancelled transfer is not restarted by another scheduler path.
- **Navigation includes startup-animation availability.** This build has no optional YTArk startup animation or removable delay, so the row is informational only: it is not a toggle and it does not promise to remove Android's system splash.

### Defaults and migration
- Userscript settings schema 4 adds `enablePlaybackRecovery`, default **off**; only a missing key receives the default and no existing preference is migrated or reset.
- Native automatic checks and downloads default **on** for the new updater preference; explicit off choices are retained.
- The update stays compatible with the published 2.8.0 package and signing identity; no uninstall, data-directory change or Cobalt engine rebuild is part of it.

### Fixed
- **The 2.9 release build failure is fixed.** The userscript step still required a settings-editor command that the 2.9 work had retired, so the 2.9 and 2.9.1 runs both stopped before repacking, signing or uploading anything. (The retired command's identifier is intentionally not repeated here: the bundled changelog ships inside the userscript, and the bundle contract forbids the retired names anywhere in the artefact.) The required and retired symbols now live in one checked-in contract (`release/bundle-contract.json`) that both workflows read, and a regression test fails when a required symbol disappears, a retired one returns, or a workflow grows a second copy of the list.
- **Installer success is confirmed against installed package metadata.** A success result is polled but never trusted by itself; cancellation keeps the verified APK available for an explicit retry instead of reporting an install that did not happen.
- **Updater failures report the phase that actually failed.** Check, download, APK validation and install failures stay distinct; rejecting the final APK is a validation failure, not a missing installer.
- OLED surface gradients no longer paint over the black background. Coverage is still limited to the enumerated surfaces; full YouTube coverage needs device testing.
- Update-file cleanup requires an explicit confirmation and protects both the pending installer APK and a resumable download, including when they are different files.
- Automatic download selection respects skipped and cancelled releases and keeps a matching partial file for an explicit resume; work interrupted by an app restart is reconciled without counting an installer hand-off as a completed install.
- Playback recovery cancels scheduled attempts on navigation and suspends them during picture-in-picture, and an error arriving after a media load event is not mistaken for healthy playback.
- Search input stays open when OK is pressed; Done on the remote key grid submits the query.
- About reports unavailable frontend versions as unavailable and recognizes the runtime client-version field.
- Removed the redundant YouTube Settings layout editor; saved layouts and their scoped restore entry remain reachable.

### Known limitations
- **Not device-verified.** No signed 2.9 APK, PackageInstaller exercise, in-place upgrade, TV navigation run, OLED viewport matrix or cache operation has been executed on a physical device or TV emulator.
- **The repaired pipeline has not run in CI.** The failing userscript step, the release-identity contract and the release metadata were reproduced and verified locally against this source, but proving a green GitHub Actions run needs the change on the trusted branch, which this candidate does not do by itself.
- **In-page custom-scheme dispatch is not available on the pinned runtime.** The pinned Cobalt v2.0.2 source has no external-protocol handler, content's default returns "handled" without starting anything, and the base's only web-to-native bridge cannot open a screen, so a `ytark://` page navigation is cancelled silently. The launcher proxy (TV apps row → YTArk Updates → Cache & Storage) is the reachable route; device confirmation of that route is still outstanding.
- The release remains ARMv7-only on TizenTubeCobalt v2.0.2. The Google TV system keyboard remains device-unverified; the DPAD key grid stays as the documented fallback.

### Validation
- Candidate test, build and device evidence is recorded in `docs/SETTINGS-2.9-RECOVERY-REVIEW.md`. This entry is unpublished; no release or tag has been created.

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
