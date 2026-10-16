package io.github.twoarchiver.ytark.updater

import android.app.Activity
import android.app.AppOpsManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.io.IOException

/** Version-aware authorization check and Android-owned route for unknown app installs. */
internal object InstallAuthorizationAccess {
    const val OPEN_UNAVAILABLE = "unavailable"
    const val OPEN_BLOCKED = "blocked"

    fun granted(context: Context): Boolean? = try {
        when (InstallPermissionEntryPolicy.routeForApi(Build.VERSION.SDK_INT)) {
            InstallPermissionEntryPolicy.ROUTE_PACKAGE_SOURCE -> context.packageManager.canRequestPackageInstalls()
            InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS -> {
                @Suppress("DEPRECATION")
                Settings.Secure.getInt(context.contentResolver, Settings.Secure.INSTALL_NON_MARKET_APPS, 0) != 0
            }
            else -> null
        }
    } catch (_: Exception) {
        null
    }

    /**
     * The target SDK of the *installed* build. Android's capability check reads
     * exactly this value: a package targeting below API 26 is refused outright,
     * which no settings screen can change. `null` means it could not be read.
     */
    fun targetSdk(context: Context): Int? = try {
        context.applicationInfo.targetSdkVersion.takeIf { it > 0 }
    } catch (_: Exception) {
        null
    }

    /**
     * Whether the installed manifest requests the permission Android requires.
     * A declaration that a build capped with `maxSdkVersion` is caught by the
     * packaged-manifest release gate, which reads the compiled manifest bytes.
     */
    fun declaresInstallPermission(context: Context): Boolean? = try {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(InstallCapabilityPolicy.REQUEST_INSTALL_PACKAGES) ?: false
    } catch (_: Exception) {
        null
    }

    /**
     * The per-package system AppOp that the TV's Settings switch writes. This is
     * read-only context for the screen: Android's own `canRequestPackageInstalls`
     * stays the authority, because a forbidden write leaves no state here.
     */
    fun appOpMode(context: Context): Int? = try {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
        if (ops == null) null else {
            val uid = context.applicationInfo.uid
            if (Build.VERSION.SDK_INT >= 29) {
                ops.unsafeCheckOpNoThrow(InstallCapabilityPolicy.INSTALL_APP_OP, uid, context.packageName)
            } else {
                @Suppress("DEPRECATION")
                ops.checkOpNoThrow(InstallCapabilityPolicy.INSTALL_APP_OP, uid, context.packageName)
            }
        }
    } catch (_: Exception) {
        null
    }

    /** The reason code the Updates screen explains, so it can never guess. */
    fun diagnose(context: Context): String = InstallCapabilityPolicy.state(
        targetSdk(context),
        declaresInstallPermission(context),
        granted(context),
    )

    /** Factual app-op note for the screen. Diagnostics only, never a grant decision. */
    fun appOpNote(context: Context): String = when (appOpMode(context)) {
        AppOpsManager.MODE_ALLOWED -> " System install app-op: allowed."
        AppOpsManager.MODE_ERRORED -> " System install app-op: denied."
        AppOpsManager.MODE_IGNORED -> " System install app-op: ignored."
        AppOpsManager.MODE_DEFAULT -> " System install app-op: not set."
        null -> ""
        else -> " System install app-op: unresolved."
    }

    fun canHoldAuthorization(context: Context): Boolean =
        InstallCapabilityPolicy.canHoldAuthorization(targetSdk(context), declaresInstallPermission(context))

    /**
     * Android's own screens, most specific first. The package input of
     * ACTION_MANAGE_UNKNOWN_APP_SOURCES is optional: an OEM build that does not
     * resolve the package-scoped screen still resolves the list screen. No
     * manufacturer component name is hard-coded.
     */
    fun settingsIntents(context: Context): List<Intent> =
        when (InstallPermissionEntryPolicy.routeForApi(Build.VERSION.SDK_INT)) {
            InstallPermissionEntryPolicy.ROUTE_PACKAGE_SOURCE -> listOf(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}"),
                ),
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES),
            )
            InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS -> listOf(Intent(Settings.ACTION_SECURITY_SETTINGS))
            else -> emptyList()
        }

    fun settingsIntent(context: Context): Intent? = settingsIntents(context).firstOrNull()

    /**
     * Starts the first screen the platform actually resolves. Returns `null` when
     * one was opened, else a code for "nothing resolved" or "the platform refused".
     */
    fun openSettings(activity: Activity, requestCode: Int): String? {
        val available = settingsIntents(activity).filter { resolvable(activity, it) }
        if (available.isEmpty()) return OPEN_UNAVAILABLE
        for (intent in available) {
            try {
                activity.startActivityForResult(intent, requestCode)
                return null
            } catch (_: SecurityException) {
                continue
            } catch (_: Exception) {
                continue
            }
        }
        return OPEN_BLOCKED
    }

    private fun resolvable(context: Context, intent: Intent): Boolean = try {
        intent.resolveActivity(context.packageManager) != null
    } catch (_: Exception) {
        false
    }
}

/** Session install when storage allows a second copy; otherwise a granted content URI.
 * The system installer UI is Android's, not a separate YTArk app. file:// is never used.
 * Activity return and STATUS_SUCCESS are not treated as an installed version until
 * PackageManager reports the new versionCode. Nothing uninstalls the current app.
 */
