package io.github.twoarchiver.ytark.updater;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Strict, Android-free contract for the two screen-only YTArk deep links. */
final class NativeRoutePolicy {
    static final String THEME_OLED = "oled";
    static final String THEME_YOUTUBE = "youtube";

    private static final Set<String> SCREENS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "updates", "storage")));

    private NativeRoutePolicy() { }

    /** Screen-only route accepted by the exported Android deep-link activities. */
    static String screenForRoute(String rawUrl) {
        URI uri = parseRoute(rawUrl);
        if (uri == null) return null;
        String screen = uri.getHost().toLowerCase(Locale.US);
        return SCREENS.contains(screen) ? screen : null;
    }

    /** Null means the route intentionally carries no theme override. */
    static String themeForRoute(String rawUrl) {
        URI uri = parseRoute(rawUrl);
        if (uri == null || uri.getRawQuery() == null) return null;
        String query = uri.getRawQuery();
        if ("theme=oled".equals(query)) return THEME_OLED;
        if ("theme=youtube".equals(query)) return THEME_YOUTUBE;
        return null;
    }

    static boolean isAllowedScreenRoute(String rawUrl, String expectedScreen) {
        return expectedScreen != null && expectedScreen.equals(screenForRoute(rawUrl));
    }

    private static URI parseRoute(String rawUrl) {
        if (rawUrl == null || rawUrl.length() == 0 || rawUrl.length() > 512) return null;
        try {
            URI uri = new URI(rawUrl);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            String path = uri.getPath();
            String query = uri.getRawQuery();
            boolean validQuery = query == null || "theme=oled".equals(query)
                    || "theme=youtube".equals(query);
            if (!uri.isAbsolute() || scheme == null || !"ytark".equalsIgnoreCase(scheme)
                    || host == null || uri.getUserInfo() != null || uri.getPort() != -1
                    || (path != null && path.length() != 0) || !validQuery
                    || uri.getFragment() != null) return null;
            String screen = host.toLowerCase(Locale.US);
            return SCREENS.contains(screen) ? uri : null;
        } catch (URISyntaxException invalid) {
            return null;
        }
    }
}
