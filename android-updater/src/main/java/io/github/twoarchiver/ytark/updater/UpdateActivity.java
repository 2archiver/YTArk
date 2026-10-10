package io.github.twoarchiver.ytark.updater;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import java.text.DateFormat;
import java.util.Date;
import java.util.Locale;

/** Remote-friendly native update screen with an explicit Android installer handoff. */
public final class UpdateActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 7301;
    private static final int REQUEST_INSTALL_PERMISSION = 7302;
    private static final int REQUEST_PACKAGE_INSTALL = 7303;

    private TextView installedVersionText;
    private TextView scheduleText;
    private TextView statusText;
    private TextView releaseNotesText;
    private ProgressBar progressBar;
    private Button checkButton;
    private Button updateButton;
    private Button installButton;
    private Button cancelButton;
    private Button skipButton;
    private Button laterButton;
    private Button notificationButton;

    private ReleaseInfo release;
    private File verifiedApk;
    private boolean operationInProgress;
    private boolean waitingForInstallPermission;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        buildScreen();
        updateInstalledVersion();
        refreshScheduleSummary();
        updateNotificationButton();
        handleAction(getIntent() == null ? null : getIntent().getAction());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAction(intent == null ? null : intent.getAction());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (YtarkUpdater.clearPendingIfInstalled(this)) {
            release = null;
            verifiedApk = null;
            setStatus("Android confirms YTArk was updated in place. App data is managed by Android and has not been cleared by YTArk.");
            updateReleaseActions();
        }
        updateInstalledVersion();
        refreshScheduleSummary();
        updateNotificationButton();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_INSTALL_PERMISSION) {
            waitingForInstallPermission = false;
            if (YtarkUpdater.canRequestPackageInstalls(this)) {
                submitVerifiedInstall();
            } else {
                setStatus("Installation permission is still off. Allow YTArk in Android Settings → Install unknown apps, then return here.");
            }
            return;
        }
        if (requestCode == REQUEST_PACKAGE_INSTALL) {
            YtarkUpdater.recordInstallerResult(this, resultCode);
            if (resultCode == RESULT_OK) {
                setBusy(true, "Android returned from the installer. Checking the installed YTArk version…");
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    boolean installed = YtarkUpdater.clearPendingIfInstalled(this);
                    updateInstalledVersion();
                    refreshScheduleSummary();
                    setBusy(false, installed
                            ? "Android confirms the YTArk update is installed. Existing app data was kept by the in-place package update."
                            : "Android returned from the installer, but the new version is not confirmed yet. Your existing app remains available; you can retry Install Update.");
                    if (!installed) installButton.setEnabled(verifiedApk != null && verifiedApk.isFile());
                }, 700L);
            } else {
                setBusy(false, "Installer closed without confirmation. Your current YTArk installation and data remain unchanged.");
                installButton.setEnabled(verifiedApk != null && verifiedApk.isFile());
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_NOTIFICATIONS) {
            updateNotificationButton();
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                setStatus("Update notifications are enabled. Checks and manual installation are available either way.");
            } else {
                setStatus("Notifications were not enabled. You can still check, download, and install updates from this screen.");
            }
        }
    }

    private void buildScreen() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(15, 18, 24));
        window.setNavigationBarColor(Color.rgb(15, 18, 24));
        window.getDecorView().setSystemUiVisibility(0);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(15, 18, 24));
        scroll.setFocusable(false);
        scroll.setFocusableInTouchMode(false);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int horizontal = dp(48);
        content.setPadding(horizontal, dp(32), horizontal, dp(34));

        TextView title = new TextView(this);
        title.setText(YtarkBranding.UPDATES_TITLE);
        title.setTextColor(Color.WHITE);
        title.setTextSize(31);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        content.addView(title, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

        TextView intro = new TextView(this);
        intro.setText("Review stable releases, verify downloads, and choose when Android installs an update.");
        intro.setTextColor(Color.rgb(184, 194, 208));
        intro.setTextSize(17);
        LinearLayout.LayoutParams introParams = wrapParams();
        introParams.topMargin = dp(4);
        content.addView(intro, introParams);

        LinearLayout versionCard = card();
        installedVersionText = bodyText(19, Color.WHITE);
        scheduleText = bodyText(15, Color.rgb(183, 195, 211));
        versionCard.addView(installedVersionText, wrapParams());
        LinearLayout.LayoutParams scheduleParams = wrapParams();
        scheduleParams.topMargin = dp(8);
        versionCard.addView(scheduleText, scheduleParams);
        LinearLayout.LayoutParams cardParams = wrapParams();
        cardParams.topMargin = dp(20);
        content.addView(versionCard, cardParams);

        statusText = bodyText(19, Color.WHITE);
        statusText.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        statusText.setText("Checking the official YTArk stable release…");
        LinearLayout.LayoutParams statusParams = wrapParams();
        statusParams.topMargin = dp(22);
        statusParams.bottomMargin = dp(10);
        content.addView(statusText, statusParams);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setContentDescription("YTArk update download progress");
        progressBar.setIndeterminate(true);
        progressBar.setVisibility(View.GONE);
        content.addView(progressBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(8)));

        TextView notesHeading = sectionHeading("Release notes");
        LinearLayout.LayoutParams headingParams = wrapParams();
        headingParams.topMargin = dp(20);
        content.addView(notesHeading, headingParams);

        LinearLayout notesCard = card();
        releaseNotesText = bodyText(16, Color.rgb(218, 225, 235));
        releaseNotesText.setText("No release is selected. Choose Check for Updates to load published stable release notes.");
        notesCard.addView(releaseNotesText, wrapParams());
        LinearLayout.LayoutParams notesCardParams = wrapParams();
        notesCardParams.topMargin = dp(7);
        content.addView(notesCard, notesCardParams);

        TextView safety = bodyText(14, Color.rgb(148, 160, 177));
        safety.setText("Only published stable releases are considered. The updater matches the installed native ABI, verifies the package, version, signing certificate and SHA-256, and keeps interrupted downloads for a matching retry. Android's installer asks for your confirmation; YTArk does not uninstall, clear app data, or install silently. Update notifications are optional.");
        LinearLayout.LayoutParams safetyParams = wrapParams();
        safetyParams.topMargin = dp(14);
        content.addView(safety, safetyParams);

        checkButton = createButton("Check for Updates");
        updateButton = createButton("Download Update");
        installButton = createButton("Install Update");
        cancelButton = createButton("Cancel Download");
        skipButton = createButton("Skip This Version");
        laterButton = createButton("Later");
        notificationButton = createButton("Enable Update Notifications");
        updateButton.setEnabled(false);
        installButton.setEnabled(false);
        cancelButton.setVisibility(View.GONE);
        skipButton.setVisibility(View.GONE);

        content.addView(checkButton, buttonLayout());
        content.addView(updateButton, buttonLayout());
        content.addView(installButton, buttonLayout());
        content.addView(cancelButton, buttonLayout());
        content.addView(skipButton, buttonLayout());
        content.addView(laterButton, buttonLayout());
        content.addView(notificationButton, buttonLayout());

        checkButton.setOnClickListener(view -> checkForUpdates(false));
        updateButton.setOnClickListener(view -> downloadUpdate());
        installButton.setOnClickListener(view -> requestInstallPermissionOrInstall());
        cancelButton.setOnClickListener(view -> cancelDownload());
        skipButton.setOnClickListener(view -> skipThisVersion());
        laterButton.setOnClickListener(view -> {
            if (release != null) YtarkUpdater.snooze(this, release.tag);
            finish();
        });
        notificationButton.setOnClickListener(view -> requestNotificationPermission());

        scroll.addView(content);
        setContentView(scroll);
        checkButton.requestFocus();
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(18), dp(16), dp(18), dp(16));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(29, 35, 45));
        background.setCornerRadius(dp(10));
        background.setStroke(dp(1), Color.rgb(53, 62, 76));
        layout.setBackground(background);
        return layout;
    }

    private TextView bodyText(int size, int color) {
        TextView text = new TextView(this);
        text.setTextColor(color);
        text.setTextSize(size);
        text.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        text.setFocusable(false);
        text.setLineSpacing(dp(2), 1.05f);
        return text;
    }

    private TextView sectionHeading(String label) {
        TextView heading = bodyText(18, Color.WHITE);
        heading.setText(label);
        heading.setTypeface(null, android.graphics.Typeface.BOLD);
        return heading;
    }

    private Button createButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(17);
        button.setAllCaps(false);
        button.setMinHeight(dp(62));
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        return button;
    }

    private LinearLayout.LayoutParams buttonLayout() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(62));
        params.topMargin = dp(9);
        return params;
    }

    private LinearLayout.LayoutParams wrapParams() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void updateNotificationButton() {
        if (notificationButton == null || Build.VERSION.SDK_INT < 33
                || checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == PackageManager.PERMISSION_GRANTED) {
            if (notificationButton != null) notificationButton.setVisibility(View.GONE);
            return;
        }
        notificationButton.setVisibility(View.VISIBLE);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, REQUEST_NOTIFICATIONS);
    }

    private void handleAction(String action) {
        if (YtarkUpdater.ACTION_INSTALL.equals(action)) {
            loadAndVerifyPendingUpdate();
        } else {
            checkForUpdates(YtarkUpdater.ACTION_UPDATE.equals(action));
        }
    }

    private void checkForUpdates(boolean downloadImmediately) {
        if (operationInProgress) return;
        operationInProgress = true;
        checkButton.setEnabled(false);
        setBusy(true, "Checking the official YTArk stable release…");
        YtarkUpdater.checkForUpdates(this, true, new YtarkUpdater.CheckCallback() {
            @Override
            public void onUpdateAvailable(ReleaseInfo found, String installedVersion) {
                operationInProgress = false;
                release = found;
                verifiedApk = null;
                updateButton.setText("Download Update");
                setBusy(false, "YTArk " + found.displayVersion + " is available.");
                installedVersionText.setText("Installed version: " + YtarkBranding.releaseLabel(installedVersion));
                releaseNotesText.setText(found.notes);
                updateReleaseActions();
                refreshScheduleSummary();
                if (downloadImmediately) downloadUpdate();
                else if (matchingPendingUpdate(found)) loadAndVerifyPendingUpdate();
            }

            @Override
            public void onUpToDate(String installedVersion, String message) {
                operationInProgress = false;
                release = null;
                verifiedApk = null;
                updateButton.setText("Download Update");
                releaseNotesText.setText("You are using the latest published stable YTArk release.");
                setBusy(false, message);
                installedVersionText.setText("Installed version: " + YtarkBranding.releaseLabel(installedVersion));
                updateReleaseActions();
                refreshScheduleSummary();
            }

            @Override
            public void onError(String message) {
                operationInProgress = false;
                setBusy(false, message);
                releaseNotesText.setText(YtarkUpdater.lastCheckError(UpdateActivity.this));
                checkButton.setEnabled(true);
                updateReleaseActions();
                refreshScheduleSummary();
            }
        });
    }

    private boolean matchingPendingUpdate(ReleaseInfo candidate) {
        ReleaseInfo pending = YtarkUpdater.pendingRelease(this);
        return pending != null && candidate != null && pending.tag.equals(candidate.tag);
    }

    private void updateReleaseActions() {
        boolean hasRelease = release != null;
        updateButton.setEnabled(hasRelease && !operationInProgress && !downloadInProgress());
        skipButton.setVisibility(hasRelease ? View.VISIBLE : View.GONE);
        skipButton.setEnabled(hasRelease && !operationInProgress && !downloadInProgress());
        if (!hasRelease) installButton.setEnabled(false);
    }

    private boolean downloadInProgress() {
        return YtarkUpdater.isDownloadInProgress();
    }

    private boolean downloadRunning;

    private void downloadUpdate() {
        if (downloadRunning) return;
        if (release == null) {
            checkForUpdates(true);
            return;
        }
        downloadRunning = true;
        operationInProgress = true;
        updateButton.setEnabled(false);
        installButton.setEnabled(false);
        skipButton.setEnabled(false);
        laterButton.setEnabled(false);
        cancelButton.setEnabled(true);
        cancelButton.setVisibility(View.VISIBLE);
        checkButton.setEnabled(false);
        progressBar.setIndeterminate(true);
        progressBar.setVisibility(View.VISIBLE);
        final ReleaseInfo selectedRelease = release;
        setStatus("Preparing the verified YTArk " + selectedRelease.displayVersion + " download…");

        YtarkUpdater.downloadAndVerify(this, selectedRelease, new YtarkUpdater.DownloadCallback() {
            @Override
            public void onProgress(long downloaded, long total) {
                progressBar.setIndeterminate(false);
                int percent = total <= 0 ? 0 : (int) Math.min(100L, downloaded * 100L / total);
                progressBar.setProgress(percent);
                setStatus(String.format(Locale.US, "Downloading YTArk %s… %d%%",
                        selectedRelease.displayVersion, percent));
            }

            @Override
            public void onVerifying() {
                progressBar.setIndeterminate(true);
                setStatus("Download complete. Verifying integrity, package identity, ABI and signing certificate…");
            }

            @Override
            public void onReady(File apk) {
                downloadRunning = false;
                operationInProgress = false;
                verifiedApk = apk;
                progressBar.setVisibility(View.GONE);
                cancelButton.setVisibility(View.GONE);
                setStatus("The APK passed SHA-256, package ID, version, ABI and signer checks. Android will still ask you to confirm installation.");
                updateButton.setText("Download Update");
                updateButton.setEnabled(false);
                installButton.setEnabled(true);
                skipButton.setEnabled(release != null);
                laterButton.setEnabled(true);
                checkButton.setEnabled(true);
                installButton.requestFocus();
            }

            @Override
            public void onError(String message) {
                downloadRunning = false;
                operationInProgress = false;
                progressBar.setVisibility(View.GONE);
                cancelButton.setEnabled(true);
                cancelButton.setVisibility(View.GONE);
                setStatus(message);
                updateButton.setEnabled(release != null);
                installButton.setEnabled(false);
                skipButton.setEnabled(release != null);
                laterButton.setEnabled(true);
                checkButton.setEnabled(true);
                if (resumableMessage(message)) updateButton.setText("Resume Download");
            }
        });
    }

    private boolean resumableMessage(String message) {
        if (message == null) return false;
        String value = message.toLowerCase(Locale.US);
        return value.contains("cancelled") || value.contains("resume")
                || value.contains("interrupted") || value.contains("rate-limited");
    }

    private void cancelDownload() {
        if (!downloadRunning) return;
        YtarkUpdater.cancelDownload(this);
        setStatus("Cancelling the download. A partial file is kept only for a matching release retry…");
        cancelButton.setEnabled(false);
    }

    private void loadAndVerifyPendingUpdate() {
        ReleaseInfo saved = YtarkUpdater.pendingRelease(this);
        File apk = YtarkUpdater.pendingApk(this);
        if (saved == null || apk == null || !apk.isFile()) {
            setStatus("No saved verified update is available. Checking for the latest stable release…");
            checkForUpdates(false);
            return;
        }
        release = saved;
        verifiedApk = null;
        operationInProgress = true;
        checkButton.setEnabled(false);
        setBusy(true, "Rechecking the saved YTArk " + saved.displayVersion + " update before installation…");
        releaseNotesText.setText(saved.notes);
        YtarkUpdater.verifyPendingUpdate(this, saved, apk, new YtarkUpdater.DownloadCallback() {
            @Override
            public void onProgress(long downloaded, long total) { }

            @Override
            public void onVerifying() {
                setStatus("Verifying the saved APK against its SHA-256, package, version, ABI and signer…");
            }

            @Override
            public void onReady(File verified) {
                operationInProgress = false;
                verifiedApk = verified;
                setBusy(false, "YTArk " + saved.displayVersion + " is verified and ready for Android Installer.");
                checkButton.setEnabled(true);
                installButton.setEnabled(true);
                updateButton.setEnabled(false);
                updateReleaseActions();
                installButton.requestFocus();
            }

            @Override
            public void onError(String message) {
                operationInProgress = false;
                verifiedApk = null;
                setBusy(false, message);
                checkButton.setEnabled(true);
                installButton.setEnabled(false);
                updateButton.setEnabled(true);
                checkButton.requestFocus();
            }
        });
    }

    private void requestInstallPermissionOrInstall() {
        if (verifiedApk == null || !verifiedApk.isFile()) {
            setStatus("The verified APK is no longer available. Choose Download Update to resume or fetch it again.");
            installButton.setEnabled(false);
            updateButton.setEnabled(release != null);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !YtarkUpdater.canRequestPackageInstalls(this)) {
            setStatus("Android requires one-time permission for YTArk to open an APK installer. Review the standard Settings screen, then return here.");
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
                    setStatus("Open Android Settings → Apps → Special app access → Install unknown apps, allow YTArk, and return here.");
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
        operationInProgress = true;
        checkButton.setEnabled(false);
        installButton.setEnabled(false);
        setBusy(true, "Revalidating the APK and preparing Android's package installer…");
        YtarkUpdater.prepareInstallerIntent(this, release, verifiedApk,
                new YtarkUpdater.InstallCallback() {
                    @Override
                    public void onReady(Intent installerIntent) {
                        operationInProgress = false;
                        try {
                            setBusy(false, "Android Installer is ready. Review the package and confirm the update on the next screen.");
                            checkButton.setEnabled(true);
                            startActivityForResult(installerIntent, REQUEST_PACKAGE_INSTALL);
                        } catch (ActivityNotFoundException unavailable) {
                            setStatus("Android could not open a compatible package installer. Your current app and data are unchanged.");
                            installButton.setEnabled(true);
                        } catch (SecurityException denied) {
                            setStatus("Android blocked the installer handoff. Check the YTArk install permission and retry.");
                            installButton.setEnabled(true);
                        }
                    }

                    @Override
                    public void onError(String message) {
                        operationInProgress = false;
                        setBusy(false, message);
                        checkButton.setEnabled(true);
                        installButton.setEnabled(true);
                    }
                });
    }

    private void skipThisVersion() {
        if (release == null || operationInProgress || downloadRunning) return;
        YtarkUpdater.skipRelease(this, release.tag);
        setStatus("YTArk " + release.displayVersion + " was skipped. You can check again or install it later from this screen.");
        release = null;
        verifiedApk = null;
        updateReleaseActions();
        releaseNotesText.setText("The skipped release remains available from its official YTArk release page.");
    }

    private void updateInstalledVersion() {
        if (installedVersionText != null) {
            installedVersionText.setText("Installed version: "
                    + YtarkBranding.releaseLabel(YtarkUpdater.installedVersionName(this)));
        }
    }

    private void refreshScheduleSummary() {
        if (scheduleText == null) return;
        long last = YtarkUpdater.lastCheckAt(this);
        long next = YtarkUpdater.nextAutomaticCheckAt(this);
        DateFormat formatter = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT);
        String lastText = last == 0L ? "No completed check yet" : "Last check: " + formatter.format(new Date(last));
        String nextText = next <= System.currentTimeMillis()
                ? "Next automatic check: eligible now"
                : "Next automatic check: " + formatter.format(new Date(next));
        String outcome = YtarkUpdater.lastCheckStatus(this);
        scheduleText.setText(lastText + "\n" + nextText
                + (outcome.length() == 0 ? "" : "\n" + outcome));
    }

    private void setBusy(boolean busy, String message) {
        setStatus(message);
        progressBar.setIndeterminate(busy);
        progressBar.setVisibility(busy ? View.VISIBLE : View.GONE);
        checkButton.setEnabled(!busy);
        if (!busy && !downloadRunning) cancelButton.setVisibility(View.GONE);
    }

    private void setStatus(String message) {
        if (statusText != null) statusText.setText(message);
    }
}
