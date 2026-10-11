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

- **Maintenance and UX release on TizenTubeCobalt `${BASE_TAG}`.** YTArk 2.2 keeps the
  2.1.2 runtime and the TizenTubeCobalt v2.0.2 ARMv7 base. It is not a newer
  Cobalt engine, not a newer YouTube client, and not an official YouTube upgrade.
- **SponsorBlock lookups are bounded.** Segment lookups have a real deadline that
  covers both the response and the body. Malformed numbers, reversed ranges and
  late responses are discarded, so they cannot change the video that is playing.
- **YTArk Updates card.** Settings → YTArk Updates shows the installed version,
  the latest stable release, and a plain status (checking, up to date, update
  available, or couldn't check). When this build cannot install updates itself,
  it shows the official release page with a QR code. Install by downloading the
  ARMv7 APK from that page.
- **Premium wordmark (cosmetic).** The header uses the bundled vector artwork and
  follows the light and dark theme. It is a cosmetic preference, not a
  subscription, and it grants no Premium entitlement.
- **ARMv7-only releases.** This version publishes exactly one APK: 32-bit ARM
  `armeabi-v7a`. There is no ARM64 or universal asset. The updater checks
  Android's supported ABI list before offering a download.
- **Clearer unsupported-device message.** A 64-bit CPU by itself does not mean
  the Android userspace runs 32-bit native code, so the app reports the ABI check
  result instead of failing later at install time.
- **Native updater status.** The native updater code (PackageInstaller hand-off
  with user confirmation) is bundled in this APK. Its device path is **not yet
  verified** for this release, so these notes do not claim automatic prompts.
  Installs are always user-confirmed; YTArk never installs silently.

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

## Update checks and installs

Settings → YTArk Updates checks the official stable release metadata over HTTPS.
Installs are user-confirmed only. The bundled native updater's own prompt and
PackageInstaller path are **pending device verification** for this release (see
the runtime status above). Until that is recorded, use the official release page.

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
