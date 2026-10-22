# YTArk 4.3 implementation review

Prepared 22 October 2026 (Brisbane). Base source: `e2e958a34ae27954a6404ca2428b38f903668145` (published 4.2). Local branch: `codex/ytark-4.3`. No publication, push, release, merge, installation, data clearing or account changes were performed. Original untracked IDE files were preserved.

## Implemented changes

- `ui/guideIdentity.js`, `ui/customGuideAction.js`, `ui/sidebarModification.js`: one pure endpoint resolver for checkbox writes/state, order learning, movement, reordering and filtering. Search remains `search`; verified Shorts maps to `FEshorts`. Existing browse/channel IDs survive. Unknown entries cannot become Search. Mixed/missing sections, null JSON values and non-guide responses remain safe. Original endpoints are kept, repeated parses restore the unfiltered snapshot, channel shortcuts do not duplicate, and YTArk Settings remains reachable. The existing reload listener and JSON.parse hook are reused.
- `config.js`: schema 11 removes only `search` from legacy `disabledSidebarContents` once. The old choice is ambiguous; the user must reselect Search/Shorts. Other hidden IDs, order, startup preference and unrelated settings are retained. No Google account/session storage is touched.
- `render_launcher_art.py`, generated TV banner and `branding/fonts/`: replace hand-drawn lettering with pinned Barlow Condensed Bold (OFL 1.1), exact casing YTArk. Build uses bundled bytes and BASIC layout, no host font/download. Logo SHA-256 remains `de815a58125d65b5e0dd8faab7e80cbeaa9d9a06025575b72968dd0884db4e28`; square and adaptive image pixels remain intact. Both 640×360 and 320×180 previews were inspected.
- `dearrowBranding.js`: remove invented 1280×640 dimensions on thumbnail replacement and retain each renderer's existing geometry. Missing dimensions stay missing. Movie/Shorts tile artwork is excluded. No CSS/card shape redesign, focus/overlay/navigation rewrite, or global object-fit override was added.
- Release metadata: 4.3.0 / display 4.3 / code 4030000 / s44 / base v2.0.3. Remote tags were checked: s43 exists and s44 was unused. Correct 4.2 publication metadata was obtained from GitHub (2026-10-21 22:35 UTC); historical release notes remain historical. CHANGELOG.md still generates both in-app readers and release summaries. Font attribution was added to the existing NOTICE generator. Pinned SVG byte fidelity is protected against Windows line-ending conversion in `TizenTube/.gitattributes`.

## Sidebar cause: evidence versus runtime limits

User reproduction: disabling Shorts also disabled Search.

Source: checkbox generation and hiding mapped every non-browse endpoint to `search`. Learning/reordering used different checks. This is an identity collision, not a label bug.

A fresh, unauthenticated `TVHTML5` `/youtubei/v1/guide` request was captured during this run with client version `7.20261021.18.00`, language en and region AU. It returned Search as `searchEndpoint: { query: "" }` and Shorts as `reelWatchEndpoint` with `watchEndpointSource: REEL_WATCH_ENDPOINT_SOURCE_SHORTS_PIVOT_BAR` and overlay style `REEL_PLAYER_OVERLAY_STYLE_SHORTS`. These establish the collision for a current guest response. The sanitized fixture removes tracking/visitor/response identifiers; it preserves endpoint structure. Browse/URL alternatives are synthetic contract fixtures, not falsely described as captures.

This confirms the response/source cause. It does not prove the exact response served to the user's signed-in TV or Kids profile. Keyboard/query/results usability, remote focus and restart persistence need device checks.

## Thumbnail investigation

The supplied file refers to a screenshot and ZIP research file; neither the screenshot, ZIP nor RESEARCH_AND_SOURCES.md was attached in this chat. A landscape rectangle alone is not evidence of distortion.

`processShelves()` sets YouTube's own shrink/enlarge effects only when enabled. `hqify()` deliberately selects sddefault.jpg with 640×480 metadata and respects a previously selected DeArrow URL. DeArrow's old setter instead asserted every replacement was 1280×640. A live trusted DeArrow response for public video dQw4w9WgXcQ at 3.92349 seconds returned HTTP 200 image/webp, decoded 1280×720. The blanket 2:1 metadata is therefore demonstrably false. The fix preserves the original renderer/card metadata rather than guessing dimensions for every generated image or redirect fallback.

