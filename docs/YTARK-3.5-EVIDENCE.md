# YTArk 3.5 evidence report

Status: **candidate work on branch `arena/3ad3b918-ytark`. Not published, not tagged, not merged.** Nothing here shows that YTArk 3.4 or 3.5 installs on a TV, that the in-app updater completes an upgrade on a device, or that DeArrow replacements are visible on a TV. Those items are marked NOT RUN below.

## 1. Starting point

- Branch: `arena/3ad3b918-ytark`, created from `main` at **48e8cee** (single root commit).
- `48e8cee` equals the v3.4.0 tag (**995fca4**) in every file except `README.md`. There is no common ancestor between the two; the release history is not a parent of `main`.
- Published state at the start: v3.4.0 is the GitHub Latest release (published 2026-10-15 08:34 UTC, 5 assets). The userscript tag `s33` (c462eeb) exists remotely.
- Repository instructions: no `AGENTS.md` or `CLAUDE.md` was found.

## 2. Commits and changed areas

| Commit | Area | Summary |
|---|---|---|
| `445149d` | DeArrow | Hash-prefix lookups, trusted first-candidate selection, fetch response boundary, privacy correction |
| (this pass, later commit) | Release, audit, dependencies, docs | 3.5.0 identity and regenerated generated files, 3.4.0 changelog correction, settings audit, PRIVACY and README corrections, build-tool dev-dependency move, English label fix |

## 3. DeArrow

Sources checked (upstream, not a copy of their code):

