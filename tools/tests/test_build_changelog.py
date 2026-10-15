"""CHANGELOG.md is the single changelog source: these tests pin its structure,
the generated in-app module and the release-notes extraction."""

from __future__ import annotations

import json
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import build_changelog  # noqa: E402
import validate_release  # noqa: E402

# Every stable release published on GitHub (gh release list), newest first.
PUBLISHED = [
    ("3.3.0", "v3.3.0", "2026-10-15", 3030000, "s32"),
    ("3.2.0", "v3.2.0", "2026-10-14", 3020000, "s31"),
    ("3.1.0", "v3.1.0", "2026-10-14", 3010000, "s30"),
    ("3.0.0", "v3.0.0", "2026-10-14", 3000000, "s29"),
    ("2.9.0", "v2.9.0", "2026-10-14", 2090000, "s28"),
    ("2.8.0", "v2.8.0", "2026-10-13", 2080000, "s27"),
    ("2.7.0", "v2.7.0", "2026-10-13", 2070000, "s26"),
    ("2.6.0", "v2.6.0", "2026-10-13", 2060000, "s25"),
    ("2.5.0", "v2.5.0", "2026-10-11", 2050000, "s24"),
    ("2.4.0", "v2.4.0", "2026-10-11", 2040000, "s23"),
    ("2.3.0", "v2.3.0", "2026-10-11", 2030000, "s22"),
    ("2.2.0", "v2.2.0", "2026-10-11", 2020000, "s21"),
    ("2.1.2", "v2.1.2", "2026-10-11", 2010200, "s20"),
    ("2.1.1", "v2.1.1", "2026-10-11", 2010100, "s19"),
    ("2.1.0", "v2.1.0", "2026-10-10", 2010000, "s18"),
    ("2.0.4-ytark.17", "v2.0.4-ytark.17", "2026-10-09", 20017, "s17"),
    ("2.0.4-ytark.16", "v2.0.4-ytark.16", "2026-10-09", 20016, "s16"),
    ("2.0.3-ytark.15", "v2.0.3-ytark.15", "2026-10-09", 20015, "s15"),
    ("2.0.2-personal.14", "v2.0.2-personal.14", "2026-10-09", 20014, "s14"),
]

VALID = textwrap.dedent("""\
    # Changelog

    Intro text is ignored.

    ## [1.1.0] — Unreleased

    > Not yet published. Planned tag `v1.1.0` · versionCode 1010000 · userscript `s2`

    Summary line.

    ### Added
    - **Bold** feature with `code` and a [link](https://example.com)
      that continues here.
      - nested detail

    ## [1.0.0] — 2026-01-02

    > Published 2026-01-02 10:00 UTC as [App 1.0](https://github.com/2archiver/YTArk/releases/tag/v1.0.0) · tag `v1.0.0` · versionCode 1000000 · userscript `s1`

    ### Fixed
    - A fix.

    ## Unpublished drafts and other tags

    - `v1.0.0-probe` was a draft.
    """)


def parse(text: str) -> dict:
    model = build_changelog.parse(text)
    build_changelog.validate(model)
    return model


