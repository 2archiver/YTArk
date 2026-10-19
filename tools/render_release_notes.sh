#!/usr/bin/env bash
# Render the YTArk release notes and NOTICE.md for the configured release.
#
# This helper only writes files (NOTICE.md, release-assets/NOTICE.md and
# release-notes.md). Creating, resuming or promoting the GitHub Release is done
# by tools/publish_release.py, which needs to inspect the existing release
# state before it decides what to do.
set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${VERSION_NAME:?VERSION_NAME is required}"
: "${DISPLAY_VERSION:?DISPLAY_VERSION is required}"
: "${VERSION_CODE:?VERSION_CODE is required}"
: "${VERSION_TAG:?VERSION_TAG is required}"
: "${SCRIPT_TAG:?SCRIPT_TAG is required}"
: "${BASE_TAG:?BASE_TAG is required}"
: "${APP_ID:=io.github.twoarchiver.ytark}"
: "${APP_NAME:=YTArk}"
: "${APK_ARMV7:?APK_ARMV7 is required}"
: "${SIGNING_CERT_SHA256:?SIGNING_CERT_SHA256 is required}"

[ "$APP_NAME" = "YTArk" ] || { echo "application label must be YTArk" >&2; exit 1; }
RELEASE_TITLE="YTArk ${DISPLAY_VERSION}"

# "What changed" comes from CHANGELOG.md, the single changelog source that also
# feeds the in-app reader, so the release notes cannot drift from it.
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHAT_CHANGED="$(python3 "$SCRIPT_ROOT/tools/build_changelog.py" release-notes --version "$VERSION_NAME")" || {
  echo "CHANGELOG.md has no valid entry for $VERSION_NAME" >&2; exit 1;
}
[ -n "$WHAT_CHANGED" ] || { echo "CHANGELOG.md has no entry for $VERSION_NAME" >&2; exit 1; }
for apk in "$APK_ARMV7"; do
  [ -f "release-assets/$apk" ] || {
    echo "the validated architecture-specific APK release asset is missing: $apk" >&2; exit 1;
  }
done

mkdir -p release-assets

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
  YouTube, Google, TizenTube, or TizenTubeCobalt.
- Cosmetic header wordmark: "YouTube Premium logo 2024.svg" from Wikimedia
  Commons (https://commons.wikimedia.org/wiki/File:YouTube_Premium_logo_2024.svg,
  author: Google, Inc., retrieved 2026-10-11, revision SHA-1
  9ec3ad62f293d10e98cb637d0303a7e7e4188947, bundled sanitized SHA-256
  e2ba301c01340c2cc0163447a388d9f578c7ae1e8b434c1ebcfe8ad263c00ecf).
  The file is public domain on Commons ({{PD-simple}} / {{PD-text}}: simple
  geometry and non-copyrightable lettering). YouTube and YouTube Premium are
  trademarks of Google LLC; the mark is drawn locally as a cosmetic header
  preference, grants no entitlement, and implies no affiliation or endorsement.
  The vector is bundled inside \`userScript.js\`; no device requests it from
  Wikimedia or from any other external image host.
EOF

cat > release-notes.md <<EOF
YTArk ${DISPLAY_VERSION}

${WHAT_CHANGED}

ARMv7 (armeabi-v7a): [Download APK](https://github.com/${GITHUB_REPOSITORY}/releases/download/${VERSION_TAG}/${APK_ARMV7}). Not for arm64-v8a-only devices; a 64-bit CPU alone is insufficient. 4K does not select an APK architecture.

Install over the existing app; data is preserved. From 3.7.0, install manually once.
Notices and licenses: https://github.com/${GITHUB_REPOSITORY}/blob/main/NOTICE.md

Known limitations: TV permission, startup, upgrade and playback checks remain unverified; the engine is unchanged.

<!-- Package ${APP_ID}; ${VERSION_NAME}; versionCode ${VERSION_CODE}; base TizenTubeCobalt ${BASE_TAG}. -->
EOF
cp NOTICE.md release-assets/NOTICE.md
