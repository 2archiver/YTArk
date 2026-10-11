# YTArk runtime acceptance checklist

This checklist is the **device** half of release acceptance. Packaging, manifest,
signature, checksum and unit gates run in CI; they cannot prove that a TV shows
the wordmark, keeps remote-control focus, or installs an update.

Copy this file per release, fill the header, and record the result of every row.
A row that has not been executed on a device is **NOT RUN** — never mark it
PASS from source inspection, a screenshot of a different build, or an emulator
that cannot run ARM playback.

## Build under test

| Field | Value |
|---|---|
| YTArk version / versionCode | |
| APK asset name | |
| APK SHA-256 (`SHA256SUMS.txt`) | |
| Userscript revision (`s…`) | |
| Device model | e.g. Chromecast with Google TV HD |
| Android / Google TV version + API level | |
| Device ABI (`ro.product.cpu.abilist`) | |
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

## ARM64 device run

Run rows 1–20 again on an `arm64-v8a` device and record the results separately.
Do not infer ARM64 behaviour from the ARMv7 run (or the reverse).

## Recording failures

For a failed row keep the exact on-screen text, the version/versionCode of the
build that was running, and if possible `adb logcat` output around the failure.
A failed runtime row blocks a stable promotion until it is fixed and re-run on
the same device class.
