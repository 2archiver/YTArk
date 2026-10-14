"""Regressions for the userscript bundle contract and the 2.9 build outage.

The release build of 2.9 and 2.9.1 failed in the userscript step because
``build-apk.yml`` carried its own copy of the required bundle symbols and still
required ``YTARK_YTS_EDITOR`` after the 2.9 settings work retired that command.
The list now lives in ``release/bundle-contract.json`` and one tool checks it in
both workflows. These tests assert the behaviour of that gate — it must pass on
the real artefact, and it must fail loudly, naming the offending entry, when a
required symbol disappears, a retired symbol survives or the artefact is missing.
"""

from __future__ import annotations

import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import check_bundle_contract  # noqa: E402

CONTRACT_PATH = ROOT / "release" / "bundle-contract.json"
BUNDLE_PATH = ROOT / "TizenTube" / "dist" / "userScript.js"
WORKFLOWS = (
    ROOT / ".github" / "workflows" / "build-apk.yml",
    ROOT / ".github" / "workflows" / "ci.yml",
)


def run_tool(bundle: Path, contract: Path = CONTRACT_PATH) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        status = check_bundle_contract.main(["--bundle", str(bundle), "--contract", str(contract)])
    return status, out.getvalue(), err.getvalue()


def write_bundle(directory: Path, text: str) -> Path:
    path = directory / "userScript.js"
    path.write_text(text, encoding="utf-8")
    return path


class ContractShapeTests(unittest.TestCase):
    def test_contract_parses_and_does_not_contradict_itself(self):
        contract = check_bundle_contract.load_contract(CONTRACT_PATH)
        required = set(contract["bundle"]["required"])
        forbidden = set(contract["bundle"]["forbidden"])
        retired = set(contract["retiredActions"])
        self.assertTrue(required)
        self.assertTrue(retired)
        self.assertFalse(required & forbidden)
        self.assertFalse(required & retired)

    def test_retired_editor_commands_are_not_required_and_the_restore_command_is(self):
        contract = check_bundle_contract.load_contract(CONTRACT_PATH)
        required = set(contract["bundle"]["required"])
        self.assertIn("YTARK_YTS_RESTORE_CONFIRM", required)
        self.assertNotIn("YTARK_YTS_EDITOR", required)

    def test_contract_rejects_a_missing_or_contradictory_file(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "nope.json"
            with self.assertRaises(check_bundle_contract.ContractError):
                check_bundle_contract.load_contract(missing)
            broken = Path(directory) / "contract.json"
            broken.write_text(
                json.dumps({
                    "schema": 1,
                    "bundle": {"required": ["A"], "forbidden": ["A"]},
                    "retiredActions": [],
                }),
                encoding="utf-8",
            )
            with self.assertRaises(check_bundle_contract.ContractError):
                check_bundle_contract.load_contract(broken)


class GateBehaviourTests(unittest.TestCase):
    def test_missing_required_symbol_fails_and_names_it(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = write_bundle(Path(directory), "only unrelated text")
            status, _, err = run_tool(bundle)
            self.assertEqual(status, 1)
            contract = check_bundle_contract.load_contract(CONTRACT_PATH)
            first = contract["bundle"]["required"][0]
            self.assertIn(first, err)
            self.assertIn("missing the required symbol", err)

    def test_surviving_retired_command_fails_and_names_it(self):
        with tempfile.TemporaryDirectory() as directory:
            contract = check_bundle_contract.load_contract(CONTRACT_PATH)
            text = " ".join(contract["bundle"]["required"]) + " YTARK_YTS_EDITOR"
            bundle = write_bundle(Path(directory), text)
            status, _, err = run_tool(bundle)
            self.assertEqual(status, 1)
            self.assertIn("YTARK_YTS_EDITOR", err)
            self.assertIn("retired code", err)

    def test_stale_duplicate_required_symbol_is_the_2_9_regression(self):
        """A contract that still requires the retired editor command must fail.

        This is the exact configuration that broke the 2.9 release: the required
        list named YTARK_YTS_EDITOR while the shipped sources had retired it.
        """
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
            contract["bundle"]["required"].append("YTARK_YTS_EDITOR")
            stale = directory / "stale-contract.json"
            stale.write_text(json.dumps(contract), encoding="utf-8")
            status, _, err = run_tool(stale, contract=stale)
            self.assertEqual(status, 1, "the stale 2.9 contract must fail the gate")
            self.assertIn("YTARK_YTS_EDITOR", err)

    def test_empty_or_missing_bundle_fails_clearly(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            empty = write_bundle(directory, "")
            status, _, err = run_tool(empty)
            self.assertEqual(status, 1)
            self.assertIn("empty", err)
            status, _, err = run_tool(directory / "does-not-exist.js")
            self.assertEqual(status, 1)
            self.assertIn("missing", err)

    def test_markup_and_branding_rules_fail_on_forbidden_content(self):
        with tempfile.TemporaryDirectory() as directory:
            contract = check_bundle_contract.load_contract(CONTRACT_PATH)
            required = " ".join(contract["bundle"]["required"])
            with_markup = write_bundle(Path(directory), required + " <image href='https://x/y.png'>")
            status, _, err = run_tool(with_markup)
            self.assertEqual(status, 1)
            self.assertIn("text/raster/external logo content", err)
            with_branding = write_bundle(Path(directory), required + " Personal Tube TV")
            status, _, err = run_tool(with_branding)
            self.assertEqual(status, 1)
            self.assertIn("deprecated product branding", err)


class RealArtifactTests(unittest.TestCase):
    def test_contract_holds_for_the_checked_in_sources(self):
        contract = check_bundle_contract.load_contract(CONTRACT_PATH)
        failures: list[str] = []
        check_bundle_contract.check_sources(contract, failures)
        self.assertEqual(failures, [])

    @unittest.skipUnless(
        BUNDLE_PATH.is_file(),
        "the userscript bundle is not built; ci.yml builds it before running these tests",
    )
    def test_contract_holds_for_the_built_bundle(self):
        status, out, err = run_tool(BUNDLE_PATH)
        self.assertEqual(status, 0, f"the built bundle violates the contract: {err}")
        self.assertIn("Bundle contract OK", out)


class NoDuplicateContractTests(unittest.TestCase):
    """The list must have exactly one home, in both directions."""

    def test_both_release_workflows_call_the_shared_checker(self):
        for workflow in WORKFLOWS:
            text = workflow.read_text(encoding="utf-8")
            self.assertIn(
                "tools/check_bundle_contract.py", text,
                f"{workflow.name} must use the shared bundle contract checker",
            )

    def test_no_workflow_carries_its_own_symbol_list_again(self):
        for workflow in WORKFLOWS:
            text = workflow.read_text(encoding="utf-8")
            self.assertIsNone(
                re.search(r"for\s+(needle|retired)\s+in\s", text),
                f"{workflow.name} reintroduced an inline bundle symbol list; "
                "add the symbol to release/bundle-contract.json instead",
            )
            for symbol in ("YTARK_YTS_EDITOR", "ytark-theme-oled", "app-quality-root"):
                self.assertNotIn(
                    symbol, text,
                    f"{workflow.name} hardcodes the bundle symbol {symbol} instead of "
                    "reading release/bundle-contract.json",
                )

    def test_userscript_tests_read_the_same_contract(self):
        test_file = ROOT / "TizenTube" / "mods" / "tests" / "yt-settings-layout.test.mjs"
        text = test_file.read_text(encoding="utf-8")
        self.assertIn("bundle-contract.json", text)
        self.assertNotIn("'YTARK_YTS_EDITOR'", text)


if __name__ == "__main__":
    unittest.main()
