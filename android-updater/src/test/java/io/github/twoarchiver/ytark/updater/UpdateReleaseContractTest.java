package io.github.twoarchiver.ytark.updater;

import java.io.IOException;
import java.util.Properties;

/** Executable updater/release compatibility tests; no Android runtime or third-party framework. */
public final class UpdateReleaseContractTest {
    private static final String VERSION = "2.1.0";
    private static final String TAG = "v" + VERSION;
    private static final String ARM64_APK = "YTArk-v2.1.0-arm64.apk";
    private static final String ARMV7_APK = "YTArk-v2.1.0-armv7.apk";
    private static final String SHA256 =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String SHA256_B =
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    public static void main(String[] args) throws Exception {
        cleanSemverMapsToMonotonicAndroidVersionCodesAndDisplayNames();
        bothArchitecturesMapToTheirExactVersionedAssetNames();
        abiSelectionPrefersArm64ThenFallsBackToArmv7();
        onlyExactOfficialReleaseAssetUrlsAreAccepted();
        onlyPublishedStableReleaseFlagsAreAccepted();
        checksumFallbackVerifiesBothIndependentEntries();
        malformedOrMissingMetadataIsRejected();
        resumeRequiresExactMetadataAndContentRange();
        System.out.println("UpdateReleaseContract tests passed (8 groups).");
    }

    private static void cleanSemverMapsToMonotonicAndroidVersionCodesAndDisplayNames()
            throws Exception {
        equals(2010000L, UpdateReleaseContract.expectedVersionCodeForVersion("2.1.0"),
                "2.1.0 versionCode");
        equals(2000400L, UpdateReleaseContract.expectedVersionCodeForVersion("2.0.4"),
                "2.0.4 clean-SemVer versionCode");
        equals("2.1", UpdateReleaseContract.displayVersionForVersion("2.1.0"),
                "short display version");
        equals("2.1.3", UpdateReleaseContract.displayVersionForVersion("2.1.3"),
                "nonzero patch display version");
        equals("YTArk 2.1", UpdateReleaseContract.releaseTitleForVersion("2.1.0"),
                "stable release title");
        equals("v2.1.0", UpdateReleaseContract.tagForVersion("2.1.0"), "stable release tag");
        rejects(() -> UpdateReleaseContract.expectedVersionCodeForVersion("2.1.0-rc.1"),
                "prerelease SemVer");
        rejects(() -> UpdateReleaseContract.expectedVersionCodeForVersion("2.1.0-ytark.18"),
                "legacy serial tag is not a new stable version");
        rejects(() -> UpdateReleaseContract.expectedVersionCodeForVersion("2.1.100"),
                "out-of-range patch component");
    }

    private static void bothArchitecturesMapToTheirExactVersionedAssetNames() throws Exception {
        equals(ARM64_APK, UpdateReleaseContract.assetNameForVersion(VERSION, "arm64"),
                "versioned ARM64 asset name");
        equals(ARMV7_APK, UpdateReleaseContract.assetNameForVersion(VERSION, "armv7"),
                "versioned ARMv7 asset name");
        equals(2010000L, UpdateReleaseContract.parseVersionCode(
                "# YTArk 2.1\nVersion 2.1 (2.1.0; versionCode 2010000)"),
                "release notes versionCode");
        rejects(() -> UpdateReleaseContract.assetNameForVersion(VERSION, "armeabi-v7a"),
                "ABI name passed instead of validated filename suffix");
        rejects(() -> UpdateReleaseContract.assetNameForVersion("../other", "arm64"),
                "path-like version");
    }

