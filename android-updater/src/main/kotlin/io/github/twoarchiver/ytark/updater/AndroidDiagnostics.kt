package io.github.twoarchiver.ytark.updater

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** App-private, opt-in Android-updater diagnostics. Never sends data over the network. */
object AndroidDiagnostics {
    private const val PREFS = "ytark_native_diagnostics_v1"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_EVENTS = "events"
    private const val KEY_NEXT_SESSION = "next_session"
    private val lock = Any()
    // SharedPreferences commits and initial reads are serialized off the UI thread.
    private val storageWorker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "ytark-native-diagnostics").apply { isDaemon = true }
    }
    private var preferences: SharedPreferences? = null
    @Volatile private var sessions: List<NativeDiagnosticSession> = emptyList()
    private var activeSessionNumber = 0L
    private var activeSessionStart = 0L
    @Volatile private var enabledInProcess = false
    @Volatile private var storageState = "ok"

    /** Queue initialization before every later diagnostic write; never load preferences on the UI thread. */
    fun initialize(context: Context, onReady: (() -> Unit)? = null) {
        dispatchStorageWork(onRejected = {
            synchronized(lock) { storageState = "unavailable" }
            onReady?.invoke()
        }) {
            initializeNow(context)
            onReady?.invoke()
        }
    }

    private fun initializeNow(context: Context) {
        try {
            synchronized(lock) {
                if (preferences != null) return
                val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                preferences = prefs
                val raw = prefs.getString(KEY_EVENTS, null)
                storageState = when {
                    raw != null && raw.length > NativeDiagnosticsPolicy.MAX_SERIALIZED_CHARS -> "oversized"
                    raw != null && raw.isNotBlank() && !wellFormed(raw) -> "corrupt"
                    else -> "ok"
                }
                sessions = if (storageState == "ok") NativeDiagnosticsPolicy.deserialize(raw) else emptyList()
                enabledInProcess = prefs.getBoolean(KEY_ENABLED, false)
                if (enabledInProcess) startSessionLocked(prefs)
            }
        } catch (_: Exception) {
            synchronized(lock) {
                preferences = null
                sessions = emptyList()
                activeSessionNumber = 0L
                activeSessionStart = 0L
                enabledInProcess = false
                storageState = "unavailable"
            }
        }
    }

    private fun dispatchStorageWork(onRejected: (() -> Unit)? = null, work: () -> Unit) {
        try {
            storageWorker.execute {
                try { work() }
                catch (_: Exception) { synchronized(lock) { storageState = "unavailable" } }
            }
        } catch (_: RejectedExecutionException) {
            synchronized(lock) { storageState = "unavailable" }
            onRejected?.invoke()
        }
    }

    private fun wellFormed(raw: String): Boolean = raw.lineSequence().all { row ->
        if (row.isBlank()) return@all true
        val fields = row.split('\t')
        if (fields.size != 5) return@all false
        val id = fields[0].toLongOrNull() ?: return@all false
        val offset = fields[1].toLongOrNull() ?: return@all false
        val duration = fields[3].toLongOrNull() ?: return@all false
        id > 0L && NativeDiagnosticsPolicy.cleanEvent(
            offset, fields[2], duration.takeIf { it >= 0L }, fields[4],
        ) != null
    }

    private fun startSessionLocked(prefs: SharedPreferences) {
        val storedNext = prefs.getLong(KEY_NEXT_SESSION, 1L).coerceAtLeast(1L)
        // The persisted event history is an additional recovery source if the
        // counter commit failed during a previous process. Never reuse an ID
        // whose elapsedRealtime offsets belong to an earlier process sample.
        val afterHistory = sessions.maxOfOrNull { if (it.number == Long.MAX_VALUE) 1L else it.number + 1L } ?: 1L
        var nextSession = maxOf(storedNext, afterHistory)
        while (sessions.any { it.number == nextSession }) {
            nextSession = if (nextSession == Long.MAX_VALUE) 1L else nextSession + 1L
        }
        activeSessionNumber = nextSession
        activeSessionStart = SystemClock.elapsedRealtime()
        val next = if (activeSessionNumber == Long.MAX_VALUE) 1L else activeSessionNumber + 1L
        if (!prefs.edit().putLong(KEY_NEXT_SESSION, next).commit()) storageState = "unavailable"
    }

    /** Volatile read only: callers never wait behind a preference operation. */
    fun enabled(): Boolean = enabledInProcess

    /** Returns whether the requested choice was persisted. Disable gates recording first. */
    private fun setEnabled(enabled: Boolean): Boolean {
        return try {
            synchronized(lock) {
                val prefs = preferences ?: return@synchronized false
                if (!enabled) {
                    // `setEnabledAsync(false)` closes the volatile gate on the
                    // caller thread before it queues the durable preference write.
                    enabledInProcess = false
                    activeSessionNumber = 0L
                    activeSessionStart = 0L
                    val stored = prefs.edit().putBoolean(KEY_ENABLED, false).commit()
                    if (!stored) storageState = "unavailable"
                    return@synchronized stored
                }
                if (enabledInProcess) return@synchronized true
                if (!prefs.edit().putBoolean(KEY_ENABLED, true).commit()) {
                    storageState = "unavailable"
                    return@synchronized false
                }
                // Prepare a unique per-process time origin before opening the
                // in-process gate. Storage failures must not enable capture by
                // accident or escape into updater behavior.
                startSessionLocked(prefs)
                enabledInProcess = true
                recordLocked("diagnostics_enabled", "enabled", null)
                true
            }
        } catch (_: Exception) {
            synchronized(lock) {
                storageState = "unavailable"
                if (!enabled) {
                    enabledInProcess = false
                    activeSessionNumber = 0L
                    activeSessionStart = 0L
                } else {
                    enabledInProcess = false
                    try { preferences?.edit()?.putBoolean(KEY_ENABLED, false)?.commit() } catch (_: Exception) { }
                }
            }
            false
        }
    }

    /** Preference writes are performed by the diagnostics worker, not by a UI callback. */
    fun setEnabledAsync(enabled: Boolean, completed: (Boolean) -> Unit) {
        // Disabling collection is immediate even when earlier background writes
        // are queued or a filesystem commit is slow. The durable write remains
        // serialized on the storage worker.
        if (!enabled) enabledInProcess = false
        dispatchStorageWork(onRejected = { completed(false) }) { completed(setEnabled(enabled)) }
    }

    /** Clear only this recorder's event key; the enable preference is preserved. */
    private fun clear(): Boolean {
        return try {
            synchronized(lock) {
                val prefs = preferences ?: return@synchronized false
                sessions = emptyList()
                activeSessionNumber = 0L
                activeSessionStart = 0L
                val stored = prefs.edit().remove(KEY_EVENTS).commit()
                storageState = if (stored) "ok" else "unavailable"
                if (enabledInProcess) startSessionLocked(prefs)
                stored
            }
        } catch (_: Exception) {
            synchronized(lock) { storageState = "unavailable" }
            false
        }
    }

    fun clearAsync(completed: (Boolean) -> Unit) {
        dispatchStorageWork(onRejected = { completed(false) }) { completed(clear()) }
    }

    fun record(name: String, outcome: String = "none", durationMs: Long? = null) {
        dispatchStorageWork { synchronized(lock) { recordLocked(name, outcome, durationMs) } }
    }

    private fun recordLocked(name: String, outcome: String, durationMs: Long?) {
        try {
            val prefs = preferences ?: return
            if (!enabledInProcess) return
            if (activeSessionNumber <= 0L) startSessionLocked(prefs)
            val now = SystemClock.elapsedRealtime()
            val offset = (now - activeSessionStart).coerceAtLeast(0L)
            sessions = NativeDiagnosticsPolicy.append(sessions, activeSessionNumber, offset, name, durationMs, outcome)
            val encoded = NativeDiagnosticsPolicy.serialize(sessions)
            if (encoded.length <= NativeDiagnosticsPolicy.MAX_SERIALIZED_CHARS) {
                storageState = if (prefs.edit().putString(KEY_EVENTS, encoded).commit()) "ok" else "unavailable"
            }
        } catch (_: Exception) { storageState = "unavailable" }
    }

    fun begin(name: String): Long? = try {
        if (!enabled()) null else {
            val start = SystemClock.elapsedRealtime()
            record(name, "none")
            start
        }
    } catch (_: Exception) {
        synchronized(lock) { storageState = "unavailable" }
        null
    }

    fun finish(startedAt: Long?, name: String, outcome: String) {
        if (startedAt == null) return
        try {
            val duration = (SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(0L)
            record(name, outcome, duration)
        } catch (_: Exception) {
            synchronized(lock) { storageState = "unavailable" }
        }
    }

    fun permissionRoute(kind: String, owner: PermissionDetourOwner?, result: String) {
        val phase = when (kind) {
            "requested", "joined", "launched", "departed", "returned", "failed" -> kind
            else -> return
        }
        val who = if (owner == PermissionDetourOwner.INSTALL) "install" else "entry"
        val event = "permission_${who}_$phase"
        val outcome = if (result in NativeDiagnosticsPolicy.OUTCOMES) result else "none"
        record(event, if (outcome in setOf("entry", "install", "system-screen")) "none" else outcome)
    }

    /** In-memory volatile snapshot only; diagnostic storage may be committing concurrently. */
    fun snapshot(): NativeDiagnosticsSnapshot {
        val currentSessions = sessions
        return NativeDiagnosticsSnapshot(enabledInProcess, currentSessions.toList(), storageState)
    }

    fun report(): String = NativeDiagnosticsPolicy.report(snapshot())
}
