#!/usr/bin/env python3
"""
repack_apk.py — Repack TizenTubeCobalt APK into a YTArk release build.

What it does (per APK):
  1. apktool decode (dex stays raw: --no-src; resources + manifest decode
     to text — apktool 3.x leaves the manifest binary under --no-res)
  2. Patch AndroidManifest.xml: new package id, new authorities, new label
  3. Patch apktool.yml: new versionCode / versionName
  4. Binary-patch the userscript URL inside lib/*/*.so
     (same-host jsDelivr URL, same byte length, zero-padded query —
      keeps the CSP allowlist in the same .so valid)
  5. apktool build
  6. Re-zip with lib/*.so AND resources.arsc stored uncompressed
     (extractNativeLibs=false + targetSdk 30+ requirements)
  7. zipalign -p 4

Signing is left to the caller (apksigner).

Self-test:  python3 tools/repack_apk.py --self-test
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

# ---------------------------------------------------------------------------
# Constants — verified against TizenTubeCobalt v2.0.2 source:
# third_party/blink/renderer/core/dom/document.cc (Document::ImplicitClose)
#   std::string("https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?v=")
#     + std::to_string(epoch_time);
# The timestamp is appended at runtime, so any same-or-shorter URL ending in
# "?v=" can replace the literal; pad the remainder with '0' (still a valid
# query value once the timestamp is appended).
# ---------------------------------------------------------------------------

OLD_SCRIPT_URL = b"https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?v="
OLD_PACKAGE = "io.gh.reisxd.tizentube.cobalt"
OLD_LABEL = "TizenTube"  # literal in the manifest template's application tag


def run(cmd, **kwargs):
    print(f"  + {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, **kwargs)


# ---------------------------------------------------------------------------
# Binary patching
# ---------------------------------------------------------------------------

def make_replacement_url(new_url: str) -> bytes:
    """Validate the new script URL and pad it to the exact old byte length."""
    new = new_url.encode("ascii")
    if not new.endswith(b"?v="):
        raise SystemExit(
            f"ERROR: --script-url must end with '?v=' (the app appends a "
            f"timestamp at runtime). Got: {new_url!r}")
    if len(new) > len(OLD_SCRIPT_URL):
        raise SystemExit(
            f"ERROR: replacement URL is {len(new)} bytes, must be <= "
            f"{len(OLD_SCRIPT_URL)} (length of the compiled-in literal). "
            f"Shorten the tag/repo: {new_url!r}")
    # Pad inside the query value:  ?v=000...  + <timestamp>  stays valid.
    padded = new + b"0" * (len(OLD_SCRIPT_URL) - len(new))
    assert len(padded) == len(OLD_SCRIPT_URL)
    return padded


def patch_file(path: str, old: bytes, new: bytes) -> int:
    """Replace every occurrence of `old` with `new` (same length)."""
    with open(path, "rb") as fh:
        data = fh.read()
    count = data.count(old)
    if count:
        data = data.replace(old, new)
        with open(path, "wb") as fh:
            fh.write(data)
    return count


def patch_script_url(decoded_dir: str, script_url: str) -> int:
    """Patch the userscript URL in every file of the decoded APK tree."""
    replacement = make_replacement_url(script_url)
    print(f"[*] Patching userscript URL (all occurrences, exact length "
          f"{len(OLD_SCRIPT_URL)} bytes):")
    print(f"    old: {OLD_SCRIPT_URL.decode()}")
    print(f"    new: {script_url}")
    total = 0
    # Scan every file in the decoded tree — the literal lives in .rodata of
    # libchrobalt.so, but patch it wherever it appears.
    for root, _dirs, files in os.walk(decoded_dir):
        for name in files:
            path = os.path.join(root, name)
            n = patch_file(path, OLD_SCRIPT_URL, replacement)
            if n:
                rel = os.path.relpath(path, decoded_dir)
                print(f"    patched {n} occurrence(s) in {rel}")
                total += n
    if total == 0:
        raise SystemExit(
            f"ERROR: userscript URL literal not found in decoded APK. The "
            f"upstream build may have changed — verify the constant "
            f"OLD_SCRIPT_URL against the base APK's libchrobalt.so.")
    print(f"    total: {total} occurrence(s) patched")
    return total


# ---------------------------------------------------------------------------
# Manifest / apktool.yml patching
# ---------------------------------------------------------------------------

# apktool 3.x renders attributes WITHOUT the android: prefix and/or with a
# resource-id suffix, e.g. versionCode(0x0101021b)="202" — tolerate all
# forms and preserve the matched form when rewriting.
ATTR_ID = r"(?:\([^)]*\))?"
ANDROID_XML_NAMESPACE = "http://schemas.android.com/apk/res/android"


def _attr(name: str) -> str:
    return rf"(?:android:)?{name}{ATTR_ID}"


def normalize_android_namespace(decoded_dir: str) -> None:
    """Normalize Apktool's generated Android attribute prefix to ``android``.

    Apktool 3.x may serialize the Android XML namespace as ``n0`` instead of
    ``android``. The repacker adds new attributes and components, so normalize
    the namespace first to keep existing and injected attributes bound alike.
    """
    path = os.path.join(decoded_dir, "AndroidManifest.xml")
    with open(path, encoding="utf-8") as fh:
        xml = fh.read()

    namespace_uri = re.escape(ANDROID_XML_NAMESPACE)
    declaration = re.compile(
        r"""xmlns:([A-Za-z_][\w.-]*)\s*=\s*[\"']"""
        + namespace_uri + r"""[\"']""")
    prefixes = list(dict.fromkeys(declaration.findall(xml)))
    if not prefixes:
        if re.search(r"xmlns:android\s*=", xml):
            return
        raise SystemExit("ERROR: decoded manifest has no Android XML namespace.")

    chosen = "android" if "android" in prefixes else prefixes[0]
    for prefix in prefixes:
        if prefix == chosen:
            continue
        xml = re.sub(rf"(?<![\w.-]){re.escape(prefix)}:", f"{chosen}:", xml)
        xml = re.sub(
            rf"\s+xmlns:{re.escape(prefix)}\s*=\s*[\"'][^\"']*[\"']",
            "", xml, count=1)

    if chosen != "android":
        xml = re.sub(rf"(?<![\w.-]){re.escape(chosen)}:", "android:", xml)
        xml = re.sub(rf"xmlns:{re.escape(chosen)}(?=\s*=)", "xmlns:android", xml, count=1)

    if not re.search(r"xmlns:android\s*=", xml):
        raise SystemExit("ERROR: could not normalize the decoded Android XML namespace.")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)
    print("[*] Manifest: normalized Android XML namespace to android:")

