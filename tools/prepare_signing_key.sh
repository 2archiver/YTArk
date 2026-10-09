#!/usr/bin/env bash
# Prepare the one pinned YTArk signer. The default is Hearth's intentionally public
# community keystore; optional Actions secrets may cache that same identity.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/release/signing.properties"
CERT_FILE="$ROOT/signing/YTArk-cert-sha256.txt"

property() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$CONFIG"
}

COMMUNITY_REPOSITORY="$(property communityRepository)"
COMMUNITY_COMMIT="$(property communityCommit)"
COMMUNITY_KEYSTORE_PATH="$(property communityKeystorePath)"
COMMUNITY_KEYSTORE_BLOB_SHA="$(property communityKeystoreBlobSha)"
COMMUNITY_KEY_ALIAS="$(property communityKeyAlias)"
COMMUNITY_KEYSTORE_PASSWORD="$(property communityKeystorePassword)"
COMMUNITY_KEY_PASSWORD="$(property communityKeyPassword)"

[[ "$COMMUNITY_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "Invalid pinned community signer repository" >&2; exit 1;
}
[[ "$COMMUNITY_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Invalid pinned community signer commit" >&2; exit 1;
}
[[ "$COMMUNITY_KEYSTORE_BLOB_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Invalid pinned community signer blob SHA" >&2; exit 1;
}
[[ "$COMMUNITY_KEYSTORE_PATH" =~ ^[A-Za-z0-9_./-]+$ ]] || {
  echo "Invalid pinned community signer path" >&2; exit 1;
}

EXPECTED_CERT_SHA256="$(grep -v '^[[:space:]]*#' "$CERT_FILE" | tr -d '[:space:]:' | tr '[:upper:]' '[:lower:]')"
[[ "$EXPECTED_CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Pinned public certificate fingerprint is not initialized" >&2; exit 1;
}

command -v openssl >/dev/null || { echo "OpenSSL is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required" >&2; exit 1; }

configured=0
for variable in YTARK_KEYSTORE_B64 YTARK_KEYSTORE_PASSWORD YTARK_KEY_ALIAS YTARK_KEY_PASSWORD; do
  if [[ -n "${!variable:-}" ]]; then configured=$((configured + 1)); fi
done
if [[ "$configured" != 0 && "$configured" != 4 ]]; then
  echo "Configure all four YTARK signing secrets together, or leave all unset to use the pinned Hearth community key." >&2
  exit 1
fi

RUNNER_TEMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
KEY_DIR="$RUNNER_TEMP/ytark-signing"
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"
umask 077
KEYSTORE="$KEY_DIR/ytark-release.p12"
STORE_PASSWORD_FILE="$KEY_DIR/store-password"
KEY_PASSWORD_FILE="$KEY_DIR/key-password"
CERT="$KEY_DIR/release-cert.pem"

if [[ "$configured" == 4 ]]; then
  printf '%s' "$YTARK_KEYSTORE_B64" | base64 --decode > "$KEYSTORE"
  printf '%s' "$YTARK_KEYSTORE_PASSWORD" > "$STORE_PASSWORD_FILE"
  printf '%s' "$YTARK_KEY_PASSWORD" > "$KEY_PASSWORD_FILE"
  KEY_ALIAS="$YTARK_KEY_ALIAS"
  echo "Using the configured YTArk keystore; its signer must match the pinned Hearth certificate."
else
  command -v gh >/dev/null || { echo "GitHub CLI is required to fetch the pinned community signer" >&2; exit 1; }
  RESPONSE="$KEY_DIR/community-keystore.json"
  gh api "repos/$COMMUNITY_REPOSITORY/contents/$COMMUNITY_KEYSTORE_PATH?ref=$COMMUNITY_COMMIT" > "$RESPONSE"
  python3 - "$RESPONSE" "$KEYSTORE" "$COMMUNITY_KEYSTORE_BLOB_SHA" <<'PY'
import base64
import hashlib
import json
import sys

response_path, output_path, expected_blob = sys.argv[1:]
with open(response_path, encoding="utf-8") as response:
    payload = json.load(response)
if payload.get("encoding") != "base64":
    raise SystemExit("Pinned community keystore was not returned as base64 content")
if payload.get("sha") != expected_blob:
    raise SystemExit("Pinned community keystore Git blob SHA changed")
data = base64.b64decode(payload.get("content", ""), validate=False)
if not data:
    raise SystemExit("Pinned community keystore is empty")
blob_hash = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
if blob_hash != expected_blob:
    raise SystemExit("Pinned community keystore contents failed Git blob verification")
with open(output_path, "wb") as output:
    output.write(data)
PY
  printf '%s' "$COMMUNITY_KEYSTORE_PASSWORD" > "$STORE_PASSWORD_FILE"
  printf '%s' "$COMMUNITY_KEY_PASSWORD" > "$KEY_PASSWORD_FILE"
  KEY_ALIAS="$COMMUNITY_KEY_ALIAS"
  echo "Using the pinned Hearth community keystore (public source, immutable commit and blob)."
fi

[[ -s "$KEYSTORE" ]] || { echo "YTArk signing keystore is empty" >&2; exit 1; }
[[ "$KEY_ALIAS" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Invalid YTArk signing key alias" >&2; exit 1; }
openssl pkcs12 -in "$KEYSTORE" -passin "file:$STORE_PASSWORD_FILE" \
  -clcerts -nokeys -out "$CERT"
ACTUAL_CERT_SHA256="$(openssl x509 -in "$CERT" -outform DER | sha256sum | awk '{print $1}')"
if [[ "$ACTUAL_CERT_SHA256" != "$EXPECTED_CERT_SHA256" ]]; then
  echo "Signing keystore certificate mismatch: expected $EXPECTED_CERT_SHA256, got $ACTUAL_CERT_SHA256" >&2
  exit 1
fi

[[ -n "${GITHUB_ENV:-}" ]] || { echo "GITHUB_ENV is required" >&2; exit 1; }
{
  printf 'YTARK_SIGNING_DIR=%s\n' "$KEY_DIR"
  printf 'YTARK_KEYSTORE_PATH=%s\n' "$KEYSTORE"
  printf 'YTARK_STORE_PASSWORD_FILE=%s\n' "$STORE_PASSWORD_FILE"
  printf 'YTARK_KEY_PASSWORD_FILE=%s\n' "$KEY_PASSWORD_FILE"
  printf 'YTARK_KEY_ALIAS=%s\n' "$KEY_ALIAS"
  printf 'SIGNING_CERT_SHA256=%s\n' "$EXPECTED_CERT_SHA256"
} >> "$GITHUB_ENV"
rm -f "$KEY_DIR/community-keystore.json" "$CERT"
echo "Verified the pinned YTArk release signer certificate ($EXPECTED_CERT_SHA256)."
