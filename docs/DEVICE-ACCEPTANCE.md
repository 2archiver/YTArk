# YTArk device checklist (optional, not a publication gate)

This checklist is **optional** and it is **not a gate on publication**. YTArk
publishes automatically from a successful `main` build
([`docs/RELEASE-PIPELINE.md`](RELEASE-PIPELINE.md)); this document exists so a
device result can be recorded honestly when someone runs one.

CI and packaging checks are **not** device tests. Every item below is **NOT RUN**
until a named device has recorded it. Nothing here is inferred from a previous
release: evidence belongs to the exact APK whose sha256 is written below.

Device: `__________` (model, Google TV / Android TV version, `ro.product.cpu.abilist`)
Installed before: `__________` · Candidate/release: `YTArk-v2.9.0-armv7.apk` (planned; no candidate APK built in this worktree)
APK sha256: `__________` · Signer SHA-256 matches `signing/YTArk-cert-sha256.txt`: [ ]

| # | Check | Result |
|---|---|---|
| 1 | Install the new APK **over the previous version without uninstalling** (same package, same signer) | NOT RUN |
| 2 | Google sign-in or guest flow still works; the account and session survive the update | NOT RUN |
| 3 | Preferences survive (SponsorBlock categories, quality ceiling, Appearance, Privacy, Navigation); none reset | NOT RUN |
| 4 | Browse, search and playback start; captions and quality selection work | NOT RUN |
| 5 | Ad blocking on for a fresh install; saved toggle state kept after the update | NOT RUN |
| 6 | SponsorBlock skips a known segment and does not change the video after a lookup times out | NOT RUN |
| 7 | Remote keys: D-pad focus moves through Settings in order; Back returns | NOT RUN |
| 8 | Settings → YTArk Updates: installed version, latest stable and status are shown; QR and official URL are legible and scan to the release page | NOT RUN |
| 9 | Light and dark themes show the correct Premium wordmark (cosmetic only) | NOT RUN |
| 10 | Select YTArk Settings → Updates → Open updater; the exact `ytark://updates` route reaches `UpdateActivity` in pinned Cobalt, with actionable failure if it does not | NOT RUN |
| 11 | Update from published 2.8.0: effective retained preferences, account/session and YouTube data remain; the 2.9.0 What's new notice appears once and stays dismissed after dismissal | NOT RUN |
| 12 | Fresh install: OLED Black, Hide channel watermark and Remove player dimming are on | NOT RUN |
| 13 | Appearance → Theme: switching OLED Black ⇄ YouTube default works live, survives a restart and brings back saved custom colours | NOT RUN |
| 14 | Appearance → Player: video brightness is the same with controls open and closed when Remove player dimming is on; captions, seek previews and dialogs stay readable | NOT RUN |
| 15 | Search settings: D-pad keyboard and the TV keyboard both type; Back closes the keyboard, then the panel, then returns to YTArk Settings | NOT RUN |
| 16 | Customize YouTube Settings: a moved/hidden section changes the YouTube Settings page; protected sections stay; Restore default layout brings back the stock page | NOT RUN |
| 17 | Changelog: every version scrolls with the D-pad; the installed version is marked; the QR code opens the release page | NOT RUN |
| 18 | Scrolling the sidebar past **YTArk Settings** only highlights it: no panel opens, no key is swallowed, and the entry below/above it still moves focus normally | NOT RUN |
| 19 | An explicit OK/Enter on the entry opens **exactly one** YTArk Settings panel; Back returns to the previous sidebar position with focus on the entry | NOT RUN |
| 20 | The entry is **last** in the sidebar (below every YouTube entry) on a fresh guide load, after a route change, after a guide reload and after toggling Navigation → YTArk entry off/on | NOT RUN |
| 21 | YTArk Settings and YouTube's own Settings are visibly distinguished (labels, grouping, headings); no heading or separator is an empty selectable row | NOT RUN |
| 22 | **User Agent Profile**, **Fix UI**, **Presets** and **Undo Last Preset** are gone from the tree and from settings search; no search result links into a deleted route | NOT RUN |
| 23 | Direct in-place upgrade from a real 2.8.0 install: every retained preference keeps its effective value, Google sign-in/session survives, and no uninstall/reinstall or app-data reset occurs | NOT RUN |
| 24 | OLED Black visibly blacks the supported backgrounds (Home/browse, sidebar, Search, Settings, dialogs) with text and icons readable, focused rows distinct, and no tint on video, thumbnails, artwork or captions | NOT RUN |
| 25 | OLED Black survives route changes, reopening Settings and an app restart; turning it off restores the previous theme including any saved custom colours | NOT RUN |
| 26 | About YTArk shows the **installed** version offline (no network), with YTArk version, YouTube version and Build details on separate lines, and never "Version unknown" on a release build | NOT RUN |
| 27 | Installed and available update versions stay separate: the Updates card's "Installed" value matches About, and a build-metadata fallback is labelled as such | NOT RUN |
| 28 | Repeatedly opening and closing YTArk Settings, its submenus and About creates no duplicate panels, rows or handlers (no growing stack of popups) | NOT RUN |
| 29 | Playback, YouTube's own Settings page and the update check still work after the cleanup | NOT RUN |
| 30 | **YTArk Updates** appears once in the TV apps row (launcher entry) and opens the native updater screen with D-pad focus on the first action | NOT RUN |
| 31 | Updater check against the live official release: a fresh check shows the installed and latest versions; **Up to date** appears only after that successful check and shows its time | NOT RUN |
| 32 | Install Update with the unknown-app permission **off** opens only YTArk's own permission screen; nothing opens on focus or launch; returning with the permission off does not install | NOT RUN |
| 33 | Install Update with the permission **on** opens Android's installer for the verified APK; cancelling keeps the verified update ready without re-downloading | NOT RUN |
| 34 | After a completed installation, the next launch or check reads the installed versionCode and reports the new version; the installer result code alone is never reported as success | NOT RUN |
| 35 | Storage: the download is app-private (no storage permission prompt appears); a too-small free-space case is refused before transfer | NOT RUN |
| 36 | Direct 2.8.0 → 2.9.0 update: install the signed candidate APK over the existing app; verify Android accepts the package/signer/version and preserves sign-in, app data and preferences | NOT RUN |
| 37 | Search settings: selecting Search focuses the real text field and the device's own keyboard appears where the device provides one; typing filters results; Clear empties the field; Back closes the keyboard first, then the panel, and focus returns to the row Search was opened from | NOT RUN |
| 38 | Search settings without a system keyboard: the on-screen key grid types, the panel says the on-screen keys are in use, and nothing pretends a platform keyboard was requested | NOT RUN |
| 39 | About YTArk at 720p, 1080p and 4K with TV display scaling: the header shows "About YTArk" and "YTArk <version>", no row overlaps or clips, Build details / Third-party notices and licences / Version history each open and scroll with the D-pad, and Back returns to About | NOT RUN |
| 40 | YTArk Updates is the only route to the version history: no "What's new" row exists in the top-level YTArk Settings menu or on the YouTube Settings page's YTArk section; the post-update notice points to YTArk Updates | NOT RUN |
| 41 | Changelog: every version row leads with one short line; published 2.8 reads "2.8 — Safer storage, opt-in playback recovery and hourly updates" and the 2.9 candidate is separate; D-pad scrolling and Back work | NOT RUN |
| 42 | Updates route round-trip: the settings action reaches the native Updates activity through the pinned Cobalt runtime; theme and back/focus are correct; failure remains actionable if Cobalt rejects the scheme | NOT RUN |
| 43 | Storage route round-trip: the settings action reaches the native Storage activity only while playback is paused; active playback remains in YouTube; failure remains actionable | NOT RUN |
| 44 | Theme handoff: OLED and YouTube choices both reach native Updates and Storage; switching themes changes the native palette on the next valid route; preference survives activity/process recreation | NOT RUN |
| 45 | OLED at 720p, 1080p and 4K with display scaling: supported browse/settings surfaces are black and readable; focus contrast survives; video, artwork, thumbnails and captions keep their original colors; player scrim remains independently controlled | NOT RUN |

