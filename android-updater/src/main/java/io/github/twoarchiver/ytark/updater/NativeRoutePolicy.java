package io.github.twoarchiver.ytark.updater;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Strict, Android-free contract for the screen-only YTArk deep links. */
final class NativeRoutePolicy {
    private static final Set<String> SCREENS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "updates")));

    private NativeRoutePolicy() { }

    /** Screen-only route accepted by the exported Android deep-link activities. */
    static String screenForRoute(String rawUrl) {
        URI uri = parseRoute(rawUrl);
        if (uri == null) return null;
        String screen = uri.getHost().toLowerCase(Locale.US);
        return SCREENS.contains(screen) ? screen : null;
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
            if (!uri.isAbsolute() || scheme == null || !"ytark".equalsIgnoreCase(scheme)
                    || host == null || uri.getUserInfo() != null || uri.getPort() != -1
                    || (path != null && path.length() != 0)
                    || uri.getRawQuery() != null || uri.getFragment() != null) return null;
            String screen = host.toLowerCase(Locale.US);
            return SCREENS.contains(screen) ? uri : null;
        } catch (URISyntaxException invalid) {
            return null;
        }
    }
}
