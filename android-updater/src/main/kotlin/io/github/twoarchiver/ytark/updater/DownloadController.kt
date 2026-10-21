package io.github.twoarchiver.ytark.updater

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.util.Properties
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Writes only to an app-owned `.part` file and renames it after validation.
 * An incomplete file is never handed to the installer.
 *
 * Storage is app-private (`Context.filesDir`) and needs no storage permission.
 * The 3.9 readiness probe wrote a temporary file, fsynced it and treated a
 * failed delete as unavailable storage; that probe is gone. Preparation now
 * requires only what a download actually needs: a contained directory that can
 * be created and can accept a plain one-byte write. Free-space reporting is
 * advisory when the platform reports an unknown capacity, and a full disk is
 * reported only from a known total/usable pair or a real ENOSPC.
 *
 * Resume requires a stored ETag plus a 206/Content-Range match. Anything else
 * restarts. DownloadManager is not used: this build must not add a notification
 * permission, and process-death survival is not claimed.
 */
class DownloadController(context: Context, private val validator: ApkValidator) {
    private val filesDirectory: File? = context.filesDir
    val directory: File = UpdateStorage.directoryFor(filesDirectory) ?: File(UpdateStorage.DIRECTORY_NAME)
    private val cancel = CancelHandle()
    @Volatile private var prepared = false

    /** Called by the retryable coordinator gate, never on the UI thread. */
    @Synchronized
    fun prepareStorage() {
        prepared = false
        val preparation = UpdateStorage.prepare(filesDirectory, UpdateStorage.directoryFor(filesDirectory))
        if (!preparation.ok) {
            throw UpdateStorageFailure(
                preparation.message(), preparation.cause,
                preparation.problem, preparation.operation,
            )
        }
        prepared = true
    }

    /** Cheap recheck; a real write probe runs only after the storage state changes. */
    fun ensureStorageAvailable() {
        if (!prepared || !directory.isDirectory || !directory.canWrite()
            || !UpdateStorage.isContained(filesDirectory, directory)) {
            prepareStorage()
        }
    }

    private fun requirePrepared() {
        if (!prepared || !directory.isDirectory || !UpdateStorage.isContained(filesDirectory, directory)) {
            throw UpdateStorageFailure(
                "Update storage is no longer available. Retry after restoring app storage access.",
                null, StorageProblem.UNAVAILABLE, "check",
            )
        }
    }

    fun file(c: Candidate): File {
        requirePrepared()
        return File(directory, UpdateStorage.apkName(c.code, c.sha256))
            .also { requireUpdate(UpdateGuards.isSafeUpdateFile(directory, it), "Unsafe APK path.") }
    }

    fun cancel() { cancel.cancel() }
    fun resetCancellation() {
        cancel.connection.set(null)
        cancel.cancelled.set(false)
    }

