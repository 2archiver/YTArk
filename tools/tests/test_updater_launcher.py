"""The YTArk Updates screen must be a real TV launcher entry, checked from compiled manifest text.

The compiled-manifest fixtures mirror what the configured build-tools ``aapt
dump xmltree`` prints for a release APK: string attributes carry their resource
id and a ``(Raw: ...)`` echo, and enum/flags attributes are printed as typed
numeric payloads. ``android:protectionLevel="signature"`` compiles to the
numeric flags value ``(type 0x11)0x2`` — the literal word "signature" does not
survive compilation, which is exactly why the 2.9.0 candidate failed the old
global text search after signing. The decoded symbolic form is still accepted
so textual (apktool-decoded) dumps keep validating.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import validate_release  # noqa: E402

SCREEN_PERMISSION = validate_release.UPDATER_SCREEN_PERMISSION

COBALT_ACTIVITY = """\
      E: activity (line=20)
        A: android:name(0x01010003)="dev.cobalt.app.MainActivity" (Raw: "dev.cobalt.app.MainActivity")
        A: android:exported(0x01010010)=(type 0x12)0xffffffff
        E: intent-filter (line=24)
          E: action (line=25)
            A: android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
          E: category (line=26)
            A: android:name(0x01010003)="android.intent.category.LEANBACK_LAUNCHER" (Raw: "android.intent.category.LEANBACK_LAUNCHER")
"""


def compiled_permission_element(name=SCREEN_PERMISSION, protection="(type 0x11)0x2",
                                indent="    "):
    """A manifest-level ``<permission>`` element rendered like ``aapt dump xmltree``.

    ``protection`` is everything printed after the ``=`` of
    ``android:protectionLevel``, so compiled numeric payloads
    (``(type 0x11)0x2``) and decoded symbolic payloads
    (``"signature" (Raw: "signature")``) can both be exercised; ``None`` omits
    the attribute entirely.
    """
    lines = [
        f"{indent}E: permission (line=4)",
        f'{indent}  A: android:name(0x01010003)="{name}" (Raw: "{name}")',
    ]
    if protection is not None:
        lines.append(f"{indent}  A: android:protectionLevel(0x01010009)={protection}")
    return "\n".join(lines) + "\n"


def textual_permission_element(name=SCREEN_PERMISSION,
                               protection='"signature" (Raw: "signature")'):
    """The decoded apktool-style fixture (no resource ids) the tests historically used."""
    lines = [
        "    E: permission (line=4)",
        f'      A: android:name="{name}" (Raw: "{name}")',
    ]
    if protection is not None:
        lines.append(f"      A: android:protectionLevel={protection}")
    return "\n".join(lines) + "\n"


def uses_permission_element(name=SCREEN_PERMISSION):
    return (
        "    E: uses-permission (line=5)\n"
        f'      A: android:name(0x01010003)="{name}" (Raw: "{name}")\n'
    )


def updater_activity(exported="(type 0x12)0xffffffff", deep_link=True, permission=SCREEN_PERMISSION):
    route_filter = ""
    if deep_link:
        route_filter = """\
        E: intent-filter (line=41)
          E: action (line=42)
            A: android:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")
          E: category (line=43)
            A: android:name(0x01010003)="android.intent.category.DEFAULT" (Raw: "android.intent.category.DEFAULT")
          E: category (line=44)
            A: android:name(0x01010003)="android.intent.category.BROWSABLE" (Raw: "android.intent.category.BROWSABLE")
          E: data (line=45)
            A: android:scheme(0x01010027)="ytark" (Raw: "ytark")
            A: android:host(0x01010028)="updates" (Raw: "updates")
"""
    permission_line = ""
    if permission is not None:
        permission_line = (
            f'        A: android:permission(0x01010006)="{permission}" (Raw: "{permission}")\n'
        )
    return f"""\
      E: activity (line=35)
        A: android:label(0x01010001)="YTArk Updates" (Raw: "YTArk Updates")
        A: android:name(0x01010003)="io.github.twoarchiver.ytark.updater.UpdateActivity" (Raw: "io.github.twoarchiver.ytark.updater.UpdateActivity")
        A: android:exported(0x01010010)={exported}
{permission_line}{route_filter}"""


def launcher_proxy(label="YTArk Updates", exported="(type 0x12)0xffffffff", launcher=True):
    launcher_filter = ""
    if launcher:
        launcher_filter = """\
        E: intent-filter (line=38)
          E: action (line=39)
            A: android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
          E: category (line=40)
            A: android:name(0x01010003)="android.intent.category.LEANBACK_LAUNCHER" (Raw: "android.intent.category.LEANBACK_LAUNCHER")
