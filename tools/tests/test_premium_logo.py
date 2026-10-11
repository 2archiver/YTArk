#!/usr/bin/env python3
"""Sanitizer contract tests for the bundled YouTube Premium vector wordmark.

These tests never touch the network: they exercise the sanitizer on synthetic
documents that reproduce the shapes and active-content hazards the real asset
could contain, plus the provenance checks on the asset that is already bundled.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import fetch_premium_logo as logo  # noqa: E402

ASSET_DIR = ROOT / "TizenTube" / "mods" / "assets"

ILLUSTRATOR_STYLE = b"""<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px"
     viewBox="0 0 101 20" xml:space="preserve">
<style type="text/css">
\t.st0{fill:#FF0033;}
\t.st1{fill:#FFFFFF;}
\t.st2{fill:#0F0F0F;}
</style>
<g id="premium">
\t<path class="st0" d="M16.8,0H2.7C1.2,0,0,1.2,0,2.7v14.6C0,18.8,1.2,20,2.7,20h14.1z"/>
\t<path class="st1" d="M12.6,10L7.9,12.7V7.3L12.6,10z"/>
\t<path class="st2" d="M27.6,14.7h1.9l4.4-11.4h-2L27.6,14.7z"/>
</g>
<g transform="translate(40 3)">
\t<path class="st2" d="M0,0h5v5H0V0z"/>
</g>
</svg>
"""


class SanitizerTests(unittest.TestCase):
    def sanitize(self, payload: bytes) -> str:
        sanitized, _report = logo.sanitize(payload, "a test document")
        return sanitized

    def test_keeps_viewbox_paths_transforms_and_paints(self):
        sanitized = self.sanitize(ILLUSTRATOR_STYLE)
        root = ET.fromstring(sanitized)
        self.assertEqual(root.get("viewBox"), "0 0 101 20")
        paths = [node for node in root.iter() if node.tag.endswith("path")]
        self.assertEqual(len(paths), 4)
        self.assertEqual(paths[0].get("fill"), "#FF0033")
        self.assertEqual(paths[1].get("fill"), "#FFFFFF")
        # Class rules are resolved into explicit paint attributes.
        self.assertNotIn("class=", sanitized)
        self.assertNotIn("<style", sanitized)
        # The original path data survives byte for byte.
        self.assertEqual(
            paths[2].get("d"),
            "M27.6,14.7h1.9l4.4-11.4h-2L27.6,14.7z",
        )
        # A group transform is folded onto its child exactly once.
        self.assertEqual(paths[3].get("transform"), "translate(40 3)")

    def test_rejects_scripts_entities_handlers_and_remote_references(self):
        cases = {
            "script": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'
                      b'<script>alert(1)</script><path d="M0,0h1v1z"/></svg>',
            "doctype": b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
                       b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'
                       b'<path d="M0,0h1v1z"/></svg>',
            "handler": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'
                       b'<path d="M0,0h1v1z" onload="evil()"/></svg>',
            "remote": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'
                      b'<path d="M0,0h1v1z" fill="url(https://evil.example/a.svg#x)"/></svg>',
            "raster": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'
                      b'<image href="data:image/png;base64,AAAA"/></svg>',
            "foreignObject": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'
                             b'<foreignObject><b>x</b></foreignObject></svg>',
        }
        for name, payload in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(SystemExit):
                    self.sanitize(payload)

    def test_rejects_a_document_without_geometry_or_viewbox(self):
        with self.assertRaises(SystemExit):
            self.sanitize(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>')
        with self.assertRaises(SystemExit):
            self.sanitize(b'<svg xmlns="http://www.w3.org/2000/svg">'
                          b'<path d="M0,0h1v1z"/></svg>')
        with self.assertRaises(SystemExit):
            self.sanitize(b"<html><body>not an svg</body></html>")


@unittest.skipUnless(ASSET_DIR.is_dir(), "bundled assets are not present")
class BundledAssetTests(unittest.TestCase):
    """The committed asset must match its recorded provenance exactly."""

    def setUp(self) -> None:
        provenance = ASSET_DIR / "youtube-premium-logo-2024.provenance.json"
        if not provenance.is_file():
            self.skipTest("the sanitized vector asset has not been fetched yet")
        self.provenance = json.loads(provenance.read_text(encoding="utf-8"))

    def test_provenance_points_at_the_pinned_commons_revision(self):
        self.assertEqual(self.provenance["source_page"], logo.SOURCE_PAGE)
        self.assertEqual(self.provenance["source_url"], logo.SOURCE_URL)
        self.assertEqual(self.provenance["retrieved_sha1"], logo.SOURCE_SHA1)
        self.assertEqual(self.provenance["retrieved_bytes"], logo.SOURCE_SIZE)
        self.assertEqual(self.provenance["viewBox"], f"0 0 {logo.SOURCE_WIDTH} {logo.SOURCE_HEIGHT}")
        self.assertIn("public domain", self.provenance["license"].lower())

    def test_bundled_asset_matches_its_recorded_hash(self):
        payload = (ASSET_DIR / "youtube-premium-logo-2024.svg").read_bytes()
        self.assertEqual(logo.sha256_of(payload), self.provenance["sanitized_sha256"])
        original = (ASSET_DIR / "youtube-premium-logo-2024.source.svg").read_bytes()
        self.assertEqual(len(original), logo.SOURCE_SIZE)
        self.assertEqual(logo.sha1_of(original), logo.SOURCE_SHA1)

    def test_bundled_asset_is_self_contained_vector_geometry(self):
        text = (ASSET_DIR / "youtube-premium-logo-2024.svg").read_text(encoding="utf-8")
        logo.reject_unsafe(text, "the bundled asset")
        for forbidden in ("<script", "<style", "class=", "id=", "http://", "https://"):
            self.assertNotIn(forbidden, text.replace(
                'xmlns="http://www.w3.org/2000/svg"', ""))
        root = ET.fromstring(text)
        self.assertEqual(root.get("viewBox"), f"0 0 {logo.SOURCE_WIDTH} {logo.SOURCE_HEIGHT}")


class FetchIdempotenceTests(unittest.TestCase):
    """Re-running the pinned fetch must not rewrite an unchanged revision."""

    def test_an_unchanged_revision_keeps_its_first_verification_date(self):
        previous = {
            "retrieved_sha1": logo.SOURCE_SHA1,
            "sanitized_sha256": "a" * 64,
            "retrieved_utc": "2026-10-11T05:04:55Z",
        }
        self.assertEqual(
            logo.first_verified_retrieval_utc(
                previous, logo.SOURCE_SHA1, "a" * 64, "2030-01-01T00:00:00Z"),
            "2026-10-11T05:04:55Z")

    def test_a_new_revision_or_sanitizer_change_records_a_new_date(self):
        previous = {
            "retrieved_sha1": logo.SOURCE_SHA1,
            "sanitized_sha256": "a" * 64,
            "retrieved_utc": "2026-10-11T05:04:55Z",
        }
        self.assertEqual(
            logo.first_verified_retrieval_utc(
                previous, "b" * 40, "a" * 64, "2030-01-01T00:00:00Z"),
            "2030-01-01T00:00:00Z")
        self.assertEqual(
            logo.first_verified_retrieval_utc(
                previous, logo.SOURCE_SHA1, "c" * 64, "2030-01-01T00:00:00Z"),
            "2030-01-01T00:00:00Z")
        self.assertEqual(
            logo.first_verified_retrieval_utc(None, logo.SOURCE_SHA1, "a" * 64,
                                               "2030-01-01T00:00:00Z"),
            "2030-01-01T00:00:00Z")


class GeneratedModuleTests(unittest.TestCase):
    """The runtime module must stay the bundled vector, never a redraw."""

    def setUp(self) -> None:
        self.generated = ASSET_DIR / "youtubePremiumLogo.generated.js"
        if not self.generated.is_file():
            self.skipTest("the generated wordmark module has not been written yet")
        self.text = self.generated.read_text(encoding="utf-8")

    def test_module_is_current_with_the_bundled_svg(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "build_logo_asset.py"), "--check"],
            capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0,
                         f"the bundled module is stale:\n{result.stdout}\n{result.stderr}")

    def test_every_source_path_is_bundled_with_its_paint(self):
        root = ET.fromstring((ASSET_DIR / "youtube-premium-logo-2024.svg").read_text("utf-8"))
        source_paths = [element for element in root.iter() if element.tag.endswith("path")]
        self.assertGreater(len(source_paths), 0)
        for element in source_paths:
            self.assertIn(element.get("d"), self.text,
                          "a source path is missing from the runtime module")
        self.assertIn('viewBox: \'0 0 101 20\'', self.text)
        # The emblem keeps its literal paint; only the lettering is an ink path.
        self.assertIn('paint: \'icon-red\'', self.text)
        self.assertIn('paint: \'icon-white\'', self.text)
        self.assertIn("'#FF0033'", self.text)
        self.assertIn("'white'", self.text)
        self.assertIn("paint: 'ink'", self.text)
        self.assertEqual(self.text.count("paint: 'ink'"), len(source_paths) - 2,
                         "exactly the lettering paths are ink-painted")

    def test_module_is_independent_of_the_retrieval_timestamp(self):
        """Re-running the pinned fetch must never move the userscript bytes."""
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            provenance = json.loads(
                (ASSET_DIR / "youtube-premium-logo-2024.provenance.json").read_text("utf-8"))
            provenance["retrieved_utc"] = "1999-01-01T00:00:00Z"
            provenance_path = temp_path / "provenance.json"
            provenance_path.write_text(json.dumps(provenance, indent=2), encoding="utf-8")
            out_path = temp_path / "generated.js"
            subprocess.run(
                [sys.executable, str(ROOT / "tools" / "build_logo_asset.py"),
                 "--svg", str(ASSET_DIR / "youtube-premium-logo-2024.svg"),
                 "--provenance", str(provenance_path), "--out", str(out_path)],
                check=True, capture_output=True, text=True)
            self.assertEqual(out_path.read_text(encoding="utf-8"), self.text,
                             "the runtime module must not depend on the retrieval date")

    def test_module_carries_no_text_raster_or_external_reference(self):
        # Provenance URLs live in the leading comment block only. No executable
        # line may reference an image, a font or a remote resource: stripping the
        # comments must leave a self-contained geometry literal.
        code = "\n".join(
            line for line in self.text.splitlines() if not line.lstrip().startswith("//"))
        # The provenance object keeps the source URLs as inert documentation
        # strings for the release/NOTICE trail; nothing may fetch them.
        body = code.split("  provenance:", 1)[0]
        self.assertNotIn("http", body, "the geometry itself must not carry a URL")
        for forbidden in ("<text", "<image", "<style", "href=", "@font-face",
                          "url(", "fetch(", "XMLHttpRequest", "new Image"):
            self.assertNotIn(forbidden, body,
                             "the runtime module must not carry non-vector content")
        # The documentation still records the origin it was verified against.
        self.assertIn("commons.wikimedia.org", self.text)
        self.assertIn("9ec3ad62f293d10e98cb637d0303a7e7e4188947", self.text)


if __name__ == "__main__":
    unittest.main()
