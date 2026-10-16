package io.github.twoarchiver.ytark.updater

/** Allowlisted measurement with no device, account, URL, file, package-list or content fields. */
data class NativeDiagnosticEvent(
    val elapsedOffsetMs: Long,
    val name: String,
    val durationMs: Long? = null,
    val outcome: String = "none",
)

data class NativeDiagnosticSession(val number: Long, val events: List<NativeDiagnosticEvent>)
data class NativeDiagnosticsSnapshot(
    val enabled: Boolean,
    val sessions: List<NativeDiagnosticSession>,
    val storageState: String = "ok",
)

/** Pure policy shared by the Android wrapper and host behavioral tests. */
object NativeDiagnosticsPolicy {
    const val MAX_SESSIONS = 6
    const val MAX_EVENTS_PER_SESSION = 32
    const val MAX_TOTAL_EVENTS = 160
    const val MAX_SERIALIZED_CHARS = 16_384
    const val MAX_OFFSET_MS = 24L * 60L * 60L * 1000L
    const val MAX_DURATION_MS = 10L * 60L * 1000L

    private val permissionEvents = setOf("entry", "install").flatMap { owner ->
        setOf("requested", "joined", "launched", "departed", "returned", "failed").map { phase -> "permission_${owner}_$phase" }
    }.toSet()
    val EVENT_NAMES = setOf(
        "diagnostics_enabled", "native_bootstrap_ready", "native_first_activity_resumed",
        "page_visible", "check_started", "check_completed",
        "download_started", "download_completed", "apk_validation_started", "apk_validation_completed",
        "permission_continuation_queued", "permission_denied",
        "installer_handoff", "installer_ui_returned", "installer_status",
    ) + permissionEvents
    val OUTCOMES = setOf(
        "none", "enabled", "entry", "install", "ok", "error", "no_update", "candidate", "stale",
        "rate_limited", "cancelled", "validated", "invalid", "granted", "denied", "unknown",
        "unavailable", "blocked", "returned", "accepted", "requested", "completed", "failed",
        "success", "user_action", "signature", "space", "network", "timeout", "available", "invalid",
    )

    fun cleanEvent(
        elapsedOffsetMs: Long,
        name: String,
        durationMs: Long? = null,
        outcome: String = "none",
    ): NativeDiagnosticEvent? {
        if (name !in EVENT_NAMES || outcome !in OUTCOMES) return null
        if (elapsedOffsetMs < 0L) return null
        return NativeDiagnosticEvent(
            elapsedOffsetMs.coerceAtMost(MAX_OFFSET_MS), name,
            durationMs?.coerceAtLeast(0L)?.coerceAtMost(MAX_DURATION_MS), outcome,
        )
    }

    fun startSession(sessions: List<NativeDiagnosticSession>, number: Long): List<NativeDiagnosticSession> {
        if (number <= 0L) return sanitize(sessions)
        return (sanitize(sessions) + NativeDiagnosticSession(number, emptyList())).takeLast(MAX_SESSIONS)
    }

    fun append(
        sessions: List<NativeDiagnosticSession>,
        sessionNumber: Long,
        elapsedOffsetMs: Long,
        name: String,
        durationMs: Long? = null,
        outcome: String = "none",
    ): List<NativeDiagnosticSession> {
        val event = cleanEvent(elapsedOffsetMs, name, durationMs, outcome) ?: return sanitize(sessions)
        val safe = sanitize(sessions).toMutableList()
        val index = safe.indexOfLast { it.number == sessionNumber }
        if (index < 0) safe.add(NativeDiagnosticSession(sessionNumber, listOf(event)))
        else {
            val old = safe[index]
            safe[index] = old.copy(events = (old.events + event).takeLast(MAX_EVENTS_PER_SESSION))
        }
        var result = safe.takeLast(MAX_SESSIONS)
        while (result.sumOf { it.events.size } > MAX_TOTAL_EVENTS) {
            val first = result.firstOrNull() ?: break
            if (first.events.size <= 1) result = result.drop(1)
            else result = listOf(first.copy(events = first.events.drop(1))) + result.drop(1)
        }
        while (serialize(result).length > MAX_SERIALIZED_CHARS && result.isNotEmpty()) {
            val first = result.first()
            result = if (first.events.size <= 1) result.drop(1)
                else listOf(first.copy(events = first.events.drop(1))) + result.drop(1)
        }
        return result
    }

