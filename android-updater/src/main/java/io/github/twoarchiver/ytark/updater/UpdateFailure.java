package io.github.twoarchiver.ytark.updater;

/**
 * Granular, user-visible reasons an update check or install stops. Android-free
 * so the host contract tests can check the wording and the mapping.
 *
 * <p>Every reason is recoverable: a failure never changes the installed app,
 * its data or its signing identity.
 */
enum UpdateFailure {
    /** The network could not be used (no route, DNS, connect or read timeout). */
    OFFLINE("Offline",
            "Could not reach the YTArk update service. Check the network and try again."),
    /** GitHub answered, but the release metadata was missing, malformed or untrusted. */
    RELEASE_LOOKUP_FAILED("Release lookup failed",
            "The YTArk release information could not be verified. Your installed app is unchanged."),
    /** GitHub limited requests; the updater waits for the advertised window. */
    RATE_LIMITED("Rate limited",
            "GitHub temporarily limited YTArk update checks. Try again after the retry time shown."),
    /** Android did not report the ABI this build needs, so no asset can be chosen safely. */
    ABI_UNAVAILABLE("Architecture unavailable",
            "This device's Android ABI list does not include armeabi-v7a, so no YTArk ARMv7 update can be installed here."),
    /** A newer stable release exists, but it publishes no compatible ARMv7 APK. */
    APK_UNAVAILABLE("Update APK unavailable",
            "A newer YTArk release exists, but it has no ARMv7 APK for this device yet. Your installed version is unchanged."),
    /** The device does not have room for the APK and its temporary partial file. */
    INSUFFICIENT_SPACE("Not enough storage",
            "There is not enough free storage for the YTArk update. Free some space and try again."),
    /** The transfer was interrupted, truncated, cancelled or refused by the server. */
    DOWNLOAD_FAILED("Download failed",
            "The YTArk update did not finish downloading. Resume or retry the download."),
    /** The downloaded file failed a signature, checksum, package, version or ABI check. */
    VALIDATION_FAILED("Validation failed",
            "The downloaded YTArk APK failed a safety check and was not installed."),
    /** The user has not allowed this app to install packages (Install unknown apps). */
    PERMISSION_DENIED("Install permission needed",
            "Allow YTArk to install updates. Enable \u201cAllow from this source\u201d, then return to YTArk."),
    /** No activity could take the APK, or Android refused the installer hand-off. */
    INSTALLER_UNAVAILABLE("Installer unavailable",
            "Android could not open a package installer on this TV. Your installed app is unchanged."),
    /** Android returned without the new version being installed. */
    INSTALL_UNCONFIRMED("Install not confirmed",
            "Android did not confirm the new version. Your current app is unchanged; you can retry the install.");

    private final String label;
    private final String message;

    UpdateFailure(String label, String message) {
        this.label = label;
        this.message = message;
    }

    /** Short name for the reason, shown next to the detailed message. */
    String label() {
        return label;
    }

    /** Recovery-oriented sentence that is safe to show on screen. */
    String message() {
        return message;
    }
}
