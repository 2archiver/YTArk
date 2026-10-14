package io.github.twoarchiver.ytark.updater;

/** Host-JRE contract tests for the narrow custom-screen URI policy. */
public final class NativeRoutePolicyTest {
    public static void main(String[] args) {
        acceptsOnlyTheOwnedScreens();
        rejectsArbitraryRoutesAndUriParts();
        System.out.println("NativeRoutePolicy tests passed (2 groups).");
    }

    private static void acceptsOnlyTheOwnedScreens() {
        assertTrue(NativeRoutePolicy.isAllowedScreenRoute("ytark://updates", "updates"),
                "Updates route opens only the Updates activity");
        assertTrue(NativeRoutePolicy.isAllowedScreenRoute("YTARK://UPDATES", "updates"),
                "scheme and host are case-insensitive");
        assertFalse(NativeRoutePolicy.isAllowedScreenRoute("ytark://settings", "settings"),
                "no other YTArk screen is accepted");
        assertFalse(NativeRoutePolicy.isAllowedScreenRoute("ytark://storage", "storage"),
                "the removed Cache & Storage screen is no longer a route");
    }

    private static void rejectsArbitraryRoutesAndUriParts() {
        String[] refused = {
            "ytark://settings",
            "ytark://storage",
            "ytark://updates/install",
            "ytark://updates?intent=clearData",
            // 3.0 removed the theme override: routes carry no query at all
            "ytark://updates?theme=oled",
            "ytark://updates?theme=youtube",
            "ytark://updates?theme=oled#install",
            "ytark://updates?theme=oled&action=install",
            "ytark://updates:443",
            "ytark://user@updates",
            "https://www.youtube.com/tv",
            "intent://updates#Intent;component=com.android.settings;end",
            "file:///data/data/io.github.twoarchiver.ytark/files/update.apk",
            "ytark://updates?theme=%6fled",
            null,
        };
        for (String route : refused) {
            assertEquals(null, NativeRoutePolicy.screenForRoute(route),
                    "refuse an unowned or malformed URI: " + route);
        }
        assertEquals(null, NativeRoutePolicy.screenForRoute(repeat('a', 513)),
                "overlong routes are rejected");
    }

    private static String repeat(char character, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index++) result.append(character);
        return result.toString();
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertFalse(boolean value, String message) {
        if (value) throw new AssertionError(message);
    }

    private static void assertEquals(Object expected, Object actual, String message) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", received " + actual);
        }
    }
}
