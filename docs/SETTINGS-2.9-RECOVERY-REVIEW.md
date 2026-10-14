# YTArk 2.9 recovery review

**Review date:** 2026-10-14 (UTC)
**Branch:** `arena/ae317430-ytark` at `449218f` (merge of PR #45), plus the working changes described here.
**Candidate:** consolidated **2.9.0** source candidate — not published, not tagged, not device-verified.

This review supersedes the abandoned 2.9.1 split review
([`SETTINGS-2.9.1-REVIEW.md`](SETTINGS-2.9.1-REVIEW.md)) and the earlier
[`SETTINGS-2.9-REVIEW.md`](SETTINGS-2.9-REVIEW.md). It records: why the release
pipeline failed, what was repaired, what the pinned Cobalt base can and cannot
do, and exactly which claims are verified at which layer.

Status vocabulary used below: **Implemented + Verified (layer)** names the layer
(source/Python/Node/host-JRE/CI); **Implemented + Unverified** means the code
exists but the named layer was never executed; **Blocked** always states the
exact blocker and the next action; **Not implemented** means the code does not
exist.

## 1. Baseline

| Item | Value |
|---|---|
| Published releases | 14; newest is **v2.8.0** (“YTArk 2.8”, versionCode `2080000`, userscript `s27`, 2026-10-13) |
| Remote tags | `v2.0.3-ytark.15` … `v2.8.0`; **no `v2.9`, `v2.9.1`, `s28` or `s29` tag exists** |
| Package | `io.github.twoarchiver.ytark` (unchanged) |
| Android base | TizenTubeCobalt **v2.0.2** (`cobalt-arm.apk`, 97,195,140 bytes, SHA-256 `ff90c6e8…d9fd2`); no engine upgrade |
| Signer | Pinned Hearth community keystore; certificate SHA-256 `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae` (re-verified from public source on 2026-10-14) |
| Failed runs under review | `38433960172` (PR #44), `38513241473` (PR #45), `38512750058` (PR #45 source check) |

## 2. Why the pipeline failed

Log blobs are not retrievable from this sandbox (`gh run view --log-failed` and
the job-log API return EOF because the log host is unreachable), so the causes
below were established from run/job/step metadata and from replaying the exact
workflow assertions locally against a freshly built bundle.

| Run | Trigger / commit | Failed job → step | Established cause | Fix |
|---|---|---|---|---|
| `38433960172` | push `main`, PR #44 merge (`9cb0df3`) | *Build and package-check the ARMv7 APK* → step 9 “Build and test the userscript bundle” | The step carried its **own copy** of the required-symbol list and still required `YTARK_YTS_EDITOR`. PR #44 retired the layout editor, so the symbol no longer exists in the bundle (0 occurrences; the only remaining source reference is the regression test asserting the action is refused). | Step replaced by the shared bundle contract |
| `38513241473` | push `main`, PR #45 merge (`449218f`) | same job → same step | Same stale duplicate list, untouched by PR #45 | same |
| `38512750058` | PR #45 (`68bc9a1`) | *Userscript, vector asset, ABI, repacker and updater tests* → step 10 “Test native updater ABI, routes, install recovery, failure phases and storage contracts” | The pure-Java regression fixture `UpdateGuardsTest` called `isStaleUpdateFile("YTArk-v2.6.0-armv7.apk.part", CURRENT, …)` — passing the *active* APK where the *selected* APK belongs, so the “selected partial survives cleanup” case failed. | Repaired in `3f09d57` (“Fix selected APK cleanup regression fixture”); the next run (`38512914154`) passed |

Local replay of the old step’s complete assertion list against a freshly built
bundle (2026-10-14): 24 of 25 checks pass; the single failure is
`needle YTARK_YTS_EDITOR` (`grep -c YTARK_YTS_EDITOR dist/userScript.js` → `0`).
Both release runs died **before** “Download and verify the pinned upstream ARMv7
Cobalt base”, so neither ever compiled the updater, repacked, signed or
uploaded anything; the publish job was skipped in both.

## 3. Repairs applied

1. **One contract instead of per-workflow copies** — `release/bundle-contract.json`
   plus `tools/check_bundle_contract.py` (shared by `build-apk.yml`, `ci.yml` and
   the userscript tests). The contract holds 31 required literals, 3 forbidden
   literals, 5 retired action names, 2 forbidden files, 8 forbidden source
   strings, and the markup/branding rules. The checker validates the contract
   itself, then the built bundle **and** the packaged sources, and exits 1
   naming the offending entry. `yt-settings-layout.test.mjs` reads the retired
   list from the same file, so the Node suite and both workflows can no longer
   drift apart. 13 Python regressions in `tools/tests/test_bundle_contract.py`.
2. **One updater-test list** — `tools/test_android_updater.sh` compiles 15 policy
   sources `--release 8` (failing if any of them imports `android.`) and runs 11
   host-JRE test classes. Both `ci.yml` and `tools/build_android_updater.sh`
   call it; `tools/tests/test_android_updater_tests.py` guards the list against
   drift. The previous CI list compiled **14** sources and ran **10** classes —
   `NativeThemePolicy` (the native OLED/normal palette policy) was not compiled
   or executed anywhere.
3. **No version literals in the repacker** — `tools/repack_apk.py` now derives
   `--version-code`/`--version-name` defaults from `release/version.properties`
   via `validate_release.load_config()`; the last `2090100` / `2.9.1` defaults are
   gone.
4. **New native theme regression test** — `NativeThemePolicyTest.java` (OLED is
   exactly `#ff000000`, normal palette, opaque colours, ~3:1 quiet-text contrast,
   invalid/`null`/whitespace themes fall back to normal). Written but **not yet
   executed on a JVM** (no `javac` here); it is wired into the shared runner.
5. **Identity and documentation consistency** — release identity, generated
   metadata, changelog, workflows, tests and acceptance docs now all carry the
   2.9.0 recovery identity (section 4).

## 4. Version and tag decision

| Property | Value |
|---|---|
| `versionName` / `displayVersion` | `2.9.0` / `2.9` |
| `versionCode` | `2090000` (published baseline `2080000`) |
| Release tag | `v2.9.0` — **not created** |
| Userscript tag | `s28` (last published is `s27`) — **not created** |
| APK asset name | `YTArk-v2.9.0-armv7.apk` (ARMv7 / `armeabi-v7a` only) |
| Base | TizenTubeCobalt `v2.0.2` |

Rationale: both earlier draft identities (2.9.0/`s28` and 2.9.1/`s29`) were
**unpublished** — their build runs failed at the userscript gate before any
packaging — and no `v2.9`/`v2.9.1` tag exists on the remote. `2090000` is the
next unused code above published `2080000`, and `s28` is the next unused
userscript tag above published `s27`, so this is a fresh, strictly increasing
label rather than a decrement or a reuse. Neither draft tag is created, moved or
deleted.

Live check (16 published release records, 2026-10-14):
`validate_release.py check-version` → exit 0 —
`2.8.0 (2080000, v2.8.0) -> 2.9.0 (2090000)`.

## 5. Native routing — corrected evidence (was “Blocked on Cobalt dispatch”)

The 2.9.1 review reported native routing as *unverified*. The pinned base has now
been read directly (TizenTubeCobalt `v2.0.2` source extract), and the honest
status is **Blocked by the pinned base**, with the mechanism identified:

1. **No external-protocol handler exists in the base.** Nothing under `cobalt/`
   overrides `ContentBrowserClient::HandleExternalProtocol`; the only
   implementations are in `content/`. The default implementation
   (`content/public/browser/content_browser_client.cc`, `return true;`) never
   sets `out_factory`, and the API comment in
   `content/public/browser/content_browser_client.h` states the navigation “is
   canceled … silently when this function returns true”. A page assignment such
   as `window.location.href = 'ytark://updates'` therefore launches nothing and
   leaves the page unchanged on this base.
2. **The base’s only web→native bridge cannot open screens.**
   `cobalt/browser/h5vcc_tizentube/public/mojom/h5vcc_tizentube.mojom` declares
   exactly six methods: `InstallAppFromURL(string) => (bool)`, `GetVersion`,
   `GetArchitecture`, `GetBrandAndModel`, `SetFrameRate`, `SetUserAgent`. The
   implementation (`h5vcc_tizentube_impl.cc`) forwards those to
   `StarboardBridge`; `installAppFromURL` downloads an APK into the app’s private
   files directory and hands **that file** to the system package installer
   (FileProvider + `ACTION_VIEW`). There is no method to open an activity, a
   screen or a deep link for an arbitrary URL.
3. **No other hop exists.** `CobaltActivity.startActivity` only records
   `mLastSentIntent`; the main activity’s intent filters are http/https; the
   Android Java bridge (`MainActivity.initializeJavaBridge`) registers only
   `HTMLMediaElementExtension`.

**Consequence:** in-page `ytark://updates`/`ytark://storage` dispatch cannot be
made to work in the pinned base by any YTArk-side change (it would require
patching Cobalt C++/Java, i.e. forking the pinned base). Next action: re-check the
bridge and the external-protocol path when the base tag is next updated; until
then the native screens are reached from the **TV apps row**, which needs no
in-page hop.

**Route that works today** (Implemented + Verified: source/manifest + manifest
tests): TV apps row → `UpdateLauncherActivity` (public Leanback proxy, no
permission) → `UpdateActivity` → **“Cache & Storage” button** → `StorageActivity`
(explicit in-app intent). The button is new in this candidate: Storage previously
had no reachable entry point once the scheme path was understood to be dead.

**Userscript behaviour** (Implemented + Verified: Node tests): the two settings
rows keep the exact allowlisted URI assignment (harmless, and it starts working
if a future base handles the scheme) and, when the page is still visible 2.2 s
later, show the route that does work (“Open YTArk Updates in the TV apps row,
then choose Cache & Storage.”). The fallback is visibility-gated: a navigation
that the platform *did* take over (page hidden) shows no fallback.
`yt-settings-layout.test.mjs` covers both branches.

**Boundary:** no device exists here, so the Android side is source/manifest
verified only; the toast path is simulated-DOM verified.

## 6. Settings and feature matrix

| Area | Status | Layer / evidence | Remaining |
|---|---|---|---|
| Settings → native screens (Updates / Storage rows) | **Blocked (base limitation)** — see §5 | Node test for exact URI + truthful fallback; Python manifest tests for exported filters | Device run; base update re-check |
| Native screens reachable at all | **Implemented + Verified (source)** | Launcher proxy → Updates → **Cache & Storage** button | Device run |
| Updater state machine (checking → available/up-to-date → downloading → validating → permission_needed → ready_to_install → installing → cancelled/failed) | **Implemented + Verified (source + Python/Node); host-JRE Unverified** | `YtarkUpdater` state constants; `UpdateSchedulePolicyTest`, `InstallerResultPolicyTest`, `UpdaterFailurePhasePolicyTest` are in the shared runner (not executed here) | JVM run (CI) |
| Install confirmed only from installed version; exactly-once hand-off | **Implemented + Verified (source)** | `InstallerResultPolicy`, `UpdateActivity` polling `PackageManager`; `Add-ons` contract tests | Device/JVM |
| Cache & Storage safety (app cache roots only; pending/resumable APKs protected; path + symlink containment; confirm dialogs with **Cancel** focused) | **Implemented + Verified (source/Python)** | `StorageActivity` (`setNegativeButton("Cancel")` + `requestFocus`), `UpdateGuards`; `test_repack_apk.py`/release tests | Device |
| Settings search with real input + DPAD grid | **Implemented + Verified (Node)** | `textEntryOverlay.js` (real editable input, D-pad key grid), `settings-search.test.mjs` | Device |
| System IME on the pinned base | **Implemented + Verified (source-level)** | Chromium’s VirtualKeyboard API is Windows-only, but Android’s `ImeAdapterImpl` honours `VirtualKeyboardVisibilityRequest.SHOW` (line 669) by calling `showSoftKeyboard()`; editable focus also requests the IME | Device run to confirm the TV IME appears |
| Duplicate/retired settings removal | **Implemented + Verified (Node + bundle contract)** | `settings-cleanup.test.mjs`; contract `retiredActions` absence checks | Device |
| Focus/scroll restore in native + YTArk panels | **Implemented + Verified (source/Node)** | `restoreFocus()` in both activities, panel focus tests | Device |
| About accuracy (YTArk version vs service-delivered frontend vs base vs engine; missing → “Unavailable”) | **Implemented + Verified (Node)** | `features/appVersion.js` (`FRONTEND_VERSION_PATTERN`, no bundled version is presented as the frontend’s; engine stays unavailable; base tag in Build details) | Device |
| Native theming of UpdateActivity/StorageActivity | **Implemented + Verified (source)**; test Unverified | `NativeThemePolicy` + new `NativeThemePolicyTest` (JVM not run here) | JVM run |

## 7. OLED surface matrix

True-black styling is applied only through one managed, root-class-gated
stylesheet (`ui/appearanceStyles.js`, class `ytark-theme-oled`). Audited surface
groups (each entry is a page/surface container — **no `<video>`, `<img>`,
`<canvas>`, thumbnail, channel art, caption or player-scrim selector is
included**):

| Group | Selectors | Result under OLED | Untouched |
|---|---|---|---|
| Page surfaces | `body`, `#container`, `.ytLrTvBrowseRendererHost`, `.ytLrTvSurfaceContentRendererContent(+HasOffsetInlineSearchBar)`, `.ytLrGuideResponseContainer`, `.ytLrGuideResponseCollapsed …`, `.ytLrClassicSearchPageHost`, `.ytLrAccountSelectorHost` | background `#000000` | artwork, thumbnails, video |
| Dialogs/overlays (incl. YTArk’s own panels) | `.ytLrAnimatedOverlaySidesheet .ytLrAnimatedOverlayContainer`, `.ytLrOverlaySectionRendererOverlay`, `.ytLrOverlayTwoPanelRendererActionPanel`, `.ytLrOverlayPanelRendererContent`, `ytlr-overlay-panel-renderer` | background `#000000` | panel text/focus pills |
| Focused sidebar/row | `ytlr-guide-response yt-focus-container` | raised near-black (not pure black) so focus stays visible | `.zylon-focus`, `.ytLrButtonFocused` |
| Frontend variables | `--yt-spec-*` background variables (10) | set to `#000000` | everything else |
| Player scrim | — | **independent setting**; OLED does not touch `.ytLrWatchDefaultShadow*` | scrim keeps its own toggle |
| Captions | — | untouched (`CAPTION_SELECTORS`) | caption styling preserved |

Lifecycle: applied by the startup step, restored if the frontend drops the class
during SPA navigation, and removing the preference restores the normal/custom
theme. Evidence: `appearance-theme.test.mjs`, theme-token tests, and the bundle
contract’s `ytark-theme-oled` / `ytark-no-player-scrim` literals. Device
coverage of every YouTube surface is **NOT RUN**; the selector list above is the
audited set, not a device-observed one.

## 8. Validation performed in this worktree

| Check | Result |
|---|---|
| `python3 -m unittest discover -s tools/tests` | **151 passed, 0 failed, 1 skipped** (the skip is the JVM-dependent updater test compile) |
| `cd TizenTube/mods && node --test tests/*.test.mjs` | **283 passed, 0 failed, 69 suites** |
| `npm run build` + `python3 ../tools/check_bundle_contract.py` | Built 854,340 bytes; **Bundle contract OK** (39 symbols, 828,492 characters) |
| `python3 tools/build_changelog.py --check`, `build_buildinfo.py --check` | current |
| `python3 tools/repack_apk.py --self-test` | self-tests pass (not a real APK) |
| `python3 tools/check_workflow_policy.py`, `tools/tests/test_android_updater_tests.py` | pass |
| `tools/prepare_signing_key.sh` replay (public source) | exit 0; pinned certificate verified |
| Live version gate (`check-version` against GitHub) | exit 0 (16 releases) |
| Java sources syntax-parsed (`javalang`, 35 files, incl. new test) | 0 syntax errors — **not** a compile |
| Signed ARMv7 candidate build / repack / sign / device run | **NOT RUN** (see §9) |

## 9. Blocked items — exact blockers and next actions

1. **Pinned base APK cannot be fetched from this sandbox.** Every publish channel
   is unreachable: `releases/download` redirects to
   `release-assets.githubusercontent.com` which fails with
   `SSL_ERROR_SYSCALL`; Actions artefacts redirect to
   `productionresultssa0.blob.core.windows.net` (same failure);
   `raw.githubusercontent.com` is unreachable. *Next action:* run the existing
   `build-apk.yml` (push to `main` or `workflow_dispatch`, both needing
   authorization) — it downloads and verifies the base, compiles the updater,
   repacks, aligns, signs and validates the APK, and uploads
   `ytark-armv7-candidate`.
2. **No local Java/Android toolchain.** No `javac`/`java` (the `jdk4py` wheel is
   a JRE; no PyPI/npm package ships `javac`), no `apktool` 3.0.3, no
   `aapt2`/`d8`/`apksigner`/`zipalign`, `ANDROID_HOME` unset. *Next action:* CI
   (it installs pinned build-tools and Temurin 17) or any environment with the
   Android SDK.
3. **Device verification** (installer, upgrade continuity, IME, OLED surfaces,
   native screens, cache clearing) — no device/emulator. *Next action:*
   `docs/RUNTIME-CHECKLIST.md` on a real ARMv7 Android TV device once an APK
   exists.

For reference, the packaging commands that authorized CI run (in order, after
sdkmanager/Temurin setup) are: `tools/build_android_updater.sh
"$RUNNER_TEMP/ytark-updater/classes.dex"`; `tools/fetch_base_apks.py
--release-json … --base-tag "$BASE_TAG" --output-dir base --checksums-out
base-apk-sha256.txt`; `tools/repack_apk.py --base base/cobalt-arm.apk
--architecture armv7 --out "work/YTArk-v2.9.0-armv7-unsigned.apk" --updater-dex …
--version-code 2090000 --version-name 2.9.0 --apktool … --zipalign …`;
`bash tools/sign_apks.sh work`; and `tools/validate_release.py check-apk --apk
release-assets/YTArk-v2.9.0-armv7.apk --architecture armv7 …`.

Roll-up: **code-complete** for the source changes listed here (Python 151/151 with
1 javac-dependent skip; Node 283/283; built userscript 854,340 bytes and
contract-clean); **build-pass NOT RUN** (no APK was compiled, repacked, signed or
verified); **device-verified NOT RUN**.

## 10. Disposition

The source changes are reviewable as a consolidated 2.9 recovery candidate. No
tag, release, push to `main`, or publication was performed, and none is
authorized by this document. Do not claim a built or signed APK, device
verification, or working in-page native routing: the pinned base cancels such
navigations, and the supported route is the TV apps row (Updates → Cache &
Storage).
