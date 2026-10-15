package io.github.twoarchiver.ytark.updater

import java.io.IOException
import java.util.TimeZone

/**
 * HTTPS only, bounded redirects and payloads. No credentials, cookies or URL logging.
 * The public /releases/latest redirect is used only to read a stable tag. Draft and
 * prerelease releases are still rejected from the API document itself.
 */
class ReleaseHttp : MetadataSource {
    private val current = java.util.concurrent.atomic.AtomicReference<CancelHandle?>(null)
    fun cancel() { current.get()?.cancel() }

    private fun <T> call(block: (CancelHandle) -> T): T {
        val handle = CancelHandle()
        current.set(handle)
        try {
            return block(handle)
        } finally {
            current.compareAndSet(handle, null)
        }
    }

    override fun probeLatestTag(): String = call { handle ->
        val url = UpdateRedirectPolicy.LATEST_PAGE
        requireUpdate(UpdateRedirectPolicy.isTrustedLatestReleasePage(url), "Untrusted release source.")
        val head = JdkHttp.exchange(url, "HEAD", mapOf("Accept" to "text/html"), GithubGate, 1024, false, handle)
        if (RateLimitPolicy.isLimited(head.status, head.header("x-ratelimit-remaining"), head.header("retry-after"), head.header("x-ratelimit-reset"), head.body)) {
            throw rate(head.status, head)
        }
        if (UpdateRedirectPolicy.isRedirectStatus(head.status)) {
            val tag = UpdateRedirectPolicy.latestTag(absolute(url, head.header("location")))
            requireUpdate(tag != null, "Unexpected latest-release redirect.")
            return@call tag!!
        }
        if (head.status == 403 || head.status == 404 || head.status in 500..599) {
            throw httpFailure(head)
        }
        // HEAD may be unsupported by an intermediary. Only this non-error
        // optimization failure falls back to the authoritative API endpoint.
        throw IOException("Could not resolve the latest stable release page (HTTP ${head.status}).")
    }

    override fun metadata(etag: String?, lastModified: String?): MetadataDocument = call { handle ->
        val url = "https://api.github.com/repos/2archiver/YTArk/releases/latest"
        requireUpdate(UpdateRedirectPolicy.isTrustedReleaseApiUrl(url), "Untrusted release source.")
        val headers = LinkedHashMap<String, String>()
        headers["Accept"] = "application/vnd.github+json"
        if (!etag.isNullOrBlank()) headers["If-None-Match"] = etag
        if (!lastModified.isNullOrBlank()) headers["If-Modified-Since"] = lastModified
        val result = JdkHttp.exchange(url, "GET", headers, GithubGate, 1024 * 1024, true, handle)
        if (result.status == 304) return@call MetadataDocument(304, "", etag ?: "", lastModified ?: "")
        if (result.status != 200) throw httpFailure(result)
        MetadataDocument(200, result.body, result.header("etag") ?: "", result.header("last-modified") ?: "")
    }

    override fun text(url: String): String = call { handle ->
        requireUpdate(UpdateRedirectPolicy.isTrustedReleaseAssetUrl(url), "Untrusted release source.")
        val result = JdkHttp.exchange(url, "GET", mapOf("Accept" to "text/plain"), GithubGate, 1024 * 1024, true, handle)
        if (result.status != 200) throw httpFailure(result)
        result.body
    }

    private fun httpFailure(result: HttpResult): HttpFailure {
        if (RateLimitPolicy.isLimited(result.status, result.header("x-ratelimit-remaining"), result.header("retry-after"), result.header("x-ratelimit-reset"), result.body)) {
            return rate(result.status, result)
        }
        return HttpFailure(result.status, System.currentTimeMillis() + 60_000L, "GitHub HTTP ${result.status}. Try again later.", "http")
    }

    private fun rate(status: Int, result: HttpResult): HttpFailure {
        val now = System.currentTimeMillis()
        val retry = RateLimitPolicy.retryAtMillis(status, result.header("retry-after"), result.header("x-ratelimit-reset"), result.header("x-ratelimit-remaining"), result.body, now)
        return HttpFailure(status, retry, RateLimitPolicy.message(retry, now, TimeZone.getDefault()), "rate_limit")
    }

    private fun absolute(base: String, location: String?): String? {
        if (location.isNullOrBlank()) return null
        return try { java.net.URL(java.net.URL(base), location).toString() } catch (_: Exception) { null }
    }
}
