#!/usr/bin/env bash
# publish_script_tag.sh — publish the built userscript to a jsDelivr-servable git tag.
#
# jsDelivr serves files from public GitHub repos:  https://cdn.jsdelivr.net/gh/<owner>/<repo>@<tag>/<file>
# The patched APK loads https://cdn.jsdelivr.net/gh/<repo>@<tag>/userScript.js?v=<timestamp>
# (cdn.jsdelivr.net is already in the APK's CSP allowlist, so no CSP patching is needed).
#
# Usage: publish_script_tag.sh <path-to-userScript.js>
# Env:   GH_TOKEN, GITHUB_REPOSITORY, SCRIPT_TAG (e.g. s42)

set -euo pipefail

SCRIPT_FILE="${1:?usage: publish_script_tag.sh <userScript.js>}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${SCRIPT_TAG:?SCRIPT_TAG is required}"

# The tag name is baked into the APK (byte-length budget ~8 chars).
if [ "${#SCRIPT_TAG}" -gt 8 ]; then
  echo "ERROR: SCRIPT_TAG '${SCRIPT_TAG}' is longer than 8 chars and will not fit in the patched URL literal." >&2
  exit 1
fi

REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
RELEASE_DIR="$(mktemp -d)"
BRANCH="script-releases"

cp "$SCRIPT_FILE" "${RELEASE_DIR}/userScript.js"

# License + provenance for the minified bundle (GPL-3.0 corresponding source
# is this repository itself).
cat > "${RELEASE_DIR}/README.md" <<EOF
# Userscript delivery tag \`${SCRIPT_TAG}\`

This tag exists so the Personal Tube TV APK can load its userscript from
jsDelivr: \`https://cdn.jsdelivr.net/gh/${GITHUB_REPOSITORY}@${SCRIPT_TAG}/userScript.js\`

- \`userScript.js\` is the minified build of the TizenTube modifications
  (GPL-3.0) from the main branch of this repository at build time.
- Corresponding source: the repository you are looking at.
- Base project: https://github.com/reisxd/TizenTube (GPL-3.0)
EOF

cd "$RELEASE_DIR"
git init -q
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add userScript.js README.md
git commit -qm "Userscript release ${SCRIPT_TAG} ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
git tag "$SCRIPT_TAG"

# The tag is unique per run (no cache issues). The branch is force-moved to the
# latest script commit as a human-friendly pointer (each commit is an orphan).
git push -q --force "$REPO_URL" "HEAD:refs/heads/${BRANCH}" "refs/tags/${SCRIPT_TAG}"

echo "published ${SCRIPT_TAG}: https://cdn.jsdelivr.net/gh/${GITHUB_REPOSITORY}@${SCRIPT_TAG}/userScript.js"