def debug_dump_manifest(path: str) -> None:
    with open(path, encoding="utf-8") as fh:
        xml = fh.read()
    lines = xml.splitlines()
    print(f"[debug] decoded AndroidManifest.xml ({len(lines)} lines, "
          f"{len(xml)} chars) — first 40 lines:")
    for line in lines[:40]:
        print("    " + line[:400])
    if len(lines) > 40:
        print("[debug] remaining lines mentioning label/version/application:")
        for line in lines[40:]:
            if re.search(r"label|version|<application", line, re.I):
                print("    " + line.strip()[:400])


def patch_manifest(decoded_dir: str, app_id: str, app_name: str,
                   version_code: int = None, version_name: str = None) -> None:
    path = os.path.join(decoded_dir, "AndroidManifest.xml")
    with open(path, encoding="utf-8") as fh:
        xml = fh.read()

    if OLD_PACKAGE not in xml:
        raise SystemExit(
            f"ERROR: package '{OLD_PACKAGE}' not found in decoded manifest — "
            f"base APK layout may have changed.")

    # Version attrs: a manifest attr overrides apktool's --version-code
    # flag, so patch any existing attr in place (preserving its form).
    if version_code is not None:
        xml, n = re.subn(rf'({_attr("versionCode")})="\d+"',
                         rf'\g<1>="{version_code}"', xml)
        print(f"[*] Manifest: versionCode attr patched (x{n})"
              if n else "[!] Manifest: no versionCode attr "
                        "(apktool.yml --version-code flag will apply)")
    if version_name is not None:
        xml, n = re.subn(rf'({_attr("versionName")})="[^"]*"',
                         rf'\g<1>="{version_name}"', xml)
        print(f"[*] Manifest: versionName attr patched (x{n})"
              if n else "[!] Manifest: no versionName attr "
                        "(apktool.yml --version-name flag will apply)")

    n_pkg = xml.count(OLD_PACKAGE)
    xml = xml.replace(OLD_PACKAGE, app_id)
    print(f"[*] Manifest: replaced {n_pkg} reference(s) to "
          f"'{OLD_PACKAGE}' -> '{app_id}'")

    # Application/activity labels: replace every label attr value (literal or
    # @string reference). The launcher shows the activity label when present,
    # so patch them all. Preserve the attribute's original form.
    patched_resources = []

    def _label_repl(m):
        attr, value = m.group(1), m.group(2)
        if value.startswith("@string/"):
            res_name = value[len("@string/"):]
            patched_resources.append(res_name)
            return m.group(0)  # reference stays; patch resource content
        return f'{attr}="{app_name}"'

    xml, n_labels = re.subn(rf'({_attr("label")})="([^"]*)"',
                            _label_repl, xml)
    for res_name in patched_resources:
        patch_string_resource(decoded_dir, res_name, app_name)
    print(f"[*] Manifest: {n_labels} label attr(s) processed "
          f"({len(patched_resources)} via @string resource)")

    if n_labels == 0:
        # No label attributes at all — add one to <application>, using the
        # android: prefix only when the decoded manifest binds that namespace.
        prefix = "android:" if "xmlns:android" in xml else ""
        app_tag = re.search(r"<application\b[^>]*>", xml, re.S)
        if app_tag:
            block = app_tag.group(0)
            new_block = block.replace(
                "<application", f'<application {prefix}label="{app_name}"', 1)
            xml = xml.replace(block, new_block, 1)
            print(f"[*] Manifest: injected application label "
                  f"'{prefix}label=\"{app_name}\"'")

    # Component names are fully qualified (dev.cobalt.app.MainActivity,
    # org.chromium.*) and untouched by the package rename — verified against
    # cobalt/shell/android/shell_apk/AndroidManifest.xml.jinja2 at v2.0.2.
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)


