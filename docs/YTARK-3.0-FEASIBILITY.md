# YTArk 3.0 feasibility and blocker report

Prepared 2026-10-11 from the `arena/a39bb08d-ytark` session. This document records
what was checked. It does not claim that YTArk 3.0 has been built, signed, tested or
released, and no version, tag, release or APK was changed.

## Current state of the repository

| Item | Observed value |
|---|---|
| `release/version.properties` | `versionName=2.1.2`, `versionCode=2010200`, `scriptTag=s20`, `baseTag=v2.0.2` |
| Latest published YTArk release | `YTArk 2.1.2` (`v2.1.2`, Latest) |
| Android package | `io.github.twoarchiver.ytark` (must be preserved) |
| Signing certificate SHA-256 | `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae` (public community key, see `docs/SIGNING.md`) |
| Base runtime | TizenTubeCobalt `v2.0.2` APK, repacked by `tools/repack_apk.py` |

The current 2.1.2 APK is a repack of the upstream TizenTubeCobalt APK with a patched
userscript. It is not a source build, so it does not meet the brief's source-build
requirement.

## Upstream checks

- `youtube/cobalt` release `27.lts.3` (Evergreen 7.3.2, Starboard 18) is marked Latest,
  not a prerelease. Its 24 assets are Evergreen `.crx` packages and `libcobalt_*_unstripped`
  tarballs for `arm-hardfp` and `arm-softfp` (plus arm64, x64 in other releases).
  **No Android APK and no Android `armeabi-v7a` build artefact is published with 27.lts.3.**
  The brief itself warns that `arm-hardfp` and `arm-softfp` are not directly compatible
  with Android `armeabi-v7a`.
- `reisxd/TizenTubeCobalt` latest GitHub release is still `v2.0.2` (2026-05-17, "Synced
  with 27.lts"). Its `main` branch is at `505aa031a9150d9319508c71371801c9670a2763`
  ("feat: sync with 27.lts"), which is newer than the v2.0.2 tag. Using `main` would
  need its own review and pinning.

## Build environment checks

Measured from the sandbox:

| Requirement for a Cobalt Android source build | Result here |
|---|---|
| `github.com`, `api.github.com`, `codeload.github.com` | reachable |
| `registry.npmjs.org`, `pypi.org` | reachable |
| `storage.googleapis.com` (depot tools, clang, NDK/SDK artefacts) | **unreachable** (`000`) |
| `dl.google.com` (Android SDK repository) | **unreachable** (`000`) |
| `chromium.googlesource.com`, `gn.googlesource.com` (Chromium/Cobalt dependencies) | **unreachable** (`000`) |
| Java / Android SDK / NDK / GN / Ninja | not installed |
| CPU / RAM / disk | 2 vCPU, 3 GB RAM, 21 GB free |
| Physical Android TV / Google TV device | none available |

A Cobalt Android build needs the Chromium-based toolchain and Android NDK from hosts
that cannot be reached, and a build of that size will not fit in 2 vCPU / 3 GB RAM /
21 GB disk. The source-build requirement cannot be met inside this sandbox.

## Existing test baseline (unchanged code)

- `cd TizenTube/mods && node --test tests/*.test.mjs`: 83 tests, 83 pass, 0 fail.
- `python3 -m unittest discover -s tools/tests`: 41 tests, OK (1 skipped).

These pass on the 2.1.2 line. They are not evidence of the 3.0 runtime or of device
behaviour.

## Blockers to a real YTArk 3.0

1. **No Android Cobalt build artefact or source toolchain reachable.** Building the
   Android ARMv7 target from source needs `storage.googleapis.com`, `dl.google.com` and
   `*.googlesource.com`. None are reachable from this sandbox.
2. **No compatible Android ARMv7 runtime artefact at the latest tag.** 27.lts.3 ships
   Linux-style `libcobalt` builds and Evergreen CRX only. A port to Android `armeabi-v7a`
   (JNI, Starboard Android, NDK toolchain, storage paths) would have to come from the
   TizenTubeCobalt fork or be built by us. This needs review, not a version bump.
3. **No physical device.** The brief requires Google TV OS 14 acceptance, login
   preservation across an in-place upgrade, playback and remote navigation. None of this
   can be tested here.
4. **Signing key custody.** The pinned certificate is the public community key, which
   `docs/SIGNING.md` says is exposed. A release that replaces it breaks in-place upgrades,
   and a new key needs a documented migration. The private material is not in this
   repository and was not searched for.
5. **Storage migration unverified.** Cobalt storage layout between the 2.0.2 base and a
   27.lts runtime is not documented in this repository. Session preservation cannot be
   claimed until a representative-data migration test runs on a device.

## What was deliberately not done

- No version bump to `3.0.0`, no `versionCode` change, no tag, no release, no APK build.
- No renaming, repacking or substitution of Evergreen or `libcobalt` binaries.
- No change to the signing configuration or to the published 2.1.2 assets.
- No search for, or use of, private signing material.

## Options for the next step

- Provide a Linux build host with at least 32 GB RAM, 150 GB disk, 16+ vCPU, and
  network access to the Chromium/Cobalt toolchain hosts, plus a Google TV device for
  acceptance. Then the source-build track can start.
- Or agree a narrower interim milestone that stays on the existing TizenTubeCobalt v2.0.2
  base (for example, reproducible rebuild of the 2.1.2 userscript and updater), and
  label it honestly as not the 3.0 runtime.

## Interim milestone run (v2.0.2 base, not 3.0)

Run after the user chose the interim option. No version, tag or release changed.

- `TizenTube/mods`: `npm run build` run twice produced the same bytes.
  `dist/userScript.js` SHA-256 `b408d31fd60d2800e3b95b07f6fe2a284dfa1dea89851f93f1bc33aba0454fc6`
  (deterministic here; not compared with the published `s20` bytes).
- Native updater Java contract tests (`tools/build_android_updater.sh`) were **not run**:
  no JDK is available (`javac` absent; `default-jdk-headless` and every `openjdk-*-jdk-headless`
  name are missing from the apt index). These tests remain unverified here.
- Still not done: any 27.lts runtime work, the storage migration, the updater state-machine
  rework, and every device acceptance row.