    fun sanitize(sessions: List<NativeDiagnosticSession>): List<NativeDiagnosticSession> {
        val cleaned = sessions.asSequence()
            .filter { it.number > 0L }
            .map { session ->
                val events = session.events.mapNotNull {
                    cleanEvent(it.elapsedOffsetMs, it.name, it.durationMs, it.outcome)
                }.takeLast(MAX_EVENTS_PER_SESSION)
                NativeDiagnosticSession(session.number, events)
            }
            .distinctBy { it.number }
            .sortedBy { it.number }
            .takeLast(MAX_SESSIONS)
            .toList()
        var result = cleaned
        while (result.sumOf { it.events.size } > MAX_TOTAL_EVENTS) {
            val first = result.firstOrNull() ?: break
            result = if (first.events.size <= 1) result.drop(1)
                else listOf(first.copy(events = first.events.drop(1))) + result.drop(1)
        }
        return result
    }

    /** Fixed-field, delimiter-safe serialization used by the app-private store. */
    fun serialize(sessions: List<NativeDiagnosticSession>): String = sanitize(sessions).flatMap { session ->
        session.events.map { event ->
            "${session.number}\t${event.elapsedOffsetMs}\t${event.name}\t${event.durationMs ?: -1L}\t${event.outcome}"
        }
    }.joinToString("\n")

    fun deserialize(raw: String?): List<NativeDiagnosticSession> {
        if (raw.isNullOrBlank() || raw.length > MAX_SERIALIZED_CHARS) return emptyList()
        val events = mutableMapOf<Long, MutableList<NativeDiagnosticEvent>>()
        raw.lineSequence().take(MAX_TOTAL_EVENTS + 1).forEach { row ->
            val fields = row.split('\t')
            if (fields.size != 5) return@forEach
            val number = fields[0].toLongOrNull() ?: return@forEach
            val offset = fields[1].toLongOrNull() ?: return@forEach
            val durationValue = fields[3].toLongOrNull() ?: return@forEach
            val event = cleanEvent(offset, fields[2], durationValue.takeIf { it >= 0L }, fields[4]) ?: return@forEach
            if (number > 0L) events.getOrPut(number) { mutableListOf() }.add(event)
        }
        return sanitize(events.map { NativeDiagnosticSession(it.key, it.value) })
    }

    fun report(snapshot: NativeDiagnosticsSnapshot): String = buildString {
        appendLine("YTArk Android updater diagnostics")
        appendLine("Collection: ${if (snapshot.enabled) "On" else "Off"} · local to this app")
        appendLine("Scope: opt-in native bootstrap/first-activity milestones plus Android updater checks, APK validation and permission/install returns.")
        appendLine("Native startup milestones are not reconstructed; enable before the next launch to capture a full startup sequence.")
        appendLine("Browser measurements are separate. No network transfer, account/content data, URLs, device IDs or file paths are included. Permission is reported only as a fixed granted/denied/unknown outcome, never as raw system settings.")
        appendLine("Clock: Android elapsedRealtime offsets and durations within each process sample; no comparison with browser clocks or across sample offsets.")
        if (snapshot.storageState != "ok") appendLine("Storage state: ${snapshot.storageState}")
        val sessions = sanitize(snapshot.sessions)
        if (sessions.isEmpty()) {
            append("No native updater diagnostic events are saved.")
        } else {
            sessions.forEach { session ->
                appendLine("Sample ${session.number} · ${session.events.size} event(s)")
                session.events.forEach { event ->
                    append("+${event.elapsedOffsetMs} ms · ${event.name} · ${event.outcome}")
                    event.durationMs?.let { append(" · ${it} ms") }
                    appendLine()
                }
            }
        }
    }
}
