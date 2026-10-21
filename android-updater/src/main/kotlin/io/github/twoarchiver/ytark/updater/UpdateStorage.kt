package io.github.twoarchiver.ytark.updater

import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.util.Locale
import java.util.UUID

/**
 * Host-testable update-storage rules.
 *
 * The updater only ever uses app-private storage (`Context.filesDir`), which
 * needs no storage permission and is readable by the app's own
 * [PendingUpdateProvider]. Android TV firmware differs in how it exposes that
 * directory: some platforms report a path that traverses a symlink, some
 * report an unknown free-space figure as zero, and a probe file can fail for
 * reasons unrelated to free space. This object therefore:
 *
 *  - accepts any update directory that canonically resolves directly below the
 *    app's files directory (it does not require the path to be symlink-free),
 *  - proves writability with the same plain create/write operation the
 *    download uses (no fsync, no delete-as-a-condition),
 *  - distinguishes a full disk, a denied permission, a read-only mount, a
 *    blocked path and an I/O failure,
 *  - treats an unknown capacity as unknown instead of claiming a full disk.
 *
 * No Android type is referenced, so the rules run in the host-JRE tests.
 */
enum class StorageProblem {
    NONE,
    UNAVAILABLE,
    PATH_BLOCKED,
    CREATE_FAILED,
    PERMISSION,
    READ_ONLY,
    FULL,
    UNSAFE,
    IO,
}

data class StoragePreparation(
    @JvmField val ok: Boolean,
    @JvmField val problem: StorageProblem = StorageProblem.NONE,
    @JvmField val operation: String = "",
    @JvmField val detail: String = "",
    @JvmField val cause: Throwable? = null,
) {
    /** Concise, path-free text; detailed causes stay in updater diagnostics. */
    fun message(): String = when (problem) {
        StorageProblem.NONE -> "Update storage is ready."
        StorageProblem.UNAVAILABLE -> "App-private update storage is unavailable."
        StorageProblem.PATH_BLOCKED -> "The update folder is blocked by an unexpected file."
        StorageProblem.CREATE_FAILED -> "The update folder could not be created."
        StorageProblem.PERMISSION -> "YTArk is not allowed to write its update folder."
        StorageProblem.READ_ONLY -> "The TV's internal storage is read-only right now."
        StorageProblem.FULL -> "There is no free space for the update download."
        StorageProblem.UNSAFE -> "The update folder is outside the app's private files directory."
        StorageProblem.IO -> "Writing the update failed (I/O error)."
    }
}

/** Result of comparing a size requirement with the platform's free-space report. */
enum class SpaceState { UNKNOWN, FULL, SHORT, ENOUGH }

/** The exact resume decision for a leftover `.part` file. */
data class ResumePlan(
    @JvmField val resume: Boolean,
    @JvmField val start: Long,
    @JvmField val discard: Boolean,
)

object UpdateStorage {
    /** Kept stable across upgrades so existing staged APKs and the provider still resolve. */
    const val DIRECTORY_NAME = "ytark-updates-v31"
    const val SAFETY_MARGIN_BYTES = 32L * 1024 * 1024
    const val STALE_AGE_MS = 24L * 60L * 60L * 1000L
    const val MAX_MANAGED_FILES = 4
    const val MAX_MANAGED_BYTES = 768L * 1024 * 1024
    private const val PROBE_PREFIX = ".ytark-probe-"
    private const val BLOCKED_SUFFIX = ".blocked"

    private val MANAGED_NAME = Regex("[0-9]+-[0-9a-f]{64}\\.apk(?:\\.part(?:\\.properties)?)?")
    private val PROBE_NAME = Regex("\\.ytark-probe-[0-9a-fA-F-]+\\.tmp")

    /** Stable, candidate-unique app-owned APK name. */
    @JvmStatic fun apkName(code: Long, sha256: String): String = "$code-$sha256.apk"

    /**
     * A partial is resumed only when its metadata belongs to this exact
     * candidate, an ETag was recorded and its length is strictly between 0 and
     * the expected size. Otherwise it is discarded before transfer: appending
     * to a stale, foreign or complete partial is never safe.
     */
    @JvmStatic
    fun planResume(metadataMatches: Boolean, ETag: String?, partLength: Long, size: Long): ResumePlan {
        val resumable = metadataMatches && !ETag.isNullOrBlank() && size > 0L && partLength in 1 until size
        return ResumePlan(resumable, if (resumable) partLength else 0L, !resumable && partLength > 0L)
    }

