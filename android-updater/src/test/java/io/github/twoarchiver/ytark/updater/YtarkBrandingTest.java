package io.github.twoarchiver.ytark.updater;

/** Exact visible product labels and version presentation; host JRE only. */
public final class YtarkBrandingTest {
    public static void main(String[] args) {
        equals("YTArk", YtarkBranding.APP_NAME, "launcher/application label");
        equals("YTArk Settings", YtarkBranding.SETTINGS_TITLE, "settings screen title");
        equals("About YTArk", YtarkBranding.ABOUT_TITLE, "about screen title");
        equals("YTArk Updates", YtarkBranding.UPDATES_TITLE, "update screen title");
        equals("2.1", YtarkBranding.displayVersion("2.1.0"), "public display version");
        equals("2.1.3", YtarkBranding.displayVersion("2.1.3"), "nonzero patch display");
        equals("2.0.4", YtarkBranding.displayVersion("2.0.4-ytark.17"),
                "legacy installed version presentation");
        equals("YTArk 2.1", YtarkBranding.releaseLabel("2.1.0"), "installed version label");
        System.out.println("YtarkBranding tests passed (8 assertions).");
    }

    private static void equals(String expected, String actual, String description) {
        if (!expected.equals(actual)) {
            throw new AssertionError(description + ": expected " + expected + ", got " + actual);
        }
    }
}
