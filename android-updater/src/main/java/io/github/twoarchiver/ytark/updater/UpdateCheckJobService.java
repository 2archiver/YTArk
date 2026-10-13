package io.github.twoarchiver.ytark.updater;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.util.concurrent.atomic.AtomicBoolean;

/** Persistent, network-constrained hourly stable-release work; never a polling service. */
public final class UpdateCheckJobService extends JobService {
    private final AtomicBoolean finished = new AtomicBoolean(true);
    private JobParameters activeParameters;

    @Override
    public boolean onStartJob(JobParameters parameters) {
        activeParameters = parameters;
        finished.set(false);
        YtarkUpdater.runAutomaticUpdate(this, retry -> {
            if (finished.compareAndSet(false, true)) {
                jobFinished(parameters, retry);
            }
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters parameters) {
        finished.set(true);
        YtarkUpdater.cancelAutomaticRun(this);
        if (activeParameters == parameters) activeParameters = null;
        // Preserve a resumable partial transfer and ask JobScheduler to resume
        // this persisted periodic job when its constraints permit it again.
        return true;
    }
}
