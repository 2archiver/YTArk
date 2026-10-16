package io.github.twoarchiver.ytark.updater

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock

/** App-private, opt-in Android-updater diagnostics. Never sends data over the network. */
object AndroidDiagnostics {
    private const val PREFS = "ytark_native_diagnostics_v1"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_EVENTS = "events"
    private const val KEY_NEXT_SESSION = "next_session"
    private val lock = Any()
    private var preferences: SharedPreferences? = null
    private var sessions: List<NativeDiagnosticSession> = emptyList()
    private var activeSessionNumber = 0L
    private var activeSessionStart = 0L
    private var enabledInProcess = false
    private var storageState = "ok"

    fun initialize(context: Context) {
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

    fun enabled(): Boolean = synchronized(lock) { enabledInProcess }

    /** Returns whether the requested choice was persisted. Disable gates recording first. */
    fun setEnabled(enabled: Boolean): Boolean {
        return try {
            synchronized(lock) {
                val prefs = preferences ?: return@synchronized false
                if (enabledInProcess == enabled) return@synchronized true
                if (!enabled) {
                    // Flip the in-process gate while holding the same lock as record():
                    // collection stops immediately even if the preference write fails.
                    enabledInProcess = false
                    activeSessionNumber = 0L
                    activeSessionStart = 0L
                    val stored = prefs.edit().putBoolean(KEY_ENABLED, false).commit()
                    if (!stored) storageState = "unavailable"
                    return@synchronized stored
                }
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

    /** Clear only this recorder's event key; the enable preference is preserved. */
    fun clear(): Boolean {
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

    fun record(name: String, outcome: String = "none", durationMs: Long? = null) {
        try {
            synchronized(lock) { recordLocked(name, outcome, durationMs) }
        } catch (_: Exception) {
            synchronized(lock) { storageState = "unavailable" }
        }
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

    fun snapshot(): NativeDiagnosticsSnapshot = synchronized(lock) {
        NativeDiagnosticsSnapshot(enabled(), sessions.toList(), storageState)
    }

    fun report(): String = NativeDiagnosticsPolicy.report(snapshot())
}
