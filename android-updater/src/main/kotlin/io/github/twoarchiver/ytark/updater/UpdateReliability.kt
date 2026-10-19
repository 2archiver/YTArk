package io.github.twoarchiver.ytark.updater

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Host-testable updater decisions. Android types stay in the coordinators.
 *
 * A checksum published on the same GitHub release is verified against the APK
 * bytes. It is not treated as an independent trust anchor.
 */

class HttpFailure(val status: Int, val retryAt: Long, message: String, val category: String) : IOException(message)
class ReleaseMetadataFailure @JvmOverloads constructor(message: String, cause: Throwable? = null) : IOException(message, cause)
class UpdateStorageFailure @JvmOverloads constructor(message: String, cause: Throwable? = null) : IOException(message, cause)

/** A retryable, synchronized dependency gate shared by initialization and later operations. */
sealed class DependencyResult<out T> {
    data class Ready<T>(val value: T) : DependencyResult<T>()
    data class Unavailable(val cause: Throwable) : DependencyResult<Nothing>()
}

class RetryableDependency<T>(
    private val create: () -> T,
    private val prepare: (T) -> Unit,
) {
    private val lock = Any()
    private var value: T? = null
    private var ready = false
    private var failure: Throwable? = null

    fun acquire(): DependencyResult<T> = synchronized(lock) {
        try {
            val current = value ?: create().also { value = it }
            if (!ready) {
                prepare(current)
                ready = true
            }
            failure = null
            DependencyResult.Ready(current)
        } catch (error: Throwable) {
            if (error is VirtualMachineError || error is ThreadDeath) throw error
            if (error is InterruptedException) Thread.currentThread().interrupt()
            failure = error
            DependencyResult.Unavailable(error)
        }
    }

    fun readyValue(): T? = synchronized(lock) { value.takeIf { ready } }
    fun lastFailure(): Throwable? = synchronized(lock) { failure }
}

/**
 * Separates optional updater work (metadata checks/cleanup) from actions that
 * require app-private storage (download/validation/install). Optional callers
 * receive an explicit unavailable result and can continue non-storage work;
 * required callers get a typed, visible failure.
 */
class UpdateStorageAccess<T>(
    private val dependency: RetryableDependency<T>,
    private val ensureAvailable: (T) -> Unit,
) {
    fun optional(): DependencyResult<T> = when (val acquired = dependency.acquire()) {
        is DependencyResult.Unavailable -> acquired
        is DependencyResult.Ready -> try {
            ensureAvailable(acquired.value)
            acquired
        } catch (error: Throwable) {
            if (error is VirtualMachineError || error is ThreadDeath) throw error
            if (error is InterruptedException) Thread.currentThread().interrupt()
            DependencyResult.Unavailable(error)
        }
    }

    fun required(): T = when (val result = optional()) {
        is DependencyResult.Ready -> result.value
        is DependencyResult.Unavailable -> throw UpdateStorageFailure(
            "Update storage is unavailable. Free space or restore app storage access, then retry.", result.cause,
        )
    }
}

class RemoteAsset @JvmOverloads constructor(
    @JvmField val name: String,
    @JvmField val url: String,
    @JvmField val size: Long,
    @JvmField val digest: String = "",
    @JvmField val contentType: String = ""
)

class CachedRelease(
    @JvmField val fetchedAt: Long,
    @JvmField val etag: String,
    @JvmField val lastModified: String,
    @JvmField val tag: String,
    @JvmField val code: Long,
    @JvmField val asset: String,
    @JvmField val url: String,
    @JvmField val size: Long,
    @JvmField val sha256: String,
    @JvmField val notes: String,
    @JvmField val sumsVerified: Boolean
) {
    fun complete(): Boolean = try {
        val version = tag.removePrefix("v")
        tag == "v$version"
            && code == UpdateReleaseContract.expectedVersionCodeForVersion(version)
            && NativeAbiContract.acceptedSuffixes().any { asset == UpdateReleaseContract.assetNameForVersion(version, it) }
            && UpdateReleaseContract.requireOfficialAssetUrl(url, tag, asset) == url
            && UpdateReleaseContract.parseSha256Digest(sha256) == sha256
            && size in 1..512L * 1024 * 1024
            && fetchedAt > 0L
    } catch (_: Exception) {
        false
    }
    fun candidate(): Candidate = Candidate(tag, code, asset, url, size, sha256, notes)
    fun touched(now: Long): CachedRelease = CachedRelease(now, etag, lastModified, tag, code, asset, url, size, sha256, notes, sumsVerified)
}

class ParsedRelease(@JvmField val candidate: Candidate, @JvmField val sumsUrl: String, @JvmField val needsSums: Boolean)

class MetadataDocument(@JvmField val status: Int, @JvmField val body: String, @JvmField val etag: String, @JvmField val lastModified: String)

interface MetadataSource {
    @Throws(IOException::class)
    fun probeLatestTag(): String
    @Throws(IOException::class)
    fun metadata(etag: String?, lastModified: String?): MetadataDocument
    @Throws(IOException::class)
    fun text(url: String): String
}

sealed class Discovery {
    class UseCache(@JvmField val cache: CachedRelease, @JvmField val stale: Boolean, @JvmField val retryAt: Long) : Discovery()
    class Fresh(@JvmField val candidate: Candidate, @JvmField val cache: CachedRelease) : Discovery()
    class RateLimited(@JvmField val retryAt: Long, @JvmField val cache: CachedRelease?, @JvmField val httpStatus: Int = 0) : Discovery()
}

class MappedError(
    @JvmField val category: String,
    @JvmField val message: String,
    @JvmField val detail: String,
    @JvmField val retryAt: Long,
    @JvmField val httpStatus: Int,
    @JvmField val stage: String
)

object UpdateTexts {
    /**
     * Diagnostic scrubber used for every displayed, copied or logged updater
     * text. All credential shapes reduce to fixed placeholders BEFORE the
     * length cap, so a secret-bearing suffix can never survive truncation:
     *
     *  - Authorization / Proxy-Authorization headers (with or without a scheme)
     *  - standalone `Bearer`/`Basic` credentials
     *  - `token=` / `password=` / `sig=` style pairs, in prose or query strings
     *  - whole URLs, including uppercase HTTP/HTTPS schemes and signed URLs
     *  - bare IPv4 addresses
     *
     * URL redaction uses the same `[redacted]` placeholder as every other
     * secret, so consumers only need to know one convention. The output is
     * stable under repeated sanitization.
     */
    private val authHeader = Regex("(?i)\\b(authorization|proxy-authorization)\\s*[:=]\\s*(?:(?:bearer|basic|token|digest|oauth|negotiate)\\s+)?[^\\s,;\\r\\n]+")
    private val bearerCred = Regex("(?i)\\bbearer\\s+[A-Za-z0-9._~+/=-]{4,}")
    private val secretPair = Regex("(?i)(token|authorization|password|passwd|secret|sig|signature|credential|api[_-]?key|access[_-]?key)\\s*[=:]\\s*[^\\s&\"']+")

