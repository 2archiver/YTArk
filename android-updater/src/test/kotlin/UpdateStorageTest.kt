package io.github.twoarchiver.ytark.updater

import java.io.File
import java.io.IOException
import java.nio.file.Files

/**
 * Host-JVM storage regression tests for the 3.9 "local update storage is
 * unavailable" failure. Every case uses a real temporary directory except the
 * explicitly simulated write failures, so directory creation, containment,
 * permissions and cleanup are exercised rather than asserted from source text.
 */
private var checks = 0

private fun check(value: Boolean, message: String) {
    checks += 1
    if (!value) throw AssertionError(message)
}

private fun tempRoot(name: String): File {
    val root = Files.createTempDirectory("ytark-$name").toFile()
    root.deleteOnExit()
    return root
}

private fun managed(code: Long, hash: Char, suffix: String = ".apk") =
    "$code-${hash.toString().repeat(64)}$suffix"

fun main() {
    existingAndMissingDirectoriesAreAccepted()
    aBlockingFileIsMovedAsideWithoutDeletingIt()
    aFailedMkdirIsNotReportedAsAFullDisk()
    aDeniedWriteIsAPermissionProblem()
    simulatedWriteFailuresAreClassifiedDistinctly()
    unknownCapacityDoesNotClaimAFullDisk()
    sizeArithmeticSaturatesInsteadOfOverflowing()
    staleForeignAndCompletePartialsAreNeverAppended()
    symlinkedAncestorsAreSafeButEscapingDirectoriesAreNot()
    cleanupUsesAgeCountAndSizeBoundsAndNeverTouchesUnknownFiles()
    storageFailuresMapToDistinctUserMessages()
    typedProblemsSurviveTheCoordinatorStorageGate()
    println("UpdateStorage tests passed ($checks checks).")
}

private fun existingAndMissingDirectoriesAreAccepted() {
    val files = File(tempRoot("storage-files"), "files").apply { check(mkdirs(), "files fixture") }
    val existing = UpdateStorage.directoryFor(files)!!
    check(existing.mkdirs(), "existing directory fixture")
    val existingResult = UpdateStorage.prepare(files, existing)
    check(existingResult.ok, "an existing writable update directory is accepted: ${existingResult.message()}")
    val absent = File(files, "ytark-updates-absent")
    val absentResult = UpdateStorage.prepare(files, absent)
    check(absentResult.ok && absent.isDirectory, "an absent directory is created")
    check(UpdateStorage.isContained(files, absent), "the created directory is contained")
    check(UpdateStorage.isContained(files, UpdateStorage.directoryFor(files)!!),
        "the production directory name locates under files")
}

private fun aBlockingFileIsMovedAsideWithoutDeletingIt() {
    val files = File(tempRoot("storage-blocked"), "files").apply { check(mkdirs(), "files fixture") }
    val blocked = File(files, "updates")
    blocked.writeText("stray-but-app-private")
    check(blocked.isFile, "blocking file fixture")
    val result = UpdateStorage.prepare(files, blocked)
    check(result.ok, "a stray file at the directory path is recovered: ${result.message()}")
    check(blocked.isDirectory, "the real directory now exists")
    val backup = File(files, "updates.blocked")
    check(backup.isFile && backup.readText() == "stray-but-app-private",
        "the stray file is preserved as a bounded backup, not deleted")
}

private fun aFailedMkdirIsNotReportedAsAFullDisk() {
    val files = File(tempRoot("storage-mkdir"), "files").apply { check(mkdirs(), "files fixture") }
    val blocker = File(files, "not-a-directory")
    blocker.writeText("x")
    check(blocker.isFile, "blocker fixture")
    // mkdirs() under a regular file cannot succeed.
    val result = UpdateStorage.prepare(files, File(blocker, "child"))
    check(!result.ok, "a failed mkdir is a failure")
    check(result.problem == StorageProblem.CREATE_FAILED,
        "a failed mkdir is CREATE_FAILED, not FULL: ${result.problem}")
    check(!result.message().contains("free space", ignoreCase = true),
        "mkdir failure does not claim the disk is full: ${result.message()}")
}

