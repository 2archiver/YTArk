package io.github.twoarchiver.ytark.updater;

import java.io.IOException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Strict parser for the public YTArk GitHub Releases contract.
 * Keep this class Android-free so CI can exercise it on a host JRE.
 */
final class UpdateReleaseContract {
    private static final String RELEASE_ASSET_PREFIX =
            "https://github.com/2archiver/YTArk/releases/download/";
    private static final Pattern VERSION_CODE = Pattern.compile(
            "(?i)version\\s*code\\s*[:=]?\\s*(\\d+)");
    private static final Pattern CLEAN_VERSION = Pattern.compile(
            "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$");

    private UpdateReleaseContract() { }

    static long expectedVersionCodeForVersion(String version) throws IOException {
        if (version == null) throw new IOException("The YTArk release version is missing.");
        Matcher matcher = CLEAN_VERSION.matcher(version);
        if (!matcher.matches()) {
            throw new IOException("The YTArk stable version must use clean MAJOR.MINOR.PATCH SemVer.");
        }
        try {
            long major = Long.parseLong(matcher.group(1));
            long minor = Long.parseLong(matcher.group(2));
            long patch = Long.parseLong(matcher.group(3));
            if (major <= 0 || minor >= 100 || patch >= 100) {
                throw new IOException("The YTArk SemVer components exceed the versionCode mapping.");
            }
            long code = major * 1_000_000L + minor * 10_000L + patch * 100L;
            if (code <= 0 || code > 2_100_000_000L) {
                throw new IOException("The derived Android versionCode exceeds the platform limit.");
            }
            return code;
        } catch (NumberFormatException invalid) {
            throw new IOException("The YTArk version component is invalid.", invalid);
        }
    }

    static String displayVersionForVersion(String version) throws IOException {
        Matcher matcher = CLEAN_VERSION.matcher(version == null ? "" : version);
        if (!matcher.matches()) throw new IOException("The YTArk release version is invalid.");
        return "0".equals(matcher.group(3))
                ? matcher.group(1) + "." + matcher.group(2)
                : version;
    }

    static String releaseTitleForVersion(String version) throws IOException {
        return "YTArk " + displayVersionForVersion(version);
    }

    static String tagForVersion(String version) throws IOException {
        expectedVersionCodeForVersion(version);
        return "v" + version;
    }

    static void requirePublishedStable(boolean hasDraftFlag, boolean draft,
                                       boolean hasPrereleaseFlag, boolean prerelease)
            throws IOException {
        if (!hasDraftFlag || !hasPrereleaseFlag) {
            throw new IOException("The latest release is missing its stable-publication flags.");
        }
        if (draft || prerelease) {
            throw new IOException("Draft or prerelease YTArk builds are not installable updates.");
        }
    }

    static String assetNameForVersion(String version, String architectureSuffix) throws IOException {
        expectedVersionCodeForVersion(version);
        // Validate against the exact ABI-to-filename mapping; do not accept path-like suffixes.
        NativeAbiContract.nativeAbiForSuffix(architectureSuffix);
        return "YTArk-v" + version + "-" + architectureSuffix + ".apk";
    }

    static String requireOfficialAssetUrl(String url, String tag, String assetName)
            throws IOException {
        if (tag == null || !tag.matches("v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)")) {
            throw new IOException("The YTArk stable release tag is invalid.");
        }
        String version = tag.substring(1);
        expectedVersionCodeForVersion(version);
        if (assetName == null || !(assetName.matches(
                "YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-(?:arm64|armv7)\\.apk")
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
