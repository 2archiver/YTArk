package io.github.twoarchiver.ytark.updater

import android.content.Context
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.util.Properties
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Writes only to an app-owned .part file and renames it after validation.
 * An incomplete file is never handed to the installer.
 *
 * Resume requires a stored ETag plus a 206/Content-Range match. Anything else
 * restarts. A download does not survive process death as an in-flight transfer;
 * a leftover .part can be resumed on the next attempt when the ETag still matches.
 * DownloadManager is not used: this build must not add a notification permission,
 * and process-death survival is not claimed.
 */
class DownloadController(context: Context, private val validator: ApkValidator) {
    val directory = File(context.filesDir, "ytark-updates-v31")
    private val cancel = CancelHandle()
    init {
        requireUpdate(directory.mkdirs() || directory.isDirectory, "Cannot create update storage.")
        requireUpdate(UpdateGuards.isSafeUpdateDirectory(context.filesDir, directory), "Unsafe update storage.")
    }
    fun file(c: Candidate) = File(directory, "${c.code}-${c.sha256}.apk").also { requireUpdate(UpdateGuards.isSafeUpdateFile(directory, it), "Unsafe APK path.") }
    fun cancel() { cancel.cancel() }

    fun download(c: Candidate, cancelled: AtomicBoolean, progress: (Long, Long) -> Unit, validating: () -> Unit): File {
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
            if (meta.isFile) meta.inputStream().use { props.load(it) }
            val storedEtag = props.getProperty("etag").orEmpty()
            val resume = UpdateResumeContract.metadataMatches(props, c.asset, c.url, c.sha256, c.size, "armeabi-v7a") &&
                storedEtag.isNotBlank() && part.length() in 1 until c.size
            val start = if (resume) part.length() else 0L
            if (!resume) {
                part.delete()
                meta.delete()
            }
            val remaining = c.size - start
            requireUpdate(UpdateGuards.hasEnoughFreeSpace(directory.usableSpace, remaining.coerceAtLeast(1), 0), "Not enough storage. Free space and retry.")
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
                            saveMeta(meta, c, etag)
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
                if (target.exists()) target.delete()
                requireUpdate(part.renameTo(target), "Could not finalize APK. Check storage.")
                meta.delete()
                return target
            } catch (e: InterruptedIOException) {
                part.delete()
                meta.delete()
                throw e
            } catch (e: IOException) {
                val keep = part.isFile && part.length() in 1 until c.size && meta.isFile && e !is HttpFailure && !e.message.orEmpty().contains("exceeds") && !e.message.orEmpty().contains("Not enough storage") && !e.message.orEmpty().contains("error page")
                if (!keep) {
                    part.delete()
                    meta.delete()
                }
                if (e.message.orEmpty().contains("No space") || e.message.orEmpty().contains("ENOSPC")) throw IOException("Not enough storage. Free space and retry.")
                throw e
            }
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

    fun clean(keep: Set<String>) {
        val retained = keep.filter { it.isNotEmpty() }.flatMap { listOf(it, "$it.part", "$it.part.properties") }.toSet()
        directory.listFiles()?.forEach { file ->
            if (file.path in retained || !UpdateGuards.isSafeUpdateFile(directory, file)) return@forEach
            val managed = file.name.matches(Regex("[0-9]+-[0-9a-f]{64}\\.apk(?:\\.part(?:\\.properties)?)?")) || UpdateGuards.isStaleUpdateFile(file.name)
            if (managed) file.delete()
        }
    }
}
