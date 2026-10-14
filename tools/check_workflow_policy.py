#!/usr/bin/env python3
"""Enforce YTArk's release-workflow policy so it cannot drift silently.

Rules
-----
Trust boundary (never relaxed):
- No workflow uses pull_request_target (it would run changed code with secrets).
- The PR validation workflow (ci.yml) is read-only, has no secrets and creates no
  tags or releases.
- Every action is pinned to a full 40-character commit SHA (or is a local
  composite action), so no workflow can float to unpinned third-party code.
- Publication happens only for 2archiver/YTArk, only from a job whose `if`
  proves it, and only after the build/validation job of the same run succeeded.
- Signing secrets may only be read by the trusted main-branch build job.

Release pipeline (2.2 onward):
- build-apk.yml is triggered only by push to main or workflow_dispatch. It builds,
  verifies and then publishes the exact verified bytes in one run; the build job
  itself stays read-only.
- publish-release.yml is the manual recovery path (workflow_dispatch only). It
  binds a named candidate run and commit, verifies that run, and then publishes,
  resumes or repairs the release.
- Both paths share one concurrency group and neither is cancelled mid-upload.
- No workflow declares a staging `environment:` gate, and no workflow requires
  manual device-acceptance evidence before publication.
"""

from __future__ import annotations

import glob
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
TRUSTED_REPOSITORY = "2archiver/YTArk"
PUBLISH_JOB_NAMES = {"publish-release"}
BUILD_JOB_NAMES = {"build-apk-candidates"}

# Commands that create, mutate or delete a tag or a GitHub release.
TAG_OR_RELEASE_WRITE = re.compile(
    r"gh\s+release\s+(create|edit|upload|delete)|git\s+push\b[^\n]*refs/tags|git\s+tag\b|"
    r"--method\s+(POST|PATCH|DELETE|PUT)|tools/publish_script_tag\.sh|"
    r"tools/create_release\.sh|tools/publish_release\.py\s+publish"
)
TRIGGER_BLOCK = re.compile(r"^on:\s*\n((?:[ \t]+.*\n|\s*\n)+?)(?=^\S)", re.M)
PINNED_ACTION = re.compile(r"uses:\s*(?:\./|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}\b)")
JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$", re.M)
SIGNING_SECRET = re.compile(r"secrets\.YTARK_(KEYSTORE|KEY)")


def triggers(text: str) -> set[str]:
    block = TRIGGER_BLOCK.search(text + "\n")
    if not block:
        return set()
    return {m.group(1) for m in re.finditer(r"^  ([a-z_]+):", block.group(1), re.M)}


def jobs(text: str) -> dict[str, str]:
    """Return {job name: job block text} using two-space YAML job indentation."""
    start = text.find("\njobs:\n")
    if start < 0:
        return {}
    body = text[start + 1 :]
    headers = list(JOB_HEADER.finditer(body))
    blocks: dict[str, str] = {}
    for index, match in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(body)
        blocks[match.group(1)] = body[match.end() : end]
    return blocks


def job_condition(block: str) -> str:
    """Return the job-level `if:` expression, including folded scalar bodies."""
    match = re.search(r"^(?P<indent>[ \t]+)if:\s*(?P<value>>.*|\S.*)$", block, re.M)
    if not match:
        return ""
    indent = len(match.group("indent").expandtabs(2))
    lines = [match.group("value")]
    if lines[0].startswith(">"):
        for line in block[match.end() :].splitlines():
            if not line.strip():
                continue
            if len(line) - len(line.lstrip(" \t")) <= indent:
                break
            lines.append(line.strip())
    return " ".join(lines)


def job_needs(block: str) -> set[str]:
    match = re.search(r"^\s+needs:\s*(?:\[([^\]]*)\]|$\n(?:(?:\s+-[^\n]*\n)|\s*)+)", block, re.M)
    if not match:
        return set()
    text = match.group(1) or match.group(0)
    return set(re.findall(r"([A-Za-z0-9_-]+)", text.replace("needs:", " ")))


def writes_releases(block: str) -> list[str]:
    return [m.group(0) for m in TAG_OR_RELEASE_WRITE.finditer(block)]


