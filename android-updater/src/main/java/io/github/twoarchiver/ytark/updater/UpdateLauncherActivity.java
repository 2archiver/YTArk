package io.github.twoarchiver.ytark.updater;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

/** Public TV-launcher entry that forwards only to YTArk's private updater screen. */
public final class UpdateLauncherActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            Intent openUpdater = new Intent(this, UpdateActivity.class);
            openUpdater.setAction(Intent.ACTION_MAIN);
            startActivity(openUpdater);
        } catch (RuntimeException unavailable) {
            Toast.makeText(this,
                    "YTArk Updates could not be opened. Reopen it from the TV apps row.",
                    Toast.LENGTH_LONG).show();
        } finally {
            finish();
        }
    }
}