    private val fileUrl = Regex("(?i)\\bfile:(?:/{1,3})?\\S+")
    private val privatePath = Regex("(?i)(?<![A-Za-z0-9])/(?:data|storage|sdcard|mnt|home|tmp|private|var|proc|root|system|vendor|users|android)/[^\\s\"'<>]+")
    private val windowsPath = Regex("(?i)\\b[A-Z]:[\\\\/][^\\s\"'<>]+")

    @JvmStatic fun sanitize(raw: String?): String = sanitizeBounded(raw, 240)

    /** Same redactions with a caller-selected, hard-capped output budget. */
    @JvmStatic fun sanitizeBounded(raw: String?, maxChars: Int): String {
        if (raw.isNullOrBlank() || maxChars <= 0) return ""
        // Normalize separators before secret matching so split Authorization /\nBearer
        // values cannot escape merely because an old saved record wrapped a line.
        var text = raw.replace(Regex("[\\r\\n\\t]+"), " ")
        text = authHeader.replace(text, "$1=[redacted]")
        text = bearerCred.replace(text, "authorization=[redacted]")
        text = secretPair.replace(text, "$1=[redacted]")
        text = Regex("(?i)\\bhttps?://\\S+").replace(text, "[redacted]")
        text = fileUrl.replace(text, "[path]")
        text = privatePath.replace(text, "[path]")
        text = windowsPath.replace(text, "[path]")
        text = Regex("\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b").replace(text, "[ip]")
        text = text.trim()
        val limit = maxChars.coerceAtMost(16_384)
        return if (text.length <= limit) text else if (limit <= 3) text.take(limit) else text.take(limit - 3) + "..."
    }

    @JvmStatic fun age(millis: Long): String {
        if (millis < 0) return "unknown age"
        if (millis < 60_000L) return "just now"
        val minutes = millis / 60_000L
        if (minutes < 60) return if (minutes == 1L) "1 min ago" else "$minutes min ago"
        val hours = minutes / 60
        if (hours < 48) return if (hours == 1L) "1 hour ago" else "$hours hours ago"
        val days = hours / 24
        return if (days == 1L) "1 day ago" else "$days days ago"
    }
}

object RateLimitPolicy {
    /**
     * A 403 is a rate-limit signal only with real evidence: an exhausted quota
     * (remaining 0), a Retry-After directive, or rate-limit response text.
     * GitHub attaches X-RateLimit-Reset to ordinary responses — including
     * permission failures — so a reset header alone never marks a limit.
     */
    @JvmStatic fun isLimited(status: Int, remaining: String?, retryAfter: String?, reset: String?, body: String?): Boolean {
        if (status == 429) return true
        if (status != 403) return false
        if (remaining?.trim() == "0") return true
        if (!retryAfter.isNullOrBlank()) return true
        val text = body?.lowercase(Locale.US) ?: ""
        return text.contains("rate limit") || text.contains("too many requests") || text.contains("secondary rate")
    }

    private const val MIN_RETRY_MS = 60_000L
    private const val FALLBACK_RETRY_MS = 15 * 60_000L
    private const val MAX_LOCAL_RETRY_MS = 24 * 60 * 60_000L
    /** Beyond one month a "cooldown" is not a plausible GitHub deadline; treat it as malformed. */
    private const val MAX_SERVER_COOLDOWN_MS = 30L * 24 * 60 * 60 * 1000

    private fun safeAdd(a: Long, b: Long): Long = if (a > Long.MAX_VALUE - b) Long.MAX_VALUE else a + b

    /** Parses one explicit server cooldown. 0 = absent, malformed or overflowing. */
    private fun serverDeadline(header: String?, now: Long, epochSeconds: Boolean): Long {
        val raw = header?.trim().orEmpty()
        if (raw.isEmpty()) return 0L
        val capped = safeAdd(now, MAX_SERVER_COOLDOWN_MS)
        if (epochSeconds) {
            val epoch = raw.toLongOrNull() ?: return 0L
            if (epoch <= 0L) return 0L
            val millis = if (epoch > Long.MAX_VALUE / 1000L) return 0L else epoch * 1000L
            return if (millis > capped) 0L else millis
        }
        raw.toLongOrNull()?.let { seconds ->
            if (seconds < 0L) return 0L
            val millis = if (seconds > MAX_SERVER_COOLDOWN_MS / 1000L) 0L else safeAdd(now, seconds * 1000L)
            return millis
        }
        return try {
            val parsed = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("GMT")
                isLenient = false
            }.parse(raw)?.time ?: return 0L
            if (parsed > capped) 0L else parsed
        } catch (_: Exception) {
            0L
        }
    }

    /**
     * When to try again. An explicit, valid server deadline (Retry-After on any
     * status, or X-RateLimit-Reset on a classified rate limit) is honored
     * exactly — never shortened by a local cap, so a multi-day cooldown cannot
     * turn into a retry storm. Expired deadlines relax to a small pacing floor.
     * Absent, malformed or overflowing values fall back to bounded local waits:
     * 15 minutes when the response is a rate limit, one minute otherwise, and
     * never more than 24 hours. All arithmetic saturates instead of wrapping.
     */
    @JvmStatic fun retryAtMillis(status: Int, retryAfter: String?, reset: String?, remaining: String?, body: String?, now: Long): Long {
        val floor = safeAdd(now, MIN_RETRY_MS)
        val limited = isLimited(status, remaining, retryAfter, reset, body)
        val explicit = maxOf(
            serverDeadline(retryAfter, now, epochSeconds = false),
            if (limited) serverDeadline(reset, now, epochSeconds = true) else 0L
        )
        if (explicit > 0L) return maxOf(explicit, floor)
        val fallback = if (limited) safeAdd(now, FALLBACK_RETRY_MS) else floor
        return minOf(fallback, safeAdd(now, MAX_LOCAL_RETRY_MS))
    }

    @JvmStatic fun message(retryAt: Long, now: Long, zone: TimeZone): String {
        if (retryAt <= now) return "GitHub rate limit reached — try again now."
        val sameDay = day(retryAt, zone) == day(now, zone)
        val clock = SimpleDateFormat(if (sameDay) "HH:mm" else "d MMM HH:mm", Locale.US).apply {
            timeZone = zone
            isLenient = false
        }.format(Date(retryAt))
        val minutes = ((retryAt - now) + 59_999L) / 60_000L
        val relative = if (minutes < 60) "in $minutes min" else "in ${minutes / 60} h ${minutes % 60} min"
        return "GitHub rate limit reached — try again after $clock ($relative)."
    }

    private fun day(millis: Long, zone: TimeZone): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zone }.format(Date(millis))
}

