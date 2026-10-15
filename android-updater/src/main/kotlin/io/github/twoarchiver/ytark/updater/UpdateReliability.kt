package io.github.twoarchiver.ytark.updater

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.URI
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
    fun complete(): Boolean = tag.startsWith("v") && sha256.length == 64 && size > 0 && asset.isNotEmpty() && url.startsWith("https://")
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
    class RateLimited(@JvmField val retryAt: Long, @JvmField val cache: CachedRelease?) : Discovery()
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
    @JvmStatic fun sanitize(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        var text = raw.replace(Regex("https?://\\S+"), "[url]")
        text = text.replace(Regex("(?i)(token|authorization|password|secret|sig|credential)=([^\\s&]+)"), "$1=[redacted]")
        text = text.replace(Regex("\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b"), "[ip]")
        text = text.replace(Regex("[\\r\\n\\t]+"), " ").trim()
        return if (text.length <= 240) text else text.take(237) + "..."
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
    @JvmStatic fun isLimited(status: Int, remaining: String?, retryAfter: String?, reset: String?, body: String?): Boolean {
        if (status == 429) return true
        if (status != 403) return false
        if (remaining?.trim() == "0") return true
        if (!retryAfter.isNullOrBlank() || !reset.isNullOrBlank()) return true
        val text = body?.lowercase(Locale.US) ?: ""
        return text.contains("rate limit") || text.contains("too many requests") || text.contains("secondary rate")
    }

    /** Header deadline when present; otherwise a bounded wait. Never a tight loop. */
    @JvmStatic fun retryAtMillis(status: Int, retryAfter: String?, reset: String?, remaining: String?, body: String?, now: Long): Long {
        val limited = isLimited(status, remaining, retryAfter, reset, body)
        val parsed = UpdateSchedulePolicy.retryDeadlineMillis(retryAfter, reset, now)
        val hasHeader = parsed > now && (retryAfter?.trim()?.isNotEmpty() == true || reset?.trim()?.toLongOrNull() != null)
        val chosen = when {
            limited && hasHeader -> parsed
            limited -> now + 15 * 60_000L
            status in 500..599 -> now + 60_000L
            else -> maxOf(now + 60_000L, parsed)
        }
        return chosen.coerceIn(now + 60_000L, now + 24 * 60 * 60_000L)
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
        val detail = buildString {
            append("Stage: ").append(if (stage.isBlank()) "updater" else stage)
            if (tag.isNotBlank()) append("\nRelease: ").append(tag.take(32))
            if (http != null) append("\nHTTP status: ").append(http.status)
            append("\nCategory: ")
            append(UpdateTexts.sanitize(names).ifBlank { "error" })
        }
        if (http != null && http.category == "rate_limit") {
            return MappedError("rate_limit", http.message ?: RateLimitPolicy.message(http.retryAt, now, TimeZone.getDefault()), detail, http.retryAt, http.status, stage)
        }
        val lower = raw.lowercase(Locale.US)
        val category = when {
            names.contains("SocketTimeout") || names.contains("UnknownHost") || names.contains("ConnectException") || lower.contains("timed out") || lower.contains("timeout") -> "timeout"
            lower.contains("no compatible") || lower.contains("armeabi-v7a") || lower.contains("no unique compatible") -> "no_compatible_apk"
            lower.contains("not enough storage") || lower.contains("no space") || lower.contains("enospc") -> "storage"
            lower.contains("signer is incompatible") || lower.contains("signature mismatch") || lower.contains("signatures do not match") -> "signature_mismatch"
            lower.contains("checksum") || lower.contains("signature verification") || lower.contains("corrupt apk") || lower.contains("malformed") || names.contains("ApkFormat") || names.contains("ZipException") -> "verification"
            lower.contains("install permission") || lower.contains("unknown apps") -> "permission"
            lower.contains("installation cancelled") || lower.contains("install cancelled") -> "install_cancelled"
            lower.contains("download cancelled") -> "cancelled"
            lower.contains("interrupted") || lower.contains("download") && lower.contains("fail") -> "download_interrupted"
            names.contains("UnknownHost") || names.contains("ConnectException") -> "offline"
            http != null -> "http"
            else -> "unexpected"
        }
        val message = when (category) {
            "timeout", "offline" -> "Connection timed out. Check the network and retry."
            "no_compatible_apk" -> firstSafe(raw, "No compatible APK found. This release has no ARMv7 package for this device.")
            "storage" -> "Not enough storage. Free space and retry."
            "signature_mismatch" -> "App signature mismatch. The installed app was not removed or replaced."
            "verification" -> "APK verification failed. The file was discarded and was not installed."
            "permission" -> "Install permission required. Enable Allow from this source for YTArk, then select Install update."
            "install_cancelled" -> "Installation cancelled. The downloaded APK is kept; select Install update to retry."
            "cancelled" -> "Download cancelled. Retry when ready."
            "download_interrupted" -> "Download interrupted. Retry to continue the download."
            "http" -> "The update service returned HTTP ${http?.status ?: 0}. Try again later."
            else -> "The update stopped because of an unexpected error. Your installed app is unchanged."
        }
        val retry = http?.retryAt ?: (now + 60_000L)
        return MappedError(category, message, detail, retry, http?.status ?: 0, stage)
    }

    private fun firstSafe(raw: String, fallback: String): String {
        val line = raw.lineSequence().map { it.trim() }.firstOrNull { it.startsWith("No compatible APK found") && !it.contains("://") && it.length <= 220 }
        return line ?: fallback
    }
}