Record the result of each row with the date, the device, the APK sha256 and a link
to the evidence. Do not mark a row passed without that evidence, and do not reuse
evidence from another build or version — a different APK is a different artefact.

Results can be passed to the recovery workflow as the optional
`device_test_notes` input. They are echoed in the job summary, separated from the
static checks, and they never block publication.


## YTArk 2.9 candidate features (physical-TV acceptance; all NOT RUN)

The 2.9 candidate is not built or device-verified in this worktree. Use a signed
`v2.9.0` ARMv7 APK built by the official pipeline; record its exact asset name,
SHA-256, installed-before version and device before attempting these flows. The
2.8.0 behavior below is inherited; test the 2.9.0 APK, not an older release.

| # | Check | Expected | Result |
|---|---|---|---|
| 68 | Cache measurement | Reports measured bytes/files only; work does not block D-pad or UI; unreadable entries are reported and left alone | NOT RUN |
| 69 | Cache-clear boundary | With playback paused and explicit confirmation, only old entries under Android app-cache roots are deleted; login, cookies, profile/local storage, preferences, databases, watch history, active downloads, selected partial APK, pending installer APK and files outside the cache roots remain untouched | NOT RUN |
| 70 | Recent/unknown-age cache files | Files modified within 15 minutes and entries with an unknown modification time are retained and counted honestly | NOT RUN |
| 71 | Cache handles and reclaimed bytes | UI reports deleted files/bytes and the post-cleanup measured cache; it does not claim Android has dropped file-cache handles or reclaimed the same amount immediately | NOT RUN |
| 72 | Obsolete updater-file cleanup while download/install/handoff is active | Cleanup is refused and reports protection; no active download, installer-held or pending APK is removed | NOT RUN |
| 73 | Obsolete updater-file cleanup when idle | Only obsolete updater-owned files are removed; selected resumable release and pending verified installer APK are retained; measured count/bytes match the operation | NOT RUN |
| 74 | Playback recovery default and opt-in | A new installation defaults off; enabling it persists across restart; an existing explicit value is retained | NOT RUN |
| 75 | VOD recovery position | After a recoverable media error or sustained stall, bounded recovery returns to a supported saved seekable VOD position; no unsupported seek is attempted | NOT RUN |
| 76 | Live/DVR recovery | DVR position is restored only when it lies within the seekable range; live-edge intent remains at the live edge where the player exposes it | NOT RUN |
| 77 | Recovery cancellation | Manual pause/seek, navigation away, completion, PiP/hidden playback and offline state stop or suspend retries; user action is never undone by a delayed retry | NOT RUN |
| 78 | Recovery access errors | Visible player text identifying sign-in/age/region restrictions stops retries; other errors remain bounded to three attempts and never pause, navigate or restart the app automatically | NOT RUN |
| 79 | Automatic check/download controls | New native preferences default on; each toggle persists separately, explicit off is respected, and disabling automatic downloads stops an automatic transfer while retaining matching partial bytes | NOT RUN |
| 80 | Persistent periodic schedule | Android JobScheduler contains one network-connected persisted periodic check with an hourly requested interval; job timing may be deferred by Android and must not be described as exact | NOT RUN |
| 81 | Background release compatibility/validation | Only the official stable release and an explicit installed-ABI asset are selected; package ID, signer, version, asset digest and native ABI are verified before readiness | NOT RUN |
| 82 | Permission and installer | Settings opens only after explicit Install action; live unknown-app permission is checked; Android installer asks for confirmation; hand-off is not shown as installed | NOT RUN |
| 83 | Install reconciliation | After confirming or cancelling Android's installer, the next resume/check reads the real installed version; cancellation remains recoverable without a false success | NOT RUN |
| 84 | Startup animation row | Informational only; does not claim to remove Android splash or YouTube UI, and no initialization/injection/session restore/migration is skipped | NOT RUN |
| 85 | Native route allowlist | Only the two exact screen actions and `theme=oled|youtube` are accepted; signature permission blocks callers not signed with YTArk; unknown path, extra parameter, malformed query, arbitrary component/package/path is rejected before work with an actionable result | NOT RUN |
| 86 | Installer activity/process recreation | Return, cancellation and process recreation preserve the verified candidate and target version; PackageManager confirmation wins over installer result codes; retry remains explicit | NOT RUN |
| 87 | Updater phase recovery | Force check, network, checksum, package/version/ABI/signer validation, permission denial and installer cancellation each retain the correct actionable phase after resume/recreation | NOT RUN |
| 88 | Foreground/background cadence | Foreground resume runs only when due and coalesces with the scheduled check; disabled checks/downloads stay disabled; network loss/restart never starts duplicate transfers | NOT RUN |
| 89 | Settings/search/focus matrix | Audit settings navigation, search, IME and DPAD focus at supported 720p/1080p/4K scaling; text entry, OK/Done, Back hierarchy and return focus remain usable | NOT RUN |
| 90 | Updater cleanup path boundary | Pending and resumable APKs survive cleanup; symlink/path traversal and files outside the private updater root cannot be removed | NOT RUN |

