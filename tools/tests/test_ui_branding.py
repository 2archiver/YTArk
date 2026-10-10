import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODS = ROOT / "TizenTube" / "mods"
RESOURCES = MODS / "translations" / "resources"


def translation_values(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from translation_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from translation_values(child)
    elif isinstance(value, str):
        yield value


class YTArkUiBrandingTests(unittest.TestCase):
    def test_welcome_toast_triggers_and_flag_are_retired_without_resetting_other_defaults(self):
        config = (MODS / "config.js").read_text(encoding="utf-8")
        ui = (MODS / "ui" / "ui.js").read_text(encoding="utf-8")
        settings = (MODS / "ui" / "settings.js").read_text(encoding="utf-8")

        for source in (config, ui, settings):
            self.assertNotIn("showWelcomeToast", source)
            self.assertNotIn("ttWelcomeMsg", source)
        self.assertNotIn("welcome", ui.lower())
        self.assertIn("<h1>YTArk Settings</h1>", ui)
        self.assertNotIn("TizenTube", ui)
        self.assertIn("enableAdBlock: true", config)
        self.assertIn("enableSponsorBlock: true", config)

        for resource_path in sorted(RESOURCES.glob("*.json")):
            resource = json.loads(resource_path.read_text(encoding="utf-8"))
            serialized = json.dumps(resource, ensure_ascii=False)
            self.assertNotIn("ttWelcomeMsg", serialized, resource_path.name)
            self.assertNotIn("welcomeMsg", serialized, resource_path.name)

    def test_product_titles_are_exact_and_translation_values_are_rebranded(self):
        settings = (MODS / "ui" / "settings.js").read_text(encoding="utf-8")
        self.assertIn("title: 'YTArk Settings'", settings)
        self.assertIn("title: 'YTArk Updates'", settings)
        self.assertIn("name: 'YTArk Updates'", settings)
        self.assertIn("name: 'About YTArk'", settings)
        self.assertIn("title: 'About YTArk'", settings)
        resolve_command = (MODS / "resolveCommand.js").read_text(encoding="utf-8")
        subtitle_mod = (MODS / "features" / "moreSubtitles.js").read_text(encoding="utf-8")
        self.assertNotIn("TizenTube:", resolve_command)
        self.assertNotIn("TizenTube Subtitle Localization", subtitle_mod)

        resources = sorted(RESOURCES.glob("*.json"))
        self.assertEqual(len(resources), 32)
        for resource_path in resources:
            resource = json.loads(resource_path.read_text(encoding="utf-8"))
            self.assertEqual(resource["settings"]["ttSettings"]["title"], "YTArk Settings", resource_path.name)
            self.assertEqual(resource["settings"]["options"]["updater"]["title"], "YTArk Updates", resource_path.name)
            for value in translation_values(resource):
                self.assertNotIn("TizenTube", value, f"{resource_path.name}: {value}")

    def test_about_attribution_and_support_links_remain_correct(self):
        settings = (MODS / "ui" / "settings.js").read_text(encoding="utf-8")
        self.assertIn("TizenTube/LICENSE", settings)
        self.assertIn("https://github.com/2archiver/YTArk", settings)
        self.assertIn("https://ko-fi.com/2archiver", settings)
        self.assertNotIn("buymeacoffee.com/reisxd", settings)
        self.assertNotIn("github.com/sponsors/reisxd", settings)
        self.assertNotIn("tizentubeofficial", settings)

    def test_cosmetic_header_patch_is_bounded_restorable_and_lifecycle_aware(self):
        branding = (MODS / "features" / "premiumBranding.js").read_text(encoding="utf-8")
        self.assertIn("OBSERVATION_WINDOW_MS = 25_000", branding)
        self.assertIn("MAX_MUTATION_BATCHES = 48", branding)
        self.assertIn("observer.disconnect()", branding)
        self.assertIn("window.addEventListener('pagehide', cleanup, true)", branding)
        self.assertIn("window.addEventListener('pageshow', onNavigation, true)", branding)
        self.assertIn("PLAYER_OVERLAY_SELECTOR", branding)
        self.assertIn("return ['button', 'link', 'menuitem'", branding)
        self.assertIn("function restoreHost(host)", branding)
        self.assertIn("aria-hidden", branding)
        self.assertNotIn("fetch(", branding)
        self.assertIn("YouTube Premium wordmark is a local visual only", (MODS / "ui" / "settings.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
