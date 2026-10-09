package io.github.twoarchiver.ytark.updater;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles explicit notification actions and PackageInstaller results. */
public final class UpdateActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (YtarkUpdater.ACTION_LATER.equals(action)) {
            YtarkUpdater.snooze(context, intent.getStringExtra("release_tag"));
        } else if (YtarkUpdater.ACTION_INSTALL_RESULT.equals(action)) {
            YtarkUpdater.handleInstallerResult(context, intent);
        }
    }
}