    /** A viewer cancel keeps bytes only when they are a strict prefix of the APK. */
    @JvmStatic fun keepPartialOnCancel(partLength: Long, size: Long): Boolean =
        size > 0L && partLength in 1 until size

    /** The update directory under an app-private files directory. */
    @JvmStatic fun directoryFor(filesDirectory: File?): File? =
        if (filesDirectory == null) null else File(filesDirectory, DIRECTORY_NAME)

    /**
     * Canonical containment. `dir` must resolve to a direct child of `files`.
     * A symlinked *ancestor* of `files` is normal on some Android builds;
     * requiring absolute == canonical would reject a writable directory, so
     * only the resolved relationship is checked. A symlinked `dir` that leaves
     * the files directory is still rejected.
     */
    @JvmStatic
    fun isContained(files: File?, dir: File?): Boolean = try {
        if (files == null || dir == null) false
        else {
            val root = files.canonicalFile
            val target = dir.canonicalFile
            target.parentFile == root && target.name == dir.name
        }
    } catch (_: IOException) {
        false
    }

    /** Saturating byte requirement. Never wraps for a hostile/huge size value. */
    @JvmStatic
    fun requiredBytes(size: Long, partial: Long): Long {
        val remaining = if (size <= 0L) 0L else (size - partial.coerceIn(0L, size)).coerceAtLeast(0L)
        return saturatingAdd(remaining, SAFETY_MARGIN_BYTES)
    }

    @JvmStatic fun saturatingAdd(left: Long, right: Long): Long =
        if (right > 0L && left > Long.MAX_VALUE - right) Long.MAX_VALUE else left + right

    /**
     * `File.getUsableSpace()` answers 0 both for a genuinely full volume and
     * for an unsupported/unknown query. A non-positive total means the
     * platform could not answer at all; only a known total with zero usable
     * bytes is treated as full. Callers may proceed on UNKNOWN and let the
     * real write surface ENOSPC instead of refusing a healthy download.
     */
    @JvmStatic
    fun spaceState(total: Long, usable: Long, required: Long): SpaceState = when {
        total <= 0L || usable < 0L -> SpaceState.UNKNOWN
        usable == 0L -> SpaceState.FULL
        required <= 0L -> SpaceState.ENOUGH
        usable >= required -> SpaceState.ENOUGH
        else -> SpaceState.SHORT
    }

    /** Classifies a real write/create exception without losing its type. */
    @JvmStatic
    fun classify(error: Throwable?): StorageProblem {
        var cursor = error
        var depth = 0
        val text = StringBuilder()
        while (cursor != null && depth < 4) {
            if (cursor is SecurityException) return StorageProblem.PERMISSION
            text.append(' ').append(cursor.message ?: "").append(' ').append(cursor.javaClass.simpleName)
            cursor = cursor.cause
            depth += 1
        }
        val lower = text.toString().lowercase(Locale.US)
        return when {
            lower.contains("permission denied") || lower.contains("eacces") || lower.contains("eperm") -> StorageProblem.PERMISSION
            lower.contains("read-only") || lower.contains("read only") || lower.contains("erofs") -> StorageProblem.READ_ONLY
            lower.contains("no space left") || lower.contains("enospc") || lower.contains("not enough space") -> StorageProblem.FULL
            error is FileNotFoundException -> StorageProblem.IO
            else -> StorageProblem.IO
        }
    }