"""
    return f"""\
      E: activity (line=50)
        A: android:label(0x01010001)="{label}" (Raw: "{label}")
        A: android:name(0x01010003)="io.github.twoarchiver.ytark.updater.UpdateLauncherActivity" (Raw: "io.github.twoarchiver.ytark.updater.UpdateLauncherActivity")
        A: android:exported(0x01010010)={exported}
{launcher_filter}"""


def storage_activity(exported="(type 0x12)0xffffffff", host="storage",
                     permission=SCREEN_PERMISSION):
    permission_line = ""
    if permission is not None:
        permission_line = (
            f'        A: android:permission(0x01010006)="{permission}" (Raw: "{permission}")\n'
        )
    return f"""\
      E: activity (line=60)
        A: android:name(0x01010003)="io.github.twoarchiver.ytark.updater.StorageActivity" (Raw: "io.github.twoarchiver.ytark.updater.StorageActivity")
        A: android:exported(0x01010010)={exported}
{permission_line}\
        E: intent-filter (line=64)
          E: action (line=65)
            A: android:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")
          E: category (line=65)
            A: android:name(0x01010003)="android.intent.category.DEFAULT" (Raw: "android.intent.category.DEFAULT")
          E: category (line=65)
            A: android:name(0x01010003)="android.intent.category.BROWSABLE" (Raw: "android.intent.category.BROWSABLE")
          E: data (line=66)
            A: android:scheme(0x01010027)="ytark" (Raw: "ytark")
            A: android:host(0x01010028)="{host}" (Raw: "{host}")
"""


def updater_job_service(permission="android.permission.BIND_JOB_SERVICE", exported="(type 0x12)0x0"):
    return f"""\
      E: service (line=70)
        A: android:name(0x01010003)="io.github.twoarchiver.ytark.updater.UpdateCheckJobService" (Raw: "io.github.twoarchiver.ytark.updater.UpdateCheckJobService")
        A: android:permission(0x01010006)="{permission}" (Raw: "{permission}")
        A: android:exported(0x01010010)={exported}