def patch_string_resource(decoded_dir: str, res_name: str, new_value: str) -> None:
    """Set <string name="res_name">…</string> in every res/values*/strings.xml."""
    pattern = re.compile(
        r'(<string name="%s"[^>]*>).*?(</string>)' % re.escape(res_name), re.S)
    patched = 0
    for path in glob.glob(os.path.join(decoded_dir, "res", "values*", "strings.xml")):
        with open(path, encoding="utf-8") as fh:
            xml = fh.read()
        xml, n = pattern.subn(lambda m: m.group(1) + new_value + m.group(2), xml)
        if n:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(xml)
            patched += n
            print(f"[*] Resource: string '{res_name}' -> '{new_value}' "
                  f"({os.path.relpath(path, decoded_dir)})")
    if not patched:
        print(f"[!] No <string name=\"{res_name}\"> found — label not changed.")


def patch_apktool_yml(path: str, version_code: int, version_name: str) -> None:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    # NOTE: apktool 3.x parses versionCode as an int — keep it UNQUOTED.
    text, n_code = re.subn(
        r"versionCode: '?\d+'?", f"versionCode: {version_code}", text)
    text, n_name = re.subn(
        r"versionName: .*", f"versionName: {version_name}", text)
    if n_code != 1 or n_name != 1:
        raise SystemExit(
            f"ERROR: could not patch apktool.yml versionInfo "
            f"(matched versionCode x{n_code}, versionName x{n_name}).")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"[*] apktool.yml: versionCode={version_code}, "
          f"versionName={version_name}")


# ---------------------------------------------------------------------------
# YTArk launcher icon
# ---------------------------------------------------------------------------

