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

## [2.7.0] — Unreleased

> Not yet published. Planned tag `v2.7.0` · versionCode 2070000 · userscript `s26` · one ARMv7 APK (armeabi-v7a) on TizenTubeCobalt v2.0.2. The publication date is recorded on the GitHub release when the release workflow publishes this build.

TV keyboard search, a readable About dialog and a simpler changelog.

### Added
- **TV keyboard for Search settings.** The search field is a real editable input: it takes focus when the panel opens, keeps it while the frontend's own focus handling runs, and asks the platform for its keyboard through the standard VirtualKeyboard API where the engine implements it. Where no input method is offered, the D-pad on-screen key grid types instead and the panel says so. Back closes the keyboard or the panel and returns focus to where search was opened from.

### Changed
- **About YTArk rebuilt** with one version line in the header, a navigable **Build details** row (versionName · versionCode · userscript · Android base), a **Third-party notices and licences** subsection and a **Version history** row that opens the changelog in YTArk Updates. The full licence text is not displayed in the primary dialog, and the attribution stays reachable.
- **What's new is no longer a top-level YTArk Settings row** (nor a row on the YouTube Settings page's YTArk section). The version history lives only in YTArk Updates, and the post-update notice points there.
- **OLED Black is labelled for what it themes**: the app backdrop, the browse, search and settings surfaces and YTArk dialogs. YouTube-owned pages, artwork, thumbnails, video and captions keep their own colours, which the setting text now states.
- **The changelog leads with one user-facing line per version**, newest first, with the detailed notes kept for the current release and the linked release page.

### Fixed
- Search settings could lose the caret to the frontend's own focus handling right after the panel opened; the panel now re-asserts focus while it is still the intended target and never fights the user's move onto the on-screen keys.
- The About panel repeated the version in several rows and carried legal sentences between them; the version now appears once, and the closing sentence is the only legal line.

### Defaults and migration
- Settings schema 3 is unchanged. No preference, sign-in or app data is reset by this release, and the updater path added in 2.6 is untouched.

### Known limitations
- **Not device-verified.** Whether a given Android TV device shows its soft keyboard for a focused field, the About layout at 720p, 1080p and 4K with display scaling, and the OLED look on a physical panel are NOT RUN until recorded in `docs/RUNTIME-CHECKLIST.md`.
- YTArk cannot call a native "show keyboard" bridge: the pinned Cobalt base exposes none, so devices without a platform IME fall back to the on-screen key grid, which is always available.

### Validation
- Automated: the userscript unit and integration tests (Node), the Python release, repacker and changelog tests, and the native updater Java contract tests run in CI; the bundled changelog and build metadata are regenerated and checked.

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
