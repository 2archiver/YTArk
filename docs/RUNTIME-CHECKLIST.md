# YTArk runtime acceptance checklist

This checklist is the **device** half of release acceptance. Packaging, manifest,
signature, checksum and unit gates run in CI; they cannot prove that a TV shows
the wordmark, keeps remote-control focus, or installs an update.

Copy this file per release, fill the header, and record the result of every row.
A row that has not been executed on a device is **NOT RUN** — never mark it
PASS from source inspection, a screenshot of a different build, or an emulator
that cannot run ARM playback. The wordmark rows can be judged from device
screenshots at their native resolution, but the screenshot must come from the
build under test.

## Build under test

| Field | Value |
|---|---|
| YTArk version / versionCode | |
| APK asset name | |
| APK SHA-256 (`SHA256SUMS.txt`) | |
| Userscript revision (`s…`) | |
| Device model | e.g. Chromecast with Google TV HD |
| Android / Google TV version + API level | |
| Device ABI (`ro.product.cpu.abilist`, must list `armeabi-v7a`) | |
| Installed version before the test | |
| Result of the in-place update (final installed version) | |
| Tester / date | |

## ARMv7 device run

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Cold launch | App opens to the YouTube TV home feed; no blank screen or crash | |
| 2 | Header wordmark on fresh launch | Exactly one Premium-style wordmark in the normal logo position; no extra header bar | |
| 3 | Sidebar / second logo location | At most one wordmark per logo location; no duplicate or blank slot | |
| 4 | Dark theme contrast | Wordmark readable against the dark header without changing the native theme | |
| 5 | Light theme contrast (if the theme is exposed) | Wordmark readable against the light header | |
| 6 | Home → open a video → return | The wordmark is present again after playback returns; no overlay in the player | |
| 7 | Home → Search → open result → back | Wordmark present; search box and results still reachable with the D-pad | |
| 8 | Home → Subscriptions / channel → back | Wordmark present; sidebar entries unchanged | |
| 9 | Settings → YTArk Settings open + close | Wordmark present after returning; no leftover modal | |
| 10 | Account switch (guest ↔ signed-in, or second profile) | Wordmark unaffected; account picker and guest flow still work | |
| 11 | Focus order | D-pad focus reaches the search box, the sidebar, the account control and the logo area exactly as on the stock build; no focus trap or skipped control | |
| 12 | Toggle **Premium logo (cosmetic)** off | Stock YouTube wordmark returns; no blank slot, no leftover red emblem; effect survives a relaunch | |
| 13 | Toggle back on | Wordmark returns immediately without a restart | |
| 14 | Ad blocking | Ads blocked by default on a fresh profile; an explicit opt-out is preserved after relaunch | |
| 15 | SponsorBlock | Segments skipped per its own settings; a SponsorBlock service error does not block playback | |
| 16 | Settings → YTArk Updates (open, no update) | Real installed version shown; the check reports up to date; last successful check is a real timestamp | |
| 17 | Settings → YTArk Updates while offline | Honest failure ("unable to check"), never "up to date"; no invented percentage | |
| 18 | Update flow: check → download → verify → install | Real bytes/progress, checksum/signer verification, Android installer confirmation, then the installed version reported back as the new one | |
| 19 | Cancel the Android installer | Returning to the app shows the verified update still ready to install, without re-downloading | |
| 20 | Relaunch after the update | App starts with the new version, app data and session preserved (no re-login required) | |

## Wordmark evidence (1080p and 4K)

Capture both theme states from the build under test, at the display's native
resolution, with the cosmetic toggle on.

| # | Check | Expected | Result |
|---|---|---|---|
| W1 | Dark header, 1080p screenshot | Bundled red emblem, white triangle and near-white lettering; transparent background; no white rectangle, stretch, crop or baseline shift | |
| W2 | Light header, 1080p screenshot | Same shapes, native dark lettering; the emblem colour is unchanged | |
| W3 | Dark + light header, 4K screenshot | Identical geometry and proportions, scaled as vector artwork; no pixelation | |
| W4 | In-place comparison against the 2.1.1 screenshot | The lettering is the real 2024 artwork, not the previous font approximation; exactly one logo in the header | |
| W5 | Theme switch while the app is running | Lettering follows the header without a reload, flash of the wrong colour, or duplicated mark | |
| W6 | Toggle off → on after W1–W5 | Stock artwork returns byte-for-byte, then the vector wordmark mounts again with the correct theme on the first frame | |

## YTArk 2.3 features (OLED, player cleanup, search, YouTube Settings, changelog)

Every row is **NOT RUN** until recorded on the build under test. Static and unit
tests do not replace these rows.

