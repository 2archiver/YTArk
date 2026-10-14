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

## [3.0.0] — Unreleased

> Not yet published. Planned tag `v3.0.0` · versionCode 3000000 · userscript `s29` · one ARMv7 APK (armeabi-v7a) on TizenTubeCobalt v2.0.2. A direct, signed in-place update to published 2.9.0; package ID, signing identity and app data directory stay unchanged.

One real in-app YTArk Updates page, and three features that could not work are removed.

### Added
- **In-app YTArk Updates page.** The settings entry named YTArk Updates opens the real update page
  directly, and it is now the only update UI. On that page: `Check for updates` runs a real
  stable-release lookup against the official release API; `Automatic check` offers Every 1 hour,
  Every 3 hours or Never (default Every 1 hour, remembered per device); `Download update` and
  `Install update` start and re-run the verified ARMv7 APK handoff to Android's own installer;
  and the installed version, the latest compatible release, the last successful check time, and
  What's New / version history all live on the same page.
- **Faster startup (Experimental)** in Settings → Navigation, default Off. When on, YTArk defers
  non-critical userscript work (settings translations, update checking, the What's New evaluation,
  the on-screen clock, QR encoding, changelog parsing) until after the first YouTube screen has
  rendered, with a bounded fallback to normal startup if the accelerated path fails, and a guard
  against double initialisation. It never delays ad blocking, theming, login or session
  restoration, or networking readiness. Measured speedups vary by device.
### Changed
- **One scheduler for update checks.** The in-app interval is the only automatic checker. It runs
  on foreground opportunities — app resume, opening YTArk Updates, and a bounded ticker while the
  app is in the foreground — and performs a network check only when the interval has elapsed, so
  a sleeping TV or a connectivity delay postpones work instead of producing exact hourly
  requests. The second, user-invisible background job from 2.9 is removed.
- **Honest download handoff.** `Download update` asks the engine to download the verified
  official ARMv7 APK in the background; when the download completes, Android's own installer
  opens, and granting install permission there (exactly once) is required for the upgrade.
  `Install update` re-runs the same handoff. The pinned engine re-downloads on each attempt, so
  3.0 does not claim resume or same-APK continue; the in-app native verifier still validates the
  downloaded bytes (checksum, package, version, ABI, signing certificate) and removes corrupt
  files, and Android enforces signature and version checks at install time.
- **Install completion is confirmed from the installed package.** When the app returns after the
  installer, the page re-reads the installed version from the Android package and reports the
  update as installed only when the new version is actually present; data, cookies and sign-in
  are preserved by the in-place upgrade.
- **About YTArk** distinguishes the installed YTArk version (Android package), the embedded
  engine build details (base tag and build), and the YouTube frontend version, reporting
  `Unknown` wherever a value cannot be verified.
### Defaults and migration
- The 3.0 upgrade retires the settings-search state and the OLED theme preference from the
  stored configuration without resetting anything else; app data, cookies and login are never
  touched. A device upgrading with the OLED theme enabled returns to the normal YouTube/YTArk
  theming with its custom colours intact. The old Skip Startup Animation row is replaced by
  Faster startup, initialised to Off.
### Fixed
- The settings entry named YTArk Updates now opens a working update page instead of the 2.9
  status card that pointed at a separate apps-row app, because the pinned engine never
  dispatched the in-page route.
- The About dialog no longer relies on a synchronous version read: the installed version comes
  from the Android package, the build details from this build's own metadata, and the YouTube
  frontend version is shown only when the frontend really publishes it.
### Removed
- **Settings search.** It could never open a usable keyboard on this engine, so it is removed
  entirely: the search field, the on-screen key-grid keyboard, and every settings-search
  command. YouTube's own content search is untouched.
- **Cache & Storage management.** The native storage screen and all of its rows (cache size,
  engine database, downloaded APK, data wipe) are removed; the pinned engine's internals are not
  exposed.
- **OLED Black.** The forced true-black theme, its Appearance choice, its native theme
  persistence and the `theme=` route query are removed.
- **Skip Startup Animation.** This build ships no optional YTArk startup animation, so the
  informational row is replaced by the real, experimental Faster startup toggle.
- **The separate `YTArk Updates` apps-row app.** Its launcher icon, its native screen, its
  JobScheduler auto-check and the in-page `ytark://` deep links are gone; the pinned Cobalt base
  does not dispatch in-page native routes, and 3.0 presents one coherent in-app experience
  instead of a second app entry.
### Known limitations
- The engine's APK download has no progress report on the pinned base, so the page shows an
  honest "downloading — Android will open the installer when it finishes" state instead of a
  fake progress bar.
- The page cannot byte-verify the APK before the engine hands it to the installer; verification
  covers the published release metadata (identity, checksum, package, version, ABI, signing
  certificate) and the downloaded bytes (native verifier), plus Android's own install-time
  checks.
- If the app is restarted while a download is in flight, the page offers the download again
  instead of guessing at an opaque engine state.
### Validation
- CI covers the update state machine, the interval scheduler, the configuration migration, the
  bundle contract, the repackaged manifest, and the version and release contract with Node,
  Python and host-JRE suites.
- This release must be confirmed on a real ARMv7 Android TV before it is treated as fully
  shipped: update check, the automatic interval, download, installer consent, and the install
  itself.

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
