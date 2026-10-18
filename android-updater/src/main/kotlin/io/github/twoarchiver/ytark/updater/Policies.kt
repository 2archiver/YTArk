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

/** Pure entry-flow decisions; Android settings access remains in UpdateActivity. */
object InstallPermissionEntryPolicy {
    const val ROUTE_UNSUPPORTED = "unsupported"
    const val ROUTE_PACKAGE_SOURCE = "package_source"
    const val ROUTE_SECURITY_SETTINGS = "security_settings"

    /** Per-attempt outcomes of launching one of Android's own screens. */
    const val LAUNCH_OK = "launched"
    const val LAUNCH_NOT_FOUND = "not-found"
    const val LAUNCH_BLOCKED = "blocked"
    const val OUTCOME_UNAVAILABLE = "unavailable"
    const val OUTCOME_BLOCKED = "blocked"

    @JvmStatic fun routeForApi(api: Int): String = when {
        api >= 26 -> ROUTE_PACKAGE_SOURCE
        api in 24..25 -> ROUTE_SECURITY_SETTINGS
        else -> ROUTE_UNSUPPORTED
    }

    @JvmStatic fun shouldRequestOnEntry(freshEntry: Boolean, granted: Boolean?, attempted: Boolean, inFlight: Boolean) =
        freshEntry && granted == false && !attempted && !inFlight

    @JvmStatic fun shouldOpenFromAction(granted: Boolean, inFlight: Boolean) = !granted && !inFlight

    @JvmStatic fun returnStatus(inFlight: Boolean, granted: Boolean): String = when {
        !inFlight -> "ignore"
        granted -> "granted"
        else -> "denied"
    }

    /**
     * Classifies a sequence of launch attempts over the ordered Settings routes.
     *
     * Resolution and launchability are separate questions on modern Android:
     * package-visibility filtering can make `resolveActivity` answer `null` for
     * a screen that `startActivityForResult` opens normally. A precheck that
     * refuses to *try* therefore blocks usable routes, so the routes are tried
     * and only the real launch outcomes are classified here. `null` means one
     * attempt launched; otherwise the honest aggregate failure is reported:
     * "blocked" when the platform refused an attempt (SecurityException),
     * "unavailable" when nothing was found to launch (or there was no route).
     */
    @JvmStatic fun openOutcome(attempts: List<String>?): String? = when {
        attempts == null || attempts.isEmpty() -> OUTCOME_UNAVAILABLE
        attempts.contains(LAUNCH_OK) -> null
        attempts.contains(LAUNCH_BLOCKED) -> OUTCOME_BLOCKED
        else -> OUTCOME_UNAVAILABLE
    }
}

/**
 * Why Android can or cannot hold a per-app install authorization, and what the
 * user can honestly do about it.
 *
 * Android answers the capability question from the *packaged* manifest, not from
 * the settings screen: `ComputerEngine.canRequestPackageInstalls()` returns false
 * when the installed package targets below API 26 and false (logging "Need to
 * declare android.permission.REQUEST_INSTALL_PACKAGES to call this api") when the
 * installed package does not request that permission. The Google TV screen writes
 * a per-package system AppOp instead; when the TV profile or a device policy
 * forbids unknown sources the written value does not survive, and no app can
 * override that, so the screen must not promise that reopening Settings will
 * change it.
 */
object InstallCapabilityPolicy {
    const val MIN_TARGET_SDK = 26
    /** The oldest API this package supports; below it there is no route at all. */
    const val MIN_SUPPORTED_API = 24
    /** API 26 introduced the per-source unknown-apps authorization. */
    const val PER_SOURCE_MIN_API = 26
    const val REQUEST_INSTALL_PACKAGES = "android.permission.REQUEST_INSTALL_PACKAGES"
    /**
     * The internal AppOp name the TV's "install unknown apps" switch writes.
     *
     * The public SDK's field for this op is `@hide @SystemApi`, so it is absent
     * from the `android.jar` a normal build compiles against: reading it is a
     * compile error that only the full-sources CI build sees. The documented
     * internal string is pinned here instead, and the host-JVM tests keep it
     * pinned so a typo cannot silently read nothing.
     */
    const val INSTALL_APP_OP = "android:request_install_packages"
    const val STATE_GRANTED = "granted"
    const val STATE_TARGET_TOO_OLD = "target-too-old"
    const val STATE_PERMISSION_NOT_DECLARED = "permission-not-declared"
    const val STATE_NOT_AUTHORIZED = "not-authorized"
    const val STATE_UNREADABLE = "unreadable"

