# YTArk 4.0.0 candidate evidence

**Disposition:** candidate review only. This branch has not been merged and no
release or tag has been created. Device/runtime claims below are limited to
what was actually executed.

## Candidate identity and repository state

| Field | Candidate |
|---|---|
| Branch | `arena/79279920-ytark` |
| Base commit | `59141ffcd2966a2f82396d824dab8d951a3d6628` |
| Package | `io.github.twoarchiver.ytark` |
| Version / display version | `4.0.0` / `4.0` |
| Version code | `4000000` |
| Planned release tag / userscript tag | `v4.0.0` / `s41` |
| Unchanged base | TizenTubeCobalt `v2.0.2` |
| APK target | `YTArk-v4.0.0-armeabi-v7a.apk` (ARMv7 only) |

Before editing, the live repository was checked: `main` was at the base commit,
`v3.9.0` was the latest published release (published 2026-10-19 15:05 UTC), no
PR was open for this work, and remote tags `v4.0.0` and `s41` did not exist. A
later recheck before PR creation confirmed `main` remained at the base and
those two tags remained absent. No tag was created or moved. The PR candidate
workflow is non-publishing; merge/release publication is not authorized by this
task.

## Workstream evidence

1. **Browsing no longer hijacks playback (focus-dwell fix).** Root cause
   confirmed by code inspection: `addPreviews` injects
   `onFocusCommand.startInlinePlaybackCommand` (delayMs 3000) into tiles that
   lack a native focus command; the Cobalt frontend fires it on focus dwell and
   plays that card's `watchEndpoint` — the same endpoint OK uses — replacing the
   playing video. Long-press did **not** cause or contribute: `addLongPress`
   only injects `onLongPressCommand.showMenuCommand` menu data (it opens a menu
   on a held OK; it never auto-plays and registers no DOM listeners). The fix
   adds `features/focusPreviewGuard.js`, wired into the patched resolver in
   `resolveCommand.js`: a `startInlinePlaybackCommand` preview is consumed only
   when a `<video>` is mounted **and** the target id differs from
   `PlayerService.loadedPlaybackConfig.watchEndpoint.videoId`. Deliberate OK /
   click / Play (`watchEndpoint` activation), same-video re-preview,
   playback-end autoplay and videoQueuing (which resolves `onSelectCommand`, not
   a focus command), and overlay previews on browse pages (no `<video>` mounted)
   are all unaffected. 15 new host tests pass.
2. **Navigation colours / Content colours removed.** Both settings, the colour
   panel node and the dead implementation (`buildCustomColorCss`, `colorValue`,
   `saveCustomColor`, `__barColor`/`__routeColor` inputs) are gone. Settings
   schema v9 retires `focusContainerColor` and `routeColor` via `RETIRED_KEYS`,
   so stale stored values are safely ignored and dropped at migration; menu
   focus/index is repaired by removing the panel node itself. The stylesheet is
   static CSS only.
3. **DeArrow reliability.** No defect was demonstrated: the existing
   implementation already satisfies every requirement (server-ordered
   first-candidate selection with locked||votes≥0 and not-original, no
   runner-up promotion, TTL/negative/error-backoff caching, in-flight dedup,
   concurrency cap 8, budget-bounded response hold with cache-only fallback,
   epoch + live `isEnabled()` guards that discard stale in-flight results,
   idempotent boundary install, data-level rewrite before render so recycled
   tiles are inherently safe, prefix-only sha256-4-char lookups with
   `credentials:'omit'`/`no-referrer` and no full-ID fallback). Three new
   fixtures prove late-result/recycled-tile safety and immediate disable
   (including discarding in-flight results). Live probe against
   sponsor.ajay.app: **NOT RUN** (network allowlist).
4. **Faster startup without breaking readiness.** Startup orchestration in
   `ui.js` (navigation install, intent guard, guide refresh, readiness loop) is
   wrapped in a one-shot `window.__ytarkStartupInstalled` re-entry guard, so a
   re-evaluated script cannot double-install remote listeners, managed CSS or
   the readiness timer. `ui.js` is not directly Node-importable (Rollup inlines
   `ui.css`), so the guard is verified by source inspection and by bundle
   markers (`__ytarkStartupInstalled` ×2 in `dist/userScript.js`). No measured
   speedup is claimed: no same-target before/after samples exist, and host
   timing is not TV launch/first-frame evidence.
