package io.github.twoarchiver.ytark.updater;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ContentResolver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Native, user-confirmed updater for YTArk on Android TV and Google TV. */
final class YtarkUpdater {
    private static final String TAG = "YTArkUpdater";
    private static final String PACKAGE_NAME = "io.github.twoarchiver.ytark";
    private static final String RELEASES_API =
            "https://api.github.com/repos/2archiver/YTArk/releases/latest";
    private static final String PREFS_NAME = "ytark_native_updater";
    private static final String CHANNEL_ID = "ytark_updates";
    private static final int NOTIFICATION_UPDATE = 7201;
    private static final int NOTIFICATION_DOWNLOAD = 7202;
    private static final int NOTIFICATION_STATUS = 7203;
    static final int PERIODIC_CHECK_JOB_ID = 7280;
    static final String STATE_IDLE = "idle";
    static final String STATE_CHECKING = "checking";
    static final String STATE_AVAILABLE = "available";
    static final String STATE_UP_TO_DATE = "up_to_date";
    static final String STATE_DOWNLOADING = "downloading";
    static final String STATE_VALIDATING = "validating";
    static final String STATE_PERMISSION_NEEDED = "permission_needed";
    static final String STATE_READY_TO_INSTALL = "ready_to_install";
    static final String STATE_INSTALLING = "installing";
    static final String STATE_INSTALL_CANCELLED = "install_cancelled";
    static final String STATE_CANCELLED = "cancelled";
    static final String STATE_FAILED = "failed";
    private static final long SNOOZE_MILLIS = 24L * 60L * 60L * 1000L;
    private static final int MAX_METADATA_BYTES = 1024 * 1024;
    private static final int MAX_RELEASE_NOTES_CHARS = 8000;
    private static final int MAX_REDIRECTS = 5;
    private static final long MAX_APK_BYTES = 512L * 1024L * 1024L;

