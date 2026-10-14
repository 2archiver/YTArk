package io.github.twoarchiver.ytark.updater;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.IOException;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/** Remote-friendly, scoped Android cache and obsolete-updater-file controls. */
public final class StorageActivity extends Activity {
    private static final long RECENT_FILE_WINDOW_MILLIS = 15L * 60L * 1000L;
    private static final int MAX_CACHE_DEPTH = 32;
    private static final AtomicBoolean WORK_RUNNING = new AtomicBoolean(false);

    private TextView summary;
    private TextView status;
    private Button calculateButton;
    private Button clearCacheButton;
    private Button clearUpdatesButton;
    private Button backButton;
    private int lastFocusId;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        android.content.Intent intent = getIntent();
        if (intent != null && android.content.Intent.ACTION_VIEW.equals(intent.getAction())
                && NativeRoutePolicy.isAllowedScreenRoute(intent.getDataString(), "storage")) {
            YtarkUpdater.persistNativeTheme(this,
                    NativeRoutePolicy.themeForRoute(intent.getDataString()));
        }
        buildScreen();
        if (state != null) lastFocusId = state.getInt("ytark_storage_focus", 0);
        boolean validRoute = intent != null
                && android.content.Intent.ACTION_VIEW.equals(intent.getAction())
                && NativeRoutePolicy.isAllowedScreenRoute(intent.getDataString(), "storage");
        if (!validRoute) {
            summary.setText("Cache measurement was not started.");
            status.setText("This YTArk Storage link is not recognized. Open Cache & Storage from YTArk Settings.");
            calculateButton.setEnabled(false);
            clearCacheButton.setEnabled(false);
            clearUpdatesButton.setEnabled(false);
            backButton.requestFocus();
            return;
        }
        calculateCache();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("ytark_storage_focus", lastFocusId);
    }

    private void buildScreen() {
        Window window = getWindow();
        String theme = YtarkUpdater.nativeTheme(this);
        int backgroundColor = NativeThemePolicy.background(theme);
        window.setStatusBarColor(backgroundColor);
        window.setNavigationBarColor(backgroundColor);
        window.getDecorView().setSystemUiVisibility(0);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(backgroundColor);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(48);
        content.setPadding(pad, dp(32), pad, dp(36));

        TextView title = text(31, NativeThemePolicy.primaryText(theme));
        title.setText("YTArk Cache & Storage");
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        content.addView(title, new LinearLayout.LayoutParams(-1, dp(56)));

        TextView explanation = text(16, NativeThemePolicy.secondaryText(theme));
        explanation.setText("Measure and clear only Android's temporary app-cache directories. Login, cookies, profile data, settings, databases, downloads and installer files are outside this cleanup. Pause playback before clearing; files modified in the last 15 minutes are kept.");
        LinearLayout.LayoutParams explanationParams = wrap();
        explanationParams.topMargin = dp(8);
        content.addView(explanation, explanationParams);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(16), dp(18), dp(16));
        GradientDrawable background = new GradientDrawable();
        background.setColor(NativeThemePolicy.card(theme));
        background.setCornerRadius(dp(10));
        background.setStroke(dp(1), NativeThemePolicy.divider(theme));
        card.setBackground(background);
        summary = text(17, NativeThemePolicy.primaryText(theme));
        summary.setText("Cache size: measuring…");
        card.addView(summary, wrap());
        LinearLayout.LayoutParams cardParams = wrap();
        cardParams.topMargin = dp(20);
        content.addView(card, cardParams);

        status = text(16, NativeThemePolicy.bodyText(theme));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setText("Calculating cache size off the UI thread…");
        LinearLayout.LayoutParams statusParams = wrap();
        statusParams.topMargin = dp(18);
        content.addView(status, statusParams);

        calculateButton = button("Calculate Cache Size");
        clearCacheButton = button("Clear Temporary Cache");
        clearUpdatesButton = button("Remove Obsolete Update Downloads");
        backButton = button("Back to YouTube");
        content.addView(calculateButton, buttonLayout());
        content.addView(clearCacheButton, buttonLayout());
        content.addView(clearUpdatesButton, buttonLayout());
        content.addView(backButton, buttonLayout());
        View.OnFocusChangeListener remember = (view, focused) -> {
            if (focused && !WORK_RUNNING.get()) lastFocusId = view.getId();
        };
        Button[] controls = { calculateButton, clearCacheButton, clearUpdatesButton, backButton };
        for (int i = 0; i < controls.length; i++) {
            Button control = controls[i];
            control.setId(0x00a10000 + i);
            control.setOnFocusChangeListener(remember);
        }
        calculateButton.setOnClickListener(view -> calculateCache());
        clearCacheButton.setOnClickListener(view -> confirmCacheClear());
        clearUpdatesButton.setOnClickListener(view -> confirmUpdateClear());
        backButton.setOnClickListener(view -> finish());
        scroll.addView(content);
        setContentView(scroll);
        calculateButton.requestFocus();
    }

    private void confirmCacheClear() {
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Clear temporary cache?")
                .setMessage("Pause playback first. YTArk will touch only Android's app-cache directories. Files modified in the last 15 minutes are retained. Sign-in, profile data and update/installer files are not part of this operation.")
                .setPositiveButton("Clear Cache", (ignored, which) -> clearCache())
                .setNegativeButton("Cancel", (ignored, which) -> restoreFocus())
                .create();
        dialog.setOnDismissListener(ignored -> restoreFocus());
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());
        dialog.show();
    }

    private void confirmUpdateClear() {
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Remove obsolete update packages?")
                .setMessage("Only obsolete files in YTArk's update directory are removed. The selected resumable download and pending installer APK are kept. Sign-in, preferences and offline data are not touched.")
                .setPositiveButton("Remove", (ignored, which) -> clearObsoleteUpdates())
                .setNegativeButton("Cancel", (ignored, which) -> restoreFocus())
                .create();
        dialog.setOnDismissListener(ignored -> restoreFocus());
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());
        dialog.show();
    }

    private void calculateCache() {
        startWork("Measuring Android app-cache directories off the UI thread…", () -> {
            CacheStats stats = scanCache(false, 0L);
            String updateStorage = measureUpdateStorage();
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                summary.setText("Measured temporary cache: " + humanBytes(stats.bytes)
                        + " across " + stats.files + " files.\n"
                        + "Recent files retained by cleanup: " + stats.recentFiles + ".\n"
                        + "Unknown-age files retained: " + stats.unknownAgeFiles + ".\n"
                        + "Unreadable or out-of-scope entries: " + stats.skipped + ".\n"
                        + updateStorage);
                status.setText(stats.skipped == 0 ? "Measurement complete." :
                        "Measurement complete; some cache entries could not be inspected and were left alone.");
                restoreFocus();
            });
        });
    }

    private void clearCache() {
        startWork("Clearing eligible old temporary cache files off the UI thread…", () -> {
            long cutoff = System.currentTimeMillis() - RECENT_FILE_WINDOW_MILLIS;
            CacheStats removed = scanCache(true, cutoff);
            CacheStats remaining = scanCache(false, 0L);
            String updateStorage = measureUpdateStorage();
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                summary.setText("Measured cache after cleanup: " + humanBytes(remaining.bytes)
                        + " across " + remaining.files + " files.\n"
                        + "Deleted " + removed.deletedFiles + " files (" + humanBytes(removed.deletedBytes) + ").\n"
                        + "Recent files kept: " + removed.recentFiles + "; unknown-age files kept: "
                        + removed.unknownAgeFiles + "; entries left untouched: " + removed.skipped + ".\n"
                        + updateStorage);
                status.setText(removed.skipped == 0
                        ? "Cache cleanup finished. Playback must be paused first; Android file-cache handles are not enumerated by YTArk."
                        : "Cache cleanup finished partially. Some entries could not be inspected or removed and were left alone. Playback must be paused first.");
                restoreFocus();
            });
        });
    }

    private void clearObsoleteUpdates() {
        startWork("Checking updater state before removing obsolete YTArk update files…", () -> {
            YtarkUpdater.UpdateFileCleanup result = YtarkUpdater.clearObsoleteUpdateDownloads(this);
            CacheStats stats = scanCache(false, 0L);
            String updateStorage = measureUpdateStorage();
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                summary.setText("Measured temporary cache: " + humanBytes(stats.bytes)
                        + " across " + stats.files + " files.\n"
                        + updateStorage);
                if (result.protectedByActiveWork) {
                    status.setText("Update files were not removed: an update download, requested install or Android installer hand-off is active.");
                } else if (result.incomplete) {
                    status.setText("Partially removed " + result.filesRemoved + " obsolete updater files ("
                            + humanBytes(result.bytesRemoved) + "). Some entries could not be inspected or deleted; the selected resumable release and pending installer APK were protected.");
                } else {
                    status.setText("Removed " + result.filesRemoved + " obsolete updater files ("
                            + humanBytes(result.bytesRemoved) + "). The selected resumable release and any pending installer APK were preserved.");
                }
                restoreFocus();
            });
        });
    }

    private void startWork(String message, Runnable work) {
        if (!WORK_RUNNING.compareAndSet(false, true)) {
            status.setText("A storage operation is already running.");
            return;
        }
        setButtonsEnabled(false);
        status.setText(message);
        Thread worker = new Thread(() -> {
            try {
                work.run();
            } catch (RuntimeException error) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) status.setText("Storage operation failed safely: "
                            + (error.getMessage() == null ? "the cache could not be accessed." : error.getMessage()));
                });
            } finally {
                WORK_RUNNING.set(false);
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        setButtonsEnabled(true);
                        restoreFocus();
                    }
                });
            }
        }, "ytark-storage-cleanup");
        worker.setDaemon(true);
        worker.start();
    }

    private void setButtonsEnabled(boolean enabled) {
        if (calculateButton == null) return;
        calculateButton.setEnabled(enabled);
        clearCacheButton.setEnabled(enabled);
        clearUpdatesButton.setEnabled(enabled);
        backButton.setEnabled(enabled);
    }

    private void restoreFocus() {
        if (WORK_RUNNING.get()) return;
        Button[] controls = { calculateButton, clearCacheButton, clearUpdatesButton, backButton };
        for (Button control : controls) {
            if (control.getId() == lastFocusId && control.isEnabled()) {
                control.requestFocus();
                return;
            }
        }
        calculateButton.requestFocus();
    }

    /** Snapshot of only the private updater directory; no recursive profile scan. */
    private String measureUpdateStorage() {
        String other = "\nOther app data: not measured or cleared (includes sign-in and preferences).";
        File root = new File(getFilesDir(), "ytark_updates");
        try {
            if (!root.exists()) return "Downloaded update storage: 0 B." + other;
            File canonicalRoot = root.getCanonicalFile();
            if (!canonicalRoot.equals(root.getAbsoluteFile())) {
                return "Downloaded update storage: unavailable (redirected directory)." + other;
            }
            File[] files = root.listFiles();
            if (files == null) return "Downloaded update storage: unavailable (unreadable)." + other;
            long bytes = 0L;
            boolean partial = false;
            for (File file : files) {
                if (!file.getCanonicalFile().equals(file.getAbsoluteFile()) || !file.isFile()
                        || !file.canRead()) { partial = true; continue; }
                bytes += file.length();
            }
            return "Downloaded update storage: " + humanBytes(bytes)
                    + (partial ? " (partial measurement)." : " (includes partial downloads and metadata).") + other;
        } catch (IOException | SecurityException error) {
            return "Downloaded update storage: unavailable." + other;
        }
    }

    private CacheStats scanCache(boolean deleteOld, long cutoff) {
        CacheStats result = new CacheStats();
        long retentionCutoff = deleteOld ? cutoff
                : System.currentTimeMillis() - RECENT_FILE_WINDOW_MILLIS;
        List<File> roots = new ArrayList<>();
        File internal = getCacheDir();
        if (internal != null) roots.add(internal);
        File[] external = getExternalCacheDirs();
        if (external != null) {
            for (File directory : external) if (directory != null) roots.add(directory);
        }
        Set<String> seenRoots = new HashSet<>();
        for (File root : roots) {
            try {
                File canonical = root.getCanonicalFile();
                if (seenRoots.add(canonical.getPath()) && canonical.isDirectory()) {
                    scanEntry(canonical, canonical, 0, deleteOld, retentionCutoff, result,
                            new HashSet<String>());
                }
            } catch (IOException | SecurityException inaccessible) {
                result.skipped++;
            }
        }
        return result;
    }

    private static void scanEntry(File file, File root, int depth, boolean deleteOld,
                                  long cutoff, CacheStats result, Set<String> visited) {
        try {
            File canonical = file.getCanonicalFile();
            String path = canonical.getPath();
            if (!UpdateGuards.isWithinCacheRoot(root, canonical)
                    || !canonical.equals(file.getAbsoluteFile()) || !visited.add(path)) {
                result.skipped++;
                return;
            }
            if (canonical.isDirectory()) {
                if (depth >= MAX_CACHE_DEPTH) {
                    result.skipped++;
                    return;
                }
                File[] children = canonical.listFiles();
                if (children == null) {
                    result.skipped++;
                    return;
                }
                for (File child : children) {
                    scanEntry(child, root, depth + 1, deleteOld, cutoff, result, visited);
                }
                if (deleteOld && depth > 0) {
                    File[] remaining = canonical.listFiles();
                    if (remaining != null && remaining.length == 0) canonical.delete();
                }
                return;
            }
            if (!canonical.isFile()) return;
            long size = canonical.length();
            long modified = canonical.lastModified();
            result.files++;
            if (deleteOld && UpdateGuards.retainCacheFile(modified, cutoff)) {
                if (modified <= 0L) result.unknownAgeFiles++;
                else result.recentFiles++;
                result.bytes += size;
                return;
            }
            if (deleteOld) {
                if (canonical.delete()) {
                    result.deletedFiles++;
                    result.deletedBytes += size;
                } else {
                    result.skipped++;
                    result.bytes += size;
                }
            } else {
                result.bytes += size;
                if (modified <= 0L) result.unknownAgeFiles++;
                else if (modified >= cutoff) result.recentFiles++;
            }
        } catch (IOException | SecurityException inaccessible) {
            result.skipped++;
        }
    }

    private TextView text(int size, int color) {
        TextView view = new TextView(this);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        view.setFocusable(false);
        view.setLineSpacing(dp(2), 1.04f);
        return view;
    }

    private Button button(String label) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextSize(17);
        view.setAllCaps(false);
        view.setMinHeight(dp(62));
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        return view;
    }

    private LinearLayout.LayoutParams buttonLayout() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(62));
        params.topMargin = dp(9);
        return params;
    }

    private LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private static String humanBytes(long bytes) {
        if (bytes < 1024L) return bytes + " B";
        double value = bytes;
        String[] units = { "KB", "MB", "GB", "TB" };
        int unit = -1;
        do {
            value /= 1024.0;
            unit++;
        } while (value >= 1024.0 && unit < units.length - 1);
        return new DecimalFormat("0.0", java.text.DecimalFormatSymbols.getInstance(Locale.US))
                .format(value) + " " + units[unit];
    }

    private static final class CacheStats {
        long bytes;
        long deletedBytes;
        int files;
        int deletedFiles;
        int recentFiles;
        int unknownAgeFiles;
        int skipped;
    }
}