    /** Route codes for Android's own screens. The list screen omits the optional package input. */
    const val ROUTE_PACKAGE = "package"
    const val ROUTE_LIST = "list"

    /** `null` target SDK or declaration means "could not be read", never a missing feature. */
    @JvmStatic fun state(targetSdk: Int?, declaresPermission: Boolean?, capability: Boolean?): String =
        state(PER_SOURCE_MIN_API, targetSdk, declaresPermission, capability)

    /**
     * Platform-appropriate classification. The target-SDK and declaration
     * prerequisites are the *per-source* rules Android 8+ applies to
     * `canRequestPackageInstalls()`; on API 24–25 the authorization is the
     * legacy global "unknown sources" setting, which does not consult either
     * packaging property, so those states must not be reported there.
     */
    @JvmStatic fun state(api: Int, targetSdk: Int?, declaresPermission: Boolean?, capability: Boolean?): String = when {
        api < MIN_SUPPORTED_API -> STATE_UNREADABLE
        api < PER_SOURCE_MIN_API -> when {
            capability == null -> STATE_UNREADABLE
            capability -> STATE_GRANTED
            else -> STATE_NOT_AUTHORIZED
        }
        targetSdk == null || targetSdk < 1 || declaresPermission == null -> STATE_UNREADABLE
        targetSdk in 1 until MIN_TARGET_SDK -> STATE_TARGET_TOO_OLD
        !declaresPermission -> STATE_PERMISSION_NOT_DECLARED
        capability == null -> STATE_UNREADABLE
        capability -> STATE_GRANTED
        else -> STATE_NOT_AUTHORIZED
    }

    /** True when Android can hold the authorization for this build at all. */
    @JvmStatic fun canHoldAuthorization(targetSdk: Int?, declaresPermission: Boolean?): Boolean =
        canHoldAuthorization(PER_SOURCE_MIN_API, targetSdk, declaresPermission)

    /**
     * API-aware capability. On API 24–25 the legacy global setting can be
     * enabled for any package: the modern per-source prerequisites (target
     * API 26+, declared REQUEST_INSTALL_PACKAGES) are properties of the
     * Android 8+ route and must not disable the legacy flow. Below API 24 no
     * supported route exists at all.
     */
    @JvmStatic fun canHoldAuthorization(api: Int, targetSdk: Int?, declaresPermission: Boolean?): Boolean = when {
        api < MIN_SUPPORTED_API -> false
        api < PER_SOURCE_MIN_API -> true
        else -> targetSdk != null && declaresPermission == true && targetSdk >= MIN_TARGET_SDK
    }

    /**
     * The honest short answer for the Updates screen. It never tells the user to
     * reopen the same screen when Android refuses the authorization for a reason
     * no settings screen can change, and it never blames a device policy for a
     * missing declaration.
     */
    @JvmStatic fun explanation(state: String): String = explanation(state, PER_SOURCE_MIN_API)

    /** Platform-appropriate explanation: the legacy setting is global, not per-app. */
    @JvmStatic fun explanation(state: String, api: Int): String = when {
        api in MIN_SUPPORTED_API until PER_SOURCE_MIN_API && state == STATE_NOT_AUTHORIZED ->
            "This Android version (7.x) uses one global install-from-unknown-sources setting instead of a per-app switch, and it is currently off. Open Settings, then Security, and enable Unknown sources; update checks and release notes remain available either way."
        else -> when (state) {
            STATE_GRANTED -> "Android reports install authorization for this build."
            STATE_TARGET_TOO_OLD ->
                "This installed build targets an Android version below 8; Android refuses per-app install authorization for such a package, so the TV switch cannot stay on. Install this or a newer YTArk APK with an installer that is already allowed."
            STATE_PERMISSION_NOT_DECLARED ->
                "This installed build does not request android.permission.REQUEST_INSTALL_PACKAGES, which Android requires before it will grant install authorization, so the TV switch cannot stay on. Install this or a newer YTArk APK with an installer that is already allowed."
            STATE_NOT_AUTHORIZED ->
                "Android has not authorized this build to install packages. The switch in the TV's Settings writes a per-package system value; if this profile or a device policy forbids unknown sources, that value does not survive and YTArk cannot override it."
            else ->
                "Android did not report install authorization for this build. Update checks and release notes remain available; select Allow installs to open Android's own screen."
        }
    }

