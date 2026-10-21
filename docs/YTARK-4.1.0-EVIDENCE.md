# YTArk 4.1.0 release-repair evidence

**Disposition:** published. `v4.1.0` was built and published by the normal
`main` pipeline (`.github/workflows/build-apk.yml`, run `39570786437`); no
release, tag or asset was created by hand. Section 5 records the live release
and section 6 records the one follow-up this repair left open. Device claims
below stay NOT RUN.

## 1. Why the 4.0 release run did not ship the merged 4.0 changes

Run `39564850373` (merge of PR #73) finished green, but it did not build or
publish a new APK:

- `release/version.properties` still identified `4.0.0` / `4000000` /
  `v4.0.0` / `s41`.
- The release plan therefore classified `v4.0.0` as **published-complete**
  and set `build_needed=false`.
- The build job was skipped.
- The publication job downloaded and verified the **existing** 4.0 asset
  instead of packaging the merged source.

Recorded identities:

| Item | Value |
|---|---|
| Published `v4.0.0` identity commit | `17bd00b5224d0dc72e4f8090af493147ba63d7cb` |
| Published `YTArk-v4.0.0-armeabi-v7a.apk` sha256 | `44520fd75934429ff4f92f3b3696265ab543386cb1e5e280edf132fe08ba6242` |
| Published `s41` userscript sha256 | `5df6793c104947e5474b524a3c1d00f13293b07c6fc674b557809d0c9d9cdc0f` |
| `main` after PR #73 | `7a4d73125ed722b941c4220efea9688ed735d8ea` |

This was a **stale release identity**, not a failed APK upload. The published
4.0 APK was built from the pre-PR-#73 source, so devices on 4.0.0 do not have
the updater-storage or startup changes; 4.1.0 is the first release that
contains them.

## 2. Repair contents

| Area | Change |
|---|---|
| Identity | `4.1.0` / `4010000` / display `4.1` / `v4.1.0` / `s42` |
| Generated metadata | `buildInfo.generated.js`, `changelog.generated.js`, `ReleaseHighlights.generated.kt` regenerated from the new identity and changelog |
| Changelog history | `4.0.0` restored to its real published date and release URL; PR #73 changes move to `4.1.0` |
| Publication guard | `require_unchanged_release_source()` in `tools/publish_release.py` |
| Tests | Five `PublishedSourceTests` cases; identity literals updated in the release-contract, changelog and UI tests |

### Publication guard semantics

`plan` and `publish` both refuse a verify-only success when the version is
already published by a *different* source commit and packaging inputs changed.

| Condition | Behaviour |
|---|---|
| Release identity commit equals the candidate commit | Allowed (exact-commit rerun, no API comparison) |
| Release identity missing or malformed | Refused (fail closed) |
| Compare status not `ahead`/`identical`, or no file list | Refused (fail closed) |
| Compare returns 300+ files (GitHub caps the list) | Refused (truncation cannot prove "unchanged") |
| Changed files only under `docs/`, `README.md`, etc. | Allowed (documentation-only verification) |
| `TizenTube/`, `android-updater/`, `tools/`, `release/`, `signing/`, `branding/`, `.github/workflows/` | Refused with an instruction to advance the identity |
| Renamed/deleted packaged input | Refused (`previous_filename` is checked too) |

## 3. Verification performed

| Check | Result |
|---|---|
| `python3 -m unittest discover -s tools/tests` | **PASS** — 271 tests, 3 existing environment skips |
| `cd TizenTube/mods && node --test tests/*.test.mjs` | **PASS** — 415 tests |
| `StateTestKt`, `UpdateStorageTestKt` (Kotlin 2.1.20, JRE 17) | **PASS** — presentation/state suites plus 100 storage checks |
| `python3 tools/build_buildinfo.py --check` | **PASS** — 4.1.0 (4010000) |
| `python3 tools/build_changelog.py --check` | **PASS** — 29 versions, newest 4.1.0 |
| `python3 tools/check_workflow_policy.py` | **PASS** |
| `python3 tools/check_no_secrets.py` | **PASS** |
| `git diff --check` | **PASS** |
| Read-only `publish_release.py plan --head-sha 7a4d731…` | `state=absent`, `action=create`, `build_needed=true` for `v4.1.0` |
| Live guard replay against the real `v4.0.0` release | **REJECTED** with the changed packaged files listed (the exact stale scenario) |

The live guard replay is read-only: it reads the published release body and the
compare API, and performs no mutation.

## 4. Honest boundary

- No physical-TV install, upgrade, permission-return, startup timing or
  playback run was performed for this repair. Those remain **NOT RUN**;
  the procedure stays in `docs/DEVICE-ACCEPTANCE.md` rows 91–96.
- No Android SDK exists in the authoring environment. The signed ARMv7 build,
  DEX/manifest gates and package inspection run in CI; a green CI run is not a
  substitute for a TV check.
- The guard prevents *this specific* stale-identity failure mode. It cannot
  prove that a future release plan is correct in every repository state; it
  fails closed on malformed, divergent or truncated comparisons.
- `s42` and `v4.1.0` must not be created, moved or overwritten by hand; the
  pipeline creates them from the verified candidate only.

## 5. Publication outcome

Run [`39570786437`](https://github.com/2archiver/YTArk/actions/runs/39570786437)
on `main@d13d4d9` finished with all four jobs successful: release guard,
exact-source CI validation, ARMv7 build/package check, and publication.

| Item | Published value |
|---|---|
| Release | `v4.1.0`, title `YTArk 4.1`, public, not draft, not prerelease, latest |
| Published at | 2026-10-21 08:45 UTC |
| Assets | exactly one: `YTArk-v4.1.0-armeabi-v7a.apk`, 98,467,030 bytes |
| APK sha256 | `88df8ee394c881db0c9322ba59f8e20242bb19b66602518df976ba5e6d416a82` |
| Identity marker `commit` | `d13d4d907aba0d52edcc83b41e736dce511495f4` |
| Identity marker `run_id` / `script_tag` | `39570786437` / `s42` |
| `s42` tag commit | `06fef2048ca0785e020f7608a8d37c42aa41d63d` |
| Userscript served by `s42` | 866,969 bytes, sha256 `5cec3a4ee0e5a6b8e9150cedf30030488a2dcc85c5f2a14cc20dc799b3285833` |

The immutable predecessors were only read, never touched:

| Item | Still |
|---|---|
| `v4.0.0` release | published 2026-10-20 17:51 UTC, tag at `17bd00b5224d0dc72e4f8090af493147ba63d7cb` |
| `YTArk-v4.0.0-armeabi-v7a.apk` | 98,462,934 bytes, sha256 `44520fd75934429ff4f92f3b3696265ab543386cb1e5e280edf132fe08ba6242`, asset timestamp `2026-10-20T17:51:13Z` |
| `s41` tag | still `6f6ee939dd1800694cb3540dd77168c917e1307b`, 863,817-byte bundle, sha256 `5df6793c104947e5474b524a3c1d00f13293b07c6fc674b557809d0c9d9cdc0f` |

The published release body carries the same identity marker (commit, run,
`s42`, userscript digest, `versionCode 4010000`) and no candidate-only
wording. `s42` therefore serves the bundle built by this run, not the 4.0
bundle; the two tag trees differ only in size and digest as listed above.

## 6. Open follow-up: the 4.1.0 changelog row is still marked unpublished

`CHANGELOG.md` writes `4.1.0` as `## [4.1.0] — Unreleased` with the line
"Not yet published. Candidate tag `v4.1.0` …", because the entry was authored
while the publication timestamp did not exist yet. The generated reader copies
that sentence into `facts` and leaves `status` as `unreleased`.

On a device running 4.1.0 the version row is labelled "Installed · this build"
(the installed version is always identified), but the facts sentence directly
under it still says "Not yet published", and the release-page action opens
`releases/latest` instead of the `v4.1.0` tag page. That text is wrong on every
4.1 installation.

Correcting it means changing the heading to a publication date, the blockquote
to `Published 2026-10-21 08:45 UTC as [YTArk 4.1](…)`, and regenerating
`TizenTube/mods/assets/changelog.generated.js` and
`android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/ReleaseHighlights.generated.kt`.
Those are packaged inputs, so the publication guard correctly refuses a
same-version verify-only success for such a commit and instructs the author to
advance the identity. The correction must therefore ship with the next identity
advance (for example 4.1.1), not as a standalone post-release commit. No attempt
was made to bypass that guard, hand-edit generated output, or weaken the
comparison.
