package io.github.twoarchiver.ytark.updater;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.TimeZone;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Deterministic updater recovery tests. No live GitHub calls. */
public final class UpdateReliabilityTest {
    private static final String HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String OTHER = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    public static void main(String[] args) throws Exception {
        parsesRateLimitResponsesAndRefusesTightLoops();
        formatsRetryTime();
        cachePlanSkipsNetworkAndManualBypassesFreshness();
        repositoryDedupesDiscoveryAgainstAFakeSource();
        concurrentChecksJoinOneFlight();
        versionOrderingIsNumeric();
        assetSelectionRejectsMissingAmbiguousEmptyAndForeignApks();
        redirectsAndPartialDownloadsUseTheLocalServer();
        errorMappingNeverUsesTheGenericFallbacks();
        stateMachineAndPermissionAndInstallerStatuses();
        backoffIsBoundedAndCancellable();
        System.out.println("UpdateReliability tests passed (11 groups).");
    }

    private static void parsesRateLimitResponsesAndRefusesTightLoops() {
        long now = 1_000_000L;
        assertTrue(RateLimitPolicy.isLimited(429, null, null, null, "too many requests"), "429 is a rate limit");
        assertTrue(RateLimitPolicy.isLimited(403, "0", null, null, ""), "remaining 0 is a rate limit");
        assertTrue(RateLimitPolicy.isLimited(403, null, null, null, "You have exceeded a secondary rate limit."), "secondary limit body");
        assertTrue(RateLimitPolicy.isLimited(403, null, "30", null, ""), "Retry-After marks a limit");
        assertFalse(RateLimitPolicy.isLimited(404, "0", null, null, "too many requests"), "404 is not a rate limit");
        assertFalse(RateLimitPolicy.isLimited(403, "10", null, null, "Resource not accessible"), "unrelated 403");
        long withHeader = RateLimitPolicy.retryAtMillis(429, "90", null, null, "too many requests", now);
        assertEquals(now + 90_000L, withHeader, "Retry-After seconds");
        long reset = RateLimitPolicy.retryAtMillis(403, null, "2500", "0", "", 1_000L);
        assertEquals(2_500_000L, reset, "X-RateLimit-Reset");
        long missing = RateLimitPolicy.retryAtMillis(403, null, null, null, "API rate limit exceeded. too many requests", now);
        assertTrue(missing >= now + 15 * 60_000L, "missing headers wait at least 15 minutes");
        assertTrue(missing - now >= 60_000L, "no tight retry");
        long tiny = RateLimitPolicy.retryAtMillis(429, "1", null, null, "", now);
        assertTrue(tiny >= now + 60_000L, "one-second Retry-After is floored");
    }

    private static void formatsRetryTime() {
        String message = RateLimitPolicy.message(90_000L, 0L, UTC);
        assertTrue(message.startsWith("GitHub rate limit reached — try again after 00:01"), message);
        assertTrue(message.contains("in 2 min"), message);
        assertFalse(message.contains("Failed safely"), "rate-limit text is specific");
    }

    private static void cachePlanSkipsNetworkAndManualBypassesFreshness() {
        long now = 10 * ScheduleRules.HOUR;
        assertEquals("blocked", ReleaseCachePolicy.plan(true, 1, now, now, "v3.2.0", true, now + 1000), "manual respects rate window");
        assertEquals("cache", ReleaseCachePolicy.plan(false, 1, now, now - 1000, "v3.2.0", true, 0), "fresh automatic cache");
        assertEquals("api", ReleaseCachePolicy.plan(true, 1, now, now - 1000, "v3.2.0", true, 0), "manual bypasses freshness");
        assertEquals("probe", ReleaseCachePolicy.plan(false, 1, now, now - 2 * ScheduleRules.HOUR, "v3.2.0", true, 0), "stale automatic probe");
        assertEquals("api", ReleaseCachePolicy.plan(false, 1, now, 0, "", false, 0), "no cache uses the API");
        assertEquals("skip", ReleaseCachePolicy.plan(false, 0, now, 0, "", false, 0), "Never does not poll");
    }