Regression tests cover 16:9, 4:3 and missing geometry, tile and lockup forms, thumbnail-off behavior, navigation/duration preservation and exclusion of poster/Shorts artwork. Existing DeArrow response/gating tests also pass. The reported unattractive Search layout, movie-card presentation and every DeArrow × shrinking toggle combination remain UNVERIFIED on a TV. No visual improvement, playback quality or performance claim is made from the metadata probe alone.

## Validation

| Status | Check | Evidence / limit |
|---|---|---|
| PASS | Locked userscript install, full Node suite | 427 tests, 92 suites; no failures/skips |
| PASS | Userscript build and syntax | Rollup build; `node --check` |
| PASS | Python tooling suite | 279 executed: 278 passed, one existing optional skip |
| PASS | Artifact/release checks | Artwork --check, build-info --check, changelog --check, bundle contract (45 required symbols), git diff --check |
| PASS | Sidebar behavior fixtures | Four hide combinations, toggling, checkbox writes, repeated parses, migration once, multi-section/unknown/localized/channel handling |
| PASS | Native compilation and isolation | Kotlin 2.1.20-release-217; Java 17; Android API 34/build-tools 34.0.0; D8; relocated-stdlib execution probe |
| FAIL (host) | Native UpdateGuardsTest | Windows file-symlink canonicalization assertion; unchanged production policy/test |
| FAIL (host) | Native UpdateStorageTestKt | Windows cannot establish the denied-write permission fixture; unchanged test |
| FAIL (host) | Native UpdateReliabilityTest | Windows JDK pipe initialization cannot establish loopback connection; UTF-8 and IPv4 rerun did not resolve this |
| PASS | Static upgrade eligibility | Published 4.2 ARMv7 package/signature checked; versionCode increases 4020000 to 4030000; no installation |
| UNVERIFIED | Linux native test run | Required before treating this candidate as release-ready; host failures were retained, not skipped or weakened |
| UNVERIFIED | Physical Google TV | No ADB device connected; no installation attempted |

The Python suite was run unchanged with UTF-8 and a host runner that explicitly resolves Git Bash. Windows otherwise chooses its broken System32 WSL bash launcher before PATH. The native build uses the authoritative shell runner's source/class lists with Windows classpath separators and SDK launchers; its failing programs remain recorded in native-test-results.json. Additional source checks were not used to conceal native failures.

## Required device checks (all UNVERIFIED)

Confirm model, Android/API level, installed package `io.github.twoarchiver.ytark`, native ABI, candidate SHA-256 and compatible signing identity first. Do not uninstall or clear app/account data.

1. Signed-in, guest and available Kids guides: neither hidden, only Shorts, only Search, both hidden; toggle back; reload/restart; verify keyboard/query/results and Shorts playback.
2. Reorder, hide/unhide and repeat loads; verify no duplicate channel/settings rows, working Home/Library/subscriptions/channel shortcuts and stable remote focus.
3. Inspect rectangular banner and actual long-press surface; firmware may use the icon and launcher cache can delay artwork changes. No data reset workaround.
4. Search recommendations/results/movie cards and stock YouTube comparison; test DeArrow thumbnails and shrunken thumbnails independently on/off, including duration/title/focus preservation.
5. Cold/warm start, saved login/settings, ad blocking, SponsorBlock, DeArrow, remote navigation, seek/resume, audio sync, available 1080p/4K/codecs, network recovery and update install/cancel/permission return.

## Candidate usage limitation

The existing native engine fetches a userscript URL; the repacker does not embed the built userScript.js in the APK. The candidate points to reserved tag s44. That tag was not published, so installing the APK alone does not activate the new sidebar/thumbnail JavaScript. The separately supplied userScript.js is the tested 4.3 bundle. No speculative fallback injection was added. Publication or an explicitly configured supported test-script host is a separate step.

Read YTARK-4.3-APK-RESEARCH.md for the official APK investigation and candidate-artifacts.md for the final package/hash/resource checks. This candidate is not release-ready while native host failures and device checks remain unresolved.