class InstallCoordinator(private val activity: UpdateActivity, private val updates: UpdateCoordinator) {
    private var flow = false
    fun permissionGranted() = InstallAuthorizationAccess.granted(activity) == true
    fun install(returning: Boolean = false) {
        if (flow || !activity.visible) return
        if (returning && !permissionGranted()) { updates.clearPermissionRequest(); return }
        flow = true
        updates.prepareInstall(returning) { c, file ->
            if (!activity.visible || c == null || file == null) { flow = false; return@prepareInstall }
            if (!permissionGranted()) openPermission(c, file) else handoff(c, file)
        }
    }
    private fun openPermission(c: Candidate, file: File) {
        updates.markExternal(UpdatePhase.AwaitingPermission, c, file) {
            try {
                if (!activity.visible) { updates.clearPermissionRequest(); return@markExternal }
                // Android answers the capability question from the packaged
                // manifest, so a package that can never be authorized gets the
                // honest reason and the manual upgrade path instead of a screen
                // that cannot keep the switch on.
                if (!InstallAuthorizationAccess.canHoldAuthorization(activity)) {
                    updates.externalReturned(InstallCapabilityPolicy.explanation(InstallAuthorizationAccess.diagnose(activity)) + " Select Install update to retry once an allowed installer replaced this build.")
                    return@markExternal
                }
                when (InstallAuthorizationAccess.openSettings(activity, PERMISSION)) {
                    null -> Unit
                    InstallAuthorizationAccess.OPEN_UNAVAILABLE -> updates.externalReturned("Android has no install-authorization screen on this device. Check this TV's Security settings, then select Install update.")
                    else -> updates.externalReturned("This TV refused to open the install-authorization screen. Allow installs for YTArk in Android Settings, then select Install update.")
                }
            } finally {
                // Leave the phase at AwaitingPermission, but allow resume to continue exactly once.
                flow = false
            }
        }
    }
    private fun handoff(c: Candidate, file: File) {
        updates.markExternal(UpdatePhase.AwaitingInstaller, c, file) {
            try {
                if (!activity.visible) { updates.externalReturned("APK ready. Select Install update when ready."); return@markExternal }
                if (!permissionGranted()) { updates.externalReturned("Install permission required. Enable Allow from this source for YTArk, then select Install update."); return@markExternal }
                val app = activity.applicationContext
                val free = file.parentFile?.usableSpace ?: 0L
                val canCopy = free >= file.length() + UpdateGuards.SAFETY_MARGIN_BYTES
                if (!canCopy) {
                    if (!legacy(file)) updates.enqueue { throw IOException("No Android package installer accepted the APK. Check this TV's installation restrictions and retry.") }
                    return@markExternal
                }
                updates.enqueue {
                    try { SessionInstall.commit(app, file) }
                    catch (e: Exception) {
                        activity.runOnUiThread {
                            if (!activity.visible || !legacy(file)) updates.enqueue { throw e }
                        }
                    }
                }
            } finally {
                // AwaitingInstaller disables the button. Clearing flow lets Install work again after return.
                flow = false
            }
        }
    }
    private fun legacy(file: File): Boolean {
        val uri = Uri.parse("content://${activity.packageName}.ytarkupdater.files/update.apk")
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
        for (pkg in INSTALLER_PACKAGES) {
            try { activity.grantUriPermission(pkg, uri, flags) } catch (_: Exception) { }
        }
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(flags).putExtra(Intent.EXTRA_RETURN_RESULT, true)
        if (intent.resolveActivity(activity.packageManager) == null) intent.action = Intent.ACTION_VIEW
        intent.clipData = ClipData.newRawUri("YTArk update", uri)
        return try { activity.startActivityForResult(intent, INSTALLER); true }
        catch (_: Exception) { false }
    }
    fun result(request: Int) {
        flow = false
        if (request == INSTALLER) updates.externalReturned("Installation was not confirmed. Select Install update to retry; the downloaded APK is kept.")
    }
    fun resumed(s: UpdateState) {
        // Denial clears the pending request once. It does not reopen Settings by itself.
        if (s.phase == UpdatePhase.AwaitingPermission && s.pendingIdentity != null && !flow) {
            if (PendingInstallPolicy.mayContinue(s.pendingIdentity, s.candidate?.identity, permissionGranted(), activity.visible)) install(true)
            else updates.clearPermissionRequest()
        }
    }
    fun stateChanged(s: UpdateState) { if (s.phase == UpdatePhase.Failed) flow = false; resumed(s) }
    companion object {
        const val PERMISSION = 7311
        const val INSTALLER = 7312
        private val INSTALLER_PACKAGES = arrayOf(
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller"
        )
    }
}

internal object SessionInstall {
    fun commit(context: Context, file: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setSize(file.length())
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)
        try {
            session.openWrite("ytark-update.apk", 0, file.length()).use { out ->
                file.inputStream().use { input ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                    }
                }
                session.fsync(out)
            }
            val callback = Intent(context, UpdateActivity::class.java)
                .setAction(InstallStatusContract.ACTION)
                .setPackage(context.packageName)
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= 31) flags = flags or PendingIntent.FLAG_MUTABLE
            val pending = PendingIntent.getActivity(context, sessionId, callback, flags)
            session.commit(pending.intentSender)
        } catch (e: Exception) {
            try { session.abandon() } catch (_: Exception) { }
            throw e
        } finally {
            session.close()
        }
    }
}
