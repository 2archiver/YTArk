# Hearth updater parity

YTArk's updater is modelled on the updater in the owner's Hearth project
(`2archiver/Hearth`, an Android TV / Google TV app). This page records the
comparison so future changes can see what "the same quality as Hearth" means in
practice, and where YTArk deliberately differs.

## Source inspection status

| Item | Value |
|---|---|
| Repository | `2archiver/Hearth` (public) |
| Inspected commit | `79ffcfa4d718662985e706f2425418da01e15de0` |
| Files read | `docs/UPDATES.md`, `update/GitHubRepositoryPolicy.kt`, `update/InstallPolicy.kt`, `update/UpdateSchedulePolicy.kt`, `update/UpdatePreferences.kt`, `update/UpdateInfo.kt`, `update/UpdateChecker.kt`, `update/UpdateInstaller.kt`, `update/UpdateManager.kt`, `update/UpdateNotifications.kt`, `ui/SettingsUpdates.kt`, `res/values/strings.xml` |
| Not read | Hearth's Gradle/release workflow files and `tools/extract_release_notes.py` |
| Parity claim | Behavioural parity for the rules listed below, verified by source inspection **and** YTArk's own unit tests. This is not a line-by-line port and not a claim that every Hearth feature exists in YTArk; the differences are listed explicitly. |

## Parity table

