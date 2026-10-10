package io.github.twoarchiver.ytark.updater;

/** Executable unit tests; no Android runtime or third-party test framework required. */
public final class UpdateVersionTest {
    public static void main(String[] args) {
        newer("2.1.0", "2.0.4-ytark.17");
        newer("2.10.0", "2.9.99");
        newer("2.1.1", "2.1.0");
        newer("2.0.4", "2.0.4-ytark.17");
        newer("v2.0.3-ytark.16", "2.0.3-ytark.15");
        newer("v2.0.3-ytark.10", "2.0.3-ytark.9");
        equal("2.1.0", "v2.1.0");
        older("2.0.3-ytark.14", "2.0.3-ytark.15");
        older("2.0.99", "2.1.0");
        newer("2.0.3", "2.0.3-ytark.15");
        System.out.println("UpdateVersion tests passed (10 cases).");
    }

    private static void newer(String candidate, String installed) {
        if (UpdateVersion.compare(candidate, installed) <= 0) {
            throw new AssertionError(candidate + " should be newer than " + installed);
        }
    }

    private static void older(String candidate, String installed) {
        if (UpdateVersion.compare(candidate, installed) >= 0) {
            throw new AssertionError(candidate + " should be older than " + installed);
        }
    }

    private static void equal(String left, String right) {
        if (UpdateVersion.compare(left, right) != 0) {
            throw new AssertionError(left + " should equal " + right);
        }
    }
}