# A repo script referenced from a `run:` step, e.g. `../tools/check.py`.
SCRIPT_INVOCATION = re.compile(
    r"(?<![\w./$-])(?P<path>(?:\.{1,2}/)?(?:[A-Za-z0-9_.@-]+/)+[A-Za-z0-9_*.@-]+\.(?:py|sh))(?![\w.-])"
)
STEP_START = re.compile(r"^      - name: (.+)$", re.M)
WORKING_DIRECTORY = re.compile(r"^\s+working-directory:\s*(\S+)\s*$", re.M)
RUN_KEY = re.compile(r"^(?P<indent>[ \t]+)run:\s*(?P<value>.*)$", re.M)


def steps(text: str) -> list[tuple[str, str]]:
    """Return (step name, step source) pairs without depending on YAML parsing."""
    starts = list(STEP_START.finditer(text))
    return [
        (
            match.group(1),
            text[match.start() : starts[index + 1].start() if index + 1 < len(starts) else len(text)],
        )
        for index, match in enumerate(starts)
    ]


def run_scripts(step: str) -> list[str]:
    """Return the body of every `run:` script in a step, block scalar or inline."""
    bodies: list[str] = []
    for match in RUN_KEY.finditer(step):
        indent, value = match.group("indent"), match.group("value").strip()
        if value in {"|", "|-", "|+", ">", ">-", ">+"}:
            lines: list[str] = []
            for line in step[match.end() :].splitlines():
                if not line.strip():
                    lines.append("")
                elif len(line) - len(line.lstrip()) <= len(indent):
                    break
                else:
                    lines.append(line)
            bodies.append("\n".join(lines))
        elif value:
            bodies.append(value)
    return bodies


def uncommented(line: str) -> str:
    """Drop a trailing `#` comment so commented-out text is not checked."""
    index = line.find("#")
    while index != -1:
        if index == 0 or line[index - 1].isspace():
            return line[:index]
        index = line.find("#", index + 1)
    return line


def resolves(token: str, base: Path) -> bool:
    """True when a script token exists from the step's working directory or the root."""
    relative = token.startswith("./") or token.startswith("../")
    for candidate in ([base] if relative else [base, ROOT]):
        if (candidate / token).exists():
            return True
        if "*" in token and glob.glob(str(candidate / token)):
            return True
    return False


def check_script_paths(path: Path, failures: list[str]) -> None:
    """Every repo script a step runs must exist from that step's working directory.

    The 2.9 recovery replaced the duplicated symbol list with one shared contract
    checker, but called it as `../tools/check_bundle_contract.py` from
    `working-directory: TizenTube/mods`, where `../tools` is `TizenTube/tools`.
    The run died on a path that no local test could see, so the depth is checked
    here as well.
    """
    text = path.read_text(encoding="utf-8")
    for step_name, step in steps(text):
        directory = WORKING_DIRECTORY.search(step)
        base = ROOT / directory.group(1) if directory else ROOT
        where = directory.group(1) if directory else "the repository root"
        for script in run_scripts(step):
            for line in script.splitlines():
                for match in SCRIPT_INVOCATION.finditer(uncommented(line)):
                    token = match.group("path")
                    if "$" in token or resolves(token, base):
                        continue
                    failures.append(
                        f"{path.name}:{step_name}: `{token}` does not exist relative to "
                        f"{where}; the step would fail before running anything"
                    )


def check_publication_job(name: str, workflow: str, block: str, failures: list[str]) -> None:
    condition = job_condition(block)
    if f"github.repository == '{TRUSTED_REPOSITORY}'" not in condition:
        failures.append(f"{workflow}:{name}: the publish job must be gated on "
                        f"github.repository == '{TRUSTED_REPOSITORY}'")
    missing_needs: set[str] = set()
    if workflow == "build-apk.yml":
        if "refs/heads/main" not in condition:
            failures.append(f"{workflow}:{name}: the publish job must only run on refs/heads/main")
        if "needs.release-guard.result == 'success'" not in condition:
            failures.append(f"{workflow}:{name}: the publish job must require a successful release guard")
        for job in BUILD_JOB_NAMES:
            if f"needs.{job}.result != 'failure'" not in condition:
                missing_needs.add(f"{job} != failure")
            if f"needs.{job}.result != 'cancelled'" not in condition:
                missing_needs.add(f"{job} != cancelled")
        needs = job_needs(block)
        if not BUILD_JOB_NAMES & needs:
            failures.append(f"{workflow}:{name}: the publish job must depend on the build job")
        if "contents: write" not in re.sub(r"\s+", " ", block):
            failures.append(f"{workflow}:{name}: publication needs contents: write")
        if "actions: read" not in re.sub(r"\s+", " ", block):
            failures.append(f"{workflow}:{name}: downloading the artefact needs actions: read")
    if missing_needs:
        failures.append(f"{workflow}:{name}: a failed build must block publication "
                        f"(missing {sorted(missing_needs)})")
    if workflow == "publish-release.yml":
        if "needs.verify-candidate.result == 'success'" not in condition:
            failures.append(f"{workflow}:{name}: publication must require the verified candidate run")


