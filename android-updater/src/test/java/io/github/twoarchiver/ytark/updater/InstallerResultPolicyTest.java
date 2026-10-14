package io.github.twoarchiver.ytark.updater;

/** Host-JRE checks for installer cancellation, pending-file recovery and confirmation. */
public final class InstallerResultPolicyTest {
    public static void main(String[] args) {
        assertOutcome(InstallerResultPolicy.Outcome.CONFIRMED,
                InstallerResultPolicy.outcome(true, false, true),
                "the installed package version wins, regardless of result code or pending-file cleanup");
        assertOutcome(InstallerResultPolicy.Outcome.CANCELLED_WITH_VERIFIED_APK,
                InstallerResultPolicy.outcome(false, true, true),
                "cancel keeps the verified APK ready");
        assertOutcome(InstallerResultPolicy.Outcome.UNCONFIRMED_WITH_VERIFIED_APK,
                InstallerResultPolicy.outcome(false, true, false),
                "unconfirmed success keeps the verified APK for retry");
        assertOutcome(InstallerResultPolicy.Outcome.UNCONFIRMED_NO_APK,
                InstallerResultPolicy.outcome(false, false, true),
                "without a verified APK cancellation cannot claim a recoverable install");
        assertLong(2090100L,
                InstallerResultPolicy.resolvedTargetVersionCode(2090100L, 0L),
                "in-flight target survives process recreation");
        assertLong(2090100L,
                InstallerResultPolicy.resolvedTargetVersionCode(0L, 2090100L),
                "completed target survives result callback after pending cleanup");
        assertLong(0L, InstallerResultPolicy.resolvedTargetVersionCode(0L, 0L),
                "missing target is not guessed");
        assertTrue(InstallerResultPolicy.installedVersionConfirms(2090100L, 2090100L),
                "matching PackageManager version confirms installation");
        assertFalse(InstallerResultPolicy.installedVersionConfirms(2090099L, 2090100L),
                "older installed package does not confirm the target");
        assertFalse(InstallerResultPolicy.installedVersionConfirms(2099999L, 0L),
                "missing target never confirms installation");
        assertTrue(InstallerResultPolicy.shouldClearPendingRelease(2090100L, 2090100L),
                "confirmed target may clear the same pending release");
        assertFalse(InstallerResultPolicy.shouldClearPendingRelease(2090200L, 2090100L),
                "confirming an older target preserves a newer pending release");
        assertFalse(InstallerResultPolicy.shouldClearPendingRelease(0L, 2090100L),
                "missing pending version is not eligible for cleanup");
        System.out.println("InstallerResultPolicy tests passed (4 outcomes, 9 recovery checks).");
    }

    private static void assertOutcome(InstallerResultPolicy.Outcome expected,
                                      InstallerResultPolicy.Outcome actual, String message) {
        if (expected != actual) throw new AssertionError(message + ": expected " + expected + ", received " + actual);
    }

    private static void assertLong(long expected, long actual, String message) {
        if (expected != actual) throw new AssertionError(message + ": expected " + expected + ", received " + actual);
    }

    private static void assertTrue(boolean actual, String message) {
        if (!actual) throw new AssertionError(message);
    }

    private static void assertFalse(boolean actual, String message) {
        if (actual) throw new AssertionError(message);
    }
}