## YTArk 4.0 updater-storage and startup-staging checks (NOT RUN)

Record the APK sha256, the exact Android build and the observed technical-details
text for every failure row. A check is **NOT RUN** until it is recorded here.

| # | Check | Expected | Result |
|---|---|---|---|
| 91 | Updater with the app's private storage intact (existing `files/ytark-updates-v31`) | Check finds a newer release; Download starts; technical details name the last storage operation only if preparation fails; no storage permission is requested | NOT RUN |
| 92 | Updater with a stray *file* named `ytark-updates-v31` in the private files directory | The file is renamed to `ytark-updates-v31.blocked`, the download proceeds, and nothing is deleted | NOT RUN |
| 93 | Updater storage failure surfaced precisely | A denied write, read-only mount or blocked path shows its own message and a `Storage operation:` line; "Not enough storage" appears only when capacity/ENOSPC proves it | NOT RUN |
| 94 | Resident playback during a check/download | Playback and account/session are untouched; a completed startup remains measurable in About → Diagnostics after more than five minutes of playback | NOT RUN |
| 95 | Sidebar channel toggle retired | Navigation no longer lists "Disable channels on sidebar"; after upgrading an install that had it on, the guide shows its normal channel entries and every other guide preference is kept | NOT RUN |
| 96 | Home soft reload on cold start | A cold start already on Home records a skipped startup navigation instead of a soft reload; an explicit launch destination still navigates, and a restored non-Home route still returns Home | NOT RUN |