    static final String ACTION_CHECK = "io.github.twoarchiver.ytark.action.CHECK_UPDATES";
    static final String ACTION_UPDATE = "io.github.twoarchiver.ytark.action.UPDATE_NOW";
    static final String ACTION_LATER = "io.github.twoarchiver.ytark.action.LATER";
    static final String ACTION_INSTALL = "io.github.twoarchiver.ytark.action.INSTALL_UPDATE";
    private static final String UPDATE_CONTENT_AUTHORITY_SUFFIX = ".ytarkupdater.files";
    private static final String UPDATE_CONTENT_PATH = "update.apk";
    private static final String UPDATE_MIME_TYPE = "application/vnd.android.package-archive";

    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "ytark-updater");
        thread.setDaemon(true);
        return thread;
    });
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    /** Guards the single check slot and its listener; see checkForUpdates. */
    private static final Object CHECK_LOCK = new Object();
    private static final Object AUTOMATIC_LOCK = new Object();
    private static final Object UPDATE_FILES_LOCK = new Object();
    private static boolean checkRunning;
    private static final List<CheckCallback> checkListeners = new ArrayList<>();
    private static boolean automaticRun;
    private static boolean automaticRerunRequested;
    private static boolean automaticCancellationRequested;
    private static Context automaticContext;
    private static final List<AutomaticCallback> automaticCallbacks = new ArrayList<>();
    private static final AtomicReference<DownloadOperation> ACTIVE_DOWNLOAD = new AtomicReference<>();

    interface CheckCallback {
        void onUpdateAvailable(ReleaseInfo release, String installedVersion);
        void onUpToDate(String installedVersion, String message);
        void onError(UpdateFailure reason, String message);
    }

    interface DownloadCallback {
        void onProgress(long downloaded, long total);
        void onVerifying();
        void onReady(File apk);
        void onError(UpdateFailure reason, String message);
    }

    interface AutomaticCallback {
        /** retry is true only for a recoverable network/rate-limit interruption. */
        void onFinished(boolean retry);
    }

    interface InstallCallback {
        void onReady(Intent intent);
        void onError(UpdateFailure reason, String message);
    }

    /** Result of one release lookup: a newer verified release, or "not newer" with context. */
    private static final class CheckOutcome {
        final ReleaseInfo release;
        final String latestVersion;
        final boolean installedAhead;

        CheckOutcome(ReleaseInfo release, String latestVersion, boolean installedAhead) {
            this.release = release;
            this.latestVersion = latestVersion;
            this.installedAhead = installedAhead;
        }
    }

    private static final class DownloadOperation {
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        final boolean automatic;
        final ReleaseInfo release;
        volatile HttpURLConnection connection;

        DownloadOperation(boolean automatic, ReleaseInfo release) {
            this.automatic = automatic;
            this.release = release;
        }

        void throwIfCancelled() throws UpdateCancelledException {
            if (cancelled.get()) throw new UpdateCancelledException();
        }
    }

    private static final class UpdateCancelledException extends InterruptedIOException {
        UpdateCancelledException() {
            super("YTARK_DOWNLOAD_CANCELLED");
        }
    }

    private static final class HttpStatusException extends IOException {
        final int status;
        final long retryAtMillis;
        final boolean rateLimited;

        HttpStatusException(int status, long retryAtMillis, boolean rateLimited) {
            super(rateLimited
                    ? "GitHub temporarily limited YTArk update checks. Try again after the retry window."
                    : "GitHub returned HTTP " + status + ".");
            this.status = status;
            this.retryAtMillis = retryAtMillis;
            this.rateLimited = rateLimited;
        }
    }

    private YtarkUpdater() { }

    static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "YTArk updates", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Stable YTArk update notifications");
        manager.createNotificationChannel(channel);
    }

    static boolean automaticChecksEnabled(Context context) {
        return preferences(context).getBoolean("automatic_checks_enabled", true);
    }

    static boolean automaticDownloadsEnabled(Context context) {
        return preferences(context).getBoolean("automatic_downloads_enabled", true);
    }

    static void setAutomaticChecksEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean("automatic_checks_enabled", enabled).apply();
        schedulePeriodicCheck(context);
    }

    static void setAutomaticDownloadsEnabled(Context context, boolean enabled) {
        SharedPreferences.Editor editor = preferences(context).edit()
                .putBoolean("automatic_downloads_enabled", enabled);
        if (enabled) editor.remove("cancelled_download_tag");
        editor.apply();
        if (!enabled) cancelAutomaticDownload(context);
    }

    static boolean isAutomaticCheckDue(Context context) {
        if (!automaticChecksEnabled(context)) return false;
        SharedPreferences p = preferences(context);
        long now = System.currentTimeMillis();
        return UpdateSchedulePolicy.isAutomaticCheckDue(
                p.getLong("last_check_at", 0L), p.getLong("last_attempt_at", 0L),
                p.getLong("last_success_at", 0L), p.getLong("last_failure_at", 0L),
                p.getLong("retry_after_at", 0L), p.getLong("rate_limit_until", 0L), now);
    }

    static long nextAutomaticCheckAt(Context context) {
        SharedPreferences p = preferences(context);
        long now = System.currentTimeMillis();
        return UpdateSchedulePolicy.nextEligibleAtMillis(
                p.getLong("last_check_at", 0L), p.getLong("last_attempt_at", 0L),
                p.getLong("last_success_at", 0L), p.getLong("last_failure_at", 0L),
                p.getLong("retry_after_at", 0L), p.getLong("rate_limit_until", 0L), now);
    }

    static void schedulePeriodicCheck(Context context) {
        Context app = context.getApplicationContext();
        JobScheduler scheduler = (JobScheduler) app.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) {
            Log.w(TAG, "JobScheduler is unavailable; automatic update checks cannot persist.");
            return;
        }
        if (!automaticChecksEnabled(app)) {
            scheduler.cancel(PERIODIC_CHECK_JOB_ID);
            return;
        }
        JobInfo current = scheduler.getPendingJob(PERIODIC_CHECK_JOB_ID);
        if (current != null && current.getIntervalMillis() == UpdateSchedulePolicy.CHECK_INTERVAL_MILLIS) return;
        if (current != null) scheduler.cancel(PERIODIC_CHECK_JOB_ID);
        JobInfo job = new JobInfo.Builder(PERIODIC_CHECK_JOB_ID,
                new ComponentName(app, UpdateCheckJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(UpdateSchedulePolicy.CHECK_INTERVAL_MILLIS, 15L * 60L * 1000L)
                .build();
        try {
            int result = scheduler.schedule(job);
            if (result != JobScheduler.RESULT_SUCCESS) {
                Log.w(TAG, "Android did not accept the persistent periodic updater job.");
            }
        } catch (IllegalArgumentException | SecurityException rejected) {
            Log.w(TAG, "Android rejected the persistent periodic updater job.", rejected);
        }
    }

    static String updaterState(Context context) {
        return preferences(context).getString("updater_state", STATE_IDLE);
    }

    static String updaterError(Context context) {
        return preferences(context).getString("updater_error", "");
    }

    static String updaterErrorPhase(Context context) {
        return UpdaterFailurePhasePolicy.normalize(
                preferences(context).getString("updater_error_phase", ""));
    }

    static long downloadBytes(Context context) {
        return preferences(context).getLong("downloaded_bytes", 0L);
    }

    static long downloadTotalBytes(Context context) {
        return preferences(context).getLong("download_total_bytes", 0L);
    }

    static void setUpdaterState(Context context, String state, String error) {
        setUpdaterState(context, state, error, null);
    }

    static void setUpdaterFailure(Context context, String error, String phase) {
        setUpdaterState(context, STATE_FAILED, error, phase);
    }

    private static void setUpdaterState(Context context, String state, String error, String failurePhase) {
        SharedPreferences.Editor editor = preferences(context).edit()
                .putString("updater_state", state)
                .putLong("updater_state_at", System.currentTimeMillis());
        if (error == null || error.length() == 0) editor.remove("updater_error");
        else editor.putString("updater_error", error);
        String normalizedPhase = STATE_FAILED.equals(state)
                ? UpdaterFailurePhasePolicy.normalize(failurePhase) : null;
        if (normalizedPhase == null) editor.remove("updater_error_phase");
        else editor.putString("updater_error_phase", normalizedPhase);
        editor.apply();
    }

    static void runAutomaticUpdate(Context context, AutomaticCallback callback) {
        runAutomaticUpdate(context, callback, false);
    }

    /** An explicit preference change should not be lost behind work being cancelled or joined. */
    static void requestAutomaticUpdate(Context context) {
        requestAutomaticUpdate(context, null);
    }

    static void requestAutomaticUpdate(Context context, AutomaticCallback callback) {
        runAutomaticUpdate(context, callback, true);
    }

    private static void runAutomaticUpdate(Context context, AutomaticCallback callback, boolean rerunIfBusy) {
        Context app = context.getApplicationContext();
        synchronized (AUTOMATIC_LOCK) {
            if (callback != null && automaticRun) automaticCallbacks.add(callback);
            if (automaticRun) {
                if (rerunIfBusy) automaticRerunRequested = true;
                return;
            }
            if (callback != null) automaticCallbacks.add(callback);
            automaticRun = true;
            automaticCancellationRequested = false;
            automaticContext = app;
        }
        if (!automaticChecksEnabled(app)) {
            finishAutomaticRun(false);
            return;
        }
        if (isAutomaticCancellationRequested()) {
            finishAutomaticRun(true);
            return;
        }
        if (hasVerifiedPending(app)) {
            if (handoffInFlight(app)) {
                setUpdaterState(app, STATE_INSTALLING,
                        "Android installer hand-off was recorded; installation is not confirmed yet.");
            } else if (installRequested(app) && !canRequestPackageInstalls(app)) {
                setUpdaterState(app, STATE_PERMISSION_NEEDED,
                        "Allow YTArk to install the verified update from Android settings.");
            } else {
                setUpdaterState(app, canRequestPackageInstalls(app)
                        ? STATE_READY_TO_INSTALL : STATE_PERMISSION_NEEDED, "");
            }
            finishAutomaticRun(false);
            return;
        }
        if (handoffInFlight(app) || installRequested(app)) {
            if (handoffInFlight(app)) {
                setUpdaterState(app, STATE_INSTALLING,
                        "An install request is pending; automatic checks and downloads are paused until the installer flow is reconciled.");
            } else {
                setUpdaterFailure(app,
                        "An install request is pending; automatic checks and downloads are paused until the installer flow is reconciled.",
                        UpdaterFailurePhasePolicy.INSTALL);
            }
            finishAutomaticRun(false);
            return;
        }
        if (isDownloadInProgress()) {
            finishAutomaticRun(false);
            return;
        }
        if (!isAutomaticCheckDue(app)) {
            ReleaseInfo saved = selectedRelease(app);
            if (automaticDownloadsEnabled(app) && saved != null
                    && !isReleaseSkipped(app, saved.tag)
                    && !isAutomaticDownloadSuppressed(app, saved.tag)) {
                startAutomaticDownload(app, saved);
            } else {
                finishAutomaticRun(false);
            }
            return;
        }
        checkForUpdates(app, false, new CheckCallback() {
            @Override public void onUpdateAvailable(ReleaseInfo release, String installedVersion) {
                if (isAutomaticCancellationRequested()) {
                    finishAutomaticRun(true);
                } else if (!automaticChecksEnabled(app) || isReleaseSkipped(app, release.tag)) {
                    finishAutomaticRun(false);
                } else if (automaticDownloadsEnabled(app)
                        && !isAutomaticDownloadSuppressed(app, release.tag)) {
                    startAutomaticDownload(app, release);
                } else {
                    notifyIfNeeded(app, release);
                    finishAutomaticRun(false);
                }
            }
            @Override public void onUpToDate(String installedVersion, String message) {
                finishAutomaticRun(isAutomaticCancellationRequested());
            }
            @Override public void onError(UpdateFailure reason, String message) {
                finishAutomaticRun(isAutomaticCancellationRequested()
                        || reason == UpdateFailure.OFFLINE
                        || reason == UpdateFailure.RATE_LIMITED || reason == UpdateFailure.RELEASE_LOOKUP_FAILED);
            }
        });
    }

    private static void startAutomaticDownload(Context app, ReleaseInfo release) {
        downloadAndVerify(app, release, true, new DownloadCallback() {
            @Override public void onProgress(long downloaded, long total) { }
            @Override public void onVerifying() { }
            @Override public void onReady(File apk) {
                finishAutomaticRun(false);
            }
            @Override public void onError(UpdateFailure reason, String message) {
                finishAutomaticRun(automaticDownloadsEnabled(app)
                        && (reason == UpdateFailure.OFFLINE
                        || reason == UpdateFailure.RATE_LIMITED
                        || reason == UpdateFailure.DOWNLOAD_FAILED));
            }
        });
    }

    static void cancelAutomaticRun(Context context) {
        synchronized (AUTOMATIC_LOCK) {
            if (automaticRun) {
                automaticCancellationRequested = true;
                automaticRerunRequested = false;
            }
        }
        cancelAutomaticDownload(context);
    }

    private static boolean isAutomaticCancellationRequested() {
        synchronized (AUTOMATIC_LOCK) {
            return automaticCancellationRequested;
        }
    }

    private static void finishAutomaticRun(boolean retry) {
        final List<AutomaticCallback> callbacks;
        final Context rerunContext;
        synchronized (AUTOMATIC_LOCK) {
            callbacks = new ArrayList<>(automaticCallbacks);
            automaticCallbacks.clear();
            automaticRun = false;
            // A cancellation suppresses this run, but a later explicit user
            // request may still queue a fresh attempt behind it.
            rerunContext = automaticRerunRequested ? automaticContext : null;
            automaticRerunRequested = false;
            automaticCancellationRequested = false;
            automaticContext = null;
        }
        if (rerunContext != null) {
            AutomaticCallback completion = callbacks.isEmpty() ? null : result -> {
                for (AutomaticCallback callback : callbacks) callback.onFinished(result);
            };
            MAIN.post(() -> runAutomaticUpdate(rerunContext, completion));
            return;
        }
        for (AutomaticCallback callback : callbacks) MAIN.post(() -> callback.onFinished(retry));
    }

    static long lastCheckAt(Context context) {
        return preferences(context).getLong("last_check_at", 0L);
    }

    static String lastCheckStatus(Context context) {
        return preferences(context).getString("last_check_status", "");
    }

    static void checkForUpdates(Context context, boolean manual, CheckCallback callback) {
        final Context app = context.getApplicationContext();
        boolean useSavedResult = false;
        synchronized (CHECK_LOCK) {
            if (checkRunning) {
                // All interested screens/jobs join one lookup; no listener is
                // displaced when the app resumes during a manual check.
                if (callback != null) checkListeners.add(callback);
                return;
            }
            if (!manual && !isAutomaticCheckDue(app)) {
                useSavedResult = true;
            } else {
                checkRunning = true;
                checkListeners.clear();
                if (callback != null) checkListeners.add(callback);
            }
        }
        if (useSavedResult) {
            if (callback != null) {
                ReleaseInfo saved = selectedRelease(app);
                String installedName = installedVersionName(app);
                MAIN.post(() -> {
                    if (saved != null) callback.onUpdateAvailable(saved, installedName);
                    else callback.onUpToDate(installedName,
                            "An automatic check is not due yet; using the persisted release-check result.");
                });
            }
            return;
        }

        preferences(app).edit().putLong("last_attempt_at", System.currentTimeMillis())
                .putString("last_check_status", "Checking for stable updates…")
                .putString("updater_state", STATE_CHECKING)
                .putLong("updater_state_at", System.currentTimeMillis())
                .remove("updater_error").remove("updater_error_phase").apply();
        WORKER.execute(() -> {
            InstalledVersion installed = null;
            CheckOutcome outcome = null;
            Exception failure = null;
            try {
                installed = getInstalledVersion(app);
                outcome = fetchLatestRelease(app, installed);
            } catch (Exception error) {
                failure = error;
            }
            final long finishedAt = System.currentTimeMillis();
            if (failure == null) {
                recordCheckSuccess(app, finishedAt, outcome);
            } else {
                recordCheckFailure(app, failure, finishedAt);
            }
            final List<CheckCallback> listeners;
            synchronized (CHECK_LOCK) {
                listeners = new ArrayList<>(checkListeners);
                checkListeners.clear();
                checkRunning = false;
            }
            deliverCheckResult(app, listeners, installed, outcome, failure);
        });
    }

    private static void deliverCheckResult(Context app, List<CheckCallback> listeners,
                                           InstalledVersion installed, CheckOutcome outcome,
                                           Exception failure) {
        if (failure != null) {
            Log.w(TAG, "Update check failed", failure);
            final UpdateFailure reason = failureReason(failure, UpdateFailure.RELEASE_LOOKUP_FAILED);
            final String message = friendlyMessage(failure, reason);
            for (CheckCallback listener : listeners) {
                MAIN.post(() -> listener.onError(reason, message));
            }
            if (listeners.isEmpty()) showStatusNotification(app, "YTArk update check failed", message, ACTION_CHECK);
            return;
        }
        if (outcome.release == null) {
            final String installedName = installed.versionName;
            final String message = outcome.installedAhead
                    ? "This build is newer than the latest published stable release ("
                    + outcome.latestVersion + "). Nothing was changed."
                    : "You’re using the latest published stable YTArk update.";
            for (CheckCallback listener : listeners) {
                MAIN.post(() -> listener.onUpToDate(installedName, message));
            }
            return;
        }
        final String installedName = installed.versionName;
        final ReleaseInfo release = outcome.release;
        saveSelectedRelease(app, release);
        for (CheckCallback listener : listeners) {
            MAIN.post(() -> listener.onUpdateAvailable(release, installedName));
        }
        if (listeners.isEmpty()) {
            if (automaticDownloadsEnabled(app)) {
                runAutomaticUpdate(app, null);
            } else {
                notifyIfNeeded(app, release);
            }
        }
    }

    private static void recordCheckSuccess(Context context, long at, CheckOutcome outcome) {
        String status = outcome.release != null
                ? "Stable YTArk " + outcome.release.displayVersion + " is available."
                : outcome.installedAhead
                ? "Installed build is newer than the latest published stable release (" + outcome.latestVersion + ")."
                : "Last check completed successfully; no newer stable release is available.";
        SharedPreferences.Editor editor = preferences(context).edit()
                .putLong("last_check_at", at)
                .putLong("last_success_at", at)
                .putLong("retry_after_at", 0L)
                .putLong("rate_limit_until", 0L)
                .putString("last_check_status", status)
                .putString("latest_version", outcome.latestVersion)
                .putString("updater_state", outcome.release == null ? STATE_UP_TO_DATE : STATE_AVAILABLE)
                .putLong("updater_state_at", at)
                .remove("updater_error")
                .remove("updater_error_phase")
                .remove("last_check_error")
                .remove("last_check_reason");
        if (outcome.release == null) {
            editor.remove("available_tag").remove("available_version");
            clearSelectedRelease(editor);
        } else {
            editor.putString("available_tag", outcome.release.tag)
                    .putString("available_version", outcome.release.displayVersion);
        }
        editor.apply();
    }

    private static void recordCheckFailure(Context context, Exception error, long at) {
        long retryAt = safeAdd(at, UpdateSchedulePolicy.RETRY_INTERVAL_MILLIS);
        long rateLimitUntil = 0L;
        if (error instanceof HttpStatusException) {
            HttpStatusException status = (HttpStatusException) error;
            if (status.rateLimited) rateLimitUntil = status.retryAtMillis;
        }
        retryAt = Math.max(retryAt, rateLimitUntil);
        UpdateFailure reason = failureReason(error, UpdateFailure.RELEASE_LOOKUP_FAILED);
        String status;
        if (reason == UpdateFailure.RATE_LIMITED) {
            status = "GitHub rate-limited the check; the retry time is shown below.";
        } else if (error instanceof UpdateCancelledException) {
            status = "The update check was cancelled.";
        } else {
            status = "The last check failed; your installed app is unchanged. Try again later.";
        }
        preferences(context).edit()
                .putLong("last_check_at", at)
                .putLong("last_failure_at", at)
                .putLong("retry_after_at", retryAt)
                .putLong("rate_limit_until", rateLimitUntil)
                .putString("last_check_status", status)
                .putString("last_check_reason", reason.name())
                .putString("last_check_error", friendlyMessage(error, reason))
                .putString("updater_state", STATE_FAILED)
                .putLong("updater_state_at", at)
                .putString("updater_error", friendlyMessage(error, reason))
                .putString("updater_error_phase", UpdaterFailurePhasePolicy.CHECK)
                .apply();
    }

    private static long safeAdd(long value, long delta) {
        return value > Long.MAX_VALUE - delta ? Long.MAX_VALUE : value + delta;
    }

    private static CheckOutcome fetchLatestRelease(Context context, InstalledVersion installed)
            throws Exception {
        JSONObject release = new JSONObject(httpGet(RELEASES_API, MAX_METADATA_BYTES));
        UpdateReleaseContract.requirePublishedStable(release.has("draft"), release.optBoolean("draft", false),
                release.has("prerelease"), release.optBoolean("prerelease", false));

        String tag = release.optString("tag_name", "").trim();
        if (!tag.matches("v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)")) {
            throw new IOException("The latest stable release has an invalid clean-SemVer tag.");
        }
        String version = tag.substring(1);
        long versionCode = UpdateReleaseContract.expectedVersionCodeForVersion(version);
        if (!tag.equals(UpdateReleaseContract.tagForVersion(version))) {
            throw new IOException("The release tag and version name do not match.");
        }
        if (!UpdateReleaseContract.releaseTitleForVersion(version).equals(release.optString("name", ""))) {
            throw new IOException("The latest stable release has an unexpected YTArk release title.");
        }
        String releaseBody = release.optString("body", "");
        if (UpdateReleaseContract.parseVersionCode(releaseBody) != versionCode) {
            throw new IOException("The release versionCode does not match its clean-SemVer version.");
        }
        try {
            UpdateVersion.compare(version, installed.versionName);
        } catch (IllegalArgumentException invalidVersion) {
            throw new IOException("The installed or published version is not valid.", invalidVersion);
        }
        if (versionCode <= installed.versionCode
                || UpdateVersion.compare(version, installed.versionName) <= 0) {
            return new CheckOutcome(null, version, installed.versionCode > versionCode);
        }

        String assetSuffix;
        try {
            assetSuffix = supportedAssetSuffix(context);
        } catch (IOException abiError) {
            throw new UpdateFailureException(UpdateFailure.ABI_UNAVAILABLE, abiError.getMessage(), abiError);
        }
        String nativeAbi = NativeAbiContract.nativeAbiForSuffix(assetSuffix);
        String expectedAssetName = UpdateReleaseContract.assetNameForVersion(version, assetSuffix);

        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) {
            throw new UpdateFailureException(UpdateFailure.APK_UNAVAILABLE,
                    "The newer release has no downloadable assets.");
        }
        JSONObject apkAsset = findAsset(assets, expectedAssetName);
        if (apkAsset == null) {
            throw new UpdateFailureException(UpdateFailure.APK_UNAVAILABLE,
                    "The newer release does not include the ARMv7 APK yet.");
        }
        String downloadUrl = UpdateReleaseContract.requireOfficialAssetUrl(
                apkAsset.optString("browser_download_url", ""), tag, expectedAssetName);
        long assetSize = apkAsset.optLong("size", -1L);
        if (assetSize <= 0 || assetSize > MAX_APK_BYTES) {
            throw new IOException("The published APK has an invalid file size.");
        }

        String publishedDigest = apkAsset.optString("digest", "").trim();
        String digest = UpdateReleaseContract.parseSha256Digest(publishedDigest);
        if (publishedDigest.length() > 0 && digest == null) {
            throw new IOException("GitHub published an invalid SHA-256 digest for the APK.");
        }
        if (digest == null) {
            JSONObject checksumsAsset = findAsset(assets, "SHA256SUMS.txt");
            if (checksumsAsset == null) {
                throw new IOException("The release is missing its SHA-256 checksum file.");
            }
            String checksumUrl = UpdateReleaseContract.requireOfficialAssetUrl(
                    checksumsAsset.optString("browser_download_url", ""), tag, "SHA256SUMS.txt");
            digest = UpdateReleaseContract.checksumForAsset(
                    httpGet(checksumUrl, 256 * 1024), expectedAssetName);
        }

        ReleaseInfo result = new ReleaseInfo(tag, version, YtarkBranding.displayVersion(version),
                expectedAssetName, downloadUrl, digest, nativeAbi, versionCode, assetSize,
                cleanReleaseNotes(releaseBody));
        validateReleaseContract(result);
        return new CheckOutcome(result, version, false);
    }

    private static String cleanReleaseNotes(String body) {
        if (body == null || body.trim().length() == 0) return "No release notes were provided.";
        StringBuilder notes = new StringBuilder();
        String[] lines = body.replace("\r", "").split("\n");
        for (String raw : lines) {
            String line = raw.trim();
            if (line.matches("[-| ]{3,}")) continue;
            line = line.replaceAll("^#{1,6}\\s*", "");
            line = line.replaceAll("\\[([^\\]]+)\\]\\((?:https?://)[^)]+\\)", "$1");
            line = line.replaceAll("`([^`]*)`", "$1");
            line = line.replaceAll("\\*\\*(.*?)\\*\\*", "$1");
            line = line.replaceAll("__(.*?)__", "$1");
            if (line.startsWith("- ")) line = "• " + line.substring(2);
            if (line.startsWith("* ")) line = "• " + line.substring(2);
            if (line.length() == 0 && (notes.length() == 0
                    || notes.charAt(notes.length() - 1) == '\n')) continue;
            notes.append(line).append('\n');
            if (notes.length() >= MAX_RELEASE_NOTES_CHARS) break;
        }
        while (notes.length() > 0 && notes.charAt(notes.length() - 1) == '\n') {
            notes.setLength(notes.length() - 1);
        }
        if (notes.length() > MAX_RELEASE_NOTES_CHARS) {
            notes.setLength(MAX_RELEASE_NOTES_CHARS);
            notes.append("…");
        }
        return notes.length() == 0 ? "No release notes were provided." : notes.toString();
    }

    private static JSONObject findAsset(JSONArray assets, String expectedName) {
        JSONObject found = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset != null && expectedName.equals(asset.optString("name", ""))) {
                if (found != null) return null;
                found = asset;
            }
        }
        return found;
    }

    private static void validateReleaseContract(ReleaseInfo release) throws IOException {
        if (release == null || release.versionName == null || release.displayVersion == null
                || release.tag == null || release.assetName == null || release.nativeAbi == null
                || release.sha256 == null || release.downloadUrl == null) {
            throw new IOException("The YTArk update metadata is incomplete.");
        }
        if (!UpdateReleaseContract.tagForVersion(release.versionName).equals(release.tag)
                || !YtarkBranding.displayVersion(release.versionName).equals(release.displayVersion)
                || release.versionCode != UpdateReleaseContract.expectedVersionCodeForVersion(release.versionName)) {
            throw new IOException("The YTArk release tag, version, and versionCode do not match.");
        }
        String suffix = NativeAbiContract.assetSuffixForNativeAbi(release.nativeAbi);
        String expectedName = UpdateReleaseContract.assetNameForVersion(release.versionName, suffix);
        if (!expectedName.equals(release.assetName)) {
            throw new IOException("The YTArk APK filename does not match the selected architecture.");
        }
        UpdateReleaseContract.requireOfficialAssetUrl(release.downloadUrl, release.tag, release.assetName);
        if (UpdateReleaseContract.parseSha256Digest(release.sha256) == null
                || release.assetSize <= 0 || release.assetSize > MAX_APK_BYTES) {
            throw new IOException("The YTArk APK checksum or published size is invalid.");
        }
    }

    private static String supportedAssetSuffix(Context context) throws IOException {
        String[] supportedAbis;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            supportedAbis = Build.SUPPORTED_ABIS;
        } else {
            supportedAbis = new String[] { Build.CPU_ABI, Build.CPU_ABI2 };
        }
        String installedAbi = installedNativeAbi(context);
        return NativeAbiContract.assetSuffixForInstalledAbi(installedAbi, supportedAbis);
    }

    /** Read the ABI of this installed YTArk APK instead of choosing a different
     * ABI merely because the device supports it. */
    private static String installedNativeAbi(Context context) throws IOException {
        String sourcePath = context.getApplicationInfo().sourceDir;
        if (sourcePath == null || sourcePath.length() == 0) {
            throw new IOException("Could not locate the installed YTArk APK to verify its ABI.");
        }
        java.util.HashSet<String> abis = new java.util.HashSet<>();
        try (ZipFile installedApk = new ZipFile(sourcePath)) {
            java.util.Enumeration<? extends ZipEntry> entries = installedApk.entries();
            while (entries.hasMoreElements()) {
                String name = entries.nextElement().getName();
                if (name.startsWith("lib/") && name.endsWith(".so")) {
                    String[] components = name.split("/");
                    if (components.length >= 3) abis.add(components[1]);
                }
            }
        }
        if (abis.size() != 1) {
            throw new IOException("Could not verify one installed YTArk ABI from the current APK. "
                    + "Automatic cross-ABI updates are disabled; use the matching versioned APK manually.");
        }
        return abis.iterator().next();
    }

    private static String httpGet(String address, int maximumBytes) throws IOException {
        boolean releaseApi = RELEASES_API.equals(address);
        HttpURLConnection connection = openTrustedConnection(address, "application/vnd.github+json",
                null, releaseApi, null);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw responseException(connection, status);
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                int total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > maximumBytes) throw new IOException("Release metadata is too large.");
                    output.write(buffer, 0, count);
                }
                return new String(output.toByteArray(), "UTF-8");
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Manually validates every redirect before issuing the next HTTPS request. */
    private static HttpURLConnection openTrustedConnection(String address, String accept,
                                                            String range, boolean releaseApi,
                                                            DownloadOperation operation)
            throws IOException {
        if (releaseApi ? !UpdateRedirectPolicy.isTrustedReleaseApiUrl(address)
                : !UpdateRedirectPolicy.isTrustedReleaseAssetUrl(address)) {
            throw new SecurityException("The YTArk update service returned an untrusted official URL.");
        }
        URL initial = new URL(address);
        URL current = initial;
        HttpURLConnection connection = null;
        try {
            for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
                if (operation != null) operation.throwIfCancelled();
                connection = (HttpURLConnection) current.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("User-Agent", "YTArk-Android-Updater");
                connection.setRequestProperty("Accept-Encoding", "identity");
                connection.setRequestProperty("Accept", accept);
                if (range != null) connection.setRequestProperty("Range", range);
                if (operation != null) operation.connection = connection;

                int status = connection.getResponseCode();
                if (operation != null) operation.throwIfCancelled();
                if (!UpdateRedirectPolicy.isRedirectStatus(status)) return connection;
                if (redirects >= MAX_REDIRECTS) {
                    throw new IOException("The official YTArk asset redirected too many times.");
                }
                String location = connection.getHeaderField("Location");
                if (location == null || location.trim().length() == 0) {
                    throw new IOException("The official YTArk server returned a redirect without a destination.");
                }
                URL target = new URL(current, location.trim());
                if (!UpdateRedirectPolicy.isAllowedRedirect(address, target.toExternalForm(), releaseApi)) {
                    throw new SecurityException(releaseApi
                            ? "The YTArk release API redirected to an untrusted address."
                            : "The YTArk APK download redirected to an untrusted host or path.");
                }
                connection.disconnect();
                if (operation != null) operation.connection = null;
                connection = null;
                current = target;
            }
            throw new IOException("The official YTArk server returned too many redirects.");
        } catch (IOException | RuntimeException failure) {
            if (connection != null) connection.disconnect();
            if (operation != null) operation.connection = null;
            throw failure;
        }
    }

    private static HttpStatusException responseException(HttpURLConnection connection, int status) {
        long now = System.currentTimeMillis();
        String retryAfter = connection.getHeaderField("Retry-After");
        String reset = connection.getHeaderField("X-RateLimit-Reset");
        String remaining = connection.getHeaderField("X-RateLimit-Remaining");
        boolean hasRetryWindow = (retryAfter != null && retryAfter.trim().length() > 0)
                || (reset != null && reset.trim().length() > 0);
        boolean rateLimited = status == 429 || (status == HttpURLConnection.HTTP_FORBIDDEN
                && ("0".equals(remaining) || hasRetryWindow));
        long retryAt = rateLimited
                ? UpdateSchedulePolicy.retryDeadlineMillis(retryAfter, reset, now) : 0L;
        return new HttpStatusException(status, retryAt, rateLimited);
    }

    private static InstalledVersion getInstalledVersion(Context context) throws Exception {
        PackageInfo info;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            info = context.getPackageManager().getPackageInfo(PACKAGE_NAME,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES));
        } else {
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            info = context.getPackageManager().getPackageInfo(PACKAGE_NAME, flags);
        }
        long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode() : info.versionCode;
        String version = info.versionName == null ? "0.0.0" : info.versionName;
        return new InstalledVersion(version, code);
    }

    private static void notifyIfNeeded(Context context, ReleaseInfo release) {
        if (!notificationsAllowed(context)) return;
        SharedPreferences preferences = preferences(context);
        long now = System.currentTimeMillis();
        String skippedTag = preferences.getString("skipped_tag", "");
        if (release.tag.equals(skippedTag)) return;
        String snoozedTag = preferences.getString("snoozed_tag", "");
        if (preferences.getLong("snooze_until", 0L) > now
                && (snoozedTag.length() == 0 || release.tag.equals(snoozedTag))) return;
        String priorTag = preferences.getString("last_notified_tag", "");
        long priorTime = preferences.getLong("last_notified_at", 0L);
        if (release.tag.equals(priorTag) && now - priorTime < SNOOZE_MILLIS) return;

        ensureNotificationChannel(context);
        Intent open = new Intent(context, UpdateActivity.class);
        open.setAction(ACTION_CHECK);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, 7201, open,
                immutablePendingFlags(PendingIntent.FLAG_UPDATE_CURRENT));

        Notification.Builder builder = notificationBuilder(context)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("YTArk update available")
                .setContentText("YTArk " + release.displayVersion + " is available to download.")
                .setStyle(new Notification.BigTextStyle().bigText(
                        "YTArk " + release.displayVersion
                                + " is available. Choose Update Now to review release notes and download it."))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_STATUS);

        builder.addAction(android.R.drawable.stat_sys_download, "Update Now",
                activityPendingIntent(context, ACTION_UPDATE, 7202));
        builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Later",
                laterPendingIntent(context, release.tag));
        builder.addAction(android.R.drawable.ic_menu_search, "Check for Updates",
                activityPendingIntent(context, ACTION_CHECK, 7203));

        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.notify(NOTIFICATION_UPDATE, builder.build());
        preferences.edit().putString("last_notified_tag", release.tag)
                .putLong("last_notified_at", now).apply();
    }

    private static PendingIntent activityPendingIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, UpdateActivity.class);
        intent.setAction(action);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent,
                immutablePendingFlags(PendingIntent.FLAG_UPDATE_CURRENT));
    }

    private static PendingIntent laterPendingIntent(Context context, String tag) {
        Intent intent = new Intent(context, UpdateActionReceiver.class);
        intent.setAction(ACTION_LATER);
        intent.putExtra("release_tag", tag);
        return PendingIntent.getBroadcast(context, 7204, intent,
                immutablePendingFlags(PendingIntent.FLAG_UPDATE_CURRENT));
    }

    private static int immutablePendingFlags(int flags) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private static Notification.Builder notificationBuilder(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(context, CHANNEL_ID);
        }
        return new Notification.Builder(context).setPriority(Notification.PRIORITY_DEFAULT);
    }

    private static NotificationManager notificationManager(Context context) {
        return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static boolean notificationsAllowed(Context context) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager manager = notificationManager(context);
        return manager == null || Build.VERSION.SDK_INT < 24 || manager.areNotificationsEnabled();
    }

    static void snooze(Context context, String tag) {
        long now = System.currentTimeMillis();
        preferences(context).edit().putLong("snooze_until", safeAdd(now, SNOOZE_MILLIS))
                .putString("snoozed_tag", tag == null ? "" : tag).apply();
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.cancel(NOTIFICATION_UPDATE);
    }

    static boolean isReleaseSkipped(Context context, String tag) {
        return tag != null && tag.equals(preferences(context).getString("skipped_tag", ""));
    }

    static boolean isAutomaticDownloadSuppressed(Context context, String tag) {
        return tag != null && tag.equals(preferences(context).getString("cancelled_download_tag", ""));
    }

    static void skipRelease(Context context, String tag) {
        if (tag == null || tag.length() == 0) return;
        preferences(context).edit().putString("skipped_tag", tag).apply();
        setUpdaterState(context, STATE_IDLE, "YTArk " + tag + " was skipped; automatic downloads will not select it.");
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.cancel(NOTIFICATION_UPDATE);
    }

    static void cancelDownload(Context context) {
        DownloadOperation operation = ACTIVE_DOWNLOAD.get();
        if (operation == null) return;
        operation.cancelled.set(true);
        HttpURLConnection connection = operation.connection;
        if (connection != null) connection.disconnect();
        if (operation.release != null) {
            preferences(context).edit().putString("cancelled_download_tag", operation.release.tag).apply();
        }
        setUpdaterState(context, STATE_CANCELLED, "Download cancelled. Matching partial bytes are retained; automatic download for this release is paused until you resume it or enable downloads again.");
    }

    static void cancelAutomaticDownload(Context context) {
        DownloadOperation operation = ACTIVE_DOWNLOAD.get();
        if (operation == null || !operation.automatic) return;
        operation.cancelled.set(true);
        HttpURLConnection connection = operation.connection;
        if (connection != null) connection.disconnect();
        setUpdaterState(context, STATE_CANCELLED, "Automatic download was turned off; matching partial bytes are retained.");
    }

    static boolean isDownloadInProgress() {
        return ACTIVE_DOWNLOAD.get() != null;
    }

    static ReleaseInfo activeDownloadRelease() {
        DownloadOperation operation = ACTIVE_DOWNLOAD.get();
        return operation == null ? null : operation.release;
    }

    private static String reserveDownload(Context app, ReleaseInfo release,
                                          DownloadOperation operation, boolean automatic) {
        if (automatic && !automaticDownloadsEnabled(app)) {
            return "Automatic downloads are turned off; no background transfer was started.";
        }
        if (handoffInFlight(app) || installRequested(app)) {
            return "An Android install request is active; finish or cancel it before starting another download.";
        }
        if (!ACTIVE_DOWNLOAD.compareAndSet(null, operation)) {
            return "A YTArk download is already running.";
        }
        if (!automatic && isAutomaticDownloadSuppressed(app, release.tag)) {
            preferences(app).edit().remove("cancelled_download_tag").apply();
        }
        saveSelectedRelease(app, release);
        return null;
    }

    static void downloadAndVerify(Context context, ReleaseInfo release, DownloadCallback callback) {
        downloadAndVerify(context, release, false, callback);
    }

    static void downloadAndVerify(Context context, ReleaseInfo release, boolean automatic,
                                  DownloadCallback callback) {
        final Context app = context.getApplicationContext();
        final DownloadOperation operation = new DownloadOperation(automatic, release);
        String unavailable;
        if (automatic) {
            // Serialize reservation with JobService cancellation: either the
            // cancellation flag wins, or it sees and cancels the active transfer.
            synchronized (AUTOMATIC_LOCK) {
                if (automaticCancellationRequested) {
                    unavailable = "The scheduled automatic update was cancelled by Android.";
                } else {
                    synchronized (UPDATE_FILES_LOCK) {
                        unavailable = reserveDownload(app, release, operation, automatic);
                    }
                }
            }
        } else {
            synchronized (UPDATE_FILES_LOCK) {
                unavailable = reserveDownload(app, release, operation, automatic);
            }
        }
        if (unavailable != null) {
            if (callback != null) {
                final String message = unavailable;
                MAIN.post(() -> callback.onError(UpdateFailure.DOWNLOAD_FAILED, message));
            }
            return;
        }
        setUpdaterState(app, STATE_DOWNLOADING, "");
        preferences(app).edit().putLong("downloaded_bytes", 0L)
                .putLong("download_total_bytes", release.assetSize).apply();
        WORKER.execute(() -> {
            String failurePhase = UpdaterFailurePhasePolicy.DOWNLOAD;
            try {
                File apk = downloadRelease(app, release, callback, operation);
                operation.throwIfCancelled();
                setUpdaterState(app, STATE_VALIDATING, "");
                failurePhase = UpdaterFailurePhasePolicy.VALIDATION;
                MAIN.post(() -> { if (callback != null) callback.onVerifying(); });
                verifyDownloadedApk(app, apk, release);
                operation.throwIfCancelled();
                failurePhase = UpdaterFailurePhasePolicy.INSTALL;
                savePendingUpdate(app, apk, release);
                try {
                    removeStaleUpdateFiles(updateDirectory(app, false), release.assetName);
                } catch (IOException | SecurityException cleanupError) {
                    Log.w(TAG, "Could not clean old update files after saving the verified APK", cleanupError);
                }
                MAIN.post(() -> {
                    cancelDownloadNotification(app);
                    if (callback != null) callback.onReady(apk);
                });
                showStatusNotification(app, "YTArk update verified",
                        "YTArk " + release.displayVersion
                                + " is ready. Open YTArk Updates to review it in Android's installer.",
                        ACTION_INSTALL);
            } catch (Exception error) {
                Exception reportedError = operation.cancelled.get()
                        ? new UpdateCancelledException() : error;
                Log.w(TAG, "Update download or verification failed", error);
                final UpdateFailure reason = failureReason(reportedError, UpdateFailure.DOWNLOAD_FAILED);
                final String message = friendlyMessage(reportedError, reason);
                if (reportedError instanceof UpdateCancelledException) {
                    setUpdaterState(app, STATE_CANCELLED, message);
                } else {
                    if (reason == UpdateFailure.VALIDATION_FAILED) {
                        failurePhase = UpdaterFailurePhasePolicy.VALIDATION;
                    }
                    setUpdaterFailure(app, message, failurePhase);
                }
                MAIN.post(() -> {
                    cancelDownloadNotification(app);
                    if (callback != null) callback.onError(reason, message);
                });
                if (!(reportedError instanceof UpdateCancelledException)) {
                    showStatusNotification(app, "YTArk update not ready", message, ACTION_UPDATE);
                }
            } finally {
                ACTIVE_DOWNLOAD.compareAndSet(operation, null);
            }
        });
    }

    static void verifyPendingUpdate(Context context, ReleaseInfo release, File apk,
                                    DownloadCallback callback) {
        final Context app = context.getApplicationContext();
        setUpdaterState(app, STATE_VALIDATING, "");
        WORKER.execute(() -> {
            try {
                MAIN.post(() -> { if (callback != null) callback.onVerifying(); });
                verifyDownloadedApk(app, apk, release);
                setUpdaterState(app, canRequestPackageInstalls(app)
                        ? STATE_READY_TO_INSTALL : STATE_PERMISSION_NEEDED, "");
                MAIN.post(() -> {
                    if (callback != null) callback.onReady(apk);
                });
            } catch (Exception error) {
                Log.w(TAG, "Saved update failed verification", error);
                setUpdaterFailure(app, friendlyMessage(error,
                        failureReason(error, UpdateFailure.VALIDATION_FAILED)),
                        UpdaterFailurePhasePolicy.VALIDATION);
                clearPendingUpdate(app);
                final UpdateFailure reason = failureReason(error, UpdateFailure.VALIDATION_FAILED);
                final String message = friendlyMessage(error, reason);
                MAIN.post(() -> {
                    if (callback != null) callback.onError(reason, message);
                });
            }
        });
    }

    private static File updateDirectory(Context context, boolean create) throws IOException {
        File files = context.getFilesDir();
        if (files == null) throw new IOException("YTArk private app storage is unavailable.");
        File directory = new File(files, "ytark_updates");
        if (create && !directory.exists() && !directory.mkdirs()) {
            throw new IOException("YTArk could not create secure update storage.");
        }
        if (directory.exists() && !directory.isDirectory()) {
            throw new IOException("YTArk update storage is not a directory.");
        }
        if (!UpdateGuards.isSafeUpdateDirectory(files, directory)) {
            throw new SecurityException("YTArk update storage resolves outside its private app directory.");
        }
        return directory;
    }

    private static File safeUpdateFile(File directory, String name) throws IOException {
        if (name == null || name.length() == 0) {
            throw new IOException("The YTArk update file name is empty.");
        }
        File file = new File(directory, name);
        if (!UpdateGuards.isSafeUpdateFile(directory, file)) {
            throw new SecurityException("A YTArk update file resolves outside its private update directory.");
        }
        return file;
    }

    private static File downloadRelease(Context context, ReleaseInfo release,
                                        DownloadCallback callback, DownloadOperation operation)
            throws Exception {
        validateReleaseContract(release);
        operation.throwIfCancelled();
        File directory = updateDirectory(context, true);
        // A different release may already be verified and awaiting installer
        // confirmation. Keep it intact until this candidate has passed every
        // check and atomically becomes the replacement pending APK.
        ReleaseInfo pending = pendingRelease(context);
        ReleaseInfo selected = selectedRelease(context);
        ReleaseInfo active = activeDownloadRelease();
        removeStaleUpdateFiles(directory, release.assetName,
                pending == null ? null : pending.assetName,
                selected == null ? null : selected.assetName,
                active == null ? null : active.assetName);
        File apk = safeUpdateFile(directory, release.assetName);
        File partial = safeUpdateFile(directory, release.assetName + ".part");
        File partialMetadata = safeUpdateFile(directory, release.assetName + ".part.properties");

        if (apk.isFile()) {
            try {
                verifyDownloadedApk(context, apk, release);
                deleteIfPresent(partial);
                deleteIfPresent(partialMetadata);
                return apk;
            } catch (Exception invalid) {
                try {
                    deleteIfPresent(apk);
                } catch (IOException | SecurityException cleanupError) {
                    invalid.addSuppressed(cleanupError);
                    throw cleanupError;
                }
                Log.w(TAG, "Removed an invalid cached update", invalid);
            }
        }

        if (partial.isFile() && !partialMetadataMatches(partialMetadata, release)) {
            // A same-name .part file is not enough to resume: tags can be
            // replaced or metadata can change. URL, digest, size, and ABI all
            // need to match the exact current selection.
            deleteIfPresent(partial);
            deleteIfPresent(partialMetadata);
        } else if (!partial.isFile()) {
            deleteIfPresent(partialMetadata);
        }

        long existing = partial.isFile() ? partial.length() : 0L;
        if (existing < 0 || existing >= release.assetSize) {
            deleteIfPresent(partial);
            deleteIfPresent(partialMetadata);
            existing = 0L;
        }
        long usable = directory.getUsableSpace();
        if (!UpdateGuards.hasEnoughFreeSpace(usable, release.assetSize, existing)) {
            long neededMiB = UpdateGuards.requiredFreeBytes(release.assetSize, existing) / (1024L * 1024L) + 1L;
            throw new UpdateFailureException(UpdateFailure.INSUFFICIENT_SPACE,
                    "YTArk needs about " + neededMiB + " MB free to download this update.");
        }
        if (!partial.isFile()) writePartialMetadata(partialMetadata, release);

        long startOffset = existing;
        long lastProgress = 0L;
        HttpURLConnection connection = openTrustedConnection(release.downloadUrl, UPDATE_MIME_TYPE,
                existing > 0 ? "bytes=" + existing + "-" : null, false, operation);
        try {
            operation.throwIfCancelled();
            int status = connection.getResponseCode();
            boolean append = UpdateResumeContract.shouldAppend(existing, status);
            if (append) {
                String contentRange = connection.getHeaderField("Content-Range");
                if (!UpdateResumeContract.validContentRange(contentRange, existing, release.assetSize)) {
                    deleteIfPresent(partial);
                    deleteIfPresent(partialMetadata);
                    throw new IOException("The server returned an invalid resume response; the partial download was discarded.");
                }
            } else if (status == HttpURLConnection.HTTP_OK) {
                startOffset = 0L;
                append = false;
            } else {
                HttpStatusException responseError = responseException(connection, status);
                if (existing > 0 && !responseError.rateLimited
                        && status < HttpURLConnection.HTTP_INTERNAL_ERROR) {
                    deleteIfPresent(partial);
                    deleteIfPresent(partialMetadata);
                }
                throw responseError;
            }

            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(partial, append)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                long downloaded = startOffset;
                while (true) {
                    operation.throwIfCancelled();
                    count = input.read(buffer);
                    if (count == -1) break;
                    operation.throwIfCancelled();
                    downloaded += count;
                    if (downloaded > release.assetSize || downloaded > MAX_APK_BYTES) {
                        deleteIfPresent(partial);
                        deleteIfPresent(partialMetadata);
                        throw new IOException("The downloaded APK is larger than its published size; the partial download was discarded.");
                    }
                    output.write(buffer, 0, count);
                    long now = System.currentTimeMillis();
                    if (now - lastProgress >= 750L) {
                        lastProgress = now;
                        reportProgress(context, release, downloaded, release.assetSize, callback);
                    }
                }
                output.getFD().sync();
                if (downloaded != release.assetSize) {
                    throw new IOException("The update download was interrupted and can be resumed.");
                }
            }
        } catch (IOException transferError) {
            if (isOutOfSpace(transferError)) {
                throw new UpdateFailureException(UpdateFailure.INSUFFICIENT_SPACE,
                        "The device ran out of storage during the download. Free some space and resume.",
                        transferError);
            }
            throw transferError;
        } finally {
            connection.disconnect();
            operation.connection = null;
        }

        operation.throwIfCancelled();
        String downloadedDigest = sha256(partial);
        if (!release.sha256.equalsIgnoreCase(downloadedDigest)) {
            deleteIfPresent(partial);
            deleteIfPresent(partialMetadata);
            throw new UpdateFailureException(UpdateFailure.VALIDATION_FAILED,
                    "The downloaded APK failed its SHA-256 integrity check and was discarded.");
        }
        deleteIfPresent(apk);
        if (!UpdateGuards.isSafeUpdateFile(directory, partial)
                || !UpdateGuards.isSafeUpdateFile(directory, apk)
                || !partial.renameTo(apk)) {
            throw new IOException("Could not safely finalize the verified APK download.");
        }
        deleteIfPresent(partialMetadata);
        return apk;
    }

    private static boolean isOutOfSpace(IOException error) {
        String message = error.getMessage();
        return message != null && (message.contains("ENOSPC") || message.contains("No space left"));
    }

    /** Delete only stale direct-child updater files; retained APKs and partial siblings are untouched. */
    private static void removeStaleUpdateFiles(File directory, String... keepAssetNames) {
        if (directory == null || !directory.isDirectory()) return;
        try {
            File canonicalDirectory = directory.getCanonicalFile();
            if (!canonicalDirectory.equals(directory.getAbsoluteFile())) return;
            File[] children = canonicalDirectory.listFiles();
            if (children == null) return;
            for (File child : children) {
                if (!UpdateGuards.isStaleUpdateFile(child.getName(), keepAssetNames)) continue;
                if (!UpdateGuards.isSafeUpdateFile(canonicalDirectory, child) || !child.isFile()) continue;
                if (!child.delete()) Log.w(TAG, "Could not remove stale update file");
            }
        } catch (IOException | SecurityException unsafeDirectory) {
            Log.w(TAG, "Could not safely inspect stale update files", unsafeDirectory);
        }
    }

    private static boolean partialMetadataMatches(File metadata, ReleaseInfo release) {
        if (!metadata.isFile()) return false;
        Properties properties = new Properties();
        try (InputStream input = new FileInputStream(metadata)) {
            properties.load(input);
            return UpdateResumeContract.metadataMatches(properties, release.assetName,
                    release.downloadUrl, release.sha256, release.assetSize, release.nativeAbi);
        } catch (IOException invalid) {
            return false;
        }
    }

    private static void writePartialMetadata(File metadata, ReleaseInfo release) throws IOException {
        Properties properties = new Properties();
        properties.setProperty("asset", release.assetName);
        properties.setProperty("url", release.downloadUrl);
        properties.setProperty("sha256", release.sha256);
        properties.setProperty("size", Long.toString(release.assetSize));
        properties.setProperty("abi", release.nativeAbi);
        File temporary = safeUpdateFile(metadata.getParentFile(), metadata.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            properties.store(output, "YTArk verified resume metadata");
            output.getFD().sync();
        }
        if (metadata.exists() && !metadata.delete()) {
            deleteIfPresent(temporary);
            throw new IOException("Could not replace update resume metadata.");
        }
        if (!temporary.renameTo(metadata)) {
            deleteIfPresent(temporary);
            throw new IOException("Could not save update resume metadata.");
        }
    }

    private static void deleteIfPresent(File file) throws IOException {
        if (file == null || file.getParentFile() == null
                || !UpdateGuards.isSafeUpdateFile(file.getParentFile(), file)) {
            throw new SecurityException("Refusing to delete an updater file outside its direct private directory.");
        }
        if (file.exists() && !file.delete()) {
            throw new IOException("Could not discard stale YTArk update data.");
        }
    }

    private static void reportProgress(Context context, ReleaseInfo release, long downloaded,
                                       long total, DownloadCallback callback) {
        preferences(context).edit().putLong("downloaded_bytes", downloaded)
                .putLong("download_total_bytes", total).apply();
        MAIN.post(() -> {
            if (callback != null) callback.onProgress(downloaded, total);
        });
        if (!notificationsAllowed(context)) return;
        ensureNotificationChannel(context);
        int percent = total > 0 ? (int) Math.min(100L, downloaded * 100L / total) : 0;
        Notification.Builder builder = notificationBuilder(context)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Downloading YTArk update")
                .setContentText(release.displayVersion + " · " + percent + "%")
                .setProgress(100, percent, false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.notify(NOTIFICATION_DOWNLOAD, builder.build());
    }

    private static void verifyDownloadedApk(Context context, File apk, ReleaseInfo release)
            throws Exception {
        validateReleaseContract(release);
        String deviceAbi = NativeAbiContract.nativeAbiForSuffix(supportedAssetSuffix(context));
        if (!deviceAbi.equals(release.nativeAbi)) {
            throw new SecurityException("The saved update is for a different Android ABI; select a matching YTArk APK.");
        }
        if (apk == null || !apk.isFile() || apk.length() != release.assetSize) {
            throw new IOException("The downloaded APK is incomplete. Select Update Now to resume it.");
        }
        String digest = sha256(apk);
        if (!release.sha256.equalsIgnoreCase(digest)) {
            throw new SecurityException("The APK checksum did not match the official release.");
        }

        PackageManager packageManager = context.getPackageManager();
        PackageInfo candidate;
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            candidate = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(),
                    PackageManager.PackageInfoFlags.of(flags));
        } else {
            candidate = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        }
        if (candidate == null) throw new SecurityException("Android could not read the downloaded APK.");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && candidate.applicationInfo != null
                && !UpdateGuards.deviceMeetsMinSdk(candidate.applicationInfo.minSdkVersion,
                        Build.VERSION.SDK_INT)) {
            throw new SecurityException("This YTArk update needs a newer Android version than this TV provides.");
        }
        if (!PACKAGE_NAME.equals(candidate.packageName)) {
            throw new SecurityException("The APK is not a YTArk update for this application.");
        }
        if (candidate.versionName == null || !release.versionName.equals(candidate.versionName)) {
            throw new SecurityException("The APK version does not match the published release.");
        }
        long candidateCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? candidate.getLongVersionCode() : candidate.versionCode;
        if (candidateCode != release.versionCode) {
            throw new SecurityException("The APK versionCode does not match the release metadata.");
        }
        if (!UpdaterBuildConfig.SIGNING_CERT_SHA256.equalsIgnoreCase(
                signerFingerprint(candidate))) {
            throw new SecurityException("The APK was not signed with YTArk's trusted release certificate.");
        }

        InstalledVersion installed = getInstalledVersion(context);
        if (candidateCode <= installed.versionCode
                || UpdateVersion.compare(candidate.versionName, installed.versionName) <= 0) {
            throw new SecurityException("The downloaded APK is not newer than the installed version.");
        }
        PackageInfo installedInfo = packageInfoForInstalledApp(context);
        if (!UpdaterBuildConfig.SIGNING_CERT_SHA256.equalsIgnoreCase(
                signerFingerprint(installedInfo))) {
            throw new SecurityException("This installation does not use YTArk's permanent signing certificate.");
        }
        verifyNativeArchitecture(apk, release.nativeAbi);
    }

    private static PackageInfo packageInfoForInstalledApp(Context context) throws Exception {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return context.getPackageManager().getPackageInfo(PACKAGE_NAME,
                    PackageManager.PackageInfoFlags.of(flags));
        }
        return context.getPackageManager().getPackageInfo(PACKAGE_NAME, flags);
    }

    private static String signerFingerprint(PackageInfo packageInfo) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && packageInfo.signingInfo != null) {
            signatures = packageInfo.signingInfo.getApkContentsSigners();
        } else {
            signatures = packageInfo.signatures;
        }
        if (signatures == null || signatures.length != 1) {
            throw new SecurityException("The APK does not have exactly one trusted signer.");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(signatures[0].toByteArray());
        StringBuilder result = new StringBuilder(hash.length * 2);
        for (byte value : hash) result.append(String.format(Locale.US, "%02x", value & 0xff));
        return result.toString();
    }

    private static void verifyNativeArchitecture(File apk, String nativeAbi) throws IOException {
        String suffix = NativeAbiContract.assetSuffixForNativeAbi(nativeAbi);
        String requiredLibrary = "lib/" + nativeAbi + "/libchrobalt.so";
        try (ZipFile zip = new ZipFile(apk)) {
            ZipEntry library = zip.getEntry(requiredLibrary);
            if (library == null || library.getSize() <= 0) {
                throw new SecurityException("The downloaded APK is not built for this device architecture.");
            }
            java.util.Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName();
                if (!name.startsWith("lib/") || !name.endsWith(".so")) continue;
                String[] components = name.split("/");
                if (components.length < 3 || !nativeAbi.equals(components[1])) {
                    throw new SecurityException("The downloaded " + suffix
                            + " APK contains a native library for the wrong ABI: " + name);
                }
            }
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder result = new StringBuilder(64);
        for (byte value : digest.digest()) result.append(String.format(Locale.US, "%02x", value & 0xff));
        return result.toString();
    }

    private static void savePendingUpdate(Context context, File apk, ReleaseInfo release)
            throws IOException {
        if (!isOwnedUpdateFile(context, apk) || !apk.isFile()) {
            throw new SecurityException("The verified update APK is no longer in YTArk private update storage.");
        }
        saveSelectedRelease(context, release);
        preferences(context).edit()
                .putString("pending_path", apk.getAbsolutePath())
                .putString("pending_tag", release.tag)
                .putString("pending_version", release.versionName)
                .putString("pending_display_version", release.displayVersion)
                .putString("pending_notes", release.notes)
                .putString("pending_asset", release.assetName)
                .putString("pending_url", release.downloadUrl)
                .putString("pending_sha256", release.sha256)
                .putString("pending_abi", release.nativeAbi)
                .putLong("pending_version_code", release.versionCode)
                .putLong("pending_size", release.assetSize)
                .putString("updater_state", canRequestPackageInstalls(context)
                        ? STATE_READY_TO_INSTALL : STATE_PERMISSION_NEEDED)
                .putLong("updater_state_at", System.currentTimeMillis())
                .remove("updater_error")
                .apply();
    }

    private static void saveSelectedRelease(Context context, ReleaseInfo release) {
        if (release == null) return;
        preferences(context).edit()
                .putString("selected_tag", release.tag)
                .putString("selected_version", release.versionName)
                .putString("selected_display_version", release.displayVersion)
                .putString("selected_notes", release.notes)
                .putString("selected_asset", release.assetName)
                .putString("selected_url", release.downloadUrl)
                .putString("selected_sha256", release.sha256)
                .putString("selected_abi", release.nativeAbi)
                .putLong("selected_version_code", release.versionCode)
                .putLong("selected_size", release.assetSize)
                .apply();
    }

    private static void clearSelectedRelease(SharedPreferences.Editor editor) {
        editor.remove("selected_tag").remove("selected_version").remove("selected_display_version")
                .remove("selected_notes").remove("selected_asset").remove("selected_url")
                .remove("selected_sha256").remove("selected_abi")
                .remove("selected_version_code").remove("selected_size");
    }

    static ReleaseInfo selectedRelease(Context context) {
        SharedPreferences p = preferences(context);
        String tag = p.getString("selected_tag", "");
        String version = p.getString("selected_version", "");
        String display = p.getString("selected_display_version", "");
        String notes = p.getString("selected_notes", "");
        String asset = p.getString("selected_asset", "");
        String url = p.getString("selected_url", "");
        String digest = p.getString("selected_sha256", "");
        String abi = p.getString("selected_abi", "");
        long code = p.getLong("selected_version_code", -1L);
        long size = p.getLong("selected_size", -1L);
        if (tag.length() == 0 || version.length() == 0 || asset.length() == 0
                || url.length() == 0 || digest.length() != 64 || abi.length() == 0
                || code <= 0 || size <= 0) return null;
        ReleaseInfo release = new ReleaseInfo(tag, version, display, asset, url, digest, abi, code, size, notes);
        try {
            validateReleaseContract(release);
            if (!isOwnedUpdateFile(context, new File(new File(context.getFilesDir(), "ytark_updates"), asset))) {
                return null;
            }
            return release;
        } catch (IOException invalid) {
            Log.w(TAG, "Discarding invalid saved release selection", invalid);
            return null;
        }
    }

    static File pendingApk(Context context) {
        String path = preferences(context).getString("pending_path", "");
        if (path.length() == 0) return null;
        File apk = new File(path);
        return isOwnedUpdateFile(context, apk) ? apk : null;
    }

    private static boolean isOwnedUpdateFile(Context context, File file) {
        if (context == null || file == null) return false;
        try {
            File updates = updateDirectory(context, false);
            return UpdateGuards.isSafeUpdateFile(updates, file)
                    && file.getName().matches("YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-armv7\\.apk");
        } catch (IOException | SecurityException invalid) {
            return false;
        }
    }

    static ReleaseInfo pendingRelease(Context context) {
        SharedPreferences p = preferences(context);
        String tag = p.getString("pending_tag", "");
        String version = p.getString("pending_version", "");
        String displayVersion = p.getString("pending_display_version",
                YtarkBranding.displayVersion(version));
        String notes = p.getString("pending_notes", "");
        String asset = p.getString("pending_asset", "");
        String url = p.getString("pending_url", "");
        String sha = p.getString("pending_sha256", "");
        String abi = p.getString("pending_abi", "");
        long code = p.getLong("pending_version_code", -1L);
        long size = p.getLong("pending_size", -1L);
        if (tag.length() == 0 || version.length() == 0 || asset.length() == 0
                || url.length() == 0 || sha.length() != 64 || abi.length() == 0
                || code <= 0 || size <= 0) return null;
        ReleaseInfo release = new ReleaseInfo(tag, version, displayVersion, asset, url, sha,
                abi, code, size, notes);
        try {
            validateReleaseContract(release);
            String normalizedSha = UpdateReleaseContract.parseSha256Digest(sha);
            if (normalizedSha == null || !normalizedSha.equalsIgnoreCase(sha)) return null;
            return release;
        } catch (IOException invalid) {
            Log.w(TAG, "Discarding stale pending update metadata", invalid);
            return null;
        }
    }

    static void clearPendingUpdate(Context context) {
        synchronized (UPDATE_FILES_LOCK) {
            File apk = pendingApk(context);
            if (apk != null) {
                try {
                    deleteIfPresent(apk);
                    deleteIfPresent(safeUpdateFile(apk.getParentFile(), apk.getName() + ".part"));
                    deleteIfPresent(safeUpdateFile(apk.getParentFile(), apk.getName() + ".part.properties"));
                } catch (IOException | SecurityException unsafeFile) {
                    Log.w(TAG, "Could not safely remove the verified update files", unsafeFile);
                }
            }
            preferences(context).edit().remove("install_requested").remove("handoff_in_flight")
                    .remove("install_target_version_code")
                    .remove("pending_path").remove("pending_tag")
                    .remove("pending_version").remove("pending_display_version").remove("pending_notes")
                    .remove("pending_asset").remove("pending_url").remove("pending_sha256").remove("pending_abi")
                    .remove("pending_version_code").remove("pending_size").apply();
        }
    }

    static boolean clearPendingIfInstalled(Context context) {
        ReleaseInfo pending = pendingRelease(context);
        if (pending == null) return false;
        InstalledVersion installed = getInstalledVersionSafe(context);
        if (installed.versionCode < pending.versionCode) return false;
        preferences(context).edit()
                .putLong("completed_update_version_code", pending.versionCode)
                .apply();
        clearPendingUpdate(context);
        NotificationManager manager = notificationManager(context);
        if (manager != null) {
            manager.cancel(NOTIFICATION_UPDATE);
            manager.cancel(NOTIFICATION_DOWNLOAD);
            manager.cancel(NOTIFICATION_STATUS);
        }
        SharedPreferences.Editor completed = preferences(context).edit()
                .putString("installer_return_status", "YTArk " + pending.displayVersion + " is installed.")
                .putString("updater_state", STATE_UP_TO_DATE)
                .putLong("updater_state_at", System.currentTimeMillis())
                .remove("updater_error")
                .remove("updater_error_phase");
        clearSelectedRelease(completed);
        completed.apply();
        return true;
    }

    static String lastCheckError(Context context) {
        return preferences(context).getString("last_check_error", "");
    }

    static boolean canRequestPackageInstalls(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || context.getPackageManager().canRequestPackageInstalls();
    }

    /** Re-verify the signed APK and hand a private content URI to Android's package installer. */
    static void prepareInstallerIntent(Context context, ReleaseInfo release, File apk,
                                       InstallCallback callback) {
        final Context app = context.getApplicationContext();
        WORKER.execute(() -> {
            try {
                ReleaseInfo pending = pendingRelease(app);
                File savedApk = pendingApk(app);
                if (pending == null || savedApk == null || !sameRelease(pending, release)
                        || !sameFile(savedApk, apk)) {
                    throw new SecurityException("The verified YTArk update is no longer available.");
                }
                verifyDownloadedApk(app, savedApk, pending);
                Uri uri = new Uri.Builder()
                        .scheme(ContentResolver.SCHEME_CONTENT)
                        .authority(PACKAGE_NAME + UPDATE_CONTENT_AUTHORITY_SUFFIX)
                        .appendPath(UPDATE_CONTENT_PATH)
                        .build();
                Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE);
                install.setDataAndType(uri, UPDATE_MIME_TYPE);
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                install.setClipData(android.content.ClipData.newRawUri("YTArk update", uri));
                install.putExtra(Intent.EXTRA_RETURN_RESULT, true);
                MAIN.post(() -> {
                    if (callback != null) callback.onReady(install);
                });
            } catch (Exception error) {
                Log.w(TAG, "Could not prepare Android package installer handoff", error);
                final UpdateFailure reason = failureReason(error, UpdateFailure.INSTALLER_UNAVAILABLE);
                final String message = friendlyMessage(error, reason);
                MAIN.post(() -> {
                    if (callback != null) callback.onError(reason, message);
                });
            }
        });
    }

    private static boolean sameRelease(ReleaseInfo left, ReleaseInfo right) {
        return left != null && right != null
                && left.tag.equals(right.tag)
                && left.versionName.equals(right.versionName)
                && left.assetName.equals(right.assetName)
                && left.sha256.equalsIgnoreCase(right.sha256)
                && left.versionCode == right.versionCode
                && left.assetSize == right.assetSize;
    }

    private static boolean sameFile(File left, File right) {
        if (left == null || right == null) return false;
        try {
            return left.getCanonicalFile().equals(right.getCanonicalFile());
        } catch (IOException invalid) {
            return false;
        }
    }

    /** The user asked to install; survives Settings and process restarts until a hand-off or cancel. */
    static boolean installRequested(Context context) {
        return preferences(context).getBoolean("install_requested", false);
    }

    static void setInstallRequested(Context context, boolean requested) {
        synchronized (UPDATE_FILES_LOCK) {
            preferences(context).edit().putBoolean("install_requested", requested).apply();
        }
    }

    static void setInstallerTargetVersionCode(Context context, long versionCode) {
        synchronized (UPDATE_FILES_LOCK) {
            SharedPreferences.Editor editor = preferences(context).edit();
            if (versionCode > 0L) {
                editor.putLong("install_target_version_code", versionCode)
                        .remove("completed_update_version_code");
            } else {
                editor.remove("install_target_version_code");
            }
            editor.apply();
        }
    }

    static long installerTargetVersionCode(Context context) {
        return preferences(context).getLong("install_target_version_code", 0L);
    }

    static long completedUpdateVersionCode(Context context) {
        return preferences(context).getLong("completed_update_version_code", 0L);
    }

    static void clearInstallerTargetVersionCode(Context context) {
        preferences(context).edit().remove("install_target_version_code").apply();
    }

    static boolean isInstalledVersionAtLeast(Context context, long versionCode) {
        return InstallerResultPolicy.installedVersionConfirms(
                getInstalledVersionSafe(context).versionCode, versionCode);
    }

    /** True from the moment the installer is opened until Android returns control. */
    static boolean handoffInFlight(Context context) {
        return preferences(context).getBoolean("handoff_in_flight", false);
    }

    static void setHandoffInFlight(Context context, boolean inFlight) {
        synchronized (UPDATE_FILES_LOCK) {
            preferences(context).edit().putBoolean("handoff_in_flight", inFlight).apply();
        }
    }

    /** A verified APK for a newer release is saved and still present on disk. */
    static boolean hasVerifiedPending(Context context) {
        File apk = pendingApk(context);
        return apk != null && apk.isFile() && pendingRelease(context) != null;
    }

    /** When a check last completed successfully (0 if never); used for cached-result labels. */
    static long lastSuccessAt(Context context) {
        return preferences(context).getLong("last_success_at", 0L);
    }


    static InstallGate.Step installStep(Context context) {
        return InstallGate.next(hasVerifiedPending(context), installRequested(context),
                canRequestPackageInstalls(context), handoffInFlight(context));
    }

    static final class UpdateFileCleanup {
        final long bytesRemoved;
        final int filesRemoved;
        final boolean protectedByActiveWork;
        final boolean incomplete;

        UpdateFileCleanup(long bytesRemoved, int filesRemoved, boolean protectedByActiveWork,
                          boolean incomplete) {
            this.bytesRemoved = bytesRemoved;
            this.filesRemoved = filesRemoved;
            this.protectedByActiveWork = protectedByActiveWork;
            this.incomplete = incomplete;
        }
    }

    /** Deletes only obsolete, top-level YTArk APK/partial files in the updater-owned directory. */
    static UpdateFileCleanup clearObsoleteUpdateDownloads(Context context) {
        Context app = context.getApplicationContext();
        synchronized (UPDATE_FILES_LOCK) {
            if (ACTIVE_DOWNLOAD.get() != null || handoffInFlight(app) || installRequested(app)) {
                return new UpdateFileCleanup(0L, 0, true, false);
            }
            try {
                File directory = updateDirectory(app, false);
                if (!directory.exists()) return new UpdateFileCleanup(0L, 0, false, false);
                if (!directory.isDirectory()) return new UpdateFileCleanup(0L, 0, false, true);
                File canonicalDirectory = directory.getCanonicalFile();
                if (!canonicalDirectory.equals(directory.getAbsoluteFile())) {
                    return new UpdateFileCleanup(0L, 0, false, true);
                }
                ReleaseInfo pending = pendingRelease(app);
                ReleaseInfo selected = selectedRelease(app);
                ReleaseInfo active = activeDownloadRelease();
                String keep = pending == null ? "" : pending.assetName;
                String keepSelected = selected == null ? "" : selected.assetName;
                String keepActive = active == null ? "" : active.assetName;
                File[] files = canonicalDirectory.listFiles();
                if (files == null) return new UpdateFileCleanup(0L, 0, false, true);
                long bytes = 0L;
                int count = 0;
                boolean incomplete = false;
                for (File file : files) {
                    try {
                        File canonical = file.getCanonicalFile();
                        if (!canonical.equals(file.getAbsoluteFile())
                                || !canonicalDirectory.equals(canonical.getParentFile()) || !canonical.isFile()
                                || !UpdateGuards.isStaleUpdateFile(canonical.getName(), keep,
                                keepSelected, keepActive)) continue;
                        long size = canonical.length();
                        if (canonical.delete()) {
                            bytes += size;
                            count++;
                        } else {
                            incomplete = true;
                        }
                    } catch (IOException | SecurityException inaccessible) {
                        incomplete = true;
                    }
                }
                return new UpdateFileCleanup(bytes, count, false, incomplete);
            } catch (IOException | SecurityException error) {
                Log.w(TAG, "Could not safely inspect obsolete updater downloads", error);
                return new UpdateFileCleanup(0L, 0, false, true);
            }
        }
    }

    /**
     * Startup housekeeping, run off the main thread: finish a pending install that
     * already happened, and remove partials and old APKs that no install still needs.
     */
    static void reconcileOnStart(Context context) {
        final Context app = context.getApplicationContext();
        WORKER.execute(() -> {
            try {
                clearPendingIfInstalled(app);
                String priorState = updaterState(app);
                if (STATE_CHECKING.equals(priorState)) {
                    setUpdaterFailure(app,
                            "The previous release check was interrupted by an app restart. The last successful result is unchanged; check again when eligible.",
                            UpdaterFailurePhasePolicy.CHECK);
                } else if (STATE_DOWNLOADING.equals(priorState)) {
                    setUpdaterState(app, STATE_CANCELLED,
                            "The previous download was interrupted by an app restart. Matching partial bytes are preserved for resume.");
                } else if (STATE_VALIDATING.equals(priorState)) {
                    setUpdaterFailure(app,
                            "The previous APK validation was interrupted by an app restart. The saved release can be verified again.",
                            hasVerifiedPending(app) ? UpdaterFailurePhasePolicy.VALIDATION
                                    : UpdaterFailurePhasePolicy.DOWNLOAD);
                }
                synchronized (UPDATE_FILES_LOCK) {
                    if (ACTIVE_DOWNLOAD.get() != null || handoffInFlight(app) || installRequested(app)) return;
                    File directory = updateDirectory(app, false);
                    ReleaseInfo pending = pendingRelease(app);
                    ReleaseInfo selected = selectedRelease(app);
                    ReleaseInfo active = activeDownloadRelease();
                    removeStaleUpdateFiles(directory,
                            pending == null ? null : pending.assetName,
                            selected == null ? null : selected.assetName,
                            active == null ? null : active.assetName);
                }
            } catch (Exception error) {
                Log.w(TAG, "Update housekeeping failed", error);
            }
        });
    }

    static void recordInstallerResult(Context context, int resultCode) {
        setHandoffInFlight(context, false);
        if (resultCode == android.app.Activity.RESULT_OK) {
            preferences(context).edit().putLong("installer_returned_at", System.currentTimeMillis())
                    .putString("installer_return_status", "Android returned success; verifying installed version.")
                    .apply();
        } else {
            preferences(context).edit().putLong("installer_returned_at", System.currentTimeMillis())
                    .putString("installer_return_status", "Installer closed; the current YTArk app and data were not changed.")
                    .apply();
        }
    }

    static void showStatusNotification(Context context, String title, String text, String action) {
        if (!notificationsAllowed(context)) return;
        ensureNotificationChannel(context);
        Notification.Builder builder = notificationBuilder(context)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (action != null) {
            builder.setContentIntent(activityPendingIntent(context, action, NOTIFICATION_STATUS));
        }
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.notify(NOTIFICATION_STATUS, builder.build());
    }

    static void cancelDownloadNotification(Context context) {
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.cancel(NOTIFICATION_DOWNLOAD);
    }

    private static InstalledVersion getInstalledVersionSafe(Context context) {
        try {
            return getInstalledVersion(context);
        } catch (Exception error) {
            Log.w(TAG, "Could not read installed version", error);
            return new InstalledVersion("unknown", 0L);
        }
    }

    static String installedVersionName(Context context) {
        return getInstalledVersionSafe(context).versionName;
    }

    static void markNotificationPermissionPrompted(Context context) {
        preferences(context).edit().putBoolean("notification_permission_prompted", true).apply();
    }

    static boolean notificationPermissionPrompted(Context context) {
        return preferences(context).getBoolean("notification_permission_prompted", false);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** Maps any failure to the single reason the screen will name. */
    static UpdateFailure failureReason(Exception error, UpdateFailure fallback) {
        if (error instanceof UpdateFailureException) return ((UpdateFailureException) error).reason;
        if (error instanceof UpdateCancelledException) return UpdateFailure.DOWNLOAD_FAILED;
        if (error instanceof HttpStatusException && ((HttpStatusException) error).rateLimited) {
            return UpdateFailure.RATE_LIMITED;
        }
        if (error instanceof java.net.UnknownHostException || error instanceof java.net.ConnectException
                || error instanceof java.net.SocketTimeoutException) {
            return UpdateFailure.OFFLINE;
        }
        if (error instanceof SecurityException) return UpdateFailure.VALIDATION_FAILED;
        return fallback;
    }

    /** Text for the screen: the specific detail when the failure carries one, else the reason. */
    static String friendlyMessage(Exception error, UpdateFailure reason) {
        if (error instanceof UpdateCancelledException) {
            return "Download paused. The partial download is kept and will resume only for this exact release.";
        }
        if (error instanceof UpdateFailureException || error instanceof SecurityException) {
            String detail = error.getMessage();
            if (detail != null && detail.length() > 0) return detail;
        }
        return reason.message();
    }

    private static final class InstalledVersion {
        final String versionName;
        final long versionCode;

        InstalledVersion(String versionName, long versionCode) {
            this.versionName = versionName;
            this.versionCode = versionCode;
        }
    }
}
