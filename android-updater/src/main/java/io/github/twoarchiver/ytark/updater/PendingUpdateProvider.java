package io.github.twoarchiver.ytark.updater;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Read-only, single-file content URI for Android's package installer. */
public final class PendingUpdateProvider extends ContentProvider {
    private static final String PATH = "update.apk";
    private static final String MIME_TYPE = "application/vnd.android.package-archive";

    @Override
    public boolean onCreate() {
        return getContext() != null;
    }

    @Override
    public String getType(Uri uri) {
        return isAllowedUri(uri) ? MIME_TYPE : null;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        Context context = getContext();
        if (context == null || !"r".equals(mode) || !isAllowedUri(uri)) {
            throw new FileNotFoundException("Only the verified YTArk update APK is available read-only.");
        }
        File apk = YtarkUpdater.pendingApk(context);
        ReleaseInfo release = YtarkUpdater.pendingRelease(context);
        if (apk == null || release == null || !apk.isFile() || apk.length() != release.assetSize) {
            throw new FileNotFoundException("No complete verified YTArk update is pending.");
        }
        try {
            File updates = new File(context.getFilesDir(), "ytark_updates").getCanonicalFile();
            File canonical = apk.getCanonicalFile();
            if (!updates.equals(canonical.getParentFile()) || !canonical.isFile()) {
                throw new FileNotFoundException("The pending YTArk APK is outside private update storage.");
            }
            return ParcelFileDescriptor.open(canonical, ParcelFileDescriptor.MODE_READ_ONLY);
        } catch (IOException invalid) {
            if (invalid instanceof FileNotFoundException) throw (FileNotFoundException) invalid;
            FileNotFoundException failure = new FileNotFoundException("Could not open the private YTArk update file.");
            failure.initCause(invalid);
            throw failure;
        }
    }

    private boolean isAllowedUri(Uri uri) {
        Context context = getContext();
        if (context == null || uri == null) return false;
        String expectedAuthority = context.getPackageName() + ".ytarkupdater.files";
        return "content".equals(uri.getScheme())
                && expectedAuthority.equals(uri.getAuthority())
                && uri.getQuery() == null
                && uri.getFragment() == null
                && uri.getPathSegments().size() == 1
                && PATH.equals(uri.getPathSegments().get(0));
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection,
                               String[] selectionArgs) { return 0; }
}
