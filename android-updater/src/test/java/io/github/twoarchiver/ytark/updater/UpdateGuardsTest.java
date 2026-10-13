package io.github.twoarchiver.ytark.updater;

import java.io.IOException;

/** Storage, cleanup, minimum-SDK and release-page rules; runs on a host JRE. */
public final class UpdateGuardsTest {
    private static final long MIB = 1024L * 1024L;
    private static final String CURRENT = "YTArk-v2.8.0-armv7.apk";

    public static void main(String[] args) throws IOException {
        freeSpaceBudgetIncludesTheSafetyMargin();
        resumeNeedsOnlyTheRemainingBytes();
        staleFilesAreRemovedButTheKeptReleaseSurvives();
        unrelatedFilesAreNeverTouched();
        cacheCleanupIsConfinedToExplicitRootsAndRetainsRecentOrUnknownFiles();
        minSdkGateUsesTheReleaseMinimum();
        officialPageNeedsACleanTag();
        System.out.println("UpdateGuards tests passed (7 groups).");
    }

    private static void freeSpaceBudgetIncludesTheSafetyMargin() {
        long size = 100L * MIB;
        assertEquals(size + UpdateGuards.SAFETY_MARGIN_BYTES,
                UpdateGuards.requiredFreeBytes(size, 0L), "fresh download needs APK plus margin");
        assertTrue(UpdateGuards.hasEnoughFreeSpace(size + UpdateGuards.SAFETY_MARGIN_BYTES, size, 0L),
                "exactly enough space is accepted");
        assertFalse(UpdateGuards.hasEnoughFreeSpace(size + UpdateGuards.SAFETY_MARGIN_BYTES - 1L, size, 0L),
                "one byte short is refused before any transfer");
        assertFalse(UpdateGuards.hasEnoughFreeSpace(10L * size, 0L, 0L),
                "a zero-size release is never accepted");
    }

    private static void resumeNeedsOnlyTheRemainingBytes() {
        long size = 100L * MIB;
        assertEquals(size / 2 + UpdateGuards.SAFETY_MARGIN_BYTES,
                UpdateGuards.requiredFreeBytes(size, size / 2), "resume counts only the missing half");
        assertEquals(UpdateGuards.SAFETY_MARGIN_BYTES,
                UpdateGuards.requiredFreeBytes(size, size + MIB), "over-long partial needs only the margin");
    }

    private static void staleFilesAreRemovedButTheKeptReleaseSurvives() {
        assertTrue(UpdateGuards.isStaleUpdateFile("YTArk-v2.5.0-armv7.apk", CURRENT),
                "an old verified APK is stale");
        assertTrue(UpdateGuards.isStaleUpdateFile("YTArk-v2.5.0-armv7.apk.part", CURRENT),
                "an old partial is stale");
        assertTrue(UpdateGuards.isStaleUpdateFile("YTArk-v2.5.0-armv7.apk.part.properties", CURRENT),
                "an old partial metadata file is stale");
        assertFalse(UpdateGuards.isStaleUpdateFile(CURRENT, CURRENT),
                "the release being installed is kept");
        assertFalse(UpdateGuards.isStaleUpdateFile(CURRENT + ".part", CURRENT),
                "its partial is kept for a matching resume");
        assertFalse(UpdateGuards.isStaleUpdateFile(CURRENT + ".part.properties", CURRENT),
                "its partial metadata is kept for a matching resume");
    }

    private static void unrelatedFilesAreNeverTouched() {
        String[] unrelated = {
            "update.apk.bak",
            "YTArk-v2.5.0-arm64.apk",
            "YTArk-v2.5.0-armv7.apk.zip",
            "YTArk-v2.5-armv7.apk",
            "user-notes.txt",
            "YTArk-v2.5.0-armv7.apkx",
        };
        for (String name : unrelated) {
            assertFalse(UpdateGuards.isStaleUpdateFile(name, CURRENT), "never delete " + name);
        }
        assertFalse(UpdateGuards.isStaleUpdateFile(null, CURRENT), "a null name is not stale");
    }

