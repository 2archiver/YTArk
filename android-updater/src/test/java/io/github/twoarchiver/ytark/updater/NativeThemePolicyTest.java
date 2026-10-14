package io.github.twoarchiver.ytark.updater;

/**
 * Host-JRE checks for the palette shared by the native Updates and Storage
 * screens: OLED must be true black and visibly different from the normal
 * palette, both themes must stay readable and opaque, and anything that is not
 * one of the two validated route values must fall back to the normal palette
 * instead of being treated as OLED.
 */
public final class NativeThemePolicyTest {
    private static final String OLED = NativeRoutePolicy.THEME_OLED;
    private static final String NORMAL = NativeRoutePolicy.THEME_YOUTUBE;

    public static void main(String[] args) {
        assertEquals(0xff000000, NativeThemePolicy.background(OLED), "OLED paints opaque true black");
        assertTrue(NativeThemePolicy.background(OLED) != NativeThemePolicy.background(NORMAL),
                "the normal theme stays visibly distinct from OLED");
        assertEquals(0xff0f1218, NativeThemePolicy.background(NORMAL), "the normal dark background is unchanged");

        // Only the two validated route values select a palette; a missing,
        // mistyped or differently-cased value must not silently paint black.
        for (String invalid : new String[] {null, "", "OLED", " oled", "oled ", "black", "dark", "youtube "}) {
            assertEquals(NativeThemePolicy.background(NORMAL), NativeThemePolicy.background(invalid),
                    "an unvalidated theme value falls back to the normal palette");
        }
        assertEquals(NativeThemePolicy.background(NORMAL), NativeThemePolicy.background(""),
                "an empty theme keeps the normal palette");

        // Every surface and text colour is fully opaque, so a lighter system
        // window behind the activity can never show through.
        String[] themes = {OLED, NORMAL};
        for (String theme : themes) {
            int[] colours = {
                NativeThemePolicy.background(theme), NativeThemePolicy.card(theme),
                NativeThemePolicy.divider(theme), NativeThemePolicy.primaryText(theme),
                NativeThemePolicy.secondaryText(theme), NativeThemePolicy.bodyText(theme),
                NativeThemePolicy.quietText(theme),
            };
            for (int colour : colours) {
                assertEquals(0xff, (colour >>> 24) & 0xff, "every native theme colour is opaque");
            }
            assertTrue(NativeThemePolicy.card(theme) != NativeThemePolicy.background(theme),
                    "cards are distinguishable from the background");
            assertTrue(NativeThemePolicy.divider(theme) != NativeThemePolicy.background(theme),
                    "dividers are distinguishable from the background");
            for (String name : new String[] {"primaryText", "secondaryText", "bodyText", "quietText"}) {
                int text = textColour(theme, name);
                assertTrue(luminance(text) > luminance(NativeThemePolicy.background(theme)),
                        name + " is lighter than the background it is drawn on");
                assertTrue(luminance(text) > luminance(NativeThemePolicy.card(theme)),
                        name + " is lighter than the card it is drawn on");
            }
            // The quietest text still has to be readable on the card: a rough
            // contrast ratio floor of 3:1, the level widely used for large text.
            double ratio = contrastRatio(NativeThemePolicy.quietText(theme), NativeThemePolicy.card(theme));
            assertTrue(ratio >= 3.0, "quiet text keeps about 3:1 contrast on a card (was " + ratio + ")");
        }

        // OLED darkens the surface and keeps the text legible: black background,
        // not black text on a black card.
        assertTrue(NativeThemePolicy.card(OLED) != 0xff000000, "the OLED card is not pure black");
        assertTrue(luminance(NativeThemePolicy.bodyText(OLED)) > luminance(NativeThemePolicy.card(OLED)),
                "OLED body text stays readable on the card");
        assertTrue(luminance(NativeThemePolicy.quietText(NORMAL)) > luminance(NativeThemePolicy.card(NORMAL)),
                "normal quiet text stays readable on the card");
        System.out.println("NativeThemePolicy tests passed (2 palettes, opacity, contrast and fallback).");
    }

    private static int textColour(String theme, String name) {
        if ("primaryText".equals(name)) return NativeThemePolicy.primaryText(theme);
        if ("secondaryText".equals(name)) return NativeThemePolicy.secondaryText(theme);
        if ("bodyText".equals(name)) return NativeThemePolicy.bodyText(theme);
        return NativeThemePolicy.quietText(theme);
    }

    private static double luminance(int colour) {
        return 0.2126 * channel(colour >>> 16) + 0.7152 * channel(colour >>> 8) + 0.0722 * channel(colour);
    }

    private static double channel(int value) {
        double scaled = (value & 0xff) / 255.0;
        return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    }

    private static double contrastRatio(int first, int second) {
        double a = luminance(first);
        double b = luminance(second);
        double lighter = Math.max(a, b);
        double darker = Math.min(a, b);
        return (lighter + 0.05) / (darker + 0.05);
    }

    private static void assertEquals(int expected, int actual, String message) {
        if (expected != actual) {
            throw new AssertionError(message + " (expected " + Integer.toHexString(expected)
                    + ", got " + Integer.toHexString(actual) + ")");
        }
    }

    private static void assertTrue(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private NativeThemePolicyTest() { }
}