    fun download(c: Candidate, cancelled: AtomicBoolean, progress: (Long, Long) -> Unit, validating: () -> Unit): File {
        requirePrepared()
        resetCancellation()
        val target = file(c)
        if (target.exists()) {
            try {
                validating()
                validator.validate(target, c)
                return target
            } catch (e: Exception) {
                target.delete()
                if (e is IOException) throw e
                throw IOException("APK verification failed. The file was discarded and was not installed.")
            }
        }
        var restarted = false
        while (true) {
            if (cancelled.get() || cancel.cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
            val part = File(target.path + ".part")
            val meta = File(target.path + ".part.properties")
            requireUpdate(UpdateGuards.isSafeUpdateFile(directory, part), "Unsafe APK path.")
            val props = Properties()
            if (meta.isFile) try { meta.inputStream().use { props.load(it) } } catch (_: Exception) { props.clear() }
            val storedEtag = props.getProperty("etag").orEmpty()
            val plan = UpdateStorage.planResume(
                UpdateResumeContract.metadataMatches(props, c.asset, c.url, c.sha256, c.size, "armeabi-v7a"),
                storedEtag, part.length(), c.size,
            )
            val start = plan.start
            if (!plan.resume) {
                part.delete()
                meta.delete()
            }
            requireFreeSpace(c.size, start)
            cancel.cancelled.set(cancelled.get())
            val startedAt = System.currentTimeMillis()
            var lastBytes = start
            var lastTick = startedAt
            try {
                val result = JdkHttp.streamTo(
                    c.url, part, start, c.size, System.nanoTime() + 30L * 60 * 1_000_000_000L, GithubGate, cancel,
                    object : HeaderSink {
                        override fun onHeaders(status: Int, etag: String, contentRange: String, contentType: String) {
                            if (etag.isBlank()) return
                            try { saveMeta(meta, c, etag) } catch (_: Exception) { /* resume is optional */ }
                        }
                    },
                    object : ProgressSink {
                        override fun onBytes(count: Long) {
                            val now = System.currentTimeMillis()
                            if (now - lastTick < 350 && count != c.size) return
                            val elapsed = (now - lastTick).coerceAtLeast(1)
                            val speed = ((count - lastBytes) * 1000L) / elapsed
                            lastBytes = count
                            lastTick = now
                            progress(count, speed.coerceAtLeast(0))
                        }
                    }
                )
                if (DownloadTransferPolicy.restartInstead(result.status, start)) {
                    part.delete()
                    meta.delete()
                    if (restarted) throw IOException("Download interrupted. Retry to continue the download.")
                    restarted = true
                    continue
                }
                if (start > 0 && !DownloadTransferPolicy.mayResume(storedEtag, result.etag, result.status, result.contentRange, start, c.size)) {
                    part.delete()
                    meta.delete()
                    if (restarted) throw IOException("Download interrupted. Retry to continue the download.")
                    restarted = true
                    continue
                }
                if (cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
                validating()
                validator.validate(part, c)
                if (cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
                finalize(part, target, c)
                meta.delete()
                return target
            } catch (e: InterruptedIOException) {
                // A viewer cancel keeps a resumable partial when the bytes on
                // disk are still inside the expected size; the next attempt
                // resumes only after the ETag and Range checks pass.
                if (!(part.isFile && UpdateStorage.keepPartialOnCancel(part.length(), c.size) && meta.isFile)) {
                    part.delete()
                    meta.delete()
                }
                throw e
            } catch (e: IOException) {
                val problem = if (e is UpdateStorageFailure) e.problem else UpdateStorage.classify(e)
                val fatal = problem == StorageProblem.FULL || problem == StorageProblem.PERMISSION ||
                    problem == StorageProblem.READ_ONLY || problem == StorageProblem.UNAVAILABLE
                val keep = !fatal && part.isFile && part.length() in 1 until c.size && meta.isFile &&
                    e !is HttpFailure && !e.message.orEmpty().contains("exceeds") &&
                    !e.message.orEmpty().contains("Not enough storage") && !e.message.orEmpty().contains("error page")
                if (!keep) {
                    part.delete()
                    meta.delete()
                }
                if (e is UpdateStorageFailure) throw e
                if (fatal) throw UpdateStorageFailure(
                    if (problem == StorageProblem.FULL) "Not enough storage. Free space and retry."
                    else "Update storage is no longer writable.",
                    e, problem, "write",
                )
                throw e
            }
        }
    }

    /**
     * Reports a genuinely unavailable download before the first byte, using
     * both the total and usable figures. An unknown capacity (0/0 or a
     * negative answer) never blocks the transfer.
     */
    private fun requireFreeSpace(size: Long, partial: Long) {
        val total = try { directory.totalSpace } catch (_: Exception) { 0L }
        val usable = try { directory.usableSpace } catch (_: Exception) { 0L }
        val required = UpdateStorage.requiredBytes(size, partial)
        when (UpdateStorage.spaceState(total, usable, required)) {
            SpaceState.FULL, SpaceState.SHORT -> throw UpdateStorageFailure(
                "Not enough storage. Free space and retry.", null,
                StorageProblem.FULL, "free-space",
            )
            SpaceState.UNKNOWN, SpaceState.ENOUGH -> Unit
        }
    }

    private fun finalize(part: File, target: File, c: Candidate) {
        if (target.exists()) target.delete()
        if (part.renameTo(target)) return
        // A same-directory rename can fail on a storage driver even though a
        // copy still works. Copy, then revalidate the result: a truncated copy
        // is never handed to the installer.
        try {
            part.copyTo(target, overwrite = true)
            validator.validate(target, c)
            part.delete()
        } catch (error: Exception) {
            try { target.delete() } catch (_: Exception) { }
            throw UpdateStorageFailure(
                "Could not finalize the verified APK. Check storage and retry.",
                error, UpdateStorage.classify(error), "finalize",
            )
        }
    }

    private fun saveMeta(meta: File, c: Candidate, etag: String) {
        val props = Properties()
        props.setProperty("asset", c.asset)
        props.setProperty("url", c.url)
        props.setProperty("sha256", c.sha256)
        props.setProperty("size", c.size.toString())
        props.setProperty("abi", "armeabi-v7a")
        props.setProperty("etag", etag)
        meta.outputStream().use { props.store(it, "ytark update resume") }
    }

    /**
     * Deletes only updater-owned artifacts. The current candidate, its resume
     * pair and the staged installer are retained; other partials become
     * eligible only after the bounded age/count/size rules in [UpdateStorage].
     * Unknown files in the directory are never touched.
     */
    fun clean(keep: Set<String>) {
        requirePrepared()
        val candidates = UpdateStorage.cleanupCandidates(directory, keep, System.currentTimeMillis())
        candidates.forEach { file ->
            try { file.delete() } catch (_: Exception) { /* cleanup is best effort */ }
        }
    }
}
