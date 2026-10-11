#!/usr/bin/env bash
# Create the validation-gated YTArk ARMv7 candidate release; stable promotion is separate.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
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
for apk in "$APK_ARMV7"; do
  [ -f "release-assets/$apk" ] || {
    echo "the validated architecture-specific APK release asset is missing: $apk" >&2; exit 1;
  }
done

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
# YTArk ${DISPLAY_VERSION}

An independent Android TV / Google TV build based on TizenTubeCobalt ${BASE_TAG}.
The package retains YouTube's TV frontend and Cobalt player; this APK has passed
source, packaging, compiled-manifest, ABI, checksum, alignment and signer checks.
Physical TV installation and playback are not claimed unless separately recorded
on a named device.

| | |
|---|---|
| Release | \`${VERSION_TAG}\` |
| Android package | \`${APP_ID}\` |
| Version | ${DISPLAY_VERSION} (${VERSION_NAME}; versionCode ${VERSION_CODE}) |
| Release signing certificate | SHA-256 \`${SIGNING_CERT_SHA256}\` |
| APK (only architecture) | \`${APK_ARMV7}\` (armeabi-v7a) |
| Architectures published | **ARMv7 (\`armeabi-v7a\`) only** — no \`arm64-v8a\` asset |
| Upstream base | TizenTubeCobalt \`${BASE_TAG}\` |

## What changed in this release

- **The Premium wordmark is now the real vector artwork.** The previous release
  drew the lettering with the frontend font as an approximation. This build
  bundles the exact 2024 YouTube Premium lockup from Wikimedia Commons — the
  original \`viewBox\` (101×20), the red play emblem, its white triangle and all
  seven lettering paths are used byte-for-byte as path geometry. Nothing is
  retyped, no font is substituted, no raster preview is used, and no runtime
  request is made for the asset: the geometry ships inside \`userScript.js\`.
  Provenance, retrieval date, revision SHA-1 and the bundled SHA-256 are recorded
  in \`TizenTube/mods/assets/youtube-premium-logo-2024.provenance.json\` and in
  \`NOTICE.md\`.
- **Dark and light headers are handled correctly.** The emblem keeps its literal
  source paint in both themes (the red stays red, the triangle stays white) and
  only the lettering follows the native header foreground, resolved from the live
  Leanback header colour on first mount and on theme changes. The stylesheet
  applies no filter and no inversion, the background stays transparent, and the
  artwork scales as vector geometry at 720p, 1080p and 4K.
- **The cosmetic toggle still restores the stock header exactly.** The setting
  keeps its saved preference, mounting stays idempotent, and turning it off
  restores the native artwork byte-for-byte.
- **ARMv7-only releases.** From this version YTArk builds, signs, verifies and
  publishes exactly one APK: 32-bit ARM \`armeabi-v7a\`. The ARM64 job, its
  download, its release asset and the ARM64 documentation were removed from the
  active pipeline; historical releases keep their assets untouched. The updater
  selects the ARMv7 asset by name and metadata (never by asset order), refuses
  the legacy ARM64 asset, and checks Android's supported ABI list before any
  download.
- **Clearer unsupported-device message.** Android systems that accept only
  64-bit applications cannot install these releases. A 64-bit CPU by itself does
  not mean the Android userspace runs 32-bit native code, so the app reports the
  ABI check result (\`ro.product.cpu.abilist\`) instead of failing later at
  install time.
- **Settings → YTArk Updates keeps its real states** — installed version,
  checking, up to date, available update with size and notes, download progress,
  verification, installer hand-off, cancellation and actionable failures — and a
  failed check is never displayed as "up to date".

## Choose and install the APK

Exactly one APK is published: \`${APK_ARMV7}\` for 32-bit \`armeabi-v7a\`
userspace. **4K does not select an APK architecture**, and neither does the
device name, the Android version or a spoofed YouTube user-agent. A 64-bit
CPU does not by itself establish whether the OS supports 32-bit applications:
check \`ro.product.cpu.abilist\` (or the equivalent ABI list from a device
diagnostic tool) and install only when \`armeabi-v7a\` is reported. On a system
whose ABI list contains only \`arm64-v8a\`, x86 or another 64-bit ABI, this
ARMv7-only release is **not installable** — installing is not expected to work
and no renamed or stripped APK should be used instead.

Download the versioned APK above, copy it to Google TV (USB or a trusted local
transfer tool), open it with a file manager, and approve the Android installer.
Unknown-app installation permission remains a manual Android Settings approval.
For updates, use the YTArk update screen or install the same package/signer
build over the existing app; do not uninstall as a default troubleshooting step.
App data, cookies and the Google session are preserved by an in-place update.

## Automatic update prompts

YTArk checks the official stable GitHub release metadata over HTTPS when the
Android app starts and every six hours while it runs; the update screen
discloses this and **Later** snoozes prompts for 24 hours. The native updater
reads the ABI embedded in the installed APK, confirms Android still supports it,
selects the ARMv7 asset from the validated file name and metadata (never from
asset order), verifies the exact official URL, size, SHA-256, package identity,
native library ABI and pinned certificate, and then opens Android's standard
PackageInstaller. The user must choose **Install Update** and approve Android's
confirmation. YTArk never installs silently and does not grant unknown-app
permission automatically. Cancelling the installer is recoverable.

An in-place update requires the same package ID and signing certificate. This
repository intentionally uses Hearth's public community signing key: certificate
continuity does not prove publisher identity. Install only release assets from
the official YTArk repository. An installation that was updated from an older
dual-ABI release whose native code is \`arm64-v8a\` receives no automatic
update — cross-ABI migration is unsupported and the app reports it instead.

## Upstream YouTube runtime

The YouTube TV frontend and the Cobalt player come from the pinned
TizenTubeCobalt ${BASE_TAG} base and the frontend is delivered by YouTube's own
service, so no bundled frontend version is advertised. TizenTubeCobalt
${BASE_TAG} is also the newest stable release of that project, so this version
keeps the known-working upstream base instead of adopting an unverified one.

## Privacy

YTArk adds no analytics, telemetry, or crash reporting and never reads or logs
Google account identifiers, cookies, or OAuth tokens — sign-in stays in the
stock YouTube TV stack between your TV and Google. SponsorBlock lookups send
only hashed video-ID prefixes; update checks reach api.github.com over HTTPS.
Full disclosure: \`docs/PRIVACY.md\` in the source repository.

## Integrity and source

Verify the APK against \`SHA256SUMS.txt\`. The release also includes the pinned
TizenTubeCobalt base checksum, the exact userscript bundle, and \`NOTICE.md\`.
Source and upstream attribution: https://github.com/${GITHUB_REPOSITORY}
and TizenTubeCobalt ${BASE_TAG}.
EOF
cp NOTICE.md release-assets/NOTICE.md

REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
EXISTING_RELEASES_JSON="$(mktemp "${RUNNER_TEMP:-/tmp}/ytark-existing-releases.XXXXXX.json")"
gh api "repos/$GITHUB_REPOSITORY/releases?per_page=100" > "$EXISTING_RELEASES_JSON"
EXISTING_IDS="$(python3 - "$EXISTING_RELEASES_JSON" "$VERSION_TAG" <<'PYRELEASE'
import json
import sys

path, tag = sys.argv[1:]
with open(path, encoding="utf-8") as stream:
    releases = json.load(stream)
for release in releases:
    if release.get("tag_name") == tag:
        if not release.get("draft"):
            raise SystemExit(f"Refusing to replace already-published stable release {tag}")
        print(release.get("id", ""))
PYRELEASE
)"
rm -f "$EXISTING_RELEASES_JSON"
for rel_id in $EXISTING_IDS; do
  if [ -n "$rel_id" ]; then
    gh api --method DELETE "repos/$GITHUB_REPOSITORY/releases/$rel_id"
    echo "Removed existing draft $rel_id for $VERSION_TAG before creating a new draft."
  fi
done

publish_clean_release_tag() {
  local tag_dir
  tag_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ytark-release-tag.XXXXXX")"
  cp NOTICE.md release-notes.md "$tag_dir/"
  (
    cd "$tag_dir"
    git init -q
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add NOTICE.md release-notes.md
    git commit -qm "YTArk release ${VERSION_TAG} (${GITHUB_SHA})"
    git tag "$VERSION_TAG"
    git push -q --force "$REPO_URL" "refs/tags/${VERSION_TAG}"
  )
  rm -rf "$tag_dir"
  echo "Published release tag $VERSION_TAG."
}

create_draft_release() {
  local target_args=("$@")
  gh release create "$VERSION_TAG" \
    --repo "$GITHUB_REPOSITORY" \
    "${target_args[@]}" \
    --draft \
    --title "$RELEASE_TITLE" \
    --notes-file release-notes.md \
    "release-assets/$APK_ARMV7" \
    release-assets/userScript.js \
    release-assets/SHA256SUMS.txt \
    release-assets/base-apk-sha256.txt \
    release-assets/NOTICE.md
}

if git ls-remote --exit-code --tags "$REPO_URL" "refs/tags/$VERSION_TAG" >/dev/null 2>&1; then
  if ! create_draft_release; then
    echo "Existing tag $VERSION_TAG could not be used directly; refreshing release tag."
    publish_clean_release_tag
    create_draft_release
  fi
else
  if ! create_draft_release --target "$GITHUB_SHA"; then
    echo "Direct commit target requires elevated workflow permissions; publishing clean release tag $VERSION_TAG."
    publish_clean_release_tag
    create_draft_release
  fi
fi
echo "Created draft release $VERSION_TAG with the single ARMv7 candidate."
echo "Do not publish until device installation, launch, navigation, playback, and same-ABI update acceptance tests are recorded."
