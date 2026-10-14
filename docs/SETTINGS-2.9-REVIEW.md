# YTArk 2.9 settings patch — historical review

> Historical record for the unpublished 2.9.0 / s28 draft. Superseded by [`SETTINGS-2.9.1-REVIEW.md`](SETTINGS-2.9.1-REVIEW.md); the test counts, branch name and blocker notes below are not evidence for the 2.9.1 candidate.

## Scope and release status

This is a **partial implementation for review, not a device-verified release**. Work remains on the requested definition of done. No GitHub release, tag, push, or PR was created. The existing session branch is `arena/3bc2a2cd-ytark`.

The checkout initially targeted unpublished 2.8.0 / 2080000 / s27. Per the requested 2.9 target, packaging metadata now targets **2.9.0 / 2090000 / s28**. The unpublished changelog entry was advanced, not a published release rewritten. Package identity, certificate configuration, ARMv7 architecture and TizenTubeCobalt v2.0.2 base are unchanged. Actual signed upgrade continuity still needs installation testing.

`release-notes.md` is a proposed draft. It intentionally does not claim the system IME, native routes, installer or all-page OLED are fixed.

## Baseline before edits

- 283 JavaScript tests passed. These use a simulated frontend/DOM, not Android TV.
- Search already had a real DOM input, local registry search, Back handling, and a remote key grid. Input Enter dismissed the panel. The pinned bridge has no implemented native IME channel in this repository; only a feature-detected VirtualKeyboard API request and focus were used.
- Cache and Updates already had registry submenus, native Android activities and `ytark://` manifest routes. Assigning a custom URL in JavaScript does not establish that Cobalt invokes Android's intent dispatcher. No device reproduction was possible.
- Native cache cleanup already restricted traversal to cache roots and retained recent/unknown-age files. Obsolete update cleanup lacked confirmation and protected only one of the pending/selected releases when they differed.
- Updater already owned release discovery, ABI selection, resumable downloads, verification, install permission, installer hand-off and scheduling. It was not replaced.
- OLED already had scoped selectors, a managed stylesheet and bounded lifecycle observers. Surface background images could cover the overridden background color. Matching every real YouTube surface remains unverified.
- About omitted unknown frontend versions and missed the standard `INNERTUBE_CONTEXT.client.clientVersion` shape. The YouTube frontend is service-delivered, not a bundled fixed frontend build. TizenTubeCobalt's base tag is not the Cobalt engine version.
- Release tooling copied extensive technical changelog and installation material into the release body.

## Changed implementation units

### Search / TV layout

`ui/textEntryOverlay.js`, `ui/settingsSearch.js`, `ui/appearanceStyles.js`:
- Input OK requests supported keyboard channels instead of submitting. Done on the remote key grid submits; Back preserves the query using the existing path.
- Repeated OK does not repeatedly type/submit keys.
- Actual visual key rows now match the six-row DPAD model rather than arbitrary flex wrapping.
- Panel width includes padding; height is constrained to 90vh with scrolling for small viewports and longer labels.
- Existing listener teardown, search ranking, aliases, dynamic registry indexing and preference storage are retained.

**Not implemented:** an Android EditText-to-Cobalt IME bridge. A missing VirtualKeyboard API still uses the remote key grid. Device testing must determine whether platform input focus opens the Google TV IME.

### Cache / updater

`StorageActivity.java`, `UpdateActivity.java`, `YtarkUpdater.java`, `UpdateGuards.java`:
- Added confirmation before obsolete update-file removal, with Cancel initially focused.
- Separate measured update-directory bytes from app-cache bytes; identify partial measurements and unavailable data. Other app data is explicitly not measured or cleared.
- Protect both the pending installer APK and selected resumable release and reject redirected cleanup directories/files.
- Stable activity control IDs survive recreation. Storage restores focus after re-enabling controls. Update permission-return intent is saved across recreation.
- Existing update verification/install pipeline and scheduling are retained.

