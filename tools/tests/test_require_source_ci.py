from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import require_source_ci

SHA = "a" * 40
REPOSITORY = "2archiver/YTArk"


def run(**overrides):
    result = {
        "id": 8123,
        "run_number": 71,
        "run_attempt": 1,
        "path": ".github/workflows/ci.yml@refs/heads/main",
        "head_sha": SHA,
        "head_branch": "main",
        "event": "push",
        "status": "completed",
        "conclusion": "success",
        "html_url": "https://github.com/2archiver/YTArk/actions/runs/8123",
        "repository": {"full_name": REPOSITORY},
    }
    result.update(overrides)
    return result


class Clock:
    def __init__(self):
        self.value = 0.0

    def monotonic(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class RequireSourceCiTests(unittest.TestCase):
    def test_accepts_only_success_for_the_exact_main_commit_and_workflow(self):
        clock = Clock()
        result = require_source_ci.require_source_ci(
            SHA,
            api=lambda *_: {"workflow_runs": [run()]},
            monotonic=clock.monotonic,
            sleep=clock.sleep,
            timeout_seconds=0,
        )
        self.assertEqual(result["id"], 8123)

    def test_rejects_wrong_commit_branch_event_repository_and_workflow_path(self):
        variants = [
            run(head_sha="b" * 40),
            run(head_branch="feature"),
            run(event="pull_request"),
            run(repository={"full_name": "fork/YTArk"}),
            run(path=".github/workflows/other.yml@refs/heads/main"),
        ]
        for untrusted in variants:
            with self.subTest(untrusted=untrusted):
                self.assertFalse(require_source_ci.matches_source_run(
                    untrusted, repository=REPOSITORY, head_sha=SHA, branch="main",
                ))

    def test_waits_for_an_exact_run_that_is_still_in_progress(self):
        clock = Clock()
        responses = iter([
            {"workflow_runs": [run(status="in_progress", conclusion=None)]},
            {"workflow_runs": [run()]},
        ])
        result = require_source_ci.require_source_ci(
            SHA,
            api=lambda *_: next(responses),
            monotonic=clock.monotonic,
            sleep=clock.sleep,
            timeout_seconds=5,
            poll_seconds=1,
        )
        self.assertEqual(result["conclusion"], "success")
        self.assertEqual(clock.value, 1.0)

    def test_completed_failure_fails_closed_without_waiting(self):
        with self.assertRaisesRegex(require_source_ci.SourceValidationError, "without success"):
            require_source_ci.require_source_ci(
                SHA,
                api=lambda *_: {"workflow_runs": [run(conclusion="failure")]},
                monotonic=lambda: 0.0,
                sleep=lambda _seconds: self.fail("completed failure must not poll"),
                timeout_seconds=120,
            )

    def test_missing_run_times_out_and_malformed_api_payload_is_rejected(self):
        clock = Clock()
        with self.assertRaisesRegex(require_source_ci.SourceValidationError, "no matching main-branch CI run"):
            require_source_ci.require_source_ci(
                SHA,
                api=lambda *_: {"workflow_runs": []},
                monotonic=clock.monotonic,
                sleep=clock.sleep,
                timeout_seconds=2,
                poll_seconds=1,
            )
        with self.assertRaisesRegex(require_source_ci.SourceValidationError, "unexpected Actions"):
            require_source_ci.parse_runs({"runs": []})

    def test_rejects_non_trusted_repository_or_non_main_validation(self):
        with self.assertRaisesRegex(require_source_ci.SourceValidationError, "restricted"):
            require_source_ci.require_source_ci(SHA, repository="fork/YTArk", timeout_seconds=0)
        with self.assertRaisesRegex(require_source_ci.SourceValidationError, "target main"):
            require_source_ci.require_source_ci(SHA, branch="feature", timeout_seconds=0)
        with self.assertRaisesRegex(require_source_ci.SourceValidationError, "40-character"):
            require_source_ci.require_source_ci("deadbeef", timeout_seconds=0)

    def test_writes_the_exact_commit_evidence_to_the_summary(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "summary.md"
            require_source_ci.write_summary(str(path), SHA, run())
            text = path.read_text(encoding="utf-8")
        self.assertIn(SHA, text)
        self.assertIn("successful `ci.yml` run", text.lower())
        self.assertIn("https://github.com/2archiver/YTArk/actions/runs/8123", text)

    def test_gh_query_is_filtered_by_exact_sha_branch_and_page_size(self):
        completed = type("Completed", (), {"returncode": 0, "stdout": '{"workflow_runs":[]}', "stderr": ""})()
        with patch.object(require_source_ci.subprocess, "run", return_value=completed) as call:
            self.assertEqual(require_source_ci.gh_runs_api(REPOSITORY, SHA, "main"), {"workflow_runs": []})
        command = call.call_args.args[0]
        self.assertIn("actions/workflows/ci.yml/runs", command[4])
        self.assertIn(f"head_sha={SHA}", command)
        self.assertIn("branch=main", command)
        self.assertIn("per_page=100", command)


if __name__ == "__main__":
    unittest.main()
