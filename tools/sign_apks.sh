#!/usr/bin/env bash
# Sign the aligned YTArk APK with the pinned Hearth community certificate.
set -euo pipefail

WORK="${1:?usage: sign_apks.sh <directory-with-unsigned-apks>}"
: "${YTARK_KEYSTORE_PATH:?YTARK_KEYSTORE_PATH is required}"
: "${YTARK_STORE_PASSWORD_FILE:?YTARK_STORE_PASSWORD_FILE is required}"
: "${YTARK_KEY_PASSWORD_FILE:?YTARK_KEY_PASSWORD_FILE is required}"
: "${YTARK_KEY_ALIAS:?YTARK_KEY_ALIAS is required}"
: "${YTARK_EXPECTED_CERT_SHA256:?YTARK_EXPECTED_CERT_SHA256 is required}"

SIGNING_DIR="${YTARK_SIGNING_DIR:-}"
if [ -n "$SIGNING_DIR" ]; then
  [ "$YTARK_KEYSTORE_PATH" = "$SIGNING_DIR/ytark-release.p12" ] || {
    echo "Refusing to clean up an unexpected YTArk signing directory" >&2; exit 1;
  }
  cleanup() { rm -rf -- "$SIGNING_DIR"; }
  trap cleanup EXIT
fi

EXPECTED_CERT="$(printf '%s' "$YTARK_EXPECTED_CERT_SHA256" | tr -d '[:space:]:' | tr '[:upper:]' '[:lower:]')"
[[ "$EXPECTED_CERT" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid expected signing certificate fingerprint" >&2; exit 1; }
[ -s "$YTARK_KEYSTORE_PATH" ] || { echo "YTArk signing keystore is missing or empty" >&2; exit 1; }
[ -s "$YTARK_STORE_PASSWORD_FILE" ] || { echo "YTArk keystore password file is missing" >&2; exit 1; }
[ -s "$YTARK_KEY_PASSWORD_FILE" ] || { echo "YTArk key password file is missing" >&2; exit 1; }

shopt -s nullglob
unsigned_apks=("$WORK"/*-unsigned.apk)
[ "${#unsigned_apks[@]}" -eq 1 ] || {
  echo "expected exactly one unsigned YTArk ARM64 APK, found ${#unsigned_apks[@]}" >&2
  exit 1
}

for unsigned in "${unsigned_apks[@]}"; do
  signed="${unsigned%-unsigned.apk}.apk"
  echo "Signing $(basename "$signed") with the pinned YTArk release certificate."
  apksigner sign \
    --ks "$YTARK_KEYSTORE_PATH" \
    --ks-type PKCS12 \
    --ks-key-alias "$YTARK_KEY_ALIAS" \
    --ks-pass "file:$YTARK_STORE_PASSWORD_FILE" \
    --key-pass "file:$YTARK_KEY_PASSWORD_FILE" \
    --out "$signed" \
    "$unsigned"

  verify_output="$(apksigner verify --verbose --print-certs "$signed")"
  actual_cert="$(printf '%s\n' "$verify_output" | python3 -c '
import re,sys
text=sys.stdin.read()
m=re.search(r"certificate SHA-256 digest:\s*([0-9a-fA-F:]+)", text, re.I)
if not m:
    raise SystemExit("apksigner did not report a signer certificate")
print(re.sub(r"[^0-9a-fA-F]", "", m.group(1)).lower())
')"
  [ "$actual_cert" = "$EXPECTED_CERT" ] || {
    echo "FAIL: $signed has the wrong signing certificate" >&2
    exit 1
  }
  echo "Verified APK signature and pinned certificate for $(basename "$signed")."
  rm -f "$unsigned"
done

echo "The YTArk ARM64 APK was signed and verified with the pinned Hearth community certificate."
