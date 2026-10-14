package io.github.twoarchiver.ytark.updater;

/** Pure installer-return reconciliation; a result code alone never proves install success. */
final class InstallerResultPolicy {
    enum Outcome { CONFIRMED, CANCELLED_WITH_VERIFIED_APK, UNCONFIRMED_WITH_VERIFIED_APK, UNCONFIRMED_NO_APK }

    private InstallerResultPolicy() { }

    static Outcome outcome(boolean installedVersionConfirmed, boolean verifiedApkRemains,
                           boolean installerCancelled) {
        if (installedVersionConfirmed) return Outcome.CONFIRMED;
        if (!verifiedApkRemains) return Outcome.UNCONFIRMED_NO_APK;
        return installerCancelled ? Outcome.CANCELLED_WITH_VERIFIED_APK
                : Outcome.UNCONFIRMED_WITH_VERIFIED_APK;
    }

    static long resolvedTargetVersionCode(long installerTargetVersionCode,
                                          long completedUpdateVersionCode) {
        return installerTargetVersionCode > 0L
                ? installerTargetVersionCode : completedUpdateVersionCode;
    }

    static boolean installedVersionConfirms(long installedVersionCode, long targetVersionCode) {
        return targetVersionCode > 0L && installedVersionCode >= targetVersionCode;
    }

    static boolean shouldClearPendingRelease(long pendingVersionCode, long confirmedTargetCode) {
        return pendingVersionCode > 0L && confirmedTargetCode > 0L
                && pendingVersionCode <= confirmedTargetCode;
    }
}
