package io.github.twoarchiver.ytark.updater;

/** Small color palette shared by the native Updates and Storage activities. */
final class NativeThemePolicy {
    private NativeThemePolicy() { }

    static int background(String theme) {
        return isOled(theme) ? 0xff000000 : 0xff0f1218;
    }

    static int card(String theme) {
        return isOled(theme) ? 0xff0d0d0d : 0xff1d232d;
    }

    static int divider(String theme) {
        return isOled(theme) ? 0xff292929 : 0xff353e4c;
    }

    static int primaryText(String theme) {
        return 0xffffffff;
    }

    static int secondaryText(String theme) {
        return isOled(theme) ? 0xffb3b3b3 : 0xffb8c2d0;
    }

    static int bodyText(String theme) {
        return isOled(theme) ? 0xffdddddd : 0xffdae1eb;
    }

    static int quietText(String theme) {
        return isOled(theme) ? 0xff929292 : 0xff949fb1;
    }

    private static boolean isOled(String theme) {
        return NativeRoutePolicy.THEME_OLED.equals(theme);
    }
}
