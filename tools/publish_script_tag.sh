#!/usr/bin/env bash
# Publish the generated userscript under an immutable short jsDelivr git tag.
# Only the tag is pushed; this avoids creating or updating a helper branch.
set -euo pipefail

SCRIPT_FILE="${1:?usage: publish_script_tag.sh <path-to-userScript.js>}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${SCRIPT_TAG:?SCRIPT_TAG is required}"
[[ "$SCRIPT_TAG" =~ ^s[0-9]{1,7}$ ]] || { echo "invalid userscript tag: $SCRIPT_TAG" >&2; exit 1; }
[ "${#SCRIPT_TAG}" -le 8 ] || { echo "userscript tag exceeds the APK URL budget" >&2; exit 1; }
[ -s "$SCRIPT_FILE" ] || { echo "userscript bundle is missing or empty" >&2; exit 1; }

REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
RELEASE_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ytark-userscript.XXXXXX")"
trap 'rm -rf "$RELEASE_DIR"' EXIT
cp "$SCRIPT_FILE" "$RELEASE_DIR/userScript.js"

if git ls-remote --exit-code --tags "$REPO_URL" "refs/tags/${SCRIPT_TAG}" >/dev/null 2>&1; then
  # Workflow retries may reuse a tag already pushed by the same release run.
  # Reuse it only if the content is byte-for-byte identical; tags stay immutable.
  git -C "$RELEASE_DIR" init -q
  git -C "$RELEASE_DIR" fetch -q --depth=1 "$REPO_URL" "refs/tags/${SCRIPT_TAG}"
  git -C "$RELEASE_DIR" show FETCH_HEAD:userScript.js > "$RELEASE_DIR/existing-userScript.js"
  if cmp -s "$SCRIPT_FILE" "$RELEASE_DIR/existing-userScript.js"; then
    echo "Immutable userscript tag $SCRIPT_TAG already contains this exact bundle."
    exit 0
  fi
  echo "userscript tag $SCRIPT_TAG exists with different content; release tags cannot be moved" >&2
  exit 1
fi

cat > "$RELEASE_DIR/README.md" <<EOF
# YTArk userscript delivery tag \`${SCRIPT_TAG}\`

This immutable tag serves the release bundle to YTArk's embedded Cobalt browser:
\`https://cdn.jsdelivr.net/gh/${GITHUB_REPOSITORY}@${SCRIPT_TAG}/userScript.js\`

- The bundle is built from the corresponding YTArk repository source.
- The source uses the GPL-3.0-only TizenTube project; see \`TizenTube/LICENSE\`.
- Base Android application attribution: TizenTubeCobalt.
EOF

(
  cd "$RELEASE_DIR"
  git init -q
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git add userScript.js README.md
  git commit -qm "YTArk userscript ${SCRIPT_TAG}"
  git tag "$SCRIPT_TAG"
  git push -q "$REPO_URL" "refs/tags/${SCRIPT_TAG}"
)

echo "Published immutable YTArk userscript tag ${SCRIPT_TAG}."
