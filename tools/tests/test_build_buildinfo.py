"""The embedded build metadata is generated, never hand-written, and packaging
fails instead of shipping an app that cannot state its own version."""

from __future__ import annotations

import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import build_buildinfo  # noqa: E402
import validate_release  # noqa: E402

MODULE = ROOT / "TizenTube" / "mods" / "assets" / "buildInfo.generated.js"
CONSUMER = ROOT / "TizenTube" / "mods" / "features" / "appVersion.js"


def run_main(*argv: str) -> tuple[int, str, str]:
    """Run the CLI, returning (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    code = 0
    with patch.object(sys, "argv", ["build_buildinfo.py", *argv]), \
            redirect_stdout(out), redirect_stderr(err):
        try:
            build_buildinfo.main()
        except SystemExit as exit_error:  # noqa: PERF203
            code = int(exit_error.code or 0)
    return code, out.getvalue(), err.getvalue()


class BuildInfoTests(unittest.TestCase):
    def test_metadata_is_the_validated_release_contract(self):
        config = validate_release.load_config()
        info = build_buildinfo.build_info()
        self.assertEqual(info["versionName"], config["VERSION_NAME"])
        self.assertEqual(info["displayVersion"], config["DISPLAY_VERSION"])
        self.assertEqual(info["versionCode"], int(config["VERSION_CODE"]))
        self.assertEqual(info["versionTag"], config["VERSION_TAG"])
        self.assertEqual(info["scriptTag"], config["SCRIPT_TAG"])
        self.assertEqual(info["baseTag"], config["BASE_TAG"])
        self.assertEqual(info["appId"], config["APP_ID"])
        self.assertEqual(info["apkAsset"], config["APK_ARMV7"])
        # The display version follows the packaged one (patch-zero rule), so no
        # release can ship a label that disagrees with its own versionName.
        self.assertEqual(
            info["displayVersion"],
            info["versionName"] if not info["versionName"].endswith(".0")
            else info["versionName"].rsplit(".", 1)[0],
        )
        self.assertEqual(validate_release.version_code_for_release(info["versionName"]), info["versionCode"])

    def test_empty_metadata_is_rejected_instead_of_shipping_unknown(self):
        broken = dict(validate_release.load_config())
        broken["VERSION_NAME"] = ""
        with patch.object(build_buildinfo, "load_config", return_value=broken):
            with self.assertRaises(ValueError):
                build_buildinfo.build_info()
            code, _out, err = run_main("--check")
        self.assertEqual(code, 1)
        self.assertIn("unusable", err)

    def test_rendered_module_is_a_plain_esm_export_of_those_values(self):
        info = build_buildinfo.build_info()
        rendered = build_buildinfo.render(info)
        self.assertIn("export const YTARK_BUILD_INFO =", rendered)
        self.assertIn("Do not edit by hand", rendered)
        payload = re.search(r"YTARK_BUILD_INFO = (\{.*?\});", rendered, re.S).group(1)
        self.assertEqual(json.loads(payload), info)
        self.assertNotIn("unknown", rendered.lower())

    def test_committed_module_matches_the_release_properties(self):
        self.assertTrue(MODULE.is_file(), "the generated module must be committed")
        self.assertEqual(MODULE.read_text(encoding="utf-8"), build_buildinfo.render(build_buildinfo.build_info()))
        code, out, _err = run_main("--check")
        self.assertEqual(code, 0)
        self.assertIn("current", out)

    def test_check_fails_when_the_module_is_missing_or_stale(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "buildInfo.generated.js"
            with patch.object(build_buildinfo, "OUTPUT", target):
                code, _out, err = run_main("--check")
                self.assertEqual(code, 1, "a missing module must fail packaging")
                self.assertIn("Missing", err)
                self.assertIn("--write", err)

                target.write_text("// hand edited\nexport const YTARK_BUILD_INFO = {};\n", encoding="utf-8")
                code, _out, err = run_main("--check")
                self.assertEqual(code, 1, "a stale or hand-edited module must fail packaging")
                self.assertIn("does not match", err)

                code, out, _err = run_main("--write")
                self.assertEqual(code, 0)
                self.assertEqual(target.read_text(encoding="utf-8"),
                                 build_buildinfo.render(build_buildinfo.build_info()))
                code, _out, _err = run_main("--check")
                self.assertEqual(code, 0, "--write then --check is idempotent")
                self.assertIn("Wrote", out)

    def test_json_subcommand_prints_the_metadata(self):
        code, out, _err = run_main("json")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), build_buildinfo.build_info())

    def test_a_mode_is_required(self):
        code, _out, err = run_main()
        self.assertEqual(code, 2)
        self.assertIn("required", err)

    def test_the_runtime_resolver_consumes_the_generated_module(self):
        source = CONSUMER.read_text(encoding="utf-8")
        self.assertIn("from '../assets/buildInfo.generated.js'", source)
        # The installed package stays the authority; the bundle is the fallback.
        self.assertIn("VERSION_SOURCES.package", source)
        self.assertIn("VERSION_SOURCES.bundle", source)
        for forbidden in ("releases/latest", "releases/latest.json", "GetUserAgent()"):
            self.assertNotIn(forbidden, source)
        # No hardcoded version label anywhere in the resolver.
        self.assertNotRegex(source, r"['\"]2\.\d+\.\d+['\"]")


if __name__ == "__main__":
    unittest.main()
