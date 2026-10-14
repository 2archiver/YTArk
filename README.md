# YTArk

YTArk is an independent Android TV / Google TV application based on
[TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt). It keeps the
upstream YouTube TV frontend, its account/sign-in and **Continue as guest**
flows, and the Cobalt player. YTArk adds TV-remote-friendly controls and a
native updater that always hands installation to Android for user confirmation.

## Release identity and 2.9 candidate

| Item | Value |
|---|---|
| Release state | **2.9 candidate; unpublished, not built or device-verified** |
| Android package | `io.github.twoarchiver.ytark` (unchanged; community signing identity retained) |
| Launcher label | `YTArk` |
| Version | `2.9.0` (Android versionName `2.9.0`, planned release title `YTArk 2.9`) |
| versionCode | `2090000` (published 2.8.0 is `2080000`) |
| Planned APK (the only architecture) | `YTArk-v2.9.0-armv7.apk` — `armeabi-v7a`; not built/published from this worktree |
| Userscript revision | `s28` (unused on the remote at review time; published `s27` for 2.8.0 remains immutable) |
| Android base | TizenTubeCobalt `v2.0.2` ARMv7 APK; no Cobalt rebuild |

**YTArk 2.9 is configured as a direct, signed in-place update from the
published 2.8.0 APK.** It keeps the package ID, signing identity and app data
directory; no uninstall/reinstall or data-reset workaround is planned. Source
metadata is not proof that Android accepts a signed candidate APK or preserves a
real user's session, so upgrade continuity remains unverified.

The published 2.8.0 release introduced the storage, opt-in playback-recovery and
hourly update features described below; 2.9.0 retains them and adds updater
recovery hardening, screen-route/theme contracts and settings fixes. It does not
upgrade the TizenTubeCobalt `v2.0.2` base, Cobalt engine or YouTube frontend.

- **Remote-friendly Cache & Storage.** The native screen reports measurable
  Android app-cache cleanup; work runs off the UI thread, conservatively retains
  recent or unstatable files and coordinates deletion with downloads and
  installer hand-off. It touches only dedicated Android cache roots—not profile
  or local-storage directories, cookies, tokens, preferences, databases, watch
  position or account state. It never selects updater downloads or installer-held
  APKs. Pause playback first; Android file-cache handles are not enumerated, so
  freeing a pathname is not a promise that every byte is immediately reclaimed.
- **Opt-in playback recovery.** A setting defaults off. When enabled, the
  recovery controller uses supported player state and bounded attempts, keeps
  saved VOD/DVR positions within seekable ranges and preserves live-edge intent
  where exposed. Intentional pause/seek, navigation, PiP/hidden playback,
  completion and offline state stop retries. Player text that identifies
  sign-in/age/region restrictions also stops retries; unclassified errors are
  bounded to three attempts.
- **Persistent hourly update checks and optional automatic downloads.** Android
  JobScheduler requests network-connected stable-release checks. Checks and
  downloads are independently switchable; the explicit off choice is retained.
  Downloads can resume and are checked against release compatibility, package,
  signer, version and APK metadata before Android's installer is offered.
  Permission screens open only after explicit action, Android confirmation is
  never bypassed, and installer hand-off is not reported as completed install.
- **2.9 updater/settings work.** Redirect hops and partial-resume metadata are
  validated; cleanup protects pending and resumable APKs; installer return is
  reconciled against the installed package version. The userscript now emits
  screen-only `ytark://updates` and `ytark://storage` routes with an optional
  theme value; exported routes require a signature-level permission and native
  screens validate their exact screen URI. This is only a source/manifest
  contract. The pinned Cobalt v2.0.2 base has no external-protocol handler, so
  an in-page `ytark://` navigation is cancelled silently: the reachable route is
  the TV apps row (YTArk Updates, whose Cache & Storage button opens the storage
  screen). The Settings Updates card remains read-only (no JS updater bridge is
  registered).

The userscript schema 4 migration for the playback-recovery opt-in was part of
2.8.0. 2.9.0 does not reset or rewrite existing preferences; absent configuration
remains a default-only case. See [`CHANGELOG.md`](CHANGELOG.md) for published
history and current candidate notes.

**What 2.5 changed** (kept for reference). It was a settings cleanup and UX repair
release on the same base. It kept the package, the signing certificate, the
YouTube TV frontend, the 2.4 verdict-aware updater and the 2.3 appearance features,
and it repaired what was broken or misleading in 2.4:

- **About YTArk reports the real installed version.** `GetVersion()` is an
  asynchronous bridge call on the pinned base, so the synchronous read in 2.4
  produced nothing and every build said "Version unknown".
  `features/appVersion.js` now accepts a callback, a returned Promise or a
  synchronous string, retries on a bounded schedule while the bridge binds, and
  falls back to packaging metadata embedded at build time
  (`assets/buildInfo.generated.js`, generated from `release/version.properties`
  by `tools/build_buildinfo.py`). About shows **YTArk version**, **YouTube
  version** (only when the running frontend publishes one) and **Build details**
  as separate fields; the update comparison and the architecture evidence keep
  using package metadata only. Nothing reads the latest GitHub release and no
  version label is hardcoded.
