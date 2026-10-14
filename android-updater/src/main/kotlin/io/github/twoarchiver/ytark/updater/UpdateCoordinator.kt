package io.github.twoarchiver.ytark.updater

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** One application-scoped serialized worker. Observers are attached only while a page is visible.
 * No activity is retained by work. No network, archive validation or persistence runs on UI thread.
 */
class UpdateCoordinator private constructor(context: Context) {
    val app=context.applicationContext
    val store=UpdateStore(app)
    private val worker=Executors.newSingleThreadExecutor { r -> Thread(r,"ytark-updates").apply { isDaemon=true } }
    private val main=Handler(Looper.getMainLooper())
    private val listeners=CopyOnWriteArraySet<(UpdateState)->Unit>()
    private val occupied=AtomicBoolean(true)
    private val cancelled=AtomicBoolean(false)
    private val http=ReleaseHttp()
    val validator=ApkValidator(app)
    private lateinit var files: DownloadController
    @Volatile var state=UpdateState(message="Restoring update state…",phase=UpdatePhase.Validating); private set
    @Volatile private var automaticTransfer=false
    @Volatile private var automaticCheck=false
    @Volatile private var stopAutomatic=false
    @Volatile private var hoursOverride: Int?=null
    init { worker.execute {
        try {
            files=DownloadController(app,http,validator)
            recover(store.load())
            UpdateSchedule.replace(app,state.hours)
        } catch(e: Exception) { fail(e) } finally { occupied.set(false); notifyState() }
    } }
    fun observe(listener: (UpdateState)->Unit) { listeners.add(listener); listener(state) }
    fun remove(listener: (UpdateState)->Unit) { listeners.remove(listener) }
    private fun notifyState() { main.post { listeners.forEach { it(state) } } }
    private fun set(next: UpdateState, persist: Boolean=true) { if(persist) store.save(next); state=next; notifyState() }
    private fun fail(e: Exception) {
        val text=when(e) {
            is HttpFailure -> e.message!!
            is java.net.SocketTimeoutException, is java.net.UnknownHostException, is java.net.ConnectException -> "Offline or connection timed out. Check the network and retry."
            is IOException -> e.message?.takeIf { !it.contains("://") && it.length<=220 } ?: "Update I/O failed. Check network and free storage, then retry."
            else -> "Update failed safely. Retry the check or download."
        }
        val next=state.copy(phase=if(cancelled.get() && state.candidate!=null) UpdatePhase.Available else UpdatePhase.Failed,message=if(cancelled.get()) "Download cancelled. Retry when ready." else text,pendingIdentity=null)
        try { set(next) } catch (_: Exception) { state=next; notifyState() }
    }
    private fun submit(work: ()->Unit): Boolean {
        if(!occupied.compareAndSet(false,true)) return false
        worker.execute { try { work() } catch(e: Exception) { fail(e) } finally { occupied.set(false); notifyState() } }
        return true
    }
    private fun recover(saved: UpdateState=state) {
        val c=saved.candidate
        if(c==null) { set(saved.copy(phase=UpdatePhase.Idle,pendingIdentity=null,verifiedPath=null)); return }
        if(validator.code(validator.installed())>=c.code) {
            store.prefs.edit().remove("installer_file").apply()
            set(saved.copy(phase=UpdatePhase.Idle,candidate=null,verifiedPath=null,pendingIdentity=null,message="Update installed. Your application data was not cleared.")); files.clean(emptySet()); return
        }
        val file=files.file(c)
        if(file.exists()) {
            val pending=saved.pendingIdentity.takeIf { saved.phase==UpdatePhase.AwaitingPermission && it==c.identity }
            set(saved.copy(phase=UpdatePhase.Validating,verifiedPath=null,message="Revalidating saved APK…"))
            validator.validate(file,c)
            set(saved.copy(phase=if(pending!=null) UpdatePhase.AwaitingPermission else UpdatePhase.Ready,verifiedPath=file.path,pendingIdentity=pending,message="Verified APK ready. Select Install update."))
        } else set(saved.copy(phase=UpdatePhase.Available,verifiedPath=null,pendingIdentity=null,message="Download interrupted or missing. Retry download."))
    }
    fun check(automatic: Boolean=false, finished: (() -> Unit)?=null) {
        if(state.phase in setOf(UpdatePhase.AwaitingInstaller,UpdatePhase.AwaitingPermission)) { finished?.invoke(); return }
        if(!submit {
            try {
                if(state.busy || (automatic && hoursOverride==0)) return@submit
                automaticCheck=automatic
                stopAutomatic=false
                val now=System.currentTimeMillis()
                val p=store.prefs
                if(automatic && !ScheduleRules.due(state.hours,now,p.getLong("v31_attempt",0),state.lastSuccess,p.getLong("v31_retry",0))) return@submit
                if(now < p.getLong("v31_retry",0)) throw IOException("Waiting after a failed request or GitHub rate limit. Try again later.")
                p.edit().putLong("v31_attempt",now).commit()
                cancelled.set(false)
                val previous=state
                set(state.copy(phase=UpdatePhase.Checking,message="Checking stable ARMv7 release…"))
                validator.requireDevice()
                val c=UpdateRepository(http).latest()
                if(automatic && stopAutomatic) throw IOException("Automatic check paused by Android. It will retry later.")
                if(c.code<=validator.code(validator.installed())) {
                    set(state.copy(phase=UpdatePhase.Idle,candidate=null,verifiedPath=null,pendingIdentity=null,lastSuccess=now,message="Installed version is current. Latest compatible: ${c.version}."))
                } else {
                    val same=c.identity==previous.candidate?.identity
                    set(state.copy(phase=UpdatePhase.Available,candidate=c,verifiedPath=if(same) previous.verifiedPath else null,pendingIdentity=null,lastSuccess=now,message="YTArk ${c.version} is available.",bytes=0))
                    if(files.file(c).exists()) recover()
                    else if(automatic && !stopAutomatic && hoursOverride!=0 && state.hours!=0 && p.getString("v31_cancelled",null)!=c.identity) transfer(true)
                    files.clean(setOfNotNull(state.verifiedPath,p.getString("installer_file",null)))
                }
                p.edit().remove("v31_retry").apply()
            } catch(e: Exception) {
                store.prefs.edit().putLong("v31_retry",maxOf(System.currentTimeMillis()+60000,if(e is HttpFailure) e.retryAt else System.currentTimeMillis()+15*60000)).commit()
                throw e
            } finally { automaticTransfer=false; automaticCheck=false; finished?.let { main.post(it) } }
        }) finished?.invoke()
    }
    fun download() {
        if(state.busy) return
        submit { if(state.busy) return@submit; cancelled.set(false); store.prefs.edit().remove("v31_cancelled").apply(); transfer() }
    }
    private fun transfer(automatic: Boolean=false) {
        val c=state.candidate ?: return
        automaticTransfer=automatic
        set(state.copy(phase=UpdatePhase.Downloading,message="Downloading verified release…",verifiedPath=null,bytes=0))
        val file=files.download(c,cancelled,{ bytes -> set(state.copy(bytes=bytes),false) }, { set(state.copy(phase=UpdatePhase.Validating,message="Validating package, version, ABI, checksum and signer…")) })
        set(state.copy(phase=UpdatePhase.Ready,verifiedPath=file.path,message="Update ready. Select Install update; Android will ask for confirmation."))
        automaticTransfer=false
    }
    fun cancel() {
        if(state.phase !in setOf(UpdatePhase.Downloading,UpdatePhase.Validating)) return
        cancelled.set(true); http.cancel()
        worker.execute { state.candidate?.let { store.prefs.edit().putString("v31_cancelled",it.identity).commit() } }
    }
    fun stopAutomaticWork() {
        if(!automaticCheck && !automaticTransfer) return
        stopAutomatic=true; cancelled.set(true); http.cancel()
    }
    fun setHours(hours: Int) {
        val h=ScheduleRules.interval(hours)
        hoursOverride=h
        try { UpdateSchedule.replace(app,h) } catch (_: Exception) { /* serialized save below reports failure */ }
        if(h==0) stopAutomaticWork()
        worker.execute { try { set(state.copy(hours=h)); UpdateSchedule.replace(app,h) } catch(e: Exception) { fail(e) } }
    }
    /** Revalidation is always on the worker; the callback rechecks visible context before opening UI. */
    fun prepareInstall(returning: Boolean, result: (Candidate?, File?)->Unit) {
        if(!returning && state.busy) { result(null,null); return }
        if(!submit {
            if(state.busy && !(returning && state.phase==UpdatePhase.AwaitingPermission)) { main.post { result(null,null) }; return@submit }
            val c=state.candidate
            val pending=state.pendingIdentity
            if(c==null || (returning && pending!=c.identity)) { main.post { result(null,null) }; return@submit }
            // Consume persisted intent before any asynchronous callback can repeat it.
            set(state.copy(phase=UpdatePhase.Validating,pendingIdentity=null,message="Revalidating APK before install…"))
            val file=files.file(c)
            validator.validate(file,c)
            set(state.copy(phase=UpdatePhase.Ready,verifiedPath=file.path,message="APK verified; ready to install."))
            main.post { result(c,file) }
        }) result(null,null)
    }
    fun markExternal(phase: UpdatePhase, candidate: Candidate, file: File, done: ()->Unit) {
        worker.execute { try {
            requireUpdate(state.phase==UpdatePhase.Ready && state.candidate?.identity==candidate.identity && state.verifiedPath==file.path,"Update changed; select Install again.")
            set(state.copy(phase=phase,pendingIdentity=if(phase==UpdatePhase.AwaitingPermission) candidate.identity else null,message=if(phase==UpdatePhase.AwaitingPermission) "Allow YTArk to install unknown apps, then return." else "Android installer opened. Installation is not yet confirmed."))
            if(phase==UpdatePhase.AwaitingInstaller) requireUpdate(store.prefs.edit().putString("installer_file",file.path).commit(),"Cannot retain installer APK.")
            main.post(done)
        } catch(e: Exception) { fail(e) } }
    }
    fun externalReturned(message: String) { submit { recover(); set(state.copy(phase=if(state.verifiedPath!=null) UpdatePhase.Ready else state.phase,pendingIdentity=null,message=if(state.candidate!=null) message else state.message)) } }
    fun clearPermissionRequest() { submit { set(state.copy(phase=if(state.verifiedPath!=null) UpdatePhase.Ready else UpdatePhase.Available,pendingIdentity=null,message="Install permission not granted. Select Install update to retry; no download needed.")) } }
    companion object {
        @Volatile private var instance: UpdateCoordinator?=null
        fun get(context: Context): UpdateCoordinator = instance ?: synchronized(this) { instance ?: UpdateCoordinator(context).also { instance=it } }
    }
}
