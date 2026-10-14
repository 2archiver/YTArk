package io.github.twoarchiver.ytark.updater;

import java.util.regex.Pattern;

/**
 * Pure storage and compatibility rules for the updater/cache controls:
 * free-space budget, confined cache paths and age policy, stale-file selection,
 * minimum-SDK gate and official release page.
 * Android-free so CI can exercise them on a host JRE.
 */
final class UpdateGuards {
    /** Headroom kept free beyond the APK itself (installer scratch space, logs). */
    static final long SAFETY_MARGIN_BYTES = 32L * 1024L * 1024L;

    /** Official release list; used when no specific release is known. */
    static final String OFFICIAL_RELEASES_URL = "https://github.com/2archiver/YTArk/releases";

    private static final Pattern UPDATE_FILE = Pattern.compile(
            "YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-armv7\\.apk"
                    + "(?:\\.part(?:\\.properties)?)?");

    private UpdateGuards() { }

    /** Bytes that must be free before a transfer may start, given a partial file. */
    static long requiredFreeBytes(long assetSize, long existingPartialBytes) {
        long remaining = Math.max(0L, assetSize - Math.max(0L, existingPartialBytes));
        return remaining + SAFETY_MARGIN_BYTES;
    }

    static boolean hasEnoughFreeSpace(long availableBytes, long assetSize, long existingPartialBytes) {
        if (assetSize <= 0L) return false;
        return availableBytes >= requiredFreeBytes(assetSize, existingPartialBytes);
    }

    /**
     * True only for a path equal to or below the explicitly supplied cache root.
     * Canonical paths make symlink escapes resolve outside the allowed tree.
     */
    static boolean isWithinCacheRoot(java.io.File root, java.io.File candidate)
            throws java.io.IOException {
        if (root == null || candidate == null) return false;
        String rootPath = root.getCanonicalPath();
        String candidatePath = candidate.getCanonicalPath();
        return candidatePath.equals(rootPath)
                || candidatePath.startsWith(rootPath + java.io.File.separator);
    }

    /** Unknown or recent timestamps are retained rather than guessed safe to delete. */
    static boolean retainCacheFile(long lastModifiedMillis, long cutoffMillis) {
        return lastModifiedMillis <= 0L || lastModifiedMillis >= cutoffMillis;
    }

    /**
     * Leftover updater files that no install can still need. The file named by
     * {@code keepApkName} and its partial siblings are never reported, so a
     * pending verified APK survives cleanup. Unrelated names are never touched.
     */
    static boolean isStaleUpdateFile(String fileName, String... keepApkNames) {
        if (fileName == null || !UPDATE_FILE.matcher(fileName).matches()) return false;
        if (keepApkNames != null) {
            for (String keepApkName : keepApkNames) {
                if (keepApkName != null && keepApkName.length() > 0
                        && (fileName.equals(keepApkName) || fileName.startsWith(keepApkName + "."))) {
                    return false;
                }
            }
        }
        return true;
    }

    /** Update storage must be a real, direct child of the app-private files directory. */
    static boolean isSafeUpdateDirectory(java.io.File filesDirectory, java.io.File updateDirectory)
            throws java.io.IOException {
        if (filesDirectory == null || updateDirectory == null) return false;
        java.io.File filesRoot = filesDirectory.getCanonicalFile();
        java.io.File updateRoot = updateDirectory.getCanonicalFile();
        return filesRoot.equals(filesDirectory.getAbsoluteFile())
                && updateRoot.equals(updateDirectory.getAbsoluteFile())
                && filesRoot.equals(updateRoot.getParentFile());
    }

    /** Candidate is a non-symlink direct child of a validated updater directory. */
    static boolean isSafeUpdateFile(java.io.File updateDirectory, java.io.File candidate)
            throws java.io.IOException {
        if (updateDirectory == null || candidate == null) return false;
        java.io.File updateRoot = updateDirectory.getCanonicalFile();
        java.io.File canonicalCandidate = candidate.getCanonicalFile();
        return updateRoot.equals(updateDirectory.getAbsoluteFile())
                && canonicalCandidate.equals(candidate.getAbsoluteFile())
                && updateRoot.equals(canonicalCandidate.getParentFile());
    }

    /**
     * True when the device can run the release's declared minimum SDK. An
     * unknown minimum (0 or negative) is not rejected here; Android's installer
     * remains the final authority for it.
     */
    static boolean deviceMeetsMinSdk(int releaseMinSdk, int deviceSdk) {
        if (releaseMinSdk <= 0) return true;
        return deviceSdk >= releaseMinSdk;
    }

    /** Official, human-openable release page for a clean vX.Y.Z tag. */
    static String officialReleasePage(String tag) throws java.io.IOException {
        if (tag == null || !tag.matches("v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)")) {
            throw new java.io.IOException("The YTArk release tag is not a clean stable version.");
        }
        return "https://github.com/2archiver/YTArk/releases/tag/" + tag;
    }
}
