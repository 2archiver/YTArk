package io.github.twoarchiver.ytark.updater;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Hop-by-hop HTTPS redirect policy for official release metadata and assets. */
final class UpdateRedirectPolicy {
    private static final Set<String> DOWNLOAD_HOSTS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "github.com",
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
            "github-releases.githubusercontent.com")));
    private static final Pattern OFFICIAL_ASSET_PATH = Pattern.compile(
            "/2archiver/YTArk/releases/download/v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)/"
                    + "(?:YTArk-v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-armv7\\.apk|SHA256SUMS\\.txt)");
    private static final String RELEASE_API_HOST = "api.github.com";
    private static final String RELEASE_API_PATH = "/repos/2archiver/YTArk/releases/latest";

    private UpdateRedirectPolicy() { }

    static boolean isTrustedReleaseApiUrl(String address) {
        URI uri = parse(address);
        return uri != null && isSecureHttpUri(uri)
                && RELEASE_API_HOST.equalsIgnoreCase(uri.getHost())
                && RELEASE_API_PATH.equals(uri.getPath())
                && uri.getQuery() == null;
    }

    static boolean isTrustedReleaseAssetUrl(String address) {
        URI uri = parse(address);
        return uri != null && isSecureHttpUri(uri)
                && "github.com".equalsIgnoreCase(uri.getHost())
                && OFFICIAL_ASSET_PATH.matcher(uri.getPath() == null ? "" : uri.getPath()).matches()
                && uri.getFragment() == null;
    }

    /**
     * Validate the next location before opening it. The initial GitHub release
     * path is checked before redirects are followed; each subsequent hop must
     * remain HTTPS and on GitHub's exact release host set. A redirect back to
     * github.com must retain the original immutable asset path.
     */
    static boolean isAllowedRedirect(String initialAddress, String targetAddress, boolean releaseApi) {
        if (releaseApi) return isTrustedReleaseApiUrl(initialAddress)
                && isTrustedReleaseApiUrl(targetAddress);
        if (!isTrustedReleaseAssetUrl(initialAddress)) return false;
        URI target = parse(targetAddress);
        if (target == null || !isSecureHttpUri(target) || target.getFragment() != null) return false;
        String host = target.getHost().toLowerCase(Locale.US);
        if (!DOWNLOAD_HOSTS.contains(host)) return false;
        return !"github.com".equals(host)
                || parse(initialAddress).getPath().equals(target.getPath());
    }

    static boolean isRedirectStatus(int status) {
        return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
    }

    private static boolean isSecureHttpUri(URI uri) {
        return uri.isAbsolute()
                && "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private static URI parse(String address) {
        if (address == null || address.length() == 0 || address.length() > 8192) return null;
        try {
            return new URI(address);
        } catch (URISyntaxException invalid) {
            return null;
        }
    }
}
