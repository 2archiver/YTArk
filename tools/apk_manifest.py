#!/usr/bin/env python3
"""Read the compiled AndroidManifest.xml out of an APK without the Android SDK.

Why this module exists
----------------------
`aapt dump badging|xmltree` is the reference tool for inspecting a packaged
manifest, but it only exists on a machine with the Android build-tools. The
release gate, the pull-request checks and the unit suite must all be able to
answer the same two questions from a plain Python process:

* What package, versionCode, versionName, minSdkVersion and targetSdkVersion
  does *this exact APK* declare?
* Can this package ever be granted the Android 8+ "install unknown apps"
  capability (``REQUEST_INSTALL_PACKAGES`` plus a target of API 26 or newer)?

Android answers the second question itself in
``ComputerEngine.canRequestPackageInstalls`` (``frameworks/base``), which returns
false when the package targets below ``Build.VERSION_CODES.O`` or does not
declare the permission at all. A source-level string search cannot see either
condition in a *packaged* APK, so this module parses the binary Android XML
(AXML) that aapt/AGP write, and the release pipeline fails on what it finds.

Scope: read-only inspection of resource XML inside an APK. Nothing is modified,
no network or SDK is used, and no third-party dependency is required.

Self-test: python3 tools/apk_manifest.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import zipfile
from dataclasses import dataclass, field
from typing import Iterable, Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ANDROID_NS = "http://schemas.android.com/apk/res/android"
MANIFEST_ENTRY = "AndroidManifest.xml"

# Android OS codenames, used when a manifest writes a version as a string
# (aapt accepts both "26" and "O" for targetSdkVersion).
API_CODENAMES = {
    "BASE": 1, "BASE_1_1": 2, "CUPCAKE": 3, "DONUT": 4, "ECLAIR": 5,
    "ECLAIR_0_1": 6, "ECLAIR_MR1": 7, "FROYO": 8, "GINGERBREAD": 9,
    "GINGERBREAD_MR1": 10, "HONEYCOMB": 11, "HONEYCOMB_MR1": 12,
    "HONEYCOMB_MR2": 13, "ICE_CREAM_SANDWICH": 14,
    "ICE_CREAM_SANDWICH_MR1": 15, "JELLY_BEAN": 16, "JELLY_BEAN_MR1": 17,
    "JELLY_BEAN_MR2": 18, "KITKAT": 19, "KITKAT_WATCH": 20, "LOLLIPOP": 21,
    "LOLLIPOP_MR1": 22, "M": 23, "N": 24, "N_MR1": 25, "O": 26, "O_MR1": 27,
    "P": 28, "Q": 29, "R": 30, "S": 31, "S_V2": 32, "TIRAMISU": 33,
    "UPSIDE_DOWN_CAKE": 34, "VANILLA_ICE_CREAM": 35, "BAKLAVA": 36,
}

RES_XML_TYPE = 0x0003
RES_STRING_POOL_TYPE = 0x0001
RES_XML_RESOURCE_MAP_TYPE = 0x0180
RES_XML_START_NAMESPACE_TYPE = 0x0100
RES_XML_END_NAMESPACE_TYPE = 0x0101
RES_XML_START_ELEMENT_TYPE = 0x0102
RES_XML_END_ELEMENT_TYPE = 0x0103
RES_XML_CDATA_TYPE = 0x0104

TYPE_NULL = 0x00
TYPE_REFERENCE = 0x01
TYPE_ATTRIBUTE = 0x02
TYPE_STRING = 0x03
TYPE_FLOAT = 0x04
TYPE_DIMENSION = 0x05
TYPE_FRACTION = 0x06
TYPE_DYNAMIC_REFERENCE = 0x07
TYPE_DYNAMIC_ATTRIBUTE = 0x08
TYPE_INT_DEC = 0x10
TYPE_INT_HEX = 0x11
TYPE_INT_BOOLEAN = 0x12
TYPE_INT_COLOR_ARGB8 = 0x1C
TYPE_INT_COLOR_RGB8 = 0x1D
TYPE_INT_COLOR_ARGB4 = 0x1E
TYPE_INT_COLOR_RGB4 = 0x1F

# The Android 8 (API 26) boundary: below it PackageManagerService refuses the
# per-app install authorization outright, which is why a Google TV settings
# toggle cannot stay on for such a package.
MIN_TARGET_SDK_FOR_INSTALL_CAPABILITY = 26

REQUEST_INSTALL_PACKAGES = "android.permission.REQUEST_INSTALL_PACKAGES"
RECEIVE_BOOT_COMPLETED = "android.permission.RECEIVE_BOOT_COMPLETED"
BIND_JOB_SERVICE = "android.permission.BIND_JOB_SERVICE"

MAX_ELEMENTS = 20000
# Platform attribute resource IDs (frameworks/base/core/res/res/values/attrs.xml).
# Used only when a manifest's string pool lost the attribute name, which aapt
# never does but hand-built or vendor-repacked manifests sometimes have. The
# values below are the ones the release checks read.
ATTRIBUTE_RESOURCE_IDS = {
    0x01010001: "label",
    0x01010002: "icon",
    0x01010003: "name",
    0x01010006: "permission",
    0x0101000E: "enabled",
    0x0101000F: "debuggable",
    0x01010010: "exported",
    0x01010011: "process",
    0x01010018: "authorities",
    0x0101001B: "grantUriPermissions",
    0x0101002A: "path",
    0x0101020C: "minSdkVersion",
    0x0101021B: "versionCode",
    0x0101021C: "versionName",
    0x01010270: "targetSdkVersion",
    0x01010271: "maxSdkVersion",
    0x0101028E: "required",
}



class ManifestError(Exception):
    """The APK or its manifest could not be read."""


class BinaryXmlError(ManifestError):
    """The manifest is not a well-formed Android binary XML document."""


# ---------------------------------------------------------------------------
# Binary XML (AXML) parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Attribute:
    name: str
    namespace: str
    raw_value: Optional[str]
    value: object
    data_type: int = TYPE_NULL
    resource_id: Optional[int] = None

    @property
    def android(self) -> bool:
        return self.namespace == ANDROID_NS

    @property
    def key(self) -> str:
        """Attribute name as written in source: android:foo / foo."""
        return f"android:{self.name}" if self.android else self.name


@dataclass
class Element:
    tag: str
    attributes: list[Attribute] = field(default_factory=list)
    children: list["Element"] = field(default_factory=list)
    line: int = 0

    def attr(self, name: str, android: bool = True) -> Optional[Attribute]:
        """Find an attribute, preferring the Android namespace.

        A well-formed manifest puts android: attributes in
        ``http://schemas.android.com/apk/res/android``. Broken or vendor-built
        manifests sometimes drop the namespace (or put the prefix in the pool
        name), so an unqualified match is accepted as a fallback while a
        namespaced attribute always wins.
        """
        fallback = None
        for attribute in self.attributes:
            if attribute.name != name:
                continue
            if not android:
                return attribute
            if attribute.android:
                return attribute
            if fallback is None and not attribute.namespace:
                fallback = attribute
        return fallback

    def value(self, name: str, default=None, android: bool = True):
        attribute = self.attr(name, android=android)
        return default if attribute is None else attribute.value

    def text(self, name: str, default=None, android: bool = True) -> Optional[str]:
        attribute = self.attr(name, android=android)
        if attribute is None or attribute.value is None:
            return default
        return str(attribute.value)

    def find_all(self, tag: str) -> list["Element"]:
        return find_all(self, tag)

    def find(self, tag: str) -> Optional["Element"]:
        return find(self, tag)


def find_all(element: "Element", tag: str) -> list["Element"]:
    return [child for child in element.children if child.tag == tag]


def find(element: "Element", tag: str) -> Optional["Element"]:
    for child in element.children:
        if child.tag == tag:
            return child
    return None


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def _read_length8(data: bytes, offset: int) -> tuple[int, int]:
    """Length of a UTF-8 pool string: one byte, or two when bit 7 is set."""
    first = data[offset]
    if first & 0x80:
        return ((first & 0x7F) << 8) | data[offset + 1], offset + 2
    return first, offset + 1


def _read_length16(data: bytes, offset: int) -> tuple[int, int]:
    """Length of a UTF-16 pool string: one unit, or two when bit 15 is set."""
    first = _u16(data, offset)
    if first & 0x8000:
        second = _u16(data, offset + 2)
        return ((first & 0x7FFF) << 16) | second, offset + 4
    return first, offset + 2


class StringPool:
    """The AXML string pool (UTF-8 or UTF-16 flavour)."""

    def __init__(self, data: bytes, offset: int, chunk_size: int, owner_end: int):
        if chunk_size < 28:
            raise BinaryXmlError("string pool chunk is too small")
        self.string_count = _u32(data, offset + 8)
        self.style_count = _u32(data, offset + 12)
        flags = _u32(data, offset + 16)
        strings_start = _u32(data, offset + 20)
        styles_start = _u32(data, offset + 24)
        self.utf8 = bool(flags & (1 << 8))
        index_end = offset + 28 + 4 * (self.string_count + self.style_count)
        if index_end > owner_end:
            raise BinaryXmlError("string pool index table runs past its chunk")
        self.offsets = [_u32(data, offset + 28 + 4 * index) for index in range(self.string_count)]
        start = offset + strings_start
        end = offset + (styles_start if styles_start else chunk_size)
        end = min(end, owner_end)
        if strings_start < 28 or start > end:
            raise BinaryXmlError("string pool data is out of bounds")
        self._data = data
        self._start = start
        self._end = end

    def _decode(self, index: int) -> str:
        if index == 0xFFFFFFFF or index >= self.string_count:
            return ""
        position = self._start + self.offsets[index]
        if position >= self._end:
            raise BinaryXmlError(f"string {index} points outside the pool")
        if self.utf8:
            _chars, cursor = _read_length8(self._data, position)
            byte_length, cursor = _read_length8(self._data, cursor)
            raw = self._data[cursor:cursor + byte_length]
            return raw.decode("utf-8", "replace").replace("\x00", "")
        length, cursor = _read_length16(self._data, position)
        raw = self._data[cursor:cursor + 2 * length]
        return raw.decode("utf-16-le", "replace").replace("\x00", "")

    def __getitem__(self, index: int) -> str:
        return self._decode(index)


def _decode_value(data: bytes, offset: int, pool: StringPool) -> tuple[object, int]:
    """Decode a Res_value at `offset`; returns (value, data_type)."""
    size = _u16(data, offset)
    data_type = data[offset + 3]
    raw = _u32(data, offset + 4)
    if size < 8:
        raise BinaryXmlError("Res_value is smaller than its fixed header")
    if data_type == TYPE_NULL:
        value: object = None
    elif data_type in (TYPE_REFERENCE, TYPE_DYNAMIC_REFERENCE):
        value = f"@{raw:#010x}"
    elif data_type == TYPE_ATTRIBUTE:
        value = f"?{raw:#010x}"
    elif data_type == TYPE_STRING:
        value = pool[raw]
    elif data_type == TYPE_FLOAT:
        value = struct.unpack("<f", struct.pack("<I", raw))[0]
    elif data_type == TYPE_DIMENSION:
        value = f"{struct.unpack('<i', struct.pack('<I', raw))[0]}dim"
    elif data_type == TYPE_FRACTION:
        value = f"{struct.unpack('<i', struct.pack('<I', raw))[0]}frac"
    elif data_type == TYPE_INT_DEC:
        value = struct.unpack("<i", struct.pack("<I", raw))[0]
    elif data_type == TYPE_INT_HEX:
        value = raw
    elif data_type == TYPE_INT_BOOLEAN:
        value = raw != 0
    elif TYPE_INT_COLOR_ARGB8 <= data_type <= TYPE_INT_COLOR_RGB4:
        value = raw
    else:
        raise BinaryXmlError(f"unknown Res_value data type {data_type:#x}")
    return value, data_type


def parse_binary_xml(data: bytes) -> Element:
    """Parse an Android binary XML document and return its root element."""
    if len(data) < 8:
        raise BinaryXmlError("manifest is too small to be binary XML")
    chunk_type = _u16(data, 0)
    if chunk_type != RES_XML_TYPE:
        raise BinaryXmlError(
            f"unexpected chunk type {chunk_type:#06x}; a compiled manifest must "
            f"start with {RES_XML_TYPE:#06x}"
        )
    declared_size = _u32(data, 4)
    if declared_size > len(data):
        raise BinaryXmlError(
            f"manifest header declares {declared_size} bytes but the entry has {len(data)}"
        )
    total = min(declared_size, len(data))

    pool: Optional[StringPool] = None
    resource_map: list[int] = []
    namespaces: dict[int, str] = {}
    stack: list[Element] = []
    root: Optional[Element] = None
    offset = _u16(data, 2)  # header size of the outer XML chunk
    elements = 0
    while offset + 8 <= total:
        node_type = _u16(data, offset)
        node_header = _u16(data, offset + 2)
        node_size = _u32(data, offset + 4)
        if node_size < 8 or offset + node_size > total:
            raise BinaryXmlError(f"chunk at {offset} has an invalid size {node_size}")
        if node_type == RES_STRING_POOL_TYPE:
            pool = StringPool(data, offset, node_size, min(offset + node_size, total))
        elif node_type == RES_XML_RESOURCE_MAP_TYPE:
            count = (node_size - node_header) // 4
            resource_map = [_u32(data, offset + node_header + 4 * i) for i in range(count)]
        elif node_type == RES_XML_START_NAMESPACE_TYPE:
            if pool is None:
                raise BinaryXmlError("namespace chunk before the string pool")
            # Attributes reference the namespace by the *URI* string index
            # (the chunk stores prefix and URI separately).
            namespaces[_u32(data, offset + node_header + 4)] = pool[
                _u32(data, offset + node_header + 4)]
        elif node_type == RES_XML_END_NAMESPACE_TYPE:
            pass
        elif node_type == RES_XML_START_ELEMENT_TYPE:
            if pool is None:
                raise BinaryXmlError("element chunk before the string pool")
            elements += 1
            if elements > MAX_ELEMENTS:
                raise BinaryXmlError("manifest declares an implausible number of elements")
            body = offset + 16
            tag = pool[_u32(data, body + 4)]
            attr_start = _u16(data, body + 8)
            attr_size = _u16(data, body + 10)
            attr_count = _u16(data, body + 12)
            attributes: list[Attribute] = []
            cursor = body + attr_start
            for position in range(attr_count):
                if cursor + 20 > offset + node_size:
                    raise BinaryXmlError(f"attribute {position} of <{tag}> runs past its chunk")
                ns_index = _u32(data, cursor)
                name_index = _u32(data, cursor + 4)
                raw_index = _u32(data, cursor + 8)
                name = pool[name_index]
                resource_id = None
                if name_index < len(resource_map):
                    resource_id = resource_map[name_index]
                if not name and resource_id in ATTRIBUTE_RESOURCE_IDS:
                    name = ATTRIBUTE_RESOURCE_IDS[resource_id]
                    ns_index = ns_index if ns_index != 0xFFFFFFFF else 0xFFFFFFFF
                namespace = namespaces.get(ns_index, "") if ns_index != 0xFFFFFFFF else ""
                # Some linkers (and older aapt) leave "android:" inside the pool
                # name instead of resolving it through a namespace chunk.
                if ":" in name and not namespace:
                    prefix, local = name.split(":", 1)
                    if prefix in ("android", "http", "app"):
                        name = local
                        namespace = ANDROID_NS if prefix == "android" else namespace
                raw_value = pool[raw_index] if raw_index != 0xFFFFFFFF else None
                value, data_type = _decode_value(data, cursor + 12, pool)
                if resource_id in ATTRIBUTE_RESOURCE_IDS and not namespace:
                    namespace = ANDROID_NS
                attributes.append(Attribute(
                    name=name, namespace=namespace, raw_value=raw_value,
                    value=value, data_type=data_type, resource_id=resource_id,
                ))
                cursor += max(attr_size, 20)
            element = Element(tag=tag, attributes=attributes,
                              line=_u32(data, offset + 8))
            if stack:
                stack[-1].children.append(element)
            elif root is None:
                root = element
            else:
                raise BinaryXmlError("a compiled manifest has exactly one root element")
            stack.append(element)
        elif node_type == RES_XML_END_ELEMENT_TYPE:
            if stack:
                stack.pop()
        elif node_type in (RES_XML_CDATA_TYPE,):
            pass
        else:
            # Unknown/no-op chunk: the manifest parser only needs the element
            # tree, and skipping by the declared size keeps the walk in sync.
            pass
        offset += node_size

    if root is None:
        raise BinaryXmlError("no root element was found in the manifest")
    if root.tag != "manifest":
        raise BinaryXmlError(f"the root element is <{root.tag}>, not <manifest>")
    return root


# ---------------------------------------------------------------------------
# Facts extracted from the manifest
# ---------------------------------------------------------------------------


def version_to_api(value) -> Optional[int]:
    """Convert a uses-sdk value (integer, numeric string or codename) to an API level."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    return API_CODENAMES.get(text.upper().replace(".", "_"))


