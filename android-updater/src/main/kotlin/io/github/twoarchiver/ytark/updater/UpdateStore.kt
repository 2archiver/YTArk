package io.github.twoarchiver.ytark.updater

import android.content.Context
import org.json.JSONObject

/** Only this file owns persisted updater state. Old preferences are read, never cleared wholesale. */
class UpdateStore(context: Context) {
    val prefs=context.getSharedPreferences("ytark_native_updater",Context.MODE_PRIVATE)
    fun load(): UpdateState {
        val hours=ScheduleRules.interval(if(prefs.contains("v31_hours")) prefs.getInt("v31_hours",1) else null,prefs.getBoolean("automatic_checks_enabled",true))
        val raw=prefs.getString("v31_state",null)
        if(raw==null) return UpdateState(hours=hours)
        return try {
            val j=JSONObject(raw)
            val c=j.optJSONObject("candidate")?.let {
                val tag=it.getString("tag"); val code=it.getLong("code"); val asset=it.getString("asset"); val url=it.getString("url"); val hash=it.getString("hash"); val size=it.getLong("size")
                requireUpdate(code==UpdateReleaseContract.expectedVersionCodeForVersion(tag.removePrefix("v")),"Invalid saved version.")
                UpdateReleaseContract.requireOfficialAssetUrl(url,tag,asset)
                requireUpdate(UpdateReleaseContract.parseSha256Digest(hash)==hash && size in 1..512L*1024*1024,"Invalid saved asset.")
                Candidate(tag,code,asset,url,size,hash,it.optString("notes").take(1800))
            }
            UpdateState(UpdatePhase.valueOf(j.getString("phase")),c,j.optString("message"),j.optLong("bytes"),j.optLong("success"),ScheduleRules.interval(j.optInt("hours",1)),j.optString("path").takeIf { it.isNotEmpty() },j.optString("pending").takeIf { it.isNotEmpty() })
        } catch (_: Exception) { UpdateState(hours=hours,message="Saved update state was invalid. Check again; installed app is unchanged.") }
    }
    fun save(s: UpdateState) {
        val j=JSONObject().put("phase",s.phase.name).put("message",s.message).put("bytes",s.bytes).put("success",s.lastSuccess).put("hours",s.hours).put("path",s.verifiedPath ?: "").put("pending",s.pendingIdentity ?: "")
        s.candidate?.let { j.put("candidate",JSONObject().put("tag",it.tag).put("code",it.code).put("asset",it.asset).put("url",it.url).put("size",it.size).put("hash",it.sha256).put("notes",it.notes)) }
        requireUpdate(prefs.edit().putInt("v31_hours",s.hours).putString("v31_state",j.toString()).commit(),"Could not persist updater state. Check free storage.")
    }
}
