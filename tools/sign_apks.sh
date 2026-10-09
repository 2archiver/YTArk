#!/usr/bin/env bash
# Sign each aligned YTArk APK with the one permanent production keystore.
set -euo pipefail

WORK="${1:?usage: sign_apks.sh <directory-with-unsigned-apks>}"
: "${YTARK_KEYSTORE_B64:?YTARK_KEYSTORE_B64 GitHub Actions secret is required}"
: "${YTARK_KEYSTORE_PASSWORD:?YTARK_KEYSTORE_PASSWORD GitHub Actions secret is required}"
: "${YTARK_KEY_ALIAS:?YTARK_KEY_ALIAS GitHub Actions secret is required}"
: "${YTARK_KEY_PASSWORD:?YTARK_KEY_PASSWORD GitHub Actions secret is required}"
: "${YTARK_EXPECTED_CERT_SHA256:?YTARK_EXPECTED_CERT_SHA256 is required}"

EXPECTED_CERT="$(printf '%s' "$YTARK_EXPECTED_CERT_SHA256" | tr -d '[:space:]:' | tr '[:upper:]' '[:lower:]')"
[[ "$EXPECTED_CERT" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid expected signing certificate fingerprint" >&2; exit 1; }

umask 077
TEMP_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ytark-signing.XXXXXX")"
KEYSTORE="$TEMP_DIR/ytark-release.p12"
STORE_PASS_FILE="$TEMP_DIR/store-password"
KEY_PASS_FILE="$TEMP_DIR/key-password"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

printf '%s' "$YTARK_KEYSTORE_PASSWORD" > "$STORE_PASS_FILE"
printf '%s' "$YTARK_KEY_PASSWORD" > "$KEY_PASS_FILE"
printf '%s' "$YTARK_KEYSTORE_B64" | base64 --decode > "$KEYSTORE"
[ -s "$KEYSTORE" ] || { echo "decoded production keystore is empty" >&2; exit 1; }

shopt -s nullglob
unsigned_apks=("$WORK"/*-unsigned.apk)
[ "${#unsigned_apks[@]}" -eq 1 ] || {
  echo "expected exactly one unsigned YTArk ARM64 APK, found ${#unsigned_apks[@]}" >&2
  exit 1
}

for unsigned in "${unsigned_apks[@]}"; do
  signed="${unsigned%-unsigned.apk}.apk"
  echo "Signing $(basename "$signed") with the permanent YTArk certificate."
  apksigner sign \
    --ks "$KEYSTORE" \
    --ks-type PKCS12 \
    --ks-key-alias "$YTARK_KEY_ALIAS" \
    --ks-pass "file:$STORE_PASS_FILE" \
    --key-pass "file:$KEY_PASS_FILE" \
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
  echo "Verified APK signature and permanent certificate for $(basename "$signed")."
  rm -f "$unsigned"
done

# No key material is left in the workspace or release artifact directory.
rm -f "$WORK"/keystore* "$WORK"/ephemeral* "$WORK"/*password*
echo "The YTArk ARM64 APK was signed and verified with the pinned production certificate."
