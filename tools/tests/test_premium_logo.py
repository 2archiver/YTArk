#!/usr/bin/env python3
"""Sanitizer contract tests for the bundled YouTube Premium vector wordmark.

These tests never touch the network: they exercise the sanitizer on synthetic
documents that reproduce the shapes and active-content hazards the real asset
could contain, plus the provenance checks on the asset that is already bundled.
"""

from __future__ import annotations

import json
import sys
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


if __name__ == "__main__":
    unittest.main()
