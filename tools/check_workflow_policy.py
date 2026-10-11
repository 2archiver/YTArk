#!/usr/bin/env python3
"""Enforce YTArk's release-workflow policy so it cannot drift silently.

Rules:
- No workflow uses pull_request_target (it would run changed code with secrets).
- The PR validation workflow (ci.yml) is read-only, has no secrets and creates no
  tags or releases.
- The candidate workflow (build-apk.yml) is triggered only by push to main or
  workflow_dispatch, never by pull_request, and creates no tags or releases.
- Only publish-release.yml may write releases or tags, and it is manual-only
  (workflow_dispatch) and bound to the ytark-release environment.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
TAG_OR_RELEASE_WRITE = re.compile(
    r"gh\s+release\s+(create|edit|upload|delete)|git\s+push\b[^\n]*refs/tags|git\s+tag\b|"
    r"--method\s+(POST|PATCH|DELETE|PUT)|tools/publish_script_tag\.sh|tools/create_release\.sh"
)
TRIGGER_BLOCK = re.compile(r"^on:\s*\n((?:[ \t]+.*\n|\s*\n)+?)(?=^\S)", re.M)


def triggers(text: str) -> set[str]:
    block = TRIGGER_BLOCK.search(text + "\n")
    if not block:
        return set()
    return {m.group(1) for m in re.finditer(r"^  ([a-z_]+):", block.group(1), re.M)}


def check(path: Path, failures: list[str]) -> None:
    text = path.read_text(encoding="utf-8")
    name = path.name
    if re.search(r"^\s*pull_request_target\s*:", text, re.M):
        failures.append(f"{name}: pull_request_target is forbidden")
    found = triggers(text)
    writes = [m.group(0) for m in TAG_OR_RELEASE_WRITE.finditer(text)]

    if name == "ci.yml":
        if re.search(r"^\s+contents:\s*write", text, re.M):
            failures.append("ci.yml: PR validation must not request contents: write")
        if re.search(r"\$\{\{\s*secrets\.", text):
            failures.append("ci.yml: PR validation must not use secrets")
        if writes:
            failures.append(f"ci.yml: PR validation must create no tags or releases: {writes[0]!r}")
    elif name == "build-apk.yml":
        if found - {"push", "workflow_dispatch"}:
            failures.append(f"build-apk.yml: unexpected triggers {sorted(found)}")
        if re.search(r"^\s+contents:\s*write", text, re.M):
            failures.append("build-apk.yml: the candidate workflow must not request contents: write")
        if writes:
            failures.append(f"build-apk.yml: candidate builds create no tags or releases: {writes[0]!r}")
    elif name == "publish-release.yml":
        if found != {"workflow_dispatch"}:
            failures.append(f"publish-release.yml: must be manual-only, found {sorted(found)}")
        if "environment: ytark-release" not in text:
            failures.append("publish-release.yml: publishing jobs must use the ytark-release environment")
        if "--auto" in text:
            failures.append("publish-release.yml: auto-merge/auto-publish is forbidden")
    else:
        if re.search(r"^\s+contents:\s*write", text, re.M) and writes:
            failures.append(f"{name}: writes tags/releases outside the publish workflow")


def main() -> int:
    failures: list[str] = []
    paths = sorted(WORKFLOWS.glob("*.yml"))
    if not paths:
        failures.append("no workflows found")
    for path in paths:
        check(path, failures)
    names = {p.name for p in paths}
    for required in ("ci.yml", "build-apk.yml", "publish-release.yml"):
        if required not in names:
            failures.append(f"missing workflow {required}")
    if failures:
        for failure in failures:
            print("workflow policy:", failure, file=sys.stderr)
        return 1
    print("Workflow policy OK:", ", ".join(sorted(names)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
