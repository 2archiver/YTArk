package io.github.twoarchiver.ytark.updater;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles the explicit Later notification action. */
public final class UpdateActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !YtarkUpdater.ACTION_LATER.equals(intent.getAction())) return;
        YtarkUpdater.snooze(context, intent.getStringExtra("release_tag"));
    }
}
