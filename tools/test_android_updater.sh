#!/usr/bin/env bash
# Legacy Java assertions execute the Kotlin production policies, plus Kotlin state tests.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/tools/kotlin_toolchain.sh"
SRC="$ROOT/android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater"
TESTS="$ROOT/android-updater/src/test/java/io/github/twoarchiver/ytark/updater"
OUT="${1:-$ROOT/build/updater-tests}"
POLICY_SOURCES=(
  Policies.kt
  UpdateFailure.kt
  UpdateState.kt
)
TEST_CLASSES=(
  InstallGateTest
  InstallerResultPolicyTest
  NativeRoutePolicyTest
  NativeThemePolicyTest
  UpdateGuardsTest
  UpdateRedirectPolicyTest
  UpdateReleaseContractTest
  UpdateSchedulePolicyTest
  UpdateVersionTest
  UpdaterFailurePhasePolicyTest
  YtarkBrandingTest
)
mkdir -p "$OUT"
sources=()
for name in "${POLICY_SOURCES[@]}"; do sources+=("$SRC/$name"); done
"${KOTLINC[@]}" -jvm-target 1.8 -no-reflect -classpath "$STDLIB" -d "$OUT/policies.jar" "${sources[@]}" "$ROOT/android-updater/src/test/kotlin/StateTest.kt"
javac --release 8 -classpath "$OUT/policies.jar:$STDLIB" -d "$OUT" "$TESTS"/*Test.java
for name in "${TEST_CLASSES[@]}"; do java -cp "$OUT:$OUT/policies.jar:$STDLIB" "io.github.twoarchiver.ytark.updater.$name"; done
java -cp "$OUT/policies.jar:$STDLIB" io.github.twoarchiver.ytark.updater.StateTestKt