def patch_launcher_icon(decoded_dir: str) -> None:
    """Replace upstream launcher icon references with the YTArk vector icon."""
    manifest_path = os.path.join(decoded_dir, "AndroidManifest.xml")
    with open(manifest_path, encoding="utf-8") as fh:
        xml = fh.read()

    icon_pattern = r'(?<![\w:])(?:android:)?icon(?:\([^)]*\))?="[^"]*"'
    round_icon_pattern = r'(?<![\w:])(?:android:)?roundIcon(?:\([^)]*\))?="[^"]*"'
    banner_pattern = r'(?<![\w:])(?:android:)?banner(?:\([^)]*\))?="[^"]*"'
    replacement = lambda match: match.group(0).split("=", 1)[0] + '="@drawable/ytark_launcher"'
    xml, icon_count = re.subn(icon_pattern, replacement, xml)
    xml, round_count = re.subn(round_icon_pattern, replacement, xml)
    xml, banner_count = re.subn(
        banner_pattern,
        lambda match: match.group(0).split("=", 1)[0] + '="@drawable/ytark_banner"',
        xml)
    if icon_count == 0 or banner_count == 0:
        app_tag = re.search(r"<application\b[^>]*>", xml, re.S)
        if not app_tag:
            raise SystemExit("ERROR: cannot set YTArk launcher artwork without <application>.")
        block = app_tag.group(0)
        if icon_count == 0:
            block = block.replace("<application", '<application android:icon="@drawable/ytark_launcher"', 1)
            icon_count = 1
        if banner_count == 0:
            block = block.replace("<application", '<application android:banner="@drawable/ytark_banner"', 1)
            banner_count = 1
        xml = xml.replace(app_tag.group(0), block, 1)

    with open(manifest_path, "w", encoding="utf-8") as fh:
        fh.write(xml)

    source = os.path.join(os.path.dirname(__file__), "..", "android-updater", "ytark_launcher.xml")
    if not os.path.isfile(source):
        raise SystemExit(f"ERROR: YTArk launcher vector is missing: {source}")
    target_dir = os.path.join(decoded_dir, "res", "drawable")
    os.makedirs(target_dir, exist_ok=True)
    shutil.copyfile(source, os.path.join(target_dir, "ytark_launcher.xml"))
    banner_source = os.path.join(os.path.dirname(__file__), "..", "android-updater", "ytark_banner.xml")
    if not os.path.isfile(banner_source):
        raise SystemExit(f"ERROR: YTArk launcher banner is missing: {banner_source}")
    shutil.copyfile(banner_source, os.path.join(target_dir, "ytark_banner.xml"))
    print(f"[*] Launcher: rebranded {icon_count} icon and {banner_count} banner reference(s)")


# ---------------------------------------------------------------------------
# Native YTArk updater manifest and DEX injection
# ---------------------------------------------------------------------------

UPDATER_PACKAGE = "io.github.twoarchiver.ytark.updater"
UPDATER_ACTIVITY = UPDATER_PACKAGE + ".UpdateActivity"
UPDATER_PROVIDER = UPDATER_PACKAGE + ".UpdateBootstrapProvider"
UPDATER_RECEIVER = UPDATER_PACKAGE + ".UpdateActionReceiver"


def patch_updater_manifest(decoded_dir: str, app_id: str) -> None:
    """Declare the native updater, private provider/receiver and TV deep link."""
    path = os.path.join(decoded_dir, "AndroidManifest.xml")
    with open(path, encoding="utf-8") as fh:
        xml = fh.read()

    if not re.search(r"xmlns:android\s*=", xml):
        raise SystemExit("ERROR: decoded manifest has no android namespace.")
    if UPDATER_PROVIDER in xml or UPDATER_ACTIVITY in xml or UPDATER_RECEIVER in xml:
        raise SystemExit("ERROR: native YTArk updater components already exist in the manifest.")

    permissions = (
        "android.permission.INTERNET",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.REQUEST_INSTALL_PACKAGES",
    )
    permission_xml = ""
    for permission in permissions:
        if permission not in xml:
            permission_xml += f'    <uses-permission android:name="{permission}" />\n'
    app_start = re.search(r"<application\b", xml)
    if not app_start:
        raise SystemExit("ERROR: could not find <application> in decoded manifest.")
    if permission_xml:
        xml = xml[:app_start.start()] + permission_xml + xml[app_start.start():]

    components = f"""
    <activity
        android:name="{UPDATER_ACTIVITY}"
        android:theme="@android:style/Theme.Material.NoActionBar"
        android:screenOrientation="landscape"
        android:excludeFromRecents="true"
        android:launchMode="singleTop"
        android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="ytark" android:host="updates" />
      </intent-filter>
    </activity>
    <provider
        android:name="{UPDATER_PROVIDER}"
        android:authorities="{app_id}.ytarkupdater"
        android:exported="false"
        android:initOrder="100" />
    <receiver
        android:name="{UPDATER_RECEIVER}"
        android:exported="false" />\n"""
    close_app = xml.rfind("</application>")
    if close_app < 0:
        raise SystemExit("ERROR: could not find </application> in decoded manifest.")
    xml = xml[:close_app] + components + xml[close_app:]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)
    print("[*] Manifest: added YTArk updater, notification and installer permissions")