object UpdateStates {
    @JvmStatic fun checking(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.Checking, message = "Checking stable ARMv7 release…", detail = "", errorCategory = "", httpStatus = 0, speedBps = 0, stale = false, bytes = 0)
    @JvmStatic fun upToDate(s: UpdateState, version: String, now: Long): UpdateState = s.copy(phase = UpdatePhase.Idle, candidate = null, verifiedPath = null, pendingIdentity = null, lastSuccess = now, bytes = 0, stale = false, detail = "", errorCategory = "", httpStatus = 0, speedBps = 0, message = "Installed version is current. Latest compatible: $version.")
    @JvmStatic fun available(s: UpdateState, candidate: Candidate, now: Long, verified: String?): UpdateState = s.copy(phase = UpdatePhase.Available, candidate = candidate, verifiedPath = verified, pendingIdentity = null, lastSuccess = now, bytes = 0, stale = false, detail = "", errorCategory = "", httpStatus = 0, speedBps = 0, message = "YTArk ${candidate.version} is available.")
    @JvmStatic fun staleAvailable(s: UpdateState, candidate: Candidate, retryAt: Long, message: String): UpdateState = s.copy(phase = UpdatePhase.Available, candidate = candidate, pendingIdentity = null, stale = true, retryAt = retryAt, message = message, errorCategory = "rate_limit", stage = "check", speedBps = 0)
    @JvmStatic fun downloading(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.Downloading, message = "Downloading update…", verifiedPath = null, bytes = 0, speedBps = 0, detail = "", errorCategory = "", stale = false)
    @JvmStatic fun progress(s: UpdateState, bytes: Long, speed: Long): UpdateState = s.copy(phase = UpdatePhase.Downloading, bytes = bytes, speedBps = speed)
    @JvmStatic fun verifying(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.Validating, message = "Verifying package, version, ABI, checksum and signer…", speedBps = 0)
    @JvmStatic fun ready(s: UpdateState, path: String): UpdateState = s.copy(phase = UpdatePhase.Ready, verifiedPath = path, pendingIdentity = null, message = "Update ready. Select Install update; Android will ask for confirmation.", speedBps = 0, errorCategory = "", detail = "")
    @JvmStatic fun cancelled(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.Available, pendingIdentity = null, message = "Download cancelled. Retry when ready.", speedBps = 0, bytes = 0, errorCategory = "cancelled")
    @JvmStatic fun failed(s: UpdateState, mapped: MappedError, tag: String): UpdateState = s.copy(phase = UpdatePhase.Failed, pendingIdentity = null, message = mapped.message, detail = mapped.detail, retryAt = mapped.retryAt, errorCategory = mapped.category, stage = mapped.stage.ifBlank { "updater" }, httpStatus = mapped.httpStatus, speedBps = 0, releaseTag = tag)
    @JvmStatic fun permission(s: UpdateState, identity: String): UpdateState = s.copy(phase = UpdatePhase.AwaitingPermission, pendingIdentity = identity, message = "Install permission required. Enable Allow from this source for YTArk, then return.")
    @JvmStatic fun handedToSystem(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.AwaitingInstaller, pendingIdentity = null, message = "Handed to Android's installer. Installation is not confirmed yet.")
    @JvmStatic fun permissionDenied(s: UpdateState): UpdateState = s.copy(phase = if (s.verifiedPath != null) UpdatePhase.Ready else UpdatePhase.Available, pendingIdentity = null, message = "Install permission required. Enable Allow from this source for YTArk, then select Install update.", errorCategory = "permission", stage = "install")
    @JvmStatic fun installUnconfirmed(s: UpdateState): UpdateState = s.copy(phase = if (s.verifiedPath != null) UpdatePhase.Ready else UpdatePhase.Available, pendingIdentity = null, message = "Installation was not confirmed. Select Install update to retry; the downloaded APK is kept.")
    @JvmStatic fun installed(s: UpdateState): UpdateState = s.copy(phase = UpdatePhase.Idle, candidate = null, verifiedPath = null, pendingIdentity = null, bytes = 0, stale = false, detail = "", errorCategory = "", message = "Update installed. Your application data was not cleared.")
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

