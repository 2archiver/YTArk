package io.github.twoarchiver.ytark.updater;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.util.Locale;

/** Remote-friendly Android TV update controls and the explicit installer handoff. */
public final class UpdateActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 7301;
    private static final int REQUEST_INSTALL_PERMISSION = 7302;

    private TextView statusText;
    private TextView installedVersionText;
    private ProgressBar progressBar;
    private Button checkButton;
    private Button updateButton;
    private Button installButton;
    private Button laterButton;

    private ReleaseInfo release;
    private File verifiedApk;
    private String delayedAction;
    private boolean downloadInProgress;
    private boolean waitingForNotificationPermission;
    private boolean waitingForInstallPermission;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        buildScreen();
        installedVersionText.setText("Installed version: " + YtarkUpdater.installedVersionName(this));

        String action = getIntent() == null ? null : getIntent().getAction();
        if (requestNotificationPermissionIfNeeded(action)) return;
        handleAction(action);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String action = intent == null ? null : intent.getAction();
        if (requestNotificationPermissionIfNeeded(action)) return;
        handleAction(action);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_INSTALL_PERMISSION) {
            waitingForInstallPermission = false;
            if (YtarkUpdater.canRequestPackageInstalls(this)) {
                submitVerifiedInstall();
            } else {
                setStatus("Installation permission is still off. Allow YTArk in Android Settings > Install unknown apps, then return here.");
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_NOTIFICATIONS) {
            waitingForNotificationPermission = false;
            handleAction(delayedAction);
            delayedAction = null;
        }
    }

    private void buildScreen() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(16, 20, 26));
        window.setNavigationBarColor(Color.rgb(16, 20, 26));
        window.getDecorView().setSystemUiVisibility(0);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(16, 20, 26));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int horizontal = dp(44);
        content.setPadding(horizontal, dp(34), horizontal, dp(30));

        TextView title = new TextView(this);
        title.setText("YTArk updates");
        title.setTextColor(Color.WHITE);
        title.setTextSize(30);
        title.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        content.addView(title, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(54)));

        installedVersionText = new TextView(this);
        installedVersionText.setTextColor(Color.rgb(190, 202, 216));
        installedVersionText.setTextSize(17);
        LinearLayout.LayoutParams versionParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        versionParams.topMargin = dp(8);
        content.addView(installedVersionText, versionParams);

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(20);
        statusText.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        statusText.setText("Checking for stable YTArk releases…");
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = dp(22);
        statusParams.bottomMargin = dp(14);
        content.addView(statusText, statusParams);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        progressBar.setVisibility(View.GONE);
        content.addView(progressBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(8)));

        checkButton = createButton("Check for Updates");
        updateButton = createButton("Update Now");
        installButton = createButton("Install Update");
        laterButton = createButton("Later");
        updateButton.setEnabled(false);
        installButton.setEnabled(false);

        content.addView(checkButton, buttonLayout());
        content.addView(updateButton, buttonLayout());
        content.addView(installButton, buttonLayout());
        content.addView(laterButton, buttonLayout());

        checkButton.setOnClickListener(view -> checkForUpdates(false));
        updateButton.setOnClickListener(view -> downloadUpdate());
        installButton.setOnClickListener(view -> requestInstallPermissionOrInstall());
        laterButton.setOnClickListener(view -> {
            YtarkUpdater.snooze(this, release == null ? "" : release.tag);
            finish();
        });

        scroll.addView(content);
        setContentView(scroll);
        checkButton.requestFocus();
    }

    private Button createButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(17);
        button.setAllCaps(false);
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        return button;
    }

    private LinearLayout.LayoutParams buttonLayout() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(58));
        params.topMargin = dp(10);
        return params;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private boolean requestNotificationPermissionIfNeeded(String action) {
        if (Build.VERSION.SDK_INT < 33
                || checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == PackageManager.PERMISSION_GRANTED
                || YtarkUpdater.notificationPermissionPrompted(this)) {
            return false;
        }
        waitingForNotificationPermission = true;
        delayedAction = action;
        YtarkUpdater.markNotificationPermissionPrompted(this);
        setStatus("Allow notifications to receive YTArk update alerts. You can still check manually if you choose not to allow them.");
        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQUEST_NOTIFICATIONS);
        return true;
    }

    private void handleAction(String action) {
        if (YtarkUpdater.ACTION_INSTALL.equals(action)) {
            loadAndVerifyPendingUpdate();
        } else if (YtarkUpdater.ACTION_UPDATE.equals(action)) {
            checkForUpdates(true);
        } else {
            checkForUpdates(false);
        }
    }

    private void checkForUpdates(boolean downloadImmediately) {
        setBusy(true, "Checking the official YTArk stable release…");
        YtarkUpdater.checkForUpdates(this, true, new YtarkUpdater.CheckCallback() {
            @Override
            public void onUpdateAvailable(ReleaseInfo found, String installedVersion) {
                release = found;
                verifiedApk = null;
                setBusy(false, "YTArk " + found.versionName + " is available. Choose Update Now to download it.");
                updateButton.setEnabled(true);
                installButton.setEnabled(false);
                installedVersionText.setText("Installed version: " + installedVersion);
                if (downloadImmediately) downloadUpdate();
            }

            @Override
            public void onUpToDate(String installedVersion, String message) {
                release = null;
                verifiedApk = null;
                setBusy(false, "YTArk is up to date. " + message);
                updateButton.setEnabled(false);
                installButton.setEnabled(false);
                installedVersionText.setText("Installed version: " + installedVersion);
            }

            @Override
            public void onError(String message) {
                setBusy(false, message);
                updateButton.setEnabled(release != null);
            }
        });
    }

    private void downloadUpdate() {
        if (release == null || downloadInProgress) {
            checkForUpdates(true);
            return;
        }
        downloadInProgress = true;
        updateButton.setEnabled(false);
        installButton.setEnabled(false);
        progressBar.setIndeterminate(false);
        progressBar.setProgress(0);
        progressBar.setVisibility(View.VISIBLE);
        setStatus("Preparing the verified YTArk " + release.versionName + " download…");

        YtarkUpdater.downloadAndVerify(this, release, new YtarkUpdater.DownloadCallback() {
            @Override
            public void onProgress(long downloaded, long total) {
                int percent = total <= 0 ? 0 : (int) Math.min(100L, downloaded * 100L / total);
                progressBar.setIndeterminate(false);
                progressBar.setProgress(percent);
                setStatus(String.format(Locale.US, "Downloading YTArk %s… %d%%", release.versionName, percent));
            }

            @Override
            public void onReady(File apk) {
                downloadInProgress = false;
                verifiedApk = apk;
                progressBar.setVisibility(View.GONE);
                setStatus("Download complete. SHA-256, package ID, architecture, version and YTArk signing certificate were verified. Select Install Update to continue.");
                updateButton.setEnabled(false);
                installButton.setEnabled(true);
                installButton.requestFocus();
            }

            @Override
            public void onError(String message) {
                downloadInProgress = false;
                progressBar.setVisibility(View.GONE);
                setStatus(message);
                updateButton.setEnabled(release != null);
                installButton.setEnabled(false);
            }
        });
    }

    private void loadAndVerifyPendingUpdate() {
        ReleaseInfo saved = YtarkUpdater.pendingRelease(this);
        File apk = YtarkUpdater.pendingApk(this);
        if (saved == null || apk == null || !apk.isFile()) {
            checkForUpdates(false);
            return;
        }
        release = saved;
        verifiedApk = null;
        setBusy(true, "Rechecking the saved update before opening Android Installer…");
        YtarkUpdater.verifyPendingUpdate(this, saved, apk, new YtarkUpdater.DownloadCallback() {
            @Override
            public void onProgress(long downloaded, long total) { }

            @Override
            public void onReady(File verified) {
                verifiedApk = verified;
                setBusy(false, "YTArk " + saved.versionName + " is verified and ready. Select Install Update to continue.");
                updateButton.setEnabled(false);
                installButton.setEnabled(true);
                installButton.requestFocus();
            }

            @Override
            public void onError(String message) {
                verifiedApk = null;
                setBusy(false, message);
                installButton.setEnabled(false);
                checkButton.requestFocus();
            }
        });
    }

    private void requestInstallPermissionOrInstall() {
        if (verifiedApk == null || !verifiedApk.isFile()) {
            setStatus("The verified APK is no longer available. Choose Update Now to download it again.");
            installButton.setEnabled(false);
            updateButton.setEnabled(release != null);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !YtarkUpdater.canRequestPackageInstalls(this)) {
            setStatus("Allow YTArk to install updates. Android will show its standard permission screen; return here when you are done.");
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName()));
            try {
                waitingForInstallPermission = true;
                startActivityForResult(settings, REQUEST_INSTALL_PERMISSION);
            } catch (ActivityNotFoundException unavailable) {
                waitingForInstallPermission = false;
                Intent appSettings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", getPackageName(), null));
                try {
                    startActivityForResult(appSettings, REQUEST_INSTALL_PERMISSION);
                } catch (ActivityNotFoundException ignored) {
                    setStatus("Open Android Settings > Apps > Special app access > Install unknown apps, allow YTArk, and return here.");
                }
            }
            return;
        }
        submitVerifiedInstall();
    }

    private void submitVerifiedInstall() {
        if (verifiedApk == null || release == null) {
            loadAndVerifyPendingUpdate();
            return;
        }
        setBusy(true, "Opening Android's package installer. Review and confirm the YTArk update on the next screen.");
        YtarkUpdater.installVerifiedApk(this, verifiedApk);
        // Android's PackageInstaller will present a confirmation screen. We do
        // not install, grant permissions, or accept that confirmation here.
        setBusy(false, "Android Installer is opening. Review the package and select Install to finish the update.");
    }

    private void setBusy(boolean busy, String message) {
        setStatus(message);
        checkButton.setEnabled(!busy);
        if (busy) {
            progressBar.setIndeterminate(true);
            progressBar.setVisibility(View.VISIBLE);
        } else if (!downloadInProgress) {
            progressBar.setVisibility(View.GONE);
        }
    }

    private void setStatus(String message) {
        if (statusText != null) statusText.setText(message);
    }
}
