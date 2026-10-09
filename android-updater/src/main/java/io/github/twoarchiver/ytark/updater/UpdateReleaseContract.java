package io.github.twoarchiver.ytark.updater;

import java.io.IOException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared parser for the public GitHub Release metadata consumed by YTArk's updater.
 * Keep this contract in plain Java so CI can test it without an Android runtime.
 */
final class UpdateReleaseContract {
    private static final String RELEASE_ASSET_PREFIX =
            "https://github.com/2archiver/YTArk/releases/download/";
    private static final Pattern VERSION_CODE = Pattern.compile(
            "(?i)version\\s*code\\s*[:=]?\\s*(\\d+)");
    private static final Pattern YTARK_VERSION = Pattern.compile(
            "^\\d+\\.\\d+\\.\\d+-ytark\\.[1-9]\\d*$");

    private UpdateReleaseContract() { }

    static long expectedVersionCodeForVersion(String version) throws IOException {
        if (version == null) throw new IOException("The YTArk release version is missing.");
        Matcher matcher = YTARK_VERSION.matcher(version);
        if (!matcher.matches()) throw new IOException("The YTArk release version is invalid.");
        int marker = version.lastIndexOf('.');
        try {
            return 20000L + Long.parseLong(version.substring(marker + 1));
        } catch (NumberFormatException invalid) {
            throw new IOException("The YTArk release serial is invalid.", invalid);
        }
    }

    static String assetNameForVersion(String version, String architectureSuffix) throws IOException {
        if (version == null || !YTARK_VERSION.matcher(version).matches()) {
            throw new IOException("The YTArk release version is invalid.");
        }
        // Validate against the exact mapping. Never accept a path, ABI alias, or
        // arbitrary caller-provided suffix as part of a release asset name.
        NativeAbiContract.nativeAbiForSuffix(architectureSuffix);
        return "YTArk-v" + version + "-" + architectureSuffix + ".apk";
    }

    static String requireOfficialAssetUrl(String url, String tag, String assetName)
            throws IOException {
        if (tag == null || !tag.matches("v\\d+\\.\\d+\\.\\d+-ytark\\.[1-9]\\d*")) {
            throw new IOException("The YTArk release tag is invalid.");
        }
        if (assetName == null || !(assetName.matches("YTArk-v\\d+\\.\\d+\\.\\d+-ytark\\.[1-9]\\d*-(?:arm64|armv7)\\.apk")
                || "SHA256SUMS.txt".equals(assetName))) {
            throw new IOException("A release asset has an invalid YTArk filename.");
        }
        if (assetName.startsWith("YTArk-v") && !assetName.startsWith("YTArk-" + tag + "-")) {
            throw new IOException("The YTArk asset version does not match its release tag.");
        }
        String expectedUrl = RELEASE_ASSET_PREFIX + tag + "/" + assetName;
        if (url == null || !expectedUrl.equals(url)) {
            throw new IOException("A release asset URL does not match the official YTArk release metadata.");
        }
        return url;
    }

    static long parseVersionCode(String body) throws IOException {
        Matcher matcher = VERSION_CODE.matcher(body == null ? "" : body);
        if (!matcher.find()) throw new IOException("The release is missing its versionCode metadata.");
        try {
            return Long.parseLong(matcher.group(1));
        } catch (NumberFormatException invalid) {
            throw new IOException("The release versionCode is invalid.", invalid);
        }
    }

    static String parseSha256Digest(String digest) {
        if (digest == null) return null;
        String value = digest.trim().toLowerCase(Locale.US);
        if (value.startsWith("sha256:")) value = value.substring("sha256:".length());
        return value.matches("[0-9a-f]{64}") ? value : null;
    }

    static String checksumForAsset(String checksumFile, String assetName) throws IOException {
        if (checksumFile == null || assetName == null) {
            throw new IOException("The release checksum data is missing.");
        }
        String found = null;
        String[] lines = checksumFile.split("\\r?\\n");
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.length() == 0 || trimmed.startsWith("#")) continue;
            String[] columns = trimmed.split("\\s+", 2);
            if (columns.length != 2) continue;
            String name = columns[1].trim();
            if (name.startsWith("*")) name = name.substring(1);
            if (!assetName.equals(name)) continue;
            if (found != null) throw new IOException("The APK appears more than once in SHA256SUMS.txt.");
            found = parseSha256Digest(columns[0]);
            if (found == null) throw new IOException("The APK checksum in SHA256SUMS.txt is invalid.");
        }
        if (found == null) throw new IOException("The APK is not listed in SHA256SUMS.txt.");
        return found;
    }
}
