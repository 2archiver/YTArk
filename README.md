# YTArk

YTArk is an independent Android TV / Google TV application based on
[TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt). It keeps the
upstream YouTube TV frontend, its account/sign-in and **Continue as guest**
flows, and the Cobalt player. YTArk adds TV-remote-friendly controls and a
native updater that always hands installation to Android for user confirmation.

## Release identity and candidate APKs

| Item | Value |
|---|---|
| Android package | `io.github.twoarchiver.ytark` |
| Launcher label | `YTArk` |
| Target display version | `2.1.1` (Android versionName `2.1.1`) |
| Target versionCode | `2010100` (above every published YTArk APK) |
| 32-bit userspace candidate | `YTArk-v2.1.1-armv7.apk` — `armeabi-v7a` |
| 64-bit userspace candidate | `YTArk-v2.1.1-arm64.apk` — `arm64-v8a` |
| Immutable userscript revision | `s19` (previous published revision `s18` is never moved) |
| Pinned Android base | TizenTubeCobalt `v2.0.2` |

These filenames identify the intended candidates, not proof that an APK has
been built or installed. **No physical Google TV / Android TV acceptance is
claimed by source-only or CI packaging checks.** Use the official
[YTArk Releases](https://github.com/2archiver/YTArk/releases) page when the
matching draft has been reviewed and published. Releases are meant to stay in
draft until target-device installation, guest access, navigation, playback, and
same-ABI update tests have been recorded.

## Choose the architecture — 4K is not an ABI

**4K does not select an APK architecture.** Resolution, Android version, device
marketing name, and a spoofed YouTube User-Agent do not determine which native
APK can load. A 4K TV may run 32-bit `armeabi-v7a` userspace; some devices that
have a 64-bit-capable CPU still run a 32-bit Android userspace. Choose by the
ABI Android reports, not by the display resolution.

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
available Android userspace ABIs. Select the ARM64 candidate only when
`arm64-v8a` is supported by the installed userspace; otherwise select the
ARMv7 candidate when `armeabi-v7a` is listed. If neither appears, neither APK
is a supported choice. Do not rename an APK to simulate another ABI.

For a YTArk installation, the updater stays on the ABI embedded in the
currently installed APK. It reads that APK's native-library directories and
checks them against Android's supported ABI list. It will not silently turn an
ARMv7 installation into ARM64. Cross-ABI migration has not been validated; use
the same-ABI release unless a migration has been explicitly tested on that
model.

## Remote-friendly installation

1. From the official release page, download **one** versioned APK matching the
   TV's reported ABI. Download `SHA256SUMS.txt` too.
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
| Client-side ad blocking | **On by default**, user-visible toggle in YTArk Quick Controls |
| SponsorBlock segment skipping | **On by default**, category settings preserved |
| DeArrow titles/thumbnails | On by default (title only unless thumbnails enabled) |
| Quality selection | Auto default, manual ceiling; no resolution promises |
| Cosmetic "YouTube Premium" wordmark | **On by default**, off-able local visual only — **never** a subscription or entitlement |
| Settings → YTArk Updates | Real installed version, real stable-release check, release notes, honest errors |
| Native updater | Verified SHA-256 + signer + ABI, manual Android installer |
| ARMv7 (`armeabi-v7a`) APK | Versioned candidate; physical device acceptance pending |
| ARM64 (`arm64-v8a`) APK | Versioned candidate; physical device acceptance pending |
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
  profiles that never stored the key) replaces the header wordmark with a
  locally drawn YouTube-Premium-style lockup: a CSS red play emblem plus the
  wordmark rendered with the frontend's own font and inherited colour, so no
  image, font, SVG document, or network request is needed and light/dark
  contrast follows the theme. Exactly one wordmark is placed in every existing
  logo location; no header bar, duplicate, blank slot, or fullscreen overlay is
  added. The stock artwork is hidden, never removed, and its inline styles are
  restored byte-for-byte when the setting is turned off (or when the frontend
  re-renders the header slot). Focus targets, the search box and the account
  controls keep their roles, `tabindex`, D-pad order and accessible names — the
  wordmark itself is `aria-hidden` and can never take focus.
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
  selection, themes/presets, and the updater. **Ad blocking is enabled for fresh
  installs**, but a saved user opt-out is preserved. Ad filtering is a
  client-side modification, not a guarantee that every ad is removed.
- SponsorBlock uses its online segment service and its own saved setting; it is
  independent of ad blocking and the cosmetic logo.
- Quality defaults to **Auto**. A manual ceiling is limited to quality levels
  supplied by YouTube and recognized by the player; 2160p is not promised unless
  that stream and device actually support it. The settings can report a
  requested selection and the player's reported quality, not guarantee a
  particular resolution or playback stability.
- Native Cobalt User-Agent is the default. Experimental profiles are opt-in,
  bounded to one reload per explicit transition, and have a reset control. A
  User-Agent is never used to choose the APK architecture.

YTArk does **not** claim video downloads, background playback, picture-in-picture,
casting, subscription entitlements, or system-wide ad blocking. Playback,
codecs, captions, 2160p availability, and other upstream features remain subject
to YouTube, Cobalt, the device, and the supplied stream.

### Native updates and release integrity

**Where the updater lives.** Release discovery, download, verification,
progress and the installer hand-off run in the injected native updater and are
shown on the native **YTArk Updates** screen (reachable from YTArk Settings →
YTArk Updates, from the update notification, and from the app's own check
schedule). That screen renders the real state machine: `idle → checking →
current|available|check_error`, `available → downloading → verifying →
ready_to_install`, `ready_to_install → permission_required|awaiting_installer`,
and `awaiting_installer → installed|installation_cancelled|install_error`.
Bytes shown are the bytes actually transferred; when the server sends no
`Content-Length` the progress bar is honestly indeterminate instead of being
filled with an invented percentage.

