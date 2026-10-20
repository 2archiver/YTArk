"""Regression tests for the release metadata contract checker.

The 4.0 merge (PR #71) was blocked on main because ci.yml still pinned six
3.9-era ``grep -Fx`` assertions against the emitted release environment: the
identity was maintained twice, and only one copy was updated at the bump.

tools/check_release_metadata.py replaces that duplicated pin with one
independent contract check. These tests prove the two properties the workflow
now relies on:

1. stale identity assertions fail -- any emitted field that disagrees with
   release/version.properties or the documented derivation rules is rejected
   and named (the exact failure mode the stale 3.9 greps masked), and
2. valid metadata passes -- the current release environment and a subsequent
   valid version bump pass with no workflow edits at all.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import check_release_metadata
import validate_release

CHECKER = ROOT / "tools" / "check_release_metadata.py"

# The stale 3.9-era values the old ci.yml greps pinned, kept here verbatim as
# the regression fixture: emitting any of them against the 4.0 properties must
# fail the contract check, exactly as the stale workflow assertions did.
STALE_ASSERTIONS = {
    "VERSION_NAME": "3.9.0",
    "DISPLAY_VERSION": "3.9",
    "VERSION_CODE": "3090000",
    "VERSION_TAG": "v3.9.0",
    "SCRIPT_TAG": "s40",
    "APK_ARMV7": "YTArk-v3.9.0-armeabi-v7a.apk",
}

# Wrong-but-plausible value used to prove each emitted field is checked.
WRONG_VALUES = {
    "VERSION_NAME": "9.9.9",
    "DISPLAY_VERSION": "9.9",
    "VERSION_CODE": "9090000",
    "VERSION_TAG": "v9.9.9",
    "RELEASE_NAME": "YTArk 9.9",
    "APK_ARMV7": "YTArk-v9.9.9-armeabi-v7a.apk",
    "SCRIPT_TAG": "s99",
    "BASE_TAG": "v9.9.9",
    "APP_ID": "com.example.wrong",
    "APP_NAME": "NotYTArk",
}


def emit_current_env(directory: Path) -> Path:
    """Emit the real release environment exactly as the CI step does."""
    env = directory / "ytark-release.env"
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "validate_release.py"),
         "emit-env", "--file", str(env)],
        check=True, capture_output=True, text=True,
    )
    return env


def run_checker(env: Path, properties: Path | None = None) -> subprocess.CompletedProcess:
    command = [sys.executable, str(CHECKER), "--env", str(env)]
    if properties is not None:
        command += ["--properties", str(properties)]
    return subprocess.run(command, capture_output=True, text=True)


def rewrite_env(source: Path, destination: Path, changes: dict[str, str]) -> Path:
    """Copy an emitted environment, replacing the given keys' values."""
    lines = []
    for line in source.read_text(encoding="utf-8").splitlines():
        key = line.split("=", 1)[0]
        lines.append(f"{key}={changes[key]}" if key in changes else line)
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination


