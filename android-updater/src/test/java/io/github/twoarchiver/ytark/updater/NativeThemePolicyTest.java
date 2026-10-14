package io.github.twoarchiver.ytark.updater;

/**
 * Host-JRE checks for the fixed native Updates palette: every colour must be
 * fully opaque, cards and dividers distinguishable from the background, and
 * all text readable on both (quiet text at about 3:1).
 */
public final class NativeThemePolicyTest {
    public static void main(String[] args) {
        // Every surface and text colour is fully opaque, so a lighter system
        // window behind the activity can never show through.
        int[] colours = {
            NativeThemePolicy.background(), NativeThemePolicy.card(),
            NativeThemePolicy.divider(), NativeThemePolicy.primaryText(),
            NativeThemePolicy.secondaryText(), NativeThemePolicy.bodyText(),
            NativeThemePolicy.quietText(),
        };
        for (int colour : colours) {
            assertEquals(0xff, (colour >>> 24) & 0xff, "every native theme colour is opaque");
        }
        assertTrue(NativeThemePolicy.card() != NativeThemePolicy.background(),
                "cards are distinguishable from the background");
        assertTrue(NativeThemePolicy.divider() != NativeThemePolicy.background(),
                "dividers are distinguishable from the background");
        for (int text : new int[] {
                NativeThemePolicy.primaryText(), NativeThemePolicy.secondaryText(),
                NativeThemePolicy.bodyText(), NativeThemePolicy.quietText()}) {
            assertTrue(luminance(text) > luminance(NativeThemePolicy.background()),
                    "text is lighter than the background it is drawn on");
            assertTrue(luminance(text) > luminance(NativeThemePolicy.card()),
                    "text is lighter than the card it is drawn on");
        }
        // The quietest text still has to be readable on the card: a rough
        // contrast ratio floor of 3:1, the level widely used for large text.
        double ratio = contrastRatio(NativeThemePolicy.quietText(), NativeThemePolicy.card());
        assertTrue(ratio >= 3.0, "quiet text keeps about 3:1 contrast on a card (was " + ratio + ")");
        assertTrue(contrastRatio(NativeThemePolicy.onFocus(), NativeThemePolicy.focus()) >= 7.0,
                "focused rows keep high contrast");
        assertTrue(contrastRatio(NativeThemePolicy.disabledText(), NativeThemePolicy.disabledSurface()) >= 4.5,
                "disabled labels remain readable");
        assertTrue(NativeThemePolicy.disabledSurface() != NativeThemePolicy.card(),
                "disabled controls are visually distinct");
        System.out.println("NativeThemePolicy tests passed (fixed palette, opacity and contrast).");
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