**What YTArk Settings → YTArk Updates shows.** The settings card reports the
installed version (read from the running app), performs a real read-only check
against the official stable release, shows the available version, download
size, release notes and the timestamp of the last *successful* check, and never
reports a failure as "up to date". The full download/install progress stays on
the native screen, because that is where the transfer actually happens; the
card's **Open YTArk Updates screen** action requests that screen and reports
honestly when the platform refuses the hand-off. This is a deliberate
limitation of the current Cobalt build, described under
[Known limitations](#known-limitations).

**Release rules.** The updater checks the official GitHub stable release **at
app start and every six hours** (clearly disclosed on the update screen; the
**Later** action snoozes notifications for 24 hours; all checks use HTTPS to
`api.github.com`). It ignores draft and prerelease entries, requires the
published release body to confirm the same Android versionCode as the tag, and
selects an APK matching the **installed** native ABI (4K branding is not an
ABI; ARMv7 devices keep their 32-bit path). It validates the exact versioned
filename and official URL, verifies the published SHA-256, package/version
metadata, native library ABI, and pinned signer, and then uses Android's
`PackageInstaller`. The user must choose **Install Update** and approve
Android's confirmation; YTArk never installs silently and does not grant the
unknown-app permission automatically. Cancelling the installer is recoverable —
the verified package stays ready to install without re-downloading. Interrupted
downloads resume only when their saved URL, asset name, ABI, size, and digest
still match. Opening the installer is never reported as a successful install:
the version Android reports afterwards is compared with the running version
first.

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
and SponsorBlock never intercept or redirect them. The full inventory,
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

- Physical Google TV acceptance (install, sign-in, playback, D-pad, same-ABI
  update) is recorded per device; source and CI checks are not hardware tests.
- A server-side Google token invalidation or upstream auth change can require
  re-login after an update; permanent sessions are not guaranteed.
- Ad blocking is client-side and cannot guarantee every ad is removed;
  SponsorBlock depends on community segment data at `sponsor.ajay.app`.
- The cosmetic Premium wordmark never implies a paid subscription or any
  server-side entitlement.
- Cross-ABI migration (ARMv7 ↔ ARM64) is untested; the updater always stays on
  the installed ABI.
- The repacked build cannot register a new JavaScript bridge object (Cobalt
  builds that list in its own `initializeJavaBridge()`), so the settings card
  cannot stream the native download percentage. Live download/verify progress
  and the installer hand-off stay on the native **YTArk Updates** screen; the
  settings card is honest about that instead of faking a progress bar.
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
| `INSTALL_FAILED_NO_MATCHING_ABIS` | The APK's native ABI does not match the TV's Android userspace. Re-check `ro.product.cpu.abilist`, download the corresponding ARMv7 or ARM64 asset, and keep its filename. Resolution is unrelated. |
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

The intended release build downloads the pinned `cobalt-arm.apk` and
`cobalt-arm64.apk` assets from TizenTubeCobalt `v2.0.2`, verifies their GitHub
metadata and native contents, repacks each matching base, and checks the
compiled manifest, DEX/native payloads, alignment, signer, checksums, and draft
release asset contract. Static packaging checks are not ARM hardware or TV
runtime tests. No release should be published until both architectures have
passed the documented target acceptance plan.

Local userscript checks:

```sh
cd TizenTube/mods
npm ci --no-audit --no-fund
node --test tests/*.test.mjs
npm run build
```

Python release/repacker contract tests:

```sh
python3 -m py_compile tools/*.py tools/tests/*.py
python3 -m unittest discover -s tools/tests -v
python3 tools/repack_apk.py --self-test
python3 tools/render_launcher_art.py --check   # branding artifacts match the geometry source
python3 tools/check_no_secrets.py --history    # no key material in tree or history
```

A complete APK build additionally needs Java 17, Android SDK platform/build
tools, Apktool, OpenSSL, GitHub access, and the pinned public community
keystore. Update `release/version.properties` for the next release: it is the
only place that defines `versionName`, `displayVersion`, `versionCode`,
`versionTag` and the immutable userscript `scriptTag` (a new revision is needed
whenever the bundle bytes change; published tags are never moved). The
`versionCode` follows `major * 1_000_000 + minor * 10_000 + patch * 100`, and CI
refuses any candidate that is not above every published installable build.

Release runs are triggered by pushes to `main`, or manually from the Actions
tab. A manual run defaults to **candidate only** (`publish: false`): it builds
and validates both APKs, publishes the immutable userscript tag, and leaves the
release as a **draft** so it can be installed and exercised on a device without
being offered to other users. Promote it by running the workflow again with
`publish: true`, or by merging to `main`. Record the device results in
[`docs/RUNTIME-CHECKLIST.md`](docs/RUNTIME-CHECKLIST.md) before promoting; the
updater ignores drafts and prereleases, so a candidate draft is never offered as
an update.

## Support and upstream attribution

Support YTArk development: [Ko-fi](https://ko-fi.com/2archiver).

YTArk retains attribution to **TizenTubeCobalt** as its Android/Cobalt base and
to **TizenTube** for the GPL-3.0-only userscript. See `TizenTube/LICENSE`,
release `NOTICE.md`, and upstream notices. YTArk is independent and is not
affiliated with YouTube, Google, TizenTube, or TizenTubeCobalt.