    private static void repositoryDedupesDiscoveryAgainstAFakeSource() throws Exception {
        long now = 5_000_000L;
        CachedRelease cache = cache(now - 1000, "v3.2.0", 3020000L);
        FakeSource quiet = new FakeSource();
        Discovery cached = new UpdateRepository(quiet).discover(false, 1, now, 0L, cache);
        assertTrue(cached instanceof Discovery.UseCache, "fresh cache does not call the network");
        assertEquals(0, quiet.probes + quiet.metas + quiet.texts, "no fake calls");

        FakeSource blocked = new FakeSource();
        Discovery limited = new UpdateRepository(blocked).discover(true, 1, now, now + 60_000L, cache);
        assertTrue(limited instanceof Discovery.RateLimited, "manual check stays inside the rate window");
        assertEquals(0, blocked.metas, "rate window does not hit the API");

        FakeSource api = new FakeSource();
        api.document = new MetadataDocument(200, releaseJson("3.3.0", 3030000L, HASH, 1200, false), "etag-new", "Mon, 01 Jan 2024 00:00:00 GMT");
        api.sums = HASH + "  YTArk-v3.3.0-armv7.apk\n";
        Discovery fresh = new UpdateRepository(api).discover(true, 1, now, 0L, cache);
        assertTrue(fresh instanceof Discovery.Fresh, "manual check reads the API");
        assertEquals(1, api.metas, "one metadata read");
        assertEquals("v3.3.0", ((Discovery.Fresh) fresh).candidate.getTag(), "parsed tag");

        FakeSource same = new FakeSource();
        same.tag = "v3.2.0";
        Discovery probed = new UpdateRepository(same).discover(false, 1, now + 2 * ScheduleRules.HOUR, 0L, cache);
        assertTrue(probed instanceof Discovery.UseCache, "matching latest tag skips the API");
        assertEquals(1, same.probes, "one redirect probe");
        assertEquals(0, same.metas, "probe hit does not call the API");
    }

    private static void concurrentChecksJoinOneFlight() throws Exception {
        CheckDeduper gate = new CheckDeduper();
        assertEquals("started", gate.begin(false), "first check starts");
        CountDownLatch ready = new CountDownLatch(1);
        AtomicInteger joined = new AtomicInteger();
        Thread other = new Thread(() -> {
            ready.countDown();
            if ("joined".equals(gate.begin(true))) joined.incrementAndGet();
        });
        other.start();
        ready.await();
        other.join(2000);
        assertEquals(1, joined.get(), "second check joins the in-flight one");
        assertTrue(gate.finish(), "joined manual check is run once more");
        assertFalse(gate.finish(), "the gate then clears");
        assertFalse(gate.running(), "not left running");
        AttemptGate attempts = new AttemptGate();
        int first = attempts.next();
        int second = attempts.next();
        assertTrue(attempts.accept(second), "current attempt is accepted");
        assertFalse(attempts.accept(first), "stale callback is rejected");
    }

    private static void versionOrderingIsNumeric() throws Exception {
        assertTrue(UpdateVersion.compare("3.1.0", "3.2.0") < 0, "3.1 before 3.2");
        assertTrue(UpdateVersion.compare("3.2.0", "3.3.0") < 0, "3.2 before 3.3");
        assertEquals(0, UpdateVersion.compare("v3.3.0", "3.3.0"), "tag prefix does not change order");
        assertTrue(UpdateReleaseContract.expectedVersionCodeForVersion("3.3.0") > UpdateReleaseContract.expectedVersionCodeForVersion("3.2.0"), "versionCode is monotonic");
        assertEquals(3030000L, UpdateReleaseContract.expectedVersionCodeForVersion("3.3.0"), "3.3.0 code");
    }

    private static void assetSelectionRejectsMissingAmbiguousEmptyAndForeignApks() throws Exception {
        ParsedRelease ok = ReleaseMetadataParser.parse(releaseJson("3.3.0", 3030000L, HASH, 1200, true), HASH + "  YTArk-v3.3.0-armv7.apk\n");
        assertEquals("YTArk-v3.3.0-armv7.apk", ok.candidate.getAsset(), "selects the ARMv7 asset");
        assertEquals(HASH, ok.candidate.getSha256(), "checksum cross-check");
        assertFalse(ok.needsSums, "sums already applied");
        rejects(() -> ReleaseMetadataParser.parse(releaseJson("3.3.0", 3030000L, HASH, 0, false), null), "empty");
        rejects(() -> ReleaseMetadataParser.parse(releaseJson("3.3.0", 3030000L, HASH, 10, false).replace("YTArk-v3.3.0-armv7.apk", "YTArk-v3.3.0-arm64.apk"), null), "No compatible APK found");
        String doubled = releaseJson("3.3.0", 3030000L, HASH, 10, false).replace("\"assets\":[", "\"assets\":[{\"name\":\"YTArk-v3.3.0-armv7.apk\",\"browser_download_url\":\"https://github.com/2archiver/YTArk/releases/download/v3.3.0/YTArk-v3.3.0-armv7.apk\",\"size\":10,\"digest\":\"sha256:" + HASH + "\"},");
        rejects(() -> ReleaseMetadataParser.parse(doubled, null), "more than one");
        rejects(() -> ReleaseMetadataParser.parse(releaseJson("3.3.0", 3030000L, HASH, 10, false).replace("\"prerelease\": false", "\"prerelease\": true"), null), "published stable");
        rejects(() -> ReleaseMetadataParser.parse(releaseJson("3.3.0", 3010000L, HASH, 10, false), null), "versionCode");
        rejects(() -> ReleaseMetadataParser.parse(releaseJson("3.3.0", 3030000L, OTHER, 10, true), HASH + "  YTArk-v3.3.0-armv7.apk\n"), "disagree");
    }

