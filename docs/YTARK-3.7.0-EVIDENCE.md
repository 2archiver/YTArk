# YTArk 3.7.0 candidate evidence report

Status: **review candidate on `arena/df3b8e45-ytark`; not merged, tagged, or
published.** The base is the current `v3.6.0` source. GitHub reports the stable
`v3.6.0` release published at `2026-10-16T14:57:10Z`; a live release-list and
remote-tag check found no `v3.7.0` release/tag or `s38` tag. No tag was created
or moved for this candidate. Physical-TV checks are **NOT RUN**.

## 1. Source findings, root cause, and uncertainty

### Settings guide entry and remote input

The v3.6 base already used a dedicated guide action because the TV frontend
resolves guide navigation endpoints during focus navigation, not only after OK.
Source review of that base found a remaining edge: the activation listener armed
a one-second token for **any** OK press, and the OK on the YTArk row was not
consumed. If another route did not promptly resolve a command, that unrelated
token could be reused by a later guide focus-resolution; the row's OK could
also continue to content underneath. The 3.7 patch arms only for the guide row,
consumes that row's explicit OK/Enter/click before opening Settings, and uses
the frontend's `.zylon-focus` guide marker when a remote event is targeted at
the document. Token checks and one-time listeners prevent a held or repeated
OK from stacking panels.

The pre-change global key handler also had no Settings-modal input owner for
Back or the red/green shortcuts. The patch tracks Settings-owned modals
separately from generic YTArk dialogs. While a Settings panel is open, Back is
routed through that panel's generated dismissal command; its D-pad/OK focus
controller remains in control, and detected stale focus behind the panel is
consumed and corrected. The red/green shortcuts cannot open another YTArk panel
behind Settings. Outside Settings, this owner does not consume ordinary remote
input; Shorts and playback routes are not disabled.

These are source-trace findings backed by Node/fake-DOM regression tests, **not
a physical reproduction**. The real TV DOM, remote event target, focus marker,
Back key mapping, and Cobalt popup/focus timing can differ by firmware; that
uncertainty remains until the device checklist below is run.

### About and diagnostics

About previously assembled a release-highlight wall from the installed
changelog. It now stays concise and keeps Changelog, Technical details,
Credits & licenses, and Project link as separate accessible destinations. Full
release history and legal attribution remain in the repository and in-app
routes.

The browser recorder remains opt-in and local. The default summary measures only
`ui-module-evaluated → controls-ready`—a userscript/UI-bootstrap proxy, not
Android process start, full YouTube readiness, playback readiness, or first
frame. A launch sample must be complete, monotonic, and have exactly one valid
start/end mark. Partial, active, truncated, timed-out, unsupported, invalid,
and missing-mark samples do not become zero or a reported duration. A timed-out
readiness poll is explicitly excluded; a user-cancelled or failed startup route
cannot enter the comparison cohort.

Comparisons require matching build version, script/base tags, startup
destination/reload definition, and the user's cold/warm label. The actual
readiness mode is recorded; a Faster-preference setting alone is not treated as
proof that Faster cadence ran. At least three complete comparable launches in
each mode are required before medians/differences appear. The UI recommends five
matched pairs, alternating normal and Faster launches. Cold/warm is a user
label, not detected by the app. The result is descriptive only and promises no
speedup. Browser diagnostics retain at most 20 bounded sessions locally, with
advanced event details separate from the concise summary; nothing is uploaded.

### Updater state and authorization