@dataclass(frozen=True)
class Component:
    kind: str
    name: str
    exported: Optional[bool]
    permission: Optional[str]
    authorities: Optional[str]
    granted_uri_permissions: Optional[bool]
    intent_actions: tuple[str, ...]
    intent_categories: tuple[str, ...]
    path_permissions: tuple[str, ...]

    @property
    def is_launcher(self) -> bool:
        return "android.intent.action.MAIN" in self.intent_actions


@dataclass(frozen=True)
class PermissionDeclaration:
    permission: str
    max_sdk_version: Optional[int]
    tag: str

    @property
    def sdk_capped(self) -> bool:
        return self.max_sdk_version is not None


@dataclass
class ManifestFacts:
    package: str
    version_code: Optional[int]
    version_name: Optional[str]
    min_sdk: Optional[int]
    target_sdk: Optional[int]
    max_sdk: Optional[int]
    permissions: tuple[PermissionDeclaration, ...]
    components: tuple[Component, ...]
    application: dict
    root: Element
    target_sdk_declared: bool = True

    # -- convenience -------------------------------------------------------

    def permission_entries(self, permission: str) -> list[PermissionDeclaration]:
        return [entry for entry in self.permissions if entry.permission == permission]

    def declares(self, permission: str, sdk: Optional[int] = None) -> bool:
        """True when the permission is declared and not capped below `sdk`."""
        for entry in self.permission_entries(permission):
            if sdk is None:
                return True
            if entry.max_sdk_version is None or sdk <= entry.max_sdk_version:
                return True
        return False

    def components_named(self, name: str) -> list[Component]:
        return [component for component in self.components if component.name == name]

    def install_capability(self) -> dict:
        """Can Android 8+ grant this package the install-unknown-apps capability?

        Mirrors the checks Android itself performs in
        ``ComputerEngine.canRequestPackageInstalls``: the package must target
        API 26 or newer and must declare REQUEST_INSTALL_PACKAGES.
        """
        reasons: list[str] = []
        if not self.target_sdk_declared:
            reasons.append("target-sdk-not-declared")
        elif self.target_sdk is None:
            reasons.append("target-sdk-unreadable")
        elif self.target_sdk < MIN_TARGET_SDK_FOR_INSTALL_CAPABILITY:
            reasons.append("target-sdk-below-26")
        entries = self.permission_entries(REQUEST_INSTALL_PACKAGES)
        if not entries:
            reasons.append("request-install-packages-not-declared")
        else:
            capped = [entry for entry in entries if entry.sdk_capped]
            if capped and all(entry.sdk_capped for entry in entries):
                reasons.append("request-install-packages-sdk-capped")
        return {
            "package": self.package,
            "version_code": self.version_code,
            "version_name": self.version_name,
            "min_sdk": self.min_sdk,
            "target_sdk": self.target_sdk,
            "can_be_granted": not reasons,
            "reasons": reasons,
        }

    def summary(self) -> dict:
        return {
            "package": self.package,
            "version_code": self.version_code,
            "version_name": self.version_name,
            "min_sdk": self.min_sdk,
            "target_sdk": self.target_sdk,
            "max_sdk": self.max_sdk,
            "permissions": [
                {"name": entry.permission, "maxSdkVersion": entry.max_sdk_version,
                 "tag": entry.tag}
                for entry in self.permissions
            ],
            "components": [
                {"kind": component.kind, "name": component.name,
                 "exported": component.exported, "permission": component.permission,
                 "authorities": component.authorities,
                 "grantUriPermissions": component.granted_uri_permissions,
                 "actions": list(component.intent_actions),
                 "categories": list(component.intent_categories),
                 "grantUriPaths": list(component.path_permissions)}
                for component in self.components
            ],
            "install_capability": self.install_capability(),
        }


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def _as_optional_bool(attribute: Optional[Attribute]) -> Optional[bool]:
    if attribute is None:
        return None
    value = attribute.value
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "false"):
            return lowered == "true"
    return None


