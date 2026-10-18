YTArk 3.8 — candidate, not published

Reliable updater error reporting, one ARMv7 APK per release, and clear upgrade paths.

- Update checks no longer show a generic "Unexpected error"; specific messages cover TLS, timeout, rate limit and metadata failures with Retry.
- Each release attaches exactly one ARMv7 APK with the full ABI name (`armeabi-v7a`); older `armv7` assets remain accepted.
- Guide-row Settings, D-pad ownership and Shorts/settings interaction remain fixed from 3.7.

Requires Android support for armeabi-v7a. Install over your existing YTArk app; your data is preserved. Upgrading from 3.7 may require a manual APK install if the installed updater cannot reach the fixed release endpoint.

<!-- Package io.github.twoarchiver.ytark; 3.8.0; versionCode 3080000; base TizenTubeCobalt v2.0.2. -->
