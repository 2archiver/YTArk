package io.github.twoarchiver.ytark.updater

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Durable permission-route snapshots; every preference read/write runs off the UI thread. */
internal object PermissionDetourStore {
    private const val PREFS = "ytark_permission_detour"
    private val main = Handler(Looper.getMainLooper())
    private val storageWorker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "ytark-permission-route").apply { isDaemon = true }
    }

    fun load(context: Context, completed: (PermissionDetourSnapshot?) -> Unit) {
        dispatch(onRejected = { main.post { completed(null) } }) {
            val snapshot = try { read(context.applicationContext) } catch (_: Exception) { null }
            main.post { completed(snapshot) }
        }
    }

    fun save(context: Context, snapshot: PermissionDetourSnapshot, completed: ((Boolean) -> Unit)? = null) {
        dispatch(onRejected = { completed?.let { callback -> main.post { callback(false) } } }) {
            val saved = try { write(context.applicationContext, snapshot) } catch (_: Exception) { false }
            completed?.let { callback -> main.post { callback(saved) } }
        }
    }

    private fun read(context: Context): PermissionDetourSnapshot {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val next = prefs.getLong("next_id", 1L).coerceAtLeast(1L)
        val revision = prefs.getLong("revision", 0L).coerceAtLeast(0L)
        if (!prefs.getBoolean("active", false)) return PermissionDetourSnapshot(next, null, revision)
        val owner = try { PermissionDetourOwner.valueOf(prefs.getString("owner", null) ?: "") }
        catch (_: Exception) { return PermissionDetourSnapshot(next, null, revision) }
        val route = PermissionDetour(
            prefs.getLong("id", 0L), owner,
            prefs.getString("candidate", null)?.takeIf { it.isNotEmpty() },
            prefs.getBoolean("launched", false), prefs.getBoolean("departed", false),
            prefs.getBoolean("returned", false), prefs.getBoolean("accepted", false),
        )
        return PermissionDetourSnapshot(next, route, revision)
    }

    private fun write(context: Context, snapshot: PermissionDetourSnapshot): Boolean {
        val route = snapshot.current
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("next_id", snapshot.nextRequestId)
            .putLong("revision", snapshot.revision)
            .putBoolean("active", route != null)
        if (route != null) {
            editor.putLong("id", route.requestId)
                .putString("owner", route.owner.name)
                .putString("candidate", route.candidateIdentity ?: "")
                .putBoolean("launched", route.launched)
                .putBoolean("departed", route.departed)
                .putBoolean("returned", route.returned)
                .putBoolean("accepted", route.continuationAccepted)
        } else {
            editor.remove("id").remove("owner").remove("candidate").remove("launched")
                .remove("departed").remove("returned").remove("accepted")
        }
        return editor.commit()
    }

    private fun dispatch(onRejected: (() -> Unit)? = null, work: () -> Unit) {
        try {
            storageWorker.execute { work() }
        } catch (_: RejectedExecutionException) {
            onRejected?.invoke()
        }
    }
}