"""


def manifest_with_background_components(storage=None, service=None, boot_permission=True):
    boot = "    E: uses-permission (line=80)\n      A: android:name=\"android.permission.RECEIVE_BOOT_COMPLETED\"\n" if boot_permission else ""
    return manifest(updater_activity(), launcher_proxy(),
                    storage or storage_activity(), service or updater_job_service()) + boot


def manifest(*activities: str, permission_block=compiled_permission_element(),
             extra_manifest_children="") -> str:
    """A manifest dump whose default permission declaration is the compiled numeric form."""
    return (
        "N: android=http://schemas.android.com/apk/res/android\n"
        "  E: manifest (line=2)\n"
        + (permission_block or "")
        + extra_manifest_children
        + "    E: application (line=10)\n"
        "      A: android:label(0x01010001)=\"YTArk\" (Raw: \"YTArk\")\n"
        + COBALT_ACTIVITY + "".join(activities)
        + "    E: uses-permission (line=3)\n"
    )


class UpdaterLauncherTests(unittest.TestCase):
    def test_a_labelled_exported_leanback_entry_is_accepted(self):
        validate_release.validate_updater_launcher(manifest(updater_activity(), launcher_proxy()))

    def test_a_missing_leanback_category_is_refused(self):
        with self.assertRaisesRegex(ValueError, "LEANBACK_LAUNCHER"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(launcher=False)))

    def test_a_missing_exact_ytark_updates_route_is_refused(self):
        with self.assertRaisesRegex(ValueError, "ytark://updates"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(deep_link=False), launcher_proxy()))

    def test_an_unexported_activity_is_refused(self):
        with self.assertRaisesRegex(ValueError, "exported"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(exported="(type 0x12)0x0"), launcher_proxy()))

    def test_a_wrong_label_is_refused(self):
        with self.assertRaisesRegex(ValueError, "labelled"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(label="Updates")))

    def test_a_manifest_without_the_updater_activity_is_refused(self):
        with self.assertRaisesRegex(ValueError, "no YTArk Updates activity"):
            validate_release.validate_updater_launcher(manifest())

    def test_native_screen_routes_require_the_signature_permission(self):
        with self.assertRaisesRegex(ValueError, "signature permission"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(permission="android.permission.INTERNET"), launcher_proxy()))
        with self.assertRaisesRegex(ValueError, "signature permission"):
            validate_release.validate_updater_background_components(manifest_with_background_components(
                storage=storage_activity(permission="android.permission.INTERNET")))

    def test_persistent_job_service_and_storage_route_are_required(self):
        validate_release.validate_updater_background_components(manifest_with_background_components())
        with self.assertRaisesRegex(ValueError, "BIND_JOB_SERVICE"):
            validate_release.validate_updater_background_components(
                manifest_with_background_components(service=updater_job_service(permission="android.permission.INTERNET")))
        with self.assertRaisesRegex(ValueError, "not be exported"):
            validate_release.validate_updater_background_components(
                manifest_with_background_components(service=updater_job_service(exported="(type 0x12)0xffffffff")))
        with self.assertRaisesRegex(ValueError, "ytark://storage"):
            validate_release.validate_updater_background_components(
                manifest_with_background_components(storage=storage_activity(host="updates")))
        with self.assertRaisesRegex(ValueError, "RECEIVE_BOOT_COMPLETED"):
            validate_release.validate_updater_background_components(
                manifest_with_background_components(boot_permission=False))

    def test_a_manifest_without_an_application_element_is_refused(self):
        with self.assertRaisesRegex(ValueError, "no application element"):
            validate_release.validate_updater_launcher("N: android=x\n  E: manifest (line=2)\n")


class CompiledSignaturePermissionDeclarationTests(unittest.TestCase):
    """The declaration check reads the compiled permission element, never raw text.

    A valid compiled dump carries ``android:protectionLevel(0x01010009)=(type
    0x11)0x2`` and no literal "signature"; the old global substring search
    rejected exactly that and could be satisfied by any unrelated occurrence of
    the word elsewhere in the manifest.
    """

    def test_the_compiled_numeric_signature_value_is_accepted(self):
        tree = manifest(updater_activity(), launcher_proxy())
        # Regression evidence: the compiled dump contains no literal "signature".
        self.assertNotIn("signature", tree)
        self.assertIn("A: android:protectionLevel(0x01010009)=(type 0x11)0x2", tree)
        validate_release.validate_updater_launcher(tree)

    def test_numeric_signature_payload_variants_are_accepted(self):
        for protection in ("(type 0x11)0x2", "(type 0x10)0x2", "(type 0x11)0x0002",
                           "(type 0x11)0x2 "):
            with self.subTest(protection=protection):
                validate_release.validate_updater_launcher(manifest(
                    updater_activity(), launcher_proxy(),
                    permission_block=compiled_permission_element(protection=protection)))

    def test_the_decoded_symbolic_signature_value_is_accepted(self):
        validate_release.validate_updater_launcher(manifest(
            updater_activity(), launcher_proxy(),
            permission_block=textual_permission_element()))
        # The historical raw fixture without resource ids must keep validating.
        validate_release.validate_updater_launcher(manifest(
            updater_activity(), launcher_proxy(),
            permission_block=(
                "    E: permission (line=4)\n"
                f'      A: android:name="{SCREEN_PERMISSION}" (Raw: "{SCREEN_PERMISSION}")\n'
                '      A: android:protectionLevel="signature" (Raw: "signature")\n'
            )))

    def test_a_missing_declaration_with_live_references_is_refused(self):
        tree = manifest(updater_activity(), launcher_proxy(), permission_block=None,
                        extra_manifest_children=uses_permission_element())
        # The uses-permission request and both protected activities still name
        # the permission, but nothing declares it.
        self.assertIn(SCREEN_PERMISSION, tree)
        with self.assertRaisesRegex(ValueError, "declares no manifest-level"):
            validate_release.validate_updater_launcher(tree)

    def test_a_declaration_without_protection_level_is_refused(self):
        with self.assertRaisesRegex(ValueError, "carries no android:protectionLevel"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(),
                permission_block=compiled_permission_element(protection=None)))

    def test_a_malformed_protection_level_is_refused(self):
        for protection in ("(type 0x01)@0x7f0b0000", "@0x7f0b0000", "(type 0x11)",
                           "", "signature"):
            with self.subTest(protection=protection):
                with self.assertRaisesRegex(ValueError, "unexpected android:protectionLevel"):
                    validate_release.validate_updater_launcher(manifest(
                        updater_activity(), launcher_proxy(),
                        permission_block=compiled_permission_element(protection=protection)))

    def test_non_signature_numeric_levels_are_refused(self):
        refused = {
            "(type 0x11)0x0": 0,    # normal
            "(type 0x11)0x1": 1,    # dangerous
            "(type 0x11)0x3": 3,    # signatureOrSystem
            "(type 0x11)0x12": 18,  # signature|privileged: one set bit is not enough
            "(type 0x11)0xffffffff": 0xffffffff,
        }
        for protection, parsed in refused.items():
            with self.subTest(protection=protection):
                with self.assertRaisesRegex(ValueError, "unexpected android:protectionLevel") as caught:
                    validate_release.validate_updater_launcher(manifest(
                        updater_activity(), launcher_proxy(),
                        permission_block=compiled_permission_element(protection=protection)))
                # The failure names the permission and the parsed value.
                self.assertIn(SCREEN_PERMISSION, str(caught.exception))
                self.assertIn(repr(parsed), str(caught.exception))

    def test_non_signature_symbolic_levels_are_refused(self):
        for symbol in ("normal", "dangerous", "signatureOrSystem", "signature|privileged"):
            with self.subTest(symbol=symbol):
                with self.assertRaisesRegex(ValueError, "unexpected android:protectionLevel"):
                    validate_release.validate_updater_launcher(manifest(
                        updater_activity(), launcher_proxy(),
                        permission_block=textual_permission_element(
                            protection=f'"{symbol}" (Raw: "{symbol}")')))

    def test_lookalike_permission_names_are_refused(self):
        for name in (SCREEN_PERMISSION + "2", "x" + SCREEN_PERMISSION,
                     SCREEN_PERMISSION[:-1],
                     SCREEN_PERMISSION.replace("OPEN_NATIVE_SCREEN", "OPEN_NATIVE_SCREEM")):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "declares no manifest-level"):
                    validate_release.validate_updater_launcher(manifest(
                        updater_activity(), launcher_proxy(),
                        permission_block=compiled_permission_element(name=name)))

    def test_an_unrelated_signature_permission_never_satisfies_the_check(self):
        with self.assertRaisesRegex(ValueError, "declares no manifest-level"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(),
                permission_block=compiled_permission_element(
                    name="io.github.twoarchiver.ytark.permission.SOMETHING_ELSE")))

    def test_a_normal_required_permission_beside_a_signature_unrelated_one_is_refused(self):
        block = (compiled_permission_element(protection="(type 0x11)0x0")
                 + compiled_permission_element(
                     name="io.github.twoarchiver.ytark.permission.SOMETHING_ELSE"))
        with self.assertRaisesRegex(ValueError, "unexpected android:protectionLevel"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(), permission_block=block))

    def test_duplicate_and_conflicting_declarations_are_refused(self):
        duplicated = compiled_permission_element() + compiled_permission_element()
        with self.assertRaisesRegex(ValueError, "declared 2 times"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(), permission_block=duplicated))
        conflicting = (compiled_permission_element()
                       + compiled_permission_element(protection="(type 0x11)0x0"))
        with self.assertRaisesRegex(ValueError, "declared 2 times"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(), permission_block=conflicting))

    def test_a_permission_nested_inside_application_is_not_a_manifest_declaration(self):
        nested = compiled_permission_element(indent="      ")
        with self.assertRaisesRegex(ValueError, "declares no manifest-level"):
            validate_release.validate_updater_launcher(manifest(
                updater_activity(), launcher_proxy(), nested, permission_block=None))

    def test_a_manifest_without_a_manifest_element_is_refused(self):
        with self.assertRaisesRegex(ValueError, "no manifest element"):
            validate_release.require_declared_signature_permission(
                "N: android=x\n  E: application (line=2)\n")


class ExactRoutePermissionTests(unittest.TestCase):
    """UpdateActivity and StorageActivity must require the exact permission name."""

    def test_the_updates_route_permission_must_match_exactly(self):
        for wrong in ("android.permission.INTERNET", SCREEN_PERMISSION + "X",
                      SCREEN_PERMISSION[:-1], None):
            with self.subTest(permission=wrong):
                with self.assertRaisesRegex(ValueError, "signature permission"):
                    validate_release.validate_updater_launcher(manifest(
                        updater_activity(permission=wrong), launcher_proxy()))

    def test_the_storage_route_permission_must_match_exactly(self):
        for wrong in ("android.permission.INTERNET", SCREEN_PERMISSION + "X",
                      SCREEN_PERMISSION[:-1], None):
            with self.subTest(permission=wrong):
                with self.assertRaisesRegex(ValueError, "signature permission"):
                    validate_release.validate_updater_background_components(
                        manifest_with_background_components(
                            storage=storage_activity(permission=wrong)))


if __name__ == "__main__":
    unittest.main()