def inject_updater_dex(decoded_dir: str, updater_dex: str) -> str:
    """Append the native updater DEX as the next classesN.dex file."""
    if not updater_dex or not os.path.isfile(updater_dex):
        raise SystemExit(f"ERROR: native updater DEX not found: {updater_dex!r}")
    dex_files = []
    for name in os.listdir(decoded_dir):
        match = re.fullmatch(r"classes(\d*)\.dex", name)
        if match:
            dex_files.append((1 if match.group(1) == "" else int(match.group(1)), name))
    if not any(index == 1 for index, _name in dex_files):
        raise SystemExit("ERROR: base APK has no classes.dex; cannot inject the updater.")
    next_index = max(index for index, _name in dex_files) + 1
    target = os.path.join(decoded_dir, f"classes{next_index}.dex")
    shutil.copyfile(updater_dex, target)
    print(f"[*] Injected native updater into {os.path.basename(target)}")
    return target


# ---------------------------------------------------------------------------
# Zip handling
# ---------------------------------------------------------------------------

def store_uncompressed(apk_path: str) -> None:
    """Rewrite the zip with lib/*.so and resources.arsc stored (not deflated).

    Modern Android (targetSdk 30+, extractNativeLibs unset/false) requires
    uncompressed, page-aligned native libs, and an uncompressed 4-byte
    aligned resources.arsc. zipalign -p afterwards handles alignment; this
    handles the compression methods.
    """
    force_stored = lambda name: name.startswith("lib/") or name == "resources.arsc"
    tmp = apk_path + ".tmp"
    with zipfile.ZipFile(apk_path) as zin, \
            zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if force_stored(item.filename) and \
                    item.compress_type != zipfile.ZIP_STORED:
                info = zipfile.ZipInfo(item.filename, item.date_time)
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = item.external_attr
                info.comment = item.comment
                zout.writestr(info, data)
            else:
                zout.writestr(item, data)
    os.replace(tmp, apk_path)
    print("[*] Rewrote zip: lib/*.so + resources.arsc stored uncompressed")


# ---------------------------------------------------------------------------
# Main repack flow
# ---------------------------------------------------------------------------

def repack(args) -> None:
    work = tempfile.mkdtemp(prefix="repack-")
    decoded = os.path.join(work, "decoded")
    print(f"[*] Work dir: {work}")

    apktool = args.apktool.split()

    print(f"[*] Decoding {args.base} (dex stays raw, resources + manifest decoded)")
    run(apktool + ["d", "--no-src", "--force",
                   "--output", decoded, args.base])

    normalize_android_namespace(decoded)
    patch_script_url(decoded, args.script_url)
    debug_dump_manifest(os.path.join(decoded, "AndroidManifest.xml"))
    patch_manifest(decoded, args.app_id, args.app_name,
                   version_code=args.version_code,
                   version_name=args.version_name)
    patch_launcher_icon(decoded)
    patch_updater_manifest(decoded, args.app_id)
    inject_updater_dex(decoded, args.updater_dex)
    patch_apktool_yml(os.path.join(decoded, "apktool.yml"),
                      args.version_code, args.version_name)

    unsigned = os.path.join(work, "unsigned.apk")
    print("[*] Rebuilding APK")
    run(apktool + ["b", decoded, "--output", unsigned])

    store_uncompressed(unsigned)

    aligned = os.path.join(work, "aligned.apk")
    print("[*] zipalign (-f -p 4)")
    run([args.zipalign, "-f", "-p", "4", unsigned, aligned])

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    shutil.copy(aligned, args.out)
    print(f"[*] Done: {args.out} (unsigned + aligned — sign with apksigner)")