object BackoffPolicy {
    @JvmStatic fun delayMillis(attempt: Int, now: Long, unit: Double): Long {
        val exp = attempt.coerceIn(0, 5)
        var base = 15_000L
        repeat(exp) { base = if (base > 15 * 60_000L / 2) 15 * 60_000L else base * 2 }
        if (base > 15 * 60_000L) base = 15 * 60_000L
        val jitter = (unit.coerceIn(0.0, 1.0) * base * 0.2).toLong()
        return now + base + jitter
    }

    /** Sleep in short slices so cancellation is observed. Returns false if cancelled. */
    @JvmStatic fun sleep(totalMs: Long, cancelled: AtomicBoolean, nap: (Long) -> Unit) {
        var left = totalMs.coerceAtLeast(0)
        while (left > 0) {
            if (cancelled.get()) return
            val slice = minOf(left, 200L)
            nap(slice)
            left -= slice
        }
    }
}

object ReleaseCachePolicy {
    /** cache = fresh hit, probe = cheap latest-tag redirect, api = conditional API, blocked = rate window. */
    @JvmStatic fun plan(manual: Boolean, hours: Int, now: Long, fetchedAt: Long, tag: String, complete: Boolean, rateUntil: Long): String {
        if (now < rateUntil) return "blocked"
        if (!manual && hours == 0) return "skip"
        if (!manual && complete && fetchedAt > 0 && now - fetchedAt < hours * ScheduleRules.HOUR) return "cache"
        if (!manual && complete && tag.isNotEmpty()) return "probe"
        return "api"
    }
}

class CheckDeduper {
    private val lock = Any()
    private var running = false
    private var queuedManual = false

    fun begin(manual: Boolean): String = synchronized(lock) {
        if (running) {
            if (manual) queuedManual = true
            return "joined"
        }
        running = true
        queuedManual = false
        "started"
    }

    /** @return true when a joined manual check should run next. */
    fun finish(): Boolean = synchronized(lock) {
        if (queuedManual) {
            queuedManual = false
            running = true
            return true
        }
        running = false
        false
    }

    /** Clear all joined work if the executor rejects the first queued check. */
    fun abort() = synchronized(lock) { running = false; queuedManual = false }

    fun running(): Boolean = synchronized(lock) { running }
}

class AttemptGate {
    private val generation = java.util.concurrent.atomic.AtomicInteger()
    fun next(): Int = generation.incrementAndGet()
    fun current(): Int = generation.get()
    fun accept(token: Int): Boolean = token != 0 && token == generation.get()
}

object DownloadTransferPolicy {
    @JvmStatic fun mayResume(storedEtag: String?, responseEtag: String?, status: Int, contentRange: String?, start: Long, size: Long): Boolean {
        if (storedEtag.isNullOrBlank() || responseEtag.isNullOrBlank()) return false
        if (!storedEtag.equals(responseEtag, ignoreCase = true)) return false
        return status == 206 && UpdateResumeContract.validContentRange(contentRange, start, size)
    }

    @JvmStatic fun restartInstead(status: Int, start: Long): Boolean = start > 0 && status == 200
}

object PermissionReturn {
    @JvmStatic fun action(pendingMatches: Boolean, granted: Boolean, flowInFlight: Boolean, alreadyConsumed: Boolean): String = when {
        !pendingMatches || flowInFlight || alreadyConsumed -> "ignore"
        granted -> "continue"
        else -> "deny"
    }
}

object InstallerStatusPolicy {
    const val PENDING_USER_ACTION = -1
    const val SUCCESS = 0
    const val FAILURE = 1
    const val FAILURE_BLOCKED = 2
    const val FAILURE_ABORTED = 3
    const val FAILURE_INVALID = 4
    const val FAILURE_CONFLICT = 5
    const val FAILURE_STORAGE = 6
    const val FAILURE_INCOMPATIBLE = 7

    @JvmStatic fun kind(status: Int, message: String?): String {
        val text = message?.lowercase(Locale.US) ?: ""
        return when (status) {
            PENDING_USER_ACTION -> "user_action"
            SUCCESS -> "success"
            FAILURE_ABORTED -> "cancelled"
            FAILURE_BLOCKED -> "blocked"
            FAILURE_INVALID -> "invalid"
            FAILURE_STORAGE -> "storage"
            FAILURE_INCOMPATIBLE -> "incompatible"
            FAILURE_CONFLICT -> if (text.contains("sign")) "signature" else "conflict"
            FAILURE -> if (text.contains("sign")) "signature" else if (text.contains("cancel")) "cancelled" else "failure"
            else -> "failure"
        }
    }

    @JvmStatic fun message(kind: String): String = when (kind) {
        "cancelled" -> "Installation cancelled. The downloaded APK is kept; select Install update to retry."
        "blocked" -> "Installation blocked. Check this TV's install restrictions, then select Install update."
        "invalid" -> "APK verification failed. The file was not installed."
        "storage" -> "Not enough storage. Free space and retry."
        "incompatible" -> "No compatible APK found. This package is not compatible with this device."
        "signature" -> "App signature mismatch. The installed app was not removed or replaced."
        "conflict" -> "Installation was blocked because it conflicts with the installed app. Nothing was uninstalled."
        "success" -> "Android reported the install. Confirming the installed version."
        "user_action" -> "Handed to Android's installer. Installation is not confirmed yet."
        else -> "Android did not install the update. Your current app is unchanged; select Install update to retry."
    }
}

object InstallStatusContract {
    const val ACTION = "io.github.twoarchiver.ytark.updater.INSTALL_STATUS"
    const val EXTRA_ATTEMPT = "ytark_attempt"
}

object UpdateErrorMapper {
    /**
     * Short reference code for the unexpected-error fallback; helps users
     * report issues. HTTP failures keep their numeric status with the E
     * prefix (for example [E403]); every other category uses the full
     * normalized category name, never a truncation that would rename the
     * contract: the unknown-failure category is always [EUNEXPECTED].
     * Categories are a fixed internal vocabulary, so the normalized code
     * is bounded by construction and is never user-supplied text.
     */
    private fun refCode(category: String, httpStatus: Int): String {
        val code = if (httpStatus > 0) {
            "E${httpStatus}"
        } else {
            "E" + category.uppercase(Locale.US).filter { it.isLetterOrDigit() || it == '_' }
        }
        return "[$code]"
    }

