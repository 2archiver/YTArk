package io.github.twoarchiver.ytark.updater;

/** Pure scheduling/backoff regression tests; runs on a host JRE. */
public final class UpdateSchedulePolicyTest {
    public static void main(String[] args) {
        firstAutomaticCheckIsEligibleAndSuccessUsesSixHourCadence();
        failureUsesBoundedRetryRatherThanRapidStartupLoops();
        rateLimitDeadlineTakesPrecedence();
        interruptedLegacyAttemptRemainsThrottled();
        parsesRetryAfterAndGitHubRateLimitReset();
        System.out.println("UpdateSchedulePolicy tests passed (5 groups).");
    }

    private static void firstAutomaticCheckIsEligibleAndSuccessUsesSixHourCadence() {
        assertTrue(due(0L, 0L, 0L, 0L, 0L, 0L, 10_000L), "first check is due");
        long success = 20_000L;
        assertFalse(due(success, success, success, 0L, 0L, 0L,
                success + UpdateSchedulePolicy.CHECK_INTERVAL_MILLIS - 1L), "hourly cadence before deadline");
        assertTrue(due(success, success, success, 0L, 0L, 0L,
                success + UpdateSchedulePolicy.CHECK_INTERVAL_MILLIS), "check due at six hours");
        assertEquals(success + UpdateSchedulePolicy.CHECK_INTERVAL_MILLIS,
                next(success, success, success, 0L, 0L, 0L, success), "next eligible time");
    }

    private static void failureUsesBoundedRetryRatherThanRapidStartupLoops() {
        long failedAt = 100_000L;
        long retryAt = failedAt + UpdateSchedulePolicy.RETRY_INTERVAL_MILLIS;
        assertFalse(due(failedAt, failedAt, 10L, failedAt, retryAt, 0L, retryAt - 1L),
                "recent failure waits for retry deadline");
        assertTrue(due(failedAt, failedAt, 10L, failedAt, retryAt, 0L, retryAt),
                "failed check becomes eligible at retry deadline");
        assertEquals(retryAt, next(failedAt, failedAt, 10L, failedAt, retryAt, 0L, failedAt),
                "failure retry time");
    }

    private static void rateLimitDeadlineTakesPrecedence() {
        long now = 100_000L;
        long retryAt = 200_000L;
        long rateLimitAt = 250_000L;
        assertFalse(due(now, now, 1L, now, retryAt, rateLimitAt, rateLimitAt - 1L),
                "rate-limit cooldown is enforced");
        assertTrue(due(now, now, 1L, now, retryAt, rateLimitAt, rateLimitAt),
                "check eligible when rate limit expires");
        assertEquals(rateLimitAt, next(now, now, 1L, now, retryAt, rateLimitAt, now),
                "rate-limit time wins");
    }

    private static void interruptedLegacyAttemptRemainsThrottled() {
        long attempt = 500_000L;
        assertFalse(due(attempt, attempt, 0L, 0L, 0L, 0L,
                attempt + UpdateSchedulePolicy.RETRY_INTERVAL_MILLIS - 1L),
                "interrupted attempt waits before retry");
        assertTrue(due(attempt, attempt, 0L, 0L, 0L, 0L,
                attempt + UpdateSchedulePolicy.RETRY_INTERVAL_MILLIS),
                "interrupted attempt retries when due");
    }

    private static void parsesRetryAfterAndGitHubRateLimitReset() {
        long now = 1_000_000L;
        assertEquals(now + 90_000L,
                UpdateSchedulePolicy.retryDeadlineMillis("90", null, now),
                "delta-seconds Retry-After");
        assertEquals(2_500_000L,
                UpdateSchedulePolicy.retryDeadlineMillis(null, "2500", now),
                "X-RateLimit-Reset epoch seconds");
        assertEquals(10_000L,
                UpdateSchedulePolicy.retryDeadlineMillis("Thu, 01 Jan 1970 00:00:10 GMT", null, 1_000L),
                "HTTP-date Retry-After");
        assertEquals(now,
                UpdateSchedulePolicy.retryDeadlineMillis("not a date", "invalid", now),
                "invalid rate-limit headers are ignored without an immediate loop");
    }

    private static boolean due(long lastCheck, long lastAttempt, long lastSuccess,
                               long lastFailure, long retryAfter, long rateLimit, long now) {
        return UpdateSchedulePolicy.isAutomaticCheckDue(lastCheck, lastAttempt, lastSuccess,
                lastFailure, retryAfter, rateLimit, now);
    }

    private static long next(long lastCheck, long lastAttempt, long lastSuccess,
                             long lastFailure, long retryAfter, long rateLimit, long now) {
        return UpdateSchedulePolicy.nextEligibleAtMillis(lastCheck, lastAttempt, lastSuccess,
                lastFailure, retryAfter, rateLimit, now);
    }

    private static void assertTrue(boolean condition, String description) {
        if (!condition) throw new AssertionError(description);
    }

    private static void assertFalse(boolean condition, String description) {
        if (condition) throw new AssertionError(description);
    }

    private static void assertEquals(long expected, long actual, String description) {
        if (expected != actual) throw new AssertionError(description + ": expected " + expected + ", got " + actual);
    }
}
