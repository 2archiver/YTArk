#!/usr/bin/env bash
# Generate and store the one permanent YTArk production signing identity.
# Requires a GitHub connection with repository Actions-secret write permission.
set -euo pipefail

REPOSITORY="${GITHUB_REPOSITORY:-2archiver/YTArk}"
ALIAS="ytark-release"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGNING_DIR="$ROOT/signing"

[ "$REPOSITORY" = "2archiver/YTArk" ] || {
  echo "Refusing to provision a YTArk production key for $REPOSITORY" >&2
  exit 1
}
command -v openssl >/dev/null || { echo "OpenSSL is required" >&2; exit 1; }
command -v gh >/dev/null || { echo "GitHub CLI is required" >&2; exit 1; }

echo "Checking access to repository Actions secrets..."
if ! gh secret list --repo "$REPOSITORY" >/dev/null; then
  echo "GitHub secret-write access is unavailable. Reconnect GitHub in Arena and retry." >&2
  exit 1
fi

# Refuse to rotate an existing production identity automatically.
existing="$(gh secret list --repo "$REPOSITORY" --json name --jq '.[].name')"
for name in YTARK_KEYSTORE_B64 YTARK_KEYSTORE_PASSWORD YTARK_KEY_ALIAS YTARK_KEY_PASSWORD; do
  if grep -Fxq "$name" <<< "$existing"; then
    echo "Secret $name already exists. Refusing to generate a replacement production key." >&2
    exit 1
  fi
done

umask 077
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ytark-production-signing.XXXXXX")"
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

KEYSTORE="$TEMP_DIR/ytark-release.p12"
CERT="$TEMP_DIR/YTArk-release-cert.pem"
KEY="$TEMP_DIR/ytark-release-private.pem"
STORE_PASSWORD_FILE="$TEMP_DIR/store-password"
KEY_PASSWORD_FILE="$TEMP_DIR/key-password"

openssl rand -hex 32 > "$STORE_PASSWORD_FILE"
cp "$STORE_PASSWORD_FILE" "$KEY_PASSWORD_FILE"

# One RSA production key is kept in PKCS#12 format for apksigner. It is not
# written under the repository and is removed after the encrypted secrets land.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$KEY"
openssl req -new -x509 -key "$KEY" -sha256 -days 10000 \
  -subj "/CN=YTArk Release Signing/O=2archiver/C=US" \
  -out "$CERT"
openssl pkcs12 -export -name "$ALIAS" -inkey "$KEY" -in "$CERT" \
  -out "$KEYSTORE" -passout "file:$STORE_PASSWORD_FILE"

CERT_SHA256="$(openssl x509 -in "$CERT" -outform DER | sha256sum | awk '{print $1}')"
[[ "$CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "Could not compute public certificate fingerprint" >&2; exit 1; }

# gh secret set reads each value from stdin; secrets never appear in arguments
# or terminal output. The private files remain under TEMP_DIR until all writes
# succeed, and the EXIT trap removes them on success or failure.
base64 -w0 "$KEYSTORE" | gh secret set YTARK_KEYSTORE_B64 --repo "$REPOSITORY"
cat "$STORE_PASSWORD_FILE" | gh secret set YTARK_KEYSTORE_PASSWORD --repo "$REPOSITORY"
printf '%s' "$ALIAS" | gh secret set YTARK_KEY_ALIAS --repo "$REPOSITORY"
cat "$KEY_PASSWORD_FILE" | gh secret set YTARK_KEY_PASSWORD --repo "$REPOSITORY"

mkdir -p "$SIGNING_DIR"
cp "$CERT" "$SIGNING_DIR/YTArk-release-cert.pem"
printf '# SHA-256 fingerprint of the permanent YTArk APK signing certificate.\n%s\n' \
  "$CERT_SHA256" > "$SIGNING_DIR/YTArk-cert-sha256.txt"
chmod 0644 "$SIGNING_DIR/YTArk-release-cert.pem" "$SIGNING_DIR/YTArk-cert-sha256.txt"

echo "Production YTArk signing secrets are stored in GitHub Actions."
echo "The public certificate fingerprint is recorded in signing/YTArk-cert-sha256.txt."
echo "Commit only the public certificate and fingerprint; the keystore was deleted."
