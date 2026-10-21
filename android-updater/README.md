# Kotlin updater (YTArk 3.7 development)

Production code is in `src/main/kotlin`. No Java updater implementation remains.
The existing Java host assertions compile against the Kotlin policies; additional
Kotlin tests exercise scheduling, state and pending-candidate identity.

## Build and host integration

This is a **custom Kotlin/JAR/D8/repack pipeline**, not Gradle:

- JDK 17, Kotlin 2.1.20-release-217 (npm archive locked with integrity), SDK 34,
  build-tools 34.0.0, min DEX API 24.
- `tools/build_android_updater.sh` packages Kotlin stdlib and the APK-verification
  core from build-tools' apksigner JAR. No coroutines, WorkManager, reflection or
  third-party UI framework is required. Apache-2.0 notices apply to Kotlin and
  Android apksig; their upstream licences are retained by their distributions.
- The pinned Cobalt `StarboardBridge.installAppFromURL(String): boolean` JNI
  signature is preserved. Its body is replaced by a call to Kotlin
  `NativeUpdatesBridge.open`. Only the exact `ytark://updates` sentinel is
  accepted; arbitrary URL installs are disabled. The bridge needs a foreground
  Cobalt MainActivity and can only open Updates, never download/install.
- There is no WebView interface, network command listener, companion package,
  exported screen or updater launcher. The existing Cobalt launcher stays intact.
- The repacker fails on an unexpected host method and round-trips every upstream
  smali class. Native libraries retain the existing fixed-length script-URL patch
  only. Final DEX inspection checks definitions, duplicate classes, runtime and
  the actual constrained JNI method body.

## Responsibilities and recovery

`UpdateRepository` bounds and validates GitHub release metadata/redirects.
`UpdateCoordinator` serializes application-scoped operations and exposes one
immutable state. `UpdateStore` writes one snapshot; validated paths are reconciled,
not trusted across launches. `UpdateStorage` holds the host-testable storage rules:
canonical containment under `filesDir`, a plain create/write/close readiness probe
(no fsync, no delete-as-failure), a stray blocker renamed rather than deleted,
saturating free-space arithmetic, an unknown capacity treated as unknown, typed
failure causes and bounded cleanup of updater-owned names only. `DownloadController`
restarts interrupted partial files rather than append unsafe ranges; a viewer cancel
keeps a resumable partial, and resume still requires matching metadata, a stored ETag
and a valid 206/Content-Range. The final rename falls back to a copy plus full
revalidation. `ApkValidator` checks checksum, all ZIP
CRCs, package, numeric version, SDK/ABI, APK cryptographic signatures and signing
lineage (including installed-data capability). The exposed community signing key
provides upgrade continuity, **not publisher authentication**; the canonical HTTPS
release and its published checksum remain required.

One JobScheduler ID (7280, retained from 3.0) handles 1 hour / 3 hours / Never.
Intervals are approximate. Foreground overdue checks wait 30 seconds; no release
fetch runs in provider initialization. Background downloads never launch Android UI.

Opening YTArk Updates checks actual install authorization and, on a fresh page
entry only, opens Android's permission screen once when authorization is missing.
API 26+ uses `PackageManager.canRequestPackageInstalls()` and
`ACTION_MANAGE_UNKNOWN_APP_SOURCES` with the real application ID. API 24–25 use
the legacy unknown-sources setting and Security route; unsupported/OEM routes
remain recoverable. Back or denial updates the page and never loops. The explicit
Allow installs action remains available, and this permission flow never starts a
download or installation.

`InstallCoordinator` still requires an explicit visible-page install action,
revalidates off main thread and persists the candidate-bound install request.
Permission is re-read immediately before handoff, including after Android Settings
returns. Installation uses Android's installer with a scoped, read-only
content URI and RETURN_RESULT. It retains the staged APK through cancellation and
never interprets a result code as success: installed package/version reconciliation
is authoritative. No runtime dangerous-permission prompt is used.

## Verification boundary

## Host storage tests

`tools/test_android_updater.sh` compiles the policy sources (including
`UpdateStorage.kt`) and runs `UpdateStorageTestKt` with the Java assertion classes.
The Kotlin suite uses real temporary directories for existing/absent/missing
directories, blocker files, failed `mkdirs`, denied writes, simulated
ENOSPC/read-only/security errors, unknown capacity, overflow, resume decisions,
symlinked ancestors, escaping directory links and bounded cleanup. The Java
`UpdateGuardsTest`/`UpdateReliabilityTest` cover the guard and error-mapping
contracts. None of this replaces a device run.

See `docs/YTARK-3.1-ACCEPTANCE.md` for the earlier acceptance boundary. Compilation/policy/DEX verification is not proof of Android system UI, Cobalt runtime, TV focus or login-preserving upgrades. The candidate's `s34` userscript endpoint becomes available only after authorized publication; neither script tags nor releases are published by branch CI.
