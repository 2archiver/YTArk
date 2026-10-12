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

## [2.6.0] — Unreleased

> Not yet published. Planned tag `v2.6.0` · versionCode 2060000 · userscript `s25` · one ARMv7 APK (armeabi-v7a) on TizenTubeCobalt v2.0.2. The publication date is recorded on the GitHub release when the release workflow publishes this build.

Complete native updater and Android install-permission release for the ARMv7 build. The updater is reachable from the TV apps row as **YTArk Updates**. Every install still needs your confirmation in Android's installer, and nothing is installed silently, uninstalled or reset.

### Added
- **YTArk Updates in the TV apps row** (launcher entry for the existing native updater screen; `ytark://updates` keeps working). The Settings → Updates card points to this screen.
- **Install permission handled by the user, never by YTArk.** Installing needs Android's one-time "Install unknown apps" permission for YTArk (`REQUEST_INSTALL_PACKAGES`). YTArk asks for it only when you press Install, checks the live permission with `canRequestPackageInstalls()`, and opens only the permission screen for this app's package. It continues only if the permission is actually on when you return. No storage permission is requested.
- **Storage and compatibility guards.** The download is refused with a clear message when the free space cannot hold the APK plus a safety margin, and an out-of-space failure during the transfer is reported as its own state. Leftover partial files and old-version APKs are removed, and a verified pending APK is kept. The APK's minimum Android version is checked before any hand-off.
- **Granular update states** with a reason on every failure: offline, release lookup failed, rate limited, architecture unavailable, no ARMv7 APK for the newer release, not enough storage, download failed, validation failed, install permission needed, installer unavailable, install not confirmed.
- **"Newer than latest" result.** A build that is newer than the latest published stable release is reported as such, not as an ordinary "up to date".
- **View Release Page** on the updater screen: opens the official release page when a browser is present.

### Changed
- **Install hand-off happens once.** The installer is opened at most once per press. Its result code is never treated as success: the installed versionCode is read again on the next check, and only that confirms the update. A restart never repeats a hand-off that is still waiting; Retry Installation is the only way to reopen it.
- **Focus and Back.** After the permission screen returns, D-pad focus goes back to Install Update. The screen keeps receiving results when it is recreated, for example after a rotation.
- **Card copy.** The Settings card names the YTArk Updates screen as the install route, says the card itself does not download or install, and labels cached results with the time of the last successful check.

### Fixed
- A second manual check while one was running failed with "already running". The running check now reports to the screen that asked.
- A newer release with no ARMv7 APK was reported as a generic lookup failure. It now has its own state, and the installed version is unchanged.
- The update card and the updater screen could show an installed build that is newer than the latest release with the same message as an up-to-date install.

### Defaults and migration
- **Upgrading from 2.5.** The updater code in this release runs only once 2.6 is installed, so 2.5 cannot update itself to 2.6. Install the signed `YTArk-v2.6.0-armv7.apk` once, over the existing app, with the same signing certificate: Android keeps your app data and sign-in. Later releases can then be checked and installed from YTArk Updates. Uninstalling or reinstalling is not needed and is not the update method.
- Settings schema 3 is unchanged. No preference, sign-in or app data is reset by this release.

### Known limitations
- **Not device-verified.** No TV run of 2.6 is recorded: the install-permission screen, the installer hand-off, the post-install version confirmation and the TV apps-row entry are NOT RUN. The verification report for this build lists what was and was not run.
- The web card cannot start the native installer. Cobalt registers the JavaScript bridge objects, and the repacked build cannot add one, so the card hands off to YTArk Updates instead of running the install itself.
- 2.5 clients need the one-time manual install of 2.6 described above. Nothing repairs 2.5 retroactively.

### Validation
- Automated: the userscript unit and integration tests (Node), the Python release, repacker and changelog tests, and the native updater Java contract tests run in CI for this build. The bundled changelog and build metadata are regenerated and checked. The release pipeline checks the signed APK's manifest for the YTArk Updates launcher entry, the signing certificate, the ABI, the versionCode and the release assets before publishing.

## [2.5.0] — 2026-10-11