| # | Check | Expected | Result |
|---|---|---|---|
| 22 | Cold launch on a fresh install | No bright flash before the YouTube TV home; Home, sidebar and Search show true black; thumbnails and video keep their colours | |
| 23 | Cold launch after updating from 2.2 | Same look as 2.2 (YouTube default, saved colours); the three new options are off; one What's new toast when not playing; the card in YTArk Settings until dismissed | |
| 24 | OLED Black ⇄ YouTube default, live | Every supported surface switches without a reload; saved custom colours return; the Premium wordmark stays legible with its red emblem | |
| 25 | OLED readability at 720p, 1080p and 4K | Text, focus ring, switches, disabled rows and errors stay distinguishable | |
| 26 | Signed-in and guest navigation | Account selector and Continue as guest still work; theme stays applied across screens | |
| 27 | Remove player dimming | Video brightness unchanged when controls open; controls, captions, seek previews, loading/error states and dialogs readable; inactivity dimming still works on its own | |
| 28 | Hide channel watermark | A channel with a branding watermark shows none (if the frontend draws it); no focus lands on an invisible target; feed avatars and the header unchanged; turning it off restores it | |
| 29 | Player transitions | Next video, fullscreen and back to Home show no watermark flash and no stale hidden overlay | |
| 30 | Search settings with the D-pad keyboard | Typing, Delete, Clear, Done; results update; selecting a result opens the real control; Back returns to results with query and focus kept | |
| 31 | Search settings with the TV keyboard | The input method appears; Back closes it first, then the panel, without leaving YTArk Settings | |
| 32 | Customize YouTube Settings | Move up/down and Show/Hide change the YouTube Settings page on its next load; focus follows the moved section; protected sections can't be hidden | |
| 33 | Pinned entries | A pinned entry appears in Pinned near the top and works exactly like the original (same switch/menu) | |
| 34 | Restore default layout | Only the layout resets; YTArk and YouTube settings and the session are unchanged | |
| 35 | Changelog reader | Version list newest first with the installed version marked; long versions scroll with the D-pad; Back returns; QR opens the release page | |
| 36 | Section reset | The confirmation lists the defaults; only that section changes | |
| 37 | In-place update to 2.4 | Installs over 2.3 without uninstalling; session, cookies and preferences preserved | |

## YTArk 2.4 features (updater verdicts, settings categories, guide entry)

Every row is **NOT RUN** until recorded on the build under test. Static and unit
tests do not replace these rows.

| # | Check | Expected | Result |
|---|---|---|---|
| 38 | YTArk Updates on a normal ARMv7 TV | Installed version and latest stable shown; "armeabi-v7a (confirmed)" after a check; the manual route names the official page and the QR scans to it | |
| 39 | YTArk Updates with the architecture bridge empty (or a 64-bit-first report) | "Could not confirm this device's app architecture" with recovery actions — never "not compatible"; Re-detect and Check again stay selectable; release notes still open | |
| 40 | YTArk Updates while offline / rate-limited | Honest failure text (timeout or rate limit), never "up to date"; retry offered; nothing is downloaded | |
| 41 | Settings categories | YTArk Settings shows Playback, Appearance, Privacy, Navigation, YTArk Updates, About YTArk, Support; no "User Interface"/"Miscellaneous" root rows and no "YTArk Quick Controls" menu; every setting opens and keeps its saved value | |
| 42 | YTArk entry in the guide | Exactly one "YTArk Settings" entry, last in the sidebar, on every guide load; turning the Navigation toggle off removes it; hiding other sidebar entries never removes access | |
| 43 | Repeated Settings opens and route changes | Exactly one Premium wordmark per header host after many opens; no duplicate mounts, no blank logo slot; the stock logo returns on unpatched hosts | |

## YTArk 2.6 features (native updater, install permission, honest release states)

Every row is **NOT RUN** until recorded on the build under test. The host tests
and CI checks do not replace these rows: they cover the policy and packaging
code, not a TV installation.

| # | Check | Expected | Result |
|---|---|---|---|
| 56 | TV apps row | One **YTArk Updates** entry; it opens the native updater screen, and Back returns to the TV apps row | NOT RUN |
| 57 | Settings → YTArk Updates card | Shows installed and latest versions; "Up to date" only after a fresh successful check, with the check time; a newer local build reads "Newer than the latest stable release"; the card states that it does not download or install | NOT RUN |
| 58 | Failure states | Offline, rate-limited, unsupported ABI, missing ARMv7 asset, and bridge failure each show their own message; none is shown as "Up to date" | NOT RUN |
| 59 | Install permission | Off: only YTArk's own permission screen opens, from the Install button; on return with the permission still off, nothing installs | NOT RUN |
| 60 | Hand-off and focus | Install opens Android's installer once; a restart does not repeat a hand-off that is still waiting; D-pad focus returns to Install Update after the permission screen | NOT RUN |
| 61 | Confirmation | After installing, the next check reads the installed versionCode; the installer result code alone is never reported as success | NOT RUN |

## YTArk 2.5 features (settings cleanup, explicit activation, OLED repaint, installed version)

