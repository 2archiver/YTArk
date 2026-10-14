package io.github.twoarchiver.ytark.updater;

/** Failure-phase validation and TV labels; runs on a host JRE. */
public final class UpdaterFailurePhasePolicyTest {
    public static void main(String[] args) {
        String[] phases = {
            UpdaterFailurePhasePolicy.CHECK,
            UpdaterFailurePhasePolicy.DOWNLOAD,
            UpdaterFailurePhasePolicy.VALIDATION,
            UpdaterFailurePhasePolicy.INSTALL,
        };
        String[] labels = { "Release check", "Download", "APK validation", "Install" };
        for (int index = 0; index < phases.length; index++) {
            assertEquals(phases[index], UpdaterFailurePhasePolicy.normalize(phases[index]),
                    "known phase is retained");
            assertEquals(labels[index], UpdaterFailurePhasePolicy.label(phases[index]),
                    "phase has an actionable display label");
        }
        assertEquals(null, UpdaterFailurePhasePolicy.normalize(null), "missing phase is rejected");
        assertEquals(null, UpdaterFailurePhasePolicy.normalize("intent"), "arbitrary phase is rejected");
        assertEquals("Updater", UpdaterFailurePhasePolicy.label("unknown"), "unknown phase is generic");
        assertEquals(UpdaterFailurePhasePolicy.VALIDATION,
                UpdaterFailurePhasePolicy.installerFailurePhase(UpdateFailure.VALIDATION_FAILED),
                "a failed final APK revalidation remains a validation failure");
        assertEquals(UpdaterFailurePhasePolicy.INSTALL,
                UpdaterFailurePhasePolicy.installerFailurePhase(UpdateFailure.INSTALLER_UNAVAILABLE),
                "an unavailable system installer is an install failure");
        System.out.println("UpdaterFailurePhasePolicy tests passed (2 groups).");
    }

    private static void assertEquals(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", received " + actual);
        }
    }
}