- **The YTArk Settings entry opens only when you select it.** Focusing, hovering
  or scrolling past the sidebar entry highlights it and does nothing else; an
  explicit OK/Enter, click or equivalent arms a single-use activation
  (`ui/guideEntryActivation.js`) that the entry's own action then consumes. No
  key is prevented or swallowed, so unrelated remote input reaches the frontend
  untouched. The entry sits **last** in the sidebar, below every YouTube entry,
  and Back returns to the previous sidebar position with focus on the row used.
- **OLED Black actually paints.** Nothing re-applied the managed stylesheet once
  the TV DOM existed in 2.4, the overlay surfaces YTArk's own panels render into
  were not covered, and the near-black default left little visible difference.
  The theme now paints true black on the app root, browsing and search surfaces,
  the sidebar container and the overlay/dialog surfaces, keeps the focused
  sidebar entry visibly raised, is re-applied by a startup step, and a narrowly
  scoped head observer (bounded to five restorations) restores the stylesheet if
  the frontend drops it. Video, thumbnails, artwork, captions and the player
  scrim are never targeted.
- **One control per behaviour.** YTArk Settings is grouped into Playback,
  Appearance, Privacy, Navigation, YTArk Updates, About YTArk and Support, and
  the "YTArk Quick Controls" menu is dissolved: nine of its eleven rows
  duplicated rows that already existed elsewhere, and the two that did not moved
  to the category that describes them (Premium logo → Appearance, Hide end-screen
  cards → Appearance › Player). The root menu states whose settings these are,
  and YouTube's own Settings page keeps its rows.
- **Removed controls, with a one-shot migration**: the experimental **User-Agent
  profile** (YTArk uses the platform's own Cobalt user agent and never applies a
  substitute string), **Presets / Undo Last Preset / Quick Quality**, and
  **Fix UI**. Settings an applied preset had already changed stay exactly as the
  user left them; only the retired preference keys are deleted, once
  (`configSchemaVersion` 3), and their previous values are reported through
  `getConfigMeta().retiredValues`.

**Defaults and migration.** Fresh installations start with OLED Black, Hide
channel watermark and Remove player dimming on (as in 2.3), and with the YTArk
entry in the guide on. Updated installations keep every retained preference:
the appearance options stay as chosen, and the settings schema marker moves to
`configSchemaVersion` 3, which deletes the six retired keys
(`userAgentProfile`, `enableFixedUI`, `tvActivePreset`, `tvLastPresetSnapshot`,
`tvQuickQuality`, `videoPreferredCodec`) exactly once. No other YTArk preference
is reset. Google account data, cookies and other preferences are never touched.

### Capability status

Each claim is recorded in one of three separate columns. A later column does not
imply the earlier ones are complete.

