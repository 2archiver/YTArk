package io.github.twoarchiver.ytark.updater

import java.io.IOException

enum class UpdateFailure(private val labelText: String, private val messageText: String) {
    OFFLINE("Offline", "Could not reach the YTArk update service. Check the network and try again."),
    RELEASE_LOOKUP_FAILED("Release lookup failed", "The YTArk release information could not be verified. Your installed app is unchanged."),
    RATE_LIMITED("Rate limited", "GitHub temporarily limited YTArk update checks. Try again after the retry time shown."),
    ABI_UNAVAILABLE("Architecture unavailable", "This device's Android ABI list does not include armeabi-v7a, so no YTArk ARMv7 update can be installed here."),
    APK_UNAVAILABLE("Update APK unavailable", "A newer YTArk release exists, but it has no ARMv7 APK for this device yet. Your installed version is unchanged."),
    INSUFFICIENT_SPACE("Not enough storage", "There is not enough free storage for the YTArk update. Free some space and try again."),
    DOWNLOAD_FAILED("Download failed", "The YTArk update did not finish downloading. Resume or retry the download."),
    VALIDATION_FAILED("Validation failed", "The downloaded YTArk APK failed a safety check and was not installed."),
    PERMISSION_DENIED("Install permission needed", "Allow YTArk to install updates. Enable \u201cAllow from this source\u201d, then return to YTArk."),
    INSTALLER_UNAVAILABLE("Installer unavailable", "Android could not open a package installer on this TV. Your installed app is unchanged."),
    INSTALL_UNCONFIRMED("Install not confirmed", "Android did not confirm the new version. Your current app is unchanged; you can retry the install.");
    fun label() = labelText
    fun message() = messageText
}
class UpdateFailureException @JvmOverloads constructor(@JvmField val reason: UpdateFailure, detail: String?, cause: Throwable? = null) : IOException(detail?.takeIf { it.isNotEmpty() } ?: reason.message(), cause)