    /**
     * Creates/validates the directory and proves a plain create/write/close
     * works. [writeProbe] is injectable so the failure cases can be exercised
     * without filling a real disk; production passes a one-byte ordinary write.
     * A failed probe *cleanup* is not a storage failure: the bounded cleanup
     * pass removes old probe files.
     */
    @JvmStatic
    @JvmOverloads
    fun prepare(
        filesDirectory: File?,
        directory: File?,
        writeProbe: ((File) -> Unit)? = { file ->
            FileOutputStream(file).use { output ->
                output.write(0)
                output.flush()
            }
        },
    ): StoragePreparation {
        if (filesDirectory == null || directory == null) {
            return StoragePreparation(false, StorageProblem.UNAVAILABLE, "resolve")
        }
        try {
            if (directory.exists() && !directory.isDirectory) {
                // A stray file with the directory's name is not user media: it
                // is inside the app's private files directory, has our exact
                // name and blocks every update. Move it aside once instead of
                // deleting it, then continue.
                val backup = File(directory.parentFile, directory.name + BLOCKED_SUFFIX)
                if (backup.exists() || !directory.renameTo(backup)) {
                    return StoragePreparation(false, StorageProblem.PATH_BLOCKED, "rename-blocker")
                }
            }
            if (!directory.exists() && !directory.mkdirs() && !directory.isDirectory) {
                return StoragePreparation(false, StorageProblem.CREATE_FAILED, "mkdirs")
            }
            if (!directory.isDirectory) {
                return StoragePreparation(false, StorageProblem.CREATE_FAILED, "stat")
            }
            if (!isContained(filesDirectory, directory)) {
                return StoragePreparation(false, StorageProblem.UNSAFE, "containment")
            }
            if (writeProbe != null) {
                val probe = File(directory, PROBE_PREFIX + UUID.randomUUID().toString() + ".tmp")
                try {
                    writeProbe(probe)
                } catch (error: SecurityException) {
                    return StoragePreparation(false, StorageProblem.PERMISSION, "write-probe", cause = error)
                } catch (error: IOException) {
                    val problem = classify(error)
                    return StoragePreparation(false, problem, "write-probe", cause = error)
                } catch (error: Throwable) {
                    if (error is VirtualMachineError || error is ThreadDeath) throw error
                    return StoragePreparation(false, classify(error), "write-probe", cause = error)
                } finally {
                    // Cleanup is best effort and must never turn a successful
                    // write into a reported storage failure.
                    try { if (probe.exists()) probe.delete() } catch (_: Exception) { }
                }
            }
            return StoragePreparation(true, StorageProblem.NONE, "prepare")
        } catch (error: SecurityException) {
            return StoragePreparation(false, StorageProblem.PERMISSION, "prepare", cause = error)
        } catch (error: IOException) {
            return StoragePreparation(false, classify(error), "prepare", cause = error)
        } catch (error: Throwable) {
            if (error is VirtualMachineError || error is ThreadDeath) throw error
            return StoragePreparation(false, classify(error), "prepare", cause = error)
        }
    }

    /** True for names this updater created in its own directory. */
    @JvmStatic fun isManagedName(name: String?): Boolean =
        name != null && (MANAGED_NAME.matches(name) || PROBE_NAME.matches(name))

    /**
     * Picks only updater-owned artifacts that are safe to delete.
     *
     * Rules, in order: never touch a retained/current file; delete old
     * `.part`/metadata/probe files after [STALE_AGE_MS]; keep at most
     * [MAX_MANAGED_FILES] artifacts and [MAX_MANAGED_BYTES] in total by
     * deleting the oldest first. Unknown files are never candidates.
     */
    @JvmStatic
    @JvmOverloads
    fun cleanupCandidates(
        directory: File?,
        keep: Set<String>,
        now: Long,
        staleAgeMs: Long = STALE_AGE_MS,
        maxFiles: Int = MAX_MANAGED_FILES,
        maxBytes: Long = MAX_MANAGED_BYTES,
    ): List<File> {
        if (directory == null || !directory.isDirectory) return emptyList()
        val retained = keep.filter { it.isNotBlank() }.flatMap { listOf(it, "$it.part", "$it.part.properties") }.toSet()
        val managed = (directory.listFiles() ?: return emptyList()).filter { file ->
            file.isFile && isManagedName(file.name) &&
                file.path !in retained && file.name !in retained &&
                isDirectChild(directory, file)
        }.sortedBy { file ->
            try { file.lastModified() } catch (_: Exception) { 0L }
        }
        val deletions = LinkedHashSet<File>()
        for (file in managed) {
            val modified = try { file.lastModified() } catch (_: Exception) { 0L }
            val old = modified in 1 until (now - staleAgeMs).coerceAtLeast(0L)
            if (old) deletions.add(file)
        }
        val remaining = managed.filter { it !in deletions }.toMutableList()
        while (remaining.size > maxFiles.coerceAtLeast(1)) {
            deletions.add(remaining.removeAt(0))
        }
        var bytes = remaining.sumOf { file -> try { file.length() } catch (_: Exception) { 0L } }
        for (file in remaining) {
            if (bytes <= maxBytes) break
            bytes -= try { file.length() } catch (_: Exception) { 0L }
            deletions.add(file)
        }
        return deletions.toList()
    }

    @JvmStatic
    fun isDirectChild(directory: File?, file: File?): Boolean = try {
        directory != null && file != null && file.canonicalFile.parentFile == directory.canonicalFile
    } catch (_: IOException) {
        false
    }
}