def _component_from(element: Element, kind: str, package: str = "") -> Component:
    actions: list[str] = []
    categories: list[str] = []
    paths: list[str] = []
    for intent_filter in find_all(element, "intent-filter"):
        for action in find_all(intent_filter, "action"):
            actions.append(str(action.value("name", "")))
        for category in find_all(intent_filter, "category"):
            categories.append(str(category.value("name", "")))
    for grant in find_all(element, "grant-uri-permission"):
        paths.append(str(grant.value("path", "")))
    name = str(element.value("name", ""))
    # Android resolves a leading dot (or a bare class name) against the package.
    if name.startswith("."):
        name = f"{package}{name}"
    elif name and "." not in name and package:
        name = f"{package}.{name}"
    return Component(
        kind=kind,
        name=name,
        exported=_as_optional_bool(element.attr("exported")),
        permission=element.text("permission"),
        authorities=element.text("authorities"),
        granted_uri_permissions=_as_optional_bool(element.attr("grantUriPermissions")),
        intent_actions=tuple(action for action in actions if action),
        intent_categories=tuple(category for category in categories if category),
        path_permissions=tuple(path for path in paths if path),
    )


def _permission_declarations(root: Element) -> tuple[PermissionDeclaration, ...]:
    declarations: list[PermissionDeclaration] = []
    for tag in ("uses-permission", "uses-permission-sdk-23"):
        for element in root.find_all(tag):
            name = element.text("name")
            if not name:
                continue
            max_sdk = element.value("maxSdkVersion")
            declarations.append(PermissionDeclaration(
                permission=name,
                max_sdk_version=max_sdk if isinstance(max_sdk, int) else None,
                tag=tag,
            ))
    return tuple(declarations)


