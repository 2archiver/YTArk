package io.github.twoarchiver.ytark.updater;

/** Hop-by-hop HTTPS release-source restrictions; host-JRE contract tests. */
public final class UpdateRedirectPolicyTest {
    private static final String API = "https://api.github.com/repos/2archiver/YTArk/releases/latest";
    private static final String APK = "https://github.com/2archiver/YTArk/releases/download/v2.9.1/YTArk-v2.9.1-armv7.apk";
    private static final String CHECKSUM = "https://github.com/2archiver/YTArk/releases/download/v2.9.1/SHA256SUMS.txt";

    public static void main(String[] args) {
        acceptsOnlyThePinnedOfficialApiAndAssetPaths();
        validatesEveryRedirectHop();
        refusesDowngradesPortsAndUserInfo();
        onlyHttpRedirectStatusesAreFollowed();
        System.out.println("UpdateRedirectPolicy tests passed (4 groups).");
    }

    private static void acceptsOnlyThePinnedOfficialApiAndAssetPaths() {
        assertTrue(UpdateRedirectPolicy.isTrustedReleaseApiUrl(API), "official latest endpoint");
        assertFalse(UpdateRedirectPolicy.isTrustedReleaseApiUrl("https://api.github.com/repos/evil/YTArk/releases/latest"),
                "other repository endpoint");
        assertFalse(UpdateRedirectPolicy.isTrustedReleaseApiUrl("https://api.github.com/repos/2archiver/YTArk/releases/latest?x=1"),
                "unexpected API query");
        assertTrue(UpdateRedirectPolicy.isTrustedReleaseAssetUrl(APK), "versioned ARMv7 asset");
        assertTrue(UpdateRedirectPolicy.isTrustedReleaseAssetUrl(CHECKSUM), "official checksum asset");
        assertFalse(UpdateRedirectPolicy.isTrustedReleaseAssetUrl("https://github.com/evil/YTArk/releases/download/v2.9.1/YTArk-v2.9.1-armv7.apk"),
                "another repository's asset");
        assertFalse(UpdateRedirectPolicy.isTrustedReleaseAssetUrl("https://github.com/2archiver/YTArk/releases/download/v2.9.1/YTArk-v2.9.1-arm64.apk"),
                "an ARM64 asset");
    }

    private static void validatesEveryRedirectHop() {
        String cdn = "https://release-assets.githubusercontent.com/assets/1234/signed?token=abc";
        String objectStore = "https://objects.githubusercontent.com/assets/1234/signed?token=abc";
        assertTrue(UpdateRedirectPolicy.isAllowedRedirect(APK, cdn, false), "official GitHub CDN hop");
        assertTrue(UpdateRedirectPolicy.isAllowedRedirect(APK, objectStore, false), "official object-store hop");
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(APK, "https://evil.example/download.apk", false),
                "untrusted CDN hop");
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(APK, "https://github.com/evil/other.apk", false),
                "redirect to another GitHub path");
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(APK, "https://github.com.evil.example/2archiver/YTArk/releases/download/v2.9.1/YTArk-v2.9.1-armv7.apk", false),
                "GitHub suffix lookalike");
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(API, "https://release-assets.githubusercontent.com/api.json", true),
                "release API cannot redirect to a CDN");
    }

    private static void refusesDowngradesPortsAndUserInfo() {
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(APK, "http://release-assets.githubusercontent.com/assets/1234", false),
                "HTTPS downgrade");
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(APK, "https://github.com:8443/2archiver/YTArk/releases/download/v2.9.1/YTArk-v2.9.1-armv7.apk", false),
                "nonstandard HTTPS port");
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(APK, "https://github.com@evil.example/2archiver/YTArk/releases/download/v2.9.1/YTArk-v2.9.1-armv7.apk", false),
                "userinfo host confusion");
        assertFalse(UpdateRedirectPolicy.isAllowedRedirect(APK, "https://release-assets.githubusercontent.com/assets/1234#fragment", false),
                "fragments are not sent in HTTP requests and are refused");
    }

    private static void onlyHttpRedirectStatusesAreFollowed() {
        for (int status : new int[] { 301, 302, 303, 307, 308 }) {
            assertTrue(UpdateRedirectPolicy.isRedirectStatus(status), "redirect status " + status);
        }
        for (int status : new int[] { 200, 204, 300, 304, 400, 404, 500 }) {
            assertFalse(UpdateRedirectPolicy.isRedirectStatus(status), "not a followable redirect " + status);
        }
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertFalse(boolean value, String message) {
        if (value) throw new AssertionError(message);
    }
}
