#!/usr/bin/env python3
"""
repack_apk.py — Repack TizenTubeCobalt APK into a personalized build.

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

def patch_manifest(path: str, app_id: str, app_name: str) -> None:
    with open(path, encoding="utf-8") as fh:
        xml = fh.read()

    if OLD_PACKAGE not in xml:
        raise SystemExit(
            f"ERROR: package '{OLD_PACKAGE}' not found in decoded manifest — "
            f"base APK layout may have changed.")

    n_pkg = xml.count(OLD_PACKAGE)
    xml = xml.replace(OLD_PACKAGE, app_id)
    print(f"[*] Manifest: replaced {n_pkg} reference(s) to "
          f"'{OLD_PACKAGE}' -> '{app_id}'")

    # Application label: the upstream manifest uses a literal label on the
    # <application> tag. Replace whatever literal it carries.
    app_tag = re.search(r"<application\b[^>]*>", xml, re.S)
    if not app_tag:
        raise SystemExit("ERROR: could not find <application> tag in manifest")
    block = app_tag.group(0)
    label_match = re.search(r'android:label="([^"]*)"', block)
    if label_match:
        old_label = label_match.group(1)
        new_block = block.replace(
            f'android:label="{old_label}"', f'android:label="{app_name}"', 1)
        xml = xml.replace(block, new_block, 1)
        print(f"[*] Manifest: application label '{old_label}' -> '{app_name}'")
    else:
        print("[!] Manifest: no literal android:label on <application>; "
              "label may come from resources (not decoded) — leaving as-is.")

    # Component names are fully qualified (dev.cobalt.app.MainActivity,
    # org.chromium.*) and untouched by the package rename — verified against
    # cobalt/shell/android/shell_apk/AndroidManifest.xml.jinja2 at v2.0.2.
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)


def patch_apktool_yml(path: str, version_code: int, version_name: str) -> None:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    text, n_code = re.subn(
        r"versionCode: '?\d+'?", f"versionCode: '{version_code}'", text)
    text, n_name = re.subn(
        r"versionName: .*", f"versionName: {version_name}", text)
    if n_code != 1 or n_name != 1:
        raise SystemExit(
            f"ERROR: could not patch apktool.yml versionInfo "
            f"(matched versionCode x{n_code}, versionName x{n_name}).")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"[*] apktool.yml: versionCode='{version_code}', "
          f"versionName='{version_name}'")


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

    patch_script_url(decoded, args.script_url)
    patch_manifest(os.path.join(decoded, "AndroidManifest.xml"),
                   args.app_id, args.app_name)
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
        f'<manifest package="{OLD_PACKAGE}" versionCode="200">\n'
        '  <application android:label="TizenTube" android:name="dev.cobalt.app.CobaltApplication">\n'
        f'    <provider android:authorities="{OLD_PACKAGE}.fileprovider"/>\n'
        '  </application>\n'
        '</manifest>\n')
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as fh:
        fh.write(sample)
        mpath = fh.name
    patch_manifest(mpath, "io.github.personal.tubetv", "Personal Tube TV")
    with open(mpath) as fh:
        out = fh.read()
    os.unlink(mpath)
    checks = [
        ('package="io.github.personal.tubetv"' in out, "package attr renamed"),
        ("io.gh.reisxd.tizentube.cobalt" not in out, "no old package refs"),
        ('android:label="Personal Tube TV"' in out, "label replaced"),
        ('authorities="io.github.personal.tubetv.fileprovider"' in out,
         "provider authority renamed"),
        ('android:name="dev.cobalt.app.CobaltApplication"' in out,
         "FQCN component names untouched"),
    ]
    for passed, what in checks:
        if not passed:
            print(f"FAIL: manifest patch — {what}")
            ok = False
    if all(p for p, _ in checks):
        print("PASS: manifest patch (package/authority/label, FQCNs intact)")

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

    print("\nSELF-TEST:", "ALL PASS" if ok else "FAILURES")
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--base", help="path to the official base APK")
    ap.add_argument("--out", help="output path for the repacked (unsigned) APK")
    ap.add_argument("--app-name", default="Personal Tube TV")
    ap.add_argument("--app-id", default="io.github.personal.tubetv")
    ap.add_argument("--script-url", required=False,
                    help="replacement userscript URL, must end with '?v='")
    ap.add_argument("--version-code", type=int, default=200)
    ap.add_argument("--version-name", default="2.0.2-personal")
    ap.add_argument("--apktool", default="apktool",
                    help="apktool command, e.g. 'java -jar apktool.jar'")
    ap.add_argument("--zipalign", default="zipalign")
    args = ap.parse_args()

    if args.self_test:
        self_test()
    for req in ("base", "out", "script_url"):
        if not getattr(args, req):
            ap.error(f"--{req.replace('_', '-')} is required")
    repack(args)


if __name__ == "__main__":
    main()