5. **Positive shrunken-thumbnail control.** `disableEnlargingThumbnails` is
   retired (schema v9 `RETIRED_KEYS`); the new `enableShrinkingThumbnails`
   toggle sets `effects.shrink=true; effects.enlarge=false` when on and neither
   flag when off (standard YouTube sizing). Migration folds an **explicit** old
   boolean into the new key once, only when the new key is absent, using
   key-existence checks — a carry-over of the old value, not a blind inversion;
   the fresh-install default (off/standard) is unchanged. The effect is applied
   per-response at shelf-parse time, covering home/search/recommendation and
   under-player shelves plus recycled cards with no duplicate style injection.
   The dead `disableEnlargingThumbnails` translation key was removed from all
   32 locale files (JSON re-validated).
6. **Who's-watching checkbox.** The `statusOnly` flag is removed from
   `nav.profilePicker`: one real checkbox row (checked = on) with the ACCOUNT_CIRCLE
   icon, a clear TV focus indicator, and no startup race (the automatic prompt
   still waits for the stored choice to load). Key `showAutomaticProfilePicker`
   and stored true/false semantics are unchanged.
7. **Small reliability fixes.** The startup re-entry guard (workstream 4) also
   hardens script re-evaluation; the adblock JSON.parse hook gained an outer
   try/catch returning the partially processed response; DeArrow late-result
   and immediate-disable behaviour is now pinned by tests.

## Executed checks

| Result | Check | Actual result |
|---|---|---|
| **PASS** | JavaScript regression suite: `cd TizenTube/mods && node --test tests/*.test.mjs` | 399 tests passed, 0 failed, 0 skipped (89 suites). |
| **PASS** | Userscript build: `cd TizenTube/mods && npm run build && node --check ../dist/userScript.js && python3 ../../tools/check_bundle_contract.py` | Rollup build and bundle contract passed; 45 required symbols, 838,052 characters. Existing Browserslist-age, circular-dependency, and Rollup `preventAssignment` warnings remain. |
| **PASS** | Python suite: `python3 -m unittest discover -s tools/tests` | 256 tests ran, no failures, 1 skipped. The skipped test invokes the shared Java/Kotlin runner and requires a host JDK. |
| **PASS** | Generated metadata | `python3 tools/build_buildinfo.py --check` and `python3 tools/build_changelog.py --check`; changelog is current with 28 versions, newest `4.0.0`. |
| **PASS** | Release identity | `python3 tools/validate_release.py emit-env --file /tmp/ytark-release.env` emitted `4.0.0`, display `4.0`, code `4000000`, `v4.0.0`, `s41`, base `v2.0.2`, and package `io.github.twoarchiver.ytark`. |
| **PASS** | Version gate against live GitHub releases | `python3 tools/validate_release.py check-version --latest-json … --releases-json …` (metadata fetched from `api.github.com`): "Numeric version and versionCode exceed published releases: 3.9.0 (3090000, v3.9.0) -> 4.0.0 (4000000)." |
| **PASS** | Release-note contract | The publish template renders 109 words (≤110 cap); its contract test passes, including ARMv7-only guidance, the manual signed-4.0-over-3.9 bootstrap route, and unchanged package/signing/base identity. |
| **PASS** | Repository policy and hygiene | `bash -n tools/*.sh`, `python3 tools/check_workflow_policy.py`, `python3 tools/check_no_secrets.py --history`, and `git diff --check` passed. |
| **PASS** | Static release/package contracts | Included in the 256-test Python run: version ordering, package/base/manifest constraints, pinned base checksum, release-asset/digest rules, and candidate workflow policy. |
| **PASS** | Bundle content markers | `dist/userScript.js` contains `startInlinePlaybackCommand` ×4, `playerMounted` ×2, `__ytarkStartupInstalled` ×2, "shrunken thumbnails" ×2; removed colour code (`buildCustomColorCss`, `saveCustomColor`, `colorValue`, `__barColor`) is absent (0 occurrences). Remaining `focusContainerColor`/`routeColor`/`disableEnlargingThumbnails` occurrences are only the legitimate `RETIRED_KEYS` and migration literals. |

