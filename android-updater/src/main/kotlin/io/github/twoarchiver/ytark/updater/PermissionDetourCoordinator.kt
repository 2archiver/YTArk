package io.github.twoarchiver.ytark.updater

/** Permission-route ownership is scoped to one launched Settings detour. */
enum class PermissionDetourOwner { ENTRY, INSTALL }
enum class PermissionDetourStartKind { STARTED, JOINED, ALREADY_ACTIVE, BLOCKED }

data class PermissionDetour(
    val requestId: Long,
    val owner: PermissionDetourOwner,
    val candidateIdentity: String? = null,
    val launched: Boolean = false,
    val departed: Boolean = false,
    val returned: Boolean = false,
    val continuationAccepted: Boolean = false,
)

data class PermissionDetourSnapshot(
    val nextRequestId: Long = 1L,
    val current: PermissionDetour? = null,
    val revision: Long = 0L,
) {
    companion object {
        /** Prefer the newest saved state when Bundle and durable storage diverge. */
        fun mostRecent(persisted: PermissionDetourSnapshot, restored: PermissionDetourSnapshot?): PermissionDetourSnapshot =
            if (restored != null && restored.revision > persisted.revision) restored else persisted
    }
}

data class PermissionDetourStart(val kind: PermissionDetourStartKind, val route: PermissionDetour?)

/**
 * Production state model shared by the Activity lifecycle adapter and host
 * tests. It contains no Android classes so every transition is executable on
 * the host JVM.
 */
class PermissionDetourCoordinator(initial: PermissionDetourSnapshot = PermissionDetourSnapshot()) {
    private var nextRequestId = initial.nextRequestId.coerceAtLeast(1L)
    private var revision = initial.revision.coerceAtLeast(0L)
    var current: PermissionDetour? = initial.current?.takeIf(::validRoute)
        private set

    private fun validRoute(route: PermissionDetour): Boolean =
        route.requestId > 0L
            && (route.candidateIdentity == null || route.candidateIdentity.matches(Regex("[A-Za-z0-9._:-]{1,128}")))
            && (!route.returned || (route.launched && route.departed))
            && (!route.continuationAccepted || (route.returned && route.candidateIdentity != null))

    fun snapshot() = PermissionDetourSnapshot(nextRequestId, current, revision)

    private fun replace(route: PermissionDetour?) {
        current = route
        if (revision < Long.MAX_VALUE) revision += 1L
    }

    fun beginEntry(): PermissionDetourStart {
        val active = current
        if (active != null) {
            return if (active.owner == PermissionDetourOwner.ENTRY && !active.returned)
                PermissionDetourStart(PermissionDetourStartKind.ALREADY_ACTIVE, active)
            else PermissionDetourStart(PermissionDetourStartKind.BLOCKED, active)
        }
        val route = PermissionDetour(nextRequestId++, PermissionDetourOwner.ENTRY)
        replace(route)
        return PermissionDetourStart(PermissionDetourStartKind.STARTED, route)
    }

    /**
     * Reserves an install detour. An install joining a live entry route is
     * attached to that same request; it cannot launch a second Settings screen.
     */
    fun beginInstall(candidateIdentity: String): PermissionDetourStart {
        if (!candidateIdentity.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            return PermissionDetourStart(PermissionDetourStartKind.BLOCKED, current)
        }
        val active = current
        if (active != null) {
            if (active.owner == PermissionDetourOwner.ENTRY && !active.continuationAccepted
                && (active.candidateIdentity == null || active.candidateIdentity == candidateIdentity)) {
                val joined = active.copy(candidateIdentity = candidateIdentity)
                replace(joined)
                return PermissionDetourStart(PermissionDetourStartKind.JOINED, joined)
            }
            if (active.owner == PermissionDetourOwner.INSTALL && active.candidateIdentity == candidateIdentity
                && !active.continuationAccepted) {
                return PermissionDetourStart(PermissionDetourStartKind.ALREADY_ACTIVE, active)
            }
            return PermissionDetourStart(PermissionDetourStartKind.BLOCKED, active)
        }
        val route = PermissionDetour(nextRequestId++, PermissionDetourOwner.INSTALL, candidateIdentity)
        replace(route)
        return PermissionDetourStart(PermissionDetourStartKind.STARTED, route)
    }

    fun markLaunched(requestId: Long): Boolean {
        val active = current ?: return false
        if (active.requestId != requestId || active.returned) return false
        if (!active.launched) replace(active.copy(launched = true))
        return true
    }

    fun markLaunchFailed(requestId: Long): Boolean {
        val active = current ?: return false
        if (active.requestId != requestId || active.returned) return false
        replace(null)
        return true
    }

    /** A pause counts only once while this exact launched route is outstanding. */
    fun markDeparted(): Boolean {
        val active = current ?: return false
        if (!active.launched || active.returned) return false
        if (!active.departed) replace(active.copy(departed = true))
        return true
    }

    /** ActivityResult proves a return even when onPause was not delivered. */
    fun observeReturn(requestId: Long, fromActivityResult: Boolean = false): Boolean {
        val active = current ?: return false
        if (active.requestId != requestId || active.returned) return false
        // An exact ActivityResult is proof of launch and return even if process
        // recreation happened before the launched/departed flags were saved.
        if (!active.launched && !fromActivityResult) return false
        if (!active.departed && !fromActivityResult) return false
        replace(active.copy(launched = true, departed = true, returned = true))
        return true
    }

    fun canContinue(candidateIdentity: String?, granted: Boolean, visible: Boolean): Boolean {
        val active = current ?: return false
        return active.returned && !active.continuationAccepted && active.candidateIdentity != null
            && active.candidateIdentity == candidateIdentity && granted && visible
    }

    /** Return evidence remains available until the coordinator accepts the queue. */
    fun acceptContinuation(requestId: Long, candidateIdentity: String?): Boolean {
        val active = current ?: return false
        if (active.requestId != requestId || !canContinue(candidateIdentity, granted = true, visible = true)) return false
        replace(active.copy(continuationAccepted = true))
        return true
    }

    fun detachCandidate(requestId: Long, candidateIdentity: String): Boolean {
        val active = current ?: return false
        if (active.requestId != requestId || active.candidateIdentity != candidateIdentity || active.continuationAccepted) return false
        if (active.owner == PermissionDetourOwner.ENTRY) replace(active.copy(candidateIdentity = null))
        else replace(null)
        return true
    }

    fun complete(requestId: Long): Boolean {
        if (current?.requestId != requestId) return false
        replace(null)
        return true
    }

    fun abandon(requestId: Long): Boolean = complete(requestId)
}
