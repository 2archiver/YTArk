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

    fun targetSdk(context: Context): Int? = try {
        context.applicationInfo.targetSdkVersion.takeIf { it > 0 }
    } catch (_: Exception) { null }

    fun declaresInstallPermission(context: Context): Boolean? = try {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(InstallCapabilityPolicy.REQUEST_INSTALL_PACKAGES) ?: false
    } catch (_: Exception) { null }

    fun appOpMode(context: Context): Int? = try {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
        if (ops == null) null else {
            val uid = context.applicationInfo.uid
            if (Build.VERSION.SDK_INT >= 29) ops.unsafeCheckOpNoThrow(InstallCapabilityPolicy.INSTALL_APP_OP, uid, context.packageName)
            else {
                @Suppress("DEPRECATION")
                ops.checkOpNoThrow(InstallCapabilityPolicy.INSTALL_APP_OP, uid, context.packageName)
            }
        }
    } catch (_: Exception) { null }

    fun diagnose(context: Context): String = InstallCapabilityPolicy.state(
        Build.VERSION.SDK_INT, targetSdk(context), declaresInstallPermission(context), granted(context),
    )
    fun explanation(context: Context): String = InstallCapabilityPolicy.explanation(diagnose(context), Build.VERSION.SDK_INT)
    fun appOpNote(context: Context): String = when (appOpMode(context)) {
        AppOpsManager.MODE_ALLOWED -> " System install app-op: allowed."
        AppOpsManager.MODE_ERRORED -> " System install app-op: denied."
        AppOpsManager.MODE_IGNORED -> " System install app-op: ignored."
        AppOpsManager.MODE_DEFAULT -> " System install app-op: not set."
        null -> ""
        else -> " System install app-op: unresolved."
    }
    fun canHoldAuthorization(context: Context): Boolean = InstallCapabilityPolicy.canHoldAuthorization(
        Build.VERSION.SDK_INT, targetSdk(context), declaresInstallPermission(context),
    )

    fun settingsIntents(context: Context): List<Intent> = when (InstallPermissionEntryPolicy.routeForApi(Build.VERSION.SDK_INT)) {
        InstallPermissionEntryPolicy.ROUTE_PACKAGE_SOURCE -> listOf(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")),
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES),
        )
        InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS -> listOf(Intent(Settings.ACTION_SECURITY_SETTINGS))
        else -> emptyList()
    }
    fun settingsIntent(context: Context): Intent? = settingsIntents(context).firstOrNull()
    fun openSettings(activity: Activity, requestCode: Int): String? {
        val attempts = mutableListOf<String>()
        for (intent in settingsIntents(activity)) {
            try {
                activity.startActivityForResult(intent, requestCode)
                attempts.add(InstallPermissionEntryPolicy.LAUNCH_OK)
                return null
            } catch (_: SecurityException) { attempts.add(InstallPermissionEntryPolicy.LAUNCH_BLOCKED) }
            catch (_: Exception) { attempts.add(InstallPermissionEntryPolicy.LAUNCH_NOT_FOUND) }
        }
        return when (InstallPermissionEntryPolicy.openOutcome(attempts)) {
            InstallPermissionEntryPolicy.OUTCOME_BLOCKED -> OPEN_BLOCKED
            else -> OPEN_UNAVAILABLE
        }
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

    /** Ordinary user request; the post-permission path passes the captured identity. */
    fun install(returning: Boolean = false) {
        if (returning) {
            resumed(updates.state)
            return
        }
        if (flow || !activity.visible) return
        flow = true
        val accepted = updates.prepareInstall(returning = false) { candidate, file ->
            if (!activity.visible || candidate == null || file == null) {
                flow = false
                return@prepareInstall
            }
            if (!permissionGranted()) openPermission(candidate, file) else handoff(candidate, file)
        }
        if (!accepted) flow = false
    }

    private fun openPermission(candidate: Candidate, file: File) {
        val reserved = activity.reserveInstallPermissionRoute(candidate.identity)
        if (reserved.route == null || reserved.kind == PermissionDetourStartKind.BLOCKED) {
            flow = false
            updates.externalReturned("Another Android install-authorization route is still active. Return to Updates and retry; the verified APK is kept.")
            return
        }
        if (reserved.kind == PermissionDetourStartKind.ALREADY_ACTIVE) {
            flow = false
            return
        }
        val requestId = reserved.route.requestId
        updates.markExternal(UpdatePhase.AwaitingPermission, candidate, file) {
            try {
                if (!activity.visible) {
                    activity.cancelInstallPermissionRoute(requestId, candidate.identity)
                    updates.clearPermissionRequest(candidate.identity)
                    return@markExternal
                }
                if (!InstallAuthorizationAccess.canHoldAuthorization(activity)) {
                    activity.cancelInstallPermissionRoute(requestId, candidate.identity)
                    updates.externalReturned(InstallAuthorizationAccess.explanation(activity) + " Select Install update to retry once an allowed installer replaced this build.")
                    return@markExternal
                }
                val outcome = activity.launchReservedInstallPermissionRoute(requestId)
                if (outcome != null) {
                    activity.cancelInstallPermissionRoute(requestId, candidate.identity)
                    updates.externalReturned(if (outcome == InstallAuthorizationAccess.OPEN_UNAVAILABLE)
                        "Android has no install-authorization screen on this device. Check this TV's Security settings, then select Install update."
                    else "This TV refused to open the install-authorization screen. Allow installs for YTArk in Android Settings, then select Install update.")
                }
            } finally {
                flow = false
                // The shared entry route might have returned while markExternal
                // was queued. Recheck only after the busy mark is released.
                stateChanged(updates.state)
            }
        }
    }

    private fun handoff(candidate: Candidate, file: File) {
        updates.markExternal(UpdatePhase.AwaitingInstaller, candidate, file) {
            try {
                if (!activity.visible) { updates.externalReturned("APK ready. Select Install update when ready."); return@markExternal }
                // Android remains the authority; the permission is re-read after
                // the queued APK validation and immediately before handoff.
                if (!permissionGranted()) {
                    updates.externalReturned("Install permission changed before handoff. Select Install update to check it again; the verified APK is kept.")
                    return@markExternal
                }
                AndroidDiagnostics.record("installer_handoff", "requested")
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
        if (request == INSTALLER) {
            AndroidDiagnostics.record("installer_ui_returned", "returned")
            updates.externalReturned("Installation was not confirmed. Select Install update to retry; the downloaded APK is kept.")
        }
    }

    /** Called on the UI thread for lifecycle evidence and every coordinator state notification. */
    fun resumed(s: UpdateState) {
        val route = activity.currentPermissionDetour() ?: return
        if (!route.returned || route.continuationAccepted || route.candidateIdentity == null) return
        val identity = route.candidateIdentity
        if (s.phase == UpdatePhase.Validating && s.candidate == null) return // restore has not loaded state yet
        if (s.candidate?.identity != identity) {
            activity.completePermissionRoute(route.requestId)
            if (s.pendingIdentity != null) updates.clearPermissionRequest(s.pendingIdentity)
            return
        }
        if (s.pendingIdentity != identity) {
            if (s.phase == UpdatePhase.Validating) return // recovery will restore AwaitingPermission or a retryable state
            activity.completePermissionRoute(route.requestId)
            return
        }
        if (s.phase != UpdatePhase.AwaitingPermission) return
        if (!permissionGranted()) {
            activity.completePermissionRoute(route.requestId)
            updates.clearPermissionRequest(identity)
            activity.focusPermissionRetry()
            AndroidDiagnostics.record("permission_denied", "denied")
            return
        }
        if (!activity.visible || flow) return

        flow = true
        val accepted = updates.prepareInstall(returning = true, expectedIdentity = identity) { candidate, file ->
            if (!activity.visible || candidate == null || candidate.identity != identity || file == null) {
                flow = false
                return@prepareInstall
            }
            // Re-read authorization after revalidation and again immediately
            // before the system installer request. If it changed, issue a new
            // owned permission route; never treat the earlier result as consent.
            if (!permissionGranted()) openPermission(candidate, file) else handoff(candidate, file)
        }
        if (!accepted) {
            flow = false
            return
        }
        if (!activity.acceptPermissionContinuation(route.requestId, identity)) {
            flow = false
            return
        }
    }

    fun stateChanged(s: UpdateState) {
        if (s.phase == UpdatePhase.Failed) {
            flow = false
            val route = activity.currentPermissionDetour()
            if (route != null && route.candidateIdentity != null && !route.launched) {
                activity.cancelInstallPermissionRoute(route.requestId, route.candidateIdentity)
            }
        }
        resumed(s)
    }

    companion object {
        const val PERMISSION = 7311
        const val INSTALLER = 7312
        private val INSTALLER_PACKAGES = arrayOf(
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
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
        } finally { session.close() }
    }
}
