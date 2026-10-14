/**
 * CSS for YTArk appearance features, scoped to root classes on <html>.
 *
 * All feature rules are static and scoped to a root class, so turning a
 * feature on or off flips one class instead of rewriting inline styles.
 * Nothing here targets <video>, images, thumbnails, channel art, SVG,
 * subtitles/captions or the player container: the scrim rule only clears the
 * control-overlay shadow elements, and the watermark rule only hides the
 * channel-logo overlay element YTArk marks.
 *
 * Selector provenance
 *   - `.ytLrWatchDefaultShadow`, `.ytLrWatchDefault2025Shadow` and the
 *     `[idomkey="shadow"]` element: the control-overlay scrim that ui/ui.css
 *     (and the TizenTube / webOS projects it follows) already target.
 *   - `ytlr-watch-default` and the caption/focus selectors below: the player
 *     readability-shadow hosts and the frontend's own focus pills
 *     (`.zylon-focus`, `.ytLrButtonFocused`), proven by classes ui/ui.css
 *     already styles on device.
 *
 * A selector this build does not render matches nothing, so broadening the
 * candidate list is safe.
 */

export const ROOT_CLASSES = Object.freeze({
  noScrim: 'ytark-no-player-scrim',
  hideWatermark: 'ytark-hide-watermark',
});

export const WATERMARK_ATTRIBUTE = 'data-ytark-watermark';

export const SCRIM_SELECTORS = Object.freeze([
  '.ytLrWatchDefaultShadow',
  '.ytLrWatchDefault2025Shadow',
  'ytlr-watch-default [idomkey="shadow"]',
]);

/**
 * Player content that must not inherit the readability shadow: captions keep
 * their own styling, and focused controls (YouTube's white focus pill with dark
 * text: `.zylon-focus`, `.ytLrButtonFocused`) stay crisp.
 */
export const CAPTION_SELECTORS = Object.freeze([
  '.ytp-caption-window-container',
  '.caption-window',
  '.captions-text',
]);
export const FOCUSED_SELECTORS = Object.freeze([
  '.zylon-focus',
  '.ytLrButtonFocused',
]);

function scoped(rootClass, selectors) {
  return selectors.map(selector => `html.${rootClass} ${selector}`).join(',\n');
}

/** Static feature CSS; activates only through the root classes. */
export function buildAppearanceCss() {
  return `/* ytark-appearance v3 */
${scoped(ROOT_CLASSES.noScrim, SCRIM_SELECTORS)} {
  background-image: none !important;
  background-color: transparent !important;
}
html.${ROOT_CLASSES.noScrim} ytlr-watch-default {
  text-shadow: 0 0 0.25rem rgba(0, 0, 0, 0.85), 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.9);
}
${scoped(ROOT_CLASSES.noScrim, CAPTION_SELECTORS.concat(FOCUSED_SELECTORS).map(selector => `ytlr-watch-default ${selector}`))} {
  text-shadow: none;
}
html.${ROOT_CLASSES.hideWatermark} [${WATERMARK_ATTRIBUTE}="hidden"] {
  display: none !important;
}`;
}

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.% ,+-]+\)|black|white|transparent|red|blue|gray|grey|navy)$/i;

export function colorValue(value, fallback) {
  const candidate = String(value || '').trim();
  return SAFE_COLOR.test(candidate) ? candidate : fallback;
}

/** CSS for the user's saved custom colours (independent of the feature classes). */
export function buildCustomColorCss(focusColor, routeColor) {
  const focus = colorValue(focusColor, '#0f0f0f');
  const route = colorValue(routeColor, '#0f0f0f');
  return [
    `ytlr-guide-response yt-focus-container { background-color: ${focus}; }`,
    `#container { background-color: ${route} !important; }`,
  ].join('\n');
}
