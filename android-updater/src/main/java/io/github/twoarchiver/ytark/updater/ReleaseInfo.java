package io.github.twoarchiver.ytark.updater;

/** Validated metadata for one stable, architecture-matched YTArk release. */
final class ReleaseInfo {
    final String tag;
    final String versionName;
    final String displayVersion;
    final String assetName;
    final String downloadUrl;
    final String sha256;
    final String nativeAbi;
    final long versionCode;
    final long assetSize;
    final String notes;

    ReleaseInfo(String tag, String versionName, String displayVersion, String assetName,
                String downloadUrl, String sha256, String nativeAbi, long versionCode,
                long assetSize, String notes) {
        this.tag = tag;
        this.versionName = versionName;
        this.displayVersion = displayVersion;
        this.assetName = assetName;
        this.downloadUrl = downloadUrl;
        this.sha256 = sha256;
        this.nativeAbi = nativeAbi;
        this.versionCode = versionCode;
        this.assetSize = assetSize;
        this.notes = notes == null ? "" : notes;
    }
}
