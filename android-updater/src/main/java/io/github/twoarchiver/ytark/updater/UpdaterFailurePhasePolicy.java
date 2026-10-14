package io.github.twoarchiver.ytark.updater;

/** Persistable failure phases; deliberately separate from user-facing error text. */
final class UpdaterFailurePhasePolicy {
    static final String CHECK = "check";
    static final String DOWNLOAD = "download";
    static final String VALIDATION = "validation";
    static final String INSTALL = "install";

    private UpdaterFailurePhasePolicy() { }

    static String normalize(String phase) {
        if (CHECK.equals(phase) || DOWNLOAD.equals(phase)
                || VALIDATION.equals(phase) || INSTALL.equals(phase)) return phase;
        return null;
    }

    static String label(String phase) {
        if (CHECK.equals(phase)) return "Release check";
        if (DOWNLOAD.equals(phase)) return "Download";
        if (VALIDATION.equals(phase)) return "APK validation";
        if (INSTALL.equals(phase)) return "Install";
        return "Updater";
    }

    static String installerFailurePhase(UpdateFailure reason) {
        return reason == UpdateFailure.VALIDATION_FAILED ? VALIDATION : INSTALL;
    }
}