class ChangelogFormatTests(unittest.TestCase):
    def test_parses_versions_sections_items_and_notes(self):
        model = parse(VALID)
        first, second = model["entries"]
        self.assertEqual((first["version"], first["status"], first["date"]), ("1.1.0", "unreleased", None))
        self.assertEqual(first["meta"]["tag"], "v1.1.0")
        self.assertEqual(first["summary"], "Summary line.")
        items = first["sections"][0]["items"]
        self.assertEqual(items[0]["text"], "**Bold** feature with `code` and a [link](https://example.com) that continues here.")
        self.assertTrue(items[1]["nested"])
        self.assertEqual(second["meta"]["publishedAt"], "2026-01-02T10:00Z")
        self.assertEqual(second["meta"]["releaseUrl"], "https://github.com/2archiver/YTArk/releases/tag/v1.0.0")
        self.assertEqual(model["notes"][0]["title"], "Unpublished drafts and other tags")
        bundled = build_changelog.bundle_model(model, VALID)
        self.assertEqual(bundled["entries"][0]["sections"][0]["items"][0],
                         "Bold feature with code and a link that continues here.")
        self.assertEqual(bundled["entries"][0]["sections"][0]["items"][1], "– nested detail")
        self.assertEqual(bundled["entries"][1]["display"], "1.0")

    def test_rejects_structural_mistakes(self):
        cases = {
            "unsorted": VALID.replace("## [1.1.0] — Unreleased", "## [0.9.0] — Unreleased")
                             .replace("`v1.1.0`", "`v0.9.0`"),
            "unknown section": VALID.replace("### Fixed", "### Misc"),
            "angle brackets": VALID.replace("A fix.", "A <b>fix</b>."),
            "deprecated branding": VALID.replace("A fix.", "Personal  Tube TV fix."),
            "missing metadata": VALID.replace(
                "> Published 2026-01-02 10:00 UTC as [App 1.0](https://github.com/2archiver/YTArk/releases/tag/v1.0.0) · tag `v1.0.0` · versionCode 1000000 · userscript `s1`\n", ""),
            "published without link": VALID.replace(
                "[App 1.0](https://github.com/2archiver/YTArk/releases/tag/v1.0.0)", "App 1.0"),
            "date mismatch": VALID.replace("Published 2026-01-02", "Published 2026-01-03"),
            "unreleased with a time": VALID.replace("Not yet published.", "Published 2026-01-05 10:00 UTC."),
            "wrong tag": VALID.replace("tag `v1.0.0`", "tag `v1.0.1`"),
            "duplicate version": VALID + "\n## [1.0.0] — 2026-01-02\n\n> Published 2026-01-02 10:00 UTC as [x](https://github.com/2archiver/YTArk/releases/tag/v1.0.0) · tag `v1.0.0` · versionCode 1000000 · userscript `s1`\n\n### Fixed\n- again\n",
            "second unreleased": VALID.replace("## [1.0.0] — 2026-01-02", "## [1.0.0] — Unreleased")
                                    .replace("> Published 2026-01-02 10:00 UTC as", "> Planned as"),
        }
        for name, text in cases.items():
            with self.subTest(name):
                with self.assertRaises(build_changelog.ChangelogError):
                    parse(text)

    def test_a_published_version_may_be_one_summary_line(self):
        text = textwrap.dedent("""\
            # Changelog

            ## [1.1.0] — Unreleased

            > Not yet published. Planned tag `v1.1.0` · versionCode 1010000 · userscript `s2`

            Summary line.

            ### Added
            - Current work.

            ## [1.0.0] — 2026-01-02

            > Published 2026-01-02 10:00 UTC as [App 1.0](https://github.com/2archiver/YTArk/releases/tag/v1.0.0) · tag `v1.0.0` · versionCode 1000000 · userscript `s1`

            One short line for an older release.
            """)
        model = parse(text)
        self.assertEqual(model["entries"][1]["sections"], [])
        self.assertEqual(model["entries"][1]["summary"], "One short line for an older release.")

    def test_an_empty_version_is_rejected(self):
        text = textwrap.dedent("""\
            # Changelog

            ## [1.1.0] — Unreleased

            > Not yet published. Planned tag `v1.1.0` · versionCode 1010000 · userscript `s2`

            ### Added
            - Current work.

            ## [1.0.0] — 2026-01-02

            > Published 2026-01-02 10:00 UTC as [App 1.0](https://github.com/2archiver/YTArk/releases/tag/v1.0.0) · tag `v1.0.0` · versionCode 1000000 · userscript `s1`
            """)
        with self.assertRaises(build_changelog.ChangelogError):
            parse(text)

    def test_the_newest_entry_keeps_sectioned_notes(self):
        text = textwrap.dedent("""\
            # Changelog

            ## [1.1.0] — Unreleased

            > Not yet published. Planned tag `v1.1.0` · versionCode 1010000 · userscript `s2`

            Only a summary.
            """)
        with self.assertRaises(build_changelog.ChangelogError):
            parse(text)

    def test_versions_sort_like_android_version_codes(self):
        ordered = ["2.9.0", "2.8.0", "2.7.0", "2.6.0", "2.5.0", "2.4.0", "2.3.0", "2.2.0", "2.1.2", "2.1.0", "2.0.4", "2.0.4-ytark.17", "2.0.4-ytark.16", "2.0.2-personal.14"]
        keys = [build_changelog.version_key(version) for version in ordered]
        self.assertEqual(keys, sorted(keys, reverse=True))
        for version in ordered:
            self.assertEqual(build_changelog.version_key(version), validate_release._numeric_version_key(version))


