package io.github.twoarchiver.ytark.updater;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.lang.ref.WeakReference;
import java.text.DateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.function.Consumer;

/**
 * Remote-friendly native update screen. It is the single owner of the install
 * flow in the app: check, verified download, the "install unknown apps"
 * permission, and one installer hand-off that is confirmed only by the installed
 * version on the next read.
 *
 * <p>Background callbacks are delivered to the live instance, so a screen that is
 * recreated (rotation, Back and re-open) keeps receiving results. Nothing here
 * opens Settings on its own: the permission screen opens only from an explicit
 * button press.
 */
public final class UpdateActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 7301;
    private static final int REQUEST_PACKAGE_INSTALL = 7303;
    private static final String STATE_FOCUS_ID = "ytark_focus_id";

    /** The instance that currently shows the screen; background work reports here. */
    private static WeakReference<UpdateActivity> live = new WeakReference<>(null);

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
    private Button viewReleaseButton;
    private Button notificationButton;
    private Button automaticChecksButton;
    private Button automaticDownloadsButton;
    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private final Runnable progressRefresh = new Runnable() {
        @Override public void run() { refreshBackgroundDownload(); }
    };

    /** The release on screen: available, downloading, verified or pending install. */
    private ReleaseInfo release;
    /** A verified APK that passed every check in this process; null until verified. */
    private File verifiedApk;
    private boolean checkRunning;
    private boolean downloadRunning;
    private boolean monitoringAutomaticWork;
    private boolean verifying;
    private boolean handingOff;
    /** Permission is off and the user asked to install: show the permission state. */
    private boolean permissionNeeded;
    /** The installer was opened and Android has not returned control yet. */
    private boolean installerOpen;
    /** Settings was opened for the install permission; focus returns to Install on resume. */
    private boolean awaitingSettings;
    private int lastFocusId;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        live = new WeakReference<>(this);
        persistRouteTheme(getIntent());
        buildScreen();
        if (state != null) {
            lastFocusId = state.getInt(STATE_FOCUS_ID, 0);
            awaitingSettings = state.getBoolean("ytark_awaiting_settings", false);
        }
        updateInstalledVersion();
        refreshScheduleSummary();
        updateAutomationButtons();
        updateNotificationButton();
        if (!isAllowedEntryIntent(getIntent())) {
            showInvalidRoute();
            return;
        }
        ReleaseInfo selected = YtarkUpdater.selectedRelease(this);
        if (selected != null && !YtarkUpdater.hasVerifiedPending(this)) {
            release = selected;
            releaseNotesText.setText(selected.notes);
        }
        String action = getIntent() == null ? null : getIntent().getAction();
        if (YtarkUpdater.ACTION_INSTALL.equals(action) || YtarkUpdater.hasVerifiedPending(this)) {
            loadAndVerifyPendingUpdate();
        } else if (YtarkUpdater.isDownloadInProgress()) {
            ReleaseInfo active = YtarkUpdater.activeDownloadRelease();
            if (active != null) {
                release = active;
                releaseNotesText.setText(active.notes);
            }
            downloadRunning = true;
            setBusy(true, "A YTArk download is already running. Showing the persisted transfer progress.");
            progressHandler.post(progressRefresh);
        } else if (state == null || Intent.ACTION_VIEW.equals(action)
                || YtarkUpdater.ACTION_UPDATE.equals(action)
                || YtarkUpdater.ACTION_CHECK.equals(action)) {
            checkForUpdates(YtarkUpdater.ACTION_UPDATE.equals(action));
        } else if (release != null) {
            if (YtarkUpdater.isAutomaticDownloadSuppressed(this, release.tag)) {
                updateButton.setText("Resume Download");
                setStatus("Download for YTArk " + release.displayVersion
                        + " was cancelled. Its matching partial is preserved; choose Resume Download to continue.");
            } else {
                setStatus("Saved stable release " + release.displayVersion
                        + " is shown from this device's updater state; this is not a fresh server check.");
            }
        }
        renderButtons();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (persistRouteTheme(intent)) {
            recreate();
            return;
        }
        if (!isAllowedEntryIntent(intent)) {
            showInvalidRoute();
            return;
        }
        String action = intent == null ? null : intent.getAction();
        if (YtarkUpdater.ACTION_INSTALL.equals(action)) {
            loadAndVerifyPendingUpdate();
        } else if (YtarkUpdater.ACTION_UPDATE.equals(action)) {
            checkForUpdates(true);
        } else if (YtarkUpdater.ACTION_CHECK.equals(action) || Intent.ACTION_VIEW.equals(action)) {
            checkForUpdates(false);
        }
    }

    private boolean persistRouteTheme(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())
                || !NativeRoutePolicy.isAllowedScreenRoute(intent.getDataString(), "updates")) return false;
        String theme = NativeRoutePolicy.themeForRoute(intent.getDataString());
        return YtarkUpdater.persistNativeTheme(this, theme);
    }

    private boolean isAllowedEntryIntent(Intent intent) {
        if (intent == null) return true;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            return NativeRoutePolicy.isAllowedScreenRoute(
                    intent.getDataString(), "updates");
        }
        if (intent.getData() != null) return false;
        return action == null || Intent.ACTION_MAIN.equals(action)
                || YtarkUpdater.ACTION_CHECK.equals(action)
                || YtarkUpdater.ACTION_UPDATE.equals(action)
                || YtarkUpdater.ACTION_INSTALL.equals(action);
    }

    private void showInvalidRoute() {
        setStatus("This YTArk Updates link is not recognized. Close it and open Updates from YTArk Settings or the TV apps row.");
        Button[] controls = { checkButton, updateButton, installButton, cancelButton,
                skipButton, laterButton, viewReleaseButton };
        for (Button control : controls) {
            if (control != null) control.setEnabled(false);
        }
        if (notificationButton != null) notificationButton.setEnabled(false);
        if (automaticChecksButton != null) automaticChecksButton.setEnabled(false);
        if (automaticDownloadsButton != null) automaticDownloadsButton.setEnabled(false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        live = new WeakReference<>(this);
        if (YtarkUpdater.clearPendingIfInstalled(this)) {
            release = null;
            verifiedApk = null;
            permissionNeeded = false;
            installerOpen = false;
            setStatus("YTArk is installed at the new version. Android updated the app in place; your data and sign-in were not reset by YTArk.");
            releaseNotesText.setText("The installed release is current. Use Check for Updates to look for a newer stable release.");
        }
        updateInstalledVersion();
        refreshScheduleSummary();
        updateNotificationButton();
        // Continue automatically only when this screen just came back from the
        // permission Settings screen. Any other resume waits for an Install press.
        boolean returnedFromSettings = awaitingSettings;
        awaitingSettings = false;
        applyInstallGate(returnedFromSettings);
        restoreFocus();
    }

    @Override
    protected void onDestroy() {
        progressHandler.removeCallbacks(progressRefresh);
        if (live.get() == this) live = new WeakReference<>(null);
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putInt(STATE_FOCUS_ID, lastFocusId);
        out.putBoolean("ytark_awaiting_settings", awaitingSettings);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_PACKAGE_INSTALL) return;
        // PackageInstaller's result is not proof of installation. onResume may
        // already have reconciled and cleared the pending APK, so keep a durable
        // target version code and always compare it with PackageManager too.
        installerOpen = false;
        long targetVersionCode = InstallerResultPolicy.resolvedTargetVersionCode(
                YtarkUpdater.installerTargetVersionCode(this),
                YtarkUpdater.completedUpdateVersionCode(this));
        YtarkUpdater.recordInstallerResult(this, resultCode);
        if (YtarkUpdater.clearPendingIfInstalled(this)
                || YtarkUpdater.isInstalledVersionAtLeast(this, targetVersionCode)) {
            finishConfirmedInstall(targetVersionCode);
            return;
        }
        YtarkUpdater.setUpdaterState(this, YtarkUpdater.STATE_INSTALLING,
                "Android returned from the installer; the installed version is being checked.");
        refreshScheduleSummary();
        setBusy(true, "Android returned from the installer. Checking the installed YTArk version…");
        reconcileInstallerResult(resultCode, targetVersionCode, 0);
    }

    private void reconcileInstallerResult(int resultCode, long targetVersionCode, int attempt) {
        progressHandler.removeCallbacks(progressRefresh);
        boolean packageConfirmed = YtarkUpdater.clearPendingIfInstalled(this)
                || YtarkUpdater.isInstalledVersionAtLeast(this, targetVersionCode);
        boolean verifiedPending = YtarkUpdater.hasVerifiedPending(this);
        InstallerResultPolicy.Outcome outcome = InstallerResultPolicy.outcome(
                packageConfirmed, verifiedPending, resultCode == RESULT_CANCELED);
        if (outcome == InstallerResultPolicy.Outcome.CONFIRMED) {
            finishConfirmedInstall(targetVersionCode);
            return;
        }
        // A successful installer result can arrive just before PackageManager
        // publishes the new package. Re-read it a few times; do not infer success
        // from the result code or show a premature failure.
        if (resultCode == RESULT_OK && attempt < 4) {
            progressHandler.postDelayed(
                    () -> reconcileInstallerResult(resultCode, targetVersionCode, attempt + 1),
                    750L);
            return;
        }

        YtarkUpdater.setHandoffInFlight(this, false);
        YtarkUpdater.setInstallRequested(this, false);
        YtarkUpdater.clearInstallerTargetVersionCode(this);
        updateInstalledVersion();
        if (outcome == InstallerResultPolicy.Outcome.CANCELLED_WITH_VERIFIED_APK
                || outcome == InstallerResultPolicy.Outcome.UNCONFIRMED_WITH_VERIFIED_APK) {
            ReleaseInfo pending = YtarkUpdater.pendingRelease(this);
            if (pending != null) {
                release = pending;
                releaseNotesText.setText(pending.notes);
                verifiedApk = YtarkUpdater.pendingApk(this);
            }
            if (outcome == InstallerResultPolicy.Outcome.CANCELLED_WITH_VERIFIED_APK) {
                YtarkUpdater.setUpdaterState(this, YtarkUpdater.STATE_INSTALL_CANCELLED,
                        "Android's installer was cancelled. The verified APK remains ready; nothing was installed.");
                setBusy(false, "Installer cancelled. The verified update is still ready; press Install Update to retry.");
            } else {
                String message = UpdateFailure.INSTALL_UNCONFIRMED.message();
                YtarkUpdater.setUpdaterFailure(this, message, UpdaterFailurePhasePolicy.INSTALL);
                setBusy(false, UpdateFailure.INSTALL_UNCONFIRMED.label() + ": " + message
                        + " The verified APK remains available for retry.");
            }
        } else {
            String message = "The installer returned, but Android did not confirm the target version. "
                    + "Check for Updates; the installed app has not been presumed replaced.";
            YtarkUpdater.setUpdaterFailure(this, message, UpdaterFailurePhasePolicy.INSTALL);
            setBusy(false, resultCode == RESULT_CANCELED
                    ? "Installer cancelled; no verified pending APK is available. Check for Updates to retry."
                    : message);
        }
        refreshScheduleSummary();
        renderButtons();
        installButton.requestFocus();
    }

    private void finishConfirmedInstall(long targetVersionCode) {
        ReleaseInfo pending = YtarkUpdater.pendingRelease(this);
        if (pending != null && InstallerResultPolicy.shouldClearPendingRelease(
                pending.versionCode, targetVersionCode)) {
            YtarkUpdater.clearPendingUpdate(this);
        }
        YtarkUpdater.clearInstallerTargetVersionCode(this);
        YtarkUpdater.setHandoffInFlight(this, false);
        YtarkUpdater.setInstallRequested(this, false);
        YtarkUpdater.setUpdaterState(this, YtarkUpdater.STATE_UP_TO_DATE, "");
        release = null;
        verifiedApk = null;
        permissionNeeded = false;
        installerOpen = false;
        updateInstalledVersion();
        refreshScheduleSummary();
        String installed = YtarkUpdater.installedVersionName(this);
        setBusy(false, targetVersionCode > 0L
                ? "Android confirms YTArk " + installed + " (versionCode at least "
                        + targetVersionCode + ") is installed. YTArk did not clear app data or sign-in."
                : "Android confirms the YTArk update is installed. YTArk did not clear app data or sign-in.");
        renderButtons();
        restoreFocus();
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

    // ------------------------------------------------------------------ screen

    private void buildScreen() {
        Window window = getWindow();
        int backgroundColor = NativeThemePolicy.background(YtarkUpdater.nativeTheme(this));
        window.setStatusBarColor(backgroundColor);
        window.setNavigationBarColor(backgroundColor);
        window.getDecorView().setSystemUiVisibility(0);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(backgroundColor);
        scroll.setFocusable(false);
        scroll.setFocusableInTouchMode(false);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int horizontal = dp(48);
        content.setPadding(horizontal, dp(32), horizontal, dp(34));

        TextView title = new TextView(this);
        title.setText(YtarkBranding.UPDATES_TITLE);
        title.setTextColor(NativeThemePolicy.primaryText(YtarkUpdater.nativeTheme(this)));
        title.setTextSize(31);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        content.addView(title, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

        TextView intro = new TextView(this);
        intro.setText("Check the official stable releases, verify downloads, and let Android confirm each install.");
        intro.setTextColor(NativeThemePolicy.secondaryText(YtarkUpdater.nativeTheme(this)));
        intro.setTextSize(17);
        LinearLayout.LayoutParams introParams = wrapParams();
        introParams.topMargin = dp(4);
        content.addView(intro, introParams);

        LinearLayout versionCard = card();
        installedVersionText = bodyText(19, NativeThemePolicy.primaryText(YtarkUpdater.nativeTheme(this)));
        scheduleText = bodyText(15, NativeThemePolicy.secondaryText(YtarkUpdater.nativeTheme(this)));
        versionCard.addView(installedVersionText, wrapParams());
        LinearLayout.LayoutParams scheduleParams = wrapParams();
        scheduleParams.topMargin = dp(8);
        versionCard.addView(scheduleText, scheduleParams);
        LinearLayout.LayoutParams cardParams = wrapParams();
        cardParams.topMargin = dp(20);
        content.addView(versionCard, cardParams);

        statusText = bodyText(19, NativeThemePolicy.primaryText(YtarkUpdater.nativeTheme(this)));
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
        releaseNotesText = bodyText(16, NativeThemePolicy.bodyText(YtarkUpdater.nativeTheme(this)));
        releaseNotesText.setText("No release is selected. Choose Check for Updates to load the published stable release notes.");
        notesCard.addView(releaseNotesText, wrapParams());
        LinearLayout.LayoutParams notesCardParams = wrapParams();
        notesCardParams.topMargin = dp(7);
        content.addView(notesCard, notesCardParams);

        TextView safety = bodyText(14, NativeThemePolicy.quietText(YtarkUpdater.nativeTheme(this)));
        safety.setText("Only published stable releases are considered. The updater matches this device's Android ABI, then verifies the SHA-256, package, version, minimum Android version and signing certificate before any install. Android's installer asks for your confirmation; YTArk does not install silently, uninstall, or clear app data. Installing an update needs the one-time \u201cInstall unknown apps\u201d permission for YTArk.");
        LinearLayout.LayoutParams safetyParams = wrapParams();
        safetyParams.topMargin = dp(14);
        content.addView(safety, safetyParams);

        checkButton = createButton("Check for Updates");
        updateButton = createButton("Download Update");
        installButton = createButton("Install Update");
        cancelButton = createButton("Cancel Download");
        skipButton = createButton("Skip This Version");
        viewReleaseButton = createButton("View Release Page");
        laterButton = createButton("Later");
        automaticChecksButton = createButton("Automatic Checks: On");
        automaticDownloadsButton = createButton("Automatic Downloads: On");
        notificationButton = createButton("Enable Update Notifications");
        updateButton.setVisibility(View.GONE);
        installButton.setEnabled(false);
        cancelButton.setVisibility(View.GONE);
        skipButton.setVisibility(View.GONE);

        content.addView(checkButton, buttonLayout());
        content.addView(automaticChecksButton, buttonLayout());
        content.addView(automaticDownloadsButton, buttonLayout());
        content.addView(updateButton, buttonLayout());
        content.addView(installButton, buttonLayout());
        content.addView(cancelButton, buttonLayout());
        content.addView(skipButton, buttonLayout());
        content.addView(viewReleaseButton, buttonLayout());
        content.addView(laterButton, buttonLayout());
        content.addView(notificationButton, buttonLayout());

        checkButton.setOnClickListener(view -> checkForUpdates(false));
        automaticChecksButton.setOnClickListener(view -> {
            boolean enabled = !YtarkUpdater.automaticChecksEnabled(this);
            YtarkUpdater.setAutomaticChecksEnabled(this, enabled);
            if (enabled) beginAutomaticRun();
            updateAutomationButtons();
            refreshScheduleSummary();
            setStatus(enabled ? "Persistent hourly automatic checks are enabled. Android may defer the scheduled job."
                    : "Automatic update checks are off. Manual checks remain available.");
        });
        automaticDownloadsButton.setOnClickListener(view -> {
            boolean enabled = !YtarkUpdater.automaticDownloadsEnabled(this);
            YtarkUpdater.setAutomaticDownloadsEnabled(this, enabled);
            if (enabled) beginAutomaticRun();
            updateAutomationButtons();
            refreshScheduleSummary();
            setStatus(enabled ? "Automatic downloads are enabled for compatible stable releases."
                    : "Automatic downloads are off. Update checks remain enabled; choose Download Update to download manually.");
            if (!enabled && YtarkUpdater.updaterState(this).equals(YtarkUpdater.STATE_CANCELLED)) {
                downloadRunning = false;
                progressHandler.removeCallbacks(progressRefresh);
                progressBar.setVisibility(View.GONE);
            }
            renderButtons();
        });
        updateButton.setOnClickListener(view -> downloadUpdate());
        installButton.setOnClickListener(view -> onInstallPressed());
        cancelButton.setOnClickListener(view -> onCancelPressed());
        skipButton.setOnClickListener(view -> skipThisVersion());
        viewReleaseButton.setOnClickListener(view -> openReleasePage());
        laterButton.setOnClickListener(view -> {
            if (release != null) YtarkUpdater.snooze(this, release.tag);
            finish();
        });
        notificationButton.setOnClickListener(view -> requestNotificationPermission());

        View.OnFocusChangeListener remember = (view, hasFocus) -> {
            if (hasFocus) lastFocusId = view.getId();
        };
        Button[] focusable = { checkButton, automaticChecksButton, automaticDownloadsButton,
                updateButton, installButton, cancelButton, skipButton, viewReleaseButton,
                laterButton, notificationButton };
        for (int i = 0; i < focusable.length; i++) {
            focusable[i].setId(0x00a20000 + i);
            focusable[i].setOnFocusChangeListener(remember);
        }

        scroll.addView(content);
        setContentView(scroll);
        checkButton.requestFocus();
    }

    /** Puts D-pad focus back on the control the user was using, or on the primary action. */
    private void restoreFocus() {
        Button preferred = null;
        for (Button button : new Button[] { checkButton, automaticChecksButton, automaticDownloadsButton,
                updateButton, installButton, cancelButton, skipButton, viewReleaseButton, laterButton, notificationButton }) {
            if (button.getId() == lastFocusId && button.getVisibility() == View.VISIBLE && button.isEnabled()) {
                preferred = button;
                break;
            }
        }
        if (awaitingSettings || permissionNeeded) {
            if (installButton.isEnabled()) preferred = installButton;
        }
        if (preferred == null) preferred = checkButton;
        preferred.requestFocus();
    }

    private void renderButtons() {
        boolean busy = checkRunning || downloadRunning || verifying || handingOff;
        boolean ready = verifiedApk != null && verifiedApk.isFile();
        boolean hasRelease = release != null;
        checkButton.setEnabled(!busy);
        updateButton.setVisibility(hasRelease && !ready && !installerOpen ? View.VISIBLE : View.GONE);
        updateButton.setEnabled(hasRelease && !busy && !ready);
        if (!updateButton.isEnabled() && updateButton.getVisibility() == View.VISIBLE) {
            updateButton.setEnabled(false);
        }
        skipButton.setVisibility(hasRelease && !ready ? View.VISIBLE : View.GONE);
        skipButton.setEnabled(hasRelease && !busy);
        installButton.setText(permissionNeeded ? "Open Settings to Allow Installs"
                : installerOpen || handingOff ? "Installer open"
                : (YtarkUpdater.handoffInFlight(this) ? "Retry Installation" : "Install Update"));
        installButton.setEnabled(!busy && !installerOpen && (ready || permissionNeeded
                || YtarkUpdater.handoffInFlight(this)));
        cancelButton.setVisibility(downloadRunning || permissionNeeded ? View.VISIBLE : View.GONE);
        cancelButton.setText(downloadRunning ? "Cancel Download" : "Cancel Install");
        cancelButton.setEnabled(true);
        viewReleaseButton.setEnabled(!busy || hasRelease);
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(18), dp(16), dp(18), dp(16));
        GradientDrawable background = new GradientDrawable();
        background.setColor(NativeThemePolicy.card(YtarkUpdater.nativeTheme(this)));
        background.setCornerRadius(dp(10));
        background.setStroke(dp(1), NativeThemePolicy.divider(YtarkUpdater.nativeTheme(this)));
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
        TextView heading = bodyText(18, NativeThemePolicy.primaryText(YtarkUpdater.nativeTheme(this)));
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

    private void beginAutomaticRun() {
        if (checkRunning || downloadRunning || verifying || handingOff || installerOpen
                || monitoringAutomaticWork) return;
        monitoringAutomaticWork = true;
        checkRunning = true;
        setBusy(true, "Starting the automatic stable-release check and any enabled download…");
        renderButtons();
        progressHandler.removeCallbacks(progressRefresh);
        progressHandler.post(progressRefresh);
        WeakReference<UpdateActivity> owner = new WeakReference<>(this);
        YtarkUpdater.requestAutomaticUpdate(this, retry -> {
            UpdateActivity activity = owner.get();
            if (activity == null || activity.isFinishing() || live.get() != activity) return;
            activity.checkRunning = false;
            activity.monitoringAutomaticWork = false;
            activity.progressHandler.removeCallbacks(activity.progressRefresh);
            activity.refreshScheduleSummary();
            if (YtarkUpdater.hasVerifiedPending(activity)) {
                activity.loadAndVerifyPendingUpdate();
                return;
            }
            if (YtarkUpdater.STATE_FAILED.equals(YtarkUpdater.updaterState(activity))) {
                String error = YtarkUpdater.updaterError(activity);
                activity.setBusy(false, error.length() == 0
                        ? "Automatic update work did not finish. Your installed app is unchanged; retry from this screen."
                        : error);
            } else {
                ReleaseInfo saved = YtarkUpdater.selectedRelease(activity);
                if (saved != null) {
                    activity.release = saved;
                    activity.releaseNotesText.setText(saved.notes);
                    activity.updateButton.setText(YtarkUpdater.isAutomaticDownloadSuppressed(activity, saved.tag)
                            ? "Resume Download" : "Download Update");
                    activity.setBusy(false, YtarkUpdater.isAutomaticDownloadSuppressed(activity, saved.tag)
                            ? "Automatic download for YTArk " + saved.displayVersion + " was cancelled. Choose Resume Download or enable automatic downloads again."
                            : YtarkUpdater.automaticDownloadsEnabled(activity)
                            ? "YTArk " + saved.displayVersion + " is selected; its verified download is ready or already running."
                            : "YTArk " + saved.displayVersion + " is available. Automatic downloads are off; choose Download Update when ready.");
                } else {
                    activity.setBusy(false, "Automatic update check completed. " + YtarkUpdater.lastCheckStatus(activity));
                }
            }
            activity.renderButtons();
            activity.restoreFocus();
        });
    }

    private void updateAutomationButtons() {
        if (automaticChecksButton != null) {
            automaticChecksButton.setText("Automatic Checks: "
                    + (YtarkUpdater.automaticChecksEnabled(this) ? "On" : "Off"));
            automaticChecksButton.setContentDescription("Toggle persistent hourly YTArk update checks");
        }
        if (automaticDownloadsButton != null) {
            automaticDownloadsButton.setText("Automatic Downloads: "
                    + (YtarkUpdater.automaticDownloadsEnabled(this) ? "On" : "Off"));
            automaticDownloadsButton.setContentDescription("Toggle automatic download and validation of compatible YTArk releases");
        }
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

    // ------------------------------------------------------------ live delivery

    /** Runs an action on the live screen; work that finishes after the screen closed is dropped. */
    private static void deliver(Consumer<UpdateActivity> action) {
        UpdateActivity screen = live.get();
        if (screen != null && !screen.isFinishing()) action.accept(screen);
    }

    // ------------------------------------------------------------------ check

    private void checkForUpdates(boolean downloadImmediately) {
        if (checkRunning || downloadRunning || handingOff) return;
        checkRunning = true;
        setBusy(true, "Checking the official YTArk stable release…");
        YtarkUpdater.checkForUpdates(this, true, new YtarkUpdater.CheckCallback() {
            @Override
            public void onUpdateAvailable(ReleaseInfo found, String installedVersion) {
                deliver(a -> a.showAvailable(found, installedVersion, downloadImmediately));
            }

            @Override
            public void onUpToDate(String installedVersion, String message) {
                deliver(a -> a.showUpToDate(installedVersion, message));
            }

            @Override
            public void onError(UpdateFailure reason, String message) {
                deliver(a -> a.showCheckError(reason, message));
            }
        });
    }

    private void showAvailable(ReleaseInfo found, String installedVersion, boolean downloadImmediately) {
        checkRunning = false;
        release = found;
        verifiedApk = null;
        permissionNeeded = false;
        releaseNotesText.setText(found.notes);
        boolean skipped = YtarkUpdater.isReleaseSkipped(this, found.tag);
        boolean downloadPaused = YtarkUpdater.isAutomaticDownloadSuppressed(this, found.tag);
        setBusy(false, skipped
                ? "YTArk " + found.displayVersion + " was previously skipped. Automatic download is disabled for this release; choose Download Update to override."
                : downloadPaused
                ? "Automatic download for YTArk " + found.displayVersion + " was cancelled. The matching partial is kept; choose Resume Download or enable automatic downloads again."
                : "YTArk " + found.displayVersion + " is available. Download it here, then install it with Android's confirmation.");
        installedVersionText.setText("Installed version: " + YtarkBranding.releaseLabel(installedVersion));
        refreshScheduleSummary();
        if (YtarkUpdater.hasVerifiedPending(this) && matchingPendingUpdate(found)) {
            loadAndVerifyPendingUpdate();
        } else if (YtarkUpdater.isDownloadInProgress()) {
            ReleaseInfo active = YtarkUpdater.activeDownloadRelease();
            if (active != null) {
                release = active;
                releaseNotesText.setText(active.notes);
            }
            downloadRunning = true;
            progressBar.setVisibility(View.VISIBLE);
            progressBar.setIndeterminate(true);
            setStatus("A persisted YTArk download is running in the background. Progress below is read from the actual transfer state.");
            renderButtons();
            progressHandler.removeCallbacks(progressRefresh);
            progressHandler.post(progressRefresh);
            cancelButton.requestFocus();
        } else if (!skipped && (downloadImmediately
                || (!downloadPaused && YtarkUpdater.automaticDownloadsEnabled(this)))) {
            downloadUpdate(!downloadImmediately && YtarkUpdater.automaticDownloadsEnabled(this));
        } else {
            updateButton.setText(skipped ? "Download Skipped Version"
                    : downloadPaused ? "Resume Download" : "Download Update");
            renderButtons();
            updateButton.requestFocus();
        }
    }

    private void showUpToDate(String installedVersion, String message) {
        checkRunning = false;
        release = null;
        verifiedApk = null;
        releaseNotesText.setText("No newer stable YTArk release is published than the one installed.");
        installedVersionText.setText("Installed version: " + YtarkBranding.releaseLabel(installedVersion));
        setBusy(false, message);
        refreshScheduleSummary();
        renderButtons();
    }

    private void showCheckError(UpdateFailure reason, String message) {
        checkRunning = false;
        setBusy(false, reason.label() + ": " + message);
        long verifiedAt = YtarkUpdater.lastSuccessAt(this);
        String cached = verifiedAt == 0L ? "No successful check has completed on this device yet."
                : "Last successful check: " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM,
                DateFormat.SHORT).format(new Date(verifiedAt)) + ". Those results are not a fresh check.";
        if (release == null) releaseNotesText.setText(cached);
        else releaseNotesText.setText(release.notes + "\n\nSaved selection: this is not a fresh release check.");
        refreshScheduleSummary();
        renderButtons();
        checkButton.requestFocus();
    }

    private boolean matchingPendingUpdate(ReleaseInfo candidate) {
        ReleaseInfo pending = YtarkUpdater.pendingRelease(this);
        return pending != null && candidate != null && pending.tag.equals(candidate.tag);
    }

    // --------------------------------------------------------------- download

    private void downloadUpdate() {
        downloadUpdate(false);
    }

    private void downloadUpdate(boolean automatic) {
        if (downloadRunning || checkRunning) return;
        if (release == null) {
            checkForUpdates(true);
            return;
        }
        downloadRunning = true;
        progressBar.setIndeterminate(true);
        progressBar.setVisibility(View.VISIBLE);
        final ReleaseInfo selected = release;
        setStatus("Preparing the verified YTArk " + selected.displayVersion + " download…");
        renderButtons();
        cancelButton.requestFocus();

        YtarkUpdater.downloadAndVerify(this, selected, automatic, new YtarkUpdater.DownloadCallback() {
            @Override
            public void onProgress(long downloaded, long total) {
                deliver(a -> a.showProgress(selected, downloaded, total));
            }

            @Override
            public void onVerifying() {
                deliver(a -> a.showVerifying());
            }

            @Override
            public void onReady(File apk) {
                deliver(a -> a.showDownloaded(apk));
            }

            @Override
            public void onError(UpdateFailure reason, String message) {
                deliver(a -> a.showDownloadError(reason, message));
            }
        });
    }

    private void showProgress(ReleaseInfo selected, long downloaded, long total) {
        progressBar.setIndeterminate(false);
        int percent = total <= 0 ? 0 : (int) Math.min(100L, downloaded * 100L / total);
        progressBar.setProgress(percent);
        setStatus(String.format(Locale.US, "Downloading YTArk %s… %d%%", selected.displayVersion, percent));
    }

    private void showVerifying() {
        progressBar.setIndeterminate(true);
        setStatus("Download complete. Verifying the SHA-256, package, version, Android version, ABI and signing certificate…");
    }

    private void showDownloaded(File apk) {
        downloadRunning = false;
        verifiedApk = apk;
        progressBar.setVisibility(View.GONE);
        setStatus("The APK passed every check. Install it when you are ready; Android will still ask you to confirm.");
        renderButtons();
        installButton.requestFocus();
    }

    private void showDownloadError(UpdateFailure reason, String message) {
        downloadRunning = false;
        progressBar.setVisibility(View.GONE);
        setStatus(reason.label() + ": " + message);
        renderButtons();
        if (reason == UpdateFailure.DOWNLOAD_FAILED || reason == UpdateFailure.OFFLINE
                || reason == UpdateFailure.RATE_LIMITED) {
            updateButton.setText("Resume Download");
        } else {
            updateButton.setText("Download Update");
        }
        if (updateButton.getVisibility() == View.VISIBLE) updateButton.requestFocus();
        else checkButton.requestFocus();
    }

    private void onCancelPressed() {
        if (downloadRunning) {
            YtarkUpdater.cancelDownload(this);
            setStatus("Cancelling the download. The partial file is kept only for a matching retry…");
            cancelButton.setEnabled(false);
            return;
        }
        if (permissionNeeded) {
            YtarkUpdater.setInstallRequested(this, false);
            YtarkUpdater.setUpdaterState(this, YtarkUpdater.STATE_READY_TO_INSTALL, "Install request cancelled; the verified APK remains ready.");
            permissionNeeded = false;
            setStatus("Install cancelled. The verified update stays ready; press Install Update when you want to continue.");
            renderButtons();
            installButton.requestFocus();
        }
    }

    // ------------------------------------------------------------ verification

    private void loadAndVerifyPendingUpdate() {
        ReleaseInfo saved = YtarkUpdater.pendingRelease(this);
        File apk = YtarkUpdater.pendingApk(this);
        if (saved == null || apk == null || !apk.isFile()) {
            setStatus("No saved verified update is available. Checking for the latest stable release…");
            checkForUpdates(false);
            return;
        }
        if (verifying) return;
        verifying = true;
        release = saved;
        verifiedApk = null;
        releaseNotesText.setText(saved.notes);
        setBusy(true, "Rechecking the saved YTArk " + saved.displayVersion + " update before installation…");
        YtarkUpdater.verifyPendingUpdate(this, saved, apk, new YtarkUpdater.DownloadCallback() {
            @Override
            public void onProgress(long downloaded, long total) { }

            @Override
            public void onVerifying() {
                deliver(a -> a.setStatus("Verifying the saved APK against its SHA-256, package, version, ABI and signer…"));
            }

            @Override
            public void onReady(File verified) {
                deliver(a -> a.showPendingVerified(verified, saved));
            }

            @Override
            public void onError(UpdateFailure reason, String message) {
                deliver(a -> a.showPendingError(reason, message));
            }
        });
    }

    private void showPendingVerified(File verified, ReleaseInfo saved) {
        verifying = false;
        verifiedApk = verified;
        release = saved;
        setBusy(false, "YTArk " + saved.displayVersion + " is verified and ready to install.");
        renderButtons();
        applyInstallGate(false);
    }

    private void showPendingError(UpdateFailure reason, String message) {
        verifying = false;
        verifiedApk = null;
        setBusy(false, reason.label() + ": " + message);
        renderButtons();
        checkButton.requestFocus();
    }

    // --------------------------------------------------------- install gate

    /**
     * Decides the next install step from persisted intent and the live permission.
     * Runs on resume and after verification. It never opens Settings and never
     * starts the installer unless the user asked to install in this flow.
     */
    private void applyInstallGate(boolean mayContinue) {
        if (verifying || downloadRunning || checkRunning || handingOff) return;
        if (!YtarkUpdater.hasVerifiedPending(this)) {
            verifiedApk = null;
            permissionNeeded = false;
            renderButtons();
            return;
        }
        if (verifiedApk == null) {
            loadAndVerifyPendingUpdate();
            return;
        }
        switch (YtarkUpdater.installStep(this)) {
            case HANDOFF:
                if (mayContinue) {
                    beginInstallerHandoff();
                } else {
                    permissionNeeded = false;
                    setStatus("Install permission is on. Press Install Update to open Android's installer.");
                    renderButtons();
                }
                break;
            case REQUEST_PERMISSION:
                showPermissionNeeded();
                break;
            case WAIT_FOR_INSTALLER:
                installerOpen = false;
                setStatus("The installer was opened earlier and has not reported back. Confirm the update in Android's installer, or choose Retry Installation if it closed.");
                renderButtons();
                break;
            default:
                permissionNeeded = false;
                setStatus("YTArk " + release.displayVersion + " is verified and ready. Press Install Update to continue; Android will confirm the install.");
                renderButtons();
                break;
        }
    }

    private void onInstallPressed() {
        if (handingOff || installerOpen) return;
        if (verifiedApk == null || !verifiedApk.isFile()) {
            loadAndVerifyPendingUpdate();
            return;
        }
        if (permissionNeeded || !YtarkUpdater.canRequestPackageInstalls(this)) {
            YtarkUpdater.setUpdaterState(this, YtarkUpdater.STATE_PERMISSION_NEEDED, "Allow YTArk to install the verified update in Android settings.");
            YtarkUpdater.setInstallRequested(this, true);
            openInstallPermissionSettings();
            return;
        }
        if (YtarkUpdater.handoffInFlight(this)) {
            // An explicit retry after an installer that never reported back.
            YtarkUpdater.setHandoffInFlight(this, false);
        }
        beginInstallerHandoff();
    }

    /** Opens the "Install unknown apps" screen for this app, only from an explicit press. */
    private void openInstallPermissionSettings() {
        permissionNeeded = true;
        Intent manage = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName()));
        try {
            awaitingSettings = true;
            startActivity(manage);
            setStatus("Turn on \u201cAllow from this source\u201d for YTArk, then return here. The update continues after you come back.");
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null));
            try {
                awaitingSettings = true;
                startActivity(details);
                setStatus("Open YTArk's app settings, find install permissions (Install unknown apps), allow it, then return here.");
            } catch (ActivityNotFoundException | SecurityException stillUnavailable) {
                awaitingSettings = false;
                setStatus(UpdateFailure.PERMISSION_DENIED.label() + ": this TV does not open the install-permission screen. Allow YTArk to install unknown apps in the system settings, then return here.");
            }
        }
        renderButtons();
    }

    private void showPermissionNeeded() {
        permissionNeeded = true;
        YtarkUpdater.setUpdaterState(this, YtarkUpdater.STATE_PERMISSION_NEEDED,
                "Allow YTArk to install the verified update from Android settings.");
        installerOpen = false;
        setStatus(UpdateFailure.PERMISSION_DENIED.label() + ": " + UpdateFailure.PERMISSION_DENIED.message()
                + " Your verified update stays ready; nothing was installed.");
        renderButtons();
        installButton.requestFocus();
    }

    /** Re-verifies the APK and hands it to Android's installer, exactly once per press. */
    private void beginInstallerHandoff() {
        if (handingOff || installerOpen || release == null || verifiedApk == null) return;
        if (!YtarkUpdater.canRequestPackageInstalls(this)) {
            showPermissionNeeded();
            return;
        }
        // Persist the hand-off before the async work: a restart must not repeat it.
        YtarkUpdater.setInstallRequested(this, false);
        YtarkUpdater.setInstallerTargetVersionCode(this, release.versionCode);
        YtarkUpdater.setHandoffInFlight(this, true);
        YtarkUpdater.setUpdaterState(this, YtarkUpdater.STATE_INSTALLING, "Android's package installer is being prepared; installation still requires Android confirmation.");
        permissionNeeded = false;
        handingOff = true;
        setBusy(true, "Revalidating the APK and preparing Android's package installer…");
        YtarkUpdater.prepareInstallerIntent(this, release, verifiedApk, new YtarkUpdater.InstallCallback() {
            @Override
            public void onReady(Intent installerIntent) {
                deliver(a -> a.startInstaller(installerIntent));
            }

            @Override
            public void onError(UpdateFailure reason, String message) {
                deliver(a -> a.installerUnavailable(reason, message));
            }
        });
    }

    private void startInstaller(Intent installerIntent) {
        handingOff = false;
        if (!YtarkUpdater.canRequestPackageInstalls(this)) {
            YtarkUpdater.setHandoffInFlight(this, false);
            YtarkUpdater.clearInstallerTargetVersionCode(this);
            showPermissionNeeded();
            return;
        }
        if (installerIntent.resolveActivity(getPackageManager()) == null) {
            // Package visibility can hide the system installer from resolution on
            // Android 11+. The launch below is the real test; its failure is handled.
            Log.i("YTArkUpdater", "Installer intent did not resolve; trying the system installer directly.");
        }
        try {
            startActivityForResult(installerIntent, REQUEST_PACKAGE_INSTALL);
            installerOpen = true;
            setBusy(false, "Android Installer is open. Review YTArk and confirm the update there. YTArk does not install silently.");
            renderButtons();
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            installerUnavailable(UpdateFailure.INSTALLER_UNAVAILABLE, unavailable.getMessage());
        }
    }

    private void installerUnavailable(UpdateFailure reason, String message) {
        handingOff = false;
        YtarkUpdater.setHandoffInFlight(this, false);
        YtarkUpdater.setUpdaterFailure(this,
                message == null || message.length() == 0 ? reason.message() : message,
                UpdaterFailurePhasePolicy.installerFailurePhase(reason));
        YtarkUpdater.clearInstallerTargetVersionCode(this);
        if (reason == UpdateFailure.VALIDATION_FAILED) {
            // The saved APK no longer passes the checks; discard it instead of retrying forever.
            YtarkUpdater.clearPendingUpdate(this);
            verifiedApk = null;
            release = null;
        }
        refreshScheduleSummary();
        setBusy(false, reason.label() + ": " + (message == null || message.length() == 0
                ? reason.message() : message));
        renderButtons();
        installButton.requestFocus();
    }

    // ---------------------------------------------------------------- other

    private void skipThisVersion() {
        if (release == null || checkRunning || downloadRunning) return;
        YtarkUpdater.skipRelease(this, release.tag);
        setStatus("YTArk " + release.displayVersion + " was skipped. Check again to see newer releases.");
        release = null;
        verifiedApk = null;
        releaseNotesText.setText("The skipped release remains available from its official YTArk release page.");
        renderButtons();
        checkButton.requestFocus();
    }

    private void openReleasePage() {
        String url = UpdateGuards.OFFICIAL_RELEASES_URL;
        try {
            if (release != null) url = UpdateGuards.officialReleasePage(release.tag);
        } catch (java.io.IOException ignored) {
            // Keep the generic releases page when no clean release tag is known.
        }
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        try {
            startActivity(view);
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            setStatus("No browser is available on this TV. Open this page on a phone: " + url);
        }
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
        String nextText = !YtarkUpdater.automaticChecksEnabled(this) ? "Next automatic check: disabled"
                : next <= System.currentTimeMillis()
                ? "Next automatic check: eligible now (Android may defer it)"
                : "Next automatic check: " + formatter.format(new Date(next)) + " (Android may defer it)";
        String checkMode = "Automatic checks: " + (YtarkUpdater.automaticChecksEnabled(this) ? "On" : "Off");
        String downloadMode = "Automatic downloads: " + (YtarkUpdater.automaticDownloadsEnabled(this) ? "On" : "Off");
        String state = "Updater state: " + stateLabel(YtarkUpdater.updaterState(this));
        String outcome = YtarkUpdater.lastCheckStatus(this);
        String error = YtarkUpdater.updaterError(this);
        String phase = YtarkUpdater.updaterErrorPhase(this);
        String phaseText = YtarkUpdater.STATE_FAILED.equals(YtarkUpdater.updaterState(this))
                && phase != null ? "Failure phase: " + UpdaterFailurePhasePolicy.label(phase) : "";
        scheduleText.setText(checkMode + "\n" + downloadMode + "\n" + lastText + "\n" + nextText
                + "\n" + state
                + (outcome.length() == 0 ? "" : "\n" + outcome)
                + (phaseText.length() == 0 ? "" : "\n" + phaseText)
                + (error.length() == 0 ? "" : "\n" + error));
    }

    private static String stateLabel(String state) {
        if (YtarkUpdater.STATE_CHECKING.equals(state)) return "Checking";
        if (YtarkUpdater.STATE_AVAILABLE.equals(state)) return "Update available";
        if (YtarkUpdater.STATE_UP_TO_DATE.equals(state)) return "Up to date";
        if (YtarkUpdater.STATE_DOWNLOADING.equals(state)) return "Downloading";
        if (YtarkUpdater.STATE_VALIDATING.equals(state)) return "Validating";
        if (YtarkUpdater.STATE_PERMISSION_NEEDED.equals(state)) return "Permission needed";
        if (YtarkUpdater.STATE_READY_TO_INSTALL.equals(state)) return "Ready to install";
        if (YtarkUpdater.STATE_INSTALLING.equals(state)) return "Waiting for Android confirmation (not installed yet)";
        if (YtarkUpdater.STATE_INSTALL_CANCELLED.equals(state)) return "Installer cancelled; update remains ready";
        if (YtarkUpdater.STATE_CANCELLED.equals(state)) return "Cancelled";
        if (YtarkUpdater.STATE_FAILED.equals(state)) return "Failed";
        return "Idle";
    }

    private void refreshBackgroundDownload() {
        if (isFinishing()) return;
        String state = YtarkUpdater.updaterState(this);
        long downloaded = YtarkUpdater.downloadBytes(this);
        long total = YtarkUpdater.downloadTotalBytes(this);
        boolean active = YtarkUpdater.isDownloadInProgress();
        if (active && !downloadRunning) {
            ReleaseInfo selected = YtarkUpdater.activeDownloadRelease();
            if (selected != null) {
                release = selected;
                releaseNotesText.setText(selected.notes);
            }
            downloadRunning = true;
            checkRunning = false;
            progressBar.setVisibility(View.VISIBLE);
            renderButtons();
        }
        if (YtarkUpdater.hasVerifiedPending(this)) {
            downloadRunning = false;
            monitoringAutomaticWork = false;
            progressHandler.removeCallbacks(progressRefresh);
            loadAndVerifyPendingUpdate();
            return;
        }
        if (downloadRunning && !active
                && (YtarkUpdater.STATE_FAILED.equals(state) || YtarkUpdater.STATE_CANCELLED.equals(state))) {
            downloadRunning = false;
            if (!monitoringAutomaticWork) progressHandler.removeCallbacks(progressRefresh);
            progressBar.setVisibility(View.GONE);
            String message = YtarkUpdater.updaterError(this);
            showDownloadError(UpdateFailure.DOWNLOAD_FAILED,
                    message.length() == 0 ? UpdateFailure.DOWNLOAD_FAILED.message() : message);
            if (!monitoringAutomaticWork) return;
        } else if (YtarkUpdater.STATE_VALIDATING.equals(state)) {
            progressBar.setVisibility(View.VISIBLE);
            showVerifying();
        } else if (downloadRunning && release != null && YtarkUpdater.STATE_DOWNLOADING.equals(state)) {
            progressBar.setVisibility(View.VISIBLE);
            showProgress(release, downloaded, total);
        } else if (monitoringAutomaticWork && YtarkUpdater.STATE_CHECKING.equals(state)) {
            progressBar.setIndeterminate(true);
            progressBar.setVisibility(View.VISIBLE);
            setStatus("Checking the official YTArk stable release in the background…");
        }
        refreshScheduleSummary();
        if (monitoringAutomaticWork || downloadRunning) {
            progressHandler.postDelayed(progressRefresh, 1000L);
        }
    }

    private void setBusy(boolean busy, String message) {
        setStatus(message);
        progressBar.setIndeterminate(busy);
        progressBar.setVisibility(busy || downloadRunning ? View.VISIBLE : View.GONE);
        checkButton.setEnabled(!busy);
    }

    private void setStatus(String message) {
        if (statusText != null) statusText.setText(message);
    }
}
