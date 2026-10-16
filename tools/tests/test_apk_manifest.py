"""Deterministic tests for the packaged-manifest inspector.

The fixtures under ``tools/tests/data/`` are real compiled manifests: the four
AXML files and the tiny APK are unmodified test data from androguard's Apache-2.0
suite (see NOTICE.md). Their expected values were cross-checked against an
independent parser (pyaxmlparser) and are asserted here unchanged, so the
inspector is validated against bytes that aapt itself produced rather than
against documents this repository encoded.
"""

from __future__ import annotations

import io
import struct
import sys
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import apk_manifest
from apk_manifest import (
    ANDROID_NS,
    BIND_JOB_SERVICE,
    RECEIVE_BOOT_COMPLETED,
    REQUEST_INSTALL_PACKAGES,
    NodeSpec,
    attr,
    check_facts,
    encode_axml,
    facts_from_root,
    inspect_apk,
    parse_binary_xml,
    read_manifest_file,
)

DATA = ROOT / "tools" / "tests" / "data"
AXML = DATA / "axml"
APK = DATA / "apk"

PACKAGE = "io.github.twoarchiver.ytark"
UPDATER = "io.github.twoarchiver.ytark.updater"
VERSION_CODE = 3060000
VERSION_NAME = "3.6.0"


def manifest(**overrides) -> NodeSpec:
    """A packaged-manifest equivalent with the release contract satisfied."""
    package = overrides.get("package", PACKAGE)
    version_code = overrides.get("version_code", VERSION_CODE)
    version_name = overrides.get("version_name", VERSION_NAME)
    min_sdk = overrides.get("min_sdk", 24)
    target_sdk = overrides.get("target_sdk", 34)
    permissions = overrides.get(
        "permissions", [REQUEST_INSTALL_PACKAGES, RECEIVE_BOOT_COMPLETED])
    uses_sdk = []
    if min_sdk is not None:
        uses_sdk.append(attr("minSdkVersion", min_sdk))
    if target_sdk is not None:
        uses_sdk.append(attr("targetSdkVersion", target_sdk))
    return NodeSpec("manifest", (
        attr("package", package, android=False),
        attr("versionCode", version_code),
        attr("versionName", version_name),
    ), (
        NodeSpec("uses-sdk", tuple(uses_sdk)),
        *[NodeSpec("uses-permission", (attr("name", value),))
          for value in permissions],
        NodeSpec("application", (), (
            NodeSpec("activity", (attr("name", f"{UPDATER}.UpdateActivity"),
                                  attr("exported", False))),
            NodeSpec("service", (attr("name", f"{UPDATER}.UpdateCheckJobService"),
                                 attr("exported", False),
                                 attr("permission", BIND_JOB_SERVICE))),
            NodeSpec("provider", (
                attr("name", f"{UPDATER}.UpdateBootstrapProvider"),
                attr("authorities", f"{package}.ytarkupdater"),
                attr("exported", False),)),
            NodeSpec("provider", (
                attr("name", f"{UPDATER}.PendingUpdateProvider"),
                attr("authorities", f"{package}.ytarkupdater.files"),
                attr("exported", False),
                attr("grantUriPermissions", True)), (
                NodeSpec("grant-uri-permission", (attr("path", "/update.apk"),)),)),
        )),
    ))


def facts_for(node: NodeSpec):
    return facts_from_root(parse_binary_xml(encode_axml(node)))