    @JvmStatic fun map(error: Throwable, stage: String, now: Long, tag: String): MappedError {
        val chain = ArrayList<Throwable>(4)
        var cursor: Throwable? = error
        while (cursor != null && chain.size < 6) {
            chain.add(cursor)
            cursor = cursor.cause
        }
        val http = chain.filterIsInstance<HttpFailure>().firstOrNull()
        val names = chain.joinToString(" ") { it.javaClass.simpleName }
        val raw = chain.joinToString(" ") { it.message ?: "" }
        val lower = raw.lowercase(Locale.US)
        val detail = buildString {
            append("Cause chain:")
            chain.forEachIndexed { index, cause ->
                append("\n").append(index + 1).append(". ")
                    .append(cause.javaClass.simpleName.ifBlank { "UnknownThrowable" })
                val safe = UpdateTexts.sanitize(cause.message)
                if (safe.isNotBlank()) append(": ").append(safe)
            }
        }.take(1600)

        if (http != null && (http.category == "rate_limit" || http.status == 429)) {
            val retry = http.retryAt.takeIf { it > now }
                ?: RateLimitPolicy.retryAtMillis(http.status, null, null, null, "", now)
            return MappedError("rate_limit", http.message ?: RateLimitPolicy.message(retry, now, TimeZone.getDefault()), detail, retry, http.status, stage)
        }

        val hasLinkageFailure = chain.any { it is LinkageError || it is ClassNotFoundException }
        // TLS/SSL failures: any class in the javax.net.ssl or java.security.cert package chain
        val hasTlsFailure = chain.any {
            val cn = it.javaClass.name
            cn.startsWith("javax.net.ssl.") || cn.startsWith("java.security.cert.")
        } || lower.contains("ssl handshake") || lower.contains("certificate") || lower.contains("certpath") || lower.contains("trust anchor")
        val category = when {
            http?.status == 403 -> "forbidden"
            http?.status == 404 -> "no_release"
            http != null && http.status in 500..599 -> "server"
            hasLinkageFailure -> "runtime"
            chain.any { it is ReleaseMetadataFailure } -> "metadata"
            chain.any { it is UpdateStorageFailure } -> "storage"
            // TLS/SSL failures are distinct from plain connection errors.
            hasTlsFailure -> "tls"
            // Name-resolution and connect-refusal failures are network
            // availability problems, not timeouts.
            names.contains("UnknownHost") || names.contains("NoRouteToHost") -> "offline"
            names.contains("SocketTimeout") || lower.contains("timed out") || lower.contains("timeout") -> "timeout"
            names.contains("ConnectException") || names.contains("SocketException") -> "connection"
            lower.contains("release metadata") || lower.contains("invalid release tag")
                || lower.contains("missing versioncode metadata") || lower.contains("versioncode disagrees")
                || lower.contains("not explicitly published stable") || lower.contains("untrusted release source")
                || lower.contains("untrusted release asset") || lower.contains("checksum asset")
                || lower.contains("no verifiable apk checksum") || lower.contains("no trusted apk checksum")
                || lower.contains("malformed release digest") -> "metadata"
            lower.contains("no compatible") || lower.contains("armeabi-v7a") || lower.contains("no unique compatible") -> "no_compatible_apk"
            lower.contains("not enough storage") || lower.contains("no space") || lower.contains("enospc") -> "storage"
            lower.contains("signer is incompatible") || lower.contains("signature mismatch") || lower.contains("signatures do not match") -> "signature_mismatch"
            lower.contains("apk checksum failed") || lower.contains("corrupt apk") || lower.contains("malformed apk") || names.contains("ApkFormat") || names.contains("ZipException") -> "verification"
            lower.contains("signature verification") -> "verification"
            lower.contains("install permission") || lower.contains("unknown apps") -> "permission"
            lower.contains("installation cancelled") || lower.contains("install cancelled") -> "install_cancelled"
            lower.contains("download cancelled") -> "cancelled"
            lower.contains("interrupted") || lower.contains("download") && lower.contains("fail") -> "download_interrupted"
            http != null -> "http"
            else -> "unexpected"
        }
        val message = when (category) {
            "timeout" -> "Connection timed out. Check the network and retry."
            "offline" -> "Network unavailable. Check the connection and retry."
            "connection" -> "Could not connect to the update service. Check the network and retry."
            "tls" -> "The connection could not be secured (TLS error). Check the network and retry."
            "forbidden" -> "The update service denied this request (HTTP 403). It was not confirmed as a rate limit; retry later."
            "no_release" -> "No stable YTArk release is published yet. Check again later."
            "server" -> "The update service is temporarily unavailable (HTTP ${http?.status ?: 0}). Retry later."
            "metadata" -> "The release response was incomplete or invalid. Your installed app is unchanged; retry the check."
            "runtime" -> "The updater could not run on this app build. Reopen Updates and retry; your installed app is unchanged."
            "no_compatible_apk" -> firstSafe(raw, "No compatible APK found. This release has no ARMv7 package for this device.")
            "storage" -> "Update storage is unavailable or full. Free space or restore app storage access, then retry; the installed app is unchanged."
            "signature_mismatch" -> "App signature mismatch. The installed app was not removed or replaced."
            "verification" -> "APK verification failed. The file was discarded and was not installed."
            "permission" -> "Install permission required. Enable Allow from this source for YTArk, then select Install update."
            "install_cancelled" -> "Installation cancelled. The downloaded APK is kept; select Install update to retry."
            "cancelled" -> "Download cancelled. Retry when ready."
            "download_interrupted" -> "Download interrupted. Retry to continue the download."
            "http" -> "The update service returned HTTP ${http?.status ?: 0}. Try again later."
            else -> "The update stopped unexpectedly ${refCode(category, http?.status ?: 0)}. Your installed app is unchanged. Retry or report this code."
        }
        val retry = http?.retryAt?.takeIf { it > 0 } ?: (now + 60_000L)
        return MappedError(category, message, detail, retry, http?.status ?: 0, stage)
    }

    private fun firstSafe(raw: String, fallback: String): String {
        val line = raw.lineSequence().map { it.trim() }.firstOrNull { it.startsWith("No compatible APK found") && !it.contains("://") && it.length <= 220 }
        return line ?: fallback
    }
}