def facts_from_root(root: Element) -> ManifestFacts:
    if root.tag != "manifest":
        raise BinaryXmlError(f"expected <manifest>, found <{root.tag}>")
    package = root.text("package", android=False)
    if not package:
        raise ManifestError("the manifest does not declare a package name")

    version_code = root.value("versionCode")
    if not isinstance(version_code, int):
        text = root.text("versionCode")
        version_code = int(text) if text and text.isdigit() else None
    version_name = root.text("versionName")
    uses_sdk = root.find("uses-sdk")
    min_sdk = target_sdk = max_sdk = None
    target_declared = False
    if uses_sdk is not None:
        min_sdk = version_to_api(uses_sdk.value("minSdkVersion"))
        target_sdk = version_to_api(uses_sdk.value("targetSdkVersion"))
        max_sdk = version_to_api(uses_sdk.value("maxSdkVersion"))
        target_declared = uses_sdk.attr("targetSdkVersion") is not None

    components: list[Component] = []
    application = root.find("application")
    application_attributes: dict = {}
    if application is not None:
        application_attributes = {
            attribute.name: attribute.value for attribute in application.attributes
        }
        for kind, tag in (("activity", "activity"), ("activity", "activity-alias"),
                          ("service", "service"), ("provider", "provider"),
                          ("receiver", "receiver")):
            for element in find_all(application, tag):
                components.append(_component_from(element, kind, package))

    return ManifestFacts(
        package=package,
        version_code=version_code,
        version_name=version_name,
        min_sdk=min_sdk,
        target_sdk=target_sdk,
        max_sdk=max_sdk,
        permissions=_permission_declarations(root),
        components=tuple(components),
        application=application_attributes,
        root=root,
        target_sdk_declared=target_declared,
    )


