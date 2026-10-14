import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODS = ROOT / "TizenTube" / "mods"
RESOURCES = MODS / "translations" / "resources"
sys.path.insert(0, str(ROOT / "tools"))

import validate_release  # noqa: E402


def translation_values(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from translation_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from translation_values(child)
    elif isinstance(value, str):
        yield value


def settings_sources():
    """YTArk Settings: the renderer plus the shared registry it is built from."""
    return "\n".join(
        (MODS / "ui" / name).read_text(encoding="utf-8")
        for name in ("settings.js", "settingsRegistry.js")
    )


class YTArkUiBrandingTests(unittest.TestCase):
    def test_welcome_toast_triggers_and_flag_are_retired_without_resetting_other_defaults(self):
        config = (MODS / "config.js").read_text(encoding="utf-8")
        ui = (MODS / "ui" / "ui.js").read_text(encoding="utf-8")
        settings = settings_sources()

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
        settings = settings_sources()
        self.assertIn("title: 'YTArk Settings'", settings)
        self.assertIn("title: 'YTArk Updates'", settings)
        self.assertIn("title: 'About YTArk'", settings)
        # The 2.5 cleanup: the retired quick menu and its duplicates are gone,
        # and every retained behaviour has exactly one titled control.
        self.assertNotIn("YTArk Quick Controls", settings)
        self.assertNotIn("Undo Last Preset", settings)
        self.assertNotIn("User-Agent profile", settings)
        self.assertNotIn("enableFixedUI", settings)
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
        settings = settings_sources()
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
        # The release bundle contract is the single source of truth for which
        # symbols the artefact must (and must not) carry; this test only adds
        # the branding needles the contract does not cover. A second copy of
        # the list here is exactly what stopped the 2.9 release.
        contract = json.loads((ROOT / "release" / "bundle-contract.json").read_text(encoding="utf-8"))
        for needle in (
            "ytlr-logo-entity",             # the real Leanback logo host
            "ytark-premium-wordmark",       # the injected local wordmark
            "ytlr-thumbnail-details",       # where the stock wordmark is painted
            "enablePremiumLogo",
            # default-on for fresh/missing config; minified in the bundle
            "enablePremiumLogo:!0",
            "InstallAppFromURL", # release discovery lives in Kotlin now
            "ytark://updates",
            "Hide channel watermark",
            "Remove player dimming",
        ) + tuple(contract["bundle"]["required"]):
            self.assertIn(needle, built)
        # The embedded metadata is this release's, not a stale one: the bundler
        # renames the generated export, so the values are the stable proof.
        config = validate_release.load_config()
        for value in (config["VERSION_NAME"], config["SCRIPT_TAG"], config["APK_ARMV7"]):
            self.assertIn(value, built, f"the bundle lost the embedded build metadata value {value}")
        self.assertNotIn("Personal Tube TV", built, "deprecated branding in the bundle")
        # Retired identifiers must not survive anywhere in the shipped
        # artefact, including the bundled changelog (the narrative describes a
        # retirement without repeating the retired name).
        for retired in tuple(contract["bundle"]["forbidden"]) + tuple(contract["retiredActions"]):
            self.assertNotIn(retired, built, f"retired but still packaged: {retired}")

    def test_the_removed_controls_are_gone_from_the_shipped_sources(self):
        """Presets, the user-agent override and "Fix UI" are not live code.

        ``config.js`` lists the retired keys so the one-shot migration can
        delete them, ``features/userAgentRetirement.js`` performs that
        migration, and the bundled changelog narrates the removal; those three
        name the retired things on purpose. Every other shipped module must not.
        """
        for removed in ("features/userAgentSpoofing.js", "features/tvControls.js"):
            self.assertFalse((MODS / removed).exists(), f"{removed} was removed in 2.5")
        shipped = [
            path for path in sorted(MODS.rglob("*.js"))
            if not {"node_modules", "assets", "tests", "dist"} & set(path.parts)
            and path.name not in ("config.js", "userAgentRetirement.js")
        ]
        self.assertTrue(shipped, "the shipped sources were not found")
        for retired in (
            "YTArk Quick Controls",         # dissolved menu
            "TV_APPLY_PRESET",              # presets
            "TV_UNDO_PRESET",               # undo preset
            "TV_SET_QUALITY",               # quick quality
            "enableFixedUI",                # "Fix UI"
            "app-quality-root",             # the observer "Fix UI" installed
        ):
            for path in shipped:
                self.assertNotIn(
                    retired, path.read_text(encoding="utf-8", errors="replace"),
                    f"{path.relative_to(MODS)} still carries the removed {retired}")
        # No surface may render the placeholder the About page used to show.
        for name in ("ui/settingsRegistry.js", "ui/settings.js", "features/updater.js"):
            self.assertNotIn("Version unknown", (MODS / name).read_text(encoding="utf-8"),
                             f"{name} still renders the unknown-version placeholder")

    def test_cosmetic_logo_module_stays_local_and_never_calls_out(self):
        branding = (MODS / "features" / "premiumBranding.js").read_text(encoding="utf-8")
        settings = settings_sources()
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
        self.assertIn("'Premium logo (cosmetic)'", settings)


if __name__ == "__main__":
    unittest.main()