Every row is **NOT RUN** until recorded on the build under test. Static and unit
tests do not replace these rows, and a stored boolean is not proof that a theme
painted.

| # | Check | Expected | Result |
|---|---|---|---|
| 44 | Scroll the sidebar past **YTArk Settings** | The entry only highlights; no panel opens; focus keeps moving to the entries around it; no key is swallowed | |
| 45 | Explicit OK/Enter on the entry | Exactly one YTArk Settings panel opens; a second OK does not open a second one; a click with a mouse/remote pointer behaves the same | |
| 46 | Back from YTArk Settings | Returns to the previous sidebar position with focus on the entry; Back from a submenu or About returns to its parent with focus on the row used | |
| 47 | Entry placement | The entry is last in the sidebar (below every YouTube entry) on a fresh guide load, after a route change, after a guide reload and after toggling Navigation → YTArk entry off/on | |
| 48 | Ownership is obvious | YTArk Settings and YouTube's own Settings are visually distinguishable (labels, grouping, headings); no heading or separator is an empty selectable row; long labels stay readable and the focused row scrolls into view on long pages | |
| 49 | Removed controls | User Agent Profile, Fix UI, Presets and Undo Last Preset appear nowhere in the tree or in settings search; no search result links into a deleted route; search still finds every retained setting | |
| 50 | Upgrade from a real 2.4 install | Installs over 2.4 without uninstalling; sign-in/session preserved; every retained preference keeps its effective value; an install that had chosen a user-agent profile reloads at most once and then uses the platform user agent | |
| 51 | OLED Black paints | Home/browse, sidebar, Search, Settings and supported dialogs show true black; text and icons stay readable; the focused sidebar entry is visibly distinct; thumbnails, artwork, video and captions keep their colours | |
| 52 | OLED Black persists | The look survives route changes, reopening Settings and an app restart; turning it off restores the previous theme including any saved custom colours, without a reload | |
| 53 | About YTArk offline | With the network off, About shows the installed version (never "Version unknown") plus separate YTArk version, YouTube version (only when the frontend publishes one) and Build details lines; a build-metadata fallback is labelled as such | |
| 54 | Installed vs available | The Updates card's "Installed" value matches About; "Latest" stays a separate value; a pending asynchronous read shows a brief loading state and then the real version in place (no second panel) | |
| 55 | No duplicates after heavy use | Repeated opens/closes of YTArk Settings, its submenus, About and the changelog create no duplicate panels, rows or handlers; playback, YouTube's own Settings page and the update check still work | |

## YTArk 2.7 features (search keyboard, About dialog, simplified changelog)

Every row is **NOT RUN** until recorded on the build under test. The DOM tests and
CI checks cover focus, layout data and the bundled text, not a TV panel or a
device input method.

| # | Check | Expected | Result |
|---|---|---|---|
| 62 | Search settings and the TV keyboard | Selecting Search focuses a real text field and the device's own keyboard is offered where the device provides one (Android TV remote-app keyboard or another IME); typing filters results live; Clear empties the field; Back closes the keyboard first, then the panel, and focus returns to the row Search was opened from | NOT RUN |
| 63 | Search settings without a system keyboard | The on-screen key grid types, the panel says the on-screen keys are in use, and no "keyboard opened" claim is made anywhere | NOT RUN |
| 64 | About YTArk layout | At 720p, 1080p and 4K with display scaling the header reads "About YTArk" / "YTArk <version>", no text overlaps or clips, every row wraps, and Build details, Third-party notices and licences and Version history each open with D-pad focus and scroll | NOT RUN |
| 65 | What's new placement | No top-level "What's new" row in YTArk Settings and none on the YouTube Settings page's YTArk section; the post-update notice points to YTArk Updates, and YTArk Updates → changelog is the only route to the version history | NOT RUN |
| 66 | Changelog summaries | Each version row leads with one short line; 2.6 reads exactly "2.6 — Added Full Auto Updating"; the list stays newest first and long versions scroll with the D-pad; Back returns | NOT RUN |
| 67 | OLED Black after the relabel | Turning OLED Black on still repaints the supported surfaces to true black immediately and after a restart, the focused row stays distinguishable, and the setting text matches what is actually themed | NOT RUN |

## 64-bit-only userspace check (expected exclusion)

On a device or emulator image whose `ro.product.cpu.abilist` contains only
64-bit ABIs, record that **no** install is attempted and that the TV/updater
reports the ARMv7-only limitation (row 21). Do not rename or strip an APK to
force the installation.

| # | Check | Expected | Result |
|---|---|---|---|
| 21 | Install the release on an `arm64-v8a`-only userspace | Android rejects the package (or the updater refuses with the documented message); no workaround is applied | |

## Recording failures

For a failed row keep the exact on-screen text, the version/versionCode of the
build that was running, and if possible `adb logcat` output around the failure.
A failed runtime row blocks a stable promotion until it is fixed and re-run on
the same device class.
