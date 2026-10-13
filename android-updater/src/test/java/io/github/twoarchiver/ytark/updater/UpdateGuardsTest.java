package io.github.twoarchiver.ytark.updater;

import java.io.IOException;

/** Storage, cleanup, minimum-SDK and release-page rules; runs on a host JRE. */
public final class UpdateGuardsTest {
    private static final long MIB = 1024L * 1024L;
    private static final String CURRENT = "YTArk-v2.6.0-armv7.apk";

    public static void main(String[] args) throws IOException {
        freeSpaceBudgetIncludesTheSafetyMargin();
        resumeNeedsOnlyTheRemainingBytes();
        staleFilesAreRemovedButTheKeptReleaseSurvives();
        unrelatedFilesAreNeverTouched();
        minSdkGateUsesTheReleaseMinimum();
        officialPageNeedsACleanTag();
        System.out.println("UpdateGuards tests passed (6 groups).");
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

    private static void minSdkGateUsesTheReleaseMinimum() {
        assertTrue(UpdateGuards.deviceMeetsMinSdk(24, 24), "equal SDK is allowed");
        assertTrue(UpdateGuards.deviceMeetsMinSdk(24, 34), "newer SDK is allowed");
        assertFalse(UpdateGuards.deviceMeetsMinSdk(24, 23), "older SDK is refused");
        assertTrue(UpdateGuards.deviceMeetsMinSdk(0, 19), "an unknown minimum is left to Android's installer");
    }

    private static void officialPageNeedsACleanTag() throws IOException {
        assertEquals("https://github.com/2archiver/YTArk/releases/tag/v2.6.0",
                UpdateGuards.officialReleasePage("v2.6.0"), "clean tag gives its release page");
        String[] unsafe = { "2.6.0", "v2.6", "v2.6.0-rc1", "v2.6.0/../x", "", null };
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