**Not implemented:** a verified replacement for custom-scheme dispatch in Cobalt; a new foreground lifecycle scheduler; removal of selected/pending update packages. The last is deliberately not offered as an unsafe cleanup workaround. Existing JobScheduler checks are best-effort and can be deferred by Android.

### OLED

`ui/appearanceStyles.js`: disable background images only on the existing enumerated OLED surfaces/dialogs. The root class still gates all OLED rules, so disabling OLED restores the existing theme/custom colors. No broad video/image selectors or new scanning observer were added.

**Not implemented:** additional device-derived selectors proving coverage of home, watch, library, subscriptions and every menu. Native activities retain their existing colors; they do not yet share the web OLED preference. This is a targeted repair, not proof of full OLED completion.

### Navigation and About

`ui/settingsRegistry.js`, `ui/ytarkActions.js`, `ui/ytSettingsEditor.js`, `ui/customYTSettings.js`, `features/appVersion.js`:
- Removed the redundant editor row and its edit/move/hide/pin command handlers.
- Retained legacy layout application, stored layout/catalog preferences, and the scoped restore confirmation. Retiring the editor must not silently erase user choices or strand hidden sections.
- Legitimate YouTube Settings and sidebar customization remain.
- Frontend version is a separate labeled field, with `Unavailable` when not reliably reported. Standard runtime client metadata is recognized.
- Cobalt engine version/commit is explicitly unavailable; the verifiable Android base tag remains in Build details. No public YouTube release version is substituted.

### Release tooling

`tools/build_changelog.py`, `tools/render_release_notes.sh`, `.github/workflows/ci.yml`, `release/version.properties`, generated metadata/changelog and contract tests:
- Summary extraction prefers three short whole change sentences. It fails rather than truncating claims if three concise items and a <=65-word summary block cannot be generated.
- Release body uses that block, one ARMv7 asset link, short compatibility guidance and a known-issues line. Package/versionCode metadata needed by updater/release validation is retained in an HTML comment.
- Build/upload/publish automation remains enabled and unchanged in ownership. No publishing workflow was run.
- CI bundle checks require the retained restore command instead of the removed editor command; version assertions now target 2.9.
- The root release-note draft is no longer ignored by Git.

The full changelog reader remains available on explicit selection. A complete remaster of the in-app What's New presentation was not implemented.

## Automated validation actually run

| Check | Result |
|---|---|
| Baseline JavaScript tests | 283 passed |
| Final `node --test tests/*.test.mjs` | **281 passed**, 68 suites |
| `npm run build` | **Passed** |
| `node --check TizenTube/dist/userScript.js` | **Passed** |
| `python3 -m unittest discover -s tools/tests` after building bundle | **126 passed**, no skips |
| Build metadata and changelog `--check` | **Passed**, 2.9.0 / 2090000 |
| Workflow policy check | **Passed** |
| `bash -n tools/*.sh` | **Passed** |
| APK repacker `--self-test` | **Passed**; synthetic packaging, not an APK build |
| `git diff --check` | **Passed** |
| Java host contract tests | **Not run**: `javac` unavailable. Added dual-release cleanup regression assertions but did not execute them. |
| Android updater / DEX / signed APK build | **Blocked**: Android SDK absent; build script reports `ANDROID_HOME is required`. |
| Android TV / Google TV / ARMv7 / visual viewport test | **Not run**: no device/emulator available. |

Three old editor-interaction tests were removed with the retired implementation; one retired-handler rejection test was added. Search, theme, frontend metadata, legacy layout restoration and release-format assertions were updated/extended. Existing migration, ABI, update-state, Back/focus, lifecycle and release contract suites remain.

Rollup reports existing circular imports, stale Browserslist data, and the replace-plugin default warning. There is no dedicated lint/type-check script in the userscript package. Python publication tests use mocked GitHub commands; their simulated publication messages are not real releases.

## Requested-feature checklist

“Verified” below means automated verification only, never a physical-device claim.