- DeArrow API documentation, `https://wiki.sponsor.ajay.app/w/API_Docs/DeArrow`: `GET /api/branding/:sha256HashPrefix` takes the first four characters of the SHA-256 of the video ID; the first array element is the one to use, and it is trusted only when `locked` is true or `votes >= 0`; `timestamp` is null when `original` is true; `GET /api/v1/getThumbnail` takes the full `videoID`, `time`, and an optional `redirectUrl` that must start with `https://i.ytimg.com/`; titles may contain `>` formatting markers that the docs say to remove.
- A third-party client (PipePipe, PR #98) describes the same "original winner gives no replacement" behaviour. That is a secondary source. It was not used as the basis for any rule beyond the documented fields.

What changed (`TizenTube/mods/features/dearrowBranding.js`, `utils/rawJson.js`, `features/adblock.js`):

- Title lookups send only the 4-character prefix. The old code sent the full ID to `?videoID=`.
- Candidate choice: the first server-ordered entry, applied only when trusted and not `original`. The old code picked the most-voted entry and ignored trust and `original`.
- Thumbnail replacement: the first trusted, non-original timestamp, with a `redirectUrl` to the original `i.ytimg.com` image when available.
- Caching and limits: bounded cache (64 buckets), 30-minute positive TTL, 5-minute negative TTL, 60-second error back-off, in-flight de-duplication per bucket, 8 concurrent requests, 3-second timeout per request, 2.5-second budget per browse response.
- Delivery: a fetch response boundary on `/youtubei/v1/browse`, `/search` and `/next` reads and rewrites the response before the app receives it. `JSON.parse` stays synchronous. The old code mutated already-parsed objects after a fire-and-forget request; that path is removed.
- Stale results: a response is returned unchanged if DeArrow is switched off while the request is in flight, or if the service epoch has advanced.
- Master switch: `enableDeArrow` gates everything. `enableDeArrowThumbnails` applies only when the master switch is on.
- HQ thumbnails (`enableHqThumbnails`) no longer overwrite a DeArrow thumbnail on the same tile.
- Privacy: `docs/PRIVACY.md` now states that title lookups use the prefix and that thumbnail images disclose the full video ID to `dearrow-thumb.ajay.app`.

Verification:

- `node --test tests/dearrow-branding.test.mjs`: 30 tests pass. Coverage: prefix correctness against Node's `crypto`, no full ID in the request URL, no credentials or referrer, malformed ID rejection, selection policy (first entry, trust, `original`, `>` stripping), thumbnail URL and redirect rule, TTL expiry, negative caching, 404 caching, error back-off, de-duplication, timeout, bounded cache, tile application for tile and lockup shapes, delayed response not resolved until branding arrives, master switch off (identical response object, no branding request), toggle off during flight, budget exceeded (original response delivered), thumbnail subordinate gate, malformed JSON, install-once.
- Not verified: the real `sponsor.ajay.app` and `dearrow-thumb.ajay.app` responses (no network to them from this sandbox beyond the allowlist, and no device). The assumption that the TV app issues its browse, search and next requests through `window.fetch` is supported by the existing `standaloneUserscript.js` POST handling, but not confirmed on a TV. If the app uses another transport, the boundary does nothing and DeArrow stays inert; that is a safe failure, not a verified fix.
- Not verified: visible replacement on a TV (**NOT RUN**).
- Not measured (**NOT MEASURED**): the added latency of the 2.5-second budget on a TV, and the CPU cost of reading and re-parsing every browse, search or next response that contains a video ID while DeArrow is on. Responses without tiles are still parsed once. This cost should be measured on a TV before 3.5 is described as lighter or heavier than 3.4.

## 4. Updater

No updater Kotlin or Java source was changed in this pass. The brief's updater items were checked against the existing code and tests:

| Requirement | Where it is implemented | Test evidence (Java/Kotlin policy suite, sandbox JDK) |
|---|---|---|
| One automatic permission route per fresh page entry; no loop | `UpdateActivity.beginFreshPageEntry`, `permissionEntryAttempted` | `freshEntryPromptsOnceOnlyWhenMissing`, `denialAndReturnNeverLoop`, `missingPermissionNeverLaunchesAnything` |
| Permission re-checked on return and before installer launch | `UpdateActivity.finishEntryPermissionReturn`, `InstallCoordinator.install`, `PendingInstallPolicy.mayContinue` | `grantedPermissionHandsOffOnce`, `PermissionReturn` policy |
| Installer result distinct from a completed install | `InstallerStatusPolicy` (`user_action`, `cancelled`, `blocked`, `invalid`, `signature`, …), `UpdateStates.installUnconfirmed`, `installed` only after PackageManager reports the new versionCode | `stateMachineAndPermissionAndInstallerStatuses` |
| Streaming download, honest progress | `JdkHttp.streamTo`, `UpdateStates.progress` | `redirectsAndPartialDownloadsUseTheLocalServer` (local HTTP server) |
| Checksums, package, signer, version, ABI validation | `ApkValidator`, `ReleaseMetadataParser`, `UpdateReleaseContract` | `assetSelectionRejectsMissingAmbiguousEmptyAndForeignApks`, `onlyExactOfficialReleaseAssetUrlsAreAccepted`, `malformedOrMissingMetadataIsRejected` |
| Offline, timeout, rate-limit | `UpdateErrorMapper`, `RateLimitPolicy`, `BackoffPolicy` | `parsesRateLimitResponsesAndRefusesTightLoops`, `rateLimitDeadlineTakesPrecedence`, `backoffIsBoundedAndCancellable`, `failureUsesBoundedRetryRatherThanRapidStartupLoops` |
| No newer release | `UpdateRepository.discover`, `UpdateStates.upToDate` | `newer`, `versionOrderingIsNumeric` |
| Cancellation | `UpdateStates.cancelled`, `CancelHandle` | `interruptedLegacyAttemptRemainsThrottled`; device cancel NOT RUN |
| Installer cancel | `InstallerStatusPolicy` `cancelled` kind; candidate kept | policy only |
| No external updater app; no broad JS bridge; no arbitrary URL installer | `tools/patch_cobalt_bridge.py` replaces one smali method (`installAppFromURL` → `NativeUpdatesBridge.open`) and fails closed on any other change | `patch_cobalt_bridge.py` roundtrip check |
| Package ID and signing lineage | `io.github.twoarchiver.ytark` unchanged; `ApkValidator` requires signer equality or lineage rotation to a trusted `CERT_SHA256` | policy only |
| versionCode above published baseline | `release/version.properties` 3050000 > 3040000 | `validate_release.py` check; `test_release_version_code_exceeds_every_published_stable_release` |

Resume policy (documented, from `DownloadTransferPolicy`, `UpdateResumeContract` and `CHANGELOG.md` 3.4.0): a partial download resumes only when the stored ETag matches the response ETag, the response is HTTP 206, and the `Content-Range` starts at the stored offset. Any other response, including HTTP 200 for a ranged request, restarts from zero. A download does not continue across process death. Restart-from-zero is the accepted fallback.

Test run: `PATH=/home/user/ytark-cache/bin:$PATH bash tools/test_android_updater.sh` → **EXIT 0**, all 13 Java suites and 2 Kotlin suites pass. This used a sandbox javac substitute built from a JDK 8 `tools.jar` and an extracted `java.base` boot classpath. CI uses JDK 17. This is policy and unit coverage only. It does not run Android framework code.

NOT RUN for the updater:

- Full DEX build, ARMv7 APK build, repack, zipalign, signature and ABI checks. The Android SDK (android.jar, d8, apksigner, zipalign) is not reachable from this sandbox.
- The base APK (`cobalt-arm.apk`, v2.0.2) download. GitHub release assets redirect to a host that is unreachable here.
- Install permission grant, deny and return on a TV; cancellation; offline and timeout on a TV; a genuine upgrade test on a device or emulator. No device, emulator, KVM or adb is available.

Blocker for a release candidate: **the production signing key is not verified.** `release/signing.properties` pins the community "Hearth" key (`phairplay.p12`, public material). `build-apk.yml` reads `YTARK_KEYSTORE_*` secrets. This session could not confirm which key CI uses or whether a production secret exists, and no key was created or substituted.

## 5. Settings audit

`docs/SETTINGS-3.5-AUDIT.md` lists all 56 registry controls (toggle, choice, multi) with the stored key, the default from `config.js`, the write path, grep-based consumers, UI description, validation evidence and limits. It also lists the stored keys that have no registry row: `focusContainerColor`, `routeColor`, the retired startup-animation keys, and `configSchemaVersion`.

Findings:

- `enableHqThumbnails`: no test; traced to `features/adblock.js` `hqify`.
- `focusContainerColor` and `routeColor`: no registry row; written only by the hidden panel opened from remote keys 403/404; validated by `colorValue`.
- `enableShowOtherLanguages`: adds an "Other Languages" section to the captions auto-translate menu. The English label "Show Hidden Subtitles" was misleading; changed to "Show More Translation Languages" in English only.
- `fasterStartup`: changes only YTArk's readiness polling (50 ms ticks for the first 2 s, then 250 ms, up to 40 s). Off by default. NOT MEASURED; no speedup is claimed.
- `reloadHomeOnStartup`: defaults on, so each start performs a soft reload. Cost NOT MEASURED. Default left unchanged.
- `enableWhosWatchingMenuOnAppExit`: when off, the exit request is answered with `EXIT_APP`. Not tested; device NOT RUN.
- Legacy startup-animation keys: retired; removed by the `RETIRED_KEYS` sweep on upgrade. No UI row.
- Schema 5: `config.js` header now describes 5. The release that introduced 5 is not recorded in this checkout.
- Duplicate SponsorBlock row: the same key appears in two registry rows. Not consolidated.

Not done: per-row call-graph tracing for the generic rows, and device checks for any row.

## 6. Startup and UI quality

No startup or UI change was made in this pass. Startup time was not measured on a TV, so no speedup is claimed. The only startup-related controls are described in the audit. D-pad and focus checks: NOT RUN on a TV.

## 7. Imports, dependencies and supply chain

- `TizenTube/mods/package.json`: moved five build-only packages from `dependencies` to `devDependencies` (`@babel/preset-env`, `@rollup/plugin-babel`, `@rollup/plugin-terser`, `rollup`, `rollup-plugin-string`). CI runs `npm ci` and `npm run build`, which install dev dependencies, so the move does not change CI. `package-lock.json` shows no resolved `version` changes, only the moved entries and dev flags.
- Kept in `dependencies`: `esprima` and `estraverse` (used by `utils/ASTParser.js`, which `ui/customUI.js` imports), `qrcode-npm` (used by `features/releaseQr.js`), `i18next`, `tiny-sha256`, `whatwg-fetch`, `core-js`.
- `features/updater.js` (924 lines) is not imported by the shipped bundle, but three Node suites import it directly (`changelog-whats-new`, `settings-cleanup`, `updates-settings`). Removing it would require rewriting those suites, so it is left in place and noted for a later pass.
- `userAgentRetirement.js`, `appVersion.js` and polyfill ordering: not re-audited in this pass.
- The localhost guard, `esprima` usage and the commit pinning of Actions were not changed. `check_workflow_policy.py` passes.

## 8. Release consistency

- `release/version.properties`: 3.5.0, versionCode 3050000, displayVersion 3.5, `v3.5.0`, script tag `s34`. `s34` was not on the remote at the time of checking.
- `CHANGELOG.md`: the 3.4.0 entry is corrected to the published format (publication time 08:34 UTC). A new 3.5.0 section is marked Unreleased and states only what this pass verified.
- Generated files were regenerated with their tools, not hand-edited: `changelog.generated.js`, `ReleaseHighlights.generated.kt` (`build_changelog.py --write`), `buildInfo.generated.js` (`build_buildinfo.py --write`). `--check` passes for both.
- Hard-coded identity updated in `.github/workflows/ci.yml` (env-file checks), `android-updater/README.md` and the affected tests.
- No tag was created or moved. No release was published. No merge was made.

Stale CI issues: open issues #1–#9 are untagged "CI failure: run N" reports created 2026-10-09. They were listed only. **They were not closed and no comment was posted**, because that needs maintainer authorisation.

## 9. ARMv7 precisely

The release APK, `YTArk-v<version>-armv7.apk`, is a 32-bit armeabi-v7a build repacked from the 32-bit `cobalt-arm.apk` base of TizenTubeCobalt v2.0.2. It is not an arm64 build, and YTArk does not claim arm64 support. Whether a particular TV can install it is a device question. The repository does not verify installation on any device. `README.md` now states this.

## 10. Validation results (this pass)

| Check | Command | Result |
|---|---|---|
| JavaScript suite | `node --test tests/*.test.mjs` (TizenTube/mods) | 300 / 300 pass (270 before, +30 DeArrow); rerun after the label change: 300 / 300 |
| Userscript build | `npm ci` then `npm run build` | exit 0. `dist/userScript.js` 800,334 bytes, SHA-256 `c01fd7366e90bc5a…` (3.4 source: 791,653 bytes, `d8ea2f6f…`) |
| Syntax of built bundle | `node --check dist/userScript.js` | OK |
| Bundle contract | `python3 tools/check_bundle_contract.py` | OK, 45 symbols |
| Workflow policy | `python3 tools/check_workflow_policy.py` | OK |
| Secret scan | `python3 tools/check_no_secrets.py` | passed |
| Python suite | `python3 -m unittest discover -s tools/tests` | 198 run, OK, 1 skipped (not investigated) |
| Updater policy suite | `tools/test_android_updater.sh` with sandbox javac | EXIT 0 |
| Changelog and buildinfo | `build_changelog.py --check`, `build_buildinfo.py --check` | current |

NOT RUN (environment): Android SDK build, ARMv7 APK build, zipalign, apksigner signature and ABI verification, aapt manifest dump, base APK checksum, emulator or device upgrade, TV focus and D-pad checks, measured startup, physical TV evidence (the maintainer supplies that; see `docs/DEVICE-ACCEPTANCE.md`).

## 11. Remaining work and blockers

1. Production signing key: confirm availability and which key CI uses. **Blocker.** No substitute key has been created.
2. Run the Android SDK build and the ARMv7 APK checks in an environment that has the SDK and the base APK.
3. Device or emulator: permission flow, install, cancel, offline, upgrade with session preservation. The maintainer supplies TV evidence.
4. DeArrow on a TV: confirm the response boundary intercepts the app's browse, search and next requests, and that title replacement is visible. Measure the budget's latency effect.
5. Settings audit: per-row call-graph tracing for the generic rows; decide on `reloadHomeOnStartup` only after a measured startup cost.
6. `features/updater.js`: remove, together with the three suites that import it, in a dedicated change.
7. Translations: update the subtitle label in the other locales.
8. Stale CI issues #1–#9: maintainer review. Not closed here.
