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
TEST_SOURCE="$ROOT/android-updater/src/test/java/io/github/twoarchiver/ytark/updater/UpdateVersionTest.java"
CONTRACT_TEST_SOURCE="$ROOT/android-updater/src/test/java/io/github/twoarchiver/ytark/updater/UpdateReleaseContractTest.java"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ytark-updater.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Run comparator tests on the host JRE; this includes suffix/build serials such
# as 2.0.3-ytark.15 and guards against lexical version comparisons.
mkdir -p "$WORK/test-classes"
javac --release 8 -d "$WORK/test-classes" \
  "$SOURCE/io/github/twoarchiver/ytark/updater/UpdateVersion.java" \
  "$SOURCE/io/github/twoarchiver/ytark/updater/UpdateReleaseContract.java" \
  "$TEST_SOURCE" "$CONTRACT_TEST_SOURCE"
java -cp "$WORK/test-classes" io.github.twoarchiver.ytark.updater.UpdateVersionTest
java -cp "$WORK/test-classes" io.github.twoarchiver.ytark.updater.UpdateReleaseContractTest

mkdir -p "$WORK/generated/io/github/twoarchiver/ytark/updater" \
  "$WORK/classes" "$WORK/dex"
sed "s/@YTARK_CERT_SHA256@/${CERT_SHA256}/g" \
  "$SOURCE/io/github/twoarchiver/ytark/updater/UpdaterBuildConfig.java.in" \
  > "$WORK/generated/io/github/twoarchiver/ytark/updater/UpdaterBuildConfig.java"

mapfile -t SOURCES < <(find "$SOURCE" -type f -name '*.java' -print | sort)
SOURCES+=("$WORK/generated/io/github/twoarchiver/ytark/updater/UpdaterBuildConfig.java")
set +e
javac -Xlint:-options -source 8 -target 8 -bootclasspath "$PLATFORM" \
  -d "$WORK/classes" "${SOURCES[@]}" > "$WORK/android-compile.log" 2>&1
compile_status=$?
set -e
if (( compile_status != 0 )); then
  cat "$WORK/android-compile.log" >&2
  diagnostic="$(python3 - "$WORK/android-compile.log" <<'PY'
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    print(" | ".join(line.strip() for line in source if line.strip()), end="")
PY
  )"
  diagnostic="${diagnostic//%/%25}"
  printf '::error title=Android updater compiler diagnostics::%s\n' "$diagnostic"
  exit "$compile_status"
fi
jar --create --file "$WORK/ytark-updater.jar" -C "$WORK/classes" .
"$D8" --release --min-api 24 --lib "$PLATFORM" \
  --output "$WORK/dex" "$WORK/ytark-updater.jar"

mkdir -p "$(dirname "$OUT")"
cp "$WORK/dex/classes.dex" "$OUT"
echo "Native YTArk updater compiled to $OUT ($(wc -c < "$OUT") bytes)."
