package io.github.twoarchiver.ytark.updater;

import java.util.Arrays;
import java.util.Collections;

/**
 * Platform-appropriate install-capability classification.
 *
 * The modern per-source prerequisites (target API 26+, declared
 * REQUEST_INSTALL_PACKAGES) are properties of the Android 8+ route. On the
 * supported legacy platforms (API 24–25) the authorization is one global
 * setting that consults neither packaging property, so the modern rule must
 * not classify — and must never disable — the legacy flow.
 */
public final class InstallCapabilityPolicyTest {
    public static void main(String[] args) {
        legacyPlatformsIgnoreModernPrerequisites();
        modernPlatformsKeepThePackagingRules();
        unsupportedPlatformsReportNoCapability();
        explanationsMatchThePlatformRoute();
        launchOutcomesClassifyRealAttemptsOnly();
        System.out.println("InstallCapabilityPolicy tests passed (5 groups).");
    }

    private static void legacyPlatformsIgnoreModernPrerequisites() {
        for (int api : new int[] { 24, 25 }) {
            assertTrue(InstallCapabilityPolicy.canHoldAuthorization(api, 36, true),
                    "a modern build can always use the legacy global setting");
            assertTrue(InstallCapabilityPolicy.canHoldAuthorization(api, null, null),
                    "legacy capability does not depend on packaging facts at all");
            assertTrue(InstallCapabilityPolicy.canHoldAuthorization(api, 22, false),
                    "modern per-source prerequisites must not disable the legacy flow");
            assertEquals(InstallCapabilityPolicy.STATE_NOT_AUTHORIZED,
                    InstallCapabilityPolicy.state(api, 22, false, false),
                    "a legacy denial is 'not authorized', never a packaging state");
            assertEquals(InstallCapabilityPolicy.STATE_GRANTED,
                    InstallCapabilityPolicy.state(api, 36, true, true),
                    "a legacy grant is reported as granted");
            assertEquals(InstallCapabilityPolicy.STATE_UNREADABLE,
                    InstallCapabilityPolicy.state(api, 36, true, null),
                    "an unreadable legacy setting stays unreadable");
        }
    }

    private static void modernPlatformsKeepThePackagingRules() {
        assertEquals(InstallCapabilityPolicy.STATE_TARGET_TOO_OLD,
                InstallCapabilityPolicy.state(26, 25, true, false),
                "target below 26 is refused by the per-source route");
        assertEquals(InstallCapabilityPolicy.STATE_PERMISSION_NOT_DECLARED,
                InstallCapabilityPolicy.state(34, 36, false, false),
                "a missing declaration is named as such");
        assertEquals(InstallCapabilityPolicy.STATE_GRANTED,
                InstallCapabilityPolicy.state(34, 36, true, true),
                "modern grant");
        assertFalse(InstallCapabilityPolicy.canHoldAuthorization(34, 25, true),
                "modern rule: target below 26 cannot hold the authorization");
        assertFalse(InstallCapabilityPolicy.canHoldAuthorization(34, 36, false),
                "modern rule: an undeclared permission cannot hold the authorization");
        // The historical two-argument form keeps modern semantics for callers
        // that have no platform reading.
        assertEquals(InstallCapabilityPolicy.state(25, true, false),
                InstallCapabilityPolicy.STATE_TARGET_TOO_OLD,
                "the legacy overload classifies the *target SDK*, not the device");
    }

    private static void unsupportedPlatformsReportNoCapability() {
        assertFalse(InstallCapabilityPolicy.canHoldAuthorization(23, 36, true),
                "below the supported range there is no route to hold anything");
        assertEquals(InstallCapabilityPolicy.STATE_UNREADABLE,
                InstallCapabilityPolicy.state(23, 36, true, true),
                "an unsupported platform never reports a confident state");
    }

    private static void explanationsMatchThePlatformRoute() {
        String legacy = InstallCapabilityPolicy.explanation(
                InstallCapabilityPolicy.STATE_NOT_AUTHORIZED, 25);
        String modern = InstallCapabilityPolicy.explanation(
                InstallCapabilityPolicy.STATE_NOT_AUTHORIZED, 34);
        assertTrue(legacy.contains("global"),
                "the legacy explanation names the one global setting");
        assertFalse(legacy.contains("per-package system value"),
                "the legacy explanation never describes the per-app switch");
        assertTrue(modern.contains("per-package system value"),
                "the modern explanation describes the per-app switch");
        assertEquals(InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_GRANTED),
                InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_GRANTED, 24),
                "a granted explanation is the same on every platform");
        assertTrue(InstallCapabilityPolicy.explanation(
                        InstallCapabilityPolicy.STATE_UNREADABLE, 25).contains("Allow installs"),
                "the unreadable state keeps the bounded retry guidance");
    }

    private static void launchOutcomesClassifyRealAttemptsOnly() {
        assertNull(InstallPermissionEntryPolicy.openOutcome(
                        Collections.singletonList(InstallPermissionEntryPolicy.LAUNCH_OK)),
                "a launched screen reports no failure");
        assertEquals(InstallPermissionEntryPolicy.OUTCOME_BLOCKED,
                InstallPermissionEntryPolicy.openOutcome(Arrays.asList(
                        InstallPermissionEntryPolicy.LAUNCH_NOT_FOUND,
                        InstallPermissionEntryPolicy.LAUNCH_BLOCKED)),
                "a platform refusal dominates a not-found attempt");
        assertEquals(InstallPermissionEntryPolicy.OUTCOME_UNAVAILABLE,
                InstallPermissionEntryPolicy.openOutcome(Collections.singletonList(
                        InstallPermissionEntryPolicy.LAUNCH_NOT_FOUND)),
                "nothing found to launch is 'unavailable'");
        assertEquals(InstallPermissionEntryPolicy.OUTCOME_UNAVAILABLE,
                InstallPermissionEntryPolicy.openOutcome(Collections.emptyList()),
                "no route at all is 'unavailable'");
        assertEquals(InstallPermissionEntryPolicy.OUTCOME_UNAVAILABLE,
                InstallPermissionEntryPolicy.openOutcome(null),
                "a missing attempt list is 'unavailable'");
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertFalse(boolean value, String message) {
        if (value) throw new AssertionError(message);
    }

    private static void assertNull(Object value, String message) {
        if (value != null) throw new AssertionError(message + ": expected null but was " + value);
    }

    private static void assertEquals(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + " but was " + actual);
        }
    }
}
