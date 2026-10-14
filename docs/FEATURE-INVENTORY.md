# YTArk feature inventory (regression checklist)

Derived from the current source (`TizenTube/mods/config.js` defaults and
`TizenTube/mods/features`, `ui`, `resolveCommand.js`) for the unpublished 2.9.1 candidate (a planned direct in-place update from published 2.8.0).
"Code" means the feature is implemented in the bundled userscript and covered by
a source-level test where noted. "Device" means a physical TV run is recorded;
**no device run has been recorded for this candidate**, so every device column is
NOT RUN.

Base: TizenTubeCobalt `v2.0.2` (Cobalt runtime and YouTube TV frontend are the
upstream ones, unchanged). YTArk adds the userscript layer and native updater.
The complete version history is in [`CHANGELOG.md`](../CHANGELOG.md).

Worktree validation on 2026-10-14: 282 Node tests and 128 Python tests passed;
the userscript built (850,096 bytes) and passed `node --check`; changelog,
build-info, logo, launcher-art, repacker, workflow-policy and secret-scan checks
passed. `javac`, `java`, D8, apktool and Android SDK are absent, so native Java
contracts, DEX/APK packaging and signing were not run. Candidate evidence and
requirement statuses are in [`SETTINGS-2.9.1-REVIEW.md`](SETTINGS-2.9.1-REVIEW.md).
These source checks do not verify Android runtime dispatch or a physical TV.

## 2.9.1 candidate: what each claim is backed by

Three separate columns, never merged. **Source implemented** means the code exists
in this repository. **Packaged / CI verified** means a named CI gate or the candidate
build checks it. **Device tested** means a physical TV run is recorded for this exact
APK. Only the first two can be true before a device run.