Source inspection found that a successful current result already reached an
idle state, but the UI reduced it to generic “Up to date” and kept the button
label “Check for updates.” The prior stale-cache path also hard-coded HTTP 403
for a rate-limit status. This does **not** establish that GitHub/network lookup
was the cause of a user-facing failure. The patch instead makes the successful
current result explicit (“You're on the latest version”), shows the installed
and structured latest compatible stable versions, clears preceding errors, and
keeps “Check again.” Installed-ahead is distinct; newer releases remain
available; API, metadata, asset, and rate-limit failures remain failures with
technical detail. A current result has no candidate, so the check path starts
no download or permission continuation. The separate existing fresh-page
authorization-entry policy is unchanged; it is not initiated by a current
result.

The existing install-authorization check and permission-return recheck remain
in place. This patch adds no signing workaround, uninstall, or local-data
clearing path. Clean-install success and in-place-upgrade success are separate
physical checks and neither is claimed here.

## 2. Candidate identity and release boundary

| Field | Candidate value |
|---|---|
| `versionName` / display | `3.7.0` / `3.7` |
| `versionCode` | `3070000` |
| Planned release tag / userscript tag | `v3.7.0` / `s38` (both verified absent remotely) |
| Package / ABI | `io.github.twoarchiver.ytark` / ARMv7 (`armeabi-v7a`) |
| Base engine | TizenTubeCobalt `v2.0.2` |
| Signing | Existing pinned community signing lineage; no identity change |

`CHANGELOG.md` now records the verified 3.6.0 publication timestamp and a new
unreleased 3.7.0 entry. Generated changelog, native release highlights, build
metadata, workflow identity checks, and release-contract tests match the 3.7.0
candidate. `docs/YTARK-3.6.0-EVIDENCE.md` is intentionally preserved as its
historical pre-publication snapshot.

## 3. README refresh and link audit

The README now uses a compact centered typographic hero, live published-release
link, issue link, Ko-fi text links, and the verified CI badge. It distinguishes
TizenTube/TizenTubeCobalt capabilities from YTArk additions, documents the
ARMv7-only package boundary and updater limitations, links to the privacy
notice, and includes FAQ, contribution, provenance, and unofficial-project
sections. It does not claim 3.7 is released or a Return YouTube Dislike feature;
no such integration was found in tracked source. No screenshots were available,
so none were added.

The Ko-fi target is confirmed by `settingsRegistry.js` and its branding test,
but the Ko-fi page itself could not be HTTP-checked because the sandbox only
permits outbound access to GitHub and package registries. The GitHub
`/stargazers` page returned 404, so the README uses a text action to the working
repository page instead of a badge. There is no root `LICENSE` and GitHub's
repository API reports no detected license, so no license badge is used. The
issue-creation URL is valid; GitHub reports issues enabled and the repository
has no issue templates. All relative README links resolve locally; GitHub
upstream/project pages and the CI badge target were checked. The displayed
latest-release route currently resolves to published `v3.6.0`.

## 4. Verification performed

- `npm ci --no-audit --no-fund` and full userscript suite `node --test tests/*.test.mjs`
  in `TizenTube/mods`: **363 passed, 0 failed, 0 skipped**.
- `npm run build`, `node --check TizenTube/dist/userScript.js`, and
  `python3 tools/check_bundle_contract.py`: passed; 45 required contract symbols.
  The generated `dist` bundle is ignored local build output, not a release asset.
- `python3 -m py_compile tools/*.py tools/tests/*.py`: passed.
- `python3 -m unittest discover -s tools/tests -v`: **248 tests; 247 passed,
  0 failed, 1 skipped**. The skip is the Java/Kotlin host runner; this sandbox
  has no host JDK.
- `python3 tools/validate_release.py check-version` against live GitHub release
  metadata: `3.7.0 (3070000)` exceeds the published `3.6.0 (3060000)` release.
- `python3 tools/apk_manifest.py --self-test`, generated changelog/build-info
  checks, `bash -n tools/*.sh`, and `git diff --check`: passed.
- The native runner was previously attempted with
  `bash tools/test_android_updater.sh /tmp/ytark-updater-tests` and stopped at
  `java: command not found`. Kotlin/Java updater tests are **NOT RUN**; the
  Python runner-wiring/static checks are not a substitute for them.
- Hosted PR CI and candidate-artifact workflow results are not represented as
  local test results. See the PR checks for hosted results after they run.

## 5. Physical-device checklist — every item **NOT RUN**

1. **Home, focus only:** open the Home guide, move focus past the YTArk entry
   without pressing OK, and verify Settings does not open.
2. **Home, deliberate entry activation:** focus the YTArk row and press OK once;
   verify exactly one Settings panel opens and the event does not activate
   content behind it. Press Back once; verify the panel closes and focus returns
   to a visible, valid Home guide target.
3. **Shorts, deliberate access:** open Shorts deliberately using the normal
   YouTube route. Navigate to the YTArk guide entry; focus alone must not open
   Settings, and OK must open one panel without starting, skipping, or changing
   the underlying Short. Back must restore a valid visible target.
4. **Panel ownership:** while Settings is open, test D-pad up/down/left/right,
   OK, and Back on the visible panel. Verify no event moves focus or activates
   content behind it; Back closes the current panel and returns to its intended
   parent/entry.
5. **Held/rapid input:** hold OK and Back, then open/close Settings repeatedly.
   Verify one activation/dismissal per press, no duplicate listener/timer/panel,
   no app exit from a held Back, and no stale focus after dismissal.
6. **Shortcut scope:** red/green keys inside Settings must not open color or
   other Settings panels behind it. Outside Settings, verify their normal
   behavior remains unchanged.
7. **Text entry and ordinary navigation:** in a Settings text-entry/IME panel,
   verify Enter and the first Back belong to the text surface; then verify
   ordinary Home and Shorts D-pad/OK/Back traversal and YouTube playback remain
   normal.
8. **About:** verify the compact About screen has no What's New wall, and its
   Changelog, Technical details, Credits & licenses, and Project link remain
   reachable by remote.
9. **Current updater result:** on a device running the current stable version,
   check that installed/latest versions and “You're on the latest version” are
   shown, “Check again” remains available, and no download/permission flow
   starts. Also verify newer, installed-ahead, and failure states separately.
10. **Clean install — separate test:** install on a clean device state, inspect
    the actual Android per-app install authorization, enter Android Settings
    only by explicit action, return, and verify authorization is rechecked. No
    install may occur without the user's explicit installer confirmation.
11. **In-place upgrade — separate test:** upgrade over an existing YTArk install
    with the same package/signing identity; verify existing app data/settings
    remain, authorization is rechecked after any Android Settings detour, and no
    uninstall or local-data clearing occurs.
12. **Faster startup measurements:** on the same TV and build, keep destination
    and reload settings fixed, choose one consistent user-labelled cold/warm
    class, and collect at least three complete comparable launches per actual
    mode (prefer five alternating matched pairs). Review medians only after the
    threshold; do not claim a benefit from the toggle or from mock samples.

No device result, startup-speed benefit, clean-install success, in-place-upgrade
success, or universal permission repair is claimed by this report.