    private static void abiSelectionPrefersArm64ThenFallsBackToArmv7() throws Exception {
        equals("arm64", NativeAbiContract.assetSuffixForSupportedAbis(
                new String[] { "arm64-v8a", "armeabi-v7a" }), "64-bit preferred");
        equals("armv7", NativeAbiContract.assetSuffixForSupportedAbis(
                new String[] { "armeabi-v7a" }), "32-bit fallback");
        equals("arm64-v8a", NativeAbiContract.nativeAbiForSuffix("arm64"), "ARM64 ABI mapping");
        equals("armeabi-v7a", NativeAbiContract.nativeAbiForSuffix("armv7"), "ARMv7 ABI mapping");
        equals("armv7", NativeAbiContract.assetSuffixForInstalledAbi("armeabi-v7a",
                new String[] { "arm64-v8a", "armeabi-v7a" }),
                "keep installed ARMv7 ABI on a 64-bit-capable device");
        equals("arm64", NativeAbiContract.assetSuffixForInstalledAbi("arm64-v8a",
                new String[] { "arm64-v8a", "armeabi-v7a" }), "keep installed ARM64 ABI");
        rejects(() -> NativeAbiContract.assetSuffixForInstalledAbi("armeabi-v7a",
                new String[] { "arm64-v8a" }), "do not migrate an unsupported installed ABI");
        rejects(() -> NativeAbiContract.assetSuffixForSupportedAbis(
                new String[] { "x86_64", "x86" }), "unsupported device ABIs");
        rejects(() -> NativeAbiContract.assetSuffixForSupportedAbis(null), "missing device ABI data");
    }