object UpdateStates {
    /** Keep a last-confirmed release visible during a retry, but clear the preceding error. */
    @JvmStatic fun checking(s: UpdateState): UpdateState = s.copy(
        phase = UpdatePhase.Checking, message = "Checking stable ARMv7 release…", detail = "", errorCategory = "",
        httpStatus = 0, speedBps = 0, stale = false, bytes = 0, stage = "", retryAt = 0
    )
    @JvmStatic fun upToDate(s: UpdateState, version: String, now: Long, installedAhead: Boolean = false): UpdateState = s.copy(
        phase = UpdatePhase.Idle, candidate = null, verifiedPath = null, pendingIdentity = null,
        lastSuccess = now, bytes = 0, stale = false, detail = "", errorCategory = "", httpStatus = 0,
        speedBps = 0, stage = "", retryAt = 0, latestVersion = version, installedAhead = installedAhead,
        latestVersionStale = false,
        message = if (installedAhead) "Installed version is ahead of the latest stable release." else "You're on the latest version."
    )
    @JvmStatic fun available(s: UpdateState, candidate: Candidate, now: Long, verified: String?): UpdateState = s.copy(
        phase = UpdatePhase.Available, candidate = candidate, verifiedPath = verified, pendingIdentity = null,
        lastSuccess = now, bytes = 0, stale = false, detail = "", errorCategory = "", httpStatus = 0,
        speedBps = 0, stage = "", retryAt = 0, latestVersion = "", installedAhead = false,
        latestVersionStale = false, message = "YTArk ${candidate.version} is available."
    )
    @JvmStatic fun staleAvailable(s: UpdateState, candidate: Candidate, retryAt: Long, message: String, httpStatus: Int = 0): UpdateState = s.copy(
        phase = UpdatePhase.Available, candidate = candidate,
        verifiedPath = if (s.candidate?.identity == candidate.identity) s.verifiedPath else null,
        pendingIdentity = null, stale = true, retryAt = retryAt, message = message,
        errorCategory = "rate_limit", stage = "check", httpStatus = httpStatus, speedBps = 0,
        releaseTag = candidate.tag, latestVersion = candidate.version, installedAhead = false, latestVersionStale = true
    )
    @JvmStatic fun downloading(s: UpdateState): UpdateState = s.copy(
        phase = UpdatePhase.Downloading, message = "Downloading update…", verifiedPath = null, bytes = 0,
        speedBps = 0, detail = "", errorCategory = "", stale = false, stage = "", httpStatus = 0, retryAt = 0,
    )
    @JvmStatic fun progress(s: UpdateState, bytes: Long, speed: Long): UpdateState = s.copy(phase = UpdatePhase.Downloading, bytes = bytes, speedBps = speed)
    @JvmStatic fun verifying(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.Validating, message = "Verifying package, version, ABI, checksum and signer…", speedBps = 0)
    @JvmStatic fun ready(s: UpdateState, path: String): UpdateState = s.copy(
        phase = UpdatePhase.Ready, verifiedPath = path, pendingIdentity = null,
        message = "Update ready. Select Install update; Android will ask for confirmation.", speedBps = 0,
        bytes = 0, stale = false, retryAt = 0, errorCategory = "", detail = "", stage = "", httpStatus = 0,
    )
    @JvmStatic fun cancelled(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.Available, pendingIdentity = null, message = "Download cancelled. Retry when ready.", speedBps = 0, bytes = 0, errorCategory = "cancelled")
    @JvmStatic fun failed(s: UpdateState, mapped: MappedError, tag: String): UpdateState = s.copy(
        phase = UpdatePhase.Failed, pendingIdentity = null, message = mapped.message, detail = mapped.detail,
        retryAt = mapped.retryAt, errorCategory = mapped.category, stage = mapped.stage.ifBlank { "updater" },
        httpStatus = mapped.httpStatus, speedBps = 0, releaseTag = tag
    )
    @JvmStatic fun permission(s: UpdateState, identity: String): UpdateState = s.copy(phase = UpdatePhase.AwaitingPermission, pendingIdentity = identity, message = "Install permission required. Enable Allow from this source for YTArk, then return.")
    @JvmStatic fun handedToSystem(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.AwaitingInstaller, pendingIdentity = null, message = "Handed to Android's installer. Installation is not confirmed yet.")
    @JvmStatic fun permissionDenied(s: UpdateState): UpdateState = s.copy(phase = if (s.verifiedPath != null) UpdatePhase.Ready else UpdatePhase.Available, pendingIdentity = null, message = "Install permission required. Enable Allow from this source for YTArk, then select Install update.", errorCategory = "permission", stage = "install")
    @JvmStatic fun installUnconfirmed(s: UpdateState): UpdateState = s.copy(phase = if (s.verifiedPath != null) UpdatePhase.Ready else UpdatePhase.Available, pendingIdentity = null, message = "Installation was not confirmed. Select Install update to retry; the downloaded APK is kept.")
    @JvmStatic fun installed(s: UpdateState): UpdateState = s.copy(
        phase = UpdatePhase.Idle, candidate = null, verifiedPath = null, pendingIdentity = null, bytes = 0,
        stale = false, detail = "", errorCategory = "", httpStatus = 0, stage = "", retryAt = 0,
        speedBps = 0, latestVersion = "", installedAhead = false, latestVersionStale = false,
        releaseTag = "", message = "Update installed. Your application data was not cleared."
    )
}

/** Explicit edges used by the coordinator. Same-state progress is always allowed. */
object UpdateFlowMachine {
    @JvmStatic fun allow(from: String, to: String): Boolean {
        if (from == to) return true
        if (to == "Failed" || to == "Cancelled") return true
        val next = when (from) {
            "Idle" -> setOf("Checking", "UpdateAvailable", "UpToDate")
            "Checking" -> setOf("UpToDate", "UpdateAvailable", "Idle", "Failed")
            "UpToDate" -> setOf("Checking", "Idle", "UpdateAvailable")
            "UpdateAvailable" -> setOf("Checking", "Downloading", "Verifying", "AwaitingPermission", "Installing", "Idle")
            "Downloading" -> setOf("Verifying", "UpdateAvailable", "Cancelled", "Failed")
            "Verifying" -> setOf("UpdateAvailable", "Installing", "AwaitingPermission", "Failed")
            "AwaitingPermission" -> setOf("Installing", "UpdateAvailable", "HandedToSystem")
            "Installing", "HandedToSystem" -> setOf("HandedToSystem", "Completed", "UpdateAvailable", "Cancelled", "AwaitingPermission")
            "Completed" -> setOf("Idle", "UpToDate", "Checking")
            "Failed", "Cancelled" -> setOf("Checking", "Downloading", "UpdateAvailable", "Idle", "UpToDate")
            else -> emptySet()
        }
        return to in next
    }
}

object ReleaseMetadataParser {
    private const val MAX = 512L * 1024 * 1024

    private fun optionalText(fields: Map<String, Json>, key: String, fallback: String = ""): String =
        fields[key]?.let { if (it.isNull()) fallback else it.asString() } ?: fallback