def check(path: Path, failures: list[str]) -> None:
    text = path.read_text(encoding="utf-8")
    name = path.name
    if re.search(r"^\s*pull_request_target\s*:", text, re.M):
        failures.append(f"{name}: pull_request_target is forbidden")
    found = triggers(text)
    blocks = jobs(text)

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("uses:") and not PINNED_ACTION.search(stripped):
            failures.append(f"{name}: action is not pinned to a full commit SHA: {stripped}")
    if re.search(r"^\s*device_acceptance\s*:", text, re.M) or "inputs.device_acceptance" in text:
        failures.append(f"{name}: device acceptance must not be a workflow gate")
    if re.search(r"^\s*environment:\s*\S", text, re.M):
        failures.append(f"{name}: staging environment gates were removed; do not reintroduce them")
    if re.search(r"^\s*cancel-in-progress:\s*true", text, re.M):
        failures.append(f"{name}: release publication must never be cancelled mid-upload")

    check_script_paths(path, failures)

    for job_name, block in sorted(blocks.items()):
        flat = re.sub(r"\s+", " ", block)
        is_publish_job = job_name in PUBLISH_JOB_NAMES
        writes = writes_releases(block)
        contents_write = bool(re.search(r"^\s+contents:\s*write", block, re.M))
        has_signing_secret = bool(SIGNING_SECRET.search(block))

        if name == "ci.yml":
            if contents_write:
                failures.append(f"ci.yml:{job_name}: PR validation must not request contents: write")
            if writes:
                failures.append(f"ci.yml:{job_name}: PR validation must create no tags or releases: {writes[0]!r}")
            if has_signing_secret:
                failures.append(f"ci.yml:{job_name}: PR validation must not see signing secrets")
            if re.search(r"\$\{\{\s*secrets\.", block):
                failures.append(f"ci.yml:{job_name}: PR validation must not use secrets")
            continue

        if contents_write or writes:
            if not is_publish_job:
                failures.append(
                    f"{name}:{job_name}: only the publish job may write tags/releases "
                    f"({writes[0] if writes else 'contents: write'!r})"
                )
            else:
                check_publication_job(job_name, name, block, failures)
        if has_signing_secret and not (name == "build-apk.yml" and job_name in BUILD_JOB_NAMES):
            failures.append(f"{name}:{job_name}: signing secrets are limited to the trusted build job")

    if name == "build-apk.yml":
        if found - {"push", "workflow_dispatch"}:
            failures.append(f"build-apk.yml: unexpected triggers {sorted(found)}")
        if re.search(r"^\s+-?\s*(main)\s*$", text, re.M) is None:
            failures.append("build-apk.yml: must build the main branch")
    elif name == "publish-release.yml":
        if found != {"workflow_dispatch"}:
            failures.append(f"publish-release.yml: must be manual-only, found {sorted(found)}")
        if "--auto" in text:
            failures.append("publish-release.yml: auto-merge/auto-publish is forbidden")
        for required in ("candidate_run_id", "expected_head_sha"):
            if required not in text:
                failures.append(f"publish-release.yml: missing the {required} binding input")
    elif name == "ci.yml":
        if not found & {"pull_request"}:
            failures.append("ci.yml: pull request validation must run on pull_request")


def concurrency_groups() -> dict[str, str]:
    groups: dict[str, str] = {}
    for path in sorted(WORKFLOWS.glob("*.yml")):
        text = path.read_text(encoding="utf-8")
        match = re.search(r"^concurrency:\s*\n\s+group:\s*(\S+)", text, re.M)
        if match:
            groups[path.name] = match.group(1)
    return groups


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

    # Every path that can mutate the same release shares one concurrency group.
    groups = concurrency_groups()
    shared = {groups[name] for name in ("build-apk.yml", "publish-release.yml") if name in groups}
    if len(shared) != 1:
        failures.append(
            f"build-apk.yml and publish-release.yml must share one release concurrency group, got {sorted(shared)}"
        )

    if failures:
        for failure in failures:
            print("workflow policy:", failure, file=sys.stderr)
        return 1
    print("Workflow policy OK:", ", ".join(sorted(names)), "| release concurrency:", sorted(shared)[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