    /** Settings route for the detected API level and whether the platform resolves the package screen. */
    @JvmStatic fun settingsRoute(api: Int, packageRouteResolvable: Boolean) = when {
        api < 26 -> InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS
        packageRouteResolvable -> ROUTE_PACKAGE
        else -> ROUTE_LIST
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
    /** The canonical asset suffix used in release filenames from 3.8.0 onwards. */
    const val ARMV7_SUFFIX = "armeabi-v7a"
    /** The legacy suffix used in release filenames up to 3.7.x. Accepted for backward compatibility only. */
    const val LEGACY_ARMV7_SUFFIX = "armv7"
    const val ARMV7_ABI = "armeabi-v7a"
    const val LEGACY_ARM64_ABI = "arm64-v8a"
    /** All accepted asset suffixes: current first, legacy for historical releases. */
    @JvmStatic fun acceptedSuffixes(): List<String> = listOf(ARMV7_SUFFIX, LEGACY_ARMV7_SUFFIX)
    /** Regex fragment matching any accepted suffix in asset names. */
    const val SUFFIX_PATTERN = "(?:armeabi-v7a|armv7)"
    @JvmStatic @Throws(IOException::class) fun assetSuffixForSupportedAbis(abis: Array<String>?) : String {
        requireUpdate(abis?.contains(ARMV7_ABI) == true, "Android does not report armeabi-v7a. Check ro.product.cpu.abilist; a 64-bit CPU alone is insufficient.")
        return ARMV7_SUFFIX
    }
    @JvmStatic @Throws(IOException::class) fun nativeAbiForSuffix(suffix: String?): String {
        requireUpdate(suffix == ARMV7_SUFFIX || suffix == LEGACY_ARMV7_SUFFIX, "Unsupported architecture; ARMv7 only."); return ARMV7_ABI
    }
    @JvmStatic @Throws(IOException::class) fun assetSuffixForNativeAbi(abi: String?): String {
        requireUpdate(abi == ARMV7_ABI, "This installation is not armeabi-v7a; cross-ABI updates are not supported."); return ARMV7_SUFFIX
    }
    @JvmStatic @Throws(IOException::class) fun assetSuffixForInstalledAbi(abi: String?, supported: Array<String>?): String {
        val suffix = assetSuffixForNativeAbi(abi)
        requireUpdate(supported?.contains(abi) == true, "Installed ABI is not supported by this Android userspace."); return suffix
    }
    /** Whether the given suffix is a recognized ARMv7 asset suffix (current or legacy). */
    @JvmStatic fun isKnownArmv7Suffix(suffix: String?): Boolean = suffix == ARMV7_SUFFIX || suffix == LEGACY_ARMV7_SUFFIX
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
        val accepted = NativeAbiContract.acceptedSuffixes().map { assetNameForVersion(tag!!.substring(1), it) }
        requireUpdate(name in accepted || name == "SHA256SUMS.txt", "Invalid release asset.")
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
    /** Public latest-release page. A 302 Location names the stable tag; the HTML body is never used. */
    const val LATEST_PAGE = "https://github.com/2archiver/YTArk/releases/latest"
    private val latestTagPath = Regex("^/2archiver/YTArk/releases/tag/(v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*))$")
    @JvmStatic fun isTrustedLatestReleasePage(s: String?): Boolean { val u = parse(s) ?: return false; return secure(u) && u.host.equals("github.com", true) && u.path == "/2archiver/YTArk/releases/latest" && u.query == null }
    @JvmStatic fun latestTag(location: String?): String? {
        val u = parse(location) ?: return null
        if (!secure(u) || !u.host.equals("github.com", true) || u.query != null) return null
        return latestTagPath.matchEntire(u.path ?: "")?.groupValues?.get(1)
    }
    @JvmStatic fun isTrustedReleaseAssetUrl(s: String?): Boolean {
        val u = parse(s) ?: return false
        return secure(u) && u.host.equals("github.com", true) && u.path.matches(Regex("/2archiver/YTArk/releases/download/v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)/(?:YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-(?:armeabi-v7a|armv7)\\.apk|SHA256SUMS\\.txt)"))
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
    @JvmStatic fun isStaleUpdateFile(name: String?, vararg keep: String?): Boolean = name != null && name.matches(Regex("YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-(?:armeabi-v7a|armv7)\\.apk(?:\\.part(?:\\.properties)?)?")) && keep.none { !it.isNullOrEmpty() && (name == it || name.startsWith("$it.")) }
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