def read_manifest_bytes(apk_path: str) -> bytes:
    try:
        with zipfile.ZipFile(apk_path) as archive:
            names = archive.namelist()
            if MANIFEST_ENTRY not in names:
                raise ManifestError(f"{apk_path} has no {MANIFEST_ENTRY}")
            return archive.read(MANIFEST_ENTRY)
    except zipfile.BadZipFile as error:
        raise ManifestError(f"{apk_path} is not a readable zip: {error}") from error


def inspect_apk(apk_path: str) -> ManifestFacts:
    """Parse the compiled manifest of an APK and return its facts."""
    return facts_from_root(parse_binary_xml(read_manifest_bytes(apk_path)))


def read_manifest_file(path: str) -> ManifestFacts:
    """Parse a standalone compiled AndroidManifest.xml (binary XML) file."""
    with open(path, "rb") as handle:
        return facts_from_root(parse_binary_xml(handle.read()))


# ---------------------------------------------------------------------------
# Release-facing checks
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Expectation:
    package: str
    version_code: Optional[int] = None
    version_name: Optional[str] = None
    target_sdk_min: int = MIN_TARGET_SDK_FOR_INSTALL_CAPABILITY
    require_install_capability: bool = True
    required_permissions: tuple[str, ...] = (RECEIVE_BOOT_COMPLETED,)
    updater_activity: str = "io.github.twoarchiver.ytark.updater.UpdateActivity"
    forbidden_activity: str = "io.github.twoarchiver.ytark.updater.UpdateLauncherActivity"
    job_service: str = "io.github.twoarchiver.ytark.updater.UpdateCheckJobService"
    providers: tuple[tuple[str, str, bool], ...] = (
        ("io.github.twoarchiver.ytark.updater.UpdateBootstrapProvider", "{package}.ytarkupdater", False),
        ("io.github.twoarchiver.ytark.updater.PendingUpdateProvider", "{package}.ytarkupdater.files", True),
    )


