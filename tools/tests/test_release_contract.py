from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import fetch_base_apks
import prepare_update_smoke
import repack_apk
import validate_release


class DualAbiReleaseContractTests(unittest.TestCase):
    def test_expected_version_and_asset_names(self):
        config = validate_release.load_config()
        self.assertEqual(config["VERSION_NAME"], "2.0.4-ytark.17")
        self.assertEqual(config["VERSION_CODE"], "20017")
        self.assertEqual(config["APK_ARMV7"], "YTArk-v2.0.4-ytark.17-armv7.apk")
        self.assertEqual(config["APK_ARM64"], "YTArk-v2.0.4-ytark.17-arm64.apk")
        self.assertEqual(validate_release.apk_filename(config["VERSION_NAME"], "armv7"), config["APK_ARMV7"])
        self.assertEqual(validate_release.apk_filename(config["VERSION_NAME"], "arm64"), config["APK_ARM64"])
        with self.assertRaises(ValueError):
            validate_release.apk_filename(config["VERSION_NAME"], "4k")

    def test_pinned_upstream_asset_names_urls_and_digests(self):
        release = {
            "tag_name": "v2.0.2",
            "draft": False,
            "prerelease": False,
            "assets": [
                {
                    "name": "cobalt-arm.apk",
                    "size": 97_195_140,
                    "digest": "sha256:ff90c6e85c37246b809cca80282910509782c1384eccfbb6066da3b497dd9fd2",
                    "browser_download_url": "https://github.com/reisxd/TizenTubeCobalt/releases/download/v2.0.2/cobalt-arm.apk",
                },
                {
                    "name": "cobalt-arm64.apk",
                    "size": 168_173_905,
                    "digest": "sha256:0e8a9cffc77a08cd116d38e262c3e9d7f261ba2093b5b2d2ef905f509c99133c",
                    "browser_download_url": "https://github.com/reisxd/TizenTubeCobalt/releases/download/v2.0.2/cobalt-arm64.apk",
                },
            ],
        }
        armv7 = fetch_base_apks.validate_release_asset(release, "v2.0.2", "armv7")
        arm64 = fetch_base_apks.validate_release_asset(release, "v2.0.2", "arm64")
        self.assertEqual(armv7["abi"], "armeabi-v7a")
        self.assertEqual(armv7["library"], "lib/armeabi-v7a/libchrobalt.so")
        self.assertEqual(arm64["abi"], "arm64-v8a")
        self.assertEqual(arm64["library"], "lib/arm64-v8a/libchrobalt.so")
        self.assertEqual(
            arm64["expected_digest"],
            "0e8a9cffc77a08cd116d38e262c3e9d7f261ba2093b5b2d2ef905f509c99133c",
        )

        bad = json.loads(json.dumps(release))
        bad["assets"][0]["browser_download_url"] = "https://example.invalid/cobalt-arm.apk"
        with self.assertRaises(ValueError):
            fetch_base_apks.validate_release_asset(bad, "v2.0.2", "armv7")
        with self.assertRaises(ValueError):
            fetch_base_apks.validate_release_asset(release, "v2.0.3", "armv7")
        changed_digest = json.loads(json.dumps(release))
        changed_digest["assets"][0]["digest"] = "sha256:" + "a" * 64
        with self.assertRaises(ValueError):
            fetch_base_apks.validate_release_asset(changed_digest, "v2.0.2", "armv7")
        missing_digest = json.loads(json.dumps(release))
        missing_digest["assets"][0].pop("digest")
        with self.assertRaises(ValueError):
            fetch_base_apks.validate_release_asset(missing_digest, "v2.0.2", "armv7")
        changed_size = json.loads(json.dumps(release))
        changed_size["assets"][1]["size"] += 1
        with self.assertRaises(ValueError):
            fetch_base_apks.validate_release_asset(changed_size, "v2.0.2", "arm64")
        duplicate = json.loads(json.dumps(release))
        duplicate["assets"].append(dict(duplicate["assets"][0]))
        with self.assertRaises(ValueError):
            fetch_base_apks.validate_release_asset(duplicate, "v2.0.2", "armv7")
        with self.assertRaises(ValueError):
            fetch_base_apks.validate_release_asset(release, "v2.0.2", "x86")

    def test_base_native_abi_and_dex_checks_reject_mismatched_architecture(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            good = root / "armv7.apk"
            with zipfile.ZipFile(good, "w") as apk:
                apk.writestr("lib/armeabi-v7a/libchrobalt.so", b"native-armv7")
                apk.writestr("classes.dex", b"dex")
            fetch_base_apks.verify_base_native_abi(good, "armv7")
            repack_apk.validate_base_architecture(str(good), "armv7")
            with self.assertRaises(ValueError):
                fetch_base_apks.verify_base_native_abi(good, "arm64")
            with self.assertRaises(SystemExit):
                repack_apk.validate_base_architecture(str(good), "arm64")

            no_dex = root / "no-dex.apk"
            with zipfile.ZipFile(no_dex, "w") as apk:
                apk.writestr("lib/armeabi-v7a/libchrobalt.so", b"native-armv7")
            with self.assertRaises(ValueError):
                fetch_base_apks.verify_base_native_abi(no_dex, "armv7")

    def test_repacker_allows_only_exact_userscript_literal_replacement(self):
        config = validate_release.load_config()
        script_url = f"https://cdn.jsdelivr.net/gh/2archiver/YTArk@{config['SCRIPT_TAG']}/userScript.js?v="
        replacement = repack_apk.make_replacement_url(script_url)
        original_library = b"ELF-prefix\0" + repack_apk.OLD_SCRIPT_URL + b"\0suffix"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base = root / "base.apk"
            rebuilt = root / "rebuilt.apk"
            with zipfile.ZipFile(base, "w") as apk:
                apk.writestr("lib/armeabi-v7a/libchrobalt.so", original_library)
                apk.writestr("lib/armeabi-v7a/libother.so", b"unchanged-native")
                apk.writestr("classes.dex", b"original dex")
            with zipfile.ZipFile(rebuilt, "w") as apk:
                apk.writestr("lib/armeabi-v7a/libchrobalt.so", original_library.replace(repack_apk.OLD_SCRIPT_URL, replacement))
                apk.writestr("lib/armeabi-v7a/libother.so", b"unchanged-native")
                apk.writestr("classes.dex", b"original dex")
                apk.writestr("classes2.dex", b"updater dex")
            repack_apk.verify_preserved_native_and_dex(str(base), str(rebuilt), "armv7", script_url)

            corrupted = root / "corrupted.apk"
            with zipfile.ZipFile(corrupted, "w") as apk:
                apk.writestr("lib/armeabi-v7a/libchrobalt.so", original_library.replace(repack_apk.OLD_SCRIPT_URL, replacement) + b"tampered")
                apk.writestr("lib/armeabi-v7a/libother.so", b"changed-native")
                apk.writestr("classes.dex", b"original dex")
            with self.assertRaises(SystemExit):
                repack_apk.verify_preserved_native_and_dex(str(base), str(corrupted), "armv7", script_url)

    def test_both_release_checksums_are_exact_and_mandatory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            armv7 = root / "candidate-armv7.apk"
            arm64 = root / "candidate-arm64.apk"
            script = root / "userScript.js"
            armv7.write_bytes(b"armv7 apk")
            arm64.write_bytes(b"arm64 apk")
            script.write_bytes(b"exact script bytes")
            checksum_file = root / "SHA256SUMS.txt"
            entries = []
            for path in (armv7, arm64, script):
                entries.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
            checksum_file.write_text("\n".join(entries) + "\n", encoding="utf-8")
            validate_release.check_checksums(str(checksum_file), str(armv7), str(arm64), str(script))
            armv7.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                validate_release.check_checksums(str(checksum_file), str(armv7), str(arm64), str(script))

            duplicate = root / "duplicate.txt"
            duplicate.write_text(entries[0] + "\n" + entries[0] + "\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                validate_release.parse_checksum_file(str(duplicate))

    def test_repacker_keeps_a_real_leanback_launcher_and_optional_touchscreen(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = root / "AndroidManifest.xml"
            manifest.write_text("""<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.gh.reisxd.tizentube.cobalt">
    <uses-feature android:name="android.hardware.touchscreen" android:required="true" />
    <uses-feature android:name="android.hardware.camera" android:required="true" />
    <application android:label="TizenTube">
        <activity android:name="dev.cobalt.app.MainActivity" android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>
    </application>
</manifest>
""", encoding="utf-8")
            repack_apk.patch_tv_manifest_compatibility(str(root))
            repack_apk.patch_launcher_icon(str(root))
            first = manifest.read_text(encoding="utf-8")
            self.assertIn('android:name="dev.cobalt.app.MainActivity"', first)
            self.assertIn('android:exported="true"', first)
            self.assertIn('android.intent.action.MAIN', first)
            self.assertIn('android.intent.category.LEANBACK_LAUNCHER', first)
            self.assertIn('android:name="android.hardware.touchscreen" android:required="false"', first)
            self.assertIn('android:name="android.hardware.camera" android:required="false"', first)
            self.assertIn('android:icon="@mipmap/ytark_launcher"', first)
            self.assertIn('android:banner="@drawable/ytark_banner"', first)
            repack_apk.patch_tv_manifest_compatibility(str(root))
            second = manifest.read_text(encoding="utf-8")
            self.assertEqual(second.count('android.intent.category.LEANBACK_LAUNCHER'), 1)
            self.assertEqual(second.count('android.hardware.touchscreen'), 1)

    def test_base_checksum_manifest_requires_both_upstream_apks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_dir = root / "base"
            base_dir.mkdir()
            checksums = []
            for name, payload in (("cobalt-arm.apk", b"v7"), ("cobalt-arm64.apk", b"v8")):
                path = base_dir / name
                path.write_bytes(payload)
                checksums.append(f"{hashlib.sha256(payload).hexdigest()}  {name}")
            checksum_file = root / "base-apk-sha256.txt"
            checksum_file.write_text("\n".join(checksums) + "\n", encoding="utf-8")
            validate_release.check_base_checksums(str(checksum_file), str(base_dir))
            (base_dir / "cobalt-arm.apk").write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                validate_release.check_base_checksums(str(checksum_file), str(base_dir))

    def test_compiled_manifest_must_keep_tv_launcher_icon_and_optional_touchscreen(self):
        tree = """E: manifest
  E: uses-feature (line=1)
    A: android:name(0x01010003)="android.hardware.touchscreen"
    A: android:required(0x0101028e)=(type 0x12)0x0
  E: application (line=4)
    A: android:icon(0x01010002)=@0x7f080001
    A: android:banner(0x0101020c)=@0x7f080002
    E: activity (line=7)
      A: android:name(0x01010003)="dev.cobalt.app.MainActivity"
      A: android:exported(0x01010010)=(type 0x12)0xffffffff
      A: android:icon(0x01010002)=@0x7f080001
      E: intent-filter (line=11)
        E: action (line=12)
          A: android:name(0x01010003)="android.intent.action.MAIN"
        E: category (line=14)
          A: android:name(0x01010003)="android.intent.category.LEANBACK_LAUNCHER"
"""
        resources = """resource 0x7f080001 io.github.twoarchiver.ytark:mipmap/ytark_launcher
resource 0x7f080002 io.github.twoarchiver.ytark:drawable/ytark_banner
"""
        with patch.object(validate_release, "run", side_effect=[tree, resources]):
            validate_release.validate_compiled_manifest(Path("candidate.apk"), "aapt")

        required_touchscreen = tree.replace("(type 0x12)0x0", "(type 0x12)0xffffffff")
        with patch.object(validate_release, "run", side_effect=[required_touchscreen, resources]):
            with self.assertRaises(ValueError):
                validate_release.validate_compiled_manifest(Path("candidate.apk"), "aapt")

        missing_leanback = tree.replace("android.intent.category.LEANBACK_LAUNCHER", "android.intent.category.LAUNCHER")
        with patch.object(validate_release, "run", side_effect=[missing_leanback, resources]):
            with self.assertRaises(ValueError):
                validate_release.validate_compiled_manifest(Path("candidate.apk"), "aapt")

    def test_release_contract_requires_both_assets_and_truthful_architecture_guidance(self):
        config = validate_release.load_config()
        body = f"""# YTArk {config['VERSION_NAME']}
Android package `{validate_release.APP_ID}`
Version {config['VERSION_NAME']} (versionCode {config['VERSION_CODE']})
TizenTubeCobalt v2.0.2
{config['APK_ARMV7']} armeabi-v7a
{config['APK_ARM64']} arm64-v8a
4K does not select an APK architecture.
"""
        assets = []
        for name in (config["APK_ARMV7"], config["APK_ARM64"], "SHA256SUMS.txt",
                     "base-apk-sha256.txt", "NOTICE.md", "userScript.js"):
            assets.append({
                "name": name,
                "size": 10,
                "digest": "sha256:" + "a" * 64 if name.endswith(".apk") else "",
                "browser_download_url": f"https://github.com/2archiver/YTArk/releases/download/{config['VERSION_TAG']}/{name}",
            })
        release = {
            "name": "YTArk",
            "tag_name": config["VERSION_TAG"],
            "draft": True,
            "prerelease": False,
            "body": body,
            "assets": assets,
        }
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "release.json"
            path.write_text(json.dumps(release), encoding="utf-8")
            validate_release.verify_release(str(path), "draft", None)
            broken = dict(release)
            broken["assets"] = [asset for asset in assets if asset["name"] != config["APK_ARMV7"]]
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaises(ValueError):
                validate_release.verify_release(str(path), "draft", None)

    def test_previous_update_smoke_rejects_nonofficial_urls(self):
        name = "YTArk-v2.0.3-ytark.15-armv7.apk"
        official = prepare_update_smoke.RELEASE_PREFIX + "v2.0.3-ytark.15/" + name
        self.assertEqual(
            prepare_update_smoke.official_asset_url("v2.0.3-ytark.15", name, official), official
        )
        with self.assertRaises(ValueError):
            prepare_update_smoke.official_asset_url(
                "v2.0.3-ytark.15", name, "https://github.com.evil.example/" + name
            )


if __name__ == "__main__":
    unittest.main()
