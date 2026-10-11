# YTArk 2.2 device acceptance checklist

This is a separate, short checklist. CI and packaging checks are **not** device
tests. Every item below is **NOT RUN** until a named device has recorded it.
`mode: publish` in `publish-release.yml` refuses to run without a link to the
recorded evidence.

Device: `__________` (model, Google TV / Android TV version, `ro.product.cpu.abilist`)
Installed before: `YTArk 2.1.2` (`versionCode 2010200`) · Candidate: `YTArk-v2.2.0-armv7.apk`
APK sha256: `__________` · Signer SHA-256 matches `signing/YTArk-cert-sha256.txt`: [ ]

| # | Check | Result |
|---|---|---|
| 1 | Install 2.2.0 **over 2.1.2 without uninstalling** (same package, same signer) | NOT RUN |
| 2 | Google sign-in or guest flow still works; the account and session survive the update | NOT RUN |
| 3 | Preferences survive (SponsorBlock categories, quality ceiling, YTArk Quick Controls); none reset | NOT RUN |
| 4 | Browse, search and playback start; captions and quality selection work | NOT RUN |
| 5 | Ad blocking on for a fresh install; saved toggle state kept after the update | NOT RUN |
| 6 | SponsorBlock skips a known segment and does not change the video after a lookup times out | NOT RUN |
| 7 | Remote keys: D-pad focus moves through Settings in order; Back returns | NOT RUN |
| 8 | Settings → YTArk Updates: installed version, latest stable and status are shown; QR and official URL are legible and scan to the release page | NOT RUN |
| 9 | Light and dark themes show the correct Premium wordmark (cosmetic only) | NOT RUN |
| 10 | Native entry: the 2.2 card does not trigger `ytark://updates` (native integration pending). Record only if a native path to `UpdateActivity` is exercised on the device | NOT RUN |

Record the result of each row with the date, the device and a link to the
evidence. Do not mark a row passed without that evidence. Any failed row blocks
`mode: publish` until it is fixed or the owner accepts the documented risk.