> Published 2026-10-11 23:41 UTC as [YTArk 2.5](https://github.com/2archiver/YTArk/releases/tag/v2.5.0) · tag `v2.5.0` · versionCode 2050000 · userscript `s24` · ARMv7 APK

Settings cleanup and UX repair: the removed controls are gone everywhere, the settings entry opens only when it is selected, OLED Black actually paints, and About reports the real installed version. Same package identity (`io.github.twoarchiver.ytark`), signing certificate, ARMv7 base and YouTube TV frontend as 2.4.

### Added
- **Installed-version resolution** (`features/appVersion.js`). The installed YTArk package version is read through the platform bridge in the asynchronous shape the pinned Cobalt base really uses — callback, returned Promise or synchronous string — with bounded retries while the bridge binds late. This build's packaging metadata is embedded at build time (`tools/build_buildinfo.py` writes `TizenTube/mods/assets/buildInfo.generated.js` from `release/version.properties`) and is used as a labelled fallback, so a release build can always state its own version offline. Nothing derives the installed version from the latest GitHub release, from the YouTube frontend version or from a hardcoded label, and no network access is involved.
- **Separated About fields**: "YTArk version", "YouTube version" (only when the running frontend publishes a recognizable client version) and "Build details" (versionName · versionCode · userscript tag · Android base tag) as their own lines, plus a "Read the installed version again" row while the platform has not answered. The panel re-renders in place — same popup id, `updateAction` — when the version arrives, so no second panel is created.
- **Explicit activation for the settings entry** (`ui/guideEntryActivation.js`). An OK/Enter keydown or a click arms a single-use activation; the entry's own action is honoured only while one is armed. Both the frontend's command path and YTArk's own fallback open through one per-activation token.
- Regression tests for the cleanup, the version path, the activation gate and OLED coverage.

### Changed
- **YTArk Settings categories** are now Playback, Appearance, Privacy, Navigation, YTArk Updates, About YTArk and Support. The "YTArk Quick Controls" menu is dissolved: nine of its eleven rows duplicated rows that already existed elsewhere in the tree (theme, quality, related videos, guide entry, YouTube Settings layout, Shorts, previews), and the two that did not are moved to the category that describes them — Premium logo to Appearance, Hide end-screen cards to Appearance › Player. Every retained preference now has exactly one control.
- **The settings entry sits last in the sidebar**, below every YouTube entry, and opens only on an explicit selection. Focusing, hovering or scrolling past it highlights it and does nothing else; no key is prevented or stopped, so unrelated remote input reaches the frontend untouched. Any other command the resolver sees (a modal Back button, a browse endpoint) spends the activation, so an OK used elsewhere cannot leak into a later focus event.
- **Back restores focus**: leaving a YTArk submenu or panel returns to its parent with focus on the row that was used; Back from the root still returns to the previous sidebar position.
- **OLED Black** now paints the app backdrop (`html`, `body`, `#container`), the browsing and search surfaces, the overlay/dialog surfaces the frontend renders YTArk's own panels into, and YouTube's own background variables. The focused sidebar entry is kept on a raised near-black (`#262626`) so selection stays visible against true black; the frontend's own focus pills are untouched. The theme is re-applied once the TV DOM exists (a startup step in `ui/ui.js`) and a narrowly scoped head observer restores the managed stylesheet if the frontend drops it, bounded to five restorations instead of scanning forever.
- The root menu says whose settings these are: "YTArk's own playback, appearance, privacy and update settings for this YouTube TV app". YouTube's own Settings page keeps its rows, and "Customize YouTube Settings" stays in Navigation; no upstream account or privacy control was moved into the YTArk tree.
- The Updates card reads the installed version through the same resolver as About and labels a build-metadata fallback as such. The architecture evidence and the update comparison keep using package metadata only, so build metadata can never fabricate an armeabi-v7a verdict.
- "What's new" now waits for the asynchronous installed-version read instead of skipping the session, and never uses build metadata to claim an update was installed.
- The one part of "Fix UI" that did real work — the frontend's long-press switch — is folded into normal UI initialization and follows the `enableLongPress` preference.

### Removed
- **User-Agent profile**: the control, its descriptions, search entries, device profiles, the reset action and the `userAgentProfile` preference (`features/userAgentSpoofing.js` is gone). YTArk uses the platform's own Cobalt user agent and never builds or applies a substitute string. Installations that had chosen an experimental profile are migrated once (`features/userAgentRetirement.js`): the bridge is asked for its built-in user agent again (`ResetUserAgent()`, or the empty override), the legacy markers are cleared, and a one-shot marker prevents any repeat or reload loop. Installations that never chose a profile make no bridge call and reload nothing.
- **Presets, Undo Last Preset and Quick Quality**: `features/tvControls.js`, the `TV_APPLY_PRESET`, `TV_UNDO_PRESET` and `TV_SET_QUALITY` actions, and the `tvActivePreset`, `tvLastPresetSnapshot` and `tvQuickQuality` preferences. Settings an applied preset had already changed stay exactly as the user left them — nothing is rolled back and no section is reset. SponsorBlock's "Undo last manual skip" and the per-section reset actions are untouched.
- **Fix UI**: the `enableFixedUI` preference, its row, its search entries and the observer that stripped the frontend's `app-quality-root` body class. It only flipped YouTube's own animation and quality switches and defaulted to off on this build.
- The retired `videoPreferredCodec` preference (its value is copied to `preferredVideoCodec`, which the player reads, before it is dropped), the `fixUI` label in all 32 translation files, and the stale "quick access" search alias of the guide entry.

### Defaults and migration
- Settings schema 3. The retired keys are deleted from the stored configuration exactly once, and their previous values are reported through `getConfigMeta().retiredValues` so the user-agent retirement can finish its own cleanup. Every retained preference keeps its value; account, cookie and session storage is never read or written by the migration, and no other YTArk preference is reset.
- Fresh installations are unchanged apart from the removed controls.

### Fixed
- **About YTArk reported "Version unknown"** on every 2.4 build. `GetVersion()` is an asynchronous bridge call on the pinned base (`h5vcc_tizentube.mojom` declares `GetVersion()` as an asynchronous method answering with a version string, and the Java side returns the installed package's `versionName`), so the synchronous read produced nothing the strict version pattern accepted. The same defect made the Updates card report an unknown installed version, and a Promise-returning binding could be stringified into that card as "[object Promise]".
- **YTArk Settings opened while scrolling the sidebar.** The injected guide entry carried `TT_SETTINGS_SHOW` as its `navigationEndpoint`, and the frontend resolves a guide entry's endpoint when the entry receives focus — which is how the sidebar browses. The entry now carries an action that is honoured only after an explicit activation.
- **OLED Black had no visible effect.** Nothing re-applied the managed stylesheet once the TV DOM existed (`updateStyle()` ran only from the removed Quick Controls initialization and on preference changes), the frontend can drop injected head nodes, the overlay surfaces YTArk's own panels render into were not covered, and the near-black default left little visible difference.
- **Duplicate registrations**: two rows wrote `preferredVideoQuality` and two wrote `enableYtarkGuideEntry`/`ytSettingsLayout`, so a change in one place could be shown stale in another.

### Known limitations
- OLED Black styles the surfaces this build can reliably select. The overlay/dialog selectors follow the frontend's own naming convention, proven by the classes `ui/ui.css` already styles on device; a surface whose class this build does not render keeps YouTube's own colour. No rule targets video, images, thumbnails, artwork, captions or the player scrim, and no original style is permanently rewritten — turning OLED off restores the saved colours.
- Whether a given frontend build resolves the guide entry's endpoint on focus or on OK cannot be observed from this repository; both paths are handled, and the bottom placement means a focus-resolving build still cannot open settings by scrolling alone.
- When the platform never answers the version read, About reports this build's packaging metadata labelled "(build metadata)" instead of claiming package metadata, and the update comparison stays conservative.

### Validation
- Automated: the userscript unit and integration tests (Node), the Python release, repacker, build-metadata and changelog tests, and the native updater Java contract tests.
- NOT RUN on a physical TV: the visual OLED check on Home, the sidebar and Settings; remote OK/Back behaviour on the settings entry; the installed-version read on a device; and the upgrade path from a 2.4 installation. They stay tracked as NOT RUN in `docs/RUNTIME-CHECKLIST.md` and `docs/DEVICE-ACCEPTANCE.md` until a device run is recorded.

## [2.4.0] — 2026-10-11

> Published 2026-10-11 20:38 UTC as [YTArk 2.4](https://github.com/2archiver/YTArk/releases/tag/v2.4.0) · tag `v2.4.0` · versionCode 2040000 · userscript `s23` · one ARMv7 APK

A safer updater and a tidier settings home. Same package, signing certificate, ARMv7 base and YouTube TV frontend as 2.3.

### Added
- **Verdict-aware update checks** (YTArk Updates). Device architecture is now collected as structured evidence: the Android ABI list, the running ARMv7-only build (2.1.2 and later), runtime CPU labels and bridge availability are kept apart and classified as compatible, incompatible or unknown. Missing, delayed or unreadable data is never read as "unsupported"; the check, release notes and retrying detection stay available, and the manual route on the official release page is shown with a recovery action. An ARMv7 release asset is matched only on explicit compatible evidence.
- **Re-detect device architecture** on the Updates card (also offered when the architecture is unknown). Re-reads the device architecture, waiting for the Cobalt bridge if it binds late, and re-matches the cached release without a full check.
- **YTArk entry in the guide** (Navigation). Keeps YTArk Settings reachable from the sidebar even when other guide entries are hidden or reordered; default on, no secret key combinations, exactly one entry per guide load.

### Changed
- YTArk Settings is grouped into labelled categories — Playback, Appearance, Privacy, Navigation — plus Quick Controls, Updates, About and Support. The legacy "User Interface" and "Miscellaneous" root menus and the duplicate Changelog row are removed; every setting id is preserved, so settings search and saved preferences keep working. The root description reads "Playback, appearance, privacy and updates".
- The YTArk Settings guide entry is added right after Home through the existing settings action and only after the reordering and hiding passes, so hiding sidebar items can never make settings unreachable. It is not exposed to the move/hide guide-entry actions.
- The Updates screen names the official release page as the manual route (with a QR code) and offers one recovery path in every state instead of a categorical message when the architecture cannot be confirmed.

### Defaults and migration
- Fresh installations start with OLED Black, Hide channel watermark and Remove player dimming turned on (unchanged from 2.3), and with the YTArk entry in the guide on.
- Updated installations keep every existing preference, including the 2.3 appearance choices and the settings schema marker; only the new guide-entry toggle starts on and can be turned off under Navigation. Google account data, cookies and other preferences are not touched.

### Fixed
- The update screen could report a device as unsupported when the architecture bridge was late or empty, when a 64-bit first ABI was reported, or when the device ABI list and runtime CPU label disagreed. It now reports only what is actually known and offers a retry; a categorical "not compatible" message is reserved for an explicit non-ARM userspace.
- Repeated opens of YTArk Settings could mount duplicate Premium wordmarks and duplicate observers in a patched header; each host is now tracked on its own, detached hosts are restored to the stock logo and forgotten, and route changes keep exactly one observer per host.
- A YouTube guide response with an empty items list could throw while the YTArk Settings entry was being added and stop the rest of response processing; empty and guide-less payloads are now accepted unchanged.
- Re-verifying an already-published release failed on the temporary local file names of the re-downloaded public assets (the packaging checks require the published names), so the release pipeline could report a failed run after a successful publication. The public bytes are now validated under their published names.

### Known limitations
- The repacked build cannot connect the native updater engine to the settings card (Cobalt owns the JavaScript bridges). The card performs a real, validated release check and hands installation to the official page and Android's installer, always with user confirmation; the bundled native updater screen itself is not device-verified.
- "Could not confirm this device's app architecture" can still appear when the bridge never reports a value and the installed build predates 2.1.2; the manual route covers that case.
- No physical TV run has been recorded for this build: updater D-pad flows, the guide entry, logo placement and in-place update with session continuity are tracked as NOT RUN in `docs/RUNTIME-CHECKLIST.md`.

### Validation
- Automated: the userscript unit and integration tests (Node), the Python release, repacker and changelog tests and the native updater Java contract tests run in CI for this build. `CHANGELOG.md` and the bundled in-app changelog data are regenerated and checked, and the release pipeline re-downloads and re-verifies the published assets under their published names.
- NOT RUN on a physical TV: D-pad flows, cold launch, signed-in and guest navigation, player transitions, theme restoration, keyboard entry, settings reordering, changelog scrolling and in-place update with session continuity. They stay tracked as NOT RUN in `docs/RUNTIME-CHECKLIST.md` until a device run is recorded.

## [2.3.0] — 2026-10-11

> Published 2026-10-11 13:46 UTC as [YTArk 2.3](https://github.com/2archiver/YTArk/releases/tag/v2.3.0) · tag `v2.3.0` · versionCode 2030000 · userscript `s22` · one ARMv7 APK

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