def check_facts(facts: ManifestFacts, expected: Expectation) -> list[str]:
    """Return the list of violations for the packaged manifest (empty is good)."""
    problems: list[str] = []
    if facts.package != expected.package:
        problems.append(f"package is {facts.package!r}, expected {expected.package!r}")
    if expected.version_code is not None and facts.version_code != expected.version_code:
        problems.append(
            f"versionCode is {facts.version_code!r}, expected {expected.version_code!r}")
    if expected.version_name is not None and facts.version_name != expected.version_name:
        problems.append(
            f"versionName is {facts.version_name!r}, expected {expected.version_name!r}")
    if facts.min_sdk is None:
        problems.append("minSdkVersion is missing or unreadable")
    if facts.target_sdk is None:
        problems.append(
            "targetSdkVersion is missing or unreadable; the packaged manifest must "
            "declare a numeric target")
    elif facts.target_sdk < expected.target_sdk_min:
        problems.append(
            f"targetSdkVersion is {facts.target_sdk}, below the API "
            f"{expected.target_sdk_min} required for install authorization "
            "(canRequestPackageInstalls needs Android 8+ targeting)")
    if expected.require_install_capability:
        capability = facts.install_capability()
        for reason in capability["reasons"]:
            problems.append(f"install capability: {reason}")
        for entry in facts.permission_entries(REQUEST_INSTALL_PACKAGES):
            if entry.sdk_capped:
                problems.append(
                    f"{REQUEST_INSTALL_PACKAGES} is declared with maxSdkVersion="
                    f"{entry.max_sdk_version}; unknown-source authorization must not "
                    "be capped")
    for permission in expected.required_permissions:
        if not facts.declares(permission):
            problems.append(f"the manifest does not declare {permission}")
    matches = facts.components_named(expected.updater_activity)
    if len(matches) != 1:
        problems.append(
            f"expected exactly one {expected.updater_activity}, found {len(matches)}")
    else:
        activity = matches[0]
        if activity.exported is not False:
            problems.append(f"{expected.updater_activity} must be explicitly non-exported")
        if activity.intent_actions:
            problems.append(f"{expected.updater_activity} must have no external routes")
    if facts.components_named(expected.forbidden_activity):
        problems.append(f"the obsolete {expected.forbidden_activity} must not be packaged")
    services = facts.components_named(expected.job_service)
    if len(services) != 1:
        problems.append(f"expected exactly one {expected.job_service}, found {len(services)}")
    else:
        if services[0].permission != BIND_JOB_SERVICE:
            problems.append(
                f"{expected.job_service} must require {BIND_JOB_SERVICE}; "
                f"found {services[0].permission!r}")
        if services[0].exported is not False:
            problems.append(f"{expected.job_service} must be explicitly non-exported")
    for provider, authorities, needs_grant in expected.providers:
        # The authority is part of the package's public contract, so it is
        # compared with the expected release package id, never with whatever
        # package the APK happens to declare.
        expected_authorities = authorities.format(package=expected.package)
        found = facts.components_named(provider)
        if len(found) != 1:
            problems.append(f"expected exactly one {provider}, found {len(found)}")
            continue
        component = found[0]
        if component.authorities != expected_authorities:
            problems.append(
                f"{provider} authorities are {component.authorities!r}, "
                f"expected {expected_authorities!r}")
        if component.exported is not False:
            problems.append(f"{provider} must be explicitly non-exported")
        if needs_grant:
            if component.granted_uri_permissions is not True:
                problems.append(f"{provider} must declare android:grantUriPermissions")
            if "/update.apk" not in component.path_permissions:
                problems.append(f"{provider} must grant only the /update.apk path")
    return problems


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def _print_summary(facts: ManifestFacts, stream=sys.stdout) -> None:
    capability = facts.install_capability()
    print(f"package: {facts.package}", file=stream)
    print(f"versionCode: {facts.version_code}", file=stream)
    print(f"versionName: {facts.version_name}", file=stream)
    print(f"minSdkVersion: {facts.min_sdk}", file=stream)
    print(f"targetSdkVersion: {facts.target_sdk}", file=stream)
    capability_state = "yes" if capability["can_be_granted"] else "no"
    details = ",".join(capability["reasons"]) or "-"
    print(f"installCapability: {capability_state} ({details})", file=stream)
    install_entries = facts.permission_entries(REQUEST_INSTALL_PACKAGES)
    if install_entries:
        for entry in install_entries:
            cap = entry.max_sdk_version
            print(f"declares: {entry.permission} via <{entry.tag}> "
                  f"maxSdkVersion={cap}", file=stream)
    else:
        print(f"declares: {REQUEST_INSTALL_PACKAGES} MISSING", file=stream)
    print(f"permissions: {len(facts.permissions)} declarations", file=stream)
    for component in facts.components:
        if component.name.startswith("io.github.twoarchiver.ytark.updater"):
            print(
                f"component: {component.kind} {component.name} exported={component.exported} "
                f"authorities={component.authorities} permission={component.permission} "
                f"grantUriPermissions={component.granted_uri_permissions}",
                file=stream)