    private static void redirectsAndPartialDownloadsUseTheLocalServer() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/start", exchange -> {
            exchange.getResponseHeaders().add("Location", "http://127.0.0.1:" + server.getAddress().getPort() + "/file");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/file", exchange -> {
            byte[] body = "apk-bytes".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream out = exchange.getResponseBody()) { out.write(body); }
        });
        server.createContext("/limited", exchange -> {
            exchange.getResponseHeaders().add("Retry-After", "90");
            byte[] body = "{\"message\":\"too many requests\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(403, body.length);
            try (OutputStream out = exchange.getResponseBody()) { out.write(body); }
        });
        server.createContext("/partial", exchange -> {
            exchange.sendResponseHeaders(200, -1);
            try (OutputStream out = exchange.getResponseBody()) { out.write(new byte[] {1, 2, 3, 4}); }
        });
        server.createContext("/range", exchange -> {
            String range = exchange.getRequestHeaders().getFirst("Range");
            if (!"bytes=4-".equals(range)) {
                exchange.sendResponseHeaders(400, -1);
                exchange.close();
                return;
            }
            exchange.getResponseHeaders().add("Content-Range", "bytes 4-9/10");
            exchange.getResponseHeaders().add("ETag", "\"abc\"");
            byte[] body = new byte[] {5, 6, 7, 8, 9, 10};
            exchange.sendResponseHeaders(206, body.length);
            try (OutputStream out = exchange.getResponseBody()) { out.write(body); }
        });
        server.start();
        try {
            int port = server.getAddress().getPort();
            HttpResult redirected = JdkHttp.exchange("http://127.0.0.1:" + port + "/start", "GET", java.util.Collections.<String, String>emptyMap(), LocalhostGate.INSTANCE, 1024, true);
            assertEquals(200, redirected.status, "redirect followed");
            assertEquals("apk-bytes", redirected.body, "redirect body");
            HttpResult stopped = JdkHttp.exchange("http://127.0.0.1:" + port + "/start", "HEAD", java.util.Collections.<String, String>emptyMap(), LocalhostGate.INSTANCE, 1024, false);
            assertEquals(302, stopped.status, "probe does not follow");
            HttpResult limited = JdkHttp.exchange("http://127.0.0.1:" + port + "/limited", "GET", java.util.Collections.<String, String>emptyMap(), LocalhostGate.INSTANCE, 1024, false);
            assertEquals(403, limited.status, "rate-limit status preserved");
            assertEquals("90", limited.header("retry-after"), "Retry-After preserved");
            assertTrue(limited.body.contains("too many requests"), "body available to the parser");
            java.io.File partial = Files.createTempFile("ytark-part", ".bin").toFile();
            partial.deleteOnExit();
            boolean interrupted = false;
            try {
                JdkHttp.streamTo("http://127.0.0.1:" + port + "/partial", partial, 0, 10, System.nanoTime() + 5_000_000_000L, LocalhostGate.INSTANCE, new CancelHandle(), null, new ProgressSink() {
                    public void onBytes(long count) { }
                });
            } catch (IOException e) {
                interrupted = e.getMessage() != null && (e.getMessage().contains("interrupted") || e.getMessage().contains("disagrees"));
            }
            assertTrue(interrupted, "short body is a download interruption");
            assertTrue(partial.length() < 10, "partial file is not presented as complete");
            java.io.File resumed = Files.createTempFile("ytark-resume", ".bin").toFile();
            resumed.deleteOnExit();
            Files.write(resumed.toPath(), new byte[] {1, 2, 3, 4});
            StreamResult range = JdkHttp.streamTo("http://127.0.0.1:" + port + "/range", resumed, 4, 10, System.nanoTime() + 5_000_000_000L, LocalhostGate.INSTANCE, new CancelHandle(), null, new ProgressSink() {
                public void onBytes(long count) { }
            });
            assertEquals(206, range.status, "resume uses 206");
            assertTrue(DownloadTransferPolicy.mayResume("\"abc\"", range.etag, range.status, range.contentRange, 4, 10), "etag and range match");
            assertEquals(10L, resumed.length(), "resumed file is complete");
            assertFalse(DownloadTransferPolicy.mayResume("", range.etag, 206, range.contentRange, 4, 10), "missing etag restarts");
            assertTrue(DownloadTransferPolicy.restartInstead(200, 4), "a full 200 does not append");
        } finally {
            server.stop(0);
        }
    }

    private static void errorMappingNeverUsesTheGenericFallbacks() {
        long now = 50_000L;
        assertMapped(new java.net.SocketTimeoutException("timed out"), "timeout", "Connection timed out");
        assertMapped(new IOException("No compatible APK found. Release v9 has no ARMv7 package."), "no_compatible_apk", "No compatible APK found");
        assertMapped(new IOException("Not enough storage. Free space and retry."), "storage", "Not enough storage");
        assertMapped(new IOException("Download interrupted. Retry to continue the download."), "download_interrupted", "Download interrupted");
        assertMapped(new IOException("APK checksum failed; retry download."), "verification", "APK verification failed");
        assertMapped(new IOException("APK signer is incompatible with the installed app."), "signature_mismatch", "App signature mismatch");
        assertMapped(new IOException("Install permission required."), "permission", "Install permission required");
        assertMapped(new IOException("Installation cancelled."), "install_cancelled", "Installation cancelled");
        MappedError unexpected = UpdateErrorMapper.map(new IllegalStateException("https://secret.example/token=abc"), "check", now, "v3.3.0");
        assertEquals("unexpected", unexpected.category, "unknown category");
        assertFalse(unexpected.message.contains("Failed safely"), unexpected.message);
        assertFalse(unexpected.message.equals("Download failed"), unexpected.message);
        String sanitized = UpdateTexts.sanitize("https://secret.example/token=abc");
        assertFalse(sanitized.contains("token=abc"), sanitized);
        assertFalse(sanitized.contains("https://"), sanitized);
        assertTrue(sanitized.contains("[redacted]"), sanitized);
        HttpFailure limited = new HttpFailure(403, now + 90_000L, RateLimitPolicy.message(now + 90_000L, now, UTC), "rate_limit");
        MappedError mapped = UpdateErrorMapper.map(limited, "check", now, "v3.2.0");
        assertTrue(mapped.message.startsWith("GitHub rate limit reached"), mapped.message);
        assertEquals(403, mapped.httpStatus, "status retained");
    }

    private static void stateMachineAndPermissionAndInstallerStatuses() {
        assertTrue(UpdateFlowMachine.allow("Idle", "Checking"), "check from idle");
        assertTrue(UpdateFlowMachine.allow("Downloading", "Verifying"), "download verifies");
        assertTrue(UpdateFlowMachine.allow("HandedToSystem", "Completed"), "installer confirmation");
        assertFalse(UpdateFlowMachine.allow("Failed", "Completed"), "failure is not success");
        assertFalse(UpdateFlowMachine.allow("Downloading", "Completed"), "a partial download is not installed");
        assertEquals("continue", PermissionReturn.action(true, true, false, false), "granted permission continues once");
        assertEquals("deny", PermissionReturn.action(true, false, false, false), "denial explains instead of looping");
        assertEquals("ignore", PermissionReturn.action(true, true, true, false), "in-flight permission is not repeated");
        assertEquals("ignore", PermissionReturn.action(false, true, false, false), "permission is bound to the candidate");
        assertEquals("cancelled", InstallerStatusPolicy.kind(InstallerStatusPolicy.FAILURE_ABORTED, null), "abort is cancellation");
        assertEquals("signature", InstallerStatusPolicy.kind(InstallerStatusPolicy.FAILURE_CONFLICT, "signatures do not match"), "conflict with signature text");
        assertEquals("storage", InstallerStatusPolicy.kind(InstallerStatusPolicy.FAILURE_STORAGE, null), "installer storage");
        assertEquals("invalid", InstallerStatusPolicy.kind(InstallerStatusPolicy.FAILURE_INVALID, "parse error"), "malformed apk");
        assertTrue(InstallerStatusPolicy.message("signature").startsWith("App signature mismatch"), "signature message");
        assertTrue(InstallerStatusPolicy.message("cancelled").startsWith("Installation cancelled"), "cancel message");
        UpdateState ready = UpdateStates.ready(new UpdateState(), "/tmp/update.apk");
        assertEquals(UpdatePhase.Ready, ready.getPhase(), "verified apk waits for an explicit install");
        assertEquals(UpdatePhase.Idle, UpdateStates.installed(ready).getPhase(), "confirmed install clears the candidate");
        assertEquals(null, UpdateStates.installed(ready).getCandidate(), "installed state does not keep the APK offer");
    }

    private static void backoffIsBoundedAndCancellable() {
        long now = 1_000L;
        long first = BackoffPolicy.delayMillis(0, now, 0);
        long later = BackoffPolicy.delayMillis(4, now, 0);
        assertTrue(first > now && first - now <= 20_000L, "first backoff is short");
        assertTrue(later > first && later - now <= 15 * 60_000L, "backoff is capped");
        AtomicBoolean cancelled = new AtomicBoolean(true);
        AtomicInteger naps = new AtomicInteger();
        BackoffPolicy.sleep(1_000L, cancelled, new kotlin.jvm.functions.Function1<Long, kotlin.Unit>() {
            public kotlin.Unit invoke(Long slice) { naps.incrementAndGet(); return kotlin.Unit.INSTANCE; }
        });
        assertEquals(0, naps.get(), "cancelled backoff does not sleep");
    }

    private static void assertMapped(Throwable error, String category, String prefix) {
        MappedError mapped = UpdateErrorMapper.map(error, "download", 1L, "v3.3.0");
        assertEquals(category, mapped.category, prefix);
        assertTrue(mapped.message.startsWith(prefix), mapped.message);
        assertFalse(mapped.message.contains("Failed safely"), mapped.message);
        assertFalse(mapped.message.equals("Download failed"), mapped.message);
    }

    private static CachedRelease cache(long fetchedAt, String tag, long code) {
        String version = tag.substring(1);
        return new CachedRelease(fetchedAt, "etag", "modified", tag, code, "YTArk-" + tag + "-armv7.apk",
                "https://github.com/2archiver/YTArk/releases/download/" + tag + "/YTArk-" + tag + "-armv7.apk",
                1000L, HASH, "notes", true);
    }

    private static String releaseJson(String version, long code, String hash, long size, boolean sums) {
        String asset = "{\"name\":\"YTArk-v" + version + "-armv7.apk\",\"browser_download_url\":\"https://github.com/2archiver/YTArk/releases/download/v" + version + "/YTArk-v" + version + "-armv7.apk\",\"size\":" + size + ",\"digest\":\"sha256:" + hash + "\",\"content_type\":\"application/vnd.android.package-archive\"}";
        String sumsAsset = sums ? ",{\"name\":\"SHA256SUMS.txt\",\"browser_download_url\":\"https://github.com/2archiver/YTArk/releases/download/v" + version + "/SHA256SUMS.txt\",\"size\":80,\"digest\":\"\",\"content_type\":\"text/plain\"}" : "";
        return "{\"draft\":false,\"prerelease\":false,\"tag_name\":\"v" + version + "\",\"body\":\"versionCode " + code + "\\nShort notes\",\"assets\":[" + asset + sumsAsset + "]}";
    }

    private static void rejects(Throwing call, String text) throws Exception {
        try {
            call.run();
        } catch (Exception e) {
            if (e.getMessage() == null || !e.getMessage().contains(text)) throw new AssertionError("expected '" + text + "' but was " + e.getMessage());
            return;
        }
        throw new AssertionError("expected failure containing " + text);
    }

    private interface Throwing { void run() throws Exception; }

    private static final class FakeSource implements MetadataSource {
        int probes;
        int metas;
        int texts;
        String tag = "v3.3.0";
        String sums = "";
        MetadataDocument document = new MetadataDocument(200, "{}", "", "");
        public String probeLatestTag() { probes++; return tag; }
        public MetadataDocument metadata(String etag, String lastModified) { metas++; return document; }
        public String text(String url) { texts++; return sums; }
    }

    private static void assertTrue(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void assertFalse(boolean value, String message) { if (value) throw new AssertionError(message); }
    private static void assertEquals(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
    private static void assertEquals(long expected, long actual, String message) {
        if (expected != actual) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
    private static void assertEquals(int expected, int actual, String message) { assertEquals((long) expected, (long) actual, message); }
}
