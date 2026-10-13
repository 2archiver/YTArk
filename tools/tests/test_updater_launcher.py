"""The YTArk Updates screen must be a real TV launcher entry, checked from compiled manifest text."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import validate_release  # noqa: E402

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


def updater_activity(label="YTArk Updates", exported="(type 0x12)0xffffffff", launcher=True):
    category = ""
    if launcher:
        category = """\
          E: category (line=40)
            A: android:name(0x01010003)="android.intent.category.LEANBACK_LAUNCHER" (Raw: "android.intent.category.LEANBACK_LAUNCHER")
"""
    return f"""\
      E: activity (line=35)
        A: android:label(0x01010001)="{label}" (Raw: "{label}")
        A: android:name(0x01010003)="io.github.twoarchiver.ytark.updater.UpdateActivity" (Raw: "io.github.twoarchiver.ytark.updater.UpdateActivity")
        A: android:exported(0x01010010)={exported}
        E: intent-filter (line=38)
          E: action (line=39)
            A: android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
{category}"""


def storage_activity(exported="(type 0x12)0xffffffff", host="storage"):
    return f"""\
      E: activity (line=60)
        A: android:name(0x01010003)=\"io.github.twoarchiver.ytark.updater.StorageActivity\" (Raw: \"io.github.twoarchiver.ytark.updater.StorageActivity\")
        A: android:exported(0x01010010)={exported}
        E: intent-filter (line=64)
          E: action (line=65)
            A: android:name(0x01010003)=\"android.intent.action.VIEW\" (Raw: \"android.intent.action.VIEW\")
          E: data (line=66)
            A: android:scheme(0x01010027)=\"ytark\" (Raw: \"ytark\")
            A: android:host(0x01010028)=\"{host}\" (Raw: \"{host}\")
"""


def updater_job_service(permission="android.permission.BIND_JOB_SERVICE", exported="(type 0x12)0x0"):
    return f"""\
      E: service (line=70)
        A: android:name(0x01010003)=\"io.github.twoarchiver.ytark.updater.UpdateCheckJobService\" (Raw: \"io.github.twoarchiver.ytark.updater.UpdateCheckJobService\")
        A: android:permission(0x01010006)=\"{permission}\" (Raw: \"{permission}\")
        A: android:exported(0x01010010)={exported}
"""


def manifest_with_background_components(storage=None, service=None, boot_permission=True):
    boot = "    E: uses-permission (line=80)\n      A: android:name=\"android.permission.RECEIVE_BOOT_COMPLETED\"\n" if boot_permission else ""
    return manifest(updater_activity(), storage or storage_activity(), service or updater_job_service()) + boot


def manifest(*activities: str) -> str:
    return "N: android=http://schemas.android.com/apk/res/android\n" \
        "  E: manifest (line=2)\n" \
        "    E: application (line=10)\n" \
        "      A: android:label(0x01010001)=\"YTArk\" (Raw: \"YTArk\")\n" \
        + COBALT_ACTIVITY + "".join(activities) + \
        "    E: uses-permission (line=3)\n"


class UpdaterLauncherTests(unittest.TestCase):
    def test_a_labelled_exported_leanback_entry_is_accepted(self):
        validate_release.validate_updater_launcher(manifest(updater_activity()))

    def test_a_missing_leanback_category_is_refused(self):
        with self.assertRaisesRegex(ValueError, "LEANBACK_LAUNCHER"):
            validate_release.validate_updater_launcher(manifest(updater_activity(launcher=False)))

    def test_an_unexported_activity_is_refused(self):
        with self.assertRaisesRegex(ValueError, "exported"):
            validate_release.validate_updater_launcher(manifest(updater_activity(exported="(type 0x12)0x0")))

    def test_a_wrong_label_is_refused(self):
        with self.assertRaisesRegex(ValueError, "labelled"):
            validate_release.validate_updater_launcher(manifest(updater_activity(label="Updates")))

    def test_a_manifest_without_the_updater_activity_is_refused(self):
        with self.assertRaisesRegex(ValueError, "no YTArk Updates activity"):
            validate_release.validate_updater_launcher(manifest())

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


if __name__ == "__main__":
    unittest.main()