    @JvmStatic @Throws(IOException::class)
    fun parse(json: String, sums: String?): ParsedRelease {
        val root = Json.parse(json).asObject()
        val hasDraft = root.containsKey("draft")
        val hasPre = root.containsKey("prerelease")
        val draft = root["draft"]?.asBoolean() ?: false
        val pre = root["prerelease"]?.asBoolean() ?: false
        UpdateReleaseContract.requirePublishedStable(hasDraft, draft, hasPre, pre)
        val tag = root["tag_name"]?.asString() ?: throw IOException("Invalid release tag.")
        requireUpdate(tag.startsWith("v"), "Invalid release tag.")
        val version = tag.removePrefix("v")
        val code = UpdateReleaseContract.expectedVersionCodeForVersion(version)
        val body = root["body"]?.asString() ?: ""
        requireUpdate(UpdateReleaseContract.parseVersionCode(body) == code, "Release versionCode disagrees with tag.")
        val expected = UpdateReleaseContract.assetNameForVersion(version, "armv7")
        val assets = root["assets"]?.asArray() ?: emptyList()
        val remote = assets.map { item ->
            val obj = item.asObject()
            RemoteAsset(
                obj["name"]?.asString() ?: "",
                obj["browser_download_url"]?.asString() ?: "",
                obj["size"]?.asLong() ?: -1L,
                obj["digest"]?.asString() ?: "",
                obj["content_type"]?.asString() ?: ""
            )
        }
        val apk = select(remote, expected, tag)
        val url = UpdateReleaseContract.requireOfficialAssetUrl(apk.url, tag, apk.name)
        var digest = UpdateReleaseContract.parseSha256Digest(apk.digest)
        requireUpdate(apk.digest.isEmpty() || apk.digest == "null" || digest != null, "Malformed release digest.")
        val sumsAssets = remote.filter { it.name == "SHA256SUMS.txt" }
        requireUpdate(sumsAssets.size <= 1, "Duplicate checksum asset.")
        val sumsUrl = if (sumsAssets.isEmpty()) "" else UpdateReleaseContract.requireOfficialAssetUrl(sumsAssets[0].url, tag, "SHA256SUMS.txt")
        if (sums != null && sumsUrl.isNotEmpty()) {
            val published = UpdateReleaseContract.checksumForAsset(sums, expected)
            requireUpdate(digest == null || digest == published, "Release checksums disagree.")
            digest = published
        }
        requireUpdate(digest != null, "Release has no trusted APK checksum.")
        val notes = body.substringBefore("<!--").lineSequence().filter { !it.contains("http") }.take(12).joinToString("\n").take(1800)
        val candidate = Candidate(tag, code, expected, url, apk.size, digest!!, notes)
        return ParsedRelease(candidate, sumsUrl, sums == null && sumsUrl.isNotEmpty())
    }

    private fun select(assets: List<RemoteAsset>, expected: String, tag: String): RemoteAsset {
        val named = assets.filter { it.name == expected }
        if (named.isEmpty()) {
            val other = assets.any { it.name.endsWith(".apk") }
            throw IOException(if (other) "No compatible APK found. Release $tag has no ARMv7 package for this device." else "No compatible APK found. Release $tag has no YTArk ARMv7 package.")
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
            if (e.category == "rate_limit") return Discovery.RateLimited(e.retryAt, cache)
        } catch (_: IOException) {
            // The public latest-page redirect is an optimisation. The API remains authoritative.
        }
        return fetchApi(cache, now)
    }

    private fun fetchApi(cache: CachedRelease?, now: Long): Discovery {
        val doc = try {
            source.metadata(cache?.etag?.ifBlank { null }, cache?.lastModified?.ifBlank { null })
        } catch (e: HttpFailure) {
            if (e.category == "rate_limit") return Discovery.RateLimited(e.retryAt, cache)
            throw e
        }
        if (doc.status == 304 && cache != null) return Discovery.UseCache(cache.touched(now), false, 0L)
        requireUpdate(doc.status == 200 && doc.body.isNotEmpty(), "GitHub HTTP ${doc.status}. Try again later.")
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
    private const val USER_AGENT = "YTArk/3.3 (+https://github.com/2archiver/YTArk)"

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
        return IOException(if (safe.contains("://")) fallback else safe)
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
