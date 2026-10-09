#!/usr/bin/env bash
# create_release.sh — publish the built APKs as a GitHub Release.
#
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, APP_NAME, APP_ID,
#      FULL_VERSION, VERSION_CODE, SCRIPT_TAG, BASE_TAG, SIGNING_MODE_FILE

set -euo pipefail

: "${GH_TOKEN:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_SHA:?}"
: "${FULL_VERSION:?}"
: "${VERSION_CODE:?}"
: "${SCRIPT_TAG:?}"
: "${BASE_TAG:=v2.0.2}"
: "${APP_NAME:=Personal Tube TV}"
: "${APP_ID:=io.github.personal.tubetv}"

TAG="v${FULL_VERSION}"
SCRIPT_URL="https://cdn.jsdelivr.net/gh/${GITHUB_REPOSITORY}@${SCRIPT_TAG}/userScript.js"
SIGNING_MODE="$(cat "${SIGNING_MODE_FILE:-/dev/null}" 2>/dev/null || echo unknown)"

if [ "$SIGNING_MODE" = "ephemeral" ]; then
  SIGNING_NOTE="⚠️ **Ephemeral signing key** — this build was signed with a throwaway key.
Future builds (and any re-run) get a different key: **uninstall before installing a newer build.**
For stable in-place updates, configure the \`ANDROID_KEYSTORE_*\` secrets once (see README)."
else
  SIGNING_NOTE="✅ Signed with the persistent keystore configured in repository secrets —
newer builds install directly over this one."
fi

# Idempotent re-runs: clear a previous release/tag with the same name.
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release delete "$TAG" --yes --cleanup-tag
fi
gh api -X DELETE "repos/${GITHUB_REPOSITORY}/git/refs/tags/${TAG}" >/dev/null 2>&1 || true

cat > NOTICE.md <<EOF
# Provenance & licenses

- Base APK: TizenTubeCobalt ${BASE_TAG} (https://github.com/reisxd/TizenTubeCobalt)
  Cobalt / Chromium / Starboard — Apache-2.0 and BSD-style licenses;
  see https://github.com/reisxd/TizenTubeCobalt/blob/${BASE_TAG}/LICENSE and
  the Chromium LICENSE files in that repository.
- Userscript: modified TizenTube (GPL-3.0-only).
  Complete corresponding source: this repository (${GITHUB_REPOSITORY}),
  patch at personal-tv.patch, full tree under TizenTube/.
  Userscript served from: ${SCRIPT_URL}
- Modifications: TV Quick Controls (presets, themes, quality, undo),
  updater disabled, distinct application id (\`${APP_ID}\`) and label
  (\`${APP_NAME}\`) so it installs alongside the official app.
EOF

cat > release-notes.md <<EOF
# ${APP_NAME} ${FULL_VERSION}

Personalized TizenTubeCobalt build with the custom TV Quick Controls userscript.

| | |
|---|---|
| Base | TizenTubeCobalt \`${BASE_TAG}\` |
| App ID | \`${APP_ID}\` (installs **alongside** the official app) |
| Version | ${FULL_VERSION} (versionCode ${VERSION_CODE}) |
| Userscript | \`${SCRIPT_URL}\` |
| ABIs | armeabi-v7a + arm64-v8a |

## Install (Android TV / Google TV)

1. Download the APK for your device — **arm64-v8a** for Google TV 4K /
   Chromecast with Google TV and most modern boxes; **armeabi-v7a** for
   older 32-bit devices.
2. Sideload it (Downloader by AFTVnews, \`adb install\`, or a file manager).
3. Open it and sign in as usual.

## What's inside

- 🎛️ **TV Quick Controls** — first item in the in-app settings
  - Presets: **Clean TV** (hides Shorts, previews, end cards, related),
    **Midnight Blue**, **Classic Dark**
  - One-level **Undo** for the last preset
  - **Quick Quality**: Auto / 2160p / 1440p / 1080p / 720p (with
    largest-below-target fallback)
- 🚫 **Upstream updater disabled** (it would try to install the official
  APK over this one)
- 🛡️ Resilient config storage (corrupt/failed writes fall back safely)
- Everything else from upstream TizenTubeCobalt ${BASE_TAG}
  (ad block, SponsorBlock, DeArrow, speed control, themes, casting)

## Signing

${SIGNING_NOTE}

## Checksums

See \`SHA256SUMS.txt\`. Base APK checksums are in \`base-apk-sha256.txt\`.

## Source (GPL-3.0)

The userscript is GPL-3.0; complete corresponding source is this
repository — including \`personal-tv.patch\` against pinned upstream
TizenTube 9dd70a7 and the full modified tree under \`TizenTube/\`.
EOF

gh release create "$TAG" \
  --target "$GITHUB_SHA" \
  --title "${APP_NAME} ${FULL_VERSION}" \
  --notes-file release-notes.md \
  work/personal-tubetv-*.apk \
  work/userScript.js \
  SHA256SUMS.txt \
  base-apk-sha256.txt \
  NOTICE.md

echo "release created: ${TAG}"