def _cmd_inspect(args) -> int:
    facts = inspect_apk(args.apk)
    if args.json:
        print(json.dumps(facts.summary(), indent=2, sort_keys=True))
    else:
        _print_summary(facts)
    return 0


def _cmd_audit(args) -> int:
    """Report whether a packaged APK can ever be trusted to install packages."""
    facts = inspect_apk(args.apk)
    capability = facts.install_capability()
    print(f"audit-apk: {args.apk}")
    _print_summary(facts)
    if args.json:
        print(json.dumps(facts.summary(), indent=2, sort_keys=True))
    if not capability["can_be_granted"]:
        print(
            "FAIL: Android will refuse the per-app install authorization for this "
            "package (" + ", ".join(capability["reasons"]) + ")",
            file=sys.stderr)
        return 1
    print("OK: this package can be granted install authorization on Android 8+")
    return 0


def _cmd_check(args) -> int:
    facts = inspect_apk(args.apk) if args.apk else read_manifest_file(args.manifest)
    expected = Expectation(
        package=args.package,
        version_code=args.version_code,
        version_name=args.version_name,
        target_sdk_min=args.min_target_sdk,
    )
    problems = check_facts(facts, expected)
    _print_summary(facts)
    if problems:
        for problem in problems:
            print(f"FAIL: {problem}", file=sys.stderr)
        return 1
    print(f"OK: packaged manifest matches the {args.package} contract")
    return 0


def _cmd_self_test(_args) -> int:
    """Parse a compiled manifest encoded in memory, without touching the network."""
    data = encode_axml(_self_test_manifest())
    facts = facts_from_root(parse_binary_xml(data))
    assert facts.package == "io.github.twoarchiver.ytark", facts.package
    assert facts.version_code == 3060000, facts.version_code
    assert facts.target_sdk == 34, facts.target_sdk
    assert facts.declares(REQUEST_INSTALL_PACKAGES), facts.permissions
    assert facts.install_capability()["can_be_granted"], facts.install_capability()
    print("apk_manifest self-test: OK")
    return 0


def _self_test_manifest() -> "NodeSpec":
    return NodeSpec("manifest", (
        attr("package", "io.github.twoarchiver.ytark", android=False),
        attr("versionCode", 3060000),
        attr("versionName", "3.6.0"),
    ), (
        NodeSpec("uses-sdk", (attr("minSdkVersion", 24), attr("targetSdkVersion", 34))),
        NodeSpec("uses-permission", (attr("name", REQUEST_INSTALL_PACKAGES),)),
        NodeSpec("uses-permission", (attr("name", RECEIVE_BOOT_COMPLETED),)),
        NodeSpec("application", (), ()),
    ))


# ---------------------------------------------------------------------------
# Minimal AXML encoder (used by --self-test and by the manifest test fixtures)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AttributeSpec:
    name: str
    value: object
    android: bool = True
    raw: Optional[str] = None


@dataclass(frozen=True)
class NodeSpec:
    tag: str
    attributes: tuple = ()
    children: tuple = ()


def attr(name: str, value: object, android: bool = True,
         raw: Optional[str] = None) -> AttributeSpec:
    return AttributeSpec(name=name, value=value, android=android, raw=raw)


def _collect_strings(node: NodeSpec, strings: list[str],
                     index: dict[str, int]) -> None:
    def add(value: str) -> None:
        if value not in index:
            index[value] = len(strings)
            strings.append(value)
    add(node.tag)
    for attribute in node.attributes:
        add(attribute.name)
        if attribute.raw is not None:
            add(attribute.raw)
        if isinstance(attribute.value, str):
            add(attribute.value)
    for child in node.children:
        _collect_strings(child, strings, index)


