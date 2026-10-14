#!/usr/bin/env bash
# Read-only PR candidate path. Reuses production compilation, repack, sign and
# validation tools, but cannot publish a release/tag and never reads secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
: "${ANDROID_HOME:?Android SDK required}"
: "${RUNNER_TEMP:?Runner workspace required}"
export PATH="$ANDROID_HOME/build-tools/34.0.0:$PATH"
python3 tools/validate_release.py emit-env --file "$RUNNER_TEMP/review-version.env"
while IFS= read -r entry; do export "$entry"; done < "$RUNNER_TEMP/review-version.env"
export SCRIPT_URL="https://cdn.jsdelivr.net/gh/2archiver/YTArk@${SCRIPT_TAG}/userScript.js?v="
mkdir -p "$RUNNER_TEMP/review-metadata" work release-assets update-smoke
# Save one complete metadata snapshot; never infer shipped versionCodes from names alone.
gh api repos/2archiver/YTArk/releases/latest > "$RUNNER_TEMP/review-metadata/latest.json"
gh api --paginate --slurp 'repos/2archiver/YTArk/releases?per_page=100' > "$RUNNER_TEMP/review-metadata/releases.json"
python3 tools/validate_release.py check-version --latest-json "$RUNNER_TEMP/review-metadata/latest.json" --releases-json "$RUNNER_TEMP/review-metadata/releases.json"
gh api "repos/reisxd/TizenTubeCobalt/releases/tags/$BASE_TAG" > "$RUNNER_TEMP/review-metadata/base.json"
python3 tools/fetch_base_apks.py --release-json "$RUNNER_TEMP/review-metadata/base.json" --base-tag "$BASE_TAG" --output-dir base --checksums-out base-apk-sha256.txt
# The repository explicitly pins an intentionally public community signer.
# Read no secret context; verify both immutable blob and certificate before use.
GITHUB_ENV="$RUNNER_TEMP/review-signing.env" bash tools/prepare_signing_key.sh
while IFS= read -r entry; do export "$entry"; done < "$RUNNER_TEMP/review-signing.env"
curl -fsSL --retry 3 https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar -o "$RUNNER_TEMP/apktool.jar"
echo "dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423  $RUNNER_TEMP/apktool.jar" | sha256sum -c -
python3 tools/repack_apk.py --base base/cobalt-arm.apk --architecture armv7 \
  --out "work/${APK_ARMV7%.apk}-unsigned.apk" --updater-dex "$RUNNER_TEMP/ytark-updater/classes.dex" \
  --app-name "$APP_NAME" --app-id "$APP_ID" --script-url "$SCRIPT_URL" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --apktool "java -jar $RUNNER_TEMP/apktool.jar" --zipalign "$ANDROID_HOME/build-tools/34.0.0/zipalign"
export YTARK_EXPECTED_CERT_SHA256="$SIGNING_CERT_SHA256"
bash tools/sign_apks.sh work
cp "work/$APK_ARMV7" "release-assets/$APK_ARMV7"
zipalign -c -p 4 "release-assets/$APK_ARMV7"
python3 tools/validate_release.py check-apk --apk "release-assets/$APK_ARMV7" --architecture armv7 --cert-file signing/YTArk-cert-sha256.txt --aapt "$ANDROID_HOME/build-tools/34.0.0/aapt" --apksigner "$ANDROID_HOME/build-tools/34.0.0/apksigner"
aapt dump xmltree "release-assets/$APK_ARMV7" AndroidManifest.xml > release-assets/compiled-manifest.txt
cp TizenTube/dist/userScript.js release-assets/userScript.js
cp base-apk-sha256.txt release-assets/base-apk-sha256.txt
(cd release-assets && sha256sum "$APK_ARMV7" userScript.js > SHA256SUMS.txt)
python3 tools/validate_release.py check-checksums --checksums release-assets/SHA256SUMS.txt --armv7 "release-assets/$APK_ARMV7" --user-script release-assets/userScript.js
python3 tools/prepare_update_smoke.py --latest-json "$RUNNER_TEMP/review-metadata/latest.json" --architecture armv7 --artifact-dir update-smoke --output update-smoke/eligibility.properties --cert-file signing/YTArk-cert-sha256.txt --aapt "$ANDROID_HOME/build-tools/34.0.0/aapt" --apksigner "$ANDROID_HOME/build-tools/34.0.0/apksigner"
cat update-smoke/eligibility.properties
printf 'Commit: %s\nRun: %s\nStatic package checks only; not device evidence.\n' "$(git rev-parse HEAD)" "$GITHUB_RUN_ID" > release-assets/review-build.txt
echo "Signed ARMv7 review candidate verified; no tags or release were written."
