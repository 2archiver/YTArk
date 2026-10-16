# YTArk 3.5.1 evidence report

Status: **merged and published.** PR #60 (`arena/00129cb8-ytark`) was merged into `main` as
`fde2f3806bdb6fd497eaf1a62d800e082772e2a6`; release `v3.5.1` was published from that commit by
`.github/workflows/build-apk.yml` (run 38856497294, success) on 2026-10-16T05:38:03Z.

Nothing here shows that YTArk 3.5.1 installs on a TV, that the "install unknown apps" switch now
stays on for a real user, that an upgrade preserves the session, or that startup is measurably
faster. Those items are **NOT RUN** and are marked as such below.

The release notes say "experimental faster startup" on purpose: the option is off by default and
the change is narrow (see §4).

## 0. Evidence tables

### 0.1 Pull-request head (`efc7096d6791c6c3287cd7aadb2dc1ec95e6ea8f`)

| Item | Value |
|---|---|
| `ci.yml` validation run | https://github.com/2archiver/YTArk/actions/runs/38856169438 (success) |
| Candidate workflow run | https://github.com/2archiver/YTArk/actions/runs/38856169433 (`build-candidate.yml`, success, no publication) |
| Candidate APK | `YTArk-v3.5.1-armv7.apk`, SHA-256 `47373aaa782b863615fceb705934009569215bd2a557ca3c8cca0dde46ed1a5b` |
| Package / version | `io.github.twoarchiver.ytark`, versionCode `3050100`, versionName `3.5.1` |
| ABI | `armeabi-v7a` only |
| Signer | SHA-256 `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae`, equal to the pinned `signing/YTArk-cert-sha256.txt` (checked by `check-apk`) |
| `userScript.js` | SHA-256 `7735837a241bb8076abf97b61f58ee441d3f8712ac50343d66b22f0144e49d7a`, 802,399 bytes, script tag `s35` |
| Upgrade eligibility (static) | `eligible_armv7=true` against the previously published APK: package ID, ABI, versionCode 3050100 > 3050000 and permanent-signer checks passed. No install was run. |
| DeArrow live API probe | Informational only: 3 requests to `sponsor.ajay.app/api/branding/{prefix}`, all HTTP 200. |

The APK digest differs from the candidate run to the published run because APK signatures are
randomised and the publication job re-signs; the userScript digest is stable across both.

### 0.2 Published release `v3.5.1`

| Item | Value |
|---|---|
| Release | https://github.com/2archiver/YTArk/releases/tag/v3.5.1 ("YTArk 3.5.1", Latest) |
| Publication run | https://github.com/2archiver/YTArk/actions/runs/38856497294 (success, target commit `fde2f38`) |
| `YTArk-v3.5.1-armv7.apk` | 98,417,878 bytes, SHA-256 `0cb279e13163cbd2bd608495d1dc06aa34951cd9e2d72756e0ab1b9303da7093` |
| `userScript.js` | 802,399 bytes, SHA-256 `7735837a241bb8076abf97b61f58ee441d3f8712ac50343d66b22f0144e49d7a` |
| Other assets | `SHA256SUMS.txt`, `base-apk-sha256.txt`, `NOTICE.md` |

### 0.3 Compiled manifests (aapt and `tools/apk_manifest.py` agree in the same run)

| Package | versionCode | minSdk | targetSdk | install capability |
|---|---|---|---|---|
| Pinned base `reisxd/TizenTubeCobalt@v2.0.2` | 202 (`io.gh.reisxd.tizentube.cobalt`) | 24 | 36 | n/a (base) |
| Repacked candidate `work/ci-unsigned.apk` | 3050100 | 24 | 36 | **yes** |
| Previously published APK (`v3.5.0`) | 3050000 | 24 | 36 | **yes** |

Android grants the per-app unknown-sources authorization from the packaged manifest and from
device/profile policy. Both the 3.5.0 and 3.5.1 packages declare `REQUEST_INSTALL_PACKAGES`
uncapped and target API 36, so the package side of that question is satisfied for both; 3.5.1 does
**not** fix a target-SDK defect, because there was none (see §2 for what 3.5.1 does fix).

## 1. What is covered by automation

