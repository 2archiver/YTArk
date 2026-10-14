#!/usr/bin/env bash
# Compile and run the Android-free updater policy tests on the host JRE.
#
# This is the only copy of the updater test list: CI and release both reach
# this script through tools/build_android_updater.sh instead of repeating a
# javac/java command with its own list of classes. A duplicated list is exactly
# what stopped the 2.9 release (a stale copy of the bundle contract), so the
# updater keeps one. tools/tests/test_android_updater_tests.py fails when a test
# class, or a policy a test references, is missing from the lists below.
#
# The policy classes are deliberately free of Android imports so they can run on
# a plain JRE; the Android-dependent activities are compiled into the APK's DEX
# by tools/build_android_updater.sh, which needs ANDROID_HOME.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/android-updater/src/main/java/io/github/twoarchiver/ytark/updater"
TESTS="$ROOT/android-updater/src/test/java/io/github/twoarchiver/ytark/updater"
OUT="${1:-${TMPDIR:-/tmp}/ytark-updater-tests}"

command -v javac >/dev/null || { echo "javac is required to run the updater policy tests" >&2; exit 1; }
command -v java >/dev/null || { echo "java is required to run the updater policy tests" >&2; exit 1; }

# Android-free policy sources the tests exercise.
POLICY_SOURCES=(
  NativeAbiContract.java
  NativeRoutePolicy.java
  NativeThemePolicy.java
  InstallGate.java
  InstallerResultPolicy.java
  UpdateFailure.java
  UpdateFailureException.java
  UpdateGuards.java
  UpdateRedirectPolicy.java
  UpdateReleaseContract.java
  UpdateResumeContract.java
  UpdateSchedulePolicy.java
  UpdateVersion.java
  UpdaterFailurePhasePolicy.java
  YtarkBranding.java
)

# Every test class that must run. Each name must have a matching *Test.java.
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

sources=()
for name in "${POLICY_SOURCES[@]}"; do
  [ -f "$SRC/$name" ] || { echo "missing updater policy source: $SRC/$name" >&2; exit 1; }
  # A policy that grows an Android dependency silently would break this host
  # compile far from its cause, so reject it here with the reason.
  if grep -q '^import android\.' "$SRC/$name"; then
    echo "$name imports Android APIs; it cannot run on the host JRE" >&2
    exit 1
  fi
  sources+=("$SRC/$name")
done
for name in "${TEST_CLASSES[@]}"; do
  [ -f "$TESTS/$name.java" ] || { echo "missing updater test source: $TESTS/$name.java" >&2; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT"
javac --release 8 -d "$OUT" "${sources[@]}" "$TESTS"/*Test.java
for name in "${TEST_CLASSES[@]}"; do
  java -cp "$OUT" "io.github.twoarchiver.ytark.updater.$name"
done
echo "Native updater policy tests passed (${#TEST_CLASSES[@]} classes, ${#POLICY_SOURCES[@]} policy sources)."
