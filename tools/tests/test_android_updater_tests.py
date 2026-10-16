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
MAIN_DIR = ROOT / "android-updater" / "src" / "main" / "kotlin" / "io" / "github" / "twoarchiver" / "ytark" / "updater"
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
        known = {name for path in MAIN_DIR.glob("*.kt") for name in re.findall(r"(?:class|object) (\w+)", path.read_text())}
        used: set[str] = set()
        for path in TEST_DIR.glob("*Test.java"):
            text = path.read_text(encoding="utf-8")
            used.update(name for name in known if re.search(rf"\b{re.escape(name)}\b", text))
        compiled = "\n".join((MAIN_DIR / path).read_text() for path in self.policies)
        missing = sorted(name for name in used if not re.search(rf"(?:class|object) {name}\b", compiled))
        self.assertEqual(missing, [],
                         "tests reference policies the shared runner does not compile")

    def test_theme_palette_is_covered(self):
        self.assertIn("Policies.kt", self.policies)
        self.assertIn("NativeThemePolicyTest", self.classes)
        policy = (MAIN_DIR / "Policies.kt").read_text(encoding="utf-8")
        self.assertIn("0xff0f0f0f", policy, "Updates matches the neutral YouTube dark background")
        self.assertNotIn("THEME_", policy, "3.0 removed the OLED palette branch")
        self.assertNotIn("isOled", policy, "the palette takes no theme argument any more")


class RunnerWiringTests(unittest.TestCase):
    def test_ci_workflow_uses_the_full_release_build(self):
        text = CI_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('bash tools/build_android_updater.sh "$RUNNER_TEMP/ytark-updater/classes.dex"', text)
        self.assertIn('test -s "$RUNNER_TEMP/ytark-updater/classes.dex"', text)
        self.assertIn('java-version: "17"', text)
        self.assertIn('API_LEVEL: "34"', text)
        self.assertIn('BUILD_TOOLS: "34.0.0"', text)
        self.assertIn('sdkmanager "platforms;android-${API_LEVEL}" "build-tools;${BUILD_TOOLS}"', text)
        self.assertNotIn('bash tools/test_android_updater.sh', text,
                         "CI must reach policy tests through the full build, not duplicate them")
        self.assertNotIn('continue-on-error', text)
        self.assertNotIn('|| true', text)
        self.assertNotRegex(
            text, r"javac\s+--release\s+8",
            "ci.yml must not carry its own javac command with a second class list",
        )

    def test_dex_build_uses_the_shared_runner(self):
        text = DEX_BUILD.read_text(encoding="utf-8")
        self.assertIn("tools/test_android_updater.sh", text)
        self.assertNotIn("for test_class in", text,
                         "the DEX build must not repeat the updater test class list")

    def test_dex_build_compiles_all_production_sources_and_checks_output(self):
        text = DEX_BUILD.read_text(encoding="utf-8")
        self.assertIn("find \"$SOURCE\" -type f -name '*.kt' -print", text)
        self.assertIn('KOTLINC', text)
        self.assertIn('\"$STDLIB\"', text)
        self.assertIn('"$D8" --release --min-api 24 --lib "$PLATFORM"', text)
        self.assertIn('[ -s "$WORK/dex/classes.dex" ]', text)
        self.assertIn('set -euo pipefail', text)

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