| Hearth behaviour (source) | YTArk implementation | Verification evidence |
|---|---|---|
| Canonical repository only; the old name is normalised, and anything that is not exactly `owner/name` is rejected (`GitHubRepositoryPolicy.canonicalRepository`) | The release contract accepts assets only under `https://github.com/2archiver/YTArk/releases/download/`, and the userscript/frontend validates that same prefix | `UpdateReleaseContractTest`, `TizenTube/mods/tests/update-state.test.mjs` ("refuses missing, duplicated and mismatched assets") |
| One HTTPS call to `api.github.com/repos/<repo>/releases/latest`; no guessed download path (`GitHubRepositoryPolicy.latestReleaseApiUrl`, `docs/UPDATES.md`) | Native engine reads the same endpoint; the settings-card fallback check fetches `https://api.github.com/repos/2archiver/YTArk/releases/latest` and nothing else | `updates-settings.test.mjs` ("never fetches anything except the official stable release endpoint"); `update-state.test.mjs` asset-URL rule |
| Release asset URL must be `https://github.com/<repo>/releases/download/...`, no userinfo/query/fragment, no `%` escapes, non-empty tag+filename segments (`GitHubRepositoryPolicy.isReleaseAssetUrl`) | `UpdateReleaseContract` requires the exact `.../download/v<version>/YTArk-v<version>-<abi>.apk` URL, and the frontend re-derives it from the tag | `UpdateReleaseContractTest`, `update-state.test.mjs` ("does not match the official YTArk release metadata") |
| Numeric `versionCode` comparison, never lexical: newer → **Update available**, equal → **Up to date**, older → **Up to date**, missing/unreadable → **check failed, never guess** (`docs/UPDATES.md`, `UpdateInfo.isNewerThan`) | `UpdateVersion`/`UpdateReleaseContract.expectedVersionCodeForVersion` natively; `isNewerVersion` + release-body versionCode cross-check in the frontend (`check_error`, never "up to date") | `UpdateVersionTest`, `update-state.test.mjs` (ordering table, `check_error` assertions), `updates-settings.test.mjs` ("failed check is never reported as up to date") |
| The release must declare its `versionCode` (and SHA-256); missing, malformed or conflicting integrity metadata is a blocking error — no size-only verification (`docs/UPDATES.md`, `UpdateInfo`) | The release body must confirm the versionCode that the tag maps to, the asset must carry a full 64-hex digest (or a `SHA256SUMS.txt` entry); the native engine streams the file and compares exact size + SHA-256 | `update-state.test.mjs` ("refuses releases whose declared versionCode disagrees with the tag", malformed digest), `UpdateReleaseContractTest` (`checksumForAsset` rejects missing/duplicated/invalid entries) |
| Draft / prerelease builds are never offered | The native checker rejects `draft`/`prerelease`; the frontend validates `draft === false && prerelease === false` and clean `v<semver>` tags | `update-state.test.mjs` ("refuses drafts, prereleases and non-stable tags"), `updates-settings.test.mjs` ("refuses drafts and prereleases") |
| Exactly one compatible APK asset per release; ambiguous or missing metadata blocks the offer (`docs/UPDATES.md` step 1) | The contract requires exactly one asset named `YTArk-v<version>-<abi>.apk` for the installed ABI, rejects source archives and unknown names | `update-state.test.mjs` (`0 assets` / `2 assets` cases), `NativeAbiContract` for ABI selection |
| Download into app-owned storage, streamed, with timeout and redirect following to GitHub's CDN (`UpdateChecker.open`, `UpdateInstaller`) | `YtarkUpdater` downloads into app storage with bounded connect/read timeouts, redirect host/path validation, `Accept-Encoding: identity`, and a 512 MB sanity cap | `YtarkUpdater.java` (`downloadAndVerify`, `openConnection`, `MAX_APK_BYTES`), CI `javac` contract tests |
| Resumable download only when the partial file still matches the expected asset (`UpdatePreferences` staged metadata, `docs/UPDATES.md` step 2) | Resume requires the same tag, asset name, ABI, size **and** published digest; `Range` requests are validated against `Content-Range` or the partial is discarded | `UpdateResumeContract` + its CI test, `YtarkUpdater.java` resume block |
| Interrupted/failed download is recoverable and reports actionably (`InstallPolicy.failureMessage`, `docs/UPDATES.md`) | `UpdateActivity` reports the real failure (network, storage, validation) and offers retry/resume; the frontend reports `download_error` with resume | `UpdateActivity.java` state machine, `update-state.test.mjs` ("hides check while busy and always offers one recovery path") |
| Unknown-app permission is a real state: `PERMISSION_REQUIRED` → Android's settings page → retry (`InstallPolicy.InstallStart.PERMISSION_REQUIRED`, `InstallPolicy.InstallState`) | `UpdateActivity` routes to `ACTION_MANAGE_UNKNOWN_APP_SOURCES` with `startActivityForResult` and resumes into "ready to install" without re-downloading | `UpdateActivity.java`, README "Native updates and release integrity" |
| Installer hand-off through `PackageInstaller` with a **mutable** result `PendingIntent`; a queued request is never called installed (`InstallPolicy.installResultPendingIntentFlags`, `docs/UPDATES.md` step 5) | The native engine hands the verified APK to Android's installer and only reports success after Android confirms the new version is installed | `YtarkUpdater.java` (`clearPendingIfInstalled`), `UpdateResumeContract`, README |
| Successful install is confirmed by reading the package metadata again; a staged APK whose build is installed (or older) becomes obsolete (`InstallPolicy.isStagedObsolete`, `UpdateManager.discardObsoleteStaged`) | Pending-update state is reconciled against the real file and the installed version at startup; stale or invalid pending metadata is discarded | `YtarkUpdater.java` ("Discarding stale pending update metadata"), `verifyPendingUpdate` |
| Progress uses real bytes; indeterminate when the total is unknown (`SettingsUpdates` `ProgressBar`, `update_download_progress`) | `UpdateActivity` shows `downloaded * 100 / total` live and switches the bar to indeterminate when no total is known; the frontend never renders a percentage it does not have | `UpdateActivity.java` (`onProgress`, `setIndeterminate`), `update-state.test.mjs` ("unknown download totals stay indeterminate") |
| Check cadence and throttling: success cadence, shorter retry cadence after a failure/interrupted attempt, and a rate-limit deadline from `Retry-After` / `X-RateLimit-Reset` that suppresses even manual retries (`UpdateSchedulePolicy`, `UpdatePreferences`) | Same structure (uniform cadence after success, shorter retry window after a failure, `rate_limit_until` from GitHub's headers, `nextEligibleAtMillis`) with YTArk's own values: 6 h cadence, 1 h retry | `UpdateSchedulePolicyTest` + CI `javac` test-run, `YtarkUpdater.java` rate-limit block; `updates-settings.test.mjs` ("rate-limit ... honestly") |
| Last successful check is tracked separately from the last attempt and last failure, and a stale legacy timestamp is preserved without being claimed as a success (`UpdatePreferences`, `docs/UPDATES.md`) | The frontend only shows a timestamp after a successful check; a failed check never overwrites it | `updates-settings.test.mjs` ("keeps the last success") |
| `Later` keeps the offer (notification snooze); `Skip this version` suppresses that release on this device until something newer appears (`docs/UPDATES.md`, `UpdatePreferences.skippedVersionCode`, `UpdateManager.skipVersion`) | Native engine persists `snoozed_tag`/`snooze_until` (24 h) and `skipped_tag`; the settings card exposes Later/Skip for a connected engine | `YtarkUpdater.java` (`snooze`, skip persistence), `update-state.test.mjs` (action table) |
| Low-interruption notifications with actions for available/ready updates (`UpdateNotifications`) | Native notifications (IDs 7201–7203) with Check/Update/Later actions and per-tag 24 h re-notify suppression | `YtarkUpdater.java` notification block |
| No telemetry; HTTPS only; explicit `User-Agent`/`Accept` headers (`UpdateChecker.open`) | No analytics in either layer; `User-Agent: YTArk-Android-Updater`, `Accept: application/vnd.github+json` natively, `accept: application/vnd.github+json` in the fallback check | `YtarkUpdater.java`, `updater.js`, `docs/PRIVACY.md` |
| Settings card shows installed **and** offered build, a status badge, timing lines, and only actions valid for the current state (`ui/SettingsUpdates.kt`, `strings.xml`) | YTArk Settings → **YTArk Updates** shows installed version + versionCode, the available version/size, release notes, the last successful check and the valid actions for the current state; the full state machine lives on the native screen | `updates-settings.test.mjs` (state → actions table), `update-state.test.mjs`, `settings.js` |
| Error text is specific and actionable (`InstallPolicy.failureMessage` maps platform statuses to sentences) | `UpdateActivity`/`UpdateResumeContract` map failures to actionable statuses ("Not enough storage…", "Android did not complete the installation…"); the frontend mirrors the tone | `update-state.test.mjs` (`describeState`), `UpdateActivity.java` |

## Deliberate differences

| Hearth | YTArk | Why |
|---|---|---|
| Native Android settings screen with an inline card, three auto-update toggles (check / download / install automatically) | Card inside YouTube's TV settings modal; check is on demand or in the background, download and install always require the user | The YouTube TV frontend owns the UI; silent installation is not wanted for a sideloaded app whose whole point is confirmed, user-approved updates |
| `Automatically install` uses the privileged self-update path on Android 12+ | Never silent: the update is verified, then handed to Android's installer for confirmation | Same reason; also avoids the platform path that can install without a visible prompt |
| Install is deferred while casting (`UpdateInstallSafety`) | No playback guard; the user has to open YTArk Updates and confirm | YTArk's installer confirmation already requires an explicit user action |
| 1 h automatic cadence, 30 min retry | 6 h cadence, 1 h retry | Lower background traffic for a media app; documented in the README and on the update screen |
| Persisted `InstallState` enum (INSTALLING / AWAITING_CONFIRMATION / CANCELLED / FAILED / SUCCEEDED) read by Settings | Pending-update metadata + resume contract reconciled with the real installed version at startup | YTArk's own screen owns that state; the web card cannot read it (see below) |
| "Known stale release" memory (`rejected_published_version_code`) so a release whose APK turned out not newer is not offered again | Not implemented; the version comparison is re-done from metadata on every check | Tracked as a possible follow-up, not claimed as parity |

## Known limitation of the web surface

Cobalt registers its JavaScript bridge objects in its own
`initializeJavaBridge()`; a repacked APK cannot add another one. The settings
card therefore cannot stream the native download/verify state. It performs a
real, validated release check and hands the user to the native screen for the
transfer, and it says so instead of displaying a progress bar it cannot back
with bytes. Live progress, `verifying`, `ready_to_install`, the permission step
and the post-install confirmation are all implemented and displayed natively.

## How to re-run the verification

```sh
cd TizenTube/mods && node --test tests/*.test.mjs        # frontend contract + surface
python3 -m unittest discover -s tools/tests              # release/repacker gates
tools/build_android_updater.sh /tmp/classes.dex          # native contract tests (needs a JDK 8+)
```

The native contract tests also run in CI (`.github/workflows/ci.yml`, job 3) and
the packaging gates in `.github/workflows/build-apk.yml`.
