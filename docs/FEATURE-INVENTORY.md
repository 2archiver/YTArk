# YTArk feature inventory (regression checklist)

Derived from the current source (`TizenTube/mods/config.js` defaults and
`TizenTube/mods/features`, `ui`, `resolveCommand.js`) for the 2.4.0 candidate.
"Code" means the feature is implemented in the bundled userscript and covered by
a source-level test where noted. "Device" means a physical TV run is recorded;
**no device run has been recorded for this candidate**, so every device column is
NOT RUN.

Base: TizenTubeCobalt `v2.0.2` (Cobalt runtime and YouTube TV frontend are the
upstream ones, unchanged). YTArk adds the userscript layer and native updater.
The complete version history is in [`CHANGELOG.md`](../CHANGELOG.md).

## 2.4.0 candidate: what each claim is backed by

Three separate columns, never merged. **Source implemented** means the code exists
in this repository. **Packaged / CI verified** means a named CI gate or the candidate
build checks it. **Device tested** means a physical TV run is recorded for this exact
APK. Only the first two can be true before a device run.

| Claim | Source implemented | Packaged / CI verified | Device tested |
|---|---|---|---|
| Version 2.4.0 / versionCode 2040000 / `v2.4.0` / `s23` metadata | Yes (`release/version.properties`) | `ci.yml` grep checks, `validate_release.py`, release contract tests | NOT RUN |
| Verdict-aware updater check (compatible / incompatible / unknown evidence, manual route + recovery) | Yes (`features/abiEvidence.js`, `features/updater.js`, `features/updateState.js`) | `abi-evidence.test.mjs`, `updates-settings.test.mjs`, `update-state.test.mjs` | NOT RUN |
| Settings categories (Playback, Appearance, Privacy, Navigation) with preserved setting ids | Yes (`ui/settingsRegistry.js`) | `settings-search.test.mjs`, `guide-entry.test.mjs` | NOT RUN |
| YTArk entry in the guide (default on, one per guide load, survives hiding/reordering) | Yes (`ui/customGuideAction.js`) | `guide-entry.test.mjs` | NOT RUN |
| Premium wordmark lifecycle (scoped observers, restored detached hosts, no duplicate mounts) | Yes (`features/premiumBranding.js`) | `premium-branding-lifecycle.test.mjs`, `premium-branding-a11y.test.mjs` | NOT RUN |
| OLED Black theme; custom colours preserved; Premium wordmark composition | Yes (`ui/theme.js`, `ui/appearanceStyles.js`, `ui/themeTokens.js`) | `appearance-theme.test.mjs`; bundle grep | NOT RUN |
| Remove player dimming (scrim only; idle dimming independent) | Yes (`ui/appearanceStyles.js`) | `appearance-theme.test.mjs` | NOT RUN |
| Hide channel watermark (renderer removal, recoverable original, player-scoped DOM net) | Yes (`features/playerWatermark.js`, `features/adblock.js`) | `player-watermark.test.mjs`; bundle grep | NOT RUN |
| Shared settings registry; Search settings; D-pad/IME text entry | Yes (`ui/settingsRegistry.js`, `ui/settings.js`, `ui/settingsSearch.js`, `ui/textEntryOverlay.js`) | `settings-search.test.mjs`, `lifecycle.test.mjs` | NOT RUN |
| Customize YouTube Settings (order/hide/pin, protected entries, restore) | Yes (`features/ytSettingsLayout.js`, `ui/ytSettingsEditor.js`, `ui/customYTSettings.js`) | `yt-settings-layout.test.mjs` | NOT RUN |
| CHANGELOG.md, bundled reader, What's new, changelog-driven release notes | Yes (`tools/build_changelog.py`, `ui/changelogReader.js`, `features/whatsNew.js`, `tools/render_release_notes.sh`) | `build_changelog.py --check`; `test_build_changelog.py`; `changelog-whats-new.test.mjs` | NOT RUN |
| Settings schema migration (fresh vs. upgrade defaults), malformed-value repair | Yes (`config.js`) | `config-migration.test.mjs` | NOT RUN |
| SponsorBlock bounded lookup, strict validation, late-result discard | Yes (`features/settlementDeadline.js`, `sponsorblock*.js`) | `ci.yml` Node tests (28 SponsorBlock tests) | NOT RUN |
| Settings → YTArk Updates card (Installed / Latest / Status / QR fallback / changelog link) | Yes (`features/updater.js`) | Node tests (`updates-settings.test.mjs`, `changelog-whats-new.test.mjs`) | NOT RUN |
| Bundled native updater (Java ABI and release contracts) | Yes (`android-updater/`) | `ci.yml` Java tests; DEX compiled in `build-apk.yml` | NOT RUN |
| `ytark://updates` → native `UpdateActivity` | Manifest intent-filter declared by the repacker; **the card does not trigger it** | `check-apk` (manifest validation) | **NOT RUN — native integration pending** |
| ARMv7-only APK, signer, versionCode, checksums | Yes | `build-apk.yml` candidate build and `publish-release` job verify; public assets re-downloaded | NOT RUN |
| Workflow least privilege (PR read-only, build read-only, publish job alone writes) | Yes | `tools/check_workflow_policy.py` in `ci.yml` | n/a |
| Automatic publication from a successful `main` build; resumable repair | Yes | `tools/publish_release.py`, covered by `tools/tests/test_publish_release.py` | n/a |
| Session preserved over an in-place install; preferences survive | Not a source property | Not a CI property | **NOT RUN** (see `docs/DEVICE-ACCEPTANCE.md`, optional and not a gate) |

