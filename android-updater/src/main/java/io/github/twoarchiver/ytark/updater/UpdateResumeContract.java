package io.github.twoarchiver.ytark.updater;

import java.util.Properties;

/** Pure resume rules shared by the Android updater and host-side contract tests. */
final class UpdateResumeContract {
    private UpdateResumeContract() { }

    static boolean metadataMatches(Properties metadata, String asset, String url, String sha256,
                                   long size, String abi) {
        if (metadata == null || asset == null || url == null || sha256 == null || abi == null) return false;
        return asset.equals(metadata.getProperty("asset"))
                && url.equals(metadata.getProperty("url"))
                && sha256.equalsIgnoreCase(metadata.getProperty("sha256", ""))
                && Long.toString(size).equals(metadata.getProperty("size"))
                && abi.equals(metadata.getProperty("abi"));
    }

    static boolean shouldAppend(long existingBytes, int httpStatus) {
        return existingBytes > 0 && httpStatus == 206;
    }

    static boolean validContentRange(String value, long expectedStart, long expectedSize) {
        if (value == null || !value.startsWith("bytes ")) return false;
        String[] pieces = value.substring("bytes ".length()).split("[-/]");
        if (pieces.length != 3) return false;
        try {
            long start = Long.parseLong(pieces[0]);
            long end = Long.parseLong(pieces[1]);
            long total = Long.parseLong(pieces[2]);
            return start == expectedStart && end >= start && end < total && total == expectedSize;
        } catch (NumberFormatException invalid) {
            return false;
        }
    }
}