| Capability | Source implemented | Packaged / CI verified | Device tested |
|---|---|---|---|
| Installed-version resolution (About / Updates, generated build metadata) | Yes (`features/appVersion.js`, `assets/buildInfo.generated.js`, `tools/build_buildinfo.py`) | Node tests (`app-version.test.mjs`); `build_buildinfo.py --check` in `ci.yml` and `build-apk.yml` | NOT RUN |
| Explicit activation of the YTArk guide entry (no open on focus or scroll) | Yes (`ui/guideEntryActivation.js`, `ui/customGuideAction.js`, `resolveCommand.js`) | Node tests (`guide-entry-activation.test.mjs`) | NOT RUN |
| Removal of User-Agent profile, presets and Fix UI with a one-shot migration | Yes (`config.js`, `features/userAgentRetirement.js`) | Node tests (`settings-cleanup.test.mjs`, `config-migration.test.mjs`); retired-symbol and bundle greps in `ci.yml` | NOT RUN |
| OLED Black theme (managed stylesheet, root class, custom colours preserved) | Yes (`ui/theme.js`, `ui/appearanceStyles.js`, `ui/themeTokens.js`) | Node tests (`appearance-theme.test.mjs`); bundle grep in `ci.yml` | NOT RUN |
| Hide channel watermark (renderer removal + player-scoped DOM safety net) | Yes (`features/playerWatermark.js`) | Node tests (`player-watermark.test.mjs`) | NOT RUN — the current TV frontend may not draw the watermark at all |
| Remove player dimming (scrim only, independent of idle dimming) | Yes (`ui/appearanceStyles.js`) | Node tests (`appearance-theme.test.mjs`) | NOT RUN |
| Search settings (shared registry, local search, D-pad + IME text entry) | Yes (`ui/settingsRegistry.js`, `ui/settingsSearch.js`, `ui/textEntryOverlay.js`) | Node tests (`settings-search.test.mjs`) | NOT RUN |
| Customize YouTube Settings (order, hide, pin, protected entries, restore) | Yes (`features/ytSettingsLayout.js`, `ui/ytSettingsEditor.js`, `ui/customYTSettings.js`) | Node tests (`yt-settings-layout.test.mjs`) | NOT RUN |
| Changelog reader, What's new card, changelog-driven release notes | Yes (`CHANGELOG.md`, `tools/build_changelog.py`, `ui/changelogReader.js`, `features/whatsNew.js`) | `build_changelog.py --check`, Python + Node tests | NOT RUN |
| Settings schema migration and malformed-value repair | Yes (`config.js`) | Node tests (`config-migration.test.mjs`) | NOT RUN |
| SponsorBlock bounded lookup, strict validation, late-result discard | Yes (`TizenTube/mods/features/sponsorblock*.js`) | Node tests in `ci.yml` | NOT RUN |
| Settings → YTArk Updates card (installed / latest / status / QR fallback) | Yes (`features/updater.js`) | Node suite passed; userscript build passed | NOT RUN |
| Remote-friendly Cache & Storage (cache roots only, off-main-thread, recent/unknown-age files protected) | Yes (`android-updater/.../StorageActivity.java`, `YtarkUpdater.java`) | Python manifest/source contracts included in the passing suite; Java was not compiled; no Android compile or cache runtime run | NOT RUN |
| Opt-in playback recovery (supported player state, bounded retries, VOD/live intent, access/pause/navigation guards) | Yes (`features/playbackRecovery.js`, `config.js`) | Node recovery tests passed; userscript build and bundle syntax check passed | NOT RUN |
| Persistent hourly update checks and separate automatic downloads | Yes (`UpdateCheckJobService.java`, `UpdateBootstrapProvider.java`, `YtarkUpdater.java`, `UpdateActivity.java`) | Python tests passed; Java compiler/DEX build and JobScheduler runtime are unavailable here | NOT RUN |
| Startup-animation availability | Informational row only; no optional YTArk animation/delay hook exists | Settings regression test passed; no toggle or system-splash claim | n/a |
| Bundled native updater (Java: ABI check, verified download, PackageInstaller hand-off) | Yes (`android-updater/`) | Host-JRE contracts are wired into CI/build scripts but were not run here; no Android compile or DEX packaging | **NOT RUN** — no APK or device install/in-place update recorded |
| `ytark://updates` / `ytark://storage` → native Updates / Cache & Storage screens | Exact screen routes are declared and URI-validated; exported routes require the app-signature permission; no new JS bridge is registered | Python URL/manifest tests only; the pinned base cannot dispatch the scheme in-page (no external-protocol handler), so the TV-apps-row launcher route is the reachable path; Android APK validation and on-device navigation not run | **NOT RUN — native navigation pending** |
| ARMv7-only APK, signer, versionCode, checksums | Yes (`tools/`) | Candidate build and `check-apk` in `build-apk.yml` | NOT RUN |
| Premium header wordmark (cosmetic) | Yes (bundled vector) | Provenance, vector-only and build checks in `ci.yml` | NOT RUN |
| Ad blocking, sign-in, playback, remote keys | Upstream v2.0.2, kept stock | Not re-tested by CI | NOT RUN |
| Direct 2.8.0 → 2.9.0 in-place update; session/preferences preserved | Same package, signer, versionCode progression and app-data directory are configured | Static release-contract checks only; signed APK upgrade not run here | **NOT RUN** — see `docs/DEVICE-ACCEPTANCE.md` |

The full version history is in [`CHANGELOG.md`](CHANGELOG.md) (also readable in
the app: YTArk Settings → Changelog). The release checklist and the feature
inventory are in [`docs/FEATURE-INVENTORY.md`](docs/FEATURE-INVENTORY.md). The earlier 3.0 feasibility
note is kept as a dated snapshot: [`docs/YTARK-3.0-FEASIBILITY.md`](docs/YTARK-3.0-FEASIBILITY.md).

From 2.1.2 onwards YTArk **builds, signs, verifies and publishes exactly one
architecture**: 32-bit ARM `armeabi-v7a`. The ARM64 job, its upstream download
and its release asset were removed from the pipeline; historical releases keep
their published assets, and a `*-arm64.apk` file is no longer produced, offered
or documented as an installable choice.

