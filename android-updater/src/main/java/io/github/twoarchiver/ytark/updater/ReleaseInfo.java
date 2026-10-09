package io.github.twoarchiver.ytark.updater;

/** Immutable release metadata used by the update UI and installer. */
final class ReleaseInfo {
    final String tag;
    final String versionName;
    final String assetName;
    final String downloadUrl;
    final String sha256;
    final String nativeAbi;
    final long versionCode;
    final long assetSize;

    ReleaseInfo(String tag, String versionName, String assetName, String downloadUrl,
                String sha256, String nativeAbi, long versionCode, long assetSize) {
        this.tag = tag;
        this.versionName = versionName;
        this.assetName = assetName;
        this.downloadUrl = downloadUrl;
        this.sha256 = sha256;
        this.nativeAbi = nativeAbi;
        this.versionCode = versionCode;
        this.assetSize = assetSize;
    }
}
