"""Tests for tools/check_no_secrets.py (deliberate fixtures carry the allow marker)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import check_no_secrets

FAKE_PEM = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"  # ytrk-secret-scan: allow
FAKE_TOKEN = "ghp_" + "a" * 36  # ytrk-secret-scan: allow
FAKE_QUOTED = '"password": "hunter2secret"'  # ytrk-secret-scan: allow


class SecretScanTests(unittest.TestCase):
    def test_clean_text_has_no_findings(self):
        data = b"versionName=2.0.4-ytark.17\napp label YTArk\n"
        self.assertEqual(check_no_secrets._file_findings("clean.txt", data), [])

    def test_private_key_block_is_flagged(self):
        data = FAKE_PEM.encode("utf-8")
        findings = check_no_secrets._file_findings("leak.txt", data)
        self.assertTrue(any("private key block" in item for item in findings))

    def test_allow_marker_exempts_a_line(self):
        data = f"fixture = {FAKE_PEM!r}  # ytrk-secret-scan: allow\n".encode("utf-8")
        self.assertEqual(check_no_secrets._file_findings("fixture.py", data), [])

    def test_public_certificate_is_not_flagged(self):
        data = b"-----BEGIN CERTIFICATE-----\nMIIE\n-----END CERTIFICATE-----\n"
        self.assertEqual(check_no_secrets._file_findings("cert.pem", data), [])

    def test_keystore_filename_is_flagged(self):
        findings = check_no_secrets._file_findings("release.p12", b"\x00\x01")
        self.assertTrue(any("keystore file" in item for item in findings))
        for name in ("key.jks", "key.keystore", "key.pfx"):
            self.assertTrue(check_no_secrets._file_findings(name, b"x"))

    def test_jks_magic_bytes_are_flagged(self):
        findings = check_no_secrets._file_findings("blob.bin", JKS := b"\xfe\xed\xfe\xed" + b"\x00" * 64)
        self.assertTrue(any("magic bytes" in item for item in findings))

    def test_github_token_shapes_are_flagged(self):
        findings = check_no_secrets._file_findings("env.txt", FAKE_TOKEN.encode("utf-8"))
        self.assertTrue(any("GitHub token" in item for item in findings))
        other = "github_pat_" + "A" * 22  # ytrk-secret-scan: allow
        findings = check_no_secrets._file_findings("env.txt", other.encode("utf-8"))
        self.assertTrue(any("fine-grained" in item for item in findings))

    def test_quoted_credential_assignment_is_flagged(self):
        findings = check_no_secrets._file_findings("config.yml", FAKE_QUOTED.encode("utf-8"))
        self.assertTrue(any("credential assignment" in item for item in findings))

    def test_unquoted_public_community_password_is_accepted(self):
        data = b"communityKeystorePassword=phairplay\ncommunityKeyPassword=phairplay\n"
        self.assertEqual(check_no_secrets._file_findings("signing.properties", data), [])

    def test_binary_files_do_not_crash_the_scan(self):
        self.assertEqual(
            check_no_secrets._file_findings("art.png", b"\x89PNG\r\n\x1a\n" + bytes(64)), [])

    def test_non_utf8_binary_without_jks_magic_is_clean(self):
        self.assertEqual(
            check_no_secrets._file_findings("lib.so", b"\x7fELF" + b"\xff" * 32), [])


if __name__ == "__main__":
    unittest.main()
