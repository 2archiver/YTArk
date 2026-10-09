# YTArk privacy disclosure

YTArk's privacy goal is narrow and concrete: **your Google account data stays
between your TV and Google.** YTArk adds no analytics, no telemetry, no crash
reporting, no ad SDKs, and no project-operated servers. Nothing in YTArk reads,
stores, or transmits Google account identifiers, cookies, or OAuth tokens.

## Who sees what

| Party | What it receives | What it never receives |
|---|---|---|
| **Google / YouTube** (upstream TV frontend and Cobalt player) | Normal YouTube traffic: sign-in, playback, subscriptions, search, watch history. This is the stock YouTube TV experience, governed by Google's privacy policy and your Google account settings. | — |
| **SponsorBlock** (`sponsor.ajay.app`, HTTPS) | Sponsor-segment lookups: a 4-hex-char prefix of the SHA-256 of a video ID, and the requested category list. DeArrow title/thumbnail lookups use the full video ID. | Account data, cookies, watch history, IP-linked identity beyond ordinary HTTPS metadata. YTArk sends no SponsorBlock votes or submissions. |
| **GitHub** (`api.github.com`, `github.com`, HTTPS) | Update checks (stable release metadata) and APK downloads, from your device's IP address. | Account data or anything from the YouTube session. |
| **jsDelivr** (`cdn.jsdelivr.net`, HTTPS) | Fetch of the bundled userscript bytes at launch. | Account data or anything from the YouTube session. |

Network calls added by YTArk are HTTPS-only. Google account authentication,
token refresh, playback, subscriptions, search, ad blocking and SponsorBlock
endpoints are never intercepted, proxied, or redirected by YTArk — including
when ad blocking is enabled. Ad filtering removes ad renderers client-side
inside the TV frontend only.

## What YTArk stores on the device

- **App settings** (ad-block toggle, SponsorBlock categories, quality, themes,
  cosmetic logo preference) in local storage inside the app's data directory.
- **Updater state** (pending update metadata, snooze timestamps) in the app's
  `ytark_native_updater` preferences.
- Google session cookies and tokens are kept by the upstream Cobalt/Chromium
  stack exactly as the base app keeps them. YTArk does not copy, export,
  back up, or log them. Uninstalling the app can erase this state — that is
  why updates must be installed in place, never by uninstall/reinstall.

## Logging

YTArk's native updater logs only generic status and error messages. YTArk code
never logs authentication cookies, OAuth tokens, account identifiers, or
sensitive request headers. Debug logging of request or beacon payloads has
been removed from the bundled userscript. `adb logcat` can still see upstream
Cobalt/Chromium logs, which YTArk does not control.

## Permissions YTArk adds

- `INTERNET` — playback, updates, SponsorBlock.
- `POST_NOTIFICATIONS` — optional update notifications (Android 13+).
- `REQUEST_INSTALL_PACKAGES` — the user-confirmed in-place update flow.

Any other permissions come from the pinned upstream TizenTubeCobalt base
(`v2.0.2`); YTArk does not add or request account access of its own.

## What this does NOT promise

- **Not anonymous.** Google/YouTube sees the same traffic as the stock YouTube
  TV app, including device and playback metadata the frontend sends.
- **Not a Google-tracking blocker.** YTArk blocks ad renderers and can skip
  SponsorBlock-marked segments; it does not block Google's own analytics inside
  the upstream frontend.
- **No proxying.** YTArk has no servers. If someone offers a "YTArk proxy" or
  asks for your Google credentials, it is not this project.
- Server-side YouTube behavior (ad decisions, Premium entitlements, token
  lifetimes) is outside YTArk's control. The "YouTube Premium" logo option is
  a **cosmetic local wordmark** and changes no account or server state.

Questions or corrections: open an issue on the official repository only
(https://github.com/2archiver/YTArk). See also `docs/SIGNING.md` for release
signing and update-integrity details.
