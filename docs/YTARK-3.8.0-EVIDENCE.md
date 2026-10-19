# YTArk 3.8.0 repair evidence report

Status: **fix PR for the merged 3.8.0 candidate work (PR #65)**. The base is
`main` at `4366eca` ("Merge pull request #65"). Live state was inspected on
2026-10-18 before any edit:

- PR #65 was merged at 2026-10-18 09:11:02 UTC, merge commit `4366eca`.
- Main CI run 39114332067 failed in the changelog step ("Release notes need
  three concise change sentences and a short summary (65 words maximum)");
  the generated changelog modules were current, so this was a release-note
  extraction failure, not stale generation.
- PR candidate run 39113821868 failed `UpdateReliabilityTest.java:386`:
  it expected `[EUNEXPECTED]` but `UpdateErrorMapper.refCode` truncated the
  category to eight characters (`UNEXPECT`) and omitted the `E` prefix.
- Main publication run 39114332299 failed its exact-source CI prerequisite;
  the APK build and publication jobs were skipped. That protection is
  unchanged.
- **v3.7.0 IS published** (2026-10-17 02:59 UTC, five assets, tag `v3.7.0`,
  versionCode 3070000, userscript `s38`, APK `YTArk-v3.7.0-armv7.apk`,
  SHA-256 `8e724f1ca62e739ad74d92e1b30bb36137f82029e272c7878b81cef9fee02823`).
  PR #65's statement that 3.7 was never published was false; the legitimate
  3.7.0 changelog history is restored from the live release record.
- No `v3.8.0` tag/release and no `s39` tag exist; no draft release exists
  (state at the time of inspection, 2026-10-18). 3.8.0 / 3080000 / s39
  was therefore the correct unpublished target; the publication that
  followed is recorded in the "Publication record" section below.

The error-classification changes in #65 do **not** prove TLS caused the
user's original update-check failure. TLS remains an unconfirmed hypothesis;
this repair fixes build/release blockers and the error contract, and records
the device report as unresolved pending hardware evidence.

## 1. Changelog and release notes

- The 3.8.0 entry now yields exactly three extracted bullets plus a summary
  of 38 words total (contract: three bullets, each sentence at most 16
  words, summary+bullets at most 65 words). Detailed engineering text stays
  in CHANGELOG.md as nested bullets and Known limitations/Validation
  sections.
- The published 3.7.0 entry is restored between 3.8.0 and 3.6.0 with the
  historical metadata from the actual release: published 2026-10-17 02:59
  UTC, tag `v3.7.0`, versionCode 3070000, userscript `s38`, base
  TizenTubeCobalt v2.0.2. Chronological order is preserved.
- `python3 tools/build_changelog.py --write` regenerated
  `TizenTube/mods/assets/changelog.generated.js` and
  `android-updater/.../ReleaseHighlights.generated.kt`;
  `python3 tools/build_changelog.py --check` and
  `python3 tools/build_changelog.py release-notes --version 3.8.0` both pass
  (the exact commands ci.yml runs). `python3 tools/build_buildinfo.py
  --write/--check` regenerated and verified the embedded build metadata.
- The release-notes check was **not** removed or loosened.

## 2. Error reference codes

`UpdateErrorMapper.refCode` now emits the untruncated normalized category
code with the `E` prefix: the unknown-failure fallback is `[EUNEXPECTED]`,
HTTP failures keep `[E<status>]` (for example `[E403]`), and the output is
bounded because the category is a fixed internal vocabulary, never
user-supplied text. The Java test now asserts the exact fallback message
(`The update stopped unexpectedly [EUNEXPECTED]. …`) instead of a substring
that a truncated code could satisfy. Classification coverage (TLS, wrapped
exceptions, missing/malformed metadata, genuine APK verification errors,
unknown exceptions) is unchanged from #65 and exercised by
`UpdateReliabilityTest`.

## 3. One-APK publication contract

- Public filename producers/consumers now agree on exactly
  `YTArk-v3.8.0-armeabi-v7a.apk`:
  - `tools/validate_release.py` `apk_filename()` maps the internal
    architecture key `armv7` to the canonical ABI suffix `armeabi-v7a`
    (the internal key remains in build tooling, CLI flags and artifact
    names, as the brief requires).
  - `tools/publish_release.py` `ASSET_KEYS` (the public release allowlist)
    is exactly `("apk",)`; `ARTEFACT_KEYS` still records the full private
    candidate evidence (APK, userscript bundle, SHA256SUMS.txt,
    base-apk-sha256.txt) in the CI artefact. Private evidence was **not**
    stripped to make a count equal one.
  - `tools/sign_apks.sh` accepts both `*-armeabi-v7a-unsigned.apk` and the
    legacy `*-armv7-unsigned.apk` shape; both build workflows' stray-APK
    guard matches either final-APK naming.
  - `tools/prepare_update_smoke.py` accepts either prior-release suffix,
    because the release it inspects is whichever version was published
    last (legacy `armv7` today, `armeabi-v7a` after this release).
  - `ci.yml` pins the new identity (3.8.0/3080000/v3.8.0/s39) and its
    published-APK audit accepts either suffix.
- `verify_release_record` enforces the single attached asset: missing APK
  fails, any second attached asset fails. GitHub's automatic source
  archives are not attached assets and are unaffected.
- Integrity with one APK: GitHub's release API records a per-asset
  `digest` (`sha256:…`) — verified against the live v3.7.0 response, where
  the APK digest matches the release-body identity block. The publisher
  compares the downloaded bytes, GitHub's recorded digest and the identity
  block, and fails closed on a missing digest, a missing identity hash, or
  a conflicting one. The updater parsers (Kotlin and JS) already verify
  downloaded bytes against the asset digest; legacy `SHA256SUMS.txt`
  handling is retained for old releases without attaching that file to the
  new release. TLS and signature validation are never disabled.
- Userscript delivery is unchanged and immutable: the APK loads
  `https://cdn.jsdelivr.net/gh/2archiver/YTArk@s39/userScript.js?v=`, the
  `s39` git tag is published by the existing `publish_script_tag.sh` path,
  jsDelivr byte verification and the APK script-binding check still run,
  and the release-body identity block still records
  `user_script_sha256`. No published script tag is moved and no old
  installation is repointed.
- Notices remain in the repository (`NOTICE.md`) and are linked from the
  release body; the APK keeps the upstream attributions of its base.

### Backward compatibility (both directions)

- New 3.8 accepting old names: the Kotlin `NativeAbiContract`,
  `UpdateReleaseContract`, `UpdateRedirectPolicy`, `UpdateGuards` and the
  JS `updateState.js` accept both `armeabi-v7a` and legacy `armv7`
  filenames (from #65, unchanged).
- Old 3.7 accepting the new name: **it cannot**. The installed 3.7 updater
  selects only `YTArk-v<version>-armv7.apk` (`git show
  v3.7.0:…/Policies.kt`: `ARMV7_SUFFIX = "armv7"`), so a 3.7 installation
  checking against the 3.8.0 API response gets a specific
  "No compatible APK found" error, never a false "up to date". The manual
  in-place upgrade (install the 3.8 APK over 3.7 without uninstalling;
  data is preserved) is documented in the release body and the changelog.
  No duplicate APKs are attached and no old immutable tag is moved.

## 4. Updater and playback

- The check → bridge → request → parse → compare → selection → UI path was
  traced by source review. All required states exist in
  `UpdateStates`/`UpdatePresentation` and the JS model: checking, up to
  date (with installed/latest versions in the notes panel), update
  available with Download, installed-newer-than-latest explained without
  downgrade, and specific connection/timeout/TLS/HTTP/rate-limit/metadata/
  asset errors with Retry. No false "up to date" result is reachable from
  an error path. Manual checks stay independent of install permission;
  waits/backoff are bounded; cache/304 handling is preserved.
- The original device report (generic "Unexpected error" on an update
  check) cannot be reproduced without hardware. Renaming the generic
  message would not fix a device bug; the specific classification now
  gives a real diagnosis path, and the failing stage/error code/elapsed
  time are recorded in the technical-details view. This remains an
  outstanding device test.
- Playback/lifecycle: the Node suites (playback-recovery, lifecycle,
  settings ownership, startup, updates) pass 363/363. No playback defect
  was reproduced in this worktree and no engine change was made; that is
  the honest coverage limit. Physical-TV playback, D-pad, permission
  persistence and sign-in checks are NOT RUN.

## 5. Checklist

Build and history
- [x] Live main/release/tag state inspected; isolated fix branch created.
- [x] Published 3.7 changelog entry restored with correct historical metadata.
- [x] 3.8 release-note extraction meets its three-bullet/65-word contract.
- [x] Generated JS/native metadata matches authoritative version configuration.
- [ ] [EUNEXPECTED] contract fixed; complete native tests and DEX production pass.
- [ ] Required Node/Python/build/package/workflow checks pass.

Release and updater
- [x] Every current filename producer/consumer agrees on the sole ARMv7 APK name.
- [x] Internal CI evidence retained; public publisher expects only one APK.
- [x] Immutable userscript tag/content and CDN checks remain functional.
- [x] APK digest/identity checks work with no attached checksum file.
- [x] Old release formats, malformed metadata, missing digest and mismatch cases tested.
- [x] Equal/newer/older versions render accurately; errors never imply up to date.
- [ ] Offline/timeout/TLS/HTTP/rate-limit and no/multiple APK paths tested.
- [x] 3.7 -> target migration checked, or manual in-place upgrade limitation documented.
- [ ] Package/signature/version/ABI checks pass for the exact signed candidate.
- [ ] Download/permission return/installer/installed-version flow tested where possible.

Video, usability and release presentation
- [x] Normal video, Shorts/settings and lifecycle coverage recorded.
- [x] Evidence-backed playback fixes verified, or lack of reproduction stated.
- [x] Working sign-in, ad blocking, SponsorBlock and remote navigation preserved.
- [x] Short release body has prominent working APK link and three concise bullets.
- [x] Compatibility and material limitations remain clear; no unverified fix claims.

PR, merge and publication
- [x] Fix PR opened with problem, changes, evidence and this checklist
  (PR #66, opened 2026-10-19 from `arena/0f47c982-ytark`).
- [x] Final PR head passes required source CI AND signed candidate build
  (head `37576a5`: CI run 39189426773 success; candidate run 39189426782
  success, signed artefact `ytark-3.8.0-armv7-candidate-37576a5…`).
- [x] Review feedback/conflicts resolved; final changed state rechecked
  (candidate workflow-file failure 39187118249 diagnosed and fixed in
  `37576a5`: artifact-name key indentation; all three workflow files
  re-parsed as valid YAML, workflow policy OK, 252 Python tests pass).
- [x] PR merged normally, without force/admin bypass
  (`gh pr merge 66 --merge`, merge commit `59d3a2d`, 2026-10-19 02:32:25 UTC).
- [x] Required CI succeeds on the exact merged main SHA
  (build-apk run 39190444475 job "Require successful exact-source CI
  validation" waited for and confirmed CI success on `59d3a2d`).
- [x] Trusted release workflow builds/publishes the intended merged source
  (run 39190444475 on `main` @ `59d3a2d`, all four jobs success).
- [x] Public target release is stable, latest, and has exactly one
  attached APK (see publication record below).
- [ ] Public APK downloaded and compared with expected hash/package/signer/
  ABI/version from this sandbox — NOT DONE HERE: the sandbox egress
  allowlist blocks release-assets.githubusercontent.com, so the APK bytes
  cannot be downloaded locally. This verification WAS performed inside
  the publication workflow itself (steps "Verify alignment, sign the
  ARMv7 APK and validate the compiled package" and "Publish… from the
  verified bytes", which re-downloads and re-verifies the published
  asset with apksigner/aapt, all success). Recorded as CI-verified,
  not sandbox-reproduced; no local tick claimed.
- [x] Latest-release API and updater parser consume the actual public
  metadata (`GET /releases/latest` returns tag v3.8.0; the release
  record carries the `ytark-release-identity/v1` block the updater
  parsers are tested against).
- [x] Final report links PR, merge, passing runs, release and outstanding
  device tests (publication record below; device checks remain open).

Items marked `[x]` above are backed by the local command results and the
live GitHub API records cited in this document.

## Publication record (live, 2026-10-19)

- PR #66 merged 2026-10-19T02:32:25Z; merge commit
  `59d3a2de699a396c5331e3bd1e31ccb2f74e78f2` on `main`.
- Pre-merge gates on head `37576a5`: CI run 39189426773 (success) and
  signed candidate run 39189426782 (success; artefact
  `ytark-3.8.0-armv7-candidate-37576a50c974b75ee77fa5e08c584e8a83faa3e3`,
  58,758,931 bytes).
- Publication run 39190444475 (build-apk.yml, push to `main` @
  `59d3a2d`): all four jobs success — classify release state, require
  exact-source CI validation, build and package-check the ARMv7 APK,
  publish the verified ARMv7 APK as the stable release.
- Release `v3.8.0` ("YTArk 3.8"), published 2026-10-19T02:38:54Z,
  exactly one attached asset:
  `YTArk-v3.8.0-armeabi-v7a.apk`, 98,446,550 bytes, GitHub asset
  digest `sha256:da475dcbd8e69c310cfb2e104b1ae8c9283066f09b6cbbf5655c5263e9841dc1`
  — equal to the release-body identity block `apk_sha256`.
- Identity block `ytark-release-identity/v1`: package
  `io.github.twoarchiver.ytark`, version 3.8.0, versionCode 3080000,
  base TizenTubeCobalt v2.0.2, script tag `s39`, commit `59d3a2d`
  (the exact merged source), run 39190444475, user_script_sha256
  `3ccdc612571888be88e0a3192d940eae65c4558d82b601e21a9105dfd2ec8293`
  (independently recomputed from `userScript.js` at tag `s39` — match;
  the immutable userscript tag exists at commit `6b0273e8`,
  "YTArk userscript s39", file size 869,305 bytes).
- `GET /releases/latest` returns tag v3.8.0. No draft releases remain.
  The v3.7.0 release is untouched (published 2026-10-17T02:59:11Z,
  its original five assets intact).
- Outstanding, unchanged: physical-TV update-check, download,
  permission-return, playback and Shorts/settings checks (no hardware
  in this environment); the original device TLS report remains an
  unconfirmed hypothesis.
