#!/usr/bin/env bash
# Custom Kotlin -> class JAR + pinned runtime -> D8 -> repacker pipeline; no Gradle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/kotlin_toolchain.sh"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
API_LEVEL="${API_LEVEL:-34}"
BUILD_TOOLS="${BUILD_TOOLS:-34.0.0}"
OUT="${1:-build/updater/classes.dex}"
PLATFORM="$ANDROID_HOME/platforms/android-${API_LEVEL}/android.jar"
D8="$ANDROID_HOME/build-tools/${BUILD_TOOLS}/d8"
[ -f "$PLATFORM" ] || { echo "Missing SDK platform: $PLATFORM" >&2; exit 1; }
[ -x "$D8" ] || { echo "Missing D8: $D8" >&2; exit 1; }
CERT_SHA256="$(grep -v '^[[:space:]]*#' "$ROOT/signing/YTArk-cert-sha256.txt" | tr -d '[:space:]:' | tr '[:upper:]' '[:lower:]')"
[[ "$CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || exit 1
SOURCE="$ROOT/android-updater/src/main/kotlin"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
bash "$ROOT/tools/test_android_updater.sh" "$WORK/tests"
mkdir -p "$WORK/dex" "$WORK/apksig"
# Reuse the pinned Android build-tools verifier library, excluding its desktop CLI.
# Its Java-8 core is DEXed into the app; no Gradle/resources/coroutines are needed.
APKSIGNER_JAR="$ANDROID_HOME/build-tools/${BUILD_TOOLS}/lib/apksigner.jar"
[ -f "$APKSIGNER_JAR" ] || { echo "Missing SDK APK signature verifier" >&2; exit 1; }
(cd "$WORK/apksig" && jar xf "$APKSIGNER_JAR" com/android/apksig)
jar cf "$WORK/apksig.jar" -C "$WORK/apksig" com

printf 'package io.github.twoarchiver.ytark.updater\nobject UpdaterBuildConfig { const val CERT_SHA256 = "%s" }\n' "$CERT_SHA256" > "$WORK/UpdaterBuildConfig.kt"
mapfile -t SOURCES < <(find "$SOURCE" -type f -name '*.kt' -print | sort)
"${KOTLINC[@]}" -jvm-target 1.8 -no-reflect -classpath "$PLATFORM:$STDLIB:$WORK/apksig.jar" \
  -d "$WORK/updater.jar" "${SOURCES[@]}" "$WORK/UpdaterBuildConfig.kt"
# D8 performs language desugaring. Only stdlib is used (no coroutine/framework dependency).
"$D8" --release --min-api 24 --lib "$PLATFORM" --output "$WORK/dex" "$WORK/updater.jar" "$STDLIB" "$WORK/apksig.jar"
[ -s "$WORK/dex/classes.dex" ] || { echo "D8 produced no classes.dex" >&2; exit 1; }
[ "$(find "$WORK/dex" -name '*.dex' | wc -l)" -eq 1 ] || { echo "Unexpected updater multidex; update injector before shipping" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
cp "$WORK/dex/classes.dex" "$OUT"
echo "Full Kotlin Android compilation and D8 passed: $OUT"
