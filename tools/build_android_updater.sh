#!/usr/bin/env bash
# Compile the native updater into a DEX that is injected into each repacked APK.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
API_LEVEL="${API_LEVEL:-34}"
BUILD_TOOLS="${BUILD_TOOLS:-34.0.0}"
OUT="${1:-build/updater/classes.dex}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="$ANDROID_HOME/platforms/android-${API_LEVEL}/android.jar"
D8="$ANDROID_HOME/build-tools/${BUILD_TOOLS}/d8"

[ -n "$ANDROID_HOME" ] || { echo "ANDROID_HOME is required" >&2; exit 1; }
[ -f "$PLATFORM" ] || { echo "Android platform jar not found: $PLATFORM" >&2; exit 1; }
[ -x "$D8" ] || { echo "D8 not found: $D8" >&2; exit 1; }

CERT_FILE="$ROOT/signing/YTArk-cert-sha256.txt"
[ -f "$CERT_FILE" ] || { echo "Public certificate fingerprint is missing: $CERT_FILE" >&2; exit 1; }
CERT_SHA256="$(grep -v '^[[:space:]]*#' "$CERT_FILE" | tr -d '[:space:]:' | tr '[:upper:]' '[:lower:]')"
[[ "$CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid signing certificate SHA-256 fingerprint" >&2; exit 1; }

SOURCE="$ROOT/android-updater/src/main/java"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ytark-updater.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Run the shared host-JRE policy tests before compiling the DEX. The same script
# is also reached by ci.yml through this full build, so the policy/test list exists once.
bash "$ROOT/tools/test_android_updater.sh" "$WORK/test-classes"

mkdir -p "$WORK/generated/io/github/twoarchiver/ytark/updater" \
  "$WORK/classes" "$WORK/dex"
sed "s/@YTARK_CERT_SHA256@/${CERT_SHA256}/g" \
  "$SOURCE/io/github/twoarchiver/ytark/updater/UpdaterBuildConfig.java.in" \
  > "$WORK/generated/io/github/twoarchiver/ytark/updater/UpdaterBuildConfig.java"

mapfile -t SOURCES < <(find "$SOURCE" -type f -name '*.java' -print | sort)
SOURCES+=("$WORK/generated/io/github/twoarchiver/ytark/updater/UpdaterBuildConfig.java")
javac --release 8 -classpath "$PLATFORM" \
  -d "$WORK/classes" "${SOURCES[@]}"
jar --create --file "$WORK/ytark-updater.jar" -C "$WORK/classes" .
"$D8" --release --min-api 24 --lib "$PLATFORM" \
  --output "$WORK/dex" "$WORK/ytark-updater.jar"

[ -s "$WORK/dex/classes.dex" ] || { echo "D8 produced no nonempty classes.dex" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
cp "$WORK/dex/classes.dex" "$OUT"
echo "Native YTArk updater compiled to $OUT ($(wc -c < "$OUT") bytes)."
