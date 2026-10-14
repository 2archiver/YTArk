# Kotlin updater (3.1 candidate)

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
not trusted across launches. `DownloadController` restarts interrupted partial
files rather than append unsafe ranges. `ApkValidator` checks checksum, all ZIP
CRCs, package, numeric version, SDK/ABI, APK cryptographic signatures and signing
lineage (including installed-data capability). The exposed community signing key
provides upgrade continuity, **not publisher authentication**; the canonical HTTPS
release and its published checksum remain required.

One JobScheduler ID (7280, retained from 3.0) handles 1 hour / 3 hours / Never.
Intervals are approximate. Foreground overdue checks wait 30 seconds; no release
fetch runs in provider initialization. Background downloads never launch Android UI.

`InstallCoordinator` requires an explicit visible-page action, revalidates off
main thread and persists the candidate-bound permission request. It checks
`canRequestPackageInstalls()` on API 26+, uses the package-specific special
Settings screen, consumes continuation once, and checks visibility again before
handoff. Installation uses ACTION_INSTALL_PACKAGE with a scoped, read-only
content URI and RETURN_RESULT. It retains the staged APK through cancellation and
never interprets a result code as success: installed package/version reconciliation
is authoritative. No runtime dangerous-permission prompt is used.

## Verification boundary

See `docs/YTARK-3.1-ACCEPTANCE.md`. Compilation/policy/DEX verification is not proof
of Android system UI, Cobalt runtime, TV focus or login-preserving upgrades. The
candidate's `s30` userscript endpoint becomes available only after authorized
publication; neither script tags nor releases are published by branch CI.