| Claim | Source implemented | Packaged / CI verified | Device tested |
|---|---|---|---|
| Candidate version 2.9.1 / versionCode 2090100 / `v2.9.1` / `s29` metadata; published 2.8.0 remains v2.8.0 / 2080000 / s27 | Yes (`release/version.properties`, generated `assets/buildInfo.generated.js`) | Python release-contract suite and generated metadata checks are candidate source checks; no Android APK package built | NOT RUN |
| Native updater: public TV launcher proxy *YTArk Updates*, signature-protected `ytark://updates` route, and private updater screen | Yes (`UpdateLauncherActivity.java`, `tools/repack_apk.py`, `UpdateActivity.java`) | Python patch/launcher tests cover source manifest; compiled-manifest check and native launch not run here | NOT RUN |
| Install gate: install only on an explicit press, permission checked with `canRequestPackageInstalls()`, no automatic continuation after a restart, no repeated hand-off | Yes (`InstallGate.java`, `UpdateActivity.java`, `YtarkUpdater.java`) | `InstallGateTest` (host JRE, CI `ci.yml`) | NOT RUN |
| Storage and compatibility guards: free-space budget, release-file cleanup protection, minimum-SDK check, clean release-page tag | Yes (`UpdateGuards.java`) | `UpdateGuardsTest` is defined for CI; Java/Gradle tests not run in this environment | NOT RUN |
| Honest release states: "Up to date" only after a fresh successful check; "Newer than the latest stable release" for a newer local build; timestamped cached results | Yes (`features/updater.js`, `features/updateState.js`) | `updates-settings.test.mjs` (honest release-state copy, 2.6) | NOT RUN |
| Settings actions emit only the screen routes `ytark://updates` and `ytark://storage`; no updater JS interface is registered and the frontend fallback remains read-only | Yes (`ui/ytarkActions.js`, `settingsRegistry.js`, manifest routes in `tools/repack_apk.py`) | Node action test and Python manifest-contract tests cover URL/manifest only; pinned Cobalt dispatch is unproven | **NOT RUN — native navigation pending** |
| Installed-version resolution for About and Updates (async bridge read, bounded retries, labelled build-metadata fallback) | Yes (`features/appVersion.js`, `features/updater.js`) | `app-version.test.mjs`, `updates-settings.test.mjs`; `build_buildinfo.py --check` in `ci.yml` and `build-apk.yml` | NOT RUN |
| Guide entry opens only on an explicit activation (focus/scroll cannot open it; entry last; Back restores focus) | Yes (`ui/guideEntryActivation.js`, `ui/customGuideAction.js`, `resolveCommand.js`) | `guide-entry-activation.test.mjs`, `guide-entry.test.mjs` | NOT RUN |
| User-Agent profile, presets/undo and Fix UI removed; retired keys migrated once | Yes (`config.js` `RETIRED_KEYS`, `features/userAgentRetirement.js`) | `settings-cleanup.test.mjs`, `config-migration.test.mjs`, `branding-guest-ua.test.mjs`; retired-symbol and bundle greps in `ci.yml` | NOT RUN |
| Verdict-aware updater check (compatible / incompatible / unknown evidence, manual route + recovery) | Yes (`features/abiEvidence.js`, `features/updater.js`, `features/updateState.js`) | `abi-evidence.test.mjs`, `updates-settings.test.mjs`, `update-state.test.mjs` | NOT RUN |
| Settings categories (Playback, Appearance, Privacy, Navigation, YTArk Updates, About YTArk, Support) with one control per preference | Yes (`ui/settingsRegistry.js`) | `settings-search.test.mjs`, `settings-cleanup.test.mjs`, `guide-entry.test.mjs` | NOT RUN |
| YTArk entry in the guide (default on, last in the sidebar, one per guide load, survives hiding/reordering) | Yes (`ui/customGuideAction.js`) | `guide-entry.test.mjs`, `guide-entry-activation.test.mjs` | NOT RUN |
| Premium wordmark lifecycle (scoped observers, restored detached hosts, no duplicate mounts) | Yes (`features/premiumBranding.js`) | `premium-branding-lifecycle.test.mjs`, `premium-branding-a11y.test.mjs` | NOT RUN |
| OLED Black theme (painted by a startup step, restored if the frontend drops it); custom colours preserved; Premium wordmark composition | Yes (`ui/theme.js`, `ui/appearanceStyles.js`, `ui/themeTokens.js`, `ui/ui.js`) | `appearance-theme.test.mjs`; bundle grep | NOT RUN |
| Remove player dimming (scrim only; idle dimming independent) | Yes (`ui/appearanceStyles.js`) | `appearance-theme.test.mjs` | NOT RUN |
| Hide channel watermark (renderer removal, recoverable original, player-scoped DOM net) | Yes (`features/playerWatermark.js`, `features/adblock.js`) | `player-watermark.test.mjs`; bundle grep | NOT RUN |
| Shared settings registry; Search settings; D-pad/IME text entry | Yes (`ui/settingsRegistry.js`, `ui/settings.js`, `ui/settingsSearch.js`, `ui/textEntryOverlay.js`) | `settings-search.test.mjs`, `lifecycle.test.mjs` | NOT RUN |
| Customize YouTube Settings (order/hide/pin, protected entries, restore) | Yes (`features/ytSettingsLayout.js`, `ui/ytSettingsEditor.js`, `ui/customYTSettings.js`) | `yt-settings-layout.test.mjs` | NOT RUN |
| CHANGELOG.md, bundled reader, What's new, changelog-driven release notes | Yes (`tools/build_changelog.py`, `ui/changelogReader.js`, `features/whatsNew.js`, `tools/render_release_notes.sh`) | `build_changelog.py --check`; `test_build_changelog.py`; `changelog-whats-new.test.mjs` | NOT RUN |
| Settings schema migration (fresh vs. upgrade defaults), malformed-value repair | Yes (`config.js`) | `config-migration.test.mjs` | NOT RUN |
| SponsorBlock bounded lookup, strict validation, late-result discard | Yes (`features/settlementDeadline.js`, `sponsorblock*.js`) | `ci.yml` Node tests (28 SponsorBlock tests) | NOT RUN |
| Settings → YTArk Updates card (Installed / Latest / Status / QR fallback / changelog link) | Yes (`features/updater.js`) | Node tests (`updates-settings.test.mjs`, `changelog-whats-new.test.mjs`) | NOT RUN |
| Bundled native updater (stable release lookup, ABI/package/signer/version/digest validation, installer hand-off, persistent state) | Yes (`android-updater/`) | Java/JUnit and DEX compile gates are defined in CI; neither was run for this candidate | NOT RUN |
| Persistent hourly update checks; separate automatic checks/downloads; restart reconciliation, install-result polling and phase-specific failures | Yes (`YtarkUpdater.java`, `UpdateSchedulePolicy.java`, `UpdateCheckJobService.java`, `UpdateBootstrapProvider.java`, `InstallerResultPolicy.java`) | Python/Node tests can cover source contracts; Java compiler, host-JRE contracts, DEX build and JobScheduler runtime are blocked/not run | NOT RUN |
| Remote-friendly Cache & Storage; app-cache roots only, off-thread, recent/unknown-age files retained, updater APKs protected | Yes (`StorageActivity.java`, `YtarkUpdater.java`, `UpdateGuards.java`) | Python manifest/release tests passed; Java syntax parsed; no Android cache behavior test or device run | NOT RUN |
| Opt-in playback recovery (off by default; bounded retries; navigation/PiP/pause/error/range guards; visible sign-in/age/region text stops retries) | Yes (`features/playbackRecovery.js`, `config.js`) | `playback-recovery.test.mjs` passed; userscript build passed | NOT RUN |
| Skip-startup-animation availability | Informational row only; no optional YTArk animation/delay hook exists in this base | Settings regression test passed; no control or animation-removal claim | n/a |
| Direct 2.8.0 → 2.9.1 update preserves package/signer/data path and existing preferences/session | Configured by version/package/signing contract; runtime continuity is an Android/device property | No signed APK upgrade or account/session continuity test run | NOT RUN |
| `ytark://updates` / `ytark://storage` → native `UpdateActivity` / `StorageActivity` | Exact URI policy, separate TV launcher proxy, and app-signature permission on exported route activities | Python URL/manifest tests pass; pinned Cobalt dispatch is unproven and device navigation not run | **NOT RUN — native navigation pending** |
| ARMv7-only APK, signer, versionCode, checksums | Yes | `build-apk.yml` candidate build and `publish-release` job verify; public assets re-downloaded | NOT RUN |
| Workflow least privilege (PR read-only, build read-only, publish job alone writes) | Yes | `tools/check_workflow_policy.py` in `ci.yml` | n/a |
| Automatic publication from a successful `main` build; resumable repair | Yes | `tools/publish_release.py`, covered by `tools/tests/test_publish_release.py` | n/a |
| Session preserved over an in-place install; preferences survive | Not a source property | Not a CI property | **NOT RUN** (see `docs/DEVICE-ACCEPTANCE.md`, optional and not a gate) |

