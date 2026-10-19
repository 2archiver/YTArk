package io.github.twoarchiver.ytark.updater

import android.content.Context
import org.json.JSONObject

/** Only this file owns persisted updater state. Old preferences are read, never cleared wholesale. */
class UpdateStore(context: Context) {
    // Deferred until the coordinator's serialized worker first loads state.
    // Constructing the application-scoped coordinator on a UI path is therefore
    // free of preference reads or storage initialization.
    val prefs by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        context.getSharedPreferences("ytark_native_updater", Context.MODE_PRIVATE)
    }
    fun load(): UpdateState {
        val hours = ScheduleRules.interval(if (prefs.contains("v31_hours")) prefs.getInt("v31_hours", 1) else null, prefs.getBoolean("automatic_checks_enabled", true))
        val raw = prefs.getString("v31_state", null) ?: return UpdateState(hours = hours)
        return try {
            val j = JSONObject(raw)
            val c = j.optJSONObject("candidate")?.let {
                val tag = it.getString("tag"); val code = it.getLong("code"); val asset = it.getString("asset"); val url = it.getString("url"); val hash = it.getString("hash"); val size = it.getLong("size")
                requireUpdate(code == UpdateReleaseContract.expectedVersionCodeForVersion(tag.removePrefix("v")), "Invalid saved version.")
                UpdateReleaseContract.requireOfficialAssetUrl(url, tag, asset)
                requireUpdate(UpdateReleaseContract.parseSha256Digest(hash) == hash && size in 1..512L * 1024 * 1024, "Invalid saved asset.")
                Candidate(tag, code, asset, url, size, hash, it.optString("notes").take(1800))
            }
            val latestVersion = j.optString("latestVersion").takeIf { raw ->
                try { UpdateReleaseContract.expectedVersionCodeForVersion(raw); true } catch (_: Exception) { false }
            } ?: ""
            UpdateState(
                UpdatePhase.valueOf(j.getString("phase")), c, j.optString("message"), j.optLong("bytes"), j.optLong("success"),
                ScheduleRules.interval(j.optInt("hours", hours)), j.optString("path").takeIf { it.isNotEmpty() }, j.optString("pending").takeIf { it.isNotEmpty() },
                j.optString("detail"), j.optLong("retryAt"), j.optBoolean("stale"), j.optString("category"), j.optString("stage"), j.optInt("http"), 0L,
                j.optString("tag"), latestVersion, j.optBoolean("installedAhead") && latestVersion.isNotBlank(),
                j.optBoolean("latestVersionStale", j.optBoolean("stale"))
            )
        } catch (_: Exception) { UpdateState(hours = hours, message = "Saved update state was invalid. Check again; installed app is unchanged.") }
    }
    fun save(s: UpdateState) {
        val j = JSONObject().put("phase", s.phase.name).put("message", s.message).put("bytes", s.bytes).put("success", s.lastSuccess).put("hours", s.hours)
            .put("path", s.verifiedPath ?: "").put("pending", s.pendingIdentity ?: "").put("detail", s.detail).put("retryAt", s.retryAt)
            .put("stale", s.stale).put("category", s.errorCategory).put("stage", s.stage).put("http", s.httpStatus).put("tag", s.releaseTag)
            .put("latestVersion", s.latestVersion).put("installedAhead", s.installedAhead)
            .put("latestVersionStale", s.latestVersionStale)
        s.candidate?.let { j.put("candidate", JSONObject().put("tag", it.tag).put("code", it.code).put("asset", it.asset).put("url", it.url).put("size", it.size).put("hash", it.sha256).put("notes", it.notes)) }
        requireUpdate(prefs.edit().putInt("v31_hours", s.hours).putString("v31_state", j.toString()).commit(), "Could not persist updater state. Check free storage.")
    }
    fun loadCache(): CachedRelease? {
        val raw = prefs.getString("v33_cache", null) ?: return null
        return try {
            val j = JSONObject(raw)
            val cache = CachedRelease(j.getLong("fetchedAt"), j.optString("etag"), j.optString("modified"), j.getString("tag"), j.getLong("code"), j.getString("asset"), j.getString("url"), j.getLong("size"), j.getString("hash"), j.optString("notes"), j.optBoolean("sums"))
            if (!cache.complete()) null else cache
        } catch (_: Exception) { null }
    }
    fun saveCache(c: CachedRelease) {
        val j = JSONObject().put("fetchedAt", c.fetchedAt).put("etag", c.etag).put("modified", c.lastModified).put("tag", c.tag).put("code", c.code)
            .put("asset", c.asset).put("url", c.url).put("size", c.size).put("hash", c.sha256).put("notes", c.notes).put("sums", c.sumsVerified)
        prefs.edit().putString("v33_cache", j.toString()).apply()
    }
    fun rateUntil(): Long = prefs.getLong("v33_rate_until", 0)
    fun setRateUntil(until: Long) { prefs.edit().putLong("v33_rate_until", until).apply() }
    fun failures(): Int = prefs.getInt("v33_failures", 0)
    fun setFailures(count: Int) { prefs.edit().putInt("v33_failures", count).apply() }
}
