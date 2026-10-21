# YTArk 4.1.0 release-repair evidence

**Disposition:** repair candidate. Publication happens through the normal
`main` pipeline (`.github/workflows/build-apk.yml`); nothing in this branch
creates a release, tag or asset by hand. Device claims below stay NOT RUN.

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