## Features

| # | Feature | Default | Where | Code | Device |
|---|---|---|---|---|---|
| 1 | Google sign-in, guest flow, account/session | upstream | Cobalt + YouTube TV service | not modified | NOT RUN |
| 2 | Browse, search, subscriptions, playlists, recommendations | upstream | YouTube TV service | not modified | NOT RUN |
| 3 | Playback (normal, autoplay, captions) | upstream | Cobalt player | not modified | NOT RUN |
| 4 | Client-side ad blocking | ON (`enableAdBlock: true`) | `features/adblock.js`, `adRendererPolicy.js` | tests in `tests/` | NOT RUN |
| 5 | SponsorBlock segment skipping | ON (`enableSponsorBlock`) | `features/sponsorblock.js`, `sponsorblockRequest.js` | `sponsorblock-request.test.mjs` (28) | NOT RUN |
| 6 | SponsorBlock categories and manual-skip set | per-category flags | `config.js` (`enableSponsorBlock*`, `sponsorBlockManualSkips`) | config defaults | NOT RUN |
| 7 | SponsorBlock toasts and undo | ON | `sponsorblock.js` | — | NOT RUN |
| 8 | DeArrow titles (thumbnails opt-in) | ON / thumbnails OFF | `config.js` (`enableDeArrow*`) | — | NOT RUN |
| 9 | Premium visual wordmark (cosmetic) | ON (`enablePremiumLogo: true`) | `features/premiumBranding.js`, `assets/youtubePremiumLogo.generated.js` | `premium-branding-*.test.mjs` | NOT RUN |
| 10 | Quality selection (auto default, manual ceiling) | `auto` | `features/preferredVideoQuality.js` | `preferred-quality.test.mjs` | NOT RUN |
| 11 | Playback speed control and increment | 1× / 0.25 step | `ui/speedUI.js`, `config.js` | — | NOT RUN |
| 12 | Auto frame rate (opt-in) | OFF | `features/autoFrameRate.js` | — | NOT RUN |
| 13 | Picture-in-picture entry (when system feature present) | per device | `resolveCommand.js` | — | NOT RUN |
| 14 | Video queuing | per feature | `features/videoQueuing.js` | — | NOT RUN |
| 15 | Chapters, previous/next, long press (initialized with the UI since 2.5, follows `enableLongPress`), Shorts toggle | ON | `ui/chapters.js`, `ui/ui.js`, `config.js` | — | NOT RUN |
| 16 | Hide watched videos, end-screen cards | OFF | `config.js` | — | NOT RUN |
| 17 | Clock overlay (opt-in) | OFF | `ui/clock.js` | — | NOT RUN |
| 18 | Screen dimming (opt-in) | OFF | `config.js` | — | NOT RUN |
| 19 | Sidebar customisation | per config | `ui/sidebarModification.js` | — | NOT RUN |
| 20 | Platform Cobalt user agent only (the experimental profile control was removed in 2.5; a one-shot retirement hands the platform agent back) | platform default | `features/userAgentRetirement.js` | `branding-guest-ua.test.mjs`, `settings-cleanup.test.mjs` | NOT RUN |
| 21 | Guide entry activation gate (explicit OK/Enter or click; no open on focus, hover or scroll) | armed by input only | `ui/guideEntryActivation.js`, `ui/customGuideAction.js` | `guide-entry-activation.test.mjs` | NOT RUN |
| 22 | YTArk Settings (remote-accessible) | — | `ui/settings.js`, `ui/customYTSettings.js` | `updates-settings.test.mjs` | NOT RUN |
| 23 | About YTArk (YTArk version, YouTube version, Build details) and support QR codes | installed version, else labelled build metadata | `ui/settingsRegistry.js` (`aboutPanel`), `features/appVersion.js`, `assets/buildInfo.generated.js` | `app-version.test.mjs`, `settings-cleanup.test.mjs` | NOT RUN |
| 24 | YTArk Updates card and native updater | check ON (`enableUpdater`) | `features/updater.js`, `updateState.js`, `android-updater/` | `update-state.test.mjs` (26), `updates-settings.test.mjs` (13), Java contract tests in CI | NOT RUN |
| 25 | Translations (32 locales, YTArk wording; new 2.3 strings in English with i18next fallback) | — | `translations/resources/*.json`, `translations/text.js` | — | NOT RUN |
| 26 | OLED Black theme | OLED for fresh installs, YouTube default after an update | `ui/theme.js`, `ui/appearanceStyles.js`, `ui/themeTokens.js` | `appearance-theme.test.mjs` | NOT RUN |
| 27 | Hide channel watermark | ON for fresh installs, OFF after an update | `features/playerWatermark.js` | `player-watermark.test.mjs` | NOT RUN |
| 28 | Remove player dimming | ON for fresh installs, OFF after an update | `ui/appearanceStyles.js` | `appearance-theme.test.mjs` | NOT RUN |
| 29 | Search settings | — | `ui/settingsSearch.js`, `ui/textEntryOverlay.js`, `ui/settingsRegistry.js` | `settings-search.test.mjs` | NOT RUN |
| 30 | Customize YouTube Settings | stock layout | `features/ytSettingsLayout.js`, `ui/ytSettingsEditor.js` | `yt-settings-layout.test.mjs` | NOT RUN |
| 31 | Changelog reader and What's new card | card once per update, inside YTArk Updates; one short summary line per version | `ui/changelogReader.js`, `features/whatsNew.js`, `CHANGELOG.md` | `changelog-whats-new.test.mjs`, `test_build_changelog.py` | NOT RUN |
| 32 | Section resets with scoped confirmation | — | `ui/settings.js` | `settings-search.test.mjs` | NOT RUN |
| 33 | Removed in 2.5: user-agent profiles, presets / Undo Last Preset / Quick Quality, Fix UI, `videoPreferredCodec` | gone | `config.js` (`RETIRED_KEYS`) | `settings-cleanup.test.mjs`, `config-migration.test.mjs` | n/a |
| 34 | Playback recovery | OFF (`enablePlaybackRecovery: false`); opt-in, bounded and gated by player state | `features/playbackRecovery.js`, `config.js` | `playback-recovery.test.mjs` passed (16 tests) | NOT RUN |
| 35 | Cache & Storage | User initiated; only Android app-cache directories; recent/unstatable entries kept; updater files excluded | `android-updater/.../StorageActivity.java`, `YtarkUpdater.java` | No host cache-behavior test run; device-only cleanup verification remains NOT RUN | NOT RUN |
| 36 | Persistent stable-update automation | Checks ON and downloads ON for new native updater preferences; explicit opt-outs persist | `YtarkUpdater.java`, `UpdateSchedulePolicy.java`, `UpdateCheckJobService.java` | Java policy/guard test sources and build gates are present but were not run here | NOT RUN |
| 37 | Skip-startup-animation row | Informational only; no optional YTArk animation/delay hook exists | `ui/settingsRegistry.js` | `settings-cleanup.test.mjs` passed | n/a |

