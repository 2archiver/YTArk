package io.github.twoarchiver.ytark.updater

import android.app.PendingIntent
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.io.IOException

/** Session install when storage allows a second copy; otherwise a granted content URI.
 * The system installer UI is Android's, not a separate YTArk app. file:// is never used.
 * Activity return and STATUS_SUCCESS are not treated as an installed version until
 * PackageManager reports the new versionCode. Nothing uninstalls the current app.
 */
class InstallCoordinator(private val activity: UpdateActivity, private val updates: UpdateCoordinator) {
    private var flow = false
    fun permissionGranted() = Build.VERSION.SDK_INT < 26 || activity.packageManager.canRequestPackageInstalls()
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
        if (Build.VERSION.SDK_INT < 26) { handoff(c, file); return }
        updates.markExternal(UpdatePhase.AwaitingPermission, c, file) {
            try {
                if (!activity.visible) { updates.clearPermissionRequest(); return@markExternal }
                activity.startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")), PERMISSION)
                if (activity.visible) updates.externalReturned("Install permission required. This TV did not open the install-unknown-apps screen. Enable it for YTArk in Android Settings, then select Install update.")
            } catch (_: Exception) {
                updates.externalReturned("Install permission required. This TV has no install-unknown-apps screen. Enable it for YTArk in Android Settings, then select Install update.")
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
