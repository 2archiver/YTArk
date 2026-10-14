package io.github.twoarchiver.ytark.updater

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File

/** Intent + scoped content URI installation. Activity return is never a success signal. */
class InstallCoordinator(private val activity: UpdateActivity, private val updates: UpdateCoordinator) {
    private var flow=false
    fun permissionGranted()=Build.VERSION.SDK_INT<26 || activity.packageManager.canRequestPackageInstalls()
    fun install(returning: Boolean=false) {
        if(flow || !activity.visible) return
        if(returning && !permissionGranted()) { updates.clearPermissionRequest(); return }
        flow=true
        updates.prepareInstall(returning) { c,file ->
            if(!activity.visible || c==null || file==null) { flow=false; return@prepareInstall }
            if(!permissionGranted()) openPermission(c,file) else handoff(c,file)
        }
    }
    private fun openPermission(c: Candidate,file: File) {
        if(Build.VERSION.SDK_INT<26) { handoff(c,file); return }
        updates.markExternal(UpdatePhase.AwaitingPermission,c,file) {
            if(!activity.visible) { flow=false; updates.clearPermissionRequest(); return@markExternal }
            try {
                activity.startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${activity.packageName}")),PERMISSION)
            } catch (_: Exception) {
                flow=false; updates.externalReturned("This TV has no install-unknown-apps settings screen. Enable it for YTArk in Android Settings, then select Install update.")
            }
        }
    }
    private fun handoff(c: Candidate,file: File) {
        updates.markExternal(UpdatePhase.AwaitingInstaller,c,file) {
            if(!activity.visible) { flow=false; updates.externalReturned("APK ready. Select Install update when ready."); return@markExternal }
            if(!permissionGranted()) { flow=false; updates.externalReturned("Install permission was revoked. Select Install update to retry."); return@markExternal }
            val uri=Uri.parse("content://${activity.packageName}.ytarkupdater.files/update.apk")
            val intent=Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri,"application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_RETURN_RESULT,true)
            intent.clipData=ClipData.newRawUri("YTArk update",uri)
            try { activity.startActivityForResult(intent,INSTALLER) }
            catch (_: Exception) { flow=false; updates.externalReturned("No Android package installer accepted the APK. Check this TV's installation restrictions and retry.") }
        }
    }
    fun result(request: Int) {
        flow=false
        if(request==INSTALLER) updates.externalReturned("Installer returned without a confirmed update. Select Install update to retry; the same APK is retained.")
    }
    fun resumed(s: UpdateState) {
        // Handles result-before-resume and process recreation of this visible Updates activity.
        if(s.phase==UpdatePhase.AwaitingPermission && s.pendingIdentity!=null && !flow) {
            if(PendingInstallPolicy.mayContinue(s.pendingIdentity,s.candidate?.identity,permissionGranted(),activity.visible)) install(true)
            else updates.clearPermissionRequest()
        }
    }
    fun stateChanged(s: UpdateState) { if(s.phase==UpdatePhase.Failed) flow=false; resumed(s) }
    companion object { const val PERMISSION=7311; const val INSTALLER=7312 }
}
