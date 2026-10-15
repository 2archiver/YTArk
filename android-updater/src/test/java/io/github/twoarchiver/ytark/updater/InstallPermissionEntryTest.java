package io.github.twoarchiver.ytark.updater;

/** Pure state-machine coverage for the Updates-entry unknown-app authorization flow. */
public final class InstallPermissionEntryTest {
    public static void main(String[] args) {
        routesByPlatformApi();
        freshEntryPromptsOnceOnlyWhenMissing();
        denialAndReturnNeverLoop();
        deliberateReentryAndExplicitActionRecover();
        System.out.println("InstallPermissionEntry tests passed (4 groups).");
    }

    private static void routesByPlatformApi() {
        assertEquals(InstallPermissionEntryPolicy.ROUTE_PACKAGE_SOURCE,
                InstallPermissionEntryPolicy.routeForApi(26), "API 26 uses app-specific unknown sources");
        assertEquals(InstallPermissionEntryPolicy.ROUTE_PACKAGE_SOURCE,
                InstallPermissionEntryPolicy.routeForApi(35), "newer APIs use app-specific unknown sources");
        assertEquals(InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS,
                InstallPermissionEntryPolicy.routeForApi(24), "API 24 uses the legacy security route");
        assertEquals(InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS,
                InstallPermissionEntryPolicy.routeForApi(25), "API 25 uses the legacy security route");
        assertEquals(InstallPermissionEntryPolicy.ROUTE_UNSUPPORTED,
                InstallPermissionEntryPolicy.routeForApi(23), "older APIs have no supported route");
    }

    private static void freshEntryPromptsOnceOnlyWhenMissing() {
        assertTrue(InstallPermissionEntryPolicy.shouldRequestOnEntry(true, false, false, false),
                "fresh entry with confirmed-missing permission requests once");
        assertFalse(InstallPermissionEntryPolicy.shouldRequestOnEntry(true, true, false, false),
                "granted permission skips Settings");
        assertFalse(InstallPermissionEntryPolicy.shouldRequestOnEntry(true, null, false, false),
                "an unknown permission state is not treated as missing");
        assertFalse(InstallPermissionEntryPolicy.shouldRequestOnEntry(false, false, false, false),
                "resume/recreation is not a new deliberate entry");
        assertFalse(InstallPermissionEntryPolicy.shouldRequestOnEntry(true, false, true, false),
                "a request already made in this page session is not repeated");
        assertFalse(InstallPermissionEntryPolicy.shouldRequestOnEntry(true, false, false, true),
                "an in-flight route is not launched twice");
    }

    private static void denialAndReturnNeverLoop() {
        assertEquals("denied", InstallPermissionEntryPolicy.returnStatus(true, false),
                "Back/deny updates status without an automatic retry");
        assertEquals("granted", InstallPermissionEntryPolicy.returnStatus(true, true),
                "return re-reads and recognizes a grant");
        assertEquals("ignore", InstallPermissionEntryPolicy.returnStatus(false, false),
                "ordinary resume/repaint is ignored");
        assertFalse(InstallPermissionEntryPolicy.shouldRequestOnEntry(false, false, true, false),
                "returning from permission settings does not count as a new entry");
    }

    private static void deliberateReentryAndExplicitActionRecover() {
        assertTrue(InstallPermissionEntryPolicy.shouldRequestOnEntry(true, false, false, false),
                "leaving and deliberately reopening creates one new entry session");
        assertEquals("granted", InstallPermissionEntryPolicy.returnStatus(true, true),
                "the permission state is re-read on return");
        assertTrue(InstallPermissionEntryPolicy.shouldRequestOnEntry(true, false, false, false),
                "a later deliberate entry detects authorization that was revoked after a prior grant");
        assertTrue(InstallPermissionEntryPolicy.shouldOpenFromAction(false, false),
                "the visible Allow installs action can retry after denial");
        assertFalse(InstallPermissionEntryPolicy.shouldOpenFromAction(true, false),
                "a grant never triggers another settings route");
        assertFalse(InstallPermissionEntryPolicy.shouldOpenFromAction(false, true),
                "the visible action cannot double-launch an in-flight route");
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertFalse(boolean value, String message) {
        if (value) throw new AssertionError(message);
    }

    private static void assertEquals(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + " but was " + actual);
        }
    }
}