private fun aDeniedWriteIsAPermissionProblem() {
    val files = File(tempRoot("storage-permission"), "files").apply { check(mkdirs(), "files fixture") }
    val directory = File(files, "updates").apply { check(mkdirs(), "updates fixture") }
    check(directory.setWritable(false, false), "permission fixture")
    try {
        val result = UpdateStorage.prepare(files, directory)
        // Some CI filesystems ignore the mode for a privileged test user. The
        // simulated SecurityException case below always exercises the branch.
        if (!result.ok) {
            check(result.problem == StorageProblem.PERMISSION,
                "a denied probe is PERMISSION: ${result.problem}")
            check(!result.message().contains("free space", ignoreCase = true),
                "permission failure does not claim a full disk")
        }
    } finally {
        directory.setWritable(true, false)
    }
    val simulated = UpdateStorage.prepare(files, directory) { throw SecurityException("write denied") }
    check(!simulated.ok && simulated.problem == StorageProblem.PERMISSION,
        "SecurityException maps to PERMISSION")
}

private fun simulatedWriteFailuresAreClassifiedDistinctly() {
    val files = File(tempRoot("storage-simulated"), "files").apply { check(mkdirs(), "files fixture") }
    val directory = File(files, "updates").apply { check(mkdirs(), "updates fixture") }
    val full = UpdateStorage.prepare(files, directory) { throw IOException("No space left on device") }
    check(!full.ok && full.problem == StorageProblem.FULL, "ENOSPC is FULL")
    val readonly = UpdateStorage.prepare(files, directory) { throw IOException("Read-only file system") }
    check(!readonly.ok && readonly.problem == StorageProblem.READ_ONLY, "EROFS is READ_ONLY")
    val io = UpdateStorage.prepare(files, directory) { throw IOException("Input/output error") }
    check(!io.ok && io.problem == StorageProblem.IO, "a generic I/O error is IO")
    val missing = UpdateStorage.prepare(files, directory) { throw java.io.FileNotFoundException("No such file or directory") }
    check(!missing.ok && missing.problem == StorageProblem.IO, "a missing path is IO")
}

private fun unknownCapacityDoesNotClaimAFullDisk() {
    val required = UpdateStorage.requiredBytes(120L * 1024 * 1024, 0)
    check(UpdateStorage.spaceState(0, 0, required) == SpaceState.UNKNOWN,
        "total/usable 0 is an unknown answer, not full")
    check(UpdateStorage.spaceState(-1, 5, required) == SpaceState.UNKNOWN,
        "an invalid total is unknown")
    check(UpdateStorage.spaceState(2L * 1024 * 1024 * 1024, 0, required) == SpaceState.FULL,
        "a known total with zero usable is full")
    check(UpdateStorage.spaceState(2L * 1024 * 1024 * 1024, required - 1, required) == SpaceState.SHORT,
        "one byte short is short")
    check(UpdateStorage.spaceState(2L * 1024 * 1024 * 1024, required, required) == SpaceState.ENOUGH,
        "exactly enough is accepted")
}

private fun sizeArithmeticSaturatesInsteadOfOverflowing() {
    check(UpdateStorage.requiredBytes(Long.MAX_VALUE, 0) == Long.MAX_VALUE,
        "a huge size saturates instead of wrapping negative")
    check(UpdateStorage.requiredBytes(100L, 100L) == UpdateStorage.SAFETY_MARGIN_BYTES,
        "a complete partial needs only the margin")
    check(UpdateStorage.requiredBytes(100L, 40L) == 60L + UpdateStorage.SAFETY_MARGIN_BYTES,
        "a resume needs only the remaining bytes")
    check(UpdateStorage.requiredBytes(-5L, 0) == UpdateStorage.SAFETY_MARGIN_BYTES,
        "an invalid size does not overflow")
}