These filenames identify the intended release asset, not proof that an APK has
been installed. **No physical Google TV / Android TV acceptance is claimed by
source-only or CI packaging checks.** Use the official
[YTArk Releases](https://github.com/2archiver/YTArk/releases) page. An Actions
artefact is not a public release: publication is what makes an APK downloadable,
and only the release page counts as published.

## Check the ABI first — 4K is not an ABI

**4K does not select an APK architecture.** Resolution, Android version, device
marketing name and a 64-bit CPU do not determine
which native code the Android userspace can load. A 4K TV may run 32-bit
`armeabi-v7a` userspace, and devices with a 64-bit-capable CPU still frequently
run a 32-bit Android userspace. The published release is ARMv7-only, so the
device must report `armeabi-v7a` in its own ABI list.

On the TV, open **Settings → About** to note the exact model and Android / Google
TV version. If ADB is available from a computer on the same network, collect:

```sh
adb connect TV_IP_ADDRESS:5555        # use the TV's shown wireless-debugging port if different
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell getprop ro.product.cpu.abi
adb shell getprop ro.product.cpu.abilist
adb shell getprop ro.product.cpu.abilist32
adb shell getprop ro.product.cpu.abilist64
```

On newer Android versions, enable **Developer options → Wireless debugging**
and pair/connect using the address and port shown on the TV. `ro.product.cpu.abilist`
(or the equivalent ABI list from a device diagnostic tool) describes the
available Android userspace ABIs. Install this release when `armeabi-v7a` is
listed. **When the list contains only 64-bit ABIs such as `arm64-v8a`, this
ARMv7-only release is not installable on that device** — a 64-bit CPU does not by
itself mean the userspace runs 32-bit native code. Do not rename an APK, strip
its `lib/` directory, or install an asset from another source to work around
that check; Android would still reject the package, or the app would fail at
Cobalt start-up.

For a YTArk installation, the updater stays on the ABI embedded in the
currently installed APK. It reads that APK's native-library directories, checks
them against Android's supported ABI list before any download, and refuses a
release whose native ABI differs. Installations that were updated from the old
dual-ABI line and still report `arm64-v8a` receive an explicit "cross-ABI update
not supported" message instead of an ARMv7 download they could not install.
ARM64 installations from 2.1.1 and earlier keep working as installed; they are
simply not an update target any more.

## Remote-friendly installation

1. From the official [release page](https://github.com/2archiver/YTArk/releases), download the versioned ARMv7 APK for the release you intend to install and `SHA256SUMS.txt`. The planned 2.9.0 asset is `YTArk-v2.9.0-armv7.apk`; it is not available until a stable release is published. A 2.8.0 installation is the supported direct in-place upgrade base for this candidate.
2. Verify the selected file on the computer, for example:

   ```sh
   sha256sum -c SHA256SUMS.txt
   ```

   Keep the APK filename unchanged; the checksum file names each versioned
   asset.
3. Copy it to the TV using USB or a trusted local-network transfer tool. Open
   the file with a TV-compatible file manager and navigate with the remote.
4. When Android requests permission, choose **Settings** and manually allow
   that file manager to **Install unknown apps**. Return to the installer and
   confirm **Install**. YTArk does not grant this permission automatically.
5. Launch **YTArk** from the TV launcher. The native YouTube TV interface should
   remain the main app; the first-run Google account flow and **Continue as
   guest** action belong to the upstream frontend. YTArk does not ask for or
   collect Google credentials.

For subsequent releases, use YTArk's update screen or install a newer
same-package, same-certificate build over the current one. Android's
PackageInstaller confirmation is always manual. Do not uninstall to troubleshoot
an update unless you understand that uninstalling can erase app data.

## Feature matrix

| Feature | Status |
|---|---|
| YouTube TV frontend (feeds, search, playback) | Upstream Cobalt `v2.0.2`, kept stock |
| Google sign-in / Continue as guest | Upstream flows, preserved; not modified by YTArk |
| Client-side ad blocking | **On by default**, user-visible toggle in YTArk Settings → Privacy |
| SponsorBlock segment skipping | **On by default**, category settings preserved |
| DeArrow titles/thumbnails | On by default (title only unless thumbnails enabled) |
| Quality selection | Auto default, manual ceiling; no resolution promises |
| Cosmetic "YT Premium" header wordmark | **On by default**, bundled 2024 vector artwork, off-able local visual only — **never** a subscription or entitlement |
| OLED Black theme | **Default for fresh installs**; existing installs keep their look until chosen. Device NOT RUN |
| Hide channel watermark / Remove player dimming | **On for fresh installs**, off after an update until chosen; independent toggles under Appearance → Player. Device NOT RUN |
| Search settings | Every YTArk setting, local only; D-pad keyboard, suggestions and the TV keyboard. Device NOT RUN |
| Customize YouTube Settings | Order/hide sections, pin/hide entries by stable ids; protected entries; scoped restore. Device NOT RUN |
| Cache & Storage | Remote-friendly Android app-cache measurement/cleanup and separate obsolete-updater-file cleanup; scoped, off the UI thread, recent files retained. **Device NOT RUN** |
| Playback recovery | Opt-in (default off), bounded recovery for eligible player errors/buffering with supported VOD/DVR/live position. **Device NOT RUN** |
| Startup animation preference | Informational only: this build has no optional YTArk animation or delay hook. |
| Changelog and What's new | Bundled history (offline) inside YTArk Updates; the 2.8 entry is an unpublished candidate. Device NOT RUN |
| Settings → YTArk Updates | Installed version, stable-release state, official-page fallback, changelog, and native update route. Device NOT RUN |
| Native updater | Persistent best-effort hourly JobScheduler checks; separate automatic check/download controls; validated resumable download and explicit Android installer hand-off. Candidate host/device tests not run in this worktree. **Device NOT RUN** |
| ARMv7 (`armeabi-v7a`) APK | **The only published architecture** from 2.1.2; 2.9.0 is an unpublished candidate, and device acceptance stays NOT RUN until recorded |
| 64-bit-only Android userspace (`arm64-v8a` only) | **Not supported** by this release line; documented exclusion, no ARM64 asset |
| Background playback, PiP, casting, downloads, system-wide ad blocking | **Not claimed** |

## What YTArk changes

### YouTube TV frontend, accounts, and guest access

The repacker retains the original Cobalt MAIN activity and its YouTube TV
frontend rather than replacing it with a phone-style WebView. Ad filtering does
not remove feed nudges or alert/action renderers because the stock sign-in and
**Continue as guest** actions can use those renderers. The old "Who's watching"
preference is constrained so it does not postpone the guest account selector.
These are source-level safeguards; guest navigation still needs to be exercised
on a real TV before release acceptance.

### Cosmetic branding and TV controls

- The **Premium logo (cosmetic)** setting (on by default, including for existing
  profiles that never stored the key) replaces the header wordmark with the
  **real 2024 YouTube Premium vector lockup**, bundled inside the userscript:
  the original 101×20 `viewBox`, the red play emblem, its white triangle and all
  seven lettering paths are used as path geometry, byte-for-byte. Nothing is
  retyped, no font is substituted, and no raster preview is used — the previous
  release drew the words with the frontend font, and that approximation is gone.
  Provenance, retrieval date, the Commons revision SHA-1 and the bundled SHA-256
  live in `TizenTube/mods/assets/youtube-premium-logo-2024.provenance.json`; the
  geometry is regenerated and re-verified on every CI run by
  `tools/fetch_premium_logo.py --verify-only` and `tools/build_logo_asset.py
  --check`. **The logo is never fetched at runtime**: no device requests
  Wikimedia or any other external image host, and the mark carries no
  `<image>`, `<text>`, external `href` or font reference.
- **Dark and light headers.** The emblem keeps its literal source paint in every
  theme (the red stays red, the triangle stays white) while the lettering takes
  the native header foreground: white / near-white lettering on the dark header,
  the native dark lettering on the light header. The colour is resolved from the
  header's own computed style first — so an app-level theme override wins — and
  only then falls back to a theme marker, `prefers-color-scheme`, and finally the
  dark token. There is no filter or inversion of the artwork, the background
  stays transparent, and the same `viewBox` scales as vector geometry at 720p,
  1080p and 4K.
- Exactly one wordmark is placed in every existing logo location; no header bar,
  duplicate, blank slot, or fullscreen overlay is added. The stock artwork is
  hidden, never removed, and its inline styles are restored byte-for-byte when
  the setting is turned off (or when the frontend re-renders the header slot).
  Focus targets, the search box and the account controls keep their roles,
  `tabindex`, D-pad order and accessible names — the wordmark itself is
  `aria-hidden`, `role="presentation"` and can never take focus.
- **What this is not:** cosmetic branding only. YTArk does not grant, imply, or
  activate a paid YouTube subscription or entitlement, it never touches billing
  or account state, and the toggle is independent of ad blocking and
  SponsorBlock. Because the frontend wordmark lives in the standard header
  location, this is the only place it is shown; YTArk adds no recurring playback
  warnings about it.
- The Android TV launcher label is `YTArk`. Its **Alternative 2** icon is a
  light rounded-square tile with a red video play emblem and a red orbital
  swoosh (master artwork and rights notes in `branding/`). The build checks the
  compiled launcher and Leanback entry.
- Remote-accessible settings expose ad-block and SponsorBlock toggles, quality
  selection, themes, and the updater. **Ad blocking is enabled for fresh
  installs**, but a saved user opt-out is preserved. Ad filtering is a
  client-side modification, not a guarantee that every ad is removed.
- SponsorBlock uses its online segment service and its own saved setting; it is
  independent of ad blocking and the cosmetic logo.
- Quality defaults to **Auto**. A manual ceiling is limited to quality levels
  supplied by YouTube and recognized by the player; 2160p is not promised unless
  that stream and device actually support it. The settings can report a
  requested selection and the player's reported quality, not guarantee a
  particular resolution or playback stability.
- The **native Cobalt User-Agent is the only one used**. The experimental
  user-agent profiles were removed in 2.5: YTArk never builds or applies a
  substitute string, and an installation that had chosen a profile is handed
  back the platform user agent once (`features/userAgentRetirement.js`). A
  User-Agent is never used to choose the APK architecture.

YTArk does **not** claim video downloads, background playback, picture-in-picture,
casting, subscription entitlements, or system-wide ad blocking. Playback,
codecs, captions, 2160p availability, and other upstream features remain subject
to YouTube, Cobalt, the device, and the supplied stream.

### Native updates and release integrity

**Screens and state.** The native **YTArk Updates** Activity is reachable from
the TV launcher and the `ytark://updates` route. `ytark://storage` opens the
remote-friendly **YTArk Cache & Storage** screen. No JavaScript bridge capability
is assumed: progress, permission and installer states are rendered natively.
The updater persists stable-release selection, last-check/retry times, partial
download metadata, cancellation, verification, pending-install data and the
installer hand-off state. After restart it reconciles interrupted work rather
than claiming that an installer launch installed the APK.

**Automatic schedule.** Android JobScheduler requests one network-connected
periodic check per hour, with persisted scheduling, retry/backoff and server
rate-limit delays. Android can defer this best-effort work. There is no exact
alarm and no always-running polling service. Automatic checks and automatic
downloads have separate settings; both default on for the new preference, and
explicit opt-outs are preserved. Disabling downloads stops an active automatic
download while keeping its matching partial bytes. An explicit cancellation
suppresses only that release until the user resumes it or re-enables automatic
downloads. Manual check/download controls remain available.

**Validation and installation.** Release discovery is restricted to published
stable YTArk GitHub releases and compatible versioned assets for the actual
installed ABI. The updater checks release metadata, trusted download URL/redirect,
asset identity and digest, then validates the downloaded APK's package, version,
signer and native ABI before marking it ready. Resumable bytes are reused only
when their persisted release/asset metadata still matches. Android's unknown-app
permission is checked live and its settings page opens only after the user
selects the install action. Android's PackageInstaller performs the confirmation;
YTArk cannot bypass it. Installer hand-off is not success: a later package-version
read reconciles whether the update actually installed. Update APKs are held in a
separate app-private directory; the cache screen excludes that directory, the
selected resumable download and any pending/installer-held file.

The release certificate is Hearth's intentionally public **community** key.
Its SHA-256 fingerprint is pinned in `signing/YTArk-cert-sha256.txt`. A matching
certificate means Android signer continuity and install compatibility; it does
**not** prove publisher identity because the public keystore is available to
others. Install only from the official YTArk repository and independently verify
both APK checksum entries. The exact userscript bundle is included in release
assets and is served from an immutable version tag; checking CDN bytes proves
that those bytes were served, not that a particular TV fetched or executed the
script.

## Privacy and your Google account

**Your Google account data stays between your TV and Google.** YTArk adds no
analytics, no telemetry, no crash reporting, and no project-operated servers;
it never reads, stores, or logs Google account identifiers, cookies, or OAuth
tokens. External services contacted by YTArk-added code are limited to
SponsorBlock/DeArrow (`sponsor.ajay.app` — video ID hash prefixes only),
GitHub (update metadata and APK downloads), and jsDelivr (userscript bytes).
Google sign-in, token refresh, playback, subscriptions, and search use the
stock upstream YouTube TV stack over its normal Google endpoints — ad blocking
and SponsorBlock never intercept or redirect them. Settings search runs
entirely on the TV, and the YouTube Settings layout stores only stable section and
entry ids (never account names or e-mail addresses). The full inventory,
storage details, and honest limitations (this is **not** anonymity and it does
**not** block Google's own tracking) are in [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Release signing and update integrity

Releases are signed with Hearth's intentionally public **community** key so
Android keeps accepting in-place upgrades with the same certificate
(`b9cb7e…47eaae`). Because that key is public by design, a matching
certificate proves *Android signer continuity*, **not** publisher identity —
always install from this repository and verify `SHA256SUMS.txt`. The recorded
signing identity, exposure analysis, and the explicit key-migration plan are in
[`docs/SIGNING.md`](docs/SIGNING.md). No keystore, private key, or credential
is ever committed here; CI scans the tree and full history for secret material.

## Known limitations

- **Channel watermark:** current YouTube TV frontends may not draw the branding
  watermark at all; then "Hide channel watermark" has nothing to remove.
  Watermarks burned into the video picture cannot be removed.
- **OLED Black** covers the surfaces this build can select by class name: the app
  root (`html`, `body`, `#container`), browse and search surfaces, the sidebar /
  guide container, the account selector, and the side-sheet and overlay dialogs
  the frontend renders panels into — plus YouTube's own background variables. A
  surface whose class this build does not render keeps YouTube's colour until
  supported; the visual check on a device is NOT RUN. It is a visual mode and can
  only save power on emissive (OLED) panels.
- **YouTube Settings customization** applies the next time the page loads from
  YouTube and only to sections/entries with a stable section id, entry id or
  client setting; protected account, sign-in, About, Help and YTArk entries can't
  be hidden.
- **Settings search typing** uses the TV's input method when it appears; the
  built-in D-pad keyboard covers Latin letters and digits.
- Physical Google TV acceptance (install, sign-in, playback, D-pad, same-ABI
  update) is recorded per device; source and CI checks are not hardware tests.
- A server-side Google token invalidation or upstream auth change can require
  re-login after an update; permanent sessions are not guaranteed.
- Ad blocking is client-side and cannot guarantee every ad is removed;
  SponsorBlock depends on community segment data at `sponsor.ajay.app`.
- The cosmetic Premium wordmark never implies a paid subscription or any
  server-side entitlement.
- Only ARMv7 (`armeabi-v7a`) is published from 2.1.2. Devices whose Android
  userspace reports no `armeabi-v7a` (for example 64-bit-only images) cannot
  install these releases, and the updater says so instead of downloading an APK
  that would fail. Installations that still carry `arm64-v8a` native code from
  the dual-ABI era are not update targets; cross-ABI migration is untested and
  the updater always stays on the installed ABI.
- The vector header wordmark is verified as bundled geometry (hash, path data,
  paint classification, no external reference) in CI; dark/light header
  screenshots at 1080p and 4K on a physical TV, and the exact theme tokens of a
  specific TV model, are recorded per device in the runtime checklist rather
  than asserted here.
- The repacked build cannot register a new JavaScript bridge object (Cobalt
  builds that list in its own `initializeJavaBridge()`), so the settings card
  cannot stream the native download percentage. Live download/verify progress
  and the installer hand-off stay on the native **YTArk Updates** screen; the
  settings card is honest about that instead of faking a progress bar.
- The updater shares several design rules with Hearth (canonical release
  endpoint, numeric versionCode, integrity metadata, same-ABI asset, installer
  confirmation). **This is not Hearth feature parity.** The source comparison
  and deliberate differences are in
  [`docs/UPDATES-PARITY.md`](docs/UPDATES-PARITY.md).
- The physical-device acceptance run (install, launch, guest/sign-in, playback,
  D-pad, toggling the cosmetic logo in both themes, same-ABI in-place update) is
  recorded per device in the release notes. Until it is recorded for a build,
  that build stays a candidate and the checklist is marked **NOT RUN**.

## Troubleshooting

Diagnose an **install error** separately from a launch, guest-flow, or playback
problem. Capture the complete Android error and the model / Android API / ABI
information above before retrying.

| Symptom | What to check |
|---|---|
| `INSTALL_FAILED_NO_MATCHING_ABIS` | The APK's native ABI does not match the TV's Android userspace. Re-check `ro.product.cpu.abilist`: this release needs `armeabi-v7a`. Keep the official filename — renaming or stripping `lib/` does not change which native code Android can load. Resolution is unrelated. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` or signature conflict | Android has an installed package with a different signer. YTArk uses the pinned public Hearth community certificate; verify that the asset is from the official release. Do not uninstall until app-data loss is acceptable. |
| Version downgrade | Compare the installed versionCode with the release metadata and use a newer release. Do not rename the APK or bypass Android's version check. |
| Unknown-app / install blocked prompt | In Android Settings, manually allow the file manager used for the install, then return to the installer. This is distinct from an ABI error. |
| Checksum mismatch, parse error, or damaged download | Delete the incomplete copy, re-download the exact versioned asset and checksum file, and verify again before opening it. |
| Insufficient storage | Free TV storage and retry; do not delete YTArk app data as the first step. |
| APK installs but app will not launch, guest flow is missing, or playback fails | This is a runtime compatibility issue, not proof of a wrong ABI. Record the device model, Android API, ABI, screen/message, and—if available—`adb logcat`. Do not claim the feature is supported until it is reproduced and tested on that device. |
| Update is not offered | Confirm network access to GitHub, stable release availability, installed version, and that the installed APK ABI is still supported. The updater refuses cross-ABI migration and will report when the installed ABI cannot be verified. |

If an update repeatedly fails, retain the existing installation and data while
collecting diagnostics. Never install an APK from a mirror or substitute a
renamed APK from another architecture.

## Build and test

The intended release build downloads the pinned `cobalt-arm.apk` asset from
TizenTubeCobalt `v2.0.2`, verifies its GitHub metadata and native contents,
repacks that single base, and checks the compiled manifest, the single
`armeabi-v7a` `lib/` payload, DEX payloads, alignment, signer, checksums, and the
draft release asset contract. A stray second architecture fails the pipeline
rather than being published. Static packaging checks are not ARM hardware or TV
runtime tests: they prove the package, the signer, the ABI and the bytes, not
behaviour on a TV. [`docs/RUNTIME-CHECKLIST.md`](docs/RUNTIME-CHECKLIST.md)
records the device checks; they are optional and not a publication gate.

Local userscript checks:

```sh
cd TizenTube/mods
npm ci --no-audit --no-fund
node --test tests/*.test.mjs
npm run build
```

Changelog: edit [`CHANGELOG.md`](CHANGELOG.md) only, then regenerate the bundled
reader data (CI fails when it is stale). The same file feeds the "What changed"
section of the release notes:

```sh
python3 tools/build_changelog.py --write       # regenerate TizenTube/mods/assets/changelog.generated.js
python3 tools/build_changelog.py --check       # what CI runs
python3 tools/build_changelog.py release-notes --version 2.9.0
```

Build metadata: About YTArk and the Updates card report the installed package
version, and fall back to metadata embedded in the bundle (labelled as such)
when the platform has not answered. That metadata is generated, never
hand-written, and CI fails when it is stale:

```sh
python3 tools/build_buildinfo.py --write       # regenerate TizenTube/mods/assets/buildInfo.generated.js
python3 tools/build_buildinfo.py --check       # what CI runs
python3 tools/build_buildinfo.py json          # the metadata itself
```

Python release/repacker contract tests:

```sh
python3 -m py_compile tools/*.py tools/tests/*.py
python3 -m unittest discover -s tools/tests -v
python3 tools/repack_apk.py --self-test
python3 tools/render_launcher_art.py --check   # branding artifacts match the geometry source
python3 tools/check_no_secrets.py --history    # no key material in tree or history
python3 tools/fetch_premium_logo.py --verify-only --out-dir TizenTube/mods/assets
python3 tools/build_logo_asset.py --check      # bundled wordmark matches its verified source
python3 tools/build_changelog.py --check       # bundled changelog matches CHANGELOG.md
python3 tools/build_buildinfo.py --check       # bundled build metadata matches version.properties
```

A complete APK build additionally needs Java 17, Android SDK platform/build
tools, Apktool, OpenSSL, GitHub access, and the pinned public community
keystore. Update `release/version.properties` for the next release: it is the
only place that defines `versionName`, `displayVersion`, `versionCode`,
`versionTag` and the immutable userscript `scriptTag` (a new revision is needed
whenever the bundle bytes change; published tags are never moved), and it feeds
the two generated modules: run `tools/build_buildinfo.py --write` and
`tools/build_changelog.py --write` after a bump and commit both. The
`versionCode` follows `major * 1_000_000 + minor * 10_000 + patch * 100`, and CI
refuses any candidate that is not above every published installable build.

**Workflows (automatic publication; least privilege).**

- `ci.yml` runs on pull requests and pushes. It is read-only, has no secrets, and
  creates no tags or releases. It checks the userscript, the tests, the release
  metadata and the workflow policy (`tools/check_workflow_policy.py`).
- `build-apk.yml` runs on push to `main` or manual dispatch. It builds, signs and
  package-checks the ARMv7 candidate APK, uploads it as an Actions artefact, and
  then — in the same run, in a separate job that depends on the build succeeding
  — publishes the immutable `s27` userscript tag and the stable GitHub release
  from those exact bytes. Only that publish job holds `contents: write`; the build
  job stays read-only and is the only job that sees the signing key.
- `publish-release.yml` is the manual recovery path. It takes
  `candidate_run_id`, `expected_head_sha` and an optional `device_test_notes`,
  verifies that the named run is a successful `build-apk.yml` run of that commit
  on `main` in this repository, and then publishes, resumes or repairs the release
  for the configured version tag. There is no environment approval gate and no
  mandatory device-acceptance input.

Both paths share the concurrency group `ytark-release-publication` and never
cancel a run mid-upload. The full state machine (absent release, matching draft
resume, complete stable no-op, stable missing APK, conflicting asset, immutable
release) lives in `tools/publish_release.py` and is covered by
`tools/tests/test_publish_release.py`. Details and the one-command recovery
procedure: [`docs/RELEASE-PIPELINE.md`](docs/RELEASE-PIPELINE.md).

**Script delivery dependency.** The APK loads its script from the immutable tag
named in `scriptTag`. The pipeline publishes that tag from the candidate's bytes
before it promotes the release, and refuses to move a tag that already serves
different bytes. Existing tags are never moved: `s21` (2.2.0), `s20` (2.1.2) and
every earlier `sNN` tag stay untouched.

The updater ignores drafts and prereleases, so a staged draft is never offered
as an update. Static packaging checks are not device tests:
[`docs/DEVICE-ACCEPTANCE.md`](docs/DEVICE-ACCEPTANCE.md) is an optional, honest
checklist and is not a gate on publication.

## Support and upstream attribution

Support YTArk development: [Ko-fi](https://ko-fi.com/2archiver).

YTArk retains attribution to **TizenTubeCobalt** as its Android/Cobalt base and
to **TizenTube** for the GPL-3.0-only userscript. See `TizenTube/LICENSE`,
release `NOTICE.md`, and upstream notices. YTArk is independent and is not
affiliated with YouTube, Google, TizenTube, or TizenTubeCobalt.
