#!/usr/bin/env bash
# Optional: cache the pinned Hearth community keystore in YTArk Actions secrets.
# The release workflow can fetch this same public signer itself; no new key is generated.
set -euo pipefail

REPOSITORY="${GITHUB_REPOSITORY:-2archiver/YTArk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

[[ "$REPOSITORY" == "2archiver/YTArk" ]] || {
  echo "Refusing to provision YTArk signing secrets for $REPOSITORY" >&2
  exit 1
}
command -v gh >/dev/null || { echo "GitHub CLI is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required" >&2; exit 1; }

echo "Checking access to repository Actions secrets..."
if ! existing="$(gh secret list --repo "$REPOSITORY")"; then
  echo "GitHub Actions-secret access is unavailable. This step is optional: the release workflow fetches the pinned community key automatically." >&2
  exit 1
fi

for name in YTARK_KEYSTORE_B64 YTARK_KEYSTORE_PASSWORD YTARK_KEY_ALIAS YTARK_KEY_PASSWORD; do
  if awk -v name="$name" '$1 == name { found = 1 } END { exit !found }' <<< "$existing"; then
    echo "Secret $name already exists. Refusing to overwrite or rotate the YTArk signing identity." >&2
    exit 1
  fi
done

umask 077
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ytark-community-signing.XXXXXX")"
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

# Prepare and independently verify the same pinned key used by CI. Never generate a
# replacement key: Android and the updater require this exact certificate fingerprint.
unset YTARK_KEYSTORE_B64 YTARK_KEYSTORE_PASSWORD YTARK_KEY_ALIAS YTARK_KEY_PASSWORD
GITHUB_ENV="$TEMP_DIR/github-env" RUNNER_TEMP="$TEMP_DIR" \
  bash "$ROOT/tools/prepare_signing_key.sh"
# GITHUB_ENV contains only temporary paths, the public alias and fingerprint.
# shellcheck disable=SC1090
source "$TEMP_DIR/github-env"

python3 - "$YTARK_KEYSTORE_PATH" <<'PY' | gh secret set YTARK_KEYSTORE_B64 --repo "$REPOSITORY"
import base64
import pathlib
import sys
sys.stdout.write(base64.b64encode(pathlib.Path(sys.argv[1]).read_bytes()).decode("ascii"))
PY
cat "$YTARK_STORE_PASSWORD_FILE" | gh secret set YTARK_KEYSTORE_PASSWORD --repo "$REPOSITORY"
printf '%s' "$YTARK_KEY_ALIAS" | gh secret set YTARK_KEY_ALIAS --repo "$REPOSITORY"
cat "$YTARK_KEY_PASSWORD_FILE" | gh secret set YTARK_KEY_PASSWORD --repo "$REPOSITORY"

echo "Stored the pinned Hearth community signer in YTArk Actions secrets."
echo "This key is intentionally public upstream; caching it in Actions does not make it secret."
