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
- "Unreleased" marks changes in this source tree that have not been published.
- Nothing is described as tested on a physical TV unless a device run is
  recorded (see `docs/RUNTIME-CHECKLIST.md`).
- Capabilities inherited from TizenTube and TizenTubeCobalt are listed under
  "Upstream base and inherited capabilities", not as YTArk additions.

## [2.3.0] — Unreleased

> Not yet published. Planned tag `v2.3.0` · versionCode 2030000 · userscript `s22` · one ARMv7 APK (armeabi-v7a) on TizenTubeCobalt v2.0.2. The publication date is recorded on the GitHub release when the release workflow publishes this build.

OLED Black, cleaner playback, searchable settings, a customizable YouTube Settings page and a complete changelog. Same package, signing certificate, ARMv7 base and YouTube TV frontend as 2.2.

### Added
- **OLED Black theme** (YTArk Settings › Appearance › Theme). True black (#000000) for the supported Home, Search and Subscriptions surfaces, the sidebar, the YouTube Settings background, YTArk Settings, dialogs and the changelog reader, from one managed stylesheet and shared design tokens. Thumbnails, channel art, video, subtitles and other images are never recoloured, and the Premium wordmark keeps its own colour handling. "YouTube default" brings back the previous look, including saved navigation and content colours.
- **Hide channel watermark** (Appearance › Player). The clickable channel branding watermark (the `featuredChannel` player annotation) is removed from player responses before the TV frontend reads them, so no logo, click target or focus target is created. Turning it off puts the original data back. Channel avatars elsewhere and the Premium header artwork are untouched.
- **Remove player dimming** (Appearance › Player). Clears only the dark scrim behind the playback controls; controls stay readable with a light text shadow. It does not change video brightness, SDR/HDR output or the existing inactivity screen dimming, which stays a separate setting.
- **Search settings** at the top of YTArk Settings. Finds every YTArk setting, including nested ones, by name, description, category and aliases (for example OLED, watermark, dimming, updates, sponsor, resolution). Results show the current value, where the setting lives and a short description, and open the real control. Operable with the D-pad (suggested searches and a built-in keyboard) and with the TV's own keyboard where one is available. Searches never leave the TV.
- **Customize YouTube Settings**. Reorder or hide sections of the native YouTube Settings page, pin frequently used entries into a Pinned section and hide optional entries, with Move up, Move down and Show/Hide actions for the remote. Account, sign-in and sign-out, About, Help and YTArk entries are protected. "Restore default layout" resets only this layout.
- **Changelog and What's new**. This version history ships inside the app for offline reading from YTArk Settings and YTArk Updates. After an update, a small dismissible What's new card appears in YTArk Settings once per installed version; it never interrupts playback.
- Reset buttons for individual YTArk settings sections, with a confirmation that lists exactly what is reset.

### Changed
- YTArk Settings is reorganised: Search, Quick Controls, Appearance, Customize YouTube Settings, Video Player, SponsorBlock, DeArrow, Subtitles, User Interface, Miscellaneous, YTArk Updates, Changelog, About and Support.
- The YTArk section on the native YouTube Settings page offers YTArk Settings, Search, What's new and YTArk Updates, and is added only once however often the page is opened.
- Menus and search are built from one shared settings registry, so they cannot drift apart. Settings a device cannot support, such as auto frame rate without the frame-rate bridge, show the reason instead of a working switch.
- Applying the Midnight Blue or Classic Dark preset, or editing a custom colour, switches the theme to YouTube default so the colours are visible; Undo Last Preset restores the previous theme.
- The "What changed" part of the GitHub release notes is generated from this changelog.

### Defaults and migration
- Fresh installations start with OLED Black, Hide channel watermark and Remove player dimming turned on.
- Existing installations keep their current appearance: the three new options stay off after updating until you turn them on. A settings schema marker (`configSchemaVersion` 2) records this one-time step, and your explicit choices are kept from then on. Google account data, cookies and other preferences are not touched.

### Fixed
- "Hide Shorts" and "Hide Previews" in Quick Controls showed the opposite of their state: the box was ticked while Shorts or previews were shown.
- The preferred video codec setting read a key without a default, so no option appeared selected and each player response logged a warning.
- Saved settings with malformed values (wrong types, an invalid startup destination) are repaired when loaded instead of breaking features. A failed save shows one notice per session.
- Any response with a title was treated as the native settings page, which could stop the rest of response processing (DeArrow, shelves) or add the YTArk entry to unrelated responses.
- A failure during start-up could repeat the initialisation and add duplicate styles, key handlers and start-up reloads.
- Turning the clock off and on again left the previous one-second timer running.
- Changes to YTArk-only settings are no longer passed on to the YouTube frontend's own setting handler.
- Share, playback speed and picture-in-picture actions no longer fail when no player or bridge is available.

### Known limitations
- Current YouTube TV frontends may not draw the branding watermark at all; then there is nothing to remove. Watermarks burned into the video picture cannot be removed.
- OLED Black covers the YouTube TV surfaces verified by class name; surfaces the frontend adds later keep YouTube's colours until they are supported. OLED Black is a visual mode; it can only save power on emissive (OLED) panels.
- YouTube Settings customization applies the next time the page loads from YouTube and works with sections and entries that expose a stable section id, entry id or client setting; anything else stays where YouTube puts it.
- Typing relies on the TV's input method when available; the built-in D-pad keyboard covers Latin letters and digits.

### Validation
- Automated: the userscript unit and integration tests (Node) and the Python release, repacker and changelog tests run in CI for this build, and the bundle is checked for the new modules and changelog data.
- NOT RUN on a physical TV: D-pad flows, cold launch, signed-in and guest navigation, player transitions, theme restoration, keyboard entry, settings reordering, changelog scrolling and in-place update with session continuity. They are tracked as NOT RUN in `docs/RUNTIME-CHECKLIST.md` until a device run is recorded.

## [2.2.0] — 2026-10-11

> Published 2026-10-11 11:01 UTC as [YTArk 2.2](https://github.com/2archiver/YTArk/releases/tag/v2.2.0) · tag `v2.2.0` · versionCode 2020000 · userscript `s21` · one ARMv7 APK

Maintenance and UX release on the TizenTubeCobalt v2.0.2 ARMv7 base; not a newer Cobalt engine or YouTube client.

### Changed
- SponsorBlock segment lookups have a real deadline that covers the response and its body. Malformed numbers, reversed ranges and late responses are discarded, so they cannot affect the playing video.
- Settings › YTArk Updates shows the installed version, the latest stable release and one plain status (checking, up to date, update available, couldn't check). Without an in-app install bridge it shows the official release page with a QR code.
- A successful main-branch build now publishes the verified ARMv7 APK as the stable release automatically, with a resumable recovery workflow.

### Known limitations
- The bundled native updater's prompt and package-installer path were not device-verified, so automatic update prompts were not claimed.
- Physical TV installation and playback were not recorded.

## [2.1.2] — 2026-10-11

> Published 2026-10-11 05:34 UTC as [YTArk 2.1.2](https://github.com/2archiver/YTArk/releases/tag/v2.1.2) · tag `v2.1.2` · versionCode 2010200 · userscript `s20` · one ARMv7 APK

### Changed
- The cosmetic Premium wordmark is the exact 2024 YouTube Premium vector lockup from Wikimedia Commons, bundled as path geometry with no font, raster image or runtime request. Provenance is recorded in `NOTICE.md`.
- The emblem keeps its source colours in dark and light headers while the lettering follows the native header colour; turning the option off restores the stock header exactly.
- Releases are ARMv7 (armeabi-v7a) only. The ARM64 build, asset and documentation left the active pipeline; earlier releases keep their assets.
- The updater picks the ARMv7 asset by validated name and metadata, refuses the legacy ARM64 asset and checks Android's supported ABI list before downloading.

### Fixed
- Devices whose Android userspace runs only 64-bit code get a clear ABI message instead of failing later at install time.

## [2.1.1] — 2026-10-11

> Published 2026-10-11 04:22 UTC as [YTArk 2.1.1](https://github.com/2archiver/YTArk/releases/tag/v2.1.1) · tag `v2.1.1` · versionCode 2010100 · userscript `s19` · ARMv7 and ARM64 APKs

### Fixed
- The cosmetic Premium wordmark patches the real YouTube TV header logo, appears on cold launch and after navigation, places exactly one wordmark per logo location and restores the stock artwork, focus and accessible names when turned off. It is on by default and an explicit opt-out is kept.

### Changed
- Settings › YTArk Updates performs a validated check of the official stable release and reports failures honestly; a failed check is never shown as up to date.
- Updater hardening: drafts, prereleases, mismatched version metadata, wrong-ABI or ambiguous assets, downgrades and unreadable responses are refused with actionable messages.

## [2.1.0] — 2026-10-10

> Published 2026-10-10 06:03 UTC as [YTArk 2.1](https://github.com/2archiver/YTArk/releases/tag/v2.1.0) · tag `v2.1.0` · versionCode 2010000 · userscript `s18` · ARMv7 and ARM64 APKs

### Changed
- Visible TizenTube labels and the welcome toast were removed; product titles and localized labels say YTArk while legal attribution stays in the notices.
- Versions use clean SemVer (display version 2.1, Android versionName 2.1.0).
- The native updater became a D-pad screen with stable-only release checks, numeric version comparison, same-ABI asset selection, checksum, package, version and signer verification, retry, resume and cancel, and a user-confirmed hand-off to Android's package installer.
- The launcher artwork (white tile, red play emblem, orbital swoosh) covers the launcher, adaptive, TV banner and monochrome resources.

### Known limitations
- Physical-device acceptance (install, playback, in-place update) was not recorded.

## [2.0.4-ytark.17] — 2026-10-09

> Published 2026-10-09 19:40 UTC as [YTArk](https://github.com/2archiver/YTArk/releases/tag/v2.0.4-ytark.17) · tag `v2.0.4-ytark.17` · versionCode 20017 · userscript `s17` · ARMv7 and ARM64 APKs

### Changed
- "Alternative 2" launcher branding with an adaptive icon and mipmap variants.
- Privacy hardening: debug logging of request and playback payloads was removed and `docs/PRIVACY.md` lists every external contact. YTArk adds no analytics, telemetry or crash reporting.
- Release workflows were split into least-privilege jobs with commit-pinned actions, and a secret scan covers the tree and the full history.
- The update screen discloses the start-up and six-hourly checks; Later snoozes prompts for 24 hours.

## [2.0.4-ytark.16] — 2026-10-09

> Published 2026-10-09 17:57 UTC as [YTArk](https://github.com/2archiver/YTArk/releases/tag/v2.0.4-ytark.16) · tag `v2.0.4-ytark.16` · versionCode 20016 · userscript `s16` · ARMv7 and ARM64 APKs

### Added
- Matching ARMv7 (armeabi-v7a) and ARM64 (arm64-v8a) APKs from pinned TizenTubeCobalt v2.0.2 assets, with size, digest and native-library checks.
- A cosmetic, independently switchable Premium-style header mark, remote-accessible client-side controls, bounded quality selection and opt-in User-Agent profiles.

### Changed
- The stock sign-in and Continue as guest flows are preserved, and a one-time recovery undoes account-screen suppression left by older builds.
- The updater matches the installed ABI and verifies official release metadata, checksums and signer continuity.

## [2.0.3-ytark.15] — 2026-10-09

> Published 2026-10-09 11:19 UTC as [YTArk](https://github.com/2archiver/YTArk/releases/tag/v2.0.3-ytark.15) · tag `v2.0.3-ytark.15` · versionCode 20015 · userscript `s15` · one ARM64 APK

First release under the YTArk name.

### Added
- Standalone Android package `io.github.twoarchiver.ytark`, signed with the intentionally public Hearth community certificate (SHA-256 b9cb7e…47eaae) so later releases install in place.
- A native updater for the official stable releases with user-confirmed installs through Android's package installer; these release notes described start-up and six-hourly checks.
- YTArk Quick Controls as the first YTArk Settings item: presets, one-level undo, quick quality and TV-focused visibility controls.

### Known limitations
- Only an ARM64 APK was published for this version.

## [2.0.2-personal.14] — 2026-10-09

> Published 2026-10-09 08:41 UTC as the [pre-YTArk build](https://github.com/2archiver/YTArk/releases/tag/v2.0.2-personal.14) (package `io.github.personal.tubetv`, assets named personal-tubetv) · tag `v2.0.2-personal.14` · versionCode 20014 · userscript `s14` · ARMv7 and ARM64 APKs

The repository's first published build, released before the YTArk name and package. It installs alongside other apps and is not an update path to YTArk.

### Added
- TV Quick Controls in the in-app settings: Clean TV, Midnight Blue and Classic Dark presets, one-level undo and quick quality (Auto, 2160p, 1440p, 1080p, 720p with a largest-below-target fallback).
- Resilient configuration storage: corrupt values and failed writes fall back safely.

### Changed
- The upstream updater was disabled because it would have installed the official TizenTubeCobalt APK over this build.

### Known limitations
- Signed with a temporary key, so each newer build had to be installed after uninstalling the previous one.

## Unpublished drafts and other tags

- `v2.2.0-probeJ` and `v2.2.0-probeK` are draft releases without assets, created on 2026-10-11 while diagnosing the 2.2 publication pipeline. They were never published and are not versions.
- `s5` to `s13` are userscript tags pushed on 2026-10-09 while the first build pipeline was set up; no published APK used them. Each later `sNN` tag belongs to the release that lists it above.
- The 2.0.3-ytark.15 release notes described automatic update prompts; later releases narrowed that claim until the native updater's device path is verified.

## Upstream base and inherited capabilities

- Android and Cobalt base: TizenTubeCobalt v2.0.2 (synced with Cobalt 27 LTS), changed by YTArk only through repackaging, branding, the userscript address and the native updater.
- Inherited from the TizenTube userscript (GPL-3.0-only): client-side ad blocking, SponsorBlock with segment markers, DeArrow, video queueing, preferred quality, speed and codec, sidebar ordering, startup destination, the clock, inactivity screen dimming, watched-video filtering and player button controls. YTArk maintains and extends them but did not create them.
- The YouTube TV frontend, sign-in, playback and account features come from YouTube's own service.