class ReleaseMetadataContractTests(unittest.TestCase):
    def test_current_release_environment_passes(self):
        """The real emitter output against the real properties must pass."""
        with tempfile.TemporaryDirectory() as temp:
            env = emit_current_env(Path(temp))
            result = run_checker(env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Release metadata contract OK", result.stdout)
            config = validate_release.load_config()
            self.assertIn(config["VERSION_NAME"], result.stdout)
            self.assertIn(config["APK_ARMV7"], result.stdout)

    def test_stale_3_9_workflow_assertions_fail(self):
        """Every value the stale ci.yml greps pinned must be rejected and named."""
        with tempfile.TemporaryDirectory() as temp:
            env = rewrite_env(
                emit_current_env(Path(temp)),
                Path(temp) / "stale.env",
                STALE_ASSERTIONS,
            )
            result = run_checker(env)
            self.assertEqual(result.returncode, 1)
            for key in STALE_ASSERTIONS:
                self.assertIn(key, result.stderr, f"{key} mismatch was not named")
            self.assertIn("::error title=Release metadata contract::", result.stderr)

    def test_every_emitted_field_is_checked_independently(self):
        """A single mismatched field fails the check and names that field."""
        for key, wrong in WRONG_VALUES.items():
            with self.subTest(key=key):
                with tempfile.TemporaryDirectory() as temp:
                    env = rewrite_env(
                        emit_current_env(Path(temp)),
                        Path(temp) / "wrong.env",
                        {key: wrong},
                    )
                    result = run_checker(env)
                    self.assertEqual(result.returncode, 1, f"{key}={wrong} was accepted")
                    self.assertIn(key, result.stderr)
                    self.assertIn(wrong, result.stderr)

    def test_valid_version_bump_passes_without_workflow_edits(self):
        """A subsequent valid bump must pass with no pinned literals to update.

        This is the property whose absence blocked the 4.0 merge: the release
        identity lives in release/version.properties only, and the contract
        checker re-derives every field from it.
        """
        bumped = (
            "# Bumped candidate identity for the regression test.\n"
            "versionName=4.1.0\n"
            "versionCode=4010000\n"
            "displayVersion=4.1\n"
            "versionTag=v4.1.0\n"
            "scriptTag=s42\n"
            "baseTag=v2.0.2\n"
        )
        with tempfile.TemporaryDirectory() as temp:
            properties = Path(temp) / "version.properties"
            properties.write_text(bumped, encoding="utf-8")
            env = Path(temp) / "bumped.env"
            with patch.object(validate_release, "VERSION_FILE", properties):
                config = validate_release.load_config()
                validate_release.emit_env(str(env))
            self.assertEqual(config["VERSION_CODE"], "4010000")
            self.assertEqual(config["APK_ARMV7"], "YTArk-v4.1.0-armeabi-v7a.apk")
            result = run_checker(env, properties)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("YTArk-v4.1.0-armeabi-v7a.apk", result.stdout)

    def test_bumped_properties_with_an_unmapped_version_code_fail(self):
        """A bump whose versionCode does not follow the mapping must fail."""
        inconsistent = (
            "versionName=4.2.0\n"
            "versionCode=4010000\n"
            "displayVersion=4.2\n"
            "versionTag=v4.2.0\n"
            "scriptTag=s43\n"
            "baseTag=v2.0.2\n"
        )
        with tempfile.TemporaryDirectory() as temp:
            properties = Path(temp) / "version.properties"
            properties.write_text(inconsistent, encoding="utf-8")
            env = Path(temp) / "env"
            env.write_text(
                "VERSION_NAME=4.2.0\nVERSION_CODE=4020000\n",
                encoding="utf-8",
            )
            result = run_checker(env, properties)
            self.assertEqual(result.returncode, 1)
            self.assertIn("versionCode", result.stderr)

    def test_missing_and_unexpected_emitted_fields_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            env = emit_current_env(Path(temp))
            lines = env.read_text(encoding="utf-8").splitlines()
            env.write_text(
                "\n".join(l for l in lines if not l.startswith("APK_ARMV7=")) + "\n",
                encoding="utf-8",
            )
            result = run_checker(env)
            self.assertEqual(result.returncode, 1)
            self.assertIn("missing APK_ARMV7", result.stderr)

        with tempfile.TemporaryDirectory() as temp:
            env = emit_current_env(Path(temp))
            with open(env, "a", encoding="utf-8") as handle:
                handle.write("RELEASE_CHANNEL=beta\n")
            result = run_checker(env)
            self.assertEqual(result.returncode, 1)
            self.assertIn("unexpected key RELEASE_CHANNEL", result.stderr)

    def test_duplicate_emission_fails(self):
        """emit-env appends; emitting twice into one file must not pass silently."""
        with tempfile.TemporaryDirectory() as temp:
            env = emit_current_env(Path(temp))
            subprocess.run(
                [sys.executable, str(ROOT / "tools" / "validate_release.py"),
                 "emit-env", "--file", str(env)],
                check=True, capture_output=True, text=True,
            )
            result = run_checker(env)
            self.assertEqual(result.returncode, 1)
            self.assertIn("emitted twice", result.stderr)

    def test_malformed_environment_line_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            env = emit_current_env(Path(temp))
            with open(env, "a", encoding="utf-8") as handle:
                handle.write("this line has no equals sign\n")
            result = run_checker(env)
            self.assertEqual(result.returncode, 1)
            self.assertIn("malformed line", result.stderr)

    def test_missing_input_files_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            result = run_checker(Path(temp) / "absent.env")
            self.assertEqual(result.returncode, 1)
            self.assertIn("missing", result.stderr)
        with tempfile.TemporaryDirectory() as temp:
            env = emit_current_env(Path(temp))
            result = run_checker(env, Path(temp) / "absent.properties")
            self.assertEqual(result.returncode, 1)
            self.assertIn("missing", result.stderr)

    def test_checker_stays_independent_of_the_emitter(self):
        """The checker must re-implement the contract, not import the emitter.

        Importing tools/validate_release.py would make the check tautological:
        it would echo the same derivation it is supposed to audit.
        """
        source = CHECKER.read_text(encoding="utf-8")
        self.assertNotIn("import validate_release", source)
        self.assertNotIn("from validate_release", source)


if __name__ == "__main__":
    unittest.main()
