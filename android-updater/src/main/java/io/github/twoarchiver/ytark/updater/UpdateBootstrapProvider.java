package io.github.twoarchiver.ytark.updater;

import android.app.Activity;
import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

/** Persists the updater job and checks again when the YouTube TV app resumes. */
public final class UpdateBootstrapProvider extends ContentProvider {
    private static final String TAG = "YTArkUpdater";
    private static boolean callbacksRegistered;

    @Override
    public boolean onCreate() {
        Context context = getContext();
        if (context == null) return false;
        Context appContext = context.getApplicationContext();
        YtarkUpdater.ensureNotificationChannel(appContext);
        YtarkUpdater.reconcileOnStart(appContext);
        YtarkUpdater.schedulePeriodicCheck(appContext);
        YtarkUpdater.runAutomaticUpdate(appContext, null);
        registerResumeHook(appContext);
        Log.i(TAG, "Persistent hourly stable-release checks are scheduled when enabled.");
        return true;
    }

    private static synchronized void registerResumeHook(Context context) {
        if (callbacksRegistered || !(context instanceof Application)) return;
        ((Application) context).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity activity, Bundle state) { }
            @Override public void onActivityStarted(Activity activity) { }
            @Override public void onActivityResumed(Activity activity) {
                if (!(activity instanceof UpdateActivity)) {
                    YtarkUpdater.runAutomaticUpdate(activity.getApplicationContext(), null);
                }
            }
            @Override public void onActivityPaused(Activity activity) { }
            @Override public void onActivityStopped(Activity activity) { }
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { }
            @Override public void onActivityDestroyed(Activity activity) { }
        });
        callbacksRegistered = true;
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection,
                               String[] selectionArgs) { return 0; }
}