## Unverified checks and limits

| Result | Check | Actual limit |
|---|---|---|
| **NOT RUN** | APK build, signing and inspection | No Android SDK and no `java`/`javac` in this environment, and fetching the pinned Cobalt base APK requires network access beyond this sandbox's allowlist. The candidate workflow (`build-candidate.yml`) is the supported path; its run IDs will be recorded after the PR is opened. |
| **NOT RUN** | Remote CI workflows (source validation, candidate) | No run has been triggered for this branch yet; nothing is claimed from CI in this report. |
| **NOT RUN** | DeArrow live probe (`tools/dearrow_live_probe.mjs`) | Requires live network access to sponsor.ajay.app, outside this sandbox's allowlist. Prefix-lookup behaviour is covered by host fixtures instead. |
| **UNVERIFIED** | Android/Google TV runtime, in-place upgrade, and the focus-dwell fix's device behaviour | No `adb`, emulator or physical TV was available. The focus-dwell root cause and the long-press non-involvement are established by code inspection and host fixtures, not by a device recording; a device record must name the model, ABI, Android/API version, package/versionCode and exact APK SHA-256, then cover preserved account/preferences, playback under browse dwell, DeArrow renaming, shrunken-thumbnail layout, startup, and Google TV separately. An emulator is not Google TV evidence. |

The remote workflows, when they run, prove build-time checks only. No APK was
built, installed or signed here; no install-permission grant, installer result,
playback, startup or Google TV runtime result is claimed by this report.

## Reproduction commands

From the repository root:

```sh
cd TizenTube/mods && node --test tests/*.test.mjs
cd TizenTube/mods && npm run build && node --check ../dist/userScript.js
python3 -m unittest discover -s tools/tests
python3 tools/build_buildinfo.py --check
python3 tools/build_changelog.py --check
python3 tools/validate_release.py emit-env --file /tmp/ytark-release.env
python3 tools/validate_release.py check-version --latest-json /tmp/latest.json --releases-json /tmp/releases.json
bash -n tools/*.sh
python3 tools/check_workflow_policy.py
python3 tools/check_no_secrets.py --history
git diff --check
```

(`/tmp/latest.json` and `/tmp/releases.json` are the GitHub API payloads for
`repos/2archiver/YTArk/releases/latest` and `repos/2archiver/YTArk/releases`.)

For the Java/Kotlin host runner, use `tools/test_android_updater.sh`. For the
Android/D8 build, use `ANDROID_HOME=<Android-SDK> API_LEVEL=34
BUILD_TOOLS=34.0.0 tools/build_android_updater.sh`; the full APK pipeline runs
in CI via `build-candidate.yml`. On a real ARMv7 Android TV, record device/build
identifiers and each scenario result before changing any runtime row from
**UNVERIFIED**.

## Checklist

- [x] Preserve package/base/version/signing configuration and ARMv7-only target.
- [x] Block automatic inline previews of a different video while a player is mounted; keep deliberate OK/click/Play, playback-end autoplay/queueing and browse-page previews.
- [x] Remove the two custom colour settings, their dead implementation and their menu node; retire their keys safely at schema v9.
- [x] Validate DeArrow reliability (late results, recycled tiles, immediate disable, prefix-only private lookups) with host fixtures.
- [x] Guard startup orchestration against script re-evaluation without breaking readiness.
- [x] Replace the negative enlarged-thumbnail toggle with the positive shrunken-thumbnail control and a one-time value migration.
- [x] Replace the tiny On/Off Who's-watching text with one clear checkbox row, preserving the preference key and stored values.
- [x] Regenerate 4.0.0 build/changelog assets; prepare release notes (109 words).
- [x] Run available JS, Python, build, generator, release-policy, version-gate and hygiene checks.
- [ ] Build/sign and inspect the ARMv7 candidate — **NOT RUN**, no Android SDK/Java and base-APK fetch is outside the sandbox allowlist.
- [ ] Record remote CI workflow runs — **NOT RUN** at authoring time; observe after the PR is opened.
- [ ] Validate behavior on Android TV / Google TV — **UNVERIFIED**, no device evidence.
- [ ] Merge or publish — **not requested and not done**.
