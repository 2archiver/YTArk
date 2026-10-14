package io.github.twoarchiver.ytark.updater;

/** Host-JRE contract tests for the narrow custom-screen URI policy. */
public final class NativeRoutePolicyTest {
    public static void main(String[] args) {
        acceptsOnlyTheTwoOwnedScreens();
        acceptsOnlyTheTwoOptionalThemeValues();
        rejectsArbitraryRoutesAndUriParts();
        System.out.println("NativeRoutePolicy tests passed (3 groups).");
    }

    private static void acceptsOnlyTheTwoOwnedScreens() {
        assertTrue(NativeRoutePolicy.isAllowedScreenRoute("ytark://updates", "updates"),
                "Updates route opens only the Updates activity");
        assertTrue(NativeRoutePolicy.isAllowedScreenRoute("ytark://storage", "storage"),
                "Storage route opens only the Storage activity");
        assertTrue(NativeRoutePolicy.isAllowedScreenRoute("YTARK://UPDATES", "updates"),
                "scheme and host are case-insensitive");
        assertFalse(NativeRoutePolicy.isAllowedScreenRoute("ytark://storage", "updates"),
                "a route cannot target a different activity");
        assertFalse(NativeRoutePolicy.isAllowedScreenRoute("ytark://settings", "settings"),
                "no other YTArk screen is accepted");
    }

    private static void acceptsOnlyTheTwoOptionalThemeValues() {
        assertTrue(NativeRoutePolicy.isAllowedScreenRoute("ytark://updates?theme=oled", "updates"),
                "OLED Updates route");
        assertTrue(NativeRoutePolicy.isAllowedScreenRoute("ytark://storage?theme=youtube", "storage"),
                "YouTube Storage route");
        assertEquals(NativeRoutePolicy.THEME_OLED,
                NativeRoutePolicy.themeForRoute("ytark://updates?theme=oled"), "OLED query value");
        assertEquals(NativeRoutePolicy.THEME_YOUTUBE,
                NativeRoutePolicy.themeForRoute("ytark://storage?theme=youtube"), "YouTube query value");
        assertEquals(null, NativeRoutePolicy.themeForRoute("ytark://storage"), "no theme override");
        assertFalse(NativeRoutePolicy.isAllowedScreenRoute("ytark://updates?theme=system", "updates"),
                "unknown themes are rejected");
        assertFalse(NativeRoutePolicy.isAllowedScreenRoute("ytark://updates?theme=oled&action=install", "updates"),
                "extra query commands are rejected");
    }

    private static void rejectsArbitraryRoutesAndUriParts() {
        String[] refused = {
            "ytark://settings",
            "ytark://updates/install",
            "ytark://updates?intent=clearData",
            "ytark://updates?theme=oled#install",
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
