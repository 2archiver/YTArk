package io.github.twoarchiver.ytark.updater;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Shared, exact product labels for native and web settings surfaces. */
final class YtarkBranding {
    static final String APP_NAME = "YTArk";
    static final String SETTINGS_TITLE = "YTArk Settings";
    static final String ABOUT_TITLE = "About YTArk";
    static final String UPDATES_TITLE = "YTArk Updates";

    private static final Pattern CLEAN = Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)$");
    private static final Pattern LEGACY = Pattern.compile(
            "^(\\d+\\.\\d+\\.\\d+)-ytark\\.[1-9]\\d*$");

    private YtarkBranding() { }

    static String displayVersion(String version) {
        if (version == null || version.trim().length() == 0) return "unknown";
        String value = version.trim();
        Matcher legacy = LEGACY.matcher(value);
        if (legacy.matches()) return legacy.group(1);
        Matcher clean = CLEAN.matcher(value);
        if (!clean.matches()) return value;
        return "0".equals(clean.group(3))
                ? clean.group(1) + "." + clean.group(2)
                : value;
    }

    static String releaseLabel(String version) {
        return APP_NAME + " " + displayVersion(version);
    }
}
