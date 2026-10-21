package io.github.twoarchiver.ytark.updater

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
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
    private val queueLock = Any()
    private var pendingWork = 0
    private val occupied = AtomicBoolean(false)
    private val submitGate = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)
    private val http = ReleaseHttp()
    private val deduper = CheckDeduper()
    private val attempts = AttemptGate()
    val validator = ApkValidator(app)
    private val downloadStorage = RetryableDependency(
        create = { DownloadController(app, validator) },
        prepare = { controller -> controller.prepareStorage() },
    )
    private val storageAccess = UpdateStorageAccess(downloadStorage) { controller -> controller.ensureStorageAvailable() }
    @Volatile var state = UpdateState(message = "Restoring update state…", phase = UpdatePhase.Validating); private set
    @Volatile private var automaticTransfer = false
    @Volatile private var automaticCheck = false
    @Volatile private var stopAutomatic = false
    @Volatile private var hoursOverride: Int? = null
    @Volatile private var currentAttempt = 0
    @Volatile var lastInstallStatusAt = 0L; private set
    init {
        AndroidDiagnostics.initialize(app)
        queueSerialized("restore") {
            val saved = store.load()
            if (saved.candidate == null) {
                recover(saved)
            } else {
                when (val storage = storageAccess.optional()) {
                    is DependencyResult.Ready -> recover(saved)
                    is DependencyResult.Unavailable -> {
                        val cause = storage.cause
                        val error = UpdateStorageFailure("Update storage could not be prepared while restoring the saved APK.",
                            cause,
                            (cause as? UpdateStorageFailure)?.problem ?: UpdateStorage.classify(cause),
                            (cause as? UpdateStorageFailure)?.operation ?: "prepare",
                        )
                        val mapped = UpdateErrorMapper.map(error, "restore", System.currentTimeMillis(), saved.candidate.tag)
                        // A persisted path is not install authorization: if storage
                        // cannot be prepared, force the user back through retry/download.
                        set(UpdateStates.failed(saved, mapped, saved.candidate.tag).copy(verifiedPath = null, pendingIdentity = null))
                    }
                }
            }
            UpdateSchedule.replace(app, state.hours)
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
    private fun registerWork() = synchronized(queueLock) {
        pendingWork++
        occupied.set(true)
    }
    private fun finishWork() = synchronized(queueLock) {
        pendingWork = (pendingWork - 1).coerceAtLeast(0)
        occupied.set(pendingWork > 0)
    }
    private fun queueSerialized(stage: String, work: () -> Unit): Boolean {
        registerWork()
        return try {
            worker.execute {
                try { work() } catch (error: Throwable) { handleFailure(error, stage) }
                finally { finishWork(); notifyState() }
            }
            true
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            finishWork()
            false
        }
    }
    private fun requiredFiles(): DownloadController = storageAccess.required()
    private fun reportStorageFailure(event: String, error: Throwable) {
        val problem = if (error is UpdateStorageFailure) error.problem else UpdateStorage.classify(error)
        val outcome = when (problem) {
            StorageProblem.FULL -> "space"
            StorageProblem.PERMISSION -> "permission"
            StorageProblem.READ_ONLY -> "read_only"
            StorageProblem.PATH_BLOCKED -> "path"
            StorageProblem.IO -> "io"
            StorageProblem.UNAVAILABLE, StorageProblem.CREATE_FAILED, StorageProblem.UNSAFE -> "unavailable"
            StorageProblem.NONE -> if (event == "storage_cleanup") "failed" else "ok"
        }
        AndroidDiagnostics.record(event, outcome)
        // Keep log output bounded and path/URL-free; user-facing details come from
        // the structured updater state rather than arbitrary exception messages.
        val operation = (error as? UpdateStorageFailure)?.operation?.takeIf { it.isNotBlank() }?.let { " at $it" }.orEmpty()
        Log.w("YTArkUpdater", "${event.replace('_', ' ')} failed (${error.javaClass.simpleName}$operation).")
    }
    private fun optionalFiles(): DownloadController? = when (val storage = storageAccess.optional()) {
        is DependencyResult.Ready -> storage.value
        is DependencyResult.Unavailable -> {
            reportStorageFailure("storage_initialization", storage.cause)
            null
        }
    }
    private fun cleanDownloads(keep: Set<String>) {
        val controller = optionalFiles() ?: return
        try {
            controller.clean(keep)
        } catch (error: Throwable) {
            if (error is VirtualMachineError || error is ThreadDeath) throw error
            reportStorageFailure("storage_cleanup", error)
        }
    }
    private fun stage(): String = when (state.phase) {
        UpdatePhase.Downloading -> "download"
        UpdatePhase.Validating -> "validation"
        UpdatePhase.AwaitingPermission, UpdatePhase.AwaitingInstaller -> "install"
        UpdatePhase.Checking -> "check"
        else -> state.stage.ifBlank { "check" }
    }
    private fun handleFailure(error: Throwable, forcedStage: String? = null) {
        // Runtime linkage failures are recoverable updater errors. Do not mask
        // VM-fatal conditions or thread cancellation as a UI state.
        if (error is VirtualMachineError || error is ThreadDeath) throw error
        fail(error, forcedStage)
    }

    private fun fail(e: Throwable, forcedStage: String? = null) {
        val mapped = UpdateErrorMapper.map(e, forcedStage ?: stage(), System.currentTimeMillis(), state.candidate?.tag ?: state.releaseTag)
        if (mapped.category == "rate_limit") {
            store.setRateUntil(mapped.retryAt)
            val cache = store.loadCache()
            if (cache != null) {
                showCached(cache, true, mapped.retryAt, mapped.message, mapped.httpStatus)
                return
            }
        } else if (mapped.category != "cancelled") {
            val failures = store.failures() + 1
            store.setFailures(failures)
            if (state.phase != UpdatePhase.Downloading) store.prefs.edit().putLong("v31_retry", BackoffPolicy.delayMillis(failures, System.currentTimeMillis(), 0.3)).apply()
        }
        val downloadCancel = cancelled.get() && state.candidate != null && state.phase in setOf(UpdatePhase.Downloading, UpdatePhase.Validating)
        val next = if (downloadCancel) UpdateStates.cancelled(state) else UpdateStates.failed(state, mapped, state.candidate?.tag ?: state.releaseTag)
        try { set(next) } catch (persistFailure: Throwable) {
            if (persistFailure is VirtualMachineError || persistFailure is ThreadDeath) throw persistFailure
            state = next
            notifyState()
        }
    }
    private fun submit(stage: String = "updater", work: () -> Unit): Boolean {
        if (!submitGate.compareAndSet(false, true)) return false
        val accepted = queueSerialized(stage) {
            try { work() } finally { submitGate.set(false) }
        }
        if (!accepted) submitGate.set(false)
        return accepted
    }
    fun enqueue(work: () -> Unit) {
        if (!queueSerialized("install", work)) {
            // The single-thread executor is application-scoped and is never shut down.
            // Retain a visible, retryable failure if the platform nevertheless rejects work.
            handleFailure(IllegalStateException("Updater worker is unavailable; reopen Updates and retry."), "install")
        }
    }
    private fun recover(saved: UpdateState = state) {
        val c = saved.candidate
        if (c == null) { set(saved.copy(phase = UpdatePhase.Idle, pendingIdentity = null, verifiedPath = null, speedBps = 0)); return }
        if (validator.code(validator.installed()) >= c.code) {
            store.prefs.edit().remove("installer_file").apply()
            set(UpdateStates.installed(saved))
            cleanDownloads(emptySet())
            return
        }
        val file = requiredFiles().file(c)
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
                    try { runCheck(auto) } catch (e: Throwable) { handleFailure(e) }
                    finally { if (auto) automaticCheck = false }
                    if (!deduper.finish()) break
                    auto = false
                }
            } finally { finished?.let { main.post(it) } }
        }
        if (!queueSerialized("check", body)) {
            deduper.abort()
            finished?.let { main.post(it) }
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
        var checkStarted: Long? = null
        val discovery = try {
            checkStarted = AndroidDiagnostics.begin("check_started")
            val found = UpdateRepository(http).discover(!automatic, state.hours, now, rateUntil, store.loadCache())
            val outcome = when (found) {
                is Discovery.RateLimited -> if (found.cache == null) "rate_limited" else "stale"
                is Discovery.UseCache -> when {
                    found.stale -> "stale"
                    found.cache.code > validator.code(validator.installed()) -> "candidate"
                    else -> "no_update"
                }
                is Discovery.Fresh -> if (found.candidate.code > validator.code(validator.installed())) "candidate" else "no_update"
            }
            AndroidDiagnostics.finish(checkStarted, "check_completed", outcome)
            found
        } catch (error: Throwable) {
            AndroidDiagnostics.finish(checkStarted, "check_completed", when {
                cancelled.get() -> "cancelled"
                error is HttpFailure && error.category == "rate_limit" -> "rate_limited"
                else -> "error"
            })
            throw error
        }
        if (!attempts.accept(attempt)) return
        if (automatic && stopAutomatic) throw IOException("Automatic check paused by Android. It will retry later.")
        when (discovery) {
            is Discovery.RateLimited -> {
                store.setRateUntil(discovery.retryAt)
                val cache = discovery.cache
                if (cache != null) showCached(cache, true, discovery.retryAt, RateLimitPolicy.message(discovery.retryAt, now, TimeZone.getDefault()), discovery.httpStatus)
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
    private fun showCached(cache: CachedRelease, stale: Boolean, retryAt: Long, rateMessage: String, httpStatus: Int = 0) {
        val age = UpdateTexts.age(System.currentTimeMillis() - cache.fetchedAt)
        val suffix = " Showing saved release ${cache.tag.removePrefix("v")} from $age (stale)."
        val message = if (stale) rateMessage.trimEnd('.') + "." + suffix else rateMessage
        val installedCode = validator.code(validator.installed())
        if (installedCode >= cache.code) {
            val checkedAt = if (stale) state.lastSuccess else System.currentTimeMillis()
            val current = UpdateStates.upToDate(state, cache.tag.removePrefix("v"), checkedAt, installedAhead = installedCode > cache.code)
            set(current.copy(
                stale = stale, retryAt = if (stale) retryAt else 0L,
                errorCategory = if (stale) "rate_limit" else "", stage = if (stale) "check" else "",
                httpStatus = if (stale) httpStatus else 0, releaseTag = cache.tag,
                latestVersionStale = stale,
                message = if (stale) message else current.message
            ))
        } else {
            set(UpdateStates.staleAvailable(state, cache.candidate(), retryAt, message, httpStatus))
        }
    }
    private fun applyCandidate(candidate: Candidate, cache: CachedRelease, now: Long, automatic: Boolean, stale: Boolean, retryAt: Long) {
        if (stale) { showCached(cache, true, retryAt, RateLimitPolicy.message(retryAt, now, TimeZone.getDefault())); return }
        store.saveCache(cache.touched(now))
        val installedCode = validator.code(validator.installed())
        if (candidate.code <= installedCode) {
            set(UpdateStates.upToDate(state, candidate.version, now, installedAhead = candidate.code < installedCode).copy(releaseTag = candidate.tag))
            cleanDownloads(emptySet())
            return
        }
        val same = candidate.identity == state.candidate?.identity && state.verifiedPath != null && File(state.verifiedPath!!).isFile
        set(UpdateStates.available(state, candidate, now, if (same) state.verifiedPath else null).copy(releaseTag = candidate.tag))
        val controller = optionalFiles()
        if (controller == null) {
            val cause = storageAccess.lastFailure()
            val failure = (cause as? UpdateStorageFailure) ?: UpdateStorageFailure(
                "Update storage could not be prepared for this download.",
                cause,
                cause?.let { UpdateStorage.classify(it) } ?: StorageProblem.UNAVAILABLE,
                "prepare",
            )
            val mapped = UpdateErrorMapper.map(failure, "download", System.currentTimeMillis(), candidate.tag)
            set(state.copy(
                message = "YTArk ${candidate.version} is available. ${mapped.message}",
                detail = mapped.detail, errorCategory = mapped.category, stage = mapped.stage,
                retryAt = mapped.retryAt, httpStatus = mapped.httpStatus,
            ))
            return
        }
        val candidateFile = controller.file(candidate)
        if (candidateFile.exists()) recover()
        else if (automatic && !stopAutomatic && hoursOverride != 0 && state.hours != 0
            && store.prefs.getString("v31_cancelled", null) != candidate.identity) transfer(true)
        cleanDownloads(setOfNotNull(state.verifiedPath, store.prefs.getString("installer_file", null), candidateFile.path))
    }
    fun download() {
        if (state.busy) return
        submit("download") {
            if (state.busy) return@submit
            cancelled.set(false)
            store.prefs.edit().remove("v31_cancelled").apply()
            transfer()
        }
    }
    private fun transfer(automatic: Boolean = false) {
        val c = state.candidate ?: return
        val controller = requiredFiles()
        val attempt = attempts.next()
        currentAttempt = attempt
        automaticTransfer = automatic
        val diagnosticStart = AndroidDiagnostics.begin("download_started")
        var diagnosticOutcome = "completed"
        set(UpdateStates.downloading(state))
        try {
            val file = controller.download(c, cancelled, { bytes, speed ->
                if (attempts.accept(attempt)) set(UpdateStates.progress(state, bytes, speed), false)
            }, { if (attempts.accept(attempt)) set(UpdateStates.verifying(state)) })
            if (!attempts.accept(attempt)) { diagnosticOutcome = "cancelled"; return }
            set(UpdateStates.ready(state, file.path))
        } catch (error: Throwable) {
            diagnosticOutcome = if (cancelled.get()) "cancelled" else "error"
            throw error
        } finally {
            AndroidDiagnostics.finish(diagnosticStart, "download_completed", diagnosticOutcome)
            automaticTransfer = false
        }
    }
    fun cancel() {
        if (state.phase !in setOf(UpdatePhase.Downloading, UpdatePhase.Validating)) return
        cancelled.set(true)
        http.cancel()
        downloadStorage.readyValue()?.cancel()
        enqueue {
            state.candidate?.let { store.prefs.edit().putString("v31_cancelled", it.identity).commit() }
        }
    }
    fun stopAutomaticWork() {
        if (!automaticCheck && !automaticTransfer) return
        stopAutomatic = true
        cancelled.set(true)
        http.cancel()
        downloadStorage.readyValue()?.cancel()
    }
    fun setHours(hours: Int) {
        val h = ScheduleRules.interval(hours)
        hoursOverride = h
        try { UpdateSchedule.replace(app, h) } catch (_: Exception) { }
        if (h == 0) stopAutomaticWork()
        queueSerialized("check") { set(state.copy(hours = h)); UpdateSchedule.replace(app, h) }
    }
    /**
     * Queue the final APK revalidation. Permission-return work may arrive while
     * restore or another serialized coordinator task is still busy; it is
     * accepted only for the exact pending candidate and rechecked on the
     * worker before any installer handoff. `true` means the queue accepted it,
     * not that validation or installation succeeded.
     */
    fun prepareInstall(
        returning: Boolean,
        expectedIdentity: String? = null,
        result: (Candidate?, File?) -> Unit,
    ): Boolean {
        val observed = state
        if (returning) {
            if (expectedIdentity == null || observed.pendingIdentity != expectedIdentity
                || !PendingInstallPolicy.mayQueueContinuation(
                    observed.pendingIdentity, observed.candidate?.identity, observed.phase, occupied.get(),
                )) return false
        } else if (observed.busy || observed.phase !in setOf(UpdatePhase.Ready, UpdatePhase.Failed)
            || observed.candidate == null || observed.verifiedPath == null) return false
        return queueSerialized("install") {
            try {
                val current = state
                val candidate = current.candidate
                val stillMatches = candidate != null && if (returning) {
                    current.phase == UpdatePhase.AwaitingPermission
                        && current.pendingIdentity == expectedIdentity
                        && candidate.identity == expectedIdentity
                } else {
                    !current.busy && current.phase in setOf(UpdatePhase.Ready, UpdatePhase.Failed)
                        && current.verifiedPath != null && candidate.identity == observed.candidate?.identity
                }
                if (!stillMatches || candidate == null) {
                    main.post { result(null, null) }
                    return@queueSerialized
                }
                if (validator.code(validator.installed()) >= candidate.code) {
                    recover(current)
                    main.post { result(null, null) }
                    return@queueSerialized
                }
                set(current.copy(phase = UpdatePhase.Validating, pendingIdentity = null, message = "Revalidating APK before install…"))
                val file = requiredFiles().file(candidate)
                val validationStart = AndroidDiagnostics.begin("apk_validation_started")
                try {
                    validator.validate(file, candidate)
                } catch (error: Throwable) {
                    AndroidDiagnostics.finish(validationStart, "apk_validation_completed", "invalid")
                    throw error
                }
                AndroidDiagnostics.finish(validationStart, "apk_validation_completed", "validated")
                set(UpdateStates.ready(state, file.path))
                main.post { result(candidate, file) }
            } catch (error: Throwable) {
                handleFailure(error, "install")
                main.post { result(null, null) }
            }
        }
    }
    fun markExternal(phase: UpdatePhase, candidate: Candidate, file: File, done: () -> Unit) {
        enqueue {
            requireUpdate(state.phase == UpdatePhase.Ready && state.candidate?.identity == candidate.identity && state.verifiedPath == file.path, "Update changed; select Install again.")
            val staged = requiredFiles().file(candidate)
            if (staged.path != file.path || !staged.isFile || staged.length() != candidate.size) {
                throw UpdateStorageFailure("The verified APK is no longer available in update storage. Retry the download before installing.")
            }
            val next = if (phase == UpdatePhase.AwaitingPermission) UpdateStates.permission(state, candidate.identity) else UpdateStates.handedToSystem(state)
            set(next)
            if (phase == UpdatePhase.AwaitingInstaller) requireUpdate(store.prefs.edit().putString("installer_file", file.path).commit(), "Cannot retain installer APK.")
            main.post(done)
        }
    }
    fun externalReturned(message: String) {
        enqueue {
            recover()
            if (state.candidate != null) set(state.copy(phase = if (state.verifiedPath != null) UpdatePhase.Ready else UpdatePhase.Available, pendingIdentity = null, message = message))
        }
    }
    fun clearPermissionRequest(expectedIdentity: String? = null) {
        enqueue {
            val current = state
            if (expectedIdentity != null && current.pendingIdentity != expectedIdentity) return@enqueue
            if (current.phase !in setOf(UpdatePhase.AwaitingPermission, UpdatePhase.Validating)) return@enqueue
            if (current.phase == UpdatePhase.Validating && current.pendingIdentity == null) return@enqueue
            set(UpdateStates.permissionDenied(current))
        }
    }
    fun noteInstallUi() { lastInstallStatusAt = System.currentTimeMillis() }
    fun onInstallStatus(status: Int, rawMessage: String?) {
        lastInstallStatusAt = System.currentTimeMillis()
        enqueue {
            val kind = InstallerStatusPolicy.kind(status, rawMessage)
            AndroidDiagnostics.record("installer_status", when (kind) {
                "success" -> "success"
                "user_action" -> "user_action"
                "cancelled" -> "cancelled"
                "signature" -> "signature"
                "invalid" -> "invalid"
                else -> "error"
            })
            if (kind == "user_action") return@enqueue
            if (kind == "success") {
                // PackageInstaller's callback is real Android evidence, but a
                // success callback alone is not proof that PackageManager now
                // reports the candidate as installed. Check once without
                // blocking/sleeping the serialized worker; recovery and the
                // next explicit screen return can safely check again.
                recover()
                if (state.candidate != null) set(UpdateStates.installUnconfirmed(state))
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
        submit("install") {
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
