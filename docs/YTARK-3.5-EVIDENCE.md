# YTArk 3.5 evidence report

Status: **CI-built ARMv7 release candidate from PR #59, head `fd4f9138b91dd12b49ecacf1b7c6c3887f7aef46`. Not published, not tagged, not merged. PR #59 remains a draft.**

Nothing here shows that YTArk 3.4 or 3.5 installs on a TV, that the in-app updater completes an upgrade on a device, or that DeArrow replacements are visible on a TV. Those items are marked NOT RUN below.

## 0. Candidate evidence (CI, code commit `fd4f9138`)

Later commits on this branch that change only this document and the PR text do not change the tested code. The run for the final head is listed in the PR.

| Item | Value |
|---|---|
| Candidate workflow run | https://github.com/2archiver/YTArk/actions/runs/38754400254 (`build-candidate.yml`, event `pull_request`, conclusion success) |
| PR validation run | https://github.com/2archiver/YTArk/actions/runs/38754400236 (`ci.yml`, success) |
| Artifact | `ytark-3.5.0-armv7-candidate-fd4f9138b91dd12b49ecacf1b7c6c3887f7aef46` (58,705,347 bytes, not expired, 30-day retention). Contents are not readable from this sandbox; the run annotations carry the values below. |
| Source commit tested | `fd4f9138b91dd12b49ecacf1b7c6c3887f7aef46` (the PR head; the workflow asserts `git rev-parse HEAD` equals it) |
| APK | `YTArk-v3.5.0-armv7.apk`, SHA-256 `eae8dfa3b2c7094b8df059f2cbbea7f68688993ca7b9c94ddd3c6a45a2018fe2` |
| Package / version | `io.github.twoarchiver.ytark`, versionCode `3050000`, versionName `3.5.0` |
| ABI | `native-code: 'armeabi-v7a'` only (32-bit ARMv7 build) |
| Signer | SHA-256 `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae`, equal to the pinned `signing/YTArk-cert-sha256.txt` (checked by `check-apk`) |
| userScript.js | SHA-256 `c01fd7366e90bc5aa5251276214d1c412b058d564d1faadd8d3a37d11dc518a1`, 800,334 bytes. Identical to a local rebuild in this sandbox. |
| Upgrade eligibility (static) | `eligible_armv7=true` against the published v3.4.0 APK: its SHA-256, package ID, versionCode 3040000, ABI and permanent-signer checks passed, and 3050000 is higher. No install was run. |
| DeArrow live API probe | Informational. The shipped module made 3 requests to `sponsor.ajay.app/api/branding/{prefix}` (`5f6b`, `6745`, `6401`), all HTTP 200. Prefixes matched the independent Node `crypto` reference, and no full video ID appeared in a URL. `dQw4w9WgXcQ`: 2 titles, 6 thumbnails. `jNQXAC9IVRw`: 3 titles, 3 thumbnails. `M7lc1UVf-VE`: no entry. |

Signing identity: the candidate is signed with the pinned Hearth community keystore, fetched at its pinned commit and blob SHA and checked against the pinned certificate (`prepare_signing_key.sh`). No Actions secrets were passed. This is the same identity `release/signing.properties` declares for releases. That keystore is public by design of the repository, so the signature shows the pinned identity, not a secret. Whether the production secrets hold a different private key was not checked here (the sandbox cannot read them).

Notes on the candidate:
- The APK's SHA-256 changes between runs with the same APK sources because APK signatures are randomised. The userScript digest is stable across runs.
- The APK's `SCRIPT_URL` points at `cdn.jsdelivr.net/gh/2archiver/YTArk@s34/userScript.js`. Tag `s34` is not published until a release is made, so a device running this candidate cannot load its script from that URL yet. Device testing therefore needs either the tag or a separate test build; this is a real barrier.
- Verification run: 300/300 Node tests, 198 Python tests (1 skipped), bundle contract, workflow policy, secret scan and generated-file checks all pass on the current tree.

What was fixed to reach green (root causes, not relaxed checks):
- `ci.yml` asserted `DISPLAY_VERSION=3.4` while the metadata is 3.5. It now asserts 3.5.
- `tools/check_no_secrets.py --history` deadlocked: it wrote every object ID to `git cat-file --batch` before reading any output. The writer now runs on a thread.
- A new candidate-only workflow, `build-candidate.yml`, builds, signs and checks the ARMv7 APK for same-repository pull requests. It has no publish step, no `contents: write`, and no secrets. `check_workflow_policy.py` enforces those rules.
- The settings audit's "duplicate SponsorBlock row" was an extraction artefact. The registry has one toggle.

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

- Full DEX build, ARMv7 APK build, repack, zipalign, signature and ABI checks: these now run in hosted CI (section 0), not in this sandbox. The sandbox still cannot reach the Android SDK host.
- The base APK (`cobalt-arm.apk`, v2.0.2) download now runs on the hosted runner (`fetch_base_apks.py`, checksum verified). It is not downloadable from this sandbox.
- Install permission grant, deny and return on a TV; cancellation; offline and timeout on a TV; a genuine upgrade test on a device or emulator. No device, emulator, KVM or adb is available.

Signing: the candidate uses the pinned community identity (section 0). Whether the production `YTARK_KEYSTORE_*` secrets are configured, and whether they hold the same identity, was not verified. No key was created or substituted.

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

Candidate CI (head `fd4f9138`): see section 0. Local results below were run on the same tree.

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

NOT RUN in this sandbox (run in hosted CI instead, section 0): Android SDK build, ARMv7 APK build, zipalign, apksigner and ABI verification, aapt manifest dump, base APK checksum. NOT RUN anywhere in this pass: emulator or device upgrade, TV focus and D-pad checks, measured startup, physical TV evidence (the maintainer supplies that; see `docs/DEVICE-ACCEPTANCE.md`).

## 11. Remaining work and blockers

1. Production signing secrets: confirm whether they are configured and hold the pinned identity. The candidate does not depend on them.
2. Device or emulator testing of the candidate. The candidate's script URL needs tag `s34`, or a separate test build with a reachable script, before the app can load its userscript on a TV.
3. Device or emulator: permission flow, install, cancel, offline, upgrade with session preservation. The maintainer supplies TV evidence.
4. DeArrow on a TV: confirm the response boundary intercepts the app's browse, search and next requests, and that title replacement is visible. Measure the budget's latency effect.
5. Settings audit: per-row call-graph tracing for the generic rows; decide on `reloadHomeOnStartup` only after a measured startup cost.
6. `features/updater.js`: remove, together with the three suites that import it, in a dedicated change.
7. Translations: update the subtitle label in the other locales.
8. Stale CI issues #1–#9: maintainer review. Not closed here.
