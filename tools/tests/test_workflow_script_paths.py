"""Guard the relative depth of every repo script a workflow step runs.

Regression: the 2.9 recovery replaced the duplicated symbol list with one shared
`tools/check_bundle_contract.py`, but both workflows called it as
`../tools/check_bundle_contract.py` from `working-directory: TizenTube/mods`.
`TizenTube/mods/../tools` is `TizenTube/tools`, which does not exist, so the
userscript step died with exit code 2 before any test ran (PR #46, run
38517448417) while every local suite was green — the failure was only visible
from the step's working directory.

`tools/check_workflow_policy.py` now resolves each `.py`/`.sh` path a `run:`
block names against that step's working directory, so a wrong depth fails the
policy check instead of the release.
"""

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import check_workflow_policy  # noqa: E402

WORKFLOWS = ROOT / ".github" / "workflows"
CHECKER = "tools/check_bundle_contract.py"


def workflow(step_body: str) -> Path:
    """Write a minimal workflow whose single step contains `step_body`."""
    directory = tempfile.mkdtemp(prefix="ytark-workflow-")
    path = Path(directory) / "ci.yml"
    path.write_text(
        "name: test\non:\n  push:\n    branches:\n      - main\njobs:\n  tests:\n"
        "    runs-on: ubuntu-latest\n    steps:\n      - name: Sample step\n"
        + step_body,
        encoding="utf-8",
    )
    return path


def failures_for(step_body: str) -> list[str]:
    failures: list[str] = []
    check_workflow_policy.check_script_paths(workflow(step_body), failures)
    return failures


class WorkflowScriptPathTests(unittest.TestCase):
    def test_wrong_relative_depth_is_rejected(self):
        failures = failures_for(
            "        working-directory: TizenTube/mods\n"
            "        run: |\n"
            "          python3 ../tools/check_bundle_contract.py\n"
        )
        self.assertEqual(len(failures), 1, failures)
        self.assertIn("../tools/check_bundle_contract.py", failures[0])
        self.assertIn("TizenTube/mods", failures[0])

    def test_correct_relative_depth_is_accepted(self):
        failures = failures_for(
            "        working-directory: TizenTube/mods\n"
            "        run: |\n"
            "          python3 ../../tools/check_bundle_contract.py\n"
        )
        self.assertEqual(failures, [])

    def test_repo_relative_paths_resolve_from_the_repository_root(self):
        self.assertEqual(failures_for("        run: python3 tools/check_workflow_policy.py\n"), [])
        failures = failures_for("        run: python3 tools/does_not_exist.py\n")
        self.assertEqual(len(failures), 1, failures)
        self.assertIn("tools/does_not_exist.py", failures[0])

    def test_glob_and_shell_scripts_are_resolved(self):
        self.assertEqual(failures_for("        run: python3 -m py_compile tools/*.py\n"), [])
        self.assertEqual(failures_for("        run: bash tools/test_android_updater.sh\n"), [])
        failures = failures_for("        run: bash tools/missing_script.sh\n")
        self.assertEqual(len(failures), 1, failures)

    def test_commented_out_and_unexpanded_paths_are_ignored(self):
        self.assertEqual(failures_for("        run: |\n          # git add tools/nope.py\n"), [])
        self.assertEqual(
            failures_for('        run: |\n          bash "$RUNNER_TEMP/tools/gen.py"\n'), []
        )

    def test_every_real_workflow_resolves_its_scripts(self):
        paths = sorted(WORKFLOWS.glob("*.yml"))
        self.assertTrue(paths, "no workflows found")
        for path in paths:
            failures: list[str] = []
            check_workflow_policy.check_script_paths(path, failures)
            self.assertEqual(failures, [], f"{path.name}: {failures}")

    def test_both_workflows_run_the_shared_contract_checker_at_the_right_depth(self):
        for name in ("ci.yml", "build-apk.yml"):
            text = (WORKFLOWS / name).read_text(encoding="utf-8")
            self.assertIn("working-directory: TizenTube/mods", text, name)
            self.assertIn(f"python3 ../../{CHECKER}", text, name)
            self.assertNotIn(f"python3 ../{CHECKER}", text, name)


if __name__ == "__main__":
    unittest.main()
