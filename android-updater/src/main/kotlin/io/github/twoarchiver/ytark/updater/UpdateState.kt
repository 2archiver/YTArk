package io.github.twoarchiver.ytark.updater

/** The only state exposed to the UI. Files are never trusted just because Ready was persisted. */
enum class UpdatePhase { Idle, Checking, Available, Downloading, Validating, Ready, AwaitingPermission, AwaitingInstaller, Failed }
data class Candidate(val tag: String, val code: Long, val asset: String, val url: String, val size: Long, val sha256: String, val notes: String) {
    val identity: String get() = "$tag:$sha256"
    val version: String get() = tag.removePrefix("v")
}
data class UpdateState(
    val phase: UpdatePhase = UpdatePhase.Idle,
    val candidate: Candidate? = null,
    val message: String = "Choose Check for updates.",
    val bytes: Long = 0,
    val lastSuccess: Long = 0,
    val hours: Int = 1,
    val verifiedPath: String? = null,
    val pendingIdentity: String? = null,
    val detail: String = "",
    val retryAt: Long = 0,
    val stale: Boolean = false,
    val errorCategory: String = "",
    val stage: String = "",
    val httpStatus: Int = 0,
    val speedBps: Long = 0,
    val releaseTag: String = ""
) {
    val busy get() = phase in setOf(UpdatePhase.Checking, UpdatePhase.Downloading, UpdatePhase.Validating, UpdatePhase.AwaitingPermission, UpdatePhase.AwaitingInstaller)
}
object ScheduleRules {
    const val HOUR = 3600000L
    fun interval(value: Int?, oldEnabled: Boolean = true) = if (value in listOf(0,1,3)) value!! else if (oldEnabled) 1 else 0
    fun due(hours: Int, now: Long, lastAttempt: Long, lastSuccess: Long, retryAt: Long): Boolean {
        if (hours == 0 || now < retryAt) return false
        // A clock moved backwards must not suppress checks indefinitely, but still respects server backoff.
        // A never-confirmed check must not become due every minute: that burned the unauthenticated
        // GitHub budget and turned a 403 into a request storm.
        val attempt = lastAttempt.takeIf { it in 1..now } ?: 0L
        val success = lastSuccess.takeIf { it in 1..now } ?: 0L
        if (success == 0L) return attempt == 0L || now - attempt >= hours * HOUR
        return now - attempt >= 60000 && now - success >= hours * HOUR
    }
}
/** One-shot permission continuation is bound to the exact downloaded candidate. */
object PendingInstallPolicy {
    fun mayContinue(pending: String?, candidate: String?, granted: Boolean, visible: Boolean) = pending != null && pending == candidate && granted && visible
}
