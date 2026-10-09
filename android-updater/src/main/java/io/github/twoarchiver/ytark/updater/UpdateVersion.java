package io.github.twoarchiver.ytark.updater;

import java.math.BigInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A small SemVer-style comparator for YTArk release tags and installed version names. */
public final class UpdateVersion {
    private static final Pattern VERSION = Pattern.compile(
            "^[vV]?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?(?:\\+[0-9A-Za-z.-]+)?$");

    private final BigInteger major;
    private final BigInteger minor;
    private final BigInteger patch;
    private final String[] prerelease;

    private UpdateVersion(BigInteger major, BigInteger minor, BigInteger patch, String[] prerelease) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
        this.prerelease = prerelease;
    }

    public static int compare(String left, String right) {
        UpdateVersion a = parse(left);
        UpdateVersion b = parse(right);
        int result = a.major.compareTo(b.major);
        if (result != 0) return result;
        result = a.minor.compareTo(b.minor);
        if (result != 0) return result;
        result = a.patch.compareTo(b.patch);
        if (result != 0) return result;

        // A version without a suffix has stable-release precedence over a
        // pre-release suffix, as defined by SemVer.
        if (a.prerelease == null && b.prerelease == null) return 0;
        if (a.prerelease == null) return 1;
        if (b.prerelease == null) return -1;

        int common = Math.min(a.prerelease.length, b.prerelease.length);
        for (int i = 0; i < common; i++) {
            result = compareIdentifier(a.prerelease[i], b.prerelease[i]);
            if (result != 0) return result;
        }
        return Integer.compare(a.prerelease.length, b.prerelease.length);
    }

    private static UpdateVersion parse(String text) {
        if (text == null) throw new IllegalArgumentException("Version is missing");
        Matcher matcher = VERSION.matcher(text.trim());
        if (!matcher.matches()) throw new IllegalArgumentException("Invalid version: " + text);

        String[] suffix = matcher.group(4) == null ? null : matcher.group(4).split("\\.", -1);
        if (suffix != null) {
            for (String identifier : suffix) {
                if (identifier.length() == 0) {
                    throw new IllegalArgumentException("Invalid version suffix: " + text);
                }
            }
        }
        return new UpdateVersion(
                new BigInteger(matcher.group(1)),
                new BigInteger(matcher.group(2)),
                new BigInteger(matcher.group(3)),
                suffix);
    }

    private static int compareIdentifier(String left, String right) {
        boolean leftNumeric = isNumeric(left);
        boolean rightNumeric = isNumeric(right);
        if (leftNumeric && rightNumeric) {
            return new BigInteger(left).compareTo(new BigInteger(right));
        }
        if (leftNumeric) return -1;
        if (rightNumeric) return 1;
        return left.compareToIgnoreCase(right);
    }

    private static boolean isNumeric(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) < '0' || value.charAt(i) > '9') return false;
        }
        return value.length() > 0;
    }
}
