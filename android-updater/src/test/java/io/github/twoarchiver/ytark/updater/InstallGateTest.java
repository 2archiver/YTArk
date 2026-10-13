package io.github.twoarchiver.ytark.updater;

/**
 * The install decision table. These cases are the guarantees the screen relies on:
 * a restored, resumed or recreated screen never hands the APK to Android twice,
 * and it never opens an installer when the user has not asked to install.
 */
public final class InstallGateTest {
    private static final InstallGate.Step NONE = InstallGate.Step.NONE;
    private static final InstallGate.Step PERMISSION = InstallGate.Step.REQUEST_PERMISSION;
    private static final InstallGate.Step HANDOFF = InstallGate.Step.HANDOFF;
    private static final InstallGate.Step WAIT = InstallGate.Step.WAIT_FOR_INSTALLER;

    public static void main(String[] args) {
        noVerifiedApkMeansNothingToDo();
        noInstallWithoutAnExplicitRequest();
        missingPermissionNeverLaunchesAnything();
        grantedPermissionHandsOffOnce();
        handoffInFlightIsNeverRepeated();
        System.out.println("InstallGate tests passed (5 groups).");
    }

    private static void noVerifiedApkMeansNothingToDo() {
        for (boolean requested : new boolean[] { false, true }) {
            for (boolean granted : new boolean[] { false, true }) {
                for (boolean inFlight : new boolean[] { false, true }) {
                    assertEquals(NONE, InstallGate.next(false, requested, granted, inFlight),
                            "no verified APK means no step");
                }
            }
        }
    }

    private static void noInstallWithoutAnExplicitRequest() {
        assertEquals(NONE, InstallGate.next(true, false, true, false),
                "a verified APK alone never starts an installer");
        assertEquals(NONE, InstallGate.next(true, false, false, false),
                "a verified APK without a request never opens permission Settings");
    }

    private static void missingPermissionNeverLaunchesAnything() {
        assertEquals(PERMISSION, InstallGate.next(true, true, false, false),
                "a request without permission shows the permission state only");
        assertFalse(InstallGate.next(true, true, false, false) == HANDOFF,
                "permission off is never a hand-off");
    }

    private static void grantedPermissionHandsOffOnce() {
        assertEquals(HANDOFF, InstallGate.next(true, true, true, false),
                "request plus permission hands off");
    }

    private static void handoffInFlightIsNeverRepeated() {
        for (boolean requested : new boolean[] { false, true }) {
            for (boolean granted : new boolean[] { false, true }) {
                assertEquals(WAIT, InstallGate.next(true, requested, granted, true),
                        "an open hand-off waits; it is never repeated");
            }
        }
    }

    private static void assertEquals(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + " but was " + actual);
        }
    }

    private static void assertFalse(boolean value, String message) {
        if (value) throw new AssertionError(message);
    }
}
