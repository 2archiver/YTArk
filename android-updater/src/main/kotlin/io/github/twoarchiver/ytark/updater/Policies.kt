package io.github.twoarchiver.ytark.updater

import java.io.File
import java.io.IOException
import java.net.URI
import java.util.Properties
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

internal fun requireUpdate(ok: Boolean, message: String) { if (!ok) throw IOException(message) }

object InstallGate {
    enum class Step { NONE, REQUEST_PERMISSION, HANDOFF, WAIT_FOR_INSTALLER }
    @JvmStatic fun next(verifiedApkPresent: Boolean, installRequested: Boolean, permissionGranted: Boolean, handoffInFlight: Boolean) = when {
        !verifiedApkPresent -> Step.NONE
        handoffInFlight -> Step.WAIT_FOR_INSTALLER
        !installRequested -> Step.NONE
        permissionGranted -> Step.HANDOFF
        else -> Step.REQUEST_PERMISSION
    }
}
object InstallerResultPolicy {
    enum class Outcome { CONFIRMED, CANCELLED_WITH_VERIFIED_APK, UNCONFIRMED_WITH_VERIFIED_APK, UNCONFIRMED_NO_APK }
    @JvmStatic fun outcome(confirmed: Boolean, remains: Boolean, cancelled: Boolean) = when {
        confirmed -> Outcome.CONFIRMED
        !remains -> Outcome.UNCONFIRMED_NO_APK
        cancelled -> Outcome.CANCELLED_WITH_VERIFIED_APK
        else -> Outcome.UNCONFIRMED_WITH_VERIFIED_APK
    }
    @JvmStatic fun resolvedTargetVersionCode(target: Long, completed: Long) = if (target > 0) target else completed
    @JvmStatic fun installedVersionConfirms(installed: Long, target: Long) = target > 0 && installed >= target
    @JvmStatic fun shouldClearPendingRelease(pending: Long, confirmed: Long) = pending > 0 && confirmed > 0 && pending <= confirmed
}
object NativeAbiContract {
    const val ARMV7_SUFFIX = "armv7"
    const val ARMV7_ABI = "armeabi-v7a"
    const val LEGACY_ARM64_ABI = "arm64-v8a"
    @JvmStatic @Throws(IOException::class) fun assetSuffixForSupportedAbis(abis: Array<String>?) : String {
        requireUpdate(abis?.contains(ARMV7_ABI) == true, "Android does not report armeabi-v7a. Check ro.product.cpu.abilist; a 64-bit CPU alone is insufficient.")
        return ARMV7_SUFFIX
    }
    @JvmStatic @Throws(IOException::class) fun nativeAbiForSuffix(suffix: String?): String {
        requireUpdate(suffix == ARMV7_SUFFIX, "Unsupported architecture; ARMv7 only."); return ARMV7_ABI
    }
    @JvmStatic @Throws(IOException::class) fun assetSuffixForNativeAbi(abi: String?): String {
        requireUpdate(abi == ARMV7_ABI, "This installation is not armeabi-v7a; cross-ABI updates are not supported."); return ARMV7_SUFFIX
    }
    @JvmStatic @Throws(IOException::class) fun assetSuffixForInstalledAbi(abi: String?, supported: Array<String>?): String {
        val suffix = assetSuffixForNativeAbi(abi)
        requireUpdate(supported?.contains(abi) == true, "Installed ABI is not supported by this Android userspace."); return suffix
    }
}
object NativeRoutePolicy {
    @JvmStatic fun screenForRoute(raw: String?): String? = try {
        val u = URI(raw ?: "")
        if (raw != null && raw.length <= 512 && u.scheme.equals("ytark", true) && u.host.equals("updates", true) && u.userInfo == null && u.port == -1 && u.path.isNullOrEmpty() && u.rawQuery == null && u.fragment == null) "updates" else null
    } catch (_: Exception) { null }
    @JvmStatic fun isAllowedScreenRoute(raw: String?, expected: String?) = expected != null && expected == screenForRoute(raw)
}
object NativeThemePolicy {
    // Neutral YouTube dark surfaces; light focus matches the in-page TV rows.
    @JvmStatic fun background() = 0xff0f0f0f.toInt()
    @JvmStatic fun card() = 0xff272727.toInt()
    @JvmStatic fun divider() = 0xff3f3f3f.toInt()
    @JvmStatic fun primaryText() = 0xfff1f1f1.toInt()
    @JvmStatic fun secondaryText() = 0xffaaaaaa.toInt()
    @JvmStatic fun bodyText() = 0xfff1f1f1.toInt()
    @JvmStatic fun quietText() = 0xffaaaaaa.toInt()
    @JvmStatic fun focus() = 0xfff1f1f1.toInt()
    @JvmStatic fun onFocus() = 0xff0f0f0f.toInt()
    @JvmStatic fun disabledSurface() = 0xff181818.toInt()
    @JvmStatic fun disabledText() = 0xff888888.toInt()
}
object UpdateReleaseContract {
    private val clean = Regex("^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$")
    @JvmStatic @Throws(IOException::class) fun expectedVersionCodeForVersion(version: String?): Long {
        val m = clean.matchEntire(version ?: "") ?: throw IOException("Invalid stable version.")
        val parts = m.groupValues.drop(1).map { it.toLongOrNull() ?: throw IOException("Version overflow.") }
        val (a,b,c) = parts
        requireUpdate(a in 1..2100 && b in 0..99 && c in 0..99, "Version components out of range.")
        val code = a * 1000000 + b * 10000 + c * 100
        requireUpdate(code <= 2100000000, "Version code out of range."); return code
    }
    @JvmStatic @Throws(IOException::class) fun displayVersionForVersion(v: String): String { expectedVersionCodeForVersion(v); return if (v.endsWith(".0")) v.dropLast(2) else v }
    @JvmStatic @Throws(IOException::class) fun releaseTitleForVersion(v: String) = "YTArk ${displayVersionForVersion(v)}"
    @JvmStatic @Throws(IOException::class) fun tagForVersion(v: String): String { expectedVersionCodeForVersion(v); return "v$v" }
    @JvmStatic @Throws(IOException::class) fun requirePublishedStable(hasDraft: Boolean, draft: Boolean, hasPre: Boolean, pre: Boolean) { requireUpdate(hasDraft && hasPre && !draft && !pre, "Release is not explicitly published stable.") }
    @JvmStatic @Throws(IOException::class) fun assetNameForVersion(v: String, suffix: String): String { expectedVersionCodeForVersion(v); NativeAbiContract.nativeAbiForSuffix(suffix); return "YTArk-v$v-$suffix.apk" }
    @JvmStatic @Throws(IOException::class) fun requireOfficialAssetUrl(url: String?, tag: String?, name: String?): String {
        requireUpdate(tag?.startsWith("v") == true, "Invalid release tag.")
        val expected = assetNameForVersion(tag!!.substring(1), "armv7")
        requireUpdate(name == expected || name == "SHA256SUMS.txt", "Invalid release asset.")
        val official = "https://github.com/2archiver/YTArk/releases/download/$tag/$name"
        requireUpdate(url == official, "Untrusted release asset URL."); return official
    }
    @JvmStatic @Throws(IOException::class) fun parseVersionCode(body: String?): Long = Regex("(?i)version\\s*code\\s*[:=]?\\s*(\\d+)").find(body ?: "")?.groupValues?.get(1)?.toLongOrNull() ?: throw IOException("Missing versionCode metadata.")
    @JvmStatic fun parseSha256Digest(digest: String?): String? = digest?.trim()?.lowercase(Locale.US)?.removePrefix("sha256:")?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
    @JvmStatic @Throws(IOException::class) fun checksumForAsset(text: String?, asset: String?): String {
        val values = (text ?: "").lineSequence().map { it.trim().split(Regex("\\s+"), 2) }.filter { it.size == 2 && it[1].removePrefix("*") == asset }.toList()
        requireUpdate(values.size == 1, "Missing or duplicate APK checksum.")
        return parseSha256Digest(values[0][0]) ?: throw IOException("Invalid APK checksum.")
    }
}
object UpdateRedirectPolicy {
    private fun parse(s: String?): URI? = try { if (s == null || s.length > 8192) null else URI(s) } catch (_: Exception) { null }
    private fun secure(u: URI) = u.scheme.equals("https", true) && u.host != null && u.userInfo == null && u.port in listOf(-1,443) && u.fragment == null
    @JvmStatic fun isTrustedReleaseApiUrl(s: String?): Boolean { val u = parse(s) ?: return false; return secure(u) && u.host.equals("api.github.com", true) && u.path == "/repos/2archiver/YTArk/releases/latest" && u.query == null }
    @JvmStatic fun isTrustedReleaseAssetUrl(s: String?): Boolean {
        val u = parse(s) ?: return false
        return secure(u) && u.host.equals("github.com", true) && u.path.matches(Regex("/2archiver/YTArk/releases/download/v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)/(?:YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-armv7\\.apk|SHA256SUMS\\.txt)"))
    }
    @JvmStatic fun isAllowedRedirect(initial: String?, target: String?, api: Boolean): Boolean {
        if (api) return isTrustedReleaseApiUrl(initial) && isTrustedReleaseApiUrl(target)
        if (!isTrustedReleaseAssetUrl(initial)) return false
        val u = parse(target) ?: return false
        return secure(u) && u.host.lowercase(Locale.US) in setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com") && (!u.host.equals("github.com", true) || u.path == parse(initial)?.path)
    }
    @JvmStatic fun isRedirectStatus(status: Int) = status in listOf(301,302,303,307,308)
}
object UpdateGuards {
    const val SAFETY_MARGIN_BYTES = 32L * 1024 * 1024
    const val OFFICIAL_RELEASES_URL = "https://github.com/2archiver/YTArk/releases"
    @JvmStatic fun requiredFreeBytes(size: Long, partial: Long) = (size - partial.coerceAtLeast(0)).coerceAtLeast(0) + SAFETY_MARGIN_BYTES
    @JvmStatic fun hasEnoughFreeSpace(available: Long, size: Long, partial: Long) = size > 0 && available >= requiredFreeBytes(size, partial)
    @JvmStatic @Throws(IOException::class) fun isWithinCacheRoot(root: File?, f: File?) = root != null && f != null && (f.canonicalFile == root.canonicalFile || f.canonicalPath.startsWith(root.canonicalPath + File.separator))
    @JvmStatic fun retainCacheFile(modified: Long, cutoff: Long) = modified <= 0 || modified >= cutoff
    @JvmStatic fun isStaleUpdateFile(name: String?, vararg keep: String?): Boolean = name != null && name.matches(Regex("YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-armv7\\.apk(?:\\.part(?:\\.properties)?)?")) && keep.none { !it.isNullOrEmpty() && (name == it || name.startsWith("$it.")) }
    @JvmStatic @Throws(IOException::class) fun isSafeUpdateDirectory(files: File?, dir: File?) = files != null && dir != null && files.canonicalFile == files.absoluteFile && dir.canonicalFile == dir.absoluteFile && dir.canonicalFile.parentFile == files.canonicalFile
    @JvmStatic @Throws(IOException::class) fun isSafeUpdateFile(dir: File?, f: File?) = dir != null && f != null && dir.canonicalFile == dir.absoluteFile && f.canonicalFile == f.absoluteFile && f.canonicalFile.parentFile == dir.canonicalFile
    @JvmStatic fun deviceMeetsMinSdk(min: Int, sdk: Int) = min <= 0 || sdk >= min
    @JvmStatic @Throws(IOException::class) fun officialReleasePage(tag: String?): String { requireUpdate(tag?.startsWith("v") == true, "Invalid tag."); UpdateReleaseContract.expectedVersionCodeForVersion(tag!!.drop(1)); return "$OFFICIAL_RELEASES_URL/tag/$tag" }
}
object UpdateResumeContract {
    @JvmStatic fun metadataMatches(p: Properties?, asset: String?, url: String?, hash: String?, size: Long, abi: String?) = p != null && asset != null && url != null && hash != null && abi != null && p.getProperty("asset") == asset && p.getProperty("url") == url && hash.equals(p.getProperty("sha256"), true) && p.getProperty("size") == size.toString() && p.getProperty("abi") == abi
    @JvmStatic fun shouldAppend(existing: Long, status: Int) = existing > 0 && status == 206
    @JvmStatic fun validContentRange(value: String?, start: Long, size: Long): Boolean {
        val m = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(value ?: "") ?: return false
        val p = m.groupValues.drop(1).map { it.toLongOrNull() ?: return false }
        return p[0] == start && p[1] >= start && p[1] < p[2] && p[2] == size
    }
}
object UpdateSchedulePolicy {
    const val CHECK_INTERVAL_MILLIS = 3600000L
    const val RETRY_INTERVAL_MILLIS = 3600000L
    private fun add(a: Long,b: Long) = if (a > Long.MAX_VALUE-b) Long.MAX_VALUE else a+b
    @JvmStatic fun nextEligibleAtMillis(check: Long, attempt: Long, success: Long, failure: Long, retry: Long, rate: Long, now: Long): Long {
        val last = when { attempt > success && attempt > 0 -> attempt; failure > success && failure > 0 -> failure; success > 0 -> success; attempt > 0 -> attempt; check > 0 -> check; else -> 0 }
        return maxOf(now, if (last > 0) add(last, CHECK_INTERVAL_MILLIS) else now, retry, rate)
    }
    @JvmStatic fun isAutomaticCheckDue(check: Long, attempt: Long, success: Long, failure: Long, retry: Long, rate: Long, now: Long) = now >= nextEligibleAtMillis(check, attempt, success, failure, retry, rate, now)
    @JvmStatic fun retryDeadlineMillis(retry: String?, reset: String?, now: Long): Long {
        val seconds = retry?.trim()?.toLongOrNull()
        val r = if (seconds != null) { if (seconds <= 0) 0 else if (seconds > (Long.MAX_VALUE-now)/1000) Long.MAX_VALUE else now+seconds*1000 } else try { SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply { timeZone=TimeZone.getTimeZone("GMT"); isLenient=false }.parse(retry ?: "")?.time ?: 0 } catch (_: Exception) { 0 }
        val epoch = reset?.trim()?.toLongOrNull() ?: 0
        return maxOf(now, r, if (epoch in 1..Long.MAX_VALUE/1000) epoch*1000 else 0)
    }
}
object UpdateVersion {
    @JvmStatic fun compare(left: String?, right: String?): Int {
        fun parts(v: String?): List<String> = Regex("^[vV]?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?(?:\\+[0-9A-Za-z.-]+)?$").matchEntire(v?.trim() ?: "")?.groupValues?.drop(1)?.also { require(!it[3].startsWith(".") && !it[3].endsWith(".") && !it[3].contains("..")) } ?: throw IllegalArgumentException("Invalid version")
        val a=parts(left); val b=parts(right)
        for (i in 0..2) { val c=a[i].toBigInteger().compareTo(b[i].toBigInteger()); if(c!=0) return c }
        if (a[3].isEmpty() || b[3].isEmpty()) return when { a[3]==b[3] -> 0; a[3].isEmpty() -> 1; else -> -1 }
        val x=a[3].split('.'); val y=b[3].split('.')
        for(i in 0 until minOf(x.size,y.size)) { val n=x[i].toBigIntegerOrNull(); val m=y[i].toBigIntegerOrNull(); val c=when { n!=null && m!=null -> n.compareTo(m); n!=null -> -1; m!=null -> 1; else -> x[i].compareTo(y[i], true) }; if(c!=0) return c }
        return x.size.compareTo(y.size)
    }
}
object UpdaterFailurePhasePolicy {
    const val CHECK="check"; const val DOWNLOAD="download"; const val VALIDATION="validation"; const val INSTALL="install"
    @JvmStatic fun normalize(p: String?) = p?.takeIf { it in listOf(CHECK,DOWNLOAD,VALIDATION,INSTALL) }
    @JvmStatic fun label(p: String?) = when(p) { CHECK -> "Release check"; DOWNLOAD -> "Download"; VALIDATION -> "APK validation"; INSTALL -> "Install"; else -> "Updater" }
    @JvmStatic fun installerFailurePhase(reason: UpdateFailure?) = if(reason==UpdateFailure.VALIDATION_FAILED) VALIDATION else INSTALL
}
object YtarkBranding {
    const val APP_NAME="YTArk"; const val SETTINGS_TITLE="YTArk Settings"; const val ABOUT_TITLE="About YTArk"; const val UPDATES_TITLE="YTArk Updates"
    @JvmStatic fun displayVersion(version: String?): String {
        val v=version?.trim()?.takeIf { it.isNotEmpty() } ?: return "unknown"
        Regex("^(\\d+\\.\\d+\\.\\d+)-ytark\\.[1-9]\\d*$").matchEntire(v)?.let { return it.groupValues[1] }
        return if(v.matches(Regex("\\d+\\.\\d+\\.0"))) v.dropLast(2) else v
    }
    @JvmStatic fun releaseLabel(v: String?) = "$APP_NAME ${displayVersion(v)}"
}
