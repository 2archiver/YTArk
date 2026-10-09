#!/usr/bin/env bash
# sign_apks.sh — sign all *-unsigned.apk in a directory.
#
# Two modes:
#   persistent: secrets ANDROID_KEYSTORE_B64 / ANDROID_KEYSTORE_PASSWORD /
#               ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD are set (recommended —
#               updates install over previous builds)
#   ephemeral:  no secrets — a fresh key is generated for this run only
#               (future builds will need an uninstall/reinstall first)
#
# Usage: sign_apks.sh <dir-with-unsigned-apks>
# Writes <dir>/signing-mode.txt so the release notes can state which mode ran.

set -euo pipefail

WORK="${1:?usage: sign_apks.sh <dir>}"

shopt -s nullglob
apks=("$WORK"/*-unsigned.apk)
[ "${#apks[@]}" -gt 0 ] || { echo "no *-unsigned.apk found in $WORK" >&2; exit 1; }

if [ -n "${KEYSTORE_B64:-}" ]; then
  echo "[sign] using persistent keystore from secrets"
  echo "persistent" > "$WORK/signing-mode.txt"
  KEYSTORE="$WORK/keystore.jks"
  printf '%s' "$KEYSTORE_B64" | base64 -d > "$KEYSTORE"
  KS_PASS="pass:${KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD secret missing}"
  KS_ALIAS="${KEY_ALIAS:?ANDROID_KEY_ALIAS secret missing}"
  KEY_PASS="pass:${KEY_PASSWORD:?ANDROID_KEY_PASSWORD secret missing}"
else
  echo "[sign] no keystore secrets set — generating an EPHEMERAL key for this run"
  echo "ephemeral" > "$WORK/signing-mode.txt"
  KEYSTORE="$WORK/ephemeral.jks"
  KS_PASS="pass:personaltv"
  KS_ALIAS="personaltv"
  KEY_PASS="$KS_PASS"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass personaltv -keypass personaltv \
    -dname "CN=Personal Tube TV, OU=Personal, O=Personal, C=AU" >/dev/null
fi

for unsigned in "${apks[@]}"; do
  signed="${unsigned%-unsigned.apk}.apk"
  echo "[sign] $(basename "$unsigned") -> $(basename "$signed")"
  apksigner sign \
    --ks "$KEYSTORE" \
    --ks-pass "$KS_PASS" \
    --ks-key-alias "$KS_ALIAS" \
    --key-pass "$KEY_PASS" \
    --out "$signed" \
    "$unsigned"
  apksigner verify "$signed"
  rm -f "$unsigned"
done

# Never leave key material around.
rm -f "$KEYSTORE"
echo "[sign] done"
