package io.github.twoarchiver.ytark.updater;

/**
 * The single decision table for the "install unknown apps" flow. It is pure so
 * the host tests can prove that a restored or resumed screen never hands the
 * same APK to Android twice and never opens Settings on its own.
 *
 * <p>Inputs are the persisted intent and the live permission state. The live
 * permission is always read again by the caller; a Settings result code is never
 * treated as proof that the permission was granted.
 */
final class InstallGate {
    enum Step {
        /** Nothing to do: no verified APK, or the user has not asked to install. */
        NONE,
        /** The user asked to install but the permission is off: show the permission screen. */
        REQUEST_PERMISSION,
        /** Permission is on and the user asked to install: hand off once. */
        HANDOFF,
        /** A hand-off already happened and Android has not reported back: wait, never repeat. */
        WAIT_FOR_INSTALLER
    }

    private InstallGate() { }

    static Step next(boolean verifiedApkPresent, boolean installRequested,
                     boolean permissionGranted, boolean handoffInFlight) {
        if (!verifiedApkPresent) return Step.NONE;
        if (handoffInFlight) return Step.WAIT_FOR_INSTALLER;
        if (!installRequested) return Step.NONE;
        return permissionGranted ? Step.HANDOFF : Step.REQUEST_PERMISSION;
    }
}
