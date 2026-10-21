package io.github.twoarchiver.ytark.updater

import android.app.Activity
import android.app.Application
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One-shot native bootstrap marks for opt-in, app-private diagnostics. Unlike
 * the historical logcat marks, these events are captured only while native
 * diagnostics are enabled and contain no activity name or device details.
 */
object StartupTimeline {
    private val processMarked = AtomicBoolean(false)
    private val resumeMarked = AtomicBoolean(false)
    fun processStart() {
        if (!processMarked.compareAndSet(false, true)) return
        AndroidDiagnostics.record("native_bootstrap_ready")
    }
    fun firstActivityResumed() {
        if (!resumeMarked.compareAndSet(false, true)) return
        AndroidDiagnostics.record("native_first_activity_resumed")
    }
}

/** JNI invokes the original protected Java method; the repacker replaces ONLY its body with
 * this static call. It opens a screen, never takes a URL/package/path or triggers an install.
 * The legacy arbitrary-URL installer is removed at that boundary. No socket or exported route.
 */
object NativeUpdatesBridge {
    @Volatile private var foreground=WeakReference<Activity>(null)
    private val opening=AtomicBoolean(false)
    private val main=Handler(Looper.getMainLooper())
    fun resumed(a: Activity) { if(a.javaClass.name=="dev.cobalt.app.MainActivity") foreground=WeakReference(a) }
    fun paused(a: Activity) { if(foreground.get()===a) foreground.clear() }
    @JvmStatic fun open(route: String?): Boolean {
        if(route!="ytark://updates" || foreground.get()==null) return false
        if(!opening.compareAndSet(false,true)) return true
        main.post {
            try {
                val a=foreground.get()
                if(a!=null && !a.isFinishing && !a.isDestroyed) a.startActivity(Intent(a,UpdateActivity::class.java))
            } finally { opening.set(false) }
        }
        return true
    }
}
object UpdateSchedule {
    const val JOB_ID=7280
    fun replace(context: Context, hours: Int) {
        val scheduler=context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler ?: return
        // Retire the old scheduler ID, if different, without touching another app's work.
        if(hours==0) { scheduler.cancel(JOB_ID); return }
        val interval=hours*ScheduleRules.HOUR
        if(scheduler.getPendingJob(JOB_ID)?.intervalMillis==interval) return
        scheduler.cancel(JOB_ID)
        val job=JobInfo.Builder(JOB_ID,ComponentName(context,UpdateCheckJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
            .setPeriodic(interval,15*60000L).setBackoffCriteria(15*60000L,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build()
        check(scheduler.schedule(job)==JobScheduler.RESULT_SUCCESS) { "Android rejected automatic update scheduling." }
    }
}
class UpdateCheckJobService : JobService() {
    private var active: JobParameters?=null
    override fun onStartJob(params: JobParameters): Boolean {
        active=params
        UpdateCoordinator.get(this).check(true) { if(active===params) { active=null; jobFinished(params,false) } }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        active=null
        UpdateCoordinator.get(this).stopAutomaticWork()
        return true
    }
}
abstract class ReadOnlyProvider : ContentProvider() {
    override fun insert(uri: Uri,values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun delete(uri: Uri,selection: String?,args: Array<out String>?): Int = throw UnsupportedOperationException()
    override fun update(uri: Uri,values: ContentValues?,selection: String?,args: Array<out String>?): Int = throw UnsupportedOperationException()
}
class UpdateBootstrapProvider : ReadOnlyProvider() {
    override fun onCreate(): Boolean {
        val app=context?.applicationContext as? Application ?: return false
        // Initialize the default-off recorder before the earliest native mark.
        // Creation queues only local reconciliation; no startup release/changelog fetch.
        AndroidDiagnostics.initialize(app)
        StartupTimeline.processStart()
        val coordinator=UpdateCoordinator.get(app)
        app.registerActivityLifecycleCallbacks(object: Application.ActivityLifecycleCallbacks {
            private val handler=Handler(Looper.getMainLooper())
            private var overdue: Runnable?=null
            override fun onActivityResumed(a: Activity) {
                StartupTimeline.firstActivityResumed()
                NativeUpdatesBridge.resumed(a)
                if(a !is UpdateActivity) {
                    overdue?.let { handler.removeCallbacks(it) }
                    // Optional network work is deferred until after startup. Scheduler remains authoritative.
                    overdue=Runnable { coordinator.check(true) }.also { handler.postDelayed(it,30000) }
                }
            }
            override fun onActivityPaused(a: Activity) { NativeUpdatesBridge.paused(a); overdue?.let { handler.removeCallbacks(it) }; overdue=null }
            override fun onActivityCreated(a: Activity,b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity,b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
        return true
    }
    override fun query(uri: Uri,projection: Array<out String>?,selection: String?,args: Array<out String>?,sort: String?): Cursor?=null
    override fun getType(uri: Uri): String?=null
}
/** Only the explicit leased installer file can be read; grants are scoped to this exact URI. */
class PendingUpdateProvider : ReadOnlyProvider() {
    override fun onCreate()=true
    private fun file(uri: Uri): File {
        val c=context ?: throw FileNotFoundException()
        if(uri.scheme!="content" || uri.authority!=c.packageName+".ytarkupdater.files" || uri.path!="/update.apk" || uri.query!=null || uri.fragment!=null) throw FileNotFoundException("Unknown update URI")
        val path=UpdateStore(c).prefs.getString("installer_file",null) ?: throw FileNotFoundException("No staged APK")
        val f=File(path); val root=UpdateStorage.directoryFor(c.filesDir) ?: throw FileNotFoundException("No update storage")
        // Only the exact app-owned staged APK is readable. Containment is
        // canonical (not symlink-free), matching the downloader's checks.
        if(!UpdateGuards.isSafeUpdateFile(root,f) || !f.name.matches(Regex("[0-9]+-[0-9a-f]{64}\\.apk")) || !f.isFile) throw FileNotFoundException("No safe staged APK")
        return f
    }
    override fun openFile(uri: Uri,mode: String): ParcelFileDescriptor { if(mode!="r") throw FileNotFoundException("Read only"); return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY) }
    override fun getType(uri: Uri): String { file(uri); return "application/vnd.android.package-archive" }
    override fun query(uri: Uri,projection: Array<out String>?,selection: String?,args: Array<out String>?,sort: String?): Cursor {
        val f=file(uri); val cols=projection ?: arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE)
        return MatrixCursor(cols).apply { addRow(cols.map<String, Any?> { when(it) { OpenableColumns.DISPLAY_NAME -> "YTArk-update.apk"; OpenableColumns.SIZE -> f.length(); else -> null } }.toTypedArray()) }
    }
}
