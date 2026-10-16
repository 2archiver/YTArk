#!/usr/bin/env python3
"""Wait for successful CI on the exact trusted main-branch source commit.

The release workflow starts concurrently with ``ci.yml`` after a push to main.
This gate queries the Actions API by full head SHA and accepts only a completed,
successful run of the configured CI workflow for that same commit on main. It
never treats a pull-request check, a different commit, a fork, or an absent run
as evidence that the release source passed CI.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

TRUSTED_REPOSITORY = "2archiver/YTArk"
WORKFLOW_FILE = "ci.yml"
WORKFLOW_PATH = f".github/workflows/{WORKFLOW_FILE}"
VALID_SHA = re.compile(r"^[0-9a-f]{40}$")
ACTIVE_STATUSES = {"queued", "in_progress", "requested", "waiting", "pending"}


class SourceValidationError(RuntimeError):
    """The exact source commit does not have successful CI evidence."""


def _workflow_path(run: dict[str, Any]) -> str:
    value = run.get("path")
    if not isinstance(value, str):
        return ""
    # GitHub sometimes includes the ref after '@' in workflow-run path values.
    return value.split("@", 1)[0]


def matches_source_run(
    run: dict[str, Any], *, repository: str, head_sha: str, branch: str,
) -> bool:
    """Whether an Actions run is trustworthy evidence for this exact source."""
    run_repository = run.get("repository")
    if isinstance(run_repository, dict):
        run_repository = run_repository.get("full_name")
    return (
        _workflow_path(run) == WORKFLOW_PATH
        and run.get("head_sha") == head_sha
        and run.get("head_branch") == branch
        and run.get("event") in {"push", "workflow_dispatch"}
        and run_repository == repository
    )


def parse_runs(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("workflow_runs"), list):
        raise SourceValidationError("GitHub returned an unexpected Actions workflow-runs response")
    runs = payload["workflow_runs"]
    if any(not isinstance(run, dict) for run in runs):
        raise SourceValidationError("GitHub returned a malformed Actions workflow run")
    return runs


def run_order(run: dict[str, Any]) -> tuple[int, int, str, int]:
    """Order CI attempts newest-first without trusting malformed API fields."""
    try:
        run_number = int(run.get("run_number") or 0)
        run_attempt = int(run.get("run_attempt") or 0)
        run_id = int(run.get("id") or 0)
    except (TypeError, ValueError, OverflowError) as error:
        raise SourceValidationError("GitHub returned malformed CI run ordering fields") from error
    if min(run_number, run_attempt, run_id) < 0:
        raise SourceValidationError("GitHub returned negative CI run ordering fields")
    updated_at = run.get("updated_at") or ""
    if not isinstance(updated_at, str):
        raise SourceValidationError("GitHub returned a malformed CI run update time")
    return run_number, run_attempt, updated_at, run_id


def gh_runs_api(repository: str, head_sha: str, branch: str) -> dict[str, Any]:
    """Fetch CI runs filtered server-side by exact SHA and main branch."""
    command = [
        "gh", "api", "--method", "GET",
        f"repos/{repository}/actions/workflows/{WORKFLOW_FILE}/runs",
        "-f", f"head_sha={head_sha}",
        "-f", f"branch={branch}",
        "-f", "per_page=100",
    ]
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "gh api failed"
        raise SourceValidationError(f"Could not query exact-source CI status: {detail}")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise SourceValidationError("GitHub returned malformed JSON for exact-source CI status") from error
    if not isinstance(payload, dict):
        raise SourceValidationError("GitHub returned a non-object Actions workflow-runs response")
    return payload


def require_source_ci(
    head_sha: str,
    *,
    repository: str = TRUSTED_REPOSITORY,
    branch: str = "main",
    timeout_seconds: float = 1800,
    poll_seconds: float = 15,
    api: Callable[[str, str, str], dict[str, Any]] = gh_runs_api,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Return a successful exact-source run or fail closed after bounded wait."""
    if repository != TRUSTED_REPOSITORY:
        raise SourceValidationError(f"Exact-source publication validation is restricted to {TRUSTED_REPOSITORY}")
    if not VALID_SHA.fullmatch(head_sha):
        raise SourceValidationError("The source commit must be a full 40-character lowercase SHA")
    if branch != "main":
        raise SourceValidationError("Exact-source release validation must target main")
    if timeout_seconds < 0 or poll_seconds <= 0:
        raise SourceValidationError("Wait timeout must be non-negative and polling interval must be positive")

    deadline = monotonic() + timeout_seconds
    while True:
        runs = [
            run for run in parse_runs(api(repository, head_sha, branch))
            if matches_source_run(run, repository=repository, head_sha=head_sha, branch=branch)
        ]
        latest = max(runs, key=run_order) if runs else None
        if latest is not None and latest.get("status") == "completed":
            if latest.get("conclusion") == "success":
                return latest
            raise SourceValidationError(
                "Latest exact-source CI attempt completed without success for "
                f"{head_sha} (conclusion: {latest.get('conclusion') or 'unknown'}, "
                f"run: {latest.get('html_url') or latest.get('id') or 'unknown'}). "
                "An older successful run cannot override a newer failed or cancelled attempt. "
                "Fix or rerun CI for this same commit before release publication."
            )

        if latest is not None and latest.get("status") not in ACTIVE_STATUSES:
            raise SourceValidationError(
                "Latest exact-source CI attempt has an unrecognized status "
                f"({latest.get('status') or 'unknown'}); publication is blocked."
            )

        remaining = deadline - monotonic()
        if remaining <= 0:
            detail = "latest CI run is still in progress" if latest is not None else "no matching main-branch CI run appeared"
            raise SourceValidationError(
                f"Timed out waiting for successful {WORKFLOW_FILE} on exact source "
                f"{head_sha}: {detail}. Publication is blocked."
            )
        sleep(min(poll_seconds, remaining))


def write_summary(path: str, head_sha: str, run: dict[str, Any]) -> None:
    if not path:
        return
    run_id = run.get("id", "unknown")
    url = run.get("html_url")
    run_link = f"[run {run_id}]({url})" if isinstance(url, str) and url.startswith("https://github.com/") else f"run {run_id}"
    with open(path, "a", encoding="utf-8") as summary:
        summary.write(
            "## Exact-source CI prerequisite\n\n"
            f"Successful `{WORKFLOW_FILE}` run for `main` commit `{head_sha}`: "
            f"{run_link}. This is the exact source commit selected for release publication.\n\n"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--head-sha", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--branch", default=os.environ.get("GITHUB_REF_NAME", "main"))
    parser.add_argument("--timeout-seconds", type=float, default=1800)
    parser.add_argument("--poll-seconds", type=float, default=15)
    parser.add_argument("--summary-file", default=os.environ.get("GITHUB_STEP_SUMMARY", ""))
    args = parser.parse_args(argv)
    try:
        run = require_source_ci(
            args.head_sha,
            repository=args.repository,
            branch=args.branch,
            timeout_seconds=args.timeout_seconds,
            poll_seconds=args.poll_seconds,
        )
        write_summary(args.summary_file, args.head_sha, run)
    except SourceValidationError as error:
        print(f"Exact-source CI prerequisite failed: {error}", file=sys.stderr)
        return 1
    print(
        "Exact-source CI passed: "
        f"sha={args.head_sha} workflow={WORKFLOW_FILE} run={run.get('id', 'unknown')} "
        f"attempt={run.get('run_attempt', 'unknown')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
