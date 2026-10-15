package io.github.twoarchiver.ytark.updater

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.io.File
import java.io.IOException
import java.util.TimeZone
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** One application-scoped serialized worker. Observers are attached only while a page is visible.
 * No activity is retained by work. No network, archive validation or persistence runs on the UI thread.
 */
class UpdateCoordinator private constructor(context: Context) {
    val app = context.applicationContext
    val store = UpdateStore(app)
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "ytark-updates").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<(UpdateState) -> Unit>()
    private val occupied = AtomicBoolean(true)
    private val cancelled = AtomicBoolean(false)
    private val http = ReleaseHttp()
    private val deduper = CheckDeduper()
    private val attempts = AttemptGate()
    val validator = ApkValidator(app)
    private lateinit var files: DownloadController
    @Volatile var state = UpdateState(message = "Restoring update state…", phase = UpdatePhase.Validating); private set
    @Volatile private var automaticTransfer = false
    @Volatile private var automaticCheck = false
    @Volatile private var stopAutomatic = false
    @Volatile private var hoursOverride: Int? = null
    @Volatile private var currentAttempt = 0
    @Volatile var lastInstallStatusAt = 0L; private set
    init {
        worker.execute {
            try {
                files = DownloadController(app, validator)
                recover(store.load())
                UpdateSchedule.replace(app, state.hours)
            } catch (e: Exception) { fail(e, "restore") } finally { occupied.set(false); notifyState() }
        }
    }
    fun observe(listener: (UpdateState) -> Unit) { listeners.add(listener); listener(state) }
    fun remove(listener: (UpdateState) -> Unit) { listeners.remove(listener) }
    private fun notifyState() { main.post { listeners.forEach { it(state) } } }
    private fun set(next: UpdateState, persist: Boolean = true) {
        if (persist) store.save(next)
        state = next
        notifyState()
    }
    private fun stage(): String = when (state.phase) {
        UpdatePhase.Downloading -> "download"
        UpdatePhase.Validating -> "validation"
        UpdatePhase.AwaitingPermission, UpdatePhase.AwaitingInstaller -> "install"
        UpdatePhase.Checking -> "check"
        else -> state.stage.ifBlank { "check" }
    }
    private fun fail(e: Exception, forcedStage: String? = null) {
        val mapped = UpdateErrorMapper.map(e, forcedStage ?: stage(), System.currentTimeMillis(), state.candidate?.tag ?: state.releaseTag)
        if (mapped.category == "rate_limit") {
            store.setRateUntil(mapped.retryAt)
            val cache = store.loadCache()
            if (cache != null) {
                showCached(cache, true, mapped.retryAt, mapped.message)
                return
            }
        } else if (mapped.category != "cancelled") {
            val failures = store.failures() + 1
            store.setFailures(failures)
            if (state.phase != UpdatePhase.Downloading) store.prefs.edit().putLong("v31_retry", BackoffPolicy.delayMillis(failures, System.currentTimeMillis(), 0.3)).apply()
        }
        val downloadCancel = cancelled.get() && state.candidate != null && state.phase in setOf(UpdatePhase.Downloading, UpdatePhase.Validating)
        val next = if (downloadCancel) UpdateStates.cancelled(state) else UpdateStates.failed(state, mapped, state.candidate?.tag ?: state.releaseTag)
        try { set(next) } catch (_: Exception) { state = next; notifyState() }
    }
    private fun submit(work: () -> Unit): Boolean {
        if (!occupied.compareAndSet(false, true)) return false
        worker.execute { try { work() } catch (e: Exception) { fail(e) } finally { occupied.set(false); notifyState() } }
        return true
    }
    fun enqueue(work: () -> Unit) { worker.execute { try { work() } catch (e: Exception) { fail(e, "install") } } }
    private fun recover(saved: UpdateState = state) {
        val c = saved.candidate
        if (c == null) { set(saved.copy(phase = UpdatePhase.Idle, pendingIdentity = null, verifiedPath = null, speedBps = 0)); return }
        if (validator.code(validator.installed()) >= c.code) {
            store.prefs.edit().remove("installer_file").apply()
            set(UpdateStates.installed(saved))
            files.clean(emptySet())
            return
        }
        val file = files.file(c)
        if (file.exists()) {
            val pending = saved.pendingIdentity.takeIf { saved.phase == UpdatePhase.AwaitingPermission && it == c.identity }
            set(saved.copy(phase = UpdatePhase.Validating, verifiedPath = null, message = "Revalidating saved APK…"))
            try {
                validator.validate(file, c)
            } catch (e: Exception) {
                file.delete()
                set(saved.copy(phase = UpdatePhase.Available, verifiedPath = null, pendingIdentity = null, message = "Download interrupted. Retry to continue the download.", errorCategory = "download_interrupted", stage = "download"))
                return
            }
            set(saved.copy(phase = if (pending != null) UpdatePhase.AwaitingPermission else UpdatePhase.Ready, verifiedPath = file.path, pendingIdentity = pending, message = if (pending != null) saved.message else "Verified APK ready. Select Install update."))
        } else {
            val part = File(file.path + ".part")
            val message = if (part.isFile && part.length() > 0) "Download interrupted. Retry to continue the download." else "Download interrupted or missing. Retry download."
            set(saved.copy(phase = UpdatePhase.Available, verifiedPath = null, pendingIdentity = null, message = message, errorCategory = "download_interrupted", stage = "download"))
        }
    }
    fun check(automatic: Boolean = false, finished: (() -> Unit)? = null) {
        if (state.phase in setOf(UpdatePhase.AwaitingInstaller, UpdatePhase.AwaitingPermission)) { finished?.invoke(); return }
        if (deduper.begin(!automatic) == "joined") { finished?.invoke(); return }
        val body = {
            try {
                var auto = automatic
                while (true) {
                    try { runCheck(auto) } catch (e: Exception) { fail(e) }
                    if (!deduper.finish()) break
                    auto = false
                }
            } finally { finished?.let { main.post(it) } }
        }
        if (submit(body)) return
        // Restore or a download still owns the worker. Queue one retry instead of dropping the check.
        worker.execute {
            if (!submit(body)) {
                deduper.finish()
                finished?.invoke()
            }
        }
    }
    private fun runCheck(automatic: Boolean) {
        if (state.phase in setOf(UpdatePhase.AwaitingInstaller, UpdatePhase.AwaitingPermission)) return
        if (state.busy && state.phase != UpdatePhase.Checking) return
        if (automatic && (hoursOverride == 0 || state.hours == 0)) return
        automaticCheck = automatic
        stopAutomatic = false
        val now = System.currentTimeMillis()
        val p = store.prefs
        if (automatic && !ScheduleRules.due(state.hours, now, p.getLong("v31_attempt", 0), state.lastSuccess, p.getLong("v31_retry", 0))) return
        val rateUntil = store.rateUntil()
        if (now < rateUntil && store.loadCache() == null && !automatic) {
            throw HttpFailure(429, rateUntil, RateLimitPolicy.message(rateUntil, now, TimeZone.getDefault()), "rate_limit")
        }
        currentAttempt = attempts.next()
        val attempt = currentAttempt
        cancelled.set(false)
        p.edit().putLong("v31_attempt", now).commit()
        set(UpdateStates.checking(state))
        validator.requireDevice()
        val discovery = UpdateRepository(http).discover(!automatic, state.hours, now, rateUntil, store.loadCache())
        if (!attempts.accept(attempt)) return
        if (automatic && stopAutomatic) throw IOException("Automatic check paused by Android. It will retry later.")
        when (discovery) {
            is Discovery.RateLimited -> {
                store.setRateUntil(discovery.retryAt)
                val cache = discovery.cache
                if (cache != null) showCached(cache, true, discovery.retryAt, RateLimitPolicy.message(discovery.retryAt, now, TimeZone.getDefault()))
                else throw HttpFailure(429, discovery.retryAt, RateLimitPolicy.message(discovery.retryAt, now, TimeZone.getDefault()), "rate_limit")
            }
            is Discovery.UseCache -> applyCandidate(discovery.cache.candidate(), discovery.cache, now, automatic, discovery.stale, discovery.retryAt)
            is Discovery.Fresh -> {
                store.saveCache(discovery.cache)
                store.setFailures(0)
                p.edit().remove("v31_retry").apply()
                applyCandidate(discovery.candidate, discovery.cache, now, automatic, false, 0L)
            }
        }
    }
    private fun showCached(cache: CachedRelease, stale: Boolean, retryAt: Long, rateMessage: String) {
        val age = UpdateTexts.age(System.currentTimeMillis() - cache.fetchedAt)
        val suffix = " Showing saved release ${cache.tag.removePrefix("v")} from $age (stale)."
        val message = if (stale) rateMessage.trimEnd('.') + "." + suffix else rateMessage
        if (validator.code(validator.installed()) >= cache.code) {
            set(state.copy(phase = UpdatePhase.Idle, candidate = null, verifiedPath = null, pendingIdentity = null, stale = stale, retryAt = retryAt, releaseTag = cache.tag, errorCategory = if (stale) "rate_limit" else "", stage = "check", httpStatus = if (stale) 403 else 0, latestVersion = cache.tag.removePrefix("v"), message = if (stale) message else "Installed version is current. Latest compatible: ${cache.tag.removePrefix("v")}."))
        } else {
            set(UpdateStates.staleAvailable(state, cache.candidate(), retryAt, message))
        }
    }
    private fun applyCandidate(candidate: Candidate, cache: CachedRelease, now: Long, automatic: Boolean, stale: Boolean, retryAt: Long) {
        if (stale) { showCached(cache, true, retryAt, RateLimitPolicy.message(retryAt, now, TimeZone.getDefault())); return }
        store.saveCache(cache.touched(now))
        if (candidate.code <= validator.code(validator.installed())) {
            set(UpdateStates.upToDate(state, candidate.version, now).copy(releaseTag = candidate.tag))
            files.clean(emptySet())
            return
        }
        val same = candidate.identity == state.candidate?.identity && state.verifiedPath != null && File(state.verifiedPath!!).isFile
        set(UpdateStates.available(state, candidate, now, if (same) state.verifiedPath else null).copy(releaseTag = candidate.tag))
        if (files.file(candidate).exists()) recover()
        else if (automatic && !stopAutomatic && hoursOverride != 0 && state.hours != 0 && store.prefs.getString("v31_cancelled", null) != candidate.identity) transfer(true)
        files.clean(setOfNotNull(state.verifiedPath, store.prefs.getString("installer_file", null), files.file(candidate).path))
    }
    fun download() {
        if (state.busy) return
        submit { if (state.busy) return@submit; cancelled.set(false); files.cancel(); store.prefs.edit().remove("v31_cancelled").apply(); transfer() }
    }
    private fun transfer(automatic: Boolean = false) {
        val c = state.candidate ?: return
        val attempt = attempts.next()
        currentAttempt = attempt
        automaticTransfer = automatic
        set(UpdateStates.downloading(state))
        try {
            val file = files.download(c, cancelled, { bytes, speed ->
                if (attempts.accept(attempt)) set(UpdateStates.progress(state, bytes, speed), false)
            }, { if (attempts.accept(attempt)) set(UpdateStates.verifying(state)) })
            if (!attempts.accept(attempt)) return
            set(UpdateStates.ready(state, file.path))
        } finally { automaticTransfer = false }
    }
    fun cancel() {
        if (state.phase !in setOf(UpdatePhase.Downloading, UpdatePhase.Validating)) return
        cancelled.set(true)
        http.cancel()
        if (::files.isInitialized) files.cancel()
        worker.execute { state.candidate?.let { store.prefs.edit().putString("v31_cancelled", it.identity).commit() } }
    }
    fun stopAutomaticWork() {
        if (!automaticCheck && !automaticTransfer) return
        stopAutomatic = true
        cancelled.set(true)
        http.cancel()
        if (::files.isInitialized) files.cancel()
    }
    fun setHours(hours: Int) {
        val h = ScheduleRules.interval(hours)
        hoursOverride = h
        try { UpdateSchedule.replace(app, h) } catch (_: Exception) { }
        if (h == 0) stopAutomaticWork()
        worker.execute { try { set(state.copy(hours = h)); UpdateSchedule.replace(app, h) } catch (e: Exception) { fail(e) } }
    }
    fun prepareInstall(returning: Boolean, result: (Candidate?, File?) -> Unit) {
        if (!returning && state.busy) { result(null, null); return }
        if (!submit {
            if (state.busy && !(returning && state.phase == UpdatePhase.AwaitingPermission)) { main.post { result(null, null) }; return@submit }
            val c = state.candidate
            val pending = state.pendingIdentity
            if (c == null || (returning && pending != c.identity)) { main.post { result(null, null) }; return@submit }
            set(state.copy(phase = UpdatePhase.Validating, pendingIdentity = null, message = "Revalidating APK before install…"))
            val file = files.file(c)
            validator.validate(file, c)
            set(UpdateStates.ready(state, file.path))
            main.post { result(c, file) }
        }) result(null, null)
    }
    fun markExternal(phase: UpdatePhase, candidate: Candidate, file: File, done: () -> Unit) {
        worker.execute {
            try {
                requireUpdate(state.phase == UpdatePhase.Ready && state.candidate?.identity == candidate.identity && state.verifiedPath == file.path, "Update changed; select Install again.")
                val next = if (phase == UpdatePhase.AwaitingPermission) UpdateStates.permission(state, candidate.identity) else UpdateStates.handedToSystem(state)
                set(next)
                if (phase == UpdatePhase.AwaitingInstaller) requireUpdate(store.prefs.edit().putString("installer_file", file.path).commit(), "Cannot retain installer APK.")
                main.post(done)
            } catch (e: Exception) { fail(e, "install") }
        }
    }
    fun externalReturned(message: String) { submit { recover(); if (state.candidate != null) set(state.copy(phase = if (state.verifiedPath != null) UpdatePhase.Ready else UpdatePhase.Available, pendingIdentity = null, message = message)) } }
    fun clearPermissionRequest() { submit { set(UpdateStates.permissionDenied(state)) } }
    fun noteInstallUi() { lastInstallStatusAt = System.currentTimeMillis() }
    fun onInstallStatus(status: Int, rawMessage: String?) {
        lastInstallStatusAt = System.currentTimeMillis()
        enqueue {
            val kind = InstallerStatusPolicy.kind(status, rawMessage)
            if (kind == "user_action") return@enqueue
            if (kind == "success") {
                val target = state.candidate?.code ?: 0L
                var confirmed = false
                repeat(4) {
                    if (target > 0 && validator.code(validator.installed()) >= target) { confirmed = true; return@repeat }
                    if (it < 3) Thread.sleep(400)
                }
                recover()
                if (!confirmed && state.candidate != null) set(UpdateStates.installUnconfirmed(state))
                return@enqueue
            }
            val mapped = MappedError(kind, InstallerStatusPolicy.message(kind), UpdateTexts.sanitize("Install status $status ${rawMessage ?: ""}"), 0L, status, "install")
            val terminal = when (kind) {
                "cancelled" -> UpdateStates.installUnconfirmed(state).copy(message = mapped.message, errorCategory = "install_cancelled", stage = "install")
                "signature" -> UpdateStates.failed(state, mapped, state.candidate?.tag ?: "")
                else -> UpdateStates.failed(state, mapped, state.candidate?.tag ?: "").copy(phase = if (state.verifiedPath != null && kind != "invalid") UpdatePhase.Ready else UpdatePhase.Failed)
            }
            set(if (kind == "invalid") terminal.copy(verifiedPath = null) else terminal)
        }
    }
    fun reconcileInstallerReturn() {
        if (state.phase != UpdatePhase.AwaitingInstaller) return
        submit {
            if (System.currentTimeMillis() - lastInstallStatusAt < 1200) return@submit
            recover()
            if (state.candidate != null && state.phase != UpdatePhase.Idle) set(UpdateStates.installUnconfirmed(state))
        }
    }
    companion object {
        @Volatile private var instance: UpdateCoordinator? = null
        fun get(context: Context): UpdateCoordinator = instance ?: synchronized(this) { instance ?: UpdateCoordinator(context).also { instance = it } }
    }
}
