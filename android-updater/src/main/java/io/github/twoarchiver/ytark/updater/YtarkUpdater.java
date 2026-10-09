package io.github.twoarchiver.ytark.updater;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageInstaller;
import android.app.PendingIntent;
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
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SignatureException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
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
    private static final long MAX_APK_BYTES = 512L * 1024L * 1024L;

    static final String ACTION_CHECK = "io.github.twoarchiver.ytark.action.CHECK_UPDATES";
    static final String ACTION_UPDATE = "io.github.twoarchiver.ytark.action.UPDATE_NOW";
    static final String ACTION_LATER = "io.github.twoarchiver.ytark.action.LATER";
    static final String ACTION_INSTALL = "io.github.twoarchiver.ytark.action.INSTALL_UPDATE";
    static final String ACTION_INSTALL_RESULT = "io.github.twoarchiver.ytark.action.INSTALL_RESULT";

    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "ytark-updater");
        thread.setDaemon(true);
        return thread;
    });
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final AtomicBoolean CHECK_IN_PROGRESS = new AtomicBoolean(false);

    interface CheckCallback {
        void onUpdateAvailable(ReleaseInfo release, String installedVersion);
        void onUpToDate(String installedVersion, String message);
        void onError(String message);
    }

    interface DownloadCallback {
        void onProgress(long downloaded, long total);
        void onReady(File apk);
        void onError(String message);
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

    static void checkForUpdates(Context context, boolean manual, CheckCallback callback) {
        final Context app = context.getApplicationContext();
        if (!CHECK_IN_PROGRESS.compareAndSet(false, true)) {
            if (manual && callback != null) {
                MAIN.post(() -> callback.onError("An update check is already running."));
            }
            return;
        }

        WORKER.execute(() -> {
            try {
                InstalledVersion installed = getInstalledVersion(app);
                ReleaseInfo release = fetchLatestRelease(app, installed);
                if (release == null) {
                    if (manual && callback != null) {
                        MAIN.post(() -> callback.onUpToDate(installed.versionName,
                                "No newer stable YTArk release is available."));
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
                if (manual && callback != null) {
                    final String message = friendlyNetworkError(error);
                    MAIN.post(() -> callback.onError(message));
                }
            } finally {
                CHECK_IN_PROGRESS.set(false);
            }
        });
    }

    private static ReleaseInfo fetchLatestRelease(Context context, InstalledVersion installed)
            throws Exception {
        JSONObject release = new JSONObject(httpGet(RELEASES_API, MAX_METADATA_BYTES));
        if (release.optBoolean("draft", false) || release.optBoolean("prerelease", false)) {
            return null;
        }
        if (!"YTArk".equals(release.optString("name", ""))) {
            throw new IOException("The latest release is missing YTArk release metadata.");
        }

        String tag = release.optString("tag_name", "").trim();
        if (tag.length() == 0 || !tag.startsWith("v")) {
            throw new IOException("The latest stable release has an invalid version tag.");
        }
        String version = tag.substring(1);
        try {
            UpdateVersion.compare(version, installed.versionName);
        } catch (IllegalArgumentException invalidVersion) {
            throw new IOException("The installed or published version is not valid.", invalidVersion);
        }

        long versionCode = UpdateReleaseContract.parseVersionCode(release.optString("body", ""));
        if (versionCode <= installed.versionCode
                || UpdateVersion.compare(version, installed.versionName) <= 0) {
            return null;
        }

        String assetSuffix = supportedAssetSuffix();
        if (!"arm64".equals(assetSuffix)) {
            throw new IOException("YTArk releases target 64-bit ARM Google TV devices.");
        }
        String expectedAssetName = UpdateReleaseContract.assetNameForVersion(version);
        String nativeAbi = "arm64-v8a";

        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) throw new IOException("The latest release has no downloadable assets.");
        JSONObject apkAsset = findAsset(assets, expectedAssetName);
        if (apkAsset == null) {
            throw new IOException("The latest release does not include the APK for this device.");
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

        return new ReleaseInfo(tag, version, expectedAssetName, downloadUrl, digest,
                nativeAbi, versionCode, assetSize);
    }

    private static JSONObject findAsset(JSONArray assets, String expectedName) {
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset != null && expectedName.equals(asset.optString("name", ""))) return asset;
        }
        return null;
    }

    private static String supportedAssetSuffix() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            for (String abi : Build.SUPPORTED_ABIS) {
                if ("arm64-v8a".equals(abi)) return "arm64";
            }
        }
        return "arm64-v8a".equals(Build.CPU_ABI) ? "arm64" : null;
    }

    private static String httpGet(String address, int maximumBytes) throws IOException {
        HttpURLConnection connection = openConnection(address);
        try {
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("GitHub returned HTTP " + status + ".");
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
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "YTArk-Android-Updater");
        connection.setRequestProperty("Accept-Encoding", "identity");
        return connection;
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
        if (preferences.getLong("snooze_until", 0L) > now) return;
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
                .setContentText("Version " + release.versionName + " is available to download.")
                .setStyle(new Notification.BigTextStyle().bigText(
                        "Version " + release.versionName
                                + " is available. Choose Update Now to download it."))
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
        preferences(context).edit().putLong("snooze_until", now + SNOOZE_MILLIS)
                .putString("snoozed_tag", tag == null ? "" : tag).apply();
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.cancel(NOTIFICATION_UPDATE);
    }

    static void downloadAndVerify(Context context, ReleaseInfo release, DownloadCallback callback) {
        final Context app = context.getApplicationContext();
        WORKER.execute(() -> {
            try {
                File apk = downloadRelease(app, release, callback);
                verifyDownloadedApk(app, apk, release);
                savePendingUpdate(app, apk, release);
                MAIN.post(() -> {
                    cancelDownloadNotification(app);
                    if (callback != null) callback.onReady(apk);
                });
                showStatusNotification(app, "YTArk update verified",
                        "Select to open the Android installer for version " + release.versionName + ".",
                        ACTION_INSTALL);
            } catch (Exception error) {
                Log.w(TAG, "Update download or verification failed", error);
                final String message = friendlyDownloadError(error);
                MAIN.post(() -> {
                    cancelDownloadNotification(app);
                    if (callback != null) callback.onError(message);
                });
                showStatusNotification(app, "YTArk update not ready", message, ACTION_UPDATE);
            }
        });
    }

    static void verifyPendingUpdate(Context context, ReleaseInfo release, File apk,
                                    DownloadCallback callback) {
        final Context app = context.getApplicationContext();
        WORKER.execute(() -> {
            try {
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
                                        DownloadCallback callback) throws Exception {
        File directory = new File(context.getFilesDir(), "ytark_updates");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("YTArk could not create secure update storage.");
        }
        File apk = new File(directory, release.assetName);
        File partial = new File(directory, release.assetName + ".part");

        if (apk.isFile()) {
            try {
                verifyDownloadedApk(context, apk, release);
                return apk;
            } catch (Exception invalid) {
                if (!apk.delete()) Log.w(TAG, "Could not remove invalid cached update", invalid);
            }
        }

        long existing = partial.isFile() ? partial.length() : 0L;
        if (existing < 0 || existing >= release.assetSize) {
            if (!partial.delete() && partial.exists()) {
                throw new IOException("Could not reset an incomplete update download.");
            }
            existing = 0L;
        }

        HttpURLConnection connection = openConnection(release.downloadUrl);
        long startOffset = existing;
        long lastProgress = 0L;
        try {
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            if (existing > 0) connection.setRequestProperty("Range", "bytes=" + existing + "-");
            int status = connection.getResponseCode();
            boolean append = existing > 0 && status == HttpURLConnection.HTTP_PARTIAL;
            if (append) {
                String contentRange = connection.getHeaderField("Content-Range");
                if (contentRange == null || !contentRange.startsWith("bytes " + existing + "-")) {
                    throw new IOException("The server returned an invalid resume response.");
                }
            } else if (status == HttpURLConnection.HTTP_OK) {
                startOffset = 0L;
                append = false;
            } else {
                throw new IOException("The APK download returned HTTP " + status + ".");
            }

            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(partial, append)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                long downloaded = startOffset;
                while ((count = input.read(buffer)) != -1) {
                    downloaded += count;
                    if (downloaded > release.assetSize || downloaded > MAX_APK_BYTES) {
                        throw new IOException("The downloaded APK is larger than its published size.");
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
        }

        String downloadedDigest = sha256(partial);
        if (!release.sha256.equalsIgnoreCase(downloadedDigest)) {
            partial.delete();
            throw new SecurityException("The downloaded APK failed its SHA-256 integrity check.");
        }
        if (apk.exists() && !apk.delete()) throw new IOException("Could not replace the cached APK.");
        if (!partial.renameTo(apk)) throw new IOException("Could not finalize the verified APK download.");
        return apk;
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
                .setContentText(release.versionName + " · " + percent + "%")
                .setProgress(100, percent, false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = notificationManager(context);
        if (manager != null) manager.notify(NOTIFICATION_DOWNLOAD, builder.build());
    }

    private static void verifyDownloadedApk(Context context, File apk, ReleaseInfo release)
            throws Exception {
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
        String requiredLibrary = "lib/" + nativeAbi + "/libchrobalt.so";
        try (ZipFile zip = new ZipFile(apk)) {
            ZipEntry library = zip.getEntry(requiredLibrary);
            if (library == null || library.getSize() <= 0) {
                throw new SecurityException("The downloaded APK is not built for this device architecture.");
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
        return path.length() == 0 ? null : new File(path);
    }

    static ReleaseInfo pendingRelease(Context context) {
        SharedPreferences p = preferences(context);
        String tag = p.getString("pending_tag", "");
        String version = p.getString("pending_version", "");
        String asset = p.getString("pending_asset", "");
        String url = p.getString("pending_url", "");
        String sha = p.getString("pending_sha256", "");
        String abi = p.getString("pending_abi", "");
        long code = p.getLong("pending_version_code", -1L);
        long size = p.getLong("pending_size", -1L);
        if (tag.length() == 0 || version.length() == 0 || asset.length() == 0
                || url.length() == 0 || sha.length() != 64 || abi.length() == 0
                || code <= 0 || size <= 0) return null;
        return new ReleaseInfo(tag, version, asset, url, sha, abi, code, size);
    }

    static void clearPendingUpdate(Context context) {
        File apk = pendingApk(context);
        if (apk != null && apk.exists()) apk.delete();
        if (apk != null) {
            File partial = new File(apk.getParentFile(), apk.getName() + ".part");
            if (partial.exists()) partial.delete();
        }
        preferences(context).edit().remove("pending_path").remove("pending_tag")
                .remove("pending_version").remove("pending_asset").remove("pending_url")
                .remove("pending_sha256").remove("pending_abi")
                .remove("pending_version_code").remove("pending_size").apply();
    }

    static boolean canRequestPackageInstalls(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || context.getPackageManager().canRequestPackageInstalls();
    }

    static void installVerifiedApk(Context context, File apk) {
        final Context app = context.getApplicationContext();
        WORKER.execute(() -> {
            int sessionId = -1;
            try {
                ReleaseInfo pending = pendingRelease(app);
                if (pending == null) throw new SecurityException("The verified YTArk update is no longer available.");
                verifyDownloadedApk(app, apk, pending);

                PackageInstaller installer = app.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                        PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(PACKAGE_NAME);
                params.setSize(apk.length());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
                }
                sessionId = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(sessionId);
                     InputStream input = new FileInputStream(apk);
                     OutputStream output = session.openWrite("ytark-update.apk", 0, apk.length())) {
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    session.fsync(output);
                    Intent result = new Intent(app, UpdateActionReceiver.class);
                    result.setAction(ACTION_INSTALL_RESULT);
                    result.putExtra("release_version", pending.versionName);
                    // PackageInstaller supplies STATUS_* and the user-confirmation Intent in
                    // the callback, so this explicit, app-private PendingIntent must be mutable.
                    int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        pendingFlags |= PendingIntent.FLAG_MUTABLE;
                    }
                    PendingIntent callback = PendingIntent.getBroadcast(app, sessionId, result, pendingFlags);
                    session.commit(callback.getIntentSender());
                }
                Log.i(TAG, "Submitted a verified YTArk APK to Android PackageInstaller.");
            } catch (Exception error) {
                if (sessionId >= 0) {
                    try {
                        app.getPackageManager().getPackageInstaller().abandonSession(sessionId);
                    } catch (Exception ignored) { }
                }
                Log.e(TAG, "Could not submit the APK to Android PackageInstaller", error);
                final String message = friendlyInstallError(error);
                MAIN.post(() -> showStatusNotification(app, "YTArk update could not be installed",
                        message, ACTION_INSTALL));
            }
        });
    }

    static void handleInstallerResult(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation != null) {
                confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirmation);
                } catch (RuntimeException blocked) {
                    showStatusNotification(context, "Confirm YTArk update",
                            "Select to continue in the Android package installer.", ACTION_INSTALL);
                }
            } else {
                showStatusNotification(context, "Confirm YTArk update",
                        "Open the Android package installer to confirm this update.", ACTION_INSTALL);
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            clearPendingUpdate(context);
            NotificationManager manager = notificationManager(context);
            if (manager != null) {
                manager.cancel(NOTIFICATION_UPDATE);
                manager.cancel(NOTIFICATION_DOWNLOAD);
            }
            String version = intent.getStringExtra("release_version");
            showStatusNotification(context, "YTArk updated",
                    version == null ? "The update was installed." : "YTArk " + version + " was installed.",
                    ACTION_CHECK);
            return;
        }

        String detail = message == null || message.length() == 0
                ? "Android did not install the update. Your current YTArk app and data are unchanged."
                : "Android could not install the update: " + message;
        showStatusNotification(context, "YTArk update not installed", detail, ACTION_INSTALL);
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
