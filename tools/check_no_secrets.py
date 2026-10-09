#!/usr/bin/env python3
"""Fail the build if signing keys, keystores, or credential tokens leak.

Scans the worktree (tracked and not-ignored files) and, with ``--history``,
every Git blob ever committed. Detection targets:

- PEM/OpenSSH/PKCS#8 private key blocks (public certificates are fine)
- keystore filenames (*.p12, *.pfx, *.jks, *.keystore, *.bks, *.jceks) tracked
  in Git, and Java keystore magic bytes in file contents
- well-known access-token shapes (GitHub, Slack, AWS access keys)

Deliberate, documented test fixtures may be exempted per line with the marker
``# ytrk-secret-scan: allow``. Exit code 0 means clean; 1 means findings.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ALLOW_MARKER = "ytrk-secret-scan: allow"
KEYSTORE_SUFFIXES = (".p12", ".pfx", ".jks", ".keystore", ".bks", ".jceks")
JKS_MAGIC = b"\xfe\xed\xfe\xed"

TEXT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("private key block", re.compile(
        r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----")),
    ("GitHub token", re.compile(r"\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{20,}")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("AWS access key id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("quoted credential assignment", re.compile(
        r"(?i)\b(?:password|passwd|secret|api[_-]?key|auth[_-]?token)\b"
        r"[\"']?\s*[:=]\s*[\"'][A-Za-z0-9+/=_\-!?#@~]{12,}[\"']")),
)


def _iter_worktree_files() -> list[Path]:
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT, text=False)
    paths = [ROOT / name.decode("utf-8")
             for name in tracked.split(b"\0") if name]
    untracked = subprocess.check_output(
        ["git", "ls-files", "-z", "--others", "--exclude-standard"],
        cwd=ROOT, text=False)
    paths.extend(ROOT / name.decode("utf-8")
                 for name in untracked.split(b"\0") if name)
    return sorted(set(paths))


def _iter_history_blobs() -> list[tuple[str, bytes]]:
    listing = subprocess.check_output(
        ["git", "rev-list", "--objects", "--all"], cwd=ROOT, text=True)
    oids = []
    for line in listing.splitlines():
        parts = line.split(None, 1)
        if len(parts) >= 1:
            oids.append(parts[0])
    blobs: list[tuple[str, bytes]] = []
    if not oids:
        return blobs
    proc = subprocess.Popen(
        ["git", "cat-file", "--batch"], cwd=ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    assert proc.stdin and proc.stdout
    proc.stdin.write(("\n".join(oids) + "\n").encode("ascii"))
    proc.stdin.close()
    while True:
        header = proc.stdout.readline()
        if not header:
            break
        fields = header.split()
        if len(fields) != 3 or fields[1] != b"blob":
            continue
        size = int(fields[2])
        blobs.append((fields[0].decode("ascii"), proc.stdout.read(size)))
        proc.stdout.read(1)  # trailing newline
    proc.wait()
    return blobs


def _text_findings(name: str, text: str) -> list[str]:
    findings = []
    for line_number, line in enumerate(text.splitlines(), 1):
        if ALLOW_MARKER in line:
            continue
        for label, pattern in TEXT_PATTERNS:
            if pattern.search(line):
                findings.append(f"{name}:{line_number}: {label}")
                break
    return findings


def _file_findings(name: str, data: bytes) -> list[str]:
    if name.endswith(KEYSTORE_SUFFIXES):
        return [f"{name}: keystore file must never be committed"]
    findings = []
    if JKS_MAGIC in data[:64]:
        findings.append(f"{name}: Java keystore magic bytes")
    lowered = name.lower()
    if lowered.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".so",
                          ".dex", ".jar", ".zip", ".gz", ".jar")):
        return findings
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return findings
    findings.extend(_text_findings(name, text))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true",
                        help="also scan every Git blob ever committed")
    args = parser.parse_args()

    findings: list[str] = []
    for path in _iter_worktree_files():
        if not path.is_file():
            continue
        findings.extend(_file_findings(str(path.relative_to(ROOT)),
                                       path.read_bytes()))

    if args.history:
        for oid, data in _iter_history_blobs():
            findings.extend(_file_findings(f"history:{oid}", data))

    if findings:
        print("YTArk secret scan FAILED — possible credential material:",
              file=sys.stderr)
        for line in findings:
            print("  " + line, file=sys.stderr)
        print("If a line is a deliberate public fixture, mark it with "
              f"'# {ALLOW_MARKER}'.", file=sys.stderr)
        return 1
    scope = "worktree and history" if args.history else "worktree"
    print(f"YTArk secret scan passed ({scope}): no key material or tokens found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
