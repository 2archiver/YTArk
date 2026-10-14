package io.github.twoarchiver.ytark.updater

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

class HttpFailure(val status: Int, val retryAt: Long) : IOException(if (status == 403 || status == 429) "GitHub rate limit. Retry after the wait period." else "GitHub HTTP $status. Try again later.")

/** HTTPS only, bounded redirects and payloads. No credentials or sensitive URL logging. */
class ReleaseHttp {
    @Volatile private var active: HttpURLConnection? = null
    fun cancel() { active?.disconnect() }
    fun open(address: String): HttpURLConnection {
        val api = UpdateRedirectPolicy.isTrustedReleaseApiUrl(address)
        requireUpdate(api || UpdateRedirectPolicy.isTrustedReleaseAssetUrl(address), "Untrusted release source.")
        var next = address
        repeat(6) {
            val c = URL(next).openConnection() as HttpURLConnection
            active = c
            c.instanceFollowRedirects = false; c.connectTimeout = 15000; c.readTimeout = 20000
            c.setRequestProperty("User-Agent", "YTArk-Updater/3.1")
            c.setRequestProperty("Accept", if(api) "application/vnd.github+json" else "application/octet-stream")
            c.setRequestProperty("Accept-Encoding", "identity")
            val status = try { c.responseCode } catch(e: Exception) { c.disconnect(); throw e }
            if (UpdateRedirectPolicy.isRedirectStatus(status)) {
                val target = c.getHeaderField("Location")?.let { URL(URL(next), it).toString() }
                c.disconnect()
                requireUpdate(UpdateRedirectPolicy.isAllowedRedirect(address,target,api), "Untrusted download redirect.")
                next = target!!
            } else {
                if (status != 200) {
                    val retry = UpdateSchedulePolicy.retryDeadlineMillis(c.getHeaderField("Retry-After"),c.getHeaderField("X-RateLimit-Reset"),System.currentTimeMillis())
                    c.disconnect(); throw HttpFailure(status,retry)
                }
                return c
            }
        }
        throw IOException("Too many download redirects.")
    }
    fun text(url: String): String {
        val c = open(url)
        try {
            return c.inputStream.use { input ->
                val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
                val deadline = System.nanoTime() + 60000000000L
                while(true) { val n=input.read(buffer); if(n<0) break; requireUpdate(output.size()+n <= 1024*1024 && System.nanoTime() < deadline,"Release metadata exceeds limits."); output.write(buffer,0,n) }
                output.toString("UTF-8")
            }
        } finally { c.disconnect(); active=null }
    }
}
class UpdateRepository(private val http: ReleaseHttp) {
    fun latest(): Candidate {
        val release = JSONObject(http.text("https://api.github.com/repos/2archiver/YTArk/releases/latest"))
        // Require booleans, not coercions from missing/string flags.
        requireUpdate(release.opt("draft") == false && release.opt("prerelease") == false, "Release is not published stable.")
        val tag = release.getString("tag_name")
        requireUpdate(tag.startsWith("v"), "Invalid release tag.")
        val version = tag.drop(1)
        val code = UpdateReleaseContract.expectedVersionCodeForVersion(version)
        val body = release.optString("body", "")
        requireUpdate(UpdateReleaseContract.parseVersionCode(body) == code, "Release versionCode disagrees with tag.")
        val name = UpdateReleaseContract.assetNameForVersion(version,"armv7")
        val assets = release.getJSONArray("assets")
        val matching = (0 until assets.length()).map { assets.getJSONObject(it) }
        val apk = matching.singleOrNull { it.optString("name") == name } ?: throw IOException("No unique compatible ARMv7 APK in the stable release.")
        val url = UpdateReleaseContract.requireOfficialAssetUrl(apk.getString("browser_download_url"),tag,name)
        val size = apk.getLong("size")
        requireUpdate(size in 1..512L*1024*1024,"APK size exceeds limits.")
        val rawDigest = apk.optString("digest", "")
        var digest = UpdateReleaseContract.parseSha256Digest(rawDigest)
        requireUpdate(rawDigest.isEmpty() || rawDigest == "null" || digest != null, "Malformed release digest.")
        val sums = matching.filter { it.optString("name") == "SHA256SUMS.txt" }
        requireUpdate(sums.size <= 1,"Duplicate checksum asset.")
        if (sums.isNotEmpty()) {
            val sumsUrl=UpdateReleaseContract.requireOfficialAssetUrl(sums[0].getString("browser_download_url"),tag,"SHA256SUMS.txt")
            val published = UpdateReleaseContract.checksumForAsset(http.text(sumsUrl),name)
            requireUpdate(digest == null || digest == published,"Release checksums disagree."); digest=published
        }
        requireUpdate(digest != null,"Release has no trusted APK checksum.")
        val notes = body.substringBefore("<!--").lineSequence().filter { !it.contains("http") }.take(12).joinToString("\n").take(1800)
        return Candidate(tag,code,name,url,size,digest!!,notes)
    }
}