- `ci.yml`: full-sources Kotlin compile against the real API-34 `android.jar`, `D8`, the policy
  tests, an unsigned apktool repack round-trip, the JNI/dex contract, and the packaged-manifest
  and install-authorization check on the repacked candidate.
- `build-candidate.yml` / `publish-release.yml`: Kotlin compile, D8, repack, `zipalign -c -p 4`,
  signature and signer-identity checks, checksum verification, static upgrade eligibility, and
  the manifest/authorization gate on the signed artefact.
- Local sandbox on the PR head: 300/300 userscript tests, 234 Python tests (1 skipped), Kotlin
  policy and state tests, `npm run build`, bundle contract, workflow policy, shell syntax, and a
  full production-source compile against the real API-34 `android.jar`.

## 2. Why the previous build's switch appeared to reset

`ComputerEngine.canRequestPackageInstalls()` (AOSP `android14-release`) answers false for a
package that targets below API 26, false with the log line "Need to declare
android.permission.REQUEST_INSTALL_PACKAGES to call this api" for a package that does not declare
the permission, and otherwise reads `UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES(_GLOBALLY)` and
the `mExternalSourcesPolicy` hook. On Google TV, the "install unknown apps" screen
(`TvSettings/ExternalSources`) instead writes the per-package system AppOp
`android:request_install_packages` through `AppOpsManager`; for a profile that forbids unknown
sources that value does not survive, and no app can override it.

So the user-visible symptom had several distinguishable causes which the old screen collapsed into
"still off". 3.5.1 reports which one applies (`granted`, `target-too-old`,
`permission-not-declared`, `not-authorized`, `unreadable`), stops offering the Settings screen when
no screen can change the answer, and keeps the manual upgrade path in that case.

**This analysis is source-level reasoning (AOSP plus LineageOS/Google TV `TvSettings` sources), not
a device observation.** No TV was available in this environment, so the mapping from a specific
user's symptom to a specific cause is not confirmed by measurement.

## 3. Root causes fixed to reach green in this cycle

- `AppOpsManager.OPSTR_REQUEST_INSTALL_PACKAGES` is `@hide @SystemApi`, so it does not exist in the
  public `android.jar`; the updater failed to compile only in the full-sources job. The internal
  op name is now pinned as `InstallCapabilityPolicy.INSTALL_APP_OP = "android:request_install_packages"`,
  covered by the host-JVM tests, and no production source may read an `OPSTR_` SDK field.
- The new manifest step defined `$aapt` and then called the bare command, which is not on `PATH`
  on a runner: the step exited 127 before printing anything. Every call now uses the resolved path
  and a missing binary fails with an explicit `::error`.
- The 3.5.1 identity bump left stale userscript-suite expectations (newest changelog entry, About
  and build-metadata literals): repaired, and the About panel clips a highlight at 132 characters,
  so the 152-character 3.5.1 bullet was shortened rather than left truncating on a TV.
- The entry described "a faster startup path" and implied deferred work. The toggle is opt-in and
  narrow, so the summary and bullet now say "experimental faster startup" and describe exactly what
  it does.

## 4. What the faster-startup option actually does

`features/startupReadiness.js`, enabled by the off-by-default `fasterStartup` toggle
("Faster startup (Experimental)"): the optional mod-readiness poll runs every 50 ms instead of
250 ms for the first two seconds, then falls back to 250 ms, and stops at a successful readiness
tick or after 40 s. One timer, one initialization path. A crash leaves the
`ytark-faster-startup-in-progress` marker, which forces the next launch down the normal path once.
Essential readiness, session restoration and the engine/system splash are untouched.

Startup time was **not measured** on a device.

## 5. NOT RUN (honest boundary)

- Device install of `v3.5.1` on a TV; any device test at all.
- Permission flow on a device: granting via the TV Settings switch, returning to Updates,
  denial, deliberate re-entry, and whether the switch now holds for this package.
- In-place upgrade from a published build with session/account preservation.
- TV focus, D-pad navigation and layout of the reworded Updates screen.
- Measured startup time with and without the experimental toggle.
- DeArrow replacement visibility on a TV (unchanged from 3.5.0).