## Storage, preferences and data

| Item | Current behaviour | Verified |
|---|---|---|
| Userscript configuration | `localStorage` key `ytaf-configuration`; missing keys are filled from defaults, stored user choices are kept | source (`config.js`) |
| Google / Cobalt account storage | Cobalt's app data directory, unchanged by YTArk | not verified against the APK |
| Pending update metadata and partial downloads | app-private updater directory, matched to release metadata before reuse; selected resumable/pending installer files excluded from cleanup | source (`YtarkUpdater.java`) |
| Android app cache | `getCacheDir()` and `getExternalCacheDirs()` only; files newer than 15 minutes (or with unknown modification time) are kept; profile/data directories are not traversed | source only; cleanup not tested on a device |

**Migration (2.3.0).** The configuration gains an explicit
`configSchemaVersion` (2). On the first launch of 2.3 an installation with
existing YTArk settings (or YouTube TV history) keeps its appearance —
`uiTheme: youtube`, `hidePlayerWatermark: false`, `removePlayerScrim: false` —
while a fresh installation starts with OLED Black and both player cleanup
options on. The marker is written once, so explicit choices win from then on.
All existing keys are kept; malformed values are repaired to their defaults
instead of being reset wholesale, and Google/YouTube storage is never read or
written (only the existence of YouTube's own key is checked to tell a fresh
install from an upgrade).