private fun staleForeignAndCompletePartialsAreNeverAppended() {
    val size = 1000L
    val middle = UpdateStorage.planResume(true, "\"etag\"", 400, size)
    check(middle.resume && middle.start == 400L && !middle.discard, "a matching partial resumes at its length")
    val noEtag = UpdateStorage.planResume(true, "", 400, size)
    check(!noEtag.resume && noEtag.discard && noEtag.start == 0L, "a partial without an ETag restarts")
    val foreign = UpdateStorage.planResume(false, "\"etag\"", 400, size)
    check(!foreign.resume && foreign.discard, "metadata for another candidate restarts")
    val complete = UpdateStorage.planResume(true, "\"etag\"", size, size)
    check(!complete.resume && complete.discard, "a complete leftover is not appended to")
    val oversized = UpdateStorage.planResume(true, "\"etag\"", size + 1, size)
    check(!oversized.resume && oversized.discard, "an oversized partial is discarded")
    val empty = UpdateStorage.planResume(true, "\"etag\"", 0, size)
    check(!empty.resume && !empty.discard, "an empty partial starts a fresh transfer")
    check(UpdateStorage.apkName(4100000, "ab".repeat(32)) == "4100000-abababababababababababababababababababababababababababababababab.apk",
        "the app-owned APK name is candidate-unique")
    check(UpdateStorage.isManagedName(UpdateStorage.apkName(4100000, "ab".repeat(32))),
        "the target is a managed updater name")
    check(!UpdateStorage.isManagedName("user-notes.txt") && !UpdateStorage.isManagedName("update.apk.bak"),
        "unrelated names are not managed")
    check(UpdateStorage.keepPartialOnCancel(400, size), "a viewer cancel keeps a resumable prefix")
    check(!UpdateStorage.keepPartialOnCancel(0, size), "an empty partial is not kept")
    check(!UpdateStorage.keepPartialOnCancel(size, size), "a complete file is not treated as a partial")
    check(!UpdateStorage.keepPartialOnCancel(size + 1, size), "oversized bytes are discarded")
    check(!UpdateStorage.keepPartialOnCancel(400, 0), "an unknown size prevents a resume claim")
}

private fun symlinkedAncestorsAreSafeButEscapingDirectoriesAreNot() {
    val root = tempRoot("storage-symlink")
    val real = File(root, "real-files").apply { check(mkdirs(), "real files fixture") }
    val updates = File(real, "updates").apply { check(mkdirs(), "updates fixture") }
    val link = File(root, "linked-files")
    val supported = try {
        Files.createSymbolicLink(link.toPath(), real.toPath())
        true
    } catch (_: Exception) {
        false
    }
    if (supported) {
        check(UpdateStorage.isContained(link, File(link, "updates")),
            "a symlinked files ancestor does not make a writable update directory unsafe")
        val prepared = UpdateStorage.prepare(link, File(link, "updates"))
        check(prepared.ok, "the symlinked ancestor path is usable: ${prepared.message()}")
        val outside = File(root, "outside").apply { check(mkdirs(), "outside fixture") }
        val escaping = File(link, "escaping")
        Files.createSymbolicLink(escaping.toPath(), outside.toPath())
        check(!UpdateStorage.isContained(link, escaping), "an escaping directory symlink is rejected")
        val escaped = UpdateStorage.prepare(link, escaping)
        check(!escaped.ok && escaped.problem == StorageProblem.UNSAFE,
            "an escaping directory is UNSAFE, not unavailable/full: ${escaped.problem}")
    }
    check(UpdateGuards.isSafeUpdateDirectory(real, updates), "UpdateGuards accepts the real directory")
    check(UpdateGuards.isSafeUpdateFile(updates, File(updates, "1-a.apk")), "a direct child file is safe")
    check(!UpdateGuards.isSafeUpdateFile(updates, File(File(real, "elsewhere"), "1-a.apk")),
        "a file outside the directory is not safe")
}

