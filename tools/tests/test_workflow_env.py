"""Guard the release workflow structure without depending on YAML parsing.

Two regressions are guarded here:

1. GitHub Actions exports ``$GITHUB_ENV`` only for the NEXT step. Writing it and
   reading the values it declares in the same ``run`` block broke the 2.2
   candidate build immediately after the merge, so no step may do both.
2. The release pipeline must stay automatic and safe: publication depends on the
   build job of the same run, PR validation stays read-only, and the manual
   device-acceptance gate is gone.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
BUILD = "build-apk.yml"
PUBLISH = "publish-release.yml"
CI = "ci.yml"
WRITES_ENV = 'emit-env --file "$GITHUB_ENV"'
# Keys tools/validate_release.py exports into $GITHUB_ENV.
ENV_KEYS = (
    "VERSION_NAME", "DISPLAY_VERSION", "VERSION_CODE", "VERSION_TAG",
    "SCRIPT_TAG", "BASE_TAG", "APK_ARMV7", "APP_ID", "APP_NAME", "RELEASE_NAME",
)


def steps(path: Path):
    """Return (name, source) for each workflow step, without YAML dependencies."""
    text = path.read_text(encoding="utf-8")
    starts = list(re.finditer(r"^      - name: (.+)$", text, re.M))
    return [(match.group(1), text[match.start():starts[index + 1].start()
                                  if index + 1 < len(starts) else len(text)])
            for index, match in enumerate(starts)]


def job_block(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"^  {re.escape(name)}:\s*$", text, re.M)
    if not match:
        raise AssertionError(f"job {name} not found in {path.name}")
    rest = text[match.end():]
    nxt = re.search(r"^  [A-Za-z0-9_-]+:\s*$", rest, re.M)
    return rest[: nxt.start()] if nxt else rest


class WorkflowEnvTests(unittest.TestCase):
    def test_candidate_binds_url_after_version_is_exported(self):
        candidate = steps(WORKFLOWS / BUILD)
        names = [name for name, _ in candidate]
        load = names.index("Load release version")
        bind = names.index(
            "Bind the APK to the immutable userscript URL "
            "(the tag is published after the package checks)"
        )
        self.assertLess(load, bind)
        self.assertIn(WRITES_ENV, candidate[load][1])
        self.assertNotIn(WRITES_ENV, candidate[bind][1])
        self.assertIn("SCRIPT_URL=$script_url", candidate[bind][1])
        self.assertIn(
            'script_url="https://cdn.jsdelivr.net/gh/${GITHUB_REPOSITORY}@${SCRIPT_TAG}/userScript.js?v="',
            candidate[bind][1],
        )

    def test_no_step_writes_and_reads_github_env(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            for name, source in steps(path):
                if WRITES_ENV not in source:
                    continue
                used = [
                    key for key in ENV_KEYS
                    if re.search(r"\$\{" + key + r"\b", source) or re.search(r"\$" + key + r"\b", source)
                ]
                self.assertEqual(
                    used, [],
                    f"{path.name}: step {name!r} reads {used} in the same step that writes "
                    "$GITHUB_ENV; Actions exports those values only for the next step.",
                )

    def test_publication_depends_on_the_build_job_of_the_same_run(self):
        block = job_block(WORKFLOWS / BUILD, "publish-release")
        self.assertIn("needs:\n      - release-guard\n      - source-validation\n      - build-apk-candidates", block)
        self.assertIn("needs.release-guard.result == 'success'", block)
        self.assertIn("needs.source-validation.result == 'success'", block)
        self.assertIn("needs.build-apk-candidates.result != 'failure'", block)
        self.assertIn("needs.build-apk-candidates.result != 'cancelled'", block)
        self.assertIn("github.repository == '2archiver/YTArk'", block)
        self.assertIn("github.ref == 'refs/heads/main'", block)
        self.assertIn("contents: write", block)

    def test_exact_source_ci_is_required_before_build_and_publication(self):
        build = WORKFLOWS / BUILD
        source = job_block(build, "source-validation")
        candidate = job_block(build, "build-apk-candidates")
        publication = job_block(build, "publish-release")
        self.assertIn("github.ref == 'refs/heads/main'", source)
        self.assertIn("actions: read", source)
        self.assertIn("tools/require_source_ci.py", source)
        self.assertIn("--head-sha \"$GITHUB_SHA\"", source)
        self.assertIn("needs:\n      - release-guard\n      - source-validation", candidate)
        self.assertIn("needs.source-validation.result == 'success'", candidate)
        self.assertIn("needs.source-validation.result == 'success'", publication)
        self.assertNotIn("needs.source-validation.result != 'failure'", publication)

    def test_build_job_stays_read_only_and_keeps_the_signing_key(self):
        block = job_block(WORKFLOWS / BUILD, "build-apk-candidates")
        self.assertIn("contents: read", block)
        self.assertNotIn("contents: write", block)
        self.assertIn("secrets.YTARK_KEYSTORE_B64", block)

    def test_recovery_requires_source_ci_for_the_candidate_sha(self):
        verify = job_block(WORKFLOWS / PUBLISH, "verify-candidate")
        self.assertIn("tools/require_source_ci.py", verify)
        self.assertIn("--head-sha \"$EXPECTED_SHA\"", verify)
        self.assertIn("--branch main", verify)

    def test_recovery_workflow_binds_a_named_candidate(self):
        text = (WORKFLOWS / PUBLISH).read_text(encoding="utf-8")
        for required in ("candidate_run_id", "expected_head_sha", "device_test_notes"):
            self.assertIn(required, text)
        self.assertNotIn("device_acceptance", text)
        # No manual staging environment gate.
        self.assertNotRegex(text, r"^\s*environment:", re.M)

    def test_workflows_share_one_release_concurrency_group(self):
        groups = {}
        for name in (BUILD, PUBLISH):
            text = (WORKFLOWS / name).read_text(encoding="utf-8")
            match = re.search(r"concurrency:\s*\n\s+group:\s*(\S+)", text)
            self.assertIsNotNone(match, f"{name} has no concurrency group")
            groups[name] = match.group(1)
            self.assertIn("cancel-in-progress: false", text)
        self.assertEqual(groups[BUILD], groups[PUBLISH])

    def test_ci_never_publishes_or_reads_secrets(self):
        text = (WORKFLOWS / CI).read_text(encoding="utf-8")
        self.assertNotIn("contents: write", text)
        self.assertNotIn("${{ secrets.", text)
        self.assertNotIn("secrets.YTARK_", text)
        self.assertNotIn("gh release", text)
        self.assertIn("tools/check_workflow_policy.py", text)


if __name__ == "__main__":
    unittest.main()