def apk_bytes(manifest_bytes: bytes, extra: dict[str, bytes] | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("AndroidManifest.xml", manifest_bytes)
        archive.writestr("classes.dex", b"dex\n035\x00")
        for name, payload in (extra or {}).items():
            archive.writestr(name, payload)
    return buffer.getvalue()


class RealManifestFixtures(unittest.TestCase):
    """Bytes produced by real build tools, parsed without the Android SDK."""

    def test_plain_manifest(self):
        facts = read_manifest_file(str(AXML / "AndroidManifest.xml"))
        self.assertEqual(facts.package, "org.t0t0.androguard.TC")
        self.assertEqual(facts.version_code, 1)
        self.assertEqual(facts.version_name, "1.0")
        # This fixture declares no <uses-sdk> element at all.
        self.assertIsNone(facts.min_sdk)
        self.assertIsNone(facts.target_sdk)
        self.assertFalse(facts.target_sdk_declared)
        self.assertEqual(facts.install_capability()["reasons"],
                         ["target-sdk-not-declared",
                          "request-install-packages-not-declared"])

    def test_utf8_string_pool_and_shared_user_id(self):
        facts = read_manifest_file(str(AXML / "AndroidManifestUTF8Strings.xml"))
        self.assertEqual(facts.package, "com.easylocker.bbottles.zt")
        self.assertEqual((facts.min_sdk, facts.target_sdk), (14, 21))
        self.assertEqual(facts.version_code, 5)
        self.assertEqual(len(facts.permissions), 10)
        self.assertEqual(facts.root.text("sharedUserId"), "com.jodo")

    def test_null_bytes_in_the_pool_do_not_shift_the_parse(self):
        facts = read_manifest_file(str(AXML / "AndroidManifestNullbytes.xml"))
        self.assertEqual(facts.package, "com.ditc.automobilityxxxxxxxxxxxx")
        self.assertEqual((facts.min_sdk, facts.target_sdk), (11, 15))
        self.assertEqual(facts.root.text("versionName"), "0.0")

    def test_attribute_names_recovered_from_resource_ids(self):
        # This fixture deliberately carries no attribute names in its pool; the
        # platform resource ids are the only way to identify the attributes.
        facts = read_manifest_file(
            str(AXML / "AndroidManifest_NamespaceInAttributeName.xml"))
        self.assertEqual(facts.package, "jyiaivi.ohduxbbylb")
        self.assertEqual((facts.min_sdk, facts.target_sdk), (8, 10))
        self.assertEqual(facts.permissions[0].permission,
                         "android.permission.WRITE_EXTERNAL_STORAGE")
        for declaration in facts.permissions:
            self.assertEqual(declaration.tag, "uses-permission")

    def test_real_apk_entry_is_read_from_the_zip(self):
        facts = inspect_apk(str(APK / "AndroidManifest_ShortName.apk"))
        self.assertEqual(facts.package, "com.android.galaxy4")
        self.assertEqual((facts.min_sdk, facts.target_sdk), (14, 14))
        # Android resolves the relative ".Galaxy4" names in this fixture
        # against the package, exactly like PackageManager does.
        self.assertIn("com.android.galaxy4.Galaxy4",
                      [component.name for component in facts.components])
        # API 14 cannot be granted the Android 8+ capability, and this fixture
        # does not declare the permission either.
        capability = facts.install_capability()
        self.assertFalse(capability["can_be_granted"])
        self.assertIn("target-sdk-below-26", capability["reasons"])


class CapabilityRules(unittest.TestCase):
    """The Android 8 unknown-source rules, checked on encoded manifests."""

    def test_target_26_is_the_boundary(self):
        below = facts_for(manifest(target_sdk=25)).install_capability()
        self.assertFalse(below["can_be_granted"])
        self.assertEqual(below["reasons"], ["target-sdk-below-26"])
        at = facts_for(manifest(target_sdk=26)).install_capability()
        self.assertTrue(at["can_be_granted"], at)
        above = facts_for(manifest(target_sdk=35)).install_capability()
        self.assertTrue(above["can_be_granted"], above)

    def test_permission_must_be_declared_in_the_package(self):
        facts = facts_for(manifest(permissions=[RECEIVE_BOOT_COMPLETED]))
        capability = facts.install_capability()
        self.assertFalse(capability["can_be_granted"])
        self.assertEqual(capability["reasons"],
                         ["request-install-packages-not-declared"])

    def test_a_capped_declaration_does_not_authorize_modern_android(self):
        node = manifest()
        capped = NodeSpec("uses-permission", (
            attr("name", REQUEST_INSTALL_PACKAGES), attr("maxSdkVersion", 22)))
        node = NodeSpec(node.tag, node.attributes,
                        tuple(child for child in node.children
                              if not (child.tag == "uses-permission"
                                      and child.attributes[0].value == REQUEST_INSTALL_PACKAGES))
                        + (capped,))
        facts = facts_for(node)
        self.assertEqual(facts.permission_entries(REQUEST_INSTALL_PACKAGES)[0].max_sdk_version, 22)
        self.assertFalse(facts.declares(REQUEST_INSTALL_PACKAGES, sdk=26))
        capability = facts.install_capability()
        self.assertFalse(capability["can_be_granted"])
        self.assertEqual(capability["reasons"],
                         ["request-install-packages-sdk-capped"])

    def test_a_codename_target_is_resolved_to_an_api_level(self):
        node = manifest(target_sdk="O")
        facts = facts_for(node)
        self.assertEqual(facts.target_sdk, 26)
        self.assertTrue(facts.install_capability()["can_be_granted"])

    def test_an_unreadable_target_fails_closed(self):
        node = NodeSpec("manifest", (
            attr("package", PACKAGE, android=False),
            attr("versionCode", VERSION_CODE),
        ), (
            NodeSpec("uses-sdk", (attr("minSdkVersion", 24),
                                  attr("targetSdkVersion", "@0x01050000")),),
            NodeSpec("uses-permission", (attr("name", REQUEST_INSTALL_PACKAGES),)),
            NodeSpec("application", (), ()),
        ))
        facts = facts_for(node)
        self.assertIsNone(facts.target_sdk)
        self.assertEqual(facts.install_capability()["reasons"], ["target-sdk-unreadable"])


class PackagedContract(unittest.TestCase):
    """The manifest contract the release pipeline enforces on signed bytes."""

    def expectation(self, **overrides) -> apk_manifest.Expectation:
        values = {
            "package": PACKAGE,
            "version_code": VERSION_CODE,
            "version_name": VERSION_NAME,
        }
        values.update(overrides)
        return apk_manifest.Expectation(**values)

    def test_a_correct_package_has_no_violations(self):
        facts = facts_for(manifest())
        self.assertEqual(check_facts(facts, self.expectation()), [])

    def test_wrong_package_and_version_are_reported(self):
        facts = facts_for(manifest(package="io.gh.reisxd.tizentube.cobalt",
                                   version_code=3040000, version_name="3.4.0"))
        problems = check_facts(facts, self.expectation())
        self.assertTrue(any("package is" in problem for problem in problems), problems)
        self.assertTrue(any("versionCode is" in problem for problem in problems), problems)
        self.assertTrue(any("authorities" in problem for problem in problems), problems)

    def test_a_pre_android_8_target_is_a_violation_not_a_warning(self):
        problems = check_facts(facts_for(manifest(target_sdk=22)), self.expectation())
        self.assertTrue(any("below the API 26" in problem for problem in problems), problems)

    def test_missing_or_exported_updater_components_are_violations(self):
        node = manifest()
        children = []
        for child in node.children:
            if child.tag == "application":
                kept = [entry for entry in child.children
                        if entry.attributes and entry.attributes[0].value
                        not in (f"{UPDATER}.UpdateActivity",
                                f"{UPDATER}.UpdateCheckJobService")]
                children.append(NodeSpec("application", (), tuple(kept)))
            else:
                children.append(child)
        facts = facts_for(NodeSpec(node.tag, node.attributes, tuple(children)))
        problems = check_facts(facts, self.expectation())
        self.assertTrue(any("UpdateActivity" in problem for problem in problems), problems)
        self.assertTrue(any("UpdateCheckJobService" in problem for problem in problems), problems)

    def test_exported_updates_screen_and_launcher_proxy_are_violations(self):
        node = manifest()
        children = []
        for child in node.children:
            if child.tag == "application":
                swapped = []
                for entry in child.children:
                    if entry.attributes and entry.attributes[0].value == f"{UPDATER}.UpdateActivity":
                        swapped.append(NodeSpec("activity", (
                            attr("name", f"{UPDATER}.UpdateActivity"),
                            attr("exported", True)), (
                            NodeSpec("intent-filter", (), (
                                NodeSpec("action", (attr("name", "android.intent.action.MAIN"),)),
                                NodeSpec("category", (
                                    attr("name", "android.intent.category.LAUNCHER"),)),)),)))
                    else:
                        swapped.append(entry)
                swapped.append(NodeSpec("activity", (
                    attr("name", f"{UPDATER}.UpdateLauncherActivity"),
                    attr("exported", False))))
                children.append(NodeSpec("application", (), tuple(swapped)))
            else:
                children.append(child)
        facts = facts_for(NodeSpec(node.tag, node.attributes, tuple(children)))
        problems = check_facts(facts, self.expectation())
        self.assertTrue(any("non-exported" in problem for problem in problems), problems)
        self.assertTrue(any("no external routes" in problem for problem in problems), problems)
        self.assertTrue(any("obsolete" in problem for problem in problems), problems)

    def test_provider_authorities_and_uri_grants_are_checked(self):
        node = manifest()
        children = []
        for child in node.children:
            if child.tag == "application":
                swapped = []
                for entry in child.children:
                    name = entry.attributes[0].value if entry.attributes else ""
                    if name == f"{UPDATER}.PendingUpdateProvider":
                        swapped.append(NodeSpec("provider", (
                            attr("name", name),
                            attr("authorities", "wrong.authority"),
                            attr("exported", False))))
                    elif name == f"{UPDATER}.UpdateBootstrapProvider":
                        swapped.append(NodeSpec("provider", (
                            attr("name", name),
                            attr("authorities", f"{PACKAGE}.ytarkupdater"),
                            attr("exported", True))))
                    else:
                        swapped.append(entry)
                children.append(NodeSpec("application", (), tuple(swapped)))
            else:
                children.append(child)
        facts = facts_for(NodeSpec(node.tag, node.attributes, tuple(children)))
        problems = check_facts(facts, self.expectation())
        self.assertTrue(any("wrong.authority" in problem for problem in problems), problems)
        self.assertTrue(any("grantUriPermissions" in problem for problem in problems), problems)
        self.assertTrue(any("must be explicitly non-exported" in problem for problem in problems),
                        problems)

    def test_job_service_must_require_bind_job_service(self):
        node = manifest()
        children = []
        for child in node.children:
            if child.tag == "application":
                swapped = []
                for entry in child.children:
                    name = entry.attributes[0].value if entry.attributes else ""
                    if name == f"{UPDATER}.UpdateCheckJobService":
                        swapped.append(NodeSpec("service", (
                            attr("name", name), attr("exported", False))))
                    else:
                        swapped.append(entry)
                children.append(NodeSpec("application", (), tuple(swapped)))
            else:
                children.append(child)
        facts = facts_for(NodeSpec(node.tag, node.attributes, tuple(children)))
        problems = check_facts(facts, self.expectation())
        self.assertTrue(any(BIND_JOB_SERVICE in problem for problem in problems), problems)


class BrokenInput(unittest.TestCase):
    """Unreadable packages fail with a clear error instead of a wrong answer."""

    def setUp(self):
        import tempfile
        self.directory = tempfile.mkdtemp(prefix="ytark-apk-manifest-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.directory, ignore_errors=True))

    def test_a_non_zip_file_is_rejected(self):
        path = Path(self.directory) / "not-an-apk.apk"
        path.write_bytes(b"not a zip file at all")
        with self.assertRaises(apk_manifest.ManifestError):
            inspect_apk(str(path))

    def test_a_zip_without_a_manifest_is_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("classes.dex", b"dex\n035\x00")
        path = Path(self.directory) / "no-manifest.apk"
        path.write_bytes(buffer.getvalue())
        with self.assertRaisesRegex(apk_manifest.ManifestError, "AndroidManifest.xml"):
            inspect_apk(str(path))

    def test_a_wrong_magic_is_rejected(self):
        with self.assertRaisesRegex(apk_manifest.BinaryXmlError, "chunk type"):
            parse_binary_xml(b"\x00\x00\x00\x00" + b"\x00" * 8)

    def test_a_truncated_chunk_is_rejected(self):
        data = bytearray(encode_axml(manifest()))
        struct.pack_into("<I", data, 4, 0xFFFFFF)
        data.extend(b"\x00" * 16)
        with self.assertRaises(apk_manifest.ManifestError):
            parse_binary_xml(bytes(data))

    def test_a_text_manifest_is_rejected(self):
        with self.assertRaises(apk_manifest.ManifestError):
            parse_binary_xml(b"<?xml version=\"1.0\"?><manifest package=\"x\" />")


class CommandLine(unittest.TestCase):
    """The CLI the workflows call must exit non-zero on a real problem."""

    def test_audit_fails_for_a_capability_that_android_cannot_grant(self):
        node = manifest(target_sdk=22)
        path = Path(self.write(encode_axml(node)))
        self.assertEqual(apk_manifest.main(["audit", "--apk", str(path)]), 1)
        self.assertEqual(apk_manifest.main(
            ["audit", "--apk", str(self.write(encode_axml(manifest())))]), 0)

    def test_check_enforces_the_package_and_target(self):
        good = self.write(encode_axml(manifest()))
        self.assertEqual(apk_manifest.main([
            "check", "--apk", good, "--package", PACKAGE,
            "--version-code", str(VERSION_CODE), "--version-name", VERSION_NAME]), 0)
        self.assertEqual(apk_manifest.main([
            "check", "--apk", good, "--package", "someone.else"]), 1)
        self.assertEqual(apk_manifest.main([
            "check", "--apk", str(self.write(encode_axml(manifest(target_sdk=22)))),
            "--package", PACKAGE]), 1)

    def test_check_reads_a_standalone_manifest_file(self):
        import os
        import tempfile
        handle, name = tempfile.mkstemp(prefix="ytark-manifest-", suffix=".xml")
        with os.fdopen(handle, "wb") as stream:
            stream.write(encode_axml(manifest()))
        self.addCleanup(lambda: os.path.exists(name) and os.unlink(name))
        self.assertEqual(apk_manifest.main([
            "check", "--manifest", name, "--package", PACKAGE]), 0)

    def write(self, manifest_bytes: bytes) -> str:
        import tempfile
        handle, name = tempfile.mkstemp(prefix="ytark-manifest-", suffix=".apk")
        import os
        with os.fdopen(handle, "wb") as stream:
            stream.write(apk_bytes(manifest_bytes))
        self.addCleanup(lambda: os.path.exists(name) and os.unlink(name))
        return name


class SelfTest(unittest.TestCase):
    def test_module_self_test_passes(self):
        self.assertEqual(apk_manifest.main(["--self-test"]), 0)

    def test_android_namespace_constant_matches_the_platform(self):
        self.assertEqual(ANDROID_NS, "http://schemas.android.com/apk/res/android")


if __name__ == "__main__":
    unittest.main()