private fun cleanupUsesAgeCountAndSizeBoundsAndNeverTouchesUnknownFiles() {
    val files = File(tempRoot("storage-cleanup"), "files").apply { check(mkdirs(), "files fixture") }
    val directory = File(files, "updates").apply { check(mkdirs(), "updates fixture") }
    val now = 10L * 24 * 60 * 60 * 1000
    val current = File(directory, managed(4100000, 'a'))
    val currentPart = File(directory, current.name + ".part")
    val old = File(directory, managed(3900000, 'b'))
    val oldPart = File(directory, old.name + ".part")
    val oldMeta = File(directory, oldPart.name + ".properties")
    val recent = File(directory, managed(4000000, 'c'))
    val unknown = File(directory, "user-notes.txt")
    listOf(current, currentPart, old, oldPart, oldMeta, recent, unknown).forEach {
        it.writeText("x")
        check(it.isFile, "fixture ${it.name}")
    }
    listOf(old, oldPart, oldMeta).forEach { check(it.setLastModified(now - UpdateStorage.STALE_AGE_MS - 1000), "age ${it.name}") }
    check(current.setLastModified(now - UpdateStorage.STALE_AGE_MS - 1000), "current age")
    check(recent.setLastModified(now), "recent age")
    val keep = setOf(current.path)
    val deletions = UpdateStorage.cleanupCandidates(directory, keep, now)
    check(old in deletions && oldPart in deletions && oldMeta in deletions,
        "old updater-owned partials are eligible: ${deletions.map { it.name }}")
    check(current !in deletions && currentPart !in deletions,
        "the retained candidate and its resume part are never deleted")
    check(recent !in deletions, "a recent partial is retained")
    check(unknown !in deletions, "an unknown file is never a cleanup candidate")
    val bounded = UpdateStorage.cleanupCandidates(directory, emptySet(), now, maxFiles = 1)
    check(bounded.size >= 5, "the count bound removes the surplus managed files: ${bounded.size}")
    check(unknown !in bounded, "the unknown file survives the count bound")
    val bySize = UpdateStorage.cleanupCandidates(directory, emptySet(), now, maxFiles = 10, maxBytes = 0)
    check(bySize.size >= 6, "the byte bound removes managed files")
    check(unknown !in bySize, "the unknown file survives the byte bound")
}

private fun storageFailuresMapToDistinctUserMessages() {
    val now = 1_000_000L
    val full = UpdateErrorMapper.map(
        UpdateStorageFailure("no room", null, StorageProblem.FULL, "write-probe"), "download", now, "v4.1.0")
    check(full.category == "storage_full", "full category")
    check(full.message.contains("Not enough storage"), "full message names storage space")
    check(full.detail.contains("Storage operation: write-probe"), "the failing operation is preserved")
    val permission = UpdateErrorMapper.map(
        UpdateStorageFailure("denied", null, StorageProblem.PERMISSION, "mkdirs"), "download", now, "v4.1.0")
    check(permission.category == "storage_permission", "permission category")
    check(!permission.message.contains("Not enough storage"), "permission does not claim insufficient space")
    check(!permission.message.contains("full", ignoreCase = true), "permission does not claim a full disk")
    val io = UpdateErrorMapper.map(
        UpdateStorageFailure("broken", null, StorageProblem.IO, "write"), "download", now, "v4.1.0")
    check(io.category == "storage_io", "I/O category")
    check(!io.message.contains("Not enough storage"), "I/O does not claim insufficient space")
    val path = UpdateErrorMapper.map(
        UpdateStorageFailure("blocked", null, StorageProblem.PATH_BLOCKED, "rename-blocker"), "download", now, "v4.1.0")
    check(path.category == "storage_path" && path.message.contains("blocked"), "path category")
    val network = UpdateErrorMapper.map(IOException("Download interrupted. Retry to continue the download."), "download", now, "v4.1.0")
    check(network.category != "storage_full" && network.category != "storage_permission",
        "a network interruption is not mislabeled as a storage problem")
    val enospc = UpdateErrorMapper.map(IOException("No space left on device"), "download", now, "v4.1.0")
    check(enospc.category == "storage_full", "a raw ENOSPC keeps the full-storage category")
    check(enospc.message.contains("Not enough storage"), "a raw ENOSPC names the missing space")
}

private fun typedProblemsSurviveTheCoordinatorStorageGate() {
    val failure = UpdateStorageFailure("denied", null, StorageProblem.PERMISSION, "write-probe")
    val access = UpdateStorageAccess(
        RetryableDependency(create = { Any() }, prepare = {}),
    ) { throw failure }
    val optional = access.optional()
    check(optional is DependencyResult.Unavailable && optional.cause === failure,
        "optional access exposes the real cause")
    check(access.lastFailure() === failure, "the last failure is available for reporting")
    try {
        access.required()
        error("required storage must fail")
    } catch (expected: UpdateStorageFailure) {
        check(expected.problem == StorageProblem.PERMISSION, "the typed problem survives required()")
        check(expected.operation == "write-probe", "the failing operation survives required()")
        check(!expected.message.orEmpty().contains("Free space"), "the generic gate no longer asserts free space")
    }
}
