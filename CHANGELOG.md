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

## [4.4.3] — 2026-11-03

> Published 2026-11-03 12:49 UTC as [YTArk 4.4.3](https://github.com/2archiver/YTArk/releases/tag/v4.4.3) · tag `v4.4.3` · versionCode 4040300 · userscript `s48` · TizenTubeCobalt v2.0.3.

Clearer glass, lighter playback appearance, and glassy player UI.

### Fixed
- **Glass stays inside the menu.** Theme the bounded side panel rather than its fullscreen renderer. Headers blend into their panel instead of displaying a separate black rectangle.
- **OLED clears native gradients.** The inline fallback now clears background images as well as setting black, addressing leftover sidebar shading. Native focus highlights stay unchanged.
- **Playback avoids live blur.** Full-height panels and the sidebar use a static clear tint. Small browsing surfaces may use a four-pixel blur; playback disables it everywhere.

### Changed
- Glass uses a clearer tint and subtle edge highlight. This is an Apple-inspired approximation, not Apple's proprietary rendering.
- Focus class changes no longer trigger theme work; route checks repaint only when entering or leaving playback mode. Stream selection, quality notifications, codecs and buffering remain unchanged.

### Known limitations
- Browser regression checks cover the reported layout and repaint triggers. Physical Google TV responsiveness, the remaining left-edge shading and final glass appearance remain UNVERIFIED until device confirmation; no measured device speedup is claimed.

## [4.4.2] — 2026-11-03

> Published 2026-11-03 11:47 UTC as [YTArk 4.4.2](https://github.com/2archiver/YTArk/releases/tag/v4.4.2) · tag `v4.4.2` · versionCode 4040200 · userscript `s47` · TizenTubeCobalt v2.0.3.

Visible TV themes and leaner playback menus.

### Fixed
- **Themes follow current TV components.** OLED Black and Liquid Glass use semantic component tags and a reversible inline fallback instead of depending on old CSS class names. Ancestor focus containers are never given a white button fill.
- **Glass reaches the sidebar and search bar.** Menus and native toasts share the treatment; video, artwork, captions and fullscreen stages remain excluded. Theme state survives component replacement and cloned navigation surfaces, then restores on opt-out.
- **Playback menus avoid repeated work.** Constructor analysis runs once, cached playback popups cannot accumulate duplicate YTArk actions, and menu DOM changes no longer trigger quality-handler reconciliation.
### Added
- Appearance status reports the observed main background, matching TV surfaces and blur/fallback support.
### Changed
- Native setting writes normalize known values so string booleans cannot silently leave enabled options inactive.
- The existing stream selection, codecs, buffering and working quality notification behaviour are retained.
### Known limitations
- Public guest TV frontend and real-browser checks pass; exact physical Google TV coverage, blur performance and menu timing remain UNVERIFIED until a device run. No measured TV speedup is claimed.

## [4.4.1] — 2026-11-03

> Published 2026-11-03 10:57 UTC as [YTArk 4.4.1](https://github.com/2archiver/YTArk/releases/tag/v4.4.1) · tag `v4.4.1` · versionCode 4040100 · userscript `s46` · TizenTubeCobalt v2.0.3.

Browser-safe caption fallback.

### Fixed
- **Caption fallback handles delayed tracks.** Caption fallback retries now call Window timers through wrappers; delayed audio/caption data no longer fails with an illegal invocation in a browser.
### Changed
- **Browser tests exercise native timers.** Real-browser regression checks cover delayed track availability with native timers, in addition to the default/OLED/glass/combined appearance matrix.
- **All 4.4 features remain included.** Includes all 4.4 features: caption fallback, quality notifications, new OLED Black and Liquid Glass settings, Faster startup and improved local diagnostics.
### Known limitations
- Physical Google TV caption API compatibility, theme coverage, blur performance and startup speed remain UNVERIFIED.

## [4.4.0] — 2026-11-03

> Published 2026-11-03 10:48 UTC as [YTArk 4.4](https://github.com/2archiver/YTArk/releases/tag/v4.4.0) · tag `v4.4.0` · versionCode 4040000 · userscript `s45` · TizenTubeCobalt v2.0.3.

Caption fallback, quality notifications, OLED Black and Liquid Glass.

### Added
- **Caption fallback** optionally enables available captions when the preferred audio language is absent. Choose audio and caption languages in Playback → Subtitles; explicit caption/audio commands take priority for the current video.
- **Quality notifications** use YouTube TV's own toast renderer and decoded video dimensions. Changes are coalesced with an eight-second notification cooldown; requests for a higher quality are never announced as successful playback.
- **OLED Black** is a new, default-off implementation for solid browsing, guide and menu surfaces; the retired theme setting is not reused.
- **Liquid Glass** adds optional glass-inspired menus and notifications, with a tinted fallback and reduced-transparency support. It combines with OLED Black without filtering video or artwork.
### Changed
- **Faster startup** loses the Experimental label. Its first readiness pass now excludes optional guide work and defers that work by 150 ms, allowing the control hand-off to run first.
- **Startup recorder** separates control mounting from interactive readiness, records readiness wake-ups and resolver probes, and shows normal/Faster median and p95 after at least three matched launches per mode on the same build and startup destination.
### Fixed
- Quality preferences attach after a late document body and clean up notification/caption timers when the player is replaced.
- Native toast thumbnails now initialize their image object correctly.
- The 4.3 publication record and stale OLED documentation are corrected.
### Defaults and migration
- Keep saved preferences and the existing package/signing identity. New OLED Black, Liquid Glass and caption fallback options default off; quality notifications default on and can be disabled in Playback.
- Diagnostics remain opt-in and local; older samples stay readable and cannot be mixed across builds for comparisons.
### Known limitations
- Caption/audio track access depends on the active YouTube TV frontend; unknown track data never triggers fallback. Missing captions are not generated or translated.
- Physical Google TV playback, caption commands, theme coverage, blur performance and startup speed remain UNVERIFIED. Host tests do not establish a device speedup.
- Liquid Glass is a TV adaptation, not Apple's native UI framework. Unsupported blur uses a tinted surface.

## [4.3.0] — 2026-10-22

> Published 2026-10-22 09:44 UTC as [YTArk 4.3](https://github.com/2archiver/YTArk/releases/tag/v4.3.0) · tag `v4.3.0` · versionCode 4030000 · userscript `s44` · TizenTubeCobalt v2.0.3.

Independent sidebar controls and clean TV banner lettering.

### Fixed
- **Search and Shorts hide independently.** Shared endpoint identities keep unknown entries visible and preserve navigation commands.
- **Repeated guide loads restore hidden entries without duplicates.** Channel shortcuts and YTArk Settings remain reachable.
- DeArrow thumbnail substitution retains existing card geometry instead of fabricating 2:1 dimensions; poster and Shorts artwork stays unchanged.
### Changed
- **The TV banner gains clean typeset lettering.** Bundled, licensed Barlow Condensed Bold preserves the original logo.
- Migration clears only the ambiguous legacy hidden Search choice once; reselect Search or Shorts in Navigation settings.
### Known limitations
- Physical TV guide endpoints, focus, Search keyboard/results, long-press artwork and in-place installation remain UNVERIFIED.
- Search card styling is unchanged. The DeArrow metadata fix and the reported appearance still need physical TV verification. Official YouTube APK integration is not demonstrated; Cobalt v2.0.3 remains the base.

## [4.2.0] — 2026-10-21

> Published 2026-10-21 22:35 UTC as [YTArk 4.2](https://github.com/2archiver/YTArk/releases/tag/v4.2.0) · tag `v4.2.0` · versionCode 4020000 · userscript `s43` · TizenTubeCobalt v2.0.3.

Original artwork, Google TV icons and Cobalt 2.0.3.

### Changed
- **Original image replaces the launcher approximation.** The supplied image keeps its shading, orbit and transparency.
- **Google TV menu icons gain safe padding.** The TV banner pairs the image with readable YTArk lettering.
- **Published 4.1 history is corrected.** Both in-app readers share the corrected record.
### Fixed
- Adapt the native updater hand-off to Cobalt 27's shared bridge class, with an exact audited-method check that rejects unexpected upstream bytecode changes.
- Explicitly assign the round icon even when the upstream manifest omits it, keeping launcher and app-info branding consistent.
- Upstream APK verification rejects a requested tag that differs from the configured engine version, in addition to checking the pinned size, SHA-256 and ABI.
### Notes
- Upstream base and inherited capabilities: updated to [TizenTubeCobalt v2.0.3](https://github.com/reisxd/TizenTubeCobalt/releases/tag/v2.0.3): Cobalt 27 LTS Stable, a JSDelivr connection-error message and connection-menu translations.
### Known limitations
- Physical Google TV long-press presentation, playback and in-place installation remain UNVERIFIED; launcher caching and masks vary by firmware.

## [4.1.0] — 2026-10-21

> Published 2026-10-21 08:45 UTC as [YTArk 4.1](https://github.com/2archiver/YTArk/releases/tag/v4.1.0) · tag `v4.1.0` · versionCode 4010000 · userscript `s42` · TizenTubeCobalt v2.0.2.

Retryable updater storage, staged startup and correct 4.1 publication.

### Fixed
- **Healthy updater storage remains usable.** Preparation uses a plain create/write/close probe without fsync; failed probe cleanup no longer reports healthy storage as unavailable.
  - Storage errors identify the failing operation, unknown capacity does not block a healthy download, and cancellation preserves a validated resumable partial.
- Startup timings survive longer sessions.
- Release publishing now targets 4.1.
  - Publication rejects a reused version when packaged source or build inputs changed since the recorded release commit; an unchanged-source recovery remains available.
### Changed
- Startup controls, command resolution and navigation initialize once in dependency order, with bounded shared discovery and slower polling on a slow launch.
- A cold start already on Home skips the redundant Home reload; an explicit destination still wins.
- Faster startup (Experimental) defers optional guide work until controls are ready. No physical-TV speedup is claimed without measurements.
### Removed
- Navigation → "Disable channels on sidebar" and its guide filter; migration drops the stored value and restores the normal guide.
### Known limitations
- Physical-TV startup duration, updater installation, permissions and playback remain UNVERIFIED. Existing updater diagnostics remain available.

## [4.0.0] — 2026-10-20

> Published 2026-10-20 17:51 UTC as [YTArk 4.0](https://github.com/2archiver/YTArk/releases/tag/v4.0.0) · tag `v4.0.0` · versionCode 4000000 · userscript `s41` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Browsing no longer hijacks playback, and settings are clearer.

### Fixed
- Browsing no longer auto-starts a focused card.
  - Scrolling, focusing, hovering or dwelling on a card under the playing video never navigates into it or replaces the playing video; only a deliberate OK, click or Play opens it.
  - Playback-end autoplay and queueing, and genuine previews on browse pages, are unchanged.
  - Long-press was not involved: it only ever opened a card's menu, and a long focus is not a long press.
- DeArrow replacement is validated for reliable application.
  - A late or slow result can no longer rename a card the frontend has recycled to show another video.
  - Lookups stay prefix-only and private; no full-video-id fallback is added; the thumbnail replacement remains a separate opt-in.
### Added
- A positive shrunken-thumbnail layout control.
  - "Enable shrunken thumbnails" keeps video thumbnails smaller and consistently sized on home, search, recommendations and the under-player rail, and restores standard YouTube sizing when off.
### Changed
- "Who's watching" is now one clear checkbox row.
  - Checked = on; the preference key and its stored true/false are unchanged, and the automatic prompt still waits for the stored choice to load.
- Startup initialization is guarded against a re-evaluated script.
  - A retry cannot double-install remote listeners, managed CSS or the readiness loop.
### Removed
- The two custom colour settings and their dead implementation.
  - Appearance → "Navigation colours" and "Content colours" are gone; the standard YouTube/YTArk chrome styling returns, and stale stored colour values are safely ignored and dropped at migration.
- The confusing negative enlarged-thumbnail toggle.
  - Its effective visual choice is migrated once into the positive shrunken-thumbnail control.
### Known limitations
- TV playback, focus-dwell preview adoption, DeArrow display and the shrunken-thumbnail layout on a physical TV remain UNVERIFIED until their recorded device checks run; this candidate is validated by host tests, the built bundle and source inspection only.
### Validation
- Regression coverage is added for the focus-preview guard, the retired colour settings, the shrunken-thumbnail layout effect and its one-time migration, the Who's-watching checkbox row, and DeArrow late-result and recycled-tile safety.
- Executed host-test results and unavailable device checks are recorded in `docs/YTARK-4.0.0-EVIDENCE.md`.

## [3.9.0] — 2026-10-19

> Published 2026-10-19 15:05 UTC as [YTArk 3.9](https://github.com/2archiver/YTArk/releases/tag/v3.9.0) · tag `v3.9.0` · versionCode 3090000 · userscript `s40` · ARMv7 on the unchanged TizenTubeCobalt v2.0.2 engine.

Reliable updates, simpler profiles, compact diagnostics.

### Added
- Android updater storage recovery is serialized and retryable; a failed optional cleanup no longer blocks release metadata checks.
- The official single-APK ARMv7 release digest is validated directly; a checksum sidecar is optional when GitHub publishes the digest.
### Changed
- One Off/On setting preserves manual account flows.
  - Off suppresses only automatic profile prompts; manual account and sign-in flows remain available.
- Four Diagnostics rows show recording, real startup mode, and result.
  - The startup summary also reports a bounded valid duration; native details scroll and restore Back/focus.
### Fixed
- Checks survive storage outages; transfers and installs require usable storage.
  - Failures are explicit and retryable; no secondary uninitialized-controller error is thrown.
- Native diagnostics I/O moved off the UI thread.
### Removed
- Removed the guest sign-in reminder preference/runtime behavior and the retired diagnostic labels, session browser, advanced reports, and commands.
### Known limitations
- Android updater compilation, signed-candidate inspection, TV permission-return, in-place upgrade, playback, and Google TV behavior remain UNVERIFIED until their recorded checks run.
- If the 3.8 updater cannot recover, install the signed 3.9 APK manually over the existing app once; do not uninstall or clear app data.
### Validation
- Regression coverage is added for storage recovery/wiring, release digest fallback, account-setting migration, reversible automatic-prompt suppression, and the four-row diagnostics UI.
- Executed host-test results and unavailable Android/device checks are recorded in `docs/YTARK-3.9.0-EVIDENCE.md`.

## [3.8.0] — 2026-10-19

> Published 2026-10-19