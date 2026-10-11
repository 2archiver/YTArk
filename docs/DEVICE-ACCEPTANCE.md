# YTArk device checklist (optional, not a publication gate)

This checklist is **optional** and it is **not a gate on publication**. YTArk
publishes automatically from a successful `main` build
([`docs/RELEASE-PIPELINE.md`](RELEASE-PIPELINE.md)); this document exists so a
device result can be recorded honestly when someone runs one.

CI and packaging checks are **not** device tests. Every item below is **NOT RUN**
until a named device has recorded it. Nothing here is inferred from a previous
release: evidence belongs to the exact APK whose sha256 is written below.

Device: `__________` (model, Google TV / Android TV version, `ro.product.cpu.abilist`)
Installed before: `__________` · Candidate/release: `YTArk-v2.3.0-armv7.apk`
APK sha256: `__________` · Signer SHA-256 matches `signing/YTArk-cert-sha256.txt`: [ ]

| # | Check | Result |
|---|---|---|
| 1 | Install the new APK **over the previous version without uninstalling** (same package, same signer) | NOT RUN |
| 2 | Google sign-in or guest flow still works; the account and session survive the update | NOT RUN |
| 3 | Preferences survive (SponsorBlock categories, quality ceiling, YTArk Quick Controls); none reset | NOT RUN |
| 4 | Browse, search and playback start; captions and quality selection work | NOT RUN |
| 5 | Ad blocking on for a fresh install; saved toggle state kept after the update | NOT RUN |
| 6 | SponsorBlock skips a known segment and does not change the video after a lookup times out | NOT RUN |
| 7 | Remote keys: D-pad focus moves through Settings in order; Back returns | NOT RUN |
| 8 | Settings → YTArk Updates: installed version, latest stable and status are shown; QR and official URL are legible and scan to the release page | NOT RUN |
| 9 | Light and dark themes show the correct Premium wordmark (cosmetic only) | NOT RUN |
| 10 | Native entry: the card does not trigger `ytark://updates` (native integration pending). Record only if a native path to `UpdateActivity` is exercised on the device | NOT RUN |
| 11 | Update from 2.2: appearance unchanged (YouTube default theme, watermark and dimming options off); the What's new card appears once and stays dismissed | NOT RUN |
| 12 | Fresh install: OLED Black, Hide channel watermark and Remove player dimming are on | NOT RUN |
| 13 | Appearance → Theme: switching OLED Black ⇄ YouTube default works live, survives a restart and brings back saved custom colours | NOT RUN |
| 14 | Appearance → Player: video brightness is the same with controls open and closed when Remove player dimming is on; captions, seek previews and dialogs stay readable | NOT RUN |
| 15 | Search settings: D-pad keyboard and the TV keyboard both type; Back closes the keyboard, then the panel, then returns to YTArk Settings | NOT RUN |
| 16 | Customize YouTube Settings: a moved/hidden section changes the YouTube Settings page; protected sections stay; Restore default layout brings back the stock page | NOT RUN |
| 17 | Changelog: every version scrolls with the D-pad; the installed version is marked; the QR code opens the release page | NOT RUN |

Record the result of each row with the date, the device, the APK sha256 and a link
to the evidence. Do not mark a row passed without that evidence, and do not reuse
evidence from another build or version — a different APK is a different artefact.

Results can be passed to the recovery workflow as the optional
`device_test_notes` input. They are echoed in the job summary, separated from the
static checks, and they never block publication.