# ---------------------------------------------------------------------------
# Self-test (no external tools needed)
# ---------------------------------------------------------------------------

def self_test() -> None:
    ok = True

    # 1. Old URL constant length sanity.
    if len(OLD_SCRIPT_URL) != 69:
        print(f"FAIL: OLD_SCRIPT_URL length {len(OLD_SCRIPT_URL)} != 69")
        ok = False
    else:
        print(f"PASS: OLD_SCRIPT_URL is {len(OLD_SCRIPT_URL)} bytes")

    # 2. Replacement construction + binary patch round-trip.
    new_url = "https://cdn.jsdelivr.net/gh/example/user-repo@s7/userScript.js?v="
    repl = make_replacement_url(new_url)
    if len(repl) != len(OLD_SCRIPT_URL):
        print("FAIL: replacement length mismatch")
        ok = False
    if not repl.startswith(new_url.encode()):
        print("FAIL: padding must extend, not alter, the URL")
        ok = False
    if not repl.endswith(b"?v=" + b"0" * (len(repl) - len(new_url.encode()))):
        print("FAIL: padding must be '0' bytes directly after '?v='")
        ok = False

    fake = b"prefix\x00" + OLD_SCRIPT_URL + b"\x00suffix" + OLD_SCRIPT_URL
    with tempfile.NamedTemporaryFile(delete=False) as fh:
        fh.write(fake)
        path = fh.name
    n = patch_file(path, OLD_SCRIPT_URL, repl)
    with open(path, "rb") as fh:
        patched = fh.read()
    os.unlink(path)
    if n != 2 or patched.count(repl) != 2 or OLD_SCRIPT_URL in patched:
        print("FAIL: binary patch did not replace all occurrences")
        ok = False
    else:
        print("PASS: binary patch replaced all occurrences, length preserved")

    # 3. URL too long must be rejected.
    too_long = "https://cdn.jsdelivr.net/gh/" + "a" * 40 + "/userScript.js?v="
    try:
        make_replacement_url(too_long)
        print("FAIL: over-length URL accepted")
        ok = False
    except SystemExit:
        print("PASS: over-length URL rejected")

    # 4. Real repo slug length budget check (2archiver/YTArk).
    base = "https://cdn.jsdelivr.net/gh/2archiver/YTArk@"
    tail = "/userScript.js?v="
    budget = len(OLD_SCRIPT_URL) - len(base) - len(tail)
    if budget < 5:
        print(f"FAIL: tag budget for real repo is only {budget} chars")
        ok = False
    else:
        for tag in ("s1", "s42", "s1234567"):
            make_replacement_url(f"{base}{tag}{tail}")
        print(f"PASS: tag budget for 2archiver/YTArk is {budget} chars "
              f"(s1 … s1234567 all fit)")

    # 5. Manifest patch on a sample resembling the decoded upstream manifest.
    sample = (
        '<?xml version="1.0"?>\n'
        f'<manifest package="{OLD_PACKAGE}"\n'
        '          versionCode(0x0101021b)="200" versionName(0x0101021c)="2.0.2">\n'
        '  <application android:label="TizenTube" android:name="dev.cobalt.app.CobaltApplication">\n'
        f'    <activity label(0x01010001)="TizenTube" android:name="dev.cobalt.app.MainActivity"/>\n'
        f'    <provider android:authorities="{OLD_PACKAGE}.fileprovider"/>\n'
        '  </application>\n'
        '</manifest>\n')
    tdir = tempfile.mkdtemp()
    mpath = os.path.join(tdir, "AndroidManifest.xml")
    with open(mpath, "w") as fh:
        fh.write(sample)
    patch_manifest(tdir, "io.github.twoarchiver.ytark", "YTArk",
                   version_code=20015, version_name="2.0.3-ytark.15")
    with open(mpath) as fh:
        out = fh.read()
    checks = [
        ('package="io.github.twoarchiver.ytark"' in out, "package attr renamed"),
        ("io.gh.reisxd.tizentube.cobalt" not in out, "no old package refs"),
        ('android:label="YTArk"' in out, "label replaced"),
        ('authorities="io.github.twoarchiver.ytark.fileprovider"' in out,
         "provider authority renamed"),
        ('android:name="dev.cobalt.app.CobaltApplication"' in out,
         "FQCN component names untouched"),
        ('versionCode(0x0101021b)="20015"' in out,
         "versionCode attr patched (prefix-less form preserved)"),
        ('versionName(0x0101021c)="2.0.3-ytark.15"' in out,
         "versionName attr patched (prefix-less form preserved)"),
        ('<activity label(0x01010001)="YTArk"' in out,
         "activity label patched (prefix-less form preserved)"),
    ]
    for passed, what in checks:
        if not passed:
            print(f"FAIL: manifest patch — {what}")
            ok = False
    if all(p for p, _ in checks):
        print("PASS: manifest patch (package/authority/label, FQCNs intact)")

    # 5d. Native updater components and permissions are injected with the app id.
    updater_dir = tempfile.mkdtemp()
    updater_manifest = (
        '<?xml version="1.0"?>\n'
        '<manifest xmlns:n0="http://schemas.android.com/apk/res/android" '
        f'package="{OLD_PACKAGE}">\n'
        '  <application n0:label="TizenTube">\n'
        '  </application>\n'
        '</manifest>\n')
    with open(os.path.join(updater_dir, "AndroidManifest.xml"), "w") as fh:
        fh.write(updater_manifest)
    normalize_android_namespace(updater_dir)
    patch_launcher_icon(updater_dir)
    patch_updater_manifest(updater_dir, "io.github.twoarchiver.ytark")
    with open(os.path.join(updater_dir, "AndroidManifest.xml"), encoding="utf-8") as fh:
        patched_updater_manifest = fh.read()
    updater_checks = [
        ('android:icon="@drawable/ytark_launcher"' in patched_updater_manifest,
         "application icon changed to YTArk"),
        ('android:banner="@drawable/ytark_banner"' in patched_updater_manifest,
         "Android TV launcher banner changed to YTArk"),
        (UPDATER_ACTIVITY in patched_updater_manifest, "native update activity declared"),
        (UPDATER_PROVIDER in patched_updater_manifest, "startup provider declared"),
        ("io.github.twoarchiver.ytark.ytarkupdater" in patched_updater_manifest,
         "provider authority follows app id"),
        ('android:scheme="ytark" android:host="updates"' in patched_updater_manifest,
         "settings deep link declared"),
        ("android.permission.REQUEST_INSTALL_PACKAGES" in patched_updater_manifest,
         "install permission declared"),
    ]
    if all(passed for passed, _what in updater_checks):
        print("PASS: native updater manifest components, deep link and permissions")
    else:
        for passed, what in updater_checks:
            if not passed:
                print(f"FAIL: updater manifest — {what}")
                ok = False

    dex_dir = tempfile.mkdtemp()
    with open(os.path.join(dex_dir, "classes.dex"), "wb") as fh:
        fh.write(b"base dex")
    with open(os.path.join(dex_dir, "classes2.dex"), "wb") as fh:
        fh.write(b"base multidex")
    updater_dex = os.path.join(dex_dir, "updater.dex")
    with open(updater_dex, "wb") as fh:
        fh.write(b"updater dex")
    injected = inject_updater_dex(dex_dir, updater_dex)
    if os.path.basename(injected) == "classes3.dex" and open(injected, "rb").read() == b"updater dex":
        print("PASS: updater DEX is appended after existing multidex entries")
    else:
        print("FAIL: updater DEX injection")
        ok = False

    # 6. Native-lib rezip.
    with tempfile.NamedTemporaryFile(suffix=".apk", delete=False) as fh:
        zpath = fh.name
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("resources.arsc", b"\0" * 32,
                    compress_type=zipfile.ZIP_STORED)
        zf.writestr("lib/arm64-v8a/libchrobalt.so", b"\0" * 64,
                    compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("classes.dex", b"\0" * 64,
                    compress_type=zipfile.ZIP_DEFLATED)
    store_uncompressed(zpath)
    with zipfile.ZipFile(zpath) as zf:
        lib_stored = zf.getinfo("lib/arm64-v8a/libchrobalt.so").compress_type \
            == zipfile.ZIP_STORED
        dex_deflated = zf.getinfo("classes.dex").compress_type \
            == zipfile.ZIP_DEFLATED
        arsc_stored = zf.getinfo("resources.arsc").compress_type \
            == zipfile.ZIP_STORED
    os.unlink(zpath)
    if lib_stored and dex_deflated and arsc_stored:
        print("PASS: zip rewrite (libs stored, dex still deflated, arsc stored)")
    else:
        print("FAIL: zip rewrite compression methods wrong")
        ok = False


    # 5b. Manifest label via @string resource.
    sample2 = (
        '<?xml version="1.0"?>\n'
        f'<manifest package="{OLD_PACKAGE}"\n'
        '          android:versionCode(0x0101021b)="200" android:versionName(0x0101021c)="2.0.2">\n'
        '  <application label(0x01010001)="@string/app_name" android:name="dev.cobalt.app.CobaltApplication">\n'
        '  </application>\n'
        '</manifest>\n')
    tdir2 = tempfile.mkdtemp()
    os.makedirs(os.path.join(tdir2, "res", "values"))
    with open(os.path.join(tdir2, "AndroidManifest.xml"), "w") as fh:
        fh.write(sample2)
    with open(os.path.join(tdir2, "res", "values", "strings.xml"), "w") as fh:
        fh.write('<resources>\n  <string name="app_name">TizenTube</string>\n'
                 '  <string name="other">keep</string>\n</resources>\n')
    patch_manifest(tdir2, "io.github.twoarchiver.ytark", "YTArk")
    with open(os.path.join(tdir2, "res", "values", "strings.xml")) as fh:
        res = fh.read()
    if ('<string name="app_name">YTArk</string>' in res
            and '<string name="other">keep</string>' in res):
        print("PASS: @string label patched in res/values/strings.xml")
    else:
        print("FAIL: @string label patch")
        ok = False

    # 5c. apktool.yml versionCode must stay unquoted (apktool 3.x parseInt).
    yml = tempfile.NamedTemporaryFile("w", suffix=".yml", delete=False)
    yml.write("versionInfo:\n  versionCode: '200'\n  versionName: 2.0.2\n")
    yml.close()
    patch_apktool_yml(yml.name, 20015, "2.0.3-ytark.15")
    yml_text = open(yml.name).read()
    os.unlink(yml.name)
    if "versionCode: 20015" in yml_text and "versionName: 2.0.3-ytark.15" in yml_text:
        print("PASS: apktool.yml versionInfo (unquoted versionCode)")
    else:
        print("FAIL: apktool.yml patch produced: " + yml_text)
        ok = False

    print("\nSELF-TEST:", "ALL PASS" if ok else "FAILURES")
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--base", help="path to the official base APK")
    ap.add_argument("--out", help="output path for the repacked (unsigned) APK")
    ap.add_argument("--updater-dex", help="compiled native YTArk updater DEX")
    ap.add_argument("--app-name", default="YTArk")
    ap.add_argument("--app-id", default="io.github.twoarchiver.ytark")
    ap.add_argument("--script-url", required=False,
                    help="replacement userscript URL, must end with '?v='")
    ap.add_argument("--version-code", type=int, default=20015)
    ap.add_argument("--version-name", default="2.0.3-ytark.15")
    ap.add_argument("--apktool", default="apktool",
                    help="apktool command, e.g. 'java -jar apktool.jar'")
    ap.add_argument("--zipalign", default="zipalign")
    args = ap.parse_args()

    if args.self_test:
        self_test()
    for req in ("base", "out", "updater_dex", "script_url"):
        if not getattr(args, req):
            ap.error(f"--{req.replace('_', '-')} is required")
    repack(args)


if __name__ == "__main__":
    main()