    @JvmStatic @Throws(IOException::class)
    fun parse(json: String, sums: String?): ParsedRelease {
        val root = Json.parse(json).asObject()
        val hasDraft = root.containsKey("draft")
        val hasPre = root.containsKey("prerelease")
        val draft = root["draft"]?.asBoolean() ?: false
        val pre = root["prerelease"]?.asBoolean() ?: false
        UpdateReleaseContract.requirePublishedStable(hasDraft, draft, hasPre, pre)
        val tag = root["tag_name"]?.asString() ?: throw ReleaseMetadataFailure("Invalid release tag.")
        requireUpdate(tag.startsWith("v"), "Invalid release tag.")
        val version = tag.removePrefix("v")
        val code = UpdateReleaseContract.expectedVersionCodeForVersion(version)
        val body = root["body"]?.asString() ?: ""
        requireUpdate(UpdateReleaseContract.parseVersionCode(body) == code, "Release versionCode disagrees with tag.")
        val assets = root["assets"]?.asArray() ?: emptyList()
        val remote = assets.map { item ->
            val obj = item.asObject()
            RemoteAsset(
                optionalText(obj, "name"),
                optionalText(obj, "browser_download_url"),
                obj["size"]?.takeUnless { it.isNull() }?.asLong() ?: -1L,
                optionalText(obj, "digest"),
                optionalText(obj, "content_type"),
            )
        }
        val apk = select(remote, tag)
        val url = UpdateReleaseContract.requireOfficialAssetUrl(apk.url, tag, apk.name)
        var digest = UpdateReleaseContract.parseSha256Digest(apk.digest)
        requireUpdate(apk.digest.isEmpty() || apk.digest == "null" || digest != null, "Malformed release digest.")
        val sumsAssets = remote.filter { it.name == "SHA256SUMS.txt" }
        requireUpdate(sumsAssets.size <= 1, "Duplicate checksum asset.")
        val sumsUrl = if (sumsAssets.isEmpty()) "" else UpdateReleaseContract.requireOfficialAssetUrl(sumsAssets[0].url, tag, "SHA256SUMS.txt")
        if (sums != null && sumsUrl.isNotEmpty()) {
            val published = UpdateReleaseContract.checksumForAsset(sums, apk.name)
            requireUpdate(digest == null || digest == published, "Release checksums disagree.")
            digest = published
        }
        requireUpdate(digest != null, "The release has no verifiable APK checksum. The update cannot proceed safely.")
        val notes = body.substringBefore("<!--").lineSequence().filter { !it.contains("http") }.take(12).joinToString("\n").take(1800)
        val candidate = Candidate(tag, code, apk.name, url, apk.size, digest!!, notes)
        return ParsedRelease(candidate, sumsUrl, sums == null && sumsUrl.isNotEmpty())
    }

    /**
     * Select exactly one valid ARMv7 APK from the release assets.
     * Accepts both the current naming convention (armeabi-v7a) and the
     * legacy name (armv7) for backward compatibility with older releases.
     * Rejects zero matches, multiple matches, empty APKs and non-APK content types.
     * Never falls back to assets[0] or picks an incompatible architecture.
     */
    private fun select(assets: List<RemoteAsset>, tag: String): RemoteAsset {
        val accepted = NativeAbiContract.acceptedSuffixes().map { suffix ->
            UpdateReleaseContract.assetNameForVersion(tag.removePrefix("v"), suffix)
        }
        val named = assets.filter { it.name in accepted }
        if (named.isEmpty()) {
            val otherApk = assets.any { it.name.endsWith(".apk") }
            val otherArch = assets.any { it.name.contains("arm64") || it.name.contains("x86") || it.name.contains("universal") }
            val baseMsg = when {
                otherApk && otherArch -> "No compatible APK found. Release $tag has no ARMv7 package for this device."
                otherApk -> "No compatible APK found. Release $tag has no ARMv7 package for this device."
                else -> "No compatible APK found. Release $tag has no YTArk ARMv7 package."
            }
            throw IOException(baseMsg)
        }
        if (named.size > 1) throw IOException("No compatible APK found. Release $tag publishes more than one ARMv7 APK.")
        val apk = named[0]
        if (apk.size == 0L) throw IOException("No compatible APK found. The ARMv7 APK for $tag is empty.")
        requireUpdate(apk.size in 1..MAX, "APK size exceeds limits.")
        val type = apk.contentType.lowercase(Locale.US)
        if (type.contains("text/html") || type.contains("application/json") || type.contains("text/plain")) {
            throw IOException("No compatible APK found. The published ARMv7 asset is not an APK.")
        }
        return apk
    }
}

/** One in-flight discovery. Network stays behind [MetadataSource] so tests use a fake. */
class UpdateRepository(private val source: MetadataSource) {
    @Throws(IOException::class)
    fun discover(manual: Boolean, hours: Int, now: Long, rateUntil: Long, cache: CachedRelease?): Discovery {
        val usable = cache?.takeIf { it.complete() }
        val plan = ReleaseCachePolicy.plan(manual, hours, now, usable?.fetchedAt ?: 0L, usable?.tag ?: "", usable != null, rateUntil)
        return when (plan) {
            "skip", "cache" -> Discovery.UseCache(usable ?: throw IOException("No saved release to reuse."), false, 0L)
            "blocked" -> Discovery.RateLimited(rateUntil, usable)
            "probe" -> probeOrFetch(usable, now)
            else -> fetchApi(usable, now)
        }
    }

    private fun probeOrFetch(cache: CachedRelease?, now: Long): Discovery {
        try {
            val tag = source.probeLatestTag()
            if (cache != null && cache.tag == tag) return Discovery.UseCache(cache.touched(now), false, 0L)
        } catch (e: HttpFailure) {
            if (e.category == "rate_limit") return Discovery.RateLimited(e.retryAt, cache, e.status)
            // Do not switch endpoints after a real HTTP error (notably 403/5xx).
            throw e
        } catch (e: IOException) {
            // The public latest-page redirect is an optimization, but a known
            // connectivity failure is the check's result, not a reason to make
            // a second request to another endpoint.
            if (isConnectivityFailure(e)) throw e
        }
        return fetchApi(cache, now)
    }

    private fun isConnectivityFailure(error: Throwable): Boolean {
        var cause: Throwable? = error
        var depth = 0
        while (cause != null && depth++ < 6) {
            if (cause is UnknownHostException || cause is NoRouteToHostException
                || cause is ConnectException || cause is SocketTimeoutException || cause is SocketException) return true
            cause = cause.cause
        }
        return false
    }

    private fun fetchApi(cache: CachedRelease?, now: Long): Discovery {
        val doc = try {
            source.metadata(cache?.etag?.ifBlank { null }, cache?.lastModified?.ifBlank { null })
        } catch (e: HttpFailure) {
            if (e.category == "rate_limit") return Discovery.RateLimited(e.retryAt, cache, e.status)
            throw e
        }
        if (doc.status == 304) {
            if (cache != null) return Discovery.UseCache(cache.touched(now), false, 0L)
            throw ReleaseMetadataFailure("Release metadata returned 304 Not Modified without a valid saved release.")
        }
        if (doc.status != 200) {
            throw HttpFailure(doc.status, now + 60_000L, "Release API returned HTTP ${doc.status}.", "http")
        }
        if (doc.body.isBlank()) throw ReleaseMetadataFailure("Release metadata response was empty.")
        var parsed = ReleaseMetadataParser.parse(doc.body, null)
        var sumsVerified = !parsed.needsSums
        if (parsed.needsSums) {
            try {
                val sums = source.text(parsed.sumsUrl)
                parsed = ReleaseMetadataParser.parse(doc.body, sums)
                sumsVerified = true
            } catch (e: HttpFailure) {
                if (e.category != "rate_limit" || parsed.candidate.sha256.isEmpty()) throw e
                // Same-origin sums file is not a second trust anchor. Keep the published asset digest.
                sumsVerified = false
            }
        }
        val saved = CachedRelease(now, doc.etag, doc.lastModified, parsed.candidate.tag, parsed.candidate.code, parsed.candidate.asset, parsed.candidate.url, parsed.candidate.size, parsed.candidate.sha256, parsed.candidate.notes, sumsVerified)
        return Discovery.Fresh(parsed.candidate, saved)
    }
}