class RepositoryChangelogTests(unittest.TestCase):
    def setUp(self):
        self.model, self.text = build_changelog.load()

    def test_documents_every_published_release_with_its_record(self):
        published = [entry for entry in self.model["entries"] if entry["status"] == "published"]
        self.assertEqual(
            [(entry["version"], entry["meta"]["tag"], entry["date"], entry["meta"]["versionCode"], entry["meta"]["scriptTag"])
             for entry in published],
            PUBLISHED,
        )
        for entry in published:
            self.assertEqual(entry["meta"]["releaseUrl"],
                             f"https://github.com/2archiver/YTArk/releases/tag/{entry['meta']['tag']}")
            self.assertEqual(validate_release.version_code_for_release(entry["version"]), entry["meta"]["versionCode"])

    def test_the_configured_release_is_the_newest_unpublished_entry(self):
        config = validate_release.load_config()
        newest = self.model["entries"][0]
        self.assertEqual(newest["version"], config["VERSION_NAME"])
        self.assertEqual(newest["status"], "unreleased")
        self.assertIsNone(newest["date"], "no invented publication date")
        self.assertEqual(newest["meta"]["versionCode"], int(config["VERSION_CODE"]))
        self.assertEqual(newest["meta"]["scriptTag"], config["SCRIPT_TAG"])
        headings = [section["heading"] for section in newest["sections"]]
        for required in ("Changed", "Fixed", "Known limitations"):
            self.assertIn(required, headings)
        limitations = next(section for section in newest["sections"]
                           if section["heading"] == "Known limitations")
        self.assertTrue(any("still need device testing" in item["text"]
                            for item in limitations["items"]))

    def test_published_releases_stay_one_liners(self):
        """The simplified history: one short, user-facing line per release."""
        for entry in self.model["entries"]:
            self.assertTrue(entry["summary"], entry["version"])
            self.assertLessEqual(len(entry["summary"]), 140, entry["version"])
            # Full historical sections may be retained: only the maintained
            # summary is rendered by default, not the section bodies.
            self.assertNotIn("\n", build_changelog.short_summary(entry["summary"]))

    def test_drafts_are_notes_not_versions(self):
        versions = [entry["version"] for entry in self.model["entries"]]
        self.assertFalse(any("probe" in version for version in versions))
        drafts = next(note for note in self.model["notes"] if "draft" in note["title"].lower())
        self.assertTrue(any("v2.2.0-probeJ" in item["text"] and "never published" in item["text"] for item in drafts["items"]))

    def test_bundled_module_is_current_and_deterministic(self):
        expected = build_changelog.render_module(self.model, self.text)
        self.assertEqual(build_changelog.OUTPUT.read_text(encoding="utf-8"), expected)
        self.assertEqual(build_changelog.render_module(self.model, self.text), expected)
        self.assertEqual(build_changelog.main(["--check"]), 0)

    def test_native_summaries_share_the_bundled_source_and_staleness_gate(self):
        self.assertEqual(build_changelog.NATIVE_OUTPUT.read_text(),
                         build_changelog.render_native(self.model, self.text))
        with tempfile.TemporaryDirectory() as temp:
            stale = Path(temp) / "ReleaseHighlights.generated.kt"
            stale.write_text("// stale")
            with patch.object(build_changelog, "NATIVE_OUTPUT", stale):
                self.assertEqual(build_changelog.main(["--check"]), 1)

    def test_short_summary_is_plain_bounded_and_never_cuts_words(self):
        short = build_changelog.short_summary
        self.assertEqual(short("<b>**Clear**</b> [notes](https://example.com) &amp; `text`"), "Clear notes & text")
        self.assertEqual(short(""), build_changelog.SUMMARY_FALLBACK)
        self.assertEqual(short("x" * 500), build_changelog.SUMMARY_FALLBACK)
        self.assertEqual(short("word " * 60), " ".join(["word"] * 40) + "…")
        self.assertLessEqual(len(short("release highlights " * 50)), 240)
        self.assertEqual(short("# First\n- Second"), "First Second")

    def test_check_fails_for_a_stale_module(self):
        with tempfile.TemporaryDirectory() as temp:
            stale = Path(temp) / "changelog.generated.js"
            stale.write_text("export default {};\n", encoding="utf-8")
            with patch.object(build_changelog, "OUTPUT", stale):
                self.assertEqual(build_changelog.main(["--check"]), 1)

    def test_release_notes_section_uses_the_changelog_and_no_other_version_code(self):
        config = validate_release.load_config()
        section = build_changelog.release_notes_section(self.model, config["VERSION_NAME"])
        self.assertNotIn("###", section)
        self.assertLessEqual(len(section.split()), 65)
        self.assertEqual(len([line for line in section.splitlines() if line.startswith("- ")]), 3)
        self.assertIsNone(validate_release.parse_release_version_code(section),
                          "the section must not carry a versionCode the updater could misread")
        self.assertNotRegex(section, r"(?i)personal\s+tube\s+tv")
        with self.assertRaises(build_changelog.ChangelogError):
            build_changelog.release_notes_section(self.model, "9.9.9")

    def test_bundle_is_plain_text(self):
        bundled = json.dumps(build_changelog.bundle_model(self.model, self.text), ensure_ascii=False)
        self.assertNotIn("**", bundled)
        self.assertNotRegex(bundled, r"[<>]")


if __name__ == "__main__":
    unittest.main()
