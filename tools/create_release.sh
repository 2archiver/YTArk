#!/usr/bin/env bash
# Create a draft YTArk release. CI validates its metadata and assets before publishing.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${VERSION_NAME:?VERSION_NAME is required}"
: "${VERSION_CODE:?VERSION_CODE is required}"
: "${VERSION_TAG:?VERSION_TAG is required}"
: "${SCRIPT_TAG:?SCRIPT_TAG is required}"
: "${BASE_TAG:?BASE_TAG is required}"
: "${APP_ID:=io.github.twoarchiver.ytark}"
: "${APP_NAME:=YTArk}"
: "${APK_ARM64:?APK_ARM64 is required}"
: "${SIGNING_CERT_SHA256:?SIGNING_CERT_SHA256 is required}"

[ "$APP_NAME" = "YTArk" ] || { echo "release title must be YTArk" >&2; exit 1; }
[ -f "release-assets/$APK_ARM64" ] || {
  echo "the validated Google TV ARM64 APK release asset is missing" >&2; exit 1;
}

cat > NOTICE.md <<EOF
# YTArk notices and provenance

- Android base application: TizenTubeCobalt ${BASE_TAG} from
  https://github.com/reisxd/TizenTubeCobalt. Cobalt/Chromium components include
  Apache-2.0 and BSD-style licensed code; consult the upstream notices and
  license files for their respective terms.
- YTArk userscript: based on TizenTube (GPL-3.0-only). The complete corresponding
  source and local modifications are included in this repository under
  \`TizenTube/\`; the exact bundled script is attached as \`userScript.js\`.
- Project-specific native updater, release tooling, and TV controls are part of
  YTArk. The base-project attribution is retained; YTArk is not affiliated with
  YouTube, Google, TizenTube or TizenTubeCobalt.
EOF

cat > release-notes.md <<EOF
# YTArk ${VERSION_NAME}

A standalone Android TV / Google TV release built from TizenTubeCobalt ${BASE_TAG}.

| | |
|---|---|
| Release | \`${VERSION_TAG}\` |
| Android package | \`${APP_ID}\` |
| Version | ${VERSION_NAME} (versionCode ${VERSION_CODE}) |
| Release signing certificate | SHA-256 \`${SIGNING_CERT_SHA256}\` |
| Google TV OS 14 / 4K ARM64 | \`${APK_ARM64}\` (arm64-v8a) |
| Upstream base | TizenTubeCobalt \`${BASE_TAG}\` |

## Automatic updates

YTArk checks the official stable YTArk releases when the app starts and every six
hours while its process is running. On Google TV, the update notification offers
**Update Now**, **Later**, and **Check for Updates**. The native updater chooses the
64-bit ARM APK, checks the release SHA-256, package ID, version, ABI and pinned
signing certificate, and then opens Android's standard package installer.

The install is never silent. Select **Install Update** in YTArk, then review and
confirm the Android installer prompt. If Android asks for permission to install
unknown apps, allow YTArk in **Settings → Apps → Special app access → Install
unknown apps**, then return to the updater. The downloaded APK stays in private
app storage and an interrupted download can be resumed.

Updates signed by this release key and using the same package ID install in place;
Android preserves YTArk settings and app data. This release uses the same
intentionally public Hearth community signing certificate shown above, pinning
the permanent YTArk signing identity. Anyone can build with that community key;
use only official YTArk releases. If the earlier app uses a different package
ID, install this release as a new app; Android does not transfer private data
between package IDs. If an earlier build already uses this package ID but a
different temporary signing key, Android requires uninstalling that build first,
which removes its private data. Subsequent YTArk releases signed with this
certificate can update in place.

## YTArk Quick Controls

**YTArk Quick Controls** are the first item in YTArk settings: presets, one-level
undo, quick quality selection, and TV-focused visibility controls.

## Integrity and source

Verify the attached APK against \`SHA256SUMS.txt\`. The release also includes the
exact userscript bundle, base APK checksums, and \`NOTICE.md\`. Source and upstream
attribution: https://github.com/${GITHUB_REPOSITORY} and TizenTubeCobalt ${BASE_TAG}.
EOF
cp NOTICE.md release-assets/NOTICE.md

RELEASE_JSON="${RUNNER_TEMP:-/tmp}/ytark-existing-release-${VERSION_TAG}.json"
RELEASE_ENDPOINT="repos/$GITHUB_REPOSITORY/releases/tags/$VERSION_TAG"
if gh api "$RELEASE_ENDPOINT" > "$RELEASE_JSON" 2>/dev/null; then
  python3 - "$RELEASE_JSON" "$VERSION_TAG" <<'PY'
import json, sys
path, expected_tag = sys.argv[1:]
release = json.load(open(path, encoding="utf-8"))
if release.get("tag_name") != expected_tag:
    raise SystemExit("Existing release tag metadata does not match this build.")
if not release.get("draft") or release.get("prerelease"):
    raise SystemExit("Refusing to alter an existing published or prerelease release.")
PY
  git fetch --quiet --depth=1 origin "refs/tags/$VERSION_TAG:refs/tags/$VERSION_TAG"
  EXISTING_TAG_COMMIT="$(git rev-parse "${VERSION_TAG}^{commit}")"
  if [ "$EXISTING_TAG_COMMIT" != "$GITHUB_SHA" ]; then
    echo "Existing draft tag points to a different commit; refusing to replace it." >&2
    exit 1
  fi
  gh release edit "$VERSION_TAG" --repo "$GITHUB_REPOSITORY" \
    --draft --title "$APP_NAME" --notes-file release-notes.md
  gh release upload "$VERSION_TAG" --repo "$GITHUB_REPOSITORY" --clobber \
    "release-assets/$APK_ARM64" \
    release-assets/userScript.js \
    release-assets/SHA256SUMS.txt \
    release-assets/base-apk-sha256.txt \
    release-assets/NOTICE.md
  echo "Refreshed the existing draft release $VERSION_TAG for the same commit."
else
  if git ls-remote --exit-code --tags origin "refs/tags/$VERSION_TAG" >/dev/null 2>&1; then
    echo "Git tag $VERSION_TAG exists without a draft release; refusing to infer its target." >&2
    exit 1
  fi
  gh release create "$VERSION_TAG" \
    --repo "$GITHUB_REPOSITORY" \
    --target "$GITHUB_SHA" \
    --draft \
    --title "$APP_NAME" \
    --notes-file release-notes.md \
    "release-assets/$APK_ARM64" \
    release-assets/userScript.js \
    release-assets/SHA256SUMS.txt \
    release-assets/base-apk-sha256.txt \
    release-assets/NOTICE.md
  echo "Created draft release $VERSION_TAG."
fi

echo "Draft release $VERSION_TAG must pass metadata and update validation before publication."
