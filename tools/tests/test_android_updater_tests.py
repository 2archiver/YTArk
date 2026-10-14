"""Regressions for the shared native-updater test runner and the repack defaults.

The 2.9 release outage was caused by a duplicated list that drifted: the release
workflow still required a symbol the source had retired. The updater test list
was duplicated in ci.yml and in the DEX build script, so these tests keep it in
exactly one place, keep every test class wired up, and keep the APK repacker's
default version identity derived from the release contract instead of a literal
left behind by an abandoned draft.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import repack_apk  # noqa: E402
import validate_release  # noqa: E402

RUNNER = ROOT / "tools" / "test_android_updater.sh"
DEX_BUILD = ROOT / "tools" / "build_android_updater.sh"
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
MAIN_DIR = ROOT / "android-updater" / "src" / "main" / "java" / "io" / "github" / "twoarchiver" / "ytark" / "updater"
TEST_DIR = ROOT / "android-updater" / "src" / "test" / "java" / "io" / "github" / "twoarchiver" / "ytark" / "updater"


def bash_array(text: str, name: str) -> list[str]:
    """Read one `NAME=( ... )` array literal from the shell script."""
    match = re.search(rf"^{name}=\(\n(.*?)^\)$", text, re.M | re.S)
    if not match:
        raise AssertionError(f"{name} is not defined as a shell array in {RUNNER.name}")
    return [line.strip().rstrip("\\").strip() for line in match.group(1).splitlines() if line.strip()]


class UpdaterTestListTests(unittest.TestCase):
    def setUp(self):
        self.script = RUNNER.read_text(encoding="utf-8")
        self.policies = bash_array(self.script, "POLICY_SOURCES")
        self.classes = bash_array(self.script, "TEST_CLASSES")

    def test_every_policy_source_exists(self):
        for name in self.policies:
            self.assertTrue((MAIN_DIR / name).is_file(), f"missing policy source {name}")

    def test_every_listed_test_class_has_a_source_file(self):
        for name in self.classes:
            self.assertTrue((TEST_DIR / f"{name}.java").is_file(), f"missing test source {name}.java")

    def test_no_test_class_is_left_out_of_the_runner(self):
        on_disk = sorted(path.stem for path in TEST_DIR.glob("*Test.java"))
        self.assertEqual(on_disk, sorted(self.classes),
                         "a test class exists that the shared runner never executes")

    def test_every_policy_referenced_by_a_test_is_compiled(self):
        known = {path.stem for path in MAIN_DIR.glob("*.java")}
        used: set[str] = set()
        for path in TEST_DIR.glob("*Test.java"):
            text = path.read_text(encoding="utf-8")
            used.update(name for name in known if re.search(rf"\b{re.escape(name)}\b", text))
        missing = sorted(used - set(path[:-5] for path in self.policies))
        self.assertEqual(missing, [],
                         "tests reference policies the shared runner does not compile")

    def test_theme_palette_is_covered(self):
        self.assertIn("NativeThemePolicy.java", self.policies)
        self.assertIn("NativeThemePolicyTest", self.classes)
        policy = (MAIN_DIR / "NativeThemePolicy.java").read_text(encoding="utf-8")
        self.assertIn("0xff000000", policy, "OLED must paint opaque true black")


class RunnerWiringTests(unittest.TestCase):
    def test_ci_workflow_uses_the_shared_runner(self):
        text = CI_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("tools/test_android_updater.sh", text)
        self.assertNotRegex(
            text, r"javac\s+--release\s+8",
            "ci.yml must not carry its own javac command with a second class list",
        )

    def test_dex_build_uses_the_shared_runner(self):
        text = DEX_BUILD.read_text(encoding="utf-8")
        self.assertIn("tools/test_android_updater.sh", text)
        self.assertNotIn("for test_class in", text,
                         "the DEX build must not repeat the updater test class list")

    @unittest.skipUnless(shutil.which("javac") and shutil.which("java"),
                         "no host JDK: ci.yml compiles and runs these policy tests")
    def test_shared_runner_passes_on_this_source(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ["bash", str(RUNNER), directory],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("NativeThemePolicy tests passed", result.stdout)
            self.assertIn("InstallerResultPolicy tests passed", result.stdout)


class RepackDefaultsTests(unittest.TestCase):
    def test_repack_version_defaults_come_from_the_release_contract(self):
        config = validate_release.load_config()
        args = repack_apk.build_parser().parse_args([
            "--base", "base.apk", "--architecture", "armv7", "--out", "out.apk",
            "--updater-dex", "classes.dex", "--script-url", "https://example.invalid/?v=",
        ])
        self.assertEqual(str(args.version_code), config["VERSION_CODE"])
        self.assertEqual(args.version_name, config["VERSION_NAME"])

    def test_repack_defaults_are_not_the_abandoned_draft(self):
        """A manual repack must never package the superseded 2.9.1 draft identity."""
        text = (ROOT / "tools" / "repack_apk.py").read_text(encoding="utf-8")
        self.assertNotIn('default="2.9.1"', text)
        self.assertNotIn("default=2090100", text)


if __name__ == "__main__":
    unittest.main()
