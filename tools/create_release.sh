#!/usr/bin/env bash
# Create a draft YTArk release. Publication is a separate, manually reviewed step.
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
: "${APK_ARMV7:?APK_ARMV7 is required}"
: "${APK_ARM64:?APK_ARM64 is required}"
: "${SIGNING_CERT_SHA256:?SIGNING_CERT_SHA256 is required}"

[ "$APP_NAME" = "YTArk" ] || { echo "release title must be YTArk" >&2; exit 1; }
for apk in "$APK_ARMV7" "$APK_ARM64"; do
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
EOF

cat > release-notes.md <<EOF
# YTArk ${VERSION_NAME}

An independent Android TV / Google TV build based on TizenTubeCobalt ${BASE_TAG}.
The package retains YouTube's TV frontend and Cobalt player; these APKs have
passed source, packaging, compiled-manifest, ABI, checksum, alignment and
signer checks. Physical TV installation and playback are not claimed unless
separately recorded on a named device.

| | |
|---|---|
| Release | \`${VERSION_TAG}\` |
| Android package | \`${APP_ID}\` |
| Version | ${VERSION_NAME} (versionCode ${VERSION_CODE}) |
| Release signing certificate | SHA-256 \`${SIGNING_CERT_SHA256}\` |
| ARMv7 APK | \`${APK_ARMV7}\` (armeabi-v7a) |
| ARM64 APK | \`${APK_ARM64}\` (arm64-v8a) |
| Upstream base | TizenTubeCobalt \`${BASE_TAG}\` |

## Choose and install the APK

Use the APK matching the Android userspace ABI reported by the device: use the
ARMv7 build for 32-bit \`armeabi-v7a\` userspace, and use ARM64 when
\`arm64-v8a\` is supported. **4K does not select an APK architecture.** A
Google TV model name, resolution, or spoofed YouTube user-agent is not an ABI
probe. Collect model/ABI/API data with the commands in the YTArk README.

Download exactly one matching versioned APK above, copy it to Google TV (USB or
a trusted local transfer tool), open it with a file manager, and approve the
Android installer. Unknown-app installation permission remains a manual Android
Settings approval. For updates, use the YTArk update screen or install the same
package/signer build over the existing app; do not uninstall as a default
troubleshooting step.

## Automatic update prompts

YTArk checks the official stable GitHub release metadata when the Android app
starts and periodically while it runs. The native updater chooses an APK from
Android's supported ABI list, verifies the exact official URL, versioned
filename, size, SHA-256, package, native library ABI, and pinned certificate,
then opens Android's standard PackageInstaller. The user must choose **Install
Update** and approve Android's confirmation. YTArk never installs silently and
does not grant unknown-app permission automatically.

An in-place update requires the same package ID and signing certificate. This
repository intentionally uses Hearth's public community signing key: certificate
continuity does not prove publisher identity. Install only release assets from
the official YTArk repository. This release does not perform automatic migration from a 32-bit installation
to a 64-bit APK. The updater reads the native ABI embedded in the installed
YTArk APK, confirms Android still supports it, and selects a same-ABI asset.

## Integrity and source

Verify both APK choices independently against \`SHA256SUMS.txt\`. The release also
includes both pinned TizenTubeCobalt base checksums, the exact userscript bundle,
and \`NOTICE.md\`. Source and upstream attribution: https://github.com/${GITHUB_REPOSITORY}
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
    --title "$APP_NAME" \
    --notes-file release-notes.md \
    "release-assets/$APK_ARMV7" \
    "release-assets/$APK_ARM64" \
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
echo "Created draft release $VERSION_TAG with both ARMv7 and ARM64 candidates."
echo "Do not publish until device installation, launch, navigation, playback, and same-ABI update acceptance tests are recorded."
