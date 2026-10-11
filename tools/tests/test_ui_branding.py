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

    def test_logo_and_updater_features_are_delivered_in_the_built_userscript(self):
        """Bundle-delivery gate.

        The cosmetic logo and the YTArk Updates surface are only useful if they
        are actually part of the artifact that ships to the device, so this test
        inspects the built userscript instead of the module sources. Behaviour is
        covered by the DOM-fixture suite in
        ``TizenTube/mods/tests/premium-branding-*.test.mjs`` and
        ``updates-settings.test.mjs``, which ci.yml runs before this job.
        """
        bundle = MODS.parent / "dist" / "userScript.js"
        if not bundle.exists():
            self.skipTest("userscript bundle not built yet; ci.yml builds it before this job")
        built = bundle.read_text(encoding="utf-8", errors="replace")
        for needle in (
            "ytlr-logo-entity",             # the real Leanback logo host
            "ytark-premium-wordmark",       # the injected local wordmark
            "ytlr-thumbnail-details",       # where the stock wordmark is painted
            "enablePremiumLogo",
            # default-on for fresh/missing config; minified in the bundle
            "enablePremiumLogo:!0",
            "YTARK_UPDATE_COMMAND",         # settings card -> update engine actions
            "api.github.com/repos/2archiver/YTArk/releases/latest",
            "ytark://updates",              # native updater screen hand-off
        ):
            self.assertIn(needle, built)
        self.assertNotIn("Personal Tube TV", built, "deprecated branding in the bundle")

    def test_cosmetic_logo_module_stays_local_and_never_calls_out(self):
        branding = (MODS / "features" / "premiumBranding.js").read_text(encoding="utf-8")
        settings = (MODS / "ui" / "settings.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(", branding, "the cosmetic wordmark must never use the network")
        self.assertNotIn("innerHTML", branding)
        for guard in (
            "function restoreHost(host)",
            "aria-hidden",
            "PLAYER_OVERLAY_SELECTOR",
            "isFocusTarget",
        ):
            self.assertIn(guard, branding)
        # The cosmetic nature has to be explained once, in Settings.
        self.assertIn("it never grants or claims a paid YouTube subscription", settings)
        self.assertIn("name: 'Premium logo (cosmetic)'", settings)


if __name__ == "__main__":
    unittest.main()