interface RedirectGate {
    fun allowed(initial: String, target: String): Boolean
}

interface ProgressSink {
    fun onBytes(count: Long)
}

interface HeaderSink {
    fun onHeaders(status: Int, etag: String, contentRange: String, contentType: String)
}

class HttpResult(@JvmField val status: Int, @JvmField val body: String, @JvmField val finalUrl: String, private val headers: Map<String, String>) {
    fun header(name: String): String? = headers[name.lowercase(Locale.US)]
}

class StreamResult(@JvmField val status: Int, @JvmField val bytes: Long, @JvmField val etag: String, @JvmField val contentRange: String, @JvmField val contentType: String)

class CancelHandle {
    val cancelled = AtomicBoolean(false)
    val connection = AtomicReference<HttpURLConnection?>(null)
    fun cancel() {
        cancelled.set(true)
        connection.get()?.disconnect()
    }
}

/**
 * Bounded HTTPS helper. Production wrappers reject non-GitHub URLs before calling this.
 * Redirects are followed only when [RedirectGate] allows the next hop.
 */
object JdkHttp {
    private const val USER_AGENT = "YTArk/3.4 (+https://github.com/2archiver/YTArk)"

    @JvmStatic @JvmOverloads @Throws(IOException::class)
    fun exchange(url: String, method: String, headerMap: Map<String, String>, gate: RedirectGate, maxBytes: Int, follow: Boolean = true, cancel: CancelHandle = CancelHandle()): HttpResult {
        var current = url
        repeat(6) { _ ->
            if (cancel.cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
            val connection = open(current, method, headerMap, cancel)
            try {
                val status = connection.responseCode
                if (follow && UpdateRedirectPolicy.isRedirectStatus(status)) {
                    val location = connection.getHeaderField("Location")
                    connection.disconnect()
                    val target = try { URL(URL(current), location).toString() } catch (_: Exception) { "" }
                    if (!gate.allowed(url, target)) throw IOException("Untrusted download redirect.")
                    current = target
                    return@repeat
                }
                // A latest-release probe only needs the redirect status and Location.
                // Reading the body of a 302 can throw and would hide a valid tag.
                if (method == "HEAD" || (!follow && UpdateRedirectPolicy.isRedirectStatus(status))) {
                    return HttpResult(status, "", current, headerMap(connection))
                }
                val body = readLimited(if (status >= 400) connection.errorStream else connection.inputStream, maxBytes)
                return HttpResult(status, body.toString(Charsets.UTF_8), current, headerMap(connection))
            } catch (e: IOException) {
                throw sanitize(e, "The update service could not be reached.")
            } finally {
                connection.disconnect()
                cancel.connection.set(null)
            }
        }
        throw IOException("Too many download redirects.")
    }

    @JvmStatic @Throws(IOException::class)
    fun streamTo(url: String, destination: File, rangeStart: Long, expectedSize: Long, deadlineNs: Long, gate: RedirectGate, cancel: CancelHandle, headers: HeaderSink?, progress: ProgressSink): StreamResult {
        var current = url
        repeat(6) {
            if (cancel.cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
            val extra = LinkedHashMap<String, String>()
            extra["Accept"] = "application/octet-stream"
            if (rangeStart > 0) extra["Range"] = "bytes=$rangeStart-"
            val connection = open(current, "GET", extra, cancel)
            try {
                val status = connection.responseCode
                if (UpdateRedirectPolicy.isRedirectStatus(status)) {
                    val location = connection.getHeaderField("Location")
                    connection.disconnect()
                    val target = try { URL(URL(current), location).toString() } catch (_: Exception) { "" }
                    if (!gate.allowed(url, target)) throw IOException("Untrusted download redirect.")
                    current = target
                    return@repeat
                }
                if (status != 200 && status != 206) {
                    val snippet = readLimited(connection.errorStream, 1024).toString(Charsets.UTF_8)
                    val headers = headerMap(connection)
                    if (RateLimitPolicy.isLimited(status, headers["x-ratelimit-remaining"], headers["retry-after"], headers["x-ratelimit-reset"], snippet)) {
                        val retry = RateLimitPolicy.retryAtMillis(status, headers["retry-after"], headers["x-ratelimit-reset"], headers["x-ratelimit-remaining"], snippet, System.currentTimeMillis())
                        throw HttpFailure(status, retry, RateLimitPolicy.message(retry, System.currentTimeMillis(), TimeZone.getDefault()), "rate_limit")
                    }
                    throw IOException("Download interrupted with HTTP $status.")
                }
                val type = connection.contentType ?: ""
                if (type.contains("text/html", ignoreCase = true)) throw IOException("Server returned an error page, not an APK.")
                val etag = connection.getHeaderField("ETag") ?: ""
                val range = connection.getHeaderField("Content-Range") ?: ""
                val reported = connection.contentLengthLong
                if (status == 200 && reported != -1L && expectedSize > 0 && reported != expectedSize) throw IOException("Download length disagrees with release.")
                if (status == 206 && expectedSize > 0 && !UpdateResumeContract.validContentRange(range, rangeStart, expectedSize)) throw IOException("Download range was not accepted. Retry.")
                headers?.onHeaders(status, etag, range, type)
                val append = status == 206 && rangeStart > 0
                var written = if (append) rangeStart else 0L
                connection.inputStream.use { input ->
                    FileOutputStream(destination, append).use { output ->
                        val buffer = ByteArray(65536)
                        while (true) {
                            if (cancel.cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
                            if (System.nanoTime() > deadlineNs) throw IOException("Download timed out. Retry.")
                            val n = input.read(buffer)
                            if (n < 0) break
                            written += n
                            if (expectedSize > 0 && written > expectedSize) throw IOException("Download exceeds expected APK size.")
                            output.write(buffer, 0, n)
                            progress.onBytes(written)
                        }
                        output.fd.sync()
                    }
                }
                if (expectedSize > 0 && written != expectedSize) throw IOException("Download interrupted. Retry to continue the download.")
                return StreamResult(status, written, etag, range, type)
            } catch (e: HttpFailure) {
                throw e
            } catch (e: InterruptedIOException) {
                throw e
            } catch (e: IOException) {
                throw sanitize(e, "Download interrupted. Retry to continue the download.")
            } finally {
                connection.disconnect()
                cancel.connection.set(null)
            }
        }
        throw IOException("Too many download redirects.")
    }

    private fun open(url: String, method: String, extra: Map<String, String>, cancel: CancelHandle): HttpURLConnection {
        if (cancel.cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
        val connection = URL(url).openConnection() as HttpURLConnection
        cancel.connection.set(connection)
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = if (method == "HEAD") 20_000 else 45_000
        connection.requestMethod = method
        connection.setRequestProperty("User-Agent", USER_AGENT)
        connection.setRequestProperty("Accept-Encoding", "identity")
        for ((key, value) in extra) connection.setRequestProperty(key, value)
        return connection
    }

    private fun headerMap(connection: HttpURLConnection): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        var i = 0
        while (true) {
            val key = connection.getHeaderFieldKey(i) ?: if (i == 0) { i++; continue } else break
            val value = connection.getHeaderField(i) ?: ""
            out[key.lowercase(Locale.US)] = value
            i++
        }
        return out
    }

    private fun readLimited(input: InputStream?, max: Int): ByteArray {
        if (input == null) return ByteArray(0)
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val n = stream.read(buffer)
                if (n < 0) break
                if (output.size() + n > max) throw IOException("Release metadata exceeds limits.")
                output.write(buffer, 0, n)
            }
            return output.toByteArray()
        }
    }

    private fun sanitize(error: IOException, fallback: String): IOException {
        if (error is HttpFailure || error is InterruptedIOException) return error
        val safe = UpdateTexts.sanitize(error.message).ifBlank { fallback }
        // Keep the original type/cause so the coordinator can classify DNS,
        // refused connections and timeouts. Every cause message is sanitized
        // before it reaches the technical-details view.
        return IOException(if (safe.contains("://")) fallback else safe, error)
    }
}

object GithubGate : RedirectGate {
    override fun allowed(initial: String, target: String): Boolean {
        val api = UpdateRedirectPolicy.isTrustedReleaseApiUrl(initial)
        return UpdateRedirectPolicy.isAllowedRedirect(initial, target, api)
    }
}

object LocalhostGate : RedirectGate {
    override fun allowed(initial: String, target: String): Boolean {
        val host = try { URI(target).host } catch (_: Exception) { null } ?: return false
        return host == "127.0.0.1" || host == "localhost"
    }
}

/** Minimal JSON reader for the public release document. No third-party parser. */
internal class Json private constructor(
    private val kind: Int,
    private val text: String,
    private val number: Long,
    private val flag: Boolean,
    private val fields: Map<String, Json>?,
    private val items: List<Json>?
) {
    fun asObject(): Map<String, Json> = fields ?: throw IOException("Release metadata was not a JSON object.")
    fun asArray(): List<Json> = items ?: throw IOException("Release metadata was not a JSON array.")
    fun asString(): String { if (kind != STRING) throw IOException("Release metadata field was not text."); return text }
    fun asBoolean(): Boolean { if (kind != BOOL) throw IOException("Release metadata flag was not a boolean."); return flag }
    fun asLong(): Long { if (kind != NUMBER) throw IOException("Release metadata size was not a number."); return number }
    fun isNull(): Boolean = kind == NULL

    companion object {
        private const val NULL = 0
        private const val BOOL = 1
        private const val NUMBER = 2
        private const val STRING = 3
        private const val OBJECT = 4
        private const val ARRAY = 5
        fun parse(raw: String): Json {
            val p = Parser(raw)
            val value = p.value()
            p.skip()
            if (!p.end()) throw IOException("Release metadata has trailing data.")
            return value
        }
    }

    private class Parser(private val raw: String) {
        private var i = 0
        fun end() = i >= raw.length
        fun skip() { while (i < raw.length && raw[i].isWhitespace()) i++ }
        fun value(): Json {
            skip()
            if (i >= raw.length) throw IOException("Release metadata ended early.")
            return when (raw[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> Json(STRING, str(), 0, false, null, null)
                't' -> { literal("true"); Json(BOOL, "", 0, true, null, null) }
                'f' -> { literal("false"); Json(BOOL, "", 0, false, null, null) }
                'n' -> { literal("null"); Json(NULL, "", 0, false, null, null) }
                else -> Json(NUMBER, "", num(), false, null, null)
            }
        }
        private fun obj(): Json {
            i++
            val map = LinkedHashMap<String, Json>()
            skip()
            if (peek('}')) return Json(OBJECT, "", 0, false, map, null)
            while (true) {
                skip()
                if (i >= raw.length || raw[i] != '"') throw IOException("Release metadata object is malformed.")
                val key = str()
                skip()
                if (i >= raw.length || raw[i] != ':') throw IOException("Release metadata object is malformed.")
                i++
                map[key] = value()
                skip()
                if (peek('}')) return Json(OBJECT, "", 0, false, map, null)
                if (i >= raw.length || raw[i] != ',') throw IOException("Release metadata object is malformed.")
                i++
            }
        }
        private fun arr(): Json {
            i++
            val list = ArrayList<Json>()
            skip()
            if (peek(']')) return Json(ARRAY, "", 0, false, null, list)
            while (true) {
                list.add(value())
                skip()
                if (peek(']')) return Json(ARRAY, "", 0, false, null, list)
                if (i >= raw.length || raw[i] != ',') throw IOException("Release metadata array is malformed.")
                i++
            }
        }
        private fun peek(c: Char): Boolean { if (i < raw.length && raw[i] == c) { i++; return true }; return false }
        private fun literal(text: String) {
            if (!raw.startsWith(text, i)) throw IOException("Release metadata is malformed.")
            i += text.length
        }
        private fun num(): Long {
            val start = i
            if (i < raw.length && raw[i] == '-') i++
            if (i >= raw.length || !raw[i].isDigit()) throw IOException("Release metadata number is malformed.")
            while (i < raw.length && raw[i].isDigit()) i++
            if (i < raw.length && (raw[i] == '.' || raw[i] == 'e' || raw[i] == 'E')) throw IOException("Release metadata number is not an integer.")
            return raw.substring(start, i).toLongOrNull() ?: throw IOException("Release metadata number is out of range.")
        }
        private fun str(): String {
            i++
            val out = StringBuilder()
            while (i < raw.length) {
                val c = raw[i++]
                when (c) {
                    '"' -> return out.toString()
                    '\\' -> {
                        if (i >= raw.length) throw IOException("Release metadata string is malformed.")
                        when (val e = raw[i++]) {
                            '"', '\\', '/' -> out.append(e)
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000c')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                if (i + 4 > raw.length) throw IOException("Release metadata string is malformed.")
                                val hex = raw.substring(i, i + 4)
                                i += 4
                                out.append(hex.toIntOrNull(16)?.toChar() ?: throw IOException("Release metadata string is malformed."))
                            }
                            else -> throw IOException("Release metadata string is malformed.")
                        }
                    }
                    else -> out.append(c)
                }
            }
            throw IOException("Release metadata string is malformed.")
        }
    }
}
