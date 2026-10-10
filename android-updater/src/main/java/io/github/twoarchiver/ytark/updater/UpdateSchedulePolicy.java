package io.github.twoarchiver.ytark.updater;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Pure, persisted-state scheduling rules for best-effort background update checks. */
final class UpdateSchedulePolicy {
    static final long CHECK_INTERVAL_MILLIS = 6L * 60L * 60L * 1000L;
    static final long RETRY_INTERVAL_MILLIS = 60L * 60L * 1000L;

    private UpdateSchedulePolicy() { }

    static boolean isAutomaticCheckDue(long lastCheck, long lastAttempt, long lastSuccess,
                                       long lastFailure, long retryAfter, long rateLimitUntil,
                                       long now) {
        return now >= nextEligibleAtMillis(lastCheck, lastAttempt, lastSuccess, lastFailure,
                retryAfter, rateLimitUntil, now);
    }

    static long nextEligibleAtMillis(long lastCheck, long lastAttempt, long lastSuccess,
                                     long lastFailure, long retryAfter, long rateLimitUntil,
                                     long now) {
        long cadenceAt;
        if (lastAttempt > lastSuccess && lastAttempt > 0L) {
            cadenceAt = safeAdd(lastAttempt, RETRY_INTERVAL_MILLIS);
        } else if (lastFailure > lastSuccess && lastFailure > 0L) {
            cadenceAt = safeAdd(lastFailure, RETRY_INTERVAL_MILLIS);
        } else if (lastSuccess > 0L) {
            cadenceAt = safeAdd(lastSuccess, CHECK_INTERVAL_MILLIS);
        } else if (lastAttempt > 0L) {
            cadenceAt = safeAdd(lastAttempt, RETRY_INTERVAL_MILLIS);
        } else if (lastCheck > 0L) {
            cadenceAt = safeAdd(lastCheck, RETRY_INTERVAL_MILLIS);
        } else {
            cadenceAt = now;
        }
        return Math.max(now, Math.max(cadenceAt, Math.max(retryAfter, rateLimitUntil)));
    }

    /** Parse GitHub Retry-After (delta seconds or HTTP date) and X-RateLimit-Reset. */
    static long retryDeadlineMillis(String retryAfter, String rateLimitReset, long now) {
        long retryDeadline = parseRetryAfter(retryAfter, now);
        long resetDeadline = parseEpochSeconds(rateLimitReset);
        return Math.max(now, Math.max(retryDeadline, resetDeadline));
    }

    private static long parseRetryAfter(String value, long now) {
        if (value == null) return 0L;
        String trimmed = value.trim();
        if (trimmed.length() == 0) return 0L;
        try {
            long seconds = Long.parseLong(trimmed);
            if (seconds <= 0L) return 0L;
            return seconds > (Long.MAX_VALUE - now) / 1000L
                    ? Long.MAX_VALUE : now + seconds * 1000L;
        } catch (NumberFormatException notDeltaSeconds) {
            SimpleDateFormat format = new SimpleDateFormat(
                    "EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("GMT"));
            format.setLenient(false);
            try {
                Date date = format.parse(trimmed);
                return date == null ? 0L : date.getTime();
            } catch (ParseException invalidDate) {
                return 0L;
            }
        }
    }

    private static long parseEpochSeconds(String value) {
        if (value == null) return 0L;
        try {
            long seconds = Long.parseLong(value.trim());
            if (seconds <= 0L || seconds > Long.MAX_VALUE / 1000L) return 0L;
            return seconds * 1000L;
        } catch (NumberFormatException invalid) {
            return 0L;
        }
    }

    private static long safeAdd(long value, long delta) {
        return value > Long.MAX_VALUE - delta ? Long.MAX_VALUE : value + delta;
    }
}