    private static void cacheCleanupIsConfinedToExplicitRootsAndRetainsRecentOrUnknownFiles()
            throws IOException {
        java.nio.file.Path base = java.nio.file.Files.createTempDirectory("ytark-cache-guards");
        java.nio.file.Path cache = java.nio.file.Files.createDirectories(base.resolve("cache"));
        java.nio.file.Path nested = java.nio.file.Files.createDirectories(cache.resolve("nested"));
        java.nio.file.Path profile = java.nio.file.Files.createDirectories(base.resolve("profile"));
        java.nio.file.Path cachedFile = java.nio.file.Files.createFile(nested.resolve("stream.tmp"));
        java.nio.file.Path profileFile = java.nio.file.Files.createFile(profile.resolve("account.db"));
        assertTrue(UpdateGuards.isWithinCacheRoot(cache.toFile(), cache.toFile()),
                "the selected cache root itself is in scope");
        assertTrue(UpdateGuards.isWithinCacheRoot(cache.toFile(), cachedFile.toFile()),
                "a file nested under the selected cache root is in scope");
        assertFalse(UpdateGuards.isWithinCacheRoot(cache.toFile(), profileFile.toFile()),
                "profile data outside the selected cache root is out of scope");
        try {
            java.nio.file.Path escape = java.nio.file.Files.createSymbolicLink(
                    cache.resolve("profile-link"), profile);
            assertFalse(UpdateGuards.isWithinCacheRoot(cache.toFile(), escape.resolve("account.db").toFile()),
                    "a symlink cannot extend cleanup into profile data");
        } catch (IOException | UnsupportedOperationException | SecurityException unsupported) {
            // The lexical outside-root check still covers platforms that disable symlinks.
        }
        cache.resolve("profile-link").toFile().delete();
        long now = System.currentTimeMillis();
        assertTrue(UpdateGuards.retainCacheFile(0L, now - 15L * 60L * 1000L),
                "an unknown modification time is kept");
        assertTrue(UpdateGuards.retainCacheFile(now, now - 15L * 60L * 1000L),
                "a recent file is kept");
        assertFalse(UpdateGuards.retainCacheFile(now - 16L * 60L * 1000L,
                now - 15L * 60L * 1000L), "only a known old file is eligible for cleanup");
        cachedFile.toFile().delete();
        nested.toFile().delete();
        cache.toFile().delete();
        profileFile.toFile().delete();
        profile.toFile().delete();
        base.toFile().delete();
    }

    private static void minSdkGateUsesTheReleaseMinimum() {
        assertTrue(UpdateGuards.deviceMeetsMinSdk(24, 24), "equal SDK is allowed");
        assertTrue(UpdateGuards.deviceMeetsMinSdk(24, 34), "newer SDK is allowed");
        assertFalse(UpdateGuards.deviceMeetsMinSdk(24, 23), "older SDK is refused");
        assertTrue(UpdateGuards.deviceMeetsMinSdk(0, 19), "an unknown minimum is left to Android's installer");
    }

    private static void officialPageNeedsACleanTag() throws IOException {
        assertEquals("https://github.com/2archiver/YTArk/releases/tag/v2.8.0",
                UpdateGuards.officialReleasePage("v2.8.0"), "clean tag gives its release page");
        String[] unsafe = { "2.8.0", "v2.7", "v2.8.0-rc1", "v2.8.0/../x", "", null };
        for (String tag : unsafe) {
            try {
                UpdateGuards.officialReleasePage(tag);
                throw new AssertionError("unsafe tag accepted: " + tag);
            } catch (IOException expected) {
                // Refused: no page is guessed for an unclean tag.
            }
        }
    }

    private static void assertEquals(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + " but was " + actual);
        }
    }

    private static void assertEquals(long expected, long actual, String message) {
        if (expected != actual) throw new AssertionError(message + ": expected " + expected + " but was " + actual);
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertFalse(boolean value, String message) {
        if (value) throw new AssertionError(message);
    }
}