| Request | Status | Remaining boundary |
|---|---|---|
| 1. Search filtering / real input / Back / DPAD | **Verified** for simulated input/query/result flow; **Needs Device Test** for IME | Native IME bridge **Not Implemented** |
| 2. Cache/storage submenus and safe operations | **Needs Device Test** | Native route dispatch and actual filesystem deletion not executed; native changes not compiled here |
| 3. Updater control menu / install / ARMv7 | **Needs Device Test** | Existing pipeline preserved; permission-recreation repair uncompiled; dedicated foreground scheduler **Not Implemented** |
| 4. OLED across YouTube | **Verified** scoped CSS/lifecycle assertions; **Needs Device Test** | Full surface coverage and coherent native activity theme **Not Implemented** |
| 5. Navigation cleanup | **Verified** removal and retained legacy restore | Confirm legitimate YouTube Settings with remote |
| 6. About version accuracy | **Verified** known/unknown runtime metadata behavior | Confirm runtime fields on installed frontend; Cobalt engine version remains unavailable |
| 7. General settings remaster | **Verified** targeted search/navigation changes; **Needs Device Test** | Exhaustive screen/entry audit **Not Implemented** |
| 8. Additional TV quality | **Verified** key-row model and existing teardown/migration tests; **Needs Device Test** | Full 720p/1080p, overscan, localization and permission-focus acceptance outstanding |
| 9. Release notes | **Verified** concise extraction/body contract; draft prepared | No publication; comprehensive in-app summary remaster **Not Implemented** |
| 10. Validation / guardrails | **Verified** source tests/builds listed above | Native compilation and A–G device acceptance remain outstanding |

## Manual acceptance steps (required before calling this complete)

1. Build signed ARMv7 APK in the configured CI/Android environment. Confirm package ID, versionCode 2090000, signer and `armeabi-v7a` libraries; install in place over an existing signed build, without uninstalling. Check sign-in, settings and playback survive.
2. At 1280×720 and 1920×1080, with overscan enabled, open Settings Search using DPAD. Check that the **system** keyboard appears (record whether it does). Type mixed-case title/description/category terms, OLED and install; delete, clear and search for no matches. Submit via Done, select results, toggle twice, use Back and verify origin focus. Hold OK and navigate without activating adjacent rows. Repeat with long localized labels and an external keyboard.
3. Select both native settings routes from playing/paused YouTube. If no native activity opens, record Cobalt navigation behavior; manifest routes alone are not sufficient. Do not mark menu routing fixed.
4. Measure cache/update storage, cancel each confirmation with Back, repeat and confirm. Check counts refresh and partial/error states are truthful. Test unreadable files, symbolic links, recent timestamps, pending installer plus a different resumable download, and active download. Confirm cookies/preferences/offline data and sign-in remain.
5. Check updates offline, online, with no newer release, and with a compatible newer signed APK. Test repeated OK, wrong ABI/package/signature, corrupt/empty download, low disk space, cancel/resume and progress. Only the official updater should own transfers.
6. Revoke unknown-app permission, request installation, enter Android Settings, recreate the updater activity if possible, grant permission and return. Verify exactly one Android installer hand-off; cancel installer and verify current version is not reported as updated. Then install and verify version/session persistence.
7. Toggle OLED on/off without reloading during home, search, subscriptions, library, watch, sidebar and dialogs, including lazy-loaded content. Inspect primary backgrounds for #000000; confirm video/artwork/captions/focus remain intact. Restart and verify preference persistence and off-state restoration. Native screens currently keep their independent palette.
8. Enable hourly checks, background/foreground the app, repeat navigation and inspect actual check times for duplicate concurrent checks. Android may defer scheduled jobs; do not advertise exact background hourly execution.
9. Check About offline and after frontend navigation. Confirm unavailable values stay explicit and neither the Android base tag nor latest public YouTube version is mislabeled as installed frontend/Cobalt version.
