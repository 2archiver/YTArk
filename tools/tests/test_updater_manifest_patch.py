"""The repacker's manifest patch: launcher entry, private providers, and no storage permissions."""
from __future__ import annotations

import ast
import inspect
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import repack_apk  # noqa: E402
import validate_release  # noqa: E402

DECODED = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.cobalt.app">
    <application android:label="YTArk">
        <activity android:name="dev.cobalt.app.MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""
APP_ID = "io.github.twoarchiver.ytark"


class UpdaterManifestPatchTests(unittest.TestCase):
    def patched(self) -> str:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "AndroidManifest.xml"
            path.write_text(DECODED, encoding="utf-8")
            repack_apk.patch_updater_manifest(temp, APP_ID)
            return path.read_text(encoding="utf-8")

    def test_updates_is_private_without_launcher_or_deep_link(self):
        import xml.etree.ElementTree as ET
        root = ET.fromstring(self.patched())
        android = '{http://schemas.android.com/apk/res/android}'
        activities = root.findall('./application/activity')
        screen = next(a for a in activities if a.get(android+'name') == repack_apk.UPDATER_ACTIVITY)
        self.assertEqual(screen.get(android+'exported'), 'false')
        self.assertEqual(screen.get(android+'label'), 'YTArk Updates')
        self.assertEqual(screen.findall('intent-filter'), [])
        self.assertNotIn(repack_apk.UPDATER_LAUNCHER_ACTIVITY, self.patched())

    def test_the_cobalt_main_activity_keeps_its_launcher_entry_first(self):
        xml = self.patched()
        self.assertLess(xml.index("dev.cobalt.app.MainActivity"), xml.index(repack_apk.UPDATER_ACTIVITY))
        self.assertEqual(xml.count("android.intent.category.LEANBACK_LAUNCHER"), 1)

    def test_persistent_hourly_job_is_declared_without_exporting_the_service(self):
        xml = self.patched()
        self.assertIn('android.permission.RECEIVE_BOOT_COMPLETED', xml)
        service = re.search(r'<service\s+android:name="' + re.escape(repack_apk.UPDATER_JOB_SERVICE) + r'"[^>]*/>', xml)
        self.assertIsNotNone(service)
        self.assertIn('android.permission.BIND_JOB_SERVICE', service.group(0))
        self.assertIn('android:exported="false"', service.group(0))

    def test_the_removed_storage_screen_has_no_activity_or_route(self):
        xml = self.patched()
        self.assertNotIn('StorageActivity', xml)
        self.assertNotIn('android:host="storage"', xml)
        self.assertNotIn('YTArk Cache', xml)

    def test_every_required_apk_manifest_entry_is_generated(self):
        # Compare the full APK validator's literal requirements to the real
        # repack output. In 3.0 it both forbade StorageActivity in its background
        # check and required it later in validate_apk, which could never pass.
        tree = ast.parse(inspect.getsource(validate_release.validate_apk))
        requirements = [
            ast.literal_eval(node.iter) for node in ast.walk(tree)
            if isinstance(node, ast.For) and isinstance(node.target, ast.Name)
            and node.target.id == "required"
        ]
        self.assertEqual(len(requirements), 1)
        xml = self.patched()
        for required in requirements[0]:
            self.assertIn(required, xml)

    def test_providers_and_receiver_are_private_and_the_file_provider_is_single_file(self):
        xml = self.patched()
        self.assertIn(f'android:authorities="{APP_ID}.ytarkupdater"', xml)
        self.assertIn(f'android:authorities="{APP_ID}.ytarkupdater.files"', xml)
        provider = re.search(r'<provider\s+android:name="' + re.escape(repack_apk.UPDATE_FILE_PROVIDER) + r'".*?</provider>',
                             xml, re.S).group(0)
        self.assertIn('android:exported="false"', provider)
        self.assertIn('android:grantUriPermissions="true"', provider)
        self.assertIn('<grant-uri-permission android:path="/update.apk" />', provider)
        self.assertNotIn("file://", xml)
        receiver = re.search(r'<receiver\s+android:name="' + re.escape(repack_apk.UPDATER_RECEIVER) + r'"[^>]*/>', xml)
        self.assertIsNone(receiver, 'obsolete notification receiver is retired')

    def test_only_updater_permissions_are_added_and_no_storage_permission(self):
        xml = self.patched()
        self.assertIn('android.permission.REQUEST_INSTALL_PACKAGES', xml)
        self.assertNotIn('android.permission.POST_NOTIFICATIONS', xml)
        self.assertIn('android.permission.RECEIVE_BOOT_COMPLETED', xml)
        for forbidden in ("MANAGE_EXTERNAL_STORAGE", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE",
                          "READ_MEDIA_", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO"):
            self.assertNotIn(forbidden, xml)

    def test_a_second_patch_is_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / "AndroidManifest.xml").write_text(DECODED, encoding="utf-8")
            repack_apk.patch_updater_manifest(temp, APP_ID)
            with self.assertRaises(SystemExit):
                repack_apk.patch_updater_manifest(temp, APP_ID)


if __name__ == "__main__":
    unittest.main()
