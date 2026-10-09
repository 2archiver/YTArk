package io.github.twoarchiver.ytark.updater;

import java.io.IOException;

/** Executable updater/release compatibility tests; no Android runtime or third-party framework. */
public final class UpdateReleaseContractTest {
    private static final String VERSION = "2.0.3-ytark.15";
    private static final String TAG = "v" + VERSION;
    private static final String APK = "YTArk-v2.0.3-ytark.15-arm64.apk";
    private static final String SHA256 =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    public static void main(String[] args) throws Exception {
        releaseNotesAndAssetNamingMatchTheUpdater();
        onlyTheOfficialReleaseAssetUrlIsAccepted();
        githubDigestAndChecksumFallbackAreStrictlyParsed();
        missingOrInvalidMetadataIsRejected();
        System.out.println("UpdateReleaseContract tests passed (4 cases).");
    }

    private static void releaseNotesAndAssetNamingMatchTheUpdater() throws Exception {
        String releaseBody = "# YTArk " + VERSION + "\n"
                + "| Version | " + VERSION + " (versionCode 20015) |\n";
        equals(APK, UpdateReleaseContract.assetNameForVersion(VERSION), "versioned ARM64 asset name");
        equals(20015L, UpdateReleaseContract.parseVersionCode(releaseBody), "release note versionCode");

        String url = "https://github.com/2archiver/YTArk/releases/download/"
                + TAG + "/" + APK;
        equals(url, UpdateReleaseContract.requireOfficialAssetUrl(url, TAG, APK),
                "official versioned release asset URL");
    }

    private static void onlyTheOfficialReleaseAssetUrlIsAccepted() throws Exception {
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://example.com/" + APK, TAG, APK), "external download URL");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://github.com/2archiver/YTArk/releases/download/other/" + APK, TAG, APK),
                "wrong tag URL");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://github.com/2archiver/YTArk/releases/download/" + TAG + "/other.apk", TAG, APK),
                "wrong asset URL");
    }

    private static void githubDigestAndChecksumFallbackAreStrictlyParsed() throws Exception {
        equals(SHA256, UpdateReleaseContract.parseSha256Digest("sha256:" + SHA256.toUpperCase()),
                "GitHub asset digest");
        equals(SHA256, UpdateReleaseContract.checksumForAsset(
                "# release checksums\n" + SHA256 + "  " + APK + "\n", APK),
                "SHA256SUMS fallback");
        equals(SHA256, UpdateReleaseContract.checksumForAsset(
                SHA256.toUpperCase() + " *" + APK, APK), "binary checksum filename format");
    }

    private static void missingOrInvalidMetadataIsRejected() throws Exception {
        equals(null, UpdateReleaseContract.parseSha256Digest("short digest"), "short digest rejection");
        equals(null, UpdateReleaseContract.parseSha256Digest(SHA256.substring(0, 63) + "g"), "non-hex digest rejection");
        rejects(() -> UpdateReleaseContract.parseVersionCode("No build number here"),
                "missing versionCode");
        rejects(() -> UpdateReleaseContract.parseVersionCode("versionCode 999999999999999999999"),
                "overflowing versionCode");
        rejects(() -> UpdateReleaseContract.checksumForAsset("bad-checksum  " + APK, APK),
                "malformed SHA256SUMS entry");
        rejects(() -> UpdateReleaseContract.checksumForAsset(SHA256 + "  other.apk", APK),
                "checksum for a different asset");
    }

    private static void rejects(IoRunnable assertion, String description) throws Exception {
        try {
            assertion.run();
        } catch (IOException expected) {
            return;
        }
        throw new AssertionError("Expected rejection for " + description);
    }

    private static void equals(Object expected, Object actual, String description) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(description + ": expected " + expected + ", got " + actual);
        }
    }

    private interface IoRunnable {
        void run() throws IOException;
    }
}
