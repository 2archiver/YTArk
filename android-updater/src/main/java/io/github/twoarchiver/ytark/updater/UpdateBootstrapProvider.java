package io.github.twoarchiver.ytark.updater;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/** Starts a lightweight stable-release check when Android creates the app process. */
public final class UpdateBootstrapProvider extends ContentProvider {
    private static final String TAG = "YTArkUpdater";
    private static final long CHECK_INTERVAL_MILLIS = 6L * 60L * 60L * 1000L;
    private static final Handler HANDLER = new Handler(Looper.getMainLooper());
    private static Context applicationContext;
    private static boolean scheduled;

    private static final Runnable PERIODIC_CHECK = new Runnable() {
        @Override
        public void run() {
            Context context = applicationContext;
            if (context != null) YtarkUpdater.checkForUpdates(context, false, null);
            HANDLER.postDelayed(this, CHECK_INTERVAL_MILLIS);
        }
    };

    @Override
    public boolean onCreate() {
        Context context = getContext();
        if (context == null) return false;
        applicationContext = context.getApplicationContext();
        YtarkUpdater.ensureNotificationChannel(applicationContext);
        synchronized (UpdateBootstrapProvider.class) {
            if (!scheduled) {
                scheduled = true;
                // Let the launcher activity reach the foreground before a
                // possible notification appears on Android TV.
                HANDLER.postDelayed(() -> YtarkUpdater.checkForUpdates(
                        applicationContext, false, null), 3000L);
                HANDLER.postDelayed(PERIODIC_CHECK, CHECK_INTERVAL_MILLIS);
            }
        }
        Log.i(TAG, "YTArk stable-release checks are enabled.");
        return true;
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection,
                               String[] selectionArgs) { return 0; }
}
