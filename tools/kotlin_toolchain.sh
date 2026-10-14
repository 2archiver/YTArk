#!/usr/bin/env bash
# Sourced by both test and production builds. npm lock pins the compiler archive integrity.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${KOTLIN_HOME:-}" ]; then
  (cd "$ROOT/tools/kotlin" && npm ci --ignore-scripts --no-audit --no-fund >&2)
  export KOTLIN_HOME="$ROOT/tools/kotlin/node_modules/kotlin-compiler"
fi
[ "$(cat "$KOTLIN_HOME/build.txt")" = "2.1.20-release-217" ] || { echo 'Kotlin 2.1.20-release-217 is required' >&2; exit 1; }
KOTLINC=(java -cp "$KOTLIN_HOME/lib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler)
STDLIB="$KOTLIN_HOME/lib/kotlin-stdlib.jar"