class UpdateScreenRemovalTests(unittest.TestCase):
    def test_no_production_java_reference_to_the_removed_storage_screen(self):
        for path in MAIN_DIR.rglob("*.kt"):
            text = path.read_text(encoding="utf-8")
            for retired in ("StorageActivity", "openStorageScreen", "storageButton",
                            "YTARK_NATIVE_STORAGE_OPEN"):
                self.assertNotIn(retired, text, str(path))

    def test_focus_lists_match_the_remaining_created_and_inserted_controls(self):
        text = (MAIN_DIR / "UpdateActivity.kt").read_text()
        created = re.findall(r'(\w+Button)=button\((\d+),', text)
        self.assertEqual([name for name, _ in created],
                         ['allowInstallsButton', 'checkButton', 'intervalButton', 'primaryButton', 'cancelButton', 'currentNotesButton', 'candidateNotesButton', 'detailsButton'])
        self.assertEqual(len({id for _, id in created}), 8)
        self.assertIn('ENTRY_PERMISSION', text)
        self.assertIn('fresh_entry_pending', text)
        self.assertIn('permission_entry_attempted', text)
        self.assertIn('permission_route_in_flight', text)
        self.assertIn('InstallPermissionEntryPolicy.shouldRequestOnEntry', text)
        self.assertIn('InstallAuthorizationAccess.openSettings', text)
        self.assertIn('InstallAuthorizationAccess.granted', text)
        self.assertIn('Android could not open the install-authorization screen', text)
        self.assertIn('findViewById<View>(focusId)', text)
        self.assertIn('currentFocus?.id', text)
        render = text.split('private fun render(s: UpdateState)', 1)[1]
        self.assertIn('Retry check', render)
        self.assertIn('Retry download', render)
        self.assertIn('Retry install', render)
        self.assertIn('Download & install', text)
        self.assertIn('Technical details', text)
        self.assertNotIn('Failed safely', text)
        self.assertNotIn('setContentView', render)
        self.assertIn('if(focused!=null && (!focused.isEnabled || focused.visibility!=View.VISIBLE))', render)
        self.assertIn('addState(disabled', text)
        self.assertIn('addState(focused', text)
        self.assertIn('primaryButton.isEnabled=!s.busy && s.candidate!=null', render)
        self.assertNotIn('s.candidate?.notes', render, 'raw notes never enter the default view')
        self.assertIn('ReleaseHighlights.summary(installed)', text)
        self.assertIn('ReleaseHighlights.summary(it.version)', render)

    def test_permission_entry_has_api_specific_routes_and_saved_no_loop_state(self):
        activity = (MAIN_DIR / "UpdateActivity.kt").read_text(encoding="utf-8")
        installer = (MAIN_DIR / "InstallCoordinator.kt").read_text(encoding="utf-8")
        policies = (MAIN_DIR / "Policies.kt").read_text(encoding="utf-8")
        repacker = (ROOT / "tools" / "repack_apk.py").read_text(encoding="utf-8")
        release_validator = (ROOT / "tools" / "validate_release.py").read_text(encoding="utf-8")
        for marker in ('"fresh_entry_pending"', '"permission_entry_attempted"',
                       '"permission_route_in_flight"', 'beginFreshPageEntry()',
                       'finishEntryPermissionReturn()', 'ENTRY_PERMISSION', 'Allow installs'):
            self.assertIn(marker, activity)
        self.assertIn('context.packageManager.canRequestPackageInstalls()', installer)
        self.assertIn('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES', installer)
        self.assertIn('Settings.ACTION_SECURITY_SETTINGS', installer)
        self.assertIn('package:${context.packageName}', installer)
        # The screen must know why Android refuses before it offers the switch again.
        self.assertIn('InstallCapabilityPolicy.explanation', activity)
        self.assertIn('InstallAuthorizationAccess.canHoldAuthorization', activity)
        self.assertIn('InstallAuthorizationAccess.diagnose', activity)
        self.assertIn('InstallCapabilityPolicy.REQUEST_INSTALL_PACKAGES', installer)
        self.assertIn('APP_OPS_SERVICE', installer)
        self.assertIn('Settings.Secure.INSTALL_NON_MARKET_APPS', installer)
        self.assertIn('api >= 26', policies)
        self.assertIn('api in 24..25', policies)
        self.assertIn('android.permission.REQUEST_INSTALL_PACKAGES', repacker)
        self.assertIn('validate_install_unknown_sources_target_sdk', release_validator)


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
