package io.github.twoarchiver.ytark.updater;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
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
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
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
    private static final long SNOOZE_MILLIS = 24L * 60L * 60L * 1000L;
    private static final int MAX_METADATA_BYTES = 1024 * 1024;
    private static final int MAX_RELEASE_NOTES_CHARS = 8000;
    private static final long MAX_APK_BYTES = 512L * 1024L * 1024L;
    private static final Set<String> RELEASE_DOWNLOAD_HOSTS = releaseDownloadHosts();

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
    private static final AtomicBoolean CHECK_IN_PROGRESS = new AtomicBoolean(false);
    private static final AtomicReference<DownloadOperation> ACTIVE_DOWNLOAD = new AtomicReference<>();

    interface CheckCallback {
        void onUpdateAvailable(ReleaseInfo release, String installedVersion);
        void onUpToDate(String installedVersion, String message);
        void onError(String message);
    }

    interface DownloadCallback {
        void onProgress(long downloaded, long total);
        void onVerifying();
        void onReady(File apk);
        void onError(String message);
    }

    interface InstallCallback {
        void onReady(Intent intent);
        void onError(String message);
    }

    private static final class DownloadOperation {
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile HttpURLConnection connection;

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

    private static Set<String> releaseDownloadHosts() {
        Set<String> hosts = new HashSet<>();
        hosts.add("github.com");
        hosts.add("release-assets.githubusercontent.com");
        hosts.add("objects.githubusercontent.com");
        hosts.add("github-releases.githubusercontent.com");
        return hosts;
    }

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

    static boolean isAutomaticCheckDue(Context context) {
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

    static long lastCheckAt(Context context) {
        return preferences(context).getLong("last_check_at", 0L);
    }

    static String lastCheckStatus(Context context) {
        return preferences(context).getString("last_check_status", "");
    }

    static void checkForUpdates(Context context, boolean manual, CheckCallback callback) {
        final Context app = context.getApplicationContext();
        if (!manual && !isAutomaticCheckDue(app)) return;
        if (!CHECK_IN_PROGRESS.compareAndSet(false, true)) {
            if (manual && callback != null) {
                MAIN.post(() -> callback.onError("An update check is already running."));
            }
            return;
        }

        final long attemptAt = System.currentTimeMillis();
        preferences(app).edit().putLong("last_attempt_at", attemptAt)
                .putString("last_check_status", "Checking for stable updates…").apply();
        WORKER.execute(() -> {
            try {
                InstalledVersion installed = getInstalledVersion(app);
                ReleaseInfo release = fetchLatestRelease(app, installed);
                recordCheckSuccess(app, System.currentTimeMillis());
                if (release == null) {
                    if (manual && callback != null) {
                        MAIN.post(() -> callback.onUpToDate(installed.versionName,
                                "You’re using the latest published stable YTArk update."));
                    }
                    return;
                }

                if (manual) {
                    if (callback != null) {
                        MAIN.post(() -> callback.onUpdateAvailable(release, installed.versionName));
                    }
                } else {
                    notifyIfNeeded(app, release);
                }
            } catch (Exception error) {
                Log.w(TAG, "Update check failed", error);
                recordCheckFailure(app, error, System.currentTimeMillis());
                if (manual && callback != null) {
                    final String message = friendlyNetworkError(error);
                    MAIN.post(() -> callback.onError(message));
                }
            } finally {
                CHECK_IN_PROGRESS.set(false);
            }
        });
    }

    private static void recordCheckSuccess(Context context, long at) {
        preferences(context).edit()
                .putLong("last_check_at", at)
                .putLong("last_success_at", at)
                .putLong("retry_after_at", 0L)
                .putLong("rate_limit_until", 0L)
                .putString("last_check_status", "Last check completed successfully.")
                .remove("last_check_error")
                .apply();
    }

    private static void recordCheckFailure(Context context, Exception error, long at) {
        long retryAt = safeAdd(at, UpdateSchedulePolicy.RETRY_INTERVAL_MILLIS);
        long rateLimitUntil = 0L;
        if (error instanceof HttpStatusException) {
            HttpStatusException status = (HttpStatusException) error;
            if (status.rateLimited) rateLimitUntil = status.retryAtMillis;
        }
        retryAt = Math.max(retryAt, rateLimitUntil);
        String status;
        if (error instanceof HttpStatusException && ((HttpStatusException) error).rateLimited) {
            status = "GitHub rate-limited the check; the retry time is shown below.";
        } else if (error instanceof UpdateCancelledException) {
            status = "The update check was cancelled.";
        } else {
            status = "The last check failed; try again after the retry window.";
        }
        preferences(context).edit()
                .putLong("last_check_at", at)
                .putLong("last_failure_at", at)
                .putLong("retry_after_at", retryAt)
                .putLong("rate_limit_until", rateLimitUntil)
                .putString("last_check_status", status)
                .putString("last_check_error", friendlyNetworkError(error))
                .apply();
    }

    private static long safeAdd(long value, long delta) {
        return value > Long.MAX_VALUE - delta ? Long.MAX_VALUE : value + delta;
    }

    private static ReleaseInfo fetchLatestRelease(Context context, InstalledVersion installed)
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
            return null;
        }

        String assetSuffix = supportedAssetSuffix(context);
        String nativeAbi = NativeAbiContract.nativeAbiForSuffix(assetSuffix);
        String expectedAssetName = UpdateReleaseContract.assetNameForVersion(version, assetSuffix);

        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) throw new IOException("The latest release has no downloadable assets.");
        JSONObject apkAsset = findAsset(assets, expectedAssetName);
        if (apkAsset == null) {
            throw new IOException("The latest release does not include the APK for this device architecture.");
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
        return result;
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
        HttpURLConnection connection = openConnection(address);
        try {
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            int status = connection.getResponseCode();
            requireTrustedHttpGetRedirect(connection, address);
            if (status < 200 || status >= 300) {
                throw responseException(connection, status);
            }
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

    private static HttpURLConnection openConnection(String address) throws IOException {
        URL url = new URL(address);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getUserInfo() != null) {
            throw new IOException("The YTArk update service returned a non-HTTPS address.");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "YTArk-Android-Updater");
        connection.setRequestProperty("Accept-Encoding", "identity");
        return connection;
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

    private static void requireTrustedDownloadRedirect(HttpURLConnection connection)
            throws IOException {
        URL finalUrl = connection.getURL();
        if (!"https".equalsIgnoreCase(finalUrl.getProtocol())
                || finalUrl.getUserInfo() != null
                || !RELEASE_DOWNLOAD_HOSTS.contains(finalUrl.getHost().toLowerCase(Locale.US))) {
            throw new SecurityException("The YTArk APK download redirected to an untrusted host.");
        }
    }

    private static void requireTrustedHttpGetRedirect(HttpURLConnection connection, String address)
            throws IOException {
        if (!RELEASES_API.equals(address)) {
            requireTrustedDownloadRedirect(connection);
            return;
        }
        URL finalUrl = connection.getURL();
        if (!"https".equalsIgnoreCase(finalUrl.getProtocol())
                || finalUrl.getUserInfo() != null
                || !"api.github.com".equalsIgnoreCase(finalUrl.getHost())
                || !"/repos/2archiver/YTArk/releases/latest".equals(finalUrl.getPath())) {
            throw new SecurityException("The YTArk release API redirected to an untrusted address.");
        }
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

    static void skipRelease(Context context, String tag) {
        if (tag == null || tag.length() == 0) return;
        preferences(context).edit().putString("skipped_tag", tag).apply();
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.cancel(NOTIFICATION_UPDATE);
    }

    static void cancelDownload(Context context) {
        DownloadOperation operation = ACTIVE_DOWNLOAD.get();
        if (operation == null) return;
        operation.cancelled.set(true);
        HttpURLConnection connection = operation.connection;
        if (connection != null) connection.disconnect();
    }

    static boolean isDownloadInProgress() {
        return ACTIVE_DOWNLOAD.get() != null;
    }

    static void downloadAndVerify(Context context, ReleaseInfo release, DownloadCallback callback) {
        final Context app = context.getApplicationContext();
        final DownloadOperation operation = new DownloadOperation();
        if (!ACTIVE_DOWNLOAD.compareAndSet(null, operation)) {
            if (callback != null) MAIN.post(() -> callback.onError("A YTArk download is already running."));
            return;
        }
        WORKER.execute(() -> {
            try {
                File apk = downloadRelease(app, release, callback, operation);
                operation.throwIfCancelled();
                MAIN.post(() -> { if (callback != null) callback.onVerifying(); });
                verifyDownloadedApk(app, apk, release);
                operation.throwIfCancelled();
                savePendingUpdate(app, apk, release);
                MAIN.post(() -> {
                    cancelDownloadNotification(app);
                    if (callback != null) callback.onReady(apk);
                });
                showStatusNotification(app, "YTArk update verified",
                        "YTArk " + release.displayVersion
                                + " is ready. Select to open the Android installer.",
                        ACTION_INSTALL);
            } catch (Exception error) {
                Exception reportedError = operation.cancelled.get()
                        ? new UpdateCancelledException() : error;
                Log.w(TAG, "Update download or verification failed", error);
                final String message = friendlyDownloadError(reportedError);
                MAIN.post(() -> {
                    cancelDownloadNotification(app);
                    if (callback != null) callback.onError(message);
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
        WORKER.execute(() -> {
            try {
                MAIN.post(() -> { if (callback != null) callback.onVerifying(); });
                verifyDownloadedApk(app, apk, release);
                MAIN.post(() -> {
                    if (callback != null) callback.onReady(apk);
                });
            } catch (Exception error) {
                Log.w(TAG, "Saved update failed verification", error);
                clearPendingUpdate(app);
                final String message = friendlyDownloadError(error);
                MAIN.post(() -> {
                    if (callback != null) callback.onError(message);
                });
            }
        });
    }

    private static File downloadRelease(Context context, ReleaseInfo release,
                                        DownloadCallback callback, DownloadOperation operation)
            throws Exception {
        validateReleaseContract(release);
        operation.throwIfCancelled();
        File directory = new File(context.getFilesDir(), "ytark_updates");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("YTArk could not create secure update storage.");
        }
        File apk = new File(directory, release.assetName);
        File partial = new File(directory, release.assetName + ".part");
        File partialMetadata = new File(directory, release.assetName + ".part.properties");

        if (apk.isFile()) {
            try {
                verifyDownloadedApk(context, apk, release);
                deleteIfPresent(partial);
                deleteIfPresent(partialMetadata);
                return apk;
            } catch (Exception invalid) {
                if (!apk.delete()) Log.w(TAG, "Could not remove invalid cached update", invalid);
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
        if (!partial.isFile()) writePartialMetadata(partialMetadata, release);

        HttpURLConnection connection = openConnection(release.downloadUrl);
        operation.connection = connection;
        long startOffset = existing;
        long lastProgress = 0L;
        try {
            operation.throwIfCancelled();
            connection.setRequestProperty("Accept", UPDATE_MIME_TYPE);
            if (existing > 0) connection.setRequestProperty("Range", "bytes=" + existing + "-");
            int status = connection.getResponseCode();
            requireTrustedDownloadRedirect(connection);
            operation.throwIfCancelled();
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
        } finally {
            connection.disconnect();
            operation.connection = null;
        }

        operation.throwIfCancelled();
        String downloadedDigest = sha256(partial);
        if (!release.sha256.equalsIgnoreCase(downloadedDigest)) {
            deleteIfPresent(partial);
            deleteIfPresent(partialMetadata);
            throw new SecurityException("The downloaded APK failed its SHA-256 integrity check.");
        }
        if (apk.exists() && !apk.delete()) throw new IOException("Could not replace the cached APK.");
        if (!partial.renameTo(apk)) throw new IOException("Could not finalize the verified APK download.");
        deleteIfPresent(partialMetadata);
        return apk;
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
        File temporary = new File(metadata.getParentFile(), metadata.getName() + ".tmp");
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
        if (file.exists() && !file.delete()) {
            throw new IOException("Could not discard stale YTArk update data.");
        }
    }

    private static void reportProgress(Context context, ReleaseInfo release, long downloaded,
                                       long total, DownloadCallback callback) {
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

    private static void savePendingUpdate(Context context, File apk, ReleaseInfo release) {
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
                .apply();
    }

    static File pendingApk(Context context) {
        String path = preferences(context).getString("pending_path", "");
        if (path.length() == 0) return null;
        File apk = new File(path);
        return isOwnedUpdateFile(context, apk) ? apk : null;
    }

    private static boolean isOwnedUpdateFile(Context context, File file) {
        if (file == null) return false;
        try {
            File updates = new File(context.getFilesDir(), "ytark_updates").getCanonicalFile();
            File canonical = file.getCanonicalFile();
            return updates.equals(canonical.getParentFile())
                    && canonical.getName().matches("YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-(?:arm64|armv7)\\.apk");
        } catch (IOException invalid) {
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
        File apk = pendingApk(context);
        if (apk != null && apk.exists() && !apk.delete()) {
            Log.w(TAG, "Could not remove the verified APK after installation");
        }
        if (apk != null) {
            File partial = new File(apk.getParentFile(), apk.getName() + ".part");
            File partialMetadata = new File(apk.getParentFile(), apk.getName() + ".part.properties");
            if (partial.exists() && !partial.delete()) Log.w(TAG, "Could not remove partial APK");
            if (partialMetadata.exists() && !partialMetadata.delete()) Log.w(TAG, "Could not remove partial metadata");
        }
        preferences(context).edit().remove("pending_path").remove("pending_tag")
                .remove("pending_version").remove("pending_display_version").remove("pending_notes")
                .remove("pending_asset").remove("pending_url").remove("pending_sha256").remove("pending_abi")
                .remove("pending_version_code").remove("pending_size").apply();
    }

    static boolean clearPendingIfInstalled(Context context) {
        ReleaseInfo pending = pendingRelease(context);
        if (pending == null) return false;
        InstalledVersion installed = getInstalledVersionSafe(context);
        if (installed.versionCode < pending.versionCode) return false;
        clearPendingUpdate(context);
        NotificationManager manager = notificationManager(context);
        if (manager != null) {
            manager.cancel(NOTIFICATION_UPDATE);
            manager.cancel(NOTIFICATION_DOWNLOAD);
            manager.cancel(NOTIFICATION_STATUS);
        }
        preferences(context).edit()
                .putString("installer_return_status", "YTArk " + pending.displayVersion + " is installed.")
                .apply();
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
                String message = friendlyInstallError(error);
                MAIN.post(() -> {
                    if (callback != null) callback.onError(message);
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

    static void recordInstallerResult(Context context, int resultCode) {
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

    private static String friendlyNetworkError(Exception error) {
        if (error instanceof HttpStatusException) {
            HttpStatusException status = (HttpStatusException) error;
            if (status.rateLimited) {
                return "GitHub temporarily rate-limited update checks. The updater will wait before retrying; you can retry later.";
            }
        }
        if (error instanceof java.net.UnknownHostException || error instanceof java.net.ConnectException
                || error instanceof java.net.SocketTimeoutException) {
            return "Could not reach the YTArk update service. Check the network and try again.";
        }
        String message = error.getMessage();
        return message == null || message.length() == 0
                ? "Could not check for updates. Your current YTArk installation is unchanged."
                : message;
    }

    private static String friendlyDownloadError(Exception error) {
        if (error instanceof UpdateCancelledException) {
            return "Download cancelled. The resumable partial download is kept and will be matched to this release before resuming.";
        }
        if (error instanceof HttpStatusException && ((HttpStatusException) error).rateLimited) {
            return "GitHub rate-limited this download request. Your partial download is kept; try again later.";
        }
        if (error instanceof SecurityException) {
            return error.getMessage() == null
                    ? "The update failed a security check and was not installed."
                    : error.getMessage();
        }
        if (error instanceof java.net.UnknownHostException || error instanceof java.net.ConnectException
                || error instanceof java.net.SocketTimeoutException) {
            return "The download was interrupted. Check the network and choose Update Now to resume.";
        }
        String message = error.getMessage();
        return message == null || message.length() == 0
                ? "The update could not be downloaded. Your current app and data are unchanged."
                : message;
    }

    private static String friendlyInstallError(Exception error) {
        if (error instanceof SecurityException) {
            return error.getMessage() == null ? "The APK failed a security check." : error.getMessage();
        }
        String message = error.getMessage();
        return message == null || message.length() == 0
                ? "Open YTArk Updates and retry. Your current app and data are unchanged."
                : "The verified APK could not be sent to Android Installer: " + message;
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