    private static void onlyExactOfficialReleaseAssetUrlsAreAccepted() throws Exception {
        String arm64Url = "https://github.com/2archiver/YTArk/releases/download/"
                + TAG + "/" + ARM64_APK;
        String armv7Url = "https://github.com/2archiver/YTArk/releases/download/"
                + TAG + "/" + ARMV7_APK;
        equals(arm64Url, UpdateReleaseContract.requireOfficialAssetUrl(arm64Url, TAG, ARM64_APK),
                "official ARM64 URL");
        equals(armv7Url, UpdateReleaseContract.requireOfficialAssetUrl(armv7Url, TAG, ARMV7_APK),
                "official ARMv7 URL");

        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://example.com/" + ARM64_APK, TAG, ARM64_APK), "external URL");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://github.com.evil.example/2archiver/YTArk/releases/download/" + TAG + "/" + ARM64_APK,
                TAG, ARM64_APK), "lookalike hostname");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://user@github.com/2archiver/YTArk/releases/download/" + TAG + "/" + ARM64_APK,
                TAG, ARM64_APK), "credential-bearing URL");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://github.com/2archiver/YTArk/releases/download/other/" + ARM64_APK,
                TAG, ARM64_APK), "wrong release tag");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                arm64Url + "?redirect=https://evil.example", TAG, ARM64_APK), "URL query redirect");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                "https://github.com/2archiver/YTArk/releases/download/" + TAG + "/other.apk",
                TAG, ARM64_APK), "wrong filename");
        rejects(() -> UpdateReleaseContract.requireOfficialAssetUrl(
                arm64Url, "v2.1.0-rc.1", ARM64_APK), "prerelease tag");
    }

    private static void onlyPublishedStableReleaseFlagsAreAccepted() throws Exception {
        UpdateReleaseContract.requirePublishedStable(true, false, true, false);
        rejects(() -> UpdateReleaseContract.requirePublishedStable(true, true, true, false),
                "draft release");
        rejects(() -> UpdateReleaseContract.requirePublishedStable(true, false, true, true),
                "prerelease release");
        rejects(() -> UpdateReleaseContract.requirePublishedStable(false, false, true, false),
                "missing draft flag");
        rejects(() -> UpdateReleaseContract.requirePublishedStable(true, false, false, false),
                "missing prerelease flag");
    }

    private static void checksumFallbackVerifiesBothIndependentEntries() throws Exception {
        String sums = SHA256 + "  " + ARM64_APK + "\n"
                + SHA256_B + "  " + ARMV7_APK + "\n";
        equals(SHA256, UpdateReleaseContract.checksumForAsset(sums, ARM64_APK), "ARM64 checksum");
        equals(SHA256_B, UpdateReleaseContract.checksumForAsset(sums, ARMV7_APK), "ARMv7 checksum");
        equals(SHA256_B, UpdateReleaseContract.checksumForAsset(
                SHA256_B.toUpperCase() + " *" + ARMV7_APK, ARMV7_APK),
                "binary checksum filename format");
    }

    private static void malformedOrMissingMetadataIsRejected() throws Exception {
        equals(SHA256, UpdateReleaseContract.parseSha256Digest("sha256:" + SHA256.toUpperCase()),
                "GitHub asset digest");
        equals(null, UpdateReleaseContract.parseSha256Digest("short digest"), "short digest rejection");
        equals(null, UpdateReleaseContract.parseSha256Digest(SHA256.substring(0, 63) + "g"),
                "non-hex digest rejection");
        rejects(() -> UpdateReleaseContract.parseVersionCode("No build number here"), "missing versionCode");
        rejects(() -> UpdateReleaseContract.parseVersionCode("versionCode 999999999999999999999"),
                "overflowing versionCode");
        rejects(() -> UpdateReleaseContract.checksumForAsset("bad-checksum  " + ARM64_APK, ARM64_APK),
                "malformed SHA256SUMS entry");
        rejects(() -> UpdateReleaseContract.checksumForAsset(SHA256 + "  other.apk", ARM64_APK),
                "missing APK checksum");
        rejects(() -> UpdateReleaseContract.checksumForAsset(
                SHA256 + "  " + ARM64_APK + "\n" + SHA256_B + "  " + ARM64_APK, ARM64_APK),
                "duplicate APK checksum entry");
    }

    private static void resumeRequiresExactMetadataAndContentRange() {
        Properties metadata = new Properties();
        metadata.setProperty("asset", ARM64_APK);
        metadata.setProperty("url", "https://github.com/2archiver/YTArk/releases/download/" + TAG + "/" + ARM64_APK);
        metadata.setProperty("sha256", SHA256.toUpperCase());
        metadata.setProperty("size", "4096");
        metadata.setProperty("abi", "arm64-v8a");
        assertTrue(UpdateResumeContract.metadataMatches(metadata, ARM64_APK,
                metadata.getProperty("url"), SHA256, 4096L, "arm64-v8a"), "matching resume metadata");
        assertFalse(UpdateResumeContract.metadataMatches(metadata, ARMV7_APK,
                metadata.getProperty("url"), SHA256, 4096L, "arm64-v8a"), "different asset rejects resume");
        assertFalse(UpdateResumeContract.metadataMatches(metadata, ARM64_APK,
                metadata.getProperty("url") + "?redirect=1", SHA256, 4096L, "arm64-v8a"), "different URL rejects resume");
        assertFalse(UpdateResumeContract.metadataMatches(metadata, ARM64_APK,
                metadata.getProperty("url"), SHA256_B, 4096L, "arm64-v8a"), "different digest rejects resume");
        assertFalse(UpdateResumeContract.metadataMatches(metadata, ARM64_APK,
                metadata.getProperty("url"), SHA256, 4097L, "arm64-v8a"), "different size rejects resume");
        assertFalse(UpdateResumeContract.metadataMatches(metadata, ARM64_APK,
                metadata.getProperty("url"), SHA256, 4096L, "armeabi-v7a"), "different ABI rejects resume");

        assertTrue(UpdateResumeContract.shouldAppend(1024L, 206), "partial response appends existing bytes");
        assertFalse(UpdateResumeContract.shouldAppend(1024L, 200), "full response restarts rather than appends");
        assertFalse(UpdateResumeContract.shouldAppend(0L, 206), "partial response is not appended at offset zero");
        assertTrue(UpdateResumeContract.validContentRange("bytes 1024-4095/4096", 1024L, 4096L),
                "exact content range");
        assertFalse(UpdateResumeContract.validContentRange("bytes 0-4095/4096", 1024L, 4096L),
                "wrong content range offset");
        assertFalse(UpdateResumeContract.validContentRange("bytes 1024-4095/8192", 1024L, 4096L),
                "wrong total size");
        assertFalse(UpdateResumeContract.validContentRange("bytes */4096", 1024L, 4096L),
                "unsatisfied range");
    }

    private static void assertTrue(boolean condition, String description) {
        if (!condition) throw new AssertionError(description + ": expected true");
    }

    private static void assertFalse(boolean condition, String description) {
        if (condition) throw new AssertionError(description + ": expected false");
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