## Released-artefact identity (2.1.2, from GitHub API metadata)

| Item | Value | Source |
|---|---|---|
| Android package | `io.github.twoarchiver.ytark` | `README.md`, `docs/SIGNING.md` |
| Release signing certificate SHA-256 | `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae` | `signing/YTArk-cert-sha256.txt` |
| Published 2.1.2 versionCode | `2010200` | release body, `release/version.properties` |
| Published 2.1.2 APK digest | `sha256:ea4fd7accac33138e52d2546843a57cc640e2c2444912927c7f60a33681a280a`, 97352918 bytes | GitHub release asset `digest` |
| Published 2.1.2 `userScript.js` digest | `sha256:b408d31fd60d2800e3b95b07f6fe2a284dfa1dea89851f93f1bc33aba0454fc6`, 702999 bytes | GitHub release asset `digest` |

The APK bytes were **not** downloaded: the GitHub release-asset host
(`release-assets.githubusercontent.com`) is not reachable from this sandbox. The
manifest, signer and native-library contents of the published APK were
therefore **not** inspected here; they are taken from the repository and the
CI gates, and must be checked against the real file before any update claim.
The storage paths below are likewise unverified against the APK.

The locally built `userScript.js` (`npm run build` in `TizenTube/mods`) is
byte-identical to the published 2.1.2 bundle digest above. This is the only
reproducibility result verified for the released artefacts.

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
| 15 | Chapters, previous/next, long press, Shorts toggle | ON | `ui/chapters.js`, `config.js` | — | NOT RUN |
| 16 | Hide watched videos, end-screen cards | OFF | `config.js` | — | NOT RUN |
| 17 | Clock overlay (opt-in) | OFF | `ui/clock.js` | — | NOT RUN |
| 18 | Screen dimming (opt-in) | OFF | `config.js` | — | NOT RUN |
| 19 | Sidebar customisation | per config | `ui/sidebarModification.js` | — | NOT RUN |
| 20 | Experimental user-agent profiles | `native` | `features/userAgentSpoofing.js` | `branding-guest-ua.test.mjs` | NOT RUN |
| 21 | TV controls and quick presets | per preset | `features/tvControls.js`, `ui/settings.js` | `tv-controls.test.mjs` | NOT RUN |
| 22 | YTArk Settings (remote-accessible) | — | `ui/settings.js`, `ui/customYTSettings.js` | `updates-settings.test.mjs` | NOT RUN |
| 23 | About YTArk and support QR codes | — | `ui/settings.js` | — | NOT RUN |
| 24 | YTArk Updates card and native updater | check ON (`enableUpdater`) | `features/updater.js`, `updateState.js`, `android-updater/` | `update-state.test.mjs` (26), `updates-settings.test.mjs` (13), Java contract tests in CI | NOT RUN |
| 25 | Translations (32 locales, YTArk wording; new 2.3 strings in English with i18next fallback) | — | `translations/resources/*.json`, `translations/text.js` | — | NOT RUN |
| 26 | OLED Black theme | OLED for fresh installs, YouTube default after an update | `ui/theme.js`, `ui/appearanceStyles.js`, `ui/themeTokens.js` | `appearance-theme.test.mjs` | NOT RUN |
| 27 | Hide channel watermark | ON for fresh installs, OFF after an update | `features/playerWatermark.js` | `player-watermark.test.mjs` | NOT RUN |
| 28 | Remove player dimming | ON for fresh installs, OFF after an update | `ui/appearanceStyles.js` | `appearance-theme.test.mjs` | NOT RUN |
| 29 | Search settings | — | `ui/settingsSearch.js`, `ui/textEntryOverlay.js`, `ui/settingsRegistry.js` | `settings-search.test.mjs` | NOT RUN |
| 30 | Customize YouTube Settings | stock layout | `features/ytSettingsLayout.js`, `ui/ytSettingsEditor.js` | `yt-settings-layout.test.mjs` | NOT RUN |
| 31 | Changelog reader and What's new card | card once per update | `ui/changelogReader.js`, `features/whatsNew.js`, `CHANGELOG.md` | `changelog-whats-new.test.mjs`, `test_build_changelog.py` | NOT RUN |
| 32 | Section resets with scoped confirmation | — | `ui/settings.js` | `settings-search.test.mjs` | NOT RUN |

## Storage, preferences and data

| Item | Current behaviour | Verified |
|---|---|---|
| Userscript configuration | `localStorage` key `ytaf-configuration`; missing keys are filled from defaults, stored user choices are kept | source (`config.js`) |
| Google / Cobalt account storage | Cobalt's app data directory, unchanged by YTArk | not verified against the APK |
| Pending update metadata and partial downloads | app-private storage, matched to release metadata before reuse | source (`YtarkUpdater.java`) |

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

| New key | Purpose |
|---|---|
| `uiTheme` | `youtube` or `oled` |
| `hidePlayerWatermark`, `removePlayerScrim` | Appearance → Player toggles |
| `preferredVideoCodec` | Default for the key the player already read (previously missing) |
| `ytSettingsLayout` | YouTube Settings order/hidden sections, pinned/hidden entries (stable ids) |
| `ytSettingsCatalog` | Sections detected on the YouTube Settings page (no account identity) |
| `lastSeenVersion`, `whatsNewVersion`, `whatsNewDismissedVersion` | What's new bookkeeping (version strings only) |
| `configSchemaVersion` | Settings schema marker |

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