def _encode_pool(strings: list[str]) -> bytes:
    encoded = [struct.pack("<H", len(value)) + (value + "\x00").encode("utf-16-le")
               for value in strings]
    offsets: list[int] = []
    data = bytearray()
    for value in encoded:
        offsets.append(len(data))
        data += value
    header_size = 28
    strings_start = header_size + 4 * len(strings)
    out = bytearray()
    out += struct.pack("<HHI", RES_STRING_POOL_TYPE, header_size,
                       strings_start + len(data))
    out += struct.pack("<IIIII", len(strings), 0, 0, strings_start, 0)
    for offset in offsets:
        out += struct.pack("<I", offset)
    out += data
    return bytes(out)


def encode_axml(root: NodeSpec) -> bytes:
    """Encode a NodeSpec tree as Android binary XML (a compiled manifest).

    Only what the inspector needs: a UTF-16 string pool, a resource map, the
    Android namespace chunk and the element tree. This is how the self-test and
    the unit fixtures build inputs that are byte-for-byte the format aapt emits.
    """
    strings: list[str] = []
    index: dict[str, int] = {}
    for fixed in ("android", ANDROID_NS):
        index[fixed] = len(strings)
        strings.append(fixed)
    _collect_strings(root, strings, index)

    def res_value(attribute: AttributeSpec) -> bytes:
        value = attribute.value
        if value is None:
            return struct.pack("<HBBI", 8, 0, TYPE_NULL, 0)
        if isinstance(value, bool):
            return struct.pack("<HBBI", 8, 0, TYPE_INT_BOOLEAN, 1 if value else 0)
        if isinstance(value, int):
            return struct.pack("<HBBI", 8, 0, TYPE_INT_DEC, value & 0xFFFFFFFF)
        return struct.pack("<HBBI", 8, 0, TYPE_STRING, index[str(value)])

    body = bytearray()
    body += struct.pack("<HHI", RES_XML_RESOURCE_MAP_TYPE, 8, 8 + 4)
    body += struct.pack("<I", 0x01010003)
    body += struct.pack("<HHIIi", RES_XML_START_NAMESPACE_TYPE, 16, 24, 1, -1)
    body += struct.pack("<II", index["android"], index[ANDROID_NS])

    def emit(node: NodeSpec) -> None:
        attributes = bytearray()
        for attribute in node.attributes:
            ns_index = index[ANDROID_NS] if attribute.android else 0xFFFFFFFF
            raw = attribute.raw
            if raw is None and isinstance(attribute.value, str):
                raw = attribute.value
            attributes += struct.pack("<II", ns_index, index[attribute.name])
            attributes += struct.pack(
                "<I", index[raw] if raw is not None else 0xFFFFFFFF)
            attributes += res_value(attribute)
        attr_ext = struct.pack("<IIHHHHHH", 0xFFFFFFFF, index[node.tag], 20, 20,
                               len(node.attributes), 0, 0, 0)
        payload = attr_ext + bytes(attributes)
        body.extend(struct.pack("<HHIIi", RES_XML_START_ELEMENT_TYPE, 16,
                                16 + len(payload), 1, -1))
        body.extend(payload)
        for child in node.children:
            emit(child)
        end = struct.pack("<II", 0xFFFFFFFF, index[node.tag])
        body.extend(struct.pack("<HHIIi", RES_XML_END_ELEMENT_TYPE, 16, 16 + len(end),
                                1, -1))
        body.extend(end)

    emit(root)
    pool = _encode_pool(strings)
    total = 8 + len(pool) + len(body)
    return struct.pack("<HHI", RES_XML_TYPE, 8, total) + pool + bytes(body)


def build_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--self-test", action="store_true",
                        help="parse a manifest built in memory and exit")
    subparsers = parser.add_subparsers(dest="command")
    inspect_parser = subparsers.add_parser("inspect", help="print manifest facts")
    inspect_parser.add_argument("--apk", required=True)
    inspect_parser.add_argument("--json", action="store_true")
    inspect_parser.set_defaults(handler=_cmd_inspect)
    audit_parser = subparsers.add_parser(
        "audit", help="report whether the package can be granted install authorization")
    audit_parser.add_argument("--apk", required=True)
    audit_parser.add_argument("--json", action="store_true")
    audit_parser.set_defaults(handler=_cmd_audit)
    check_parser = subparsers.add_parser("check", help="enforce the packaged manifest contract")
    check_parser.add_argument("--apk")
    check_parser.add_argument("--manifest", help="a standalone binary AndroidManifest.xml")
    check_parser.add_argument("--package", required=True)
    check_parser.add_argument("--version-code", type=int)
    check_parser.add_argument("--version-name")
    check_parser.add_argument("--min-target-sdk", type=int,
                              default=MIN_TARGET_SDK_FOR_INSTALL_CAPABILITY)
    check_parser.set_defaults(handler=_cmd_check)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    build_arguments(parser)
    args = parser.parse_args(argv)
    if getattr(args, "self_test", False):
        return _cmd_self_test(args)
    if not getattr(args, "handler", None):
        parser.print_help()
        return 2
    try:
        return args.handler(args)
    except (ManifestError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
