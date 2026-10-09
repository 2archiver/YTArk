package io.github.twoarchiver.ytark.updater;

import java.io.IOException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared parser for the public GitHub Release metadata consumed by YTArk's updater.
 *
 * Keep this contract in plain Java so CI can exercise it without an Android runtime. The release
 * notes publish versionCode, the API supplies the named APK asset and size, and the checksum asset
 * is the compatibility fallback when GitHub does not provide an asset digest.
 */
final class UpdateReleaseContract {
    private static final String RELEASE_ASSET_PREFIX =
            "https://github.com/2archiver/YTArk/releases/download/";
    private static final Pattern VERSION_CODE = Pattern.compile(
            "(?i)version\\s*code\\s*[:=]?\\s*(\\d+)");

    private UpdateReleaseContract() { }

    static String assetNameForVersion(String version) {
        return "YTArk-v" + version + "-arm64.apk";
    }

    static String requireOfficialAssetUrl(String url, String tag, String assetName)
            throws IOException {
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
        String[] lines = checksumFile.split("\\r?\\n");
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.length() == 0 || trimmed.startsWith("#")) continue;
            String[] columns = trimmed.split("\\s+", 2);
            if (columns.length != 2) continue;
            String name = columns[1].trim();
            if (name.startsWith("*")) name = name.substring(1);
            if (assetName.equals(name)) {
                String parsed = parseSha256Digest(columns[0]);
                if (parsed != null) return parsed;
                throw new IOException("The APK checksum in SHA256SUMS.txt is invalid.");
            }
        }
        throw new IOException("The APK is not listed in SHA256SUMS.txt.");
    }
}
