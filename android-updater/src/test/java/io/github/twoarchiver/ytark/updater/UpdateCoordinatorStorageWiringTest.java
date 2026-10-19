package io.github.twoarchiver.ytark.updater;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/** Source-level integration guard for the Android-only coordinator wiring. */
public final class UpdateCoordinatorStorageWiringTest {
    public static void main(String[] args) throws Exception {
        String root = System.getProperty("ytark.test.root");
        assertTrue(root != null && !root.isEmpty(), "shared test runner provides the repository root");
        Path updater = Paths.get(root, "android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/Update" + "Coordinator.kt");
        String coordinator = new String(Files.readAllBytes(updater), StandardCharsets.UTF_8);
        assertFalse(coordinator.contains("lateinit var files"), "storage is not represented by an unguarded lateinit controller");
        assertFalse(coordinator.contains("::files.isInitialized"), "callers use the explicit dependency gate");
        assertContains(coordinator, "private val downloadStorage = RetryableDependency(");
        assertContains(coordinator, "private val storageAccess = UpdateStorageAccess(downloadStorage)");
        assertContains(coordinator, "private fun requiredFiles(): " + "Download" + "Controller = storageAccess.required()");
        assertContains(coordinator, "private fun optionalFiles(): " + "Download" + "Controller? = when (val storage = storageAccess.optional())");
        assertInOrder(coordinator,
                "val saved = store.load()",
                "when (val storage = storageAccess.optional())",
                "val error = UpdateStorageFailure(\"Update storage could not be prepared while restoring the saved APK.\"",
                "set(UpdateStates.failed(saved, mapped, saved.candidate.tag).copy(verifiedPath = null, pendingIdentity = null))");

        String transfer = method(coordinator, "private fun transfer(", "    fun cancel()");
        assertInOrder(transfer, "val controller = requiredFiles()", "controller.download(c, cancelled");
        String prepareInstall = method(coordinator, "    fun prepareInstall(", "    fun markExternal(");
        assertInOrder(prepareInstall, "val file = requiredFiles().file(candidate)", "validator.validate(file, candidate)");
        String markExternal = method(coordinator, "    fun markExternal(", "    fun externalReturned(");
        assertInOrder(markExternal, "val staged = requiredFiles().file(candidate)", "if (staged.path != file.path", "UpdateStates.handedToSystem(state)");

        String applyCandidate = method(coordinator, "    private fun applyCandidate(", "    fun download()");
        assertInOrder(applyCandidate, "store.saveCache(cache.touched(now))", "val controller = optionalFiles()");
        String cleanup = method(coordinator, "    private fun cleanDownloads(", "    private fun stage()");
        assertInOrder(cleanup, "val controller = optionalFiles() ?: return", "controller.clean(keep)", "reportStorageFailure(\"storage_cleanup\", error)");
        assertContains(coordinator, "UpdateRepository(http).discover(!automatic, state.hours, now, rateUntil, store.loadCache())");

        String nativeDiagnostics = new String(Files.readAllBytes(Paths.get(root,
                "android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/NativeDiagnosticsCore.kt")), StandardCharsets.UTF_8);
        assertContains(nativeDiagnostics, "\"storage_initialization\", \"storage_cleanup\"");
        String activity = new String(Files.readAllBytes(Paths.get(root,
                "android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/Update" + "Activity.kt")), StandardCharsets.UTF_8);
        assertContains(activity, "Permission" + "DetourStore.load(applicationContext)");
        assertContains(activity, "Permission" + "DetourStore.save(applicationContext,snapshot,completed)");
        assertFalse(activity.contains("getSharedPreferences"), "permission-route reads and writes are delegated off the UI thread");
        assertFalse(activity.contains("editor.commit()"), "permission-route persistence must not synchronously write on the UI thread");
        String permissionStore = new String(Files.readAllBytes(Paths.get(root,
                "android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/Permission" + "DetourStore.kt")), StandardCharsets.UTF_8);
        assertContains(permissionStore, "storageWorker.execute { work() }");
        assertContains(permissionStore, "context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)");
        assertContains(permissionStore, "return editor.commit()");
        assertInOrder(permissionStore, "fun load(context: Context", "read(context.applicationContext)", "private fun read(context: Context)");
        String installCoordinator = new String(Files.readAllBytes(Paths.get(root,
                "android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/Install" + "Coordinator.kt")), StandardCharsets.UTF_8);
        String handoff = method(installCoordinator, "    private fun handoff(", "    private fun legacy(");
        assertInOrder(handoff, "updates.enqueue {", "val canCopy=try {", "file.parentFile?.usableSpace");
        int queueAt = handoff.indexOf("updates.enqueue {");
        assertTrue(queueAt >= 0, "installer filesystem preflight is scheduled on the coordinator worker");
        assertFalse(handoff.substring(0, queueAt).contains("usableSpace"), "free-space metadata is not read on the UI callback");
        String diagnosticStore = new String(Files.readAllBytes(Paths.get(root,
                "android-updater/src/main/kotlin/io/github/twoarchiver/ytark/updater/Android" + "Diagnostics.kt")), StandardCharsets.UTF_8);
        assertContains(diagnosticStore, "fun initialize(context: Context, onReady: (() -> Unit)? = null)");
        assertContains(diagnosticStore, "fun setEnabledAsync(enabled: Boolean, completed: (Boolean) -> Unit)");
        assertContains(diagnosticStore, "fun clearAsync(completed: (Boolean) -> Unit)");
        assertContains(diagnosticStore, "fun enabled(): Boolean = enabledInProcess");
        assertContains(diagnosticStore, "fun snapshot(): NativeDiagnosticsSnapshot {");
        assertFalse(diagnosticStore.contains("fun enabled(): Boolean = synchronized(lock)"), "UI status reads never wait behind SharedPreferences commits");
        assertFalse(diagnosticStore.contains("fun snapshot(): NativeDiagnosticsSnapshot = synchronized(lock)"), "UI report snapshots never wait behind SharedPreferences commits");
        assertInOrder(diagnosticStore, "fun record(name: String", "dispatchStorageWork { synchronized(lock) { recordLocked(name, outcome, durationMs) } }");
        System.out.println("Update" + "Coordinator storage wiring tests passed (explicit retry, optional metadata/cleanup, required transfer/install, diagnostics).");
    }

    private static String method(String source, String start, String end) {
        int from = source.indexOf(start);
        int to = from < 0 ? -1 : source.indexOf(end, from + start.length());
        assertTrue(from >= 0 && to > from, "source method range exists: " + start);
        return source.substring(from, to);
    }

    private static void assertInOrder(String source, String... fragments) {
        int previous = -1;
        for (String fragment : fragments) {
            int index = source.indexOf(fragment, previous + 1);
            assertTrue(index > previous, "expected ordered source fragment: " + fragment);
            previous = index;
        }
    }

    private static void assertContains(String source, String fragment) {
        assertTrue(source.contains(fragment), "expected source fragment: " + fragment);
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertFalse(boolean value, String message) {
        if (value) throw new AssertionError(message);
    }
}