**Historical migration (2.5.0).** The schema marker moved to `configSchemaVersion` 3.
The six retired keys (`userAgentProfile`, `enableFixedUI`, `tvActivePreset`,
`tvLastPresetSnapshot`, `tvQuickQuality`, `videoPreferredCodec`) are deleted
exactly once on the first launch of 2.5, and `videoPreferredCodec` is copied
into `preferredVideoCodec` (the key the player reads) before it is dropped.
Their previous values are reported through `getConfigMeta().retired` /
`.retiredValues` so `features/userAgentRetirement.js` can hand the platform
user agent back once and set the one-shot `ytark-user-agent-retired` marker
(a separate `localStorage` key, so a repeat migration or a reload loop is
impossible). Every retained preference keeps its value — nothing an applied
preset had changed is rolled back and no section is reset — and Google/YouTube
account, cookie and session storage is never read or written.

| New key | Purpose |
|---|---|
| `uiTheme` | `youtube` or `oled` |
| `hidePlayerWatermark`, `removePlayerScrim` | Appearance → Player toggles |
| `preferredVideoCodec` | Default for the key the player already read (previously missing) |
| `ytSettingsLayout` | YouTube Settings order/hidden sections, pinned/hidden entries (stable ids) |
| `ytSettingsCatalog` | Sections detected on the YouTube Settings page (no account identity) |
| `lastSeenVersion`, `whatsNewVersion`, `whatsNewDismissedVersion` | What's new bookkeeping (version strings only) |
| `enablePlaybackRecovery` | Opt-in player recovery; new default is off; existing explicit value is preserved |
| `configSchemaVersion` | Settings schema marker (4; playback-recovery migration was introduced in published 2.8.0) |

## Branding audit (visible strings)

| Surface | Result |
|---|---|
| Settings title and entry | "YTArk Settings" (`translations/resources/en.json`, `ttSettings.title`) |
| Player subtitle | "with YTArk" in 32 locales (`player.withTizenTube` key name only) |
| Launcher label, banner, icon | Set by `tools/repack_apk.py` (`app_name` YTArk) and `android-updater/` assets |
| Native updater strings | No `TizenTube` text found in `android-updater/` |
| Upstream text | Kept only in `NOTICE.md`, `TizenTube/LICENSE`, and the README attribution section |

Internal identifiers that were **not** renamed because changing them risks
compatibility: `window.h5vcc.tizentube` (the upstream bridge object),
`tizentube-clock` (DOM id), `tizentube_category` (settings key), the
`io.gh.reisxd.tizentube.cobalt` old-package references checked by
`repack_apk.py`, and the upstream script URL pattern.


## 2.8.0 migration and release boundary

YTArk 2.8.0 was published on 2026-10-13. Its schema-4 migration added
`enablePlaybackRecovery`, default off; an existing saved value is retained and a
missing value receives the off default. Native automatic-check/download
preferences default on while explicit opt-outs are persisted. The published
release was built and signed, but account/session continuity and device behavior
are not established by this source inventory.

The 2.9.1 candidate does not reset or rewrite existing preferences, cookies,
credentials, profile data, watch history, package ID, signing identity or app-data
directory. Direct signed upgrade from 2.8.0 and session retention remain
**NOT RUN**; there is no 2.9.1 signed APK in this worktree.
