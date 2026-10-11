/**
 * CSS for YTArk appearance features, generated from the shared tokens.
 *
 * All feature rules are static and scoped to a root class on <html>, so
 * turning a feature on or off flips one class instead of rewriting inline
 * styles. Nothing here targets <video>, images, thumbnails, channel art, SVG,
 * subtitles/captions or the player container: OLED only recolours verified
 * background surfaces, and the scrim rule only clears the control-overlay
 * shadow elements.
 *
 * Selector provenance
 *   - `.ytLrTvBrowseRendererHost`, `.ytLrGuideResponseContainer`,
 *     `.ytLrGuideResponseCollapsed`, `.ytLrClassicSearchPageHost`,
 *     `.ytLrAccountSelectorHost`, `.ytLrTvSurfaceContentRendererContent-
 *     HasOffsetInlineSearchBar`, `.ytLrAnimatedOverlaySidesheet
 *     .ytLrAnimatedOverlayContainer`: used by independent themes that run the
 *     real YouTube TV frontend (VacuumTube "BlackDecker" AMOLED userstyle,
 *     decktube themes).
 *   - `#container` and `ytlr-guide-response yt-focus-container`: the existing
 *     YTArk custom-colour rules (ui/theme.js) already style these.
 *   - `.ytLrWatchDefaultShadow`, `.ytLrWatchDefault2025Shadow` and the
 *     `[idomkey="shadow"]` element: the control-overlay scrim that ui/ui.css
 *     (and the TizenTube / webOS projects it follows) already target.
 *   - `ytlr-overlay-panel-renderer`: inferred from the verified renderer to
 *     element naming of the TV frontend (overlayPanelHeaderRenderer ->
 *     `.ytLrOverlayPanelHeaderRenderer*` in ui.css).
 */

import { OLED_TOKENS, YOUTUBE_TOKENS } from './themeTokens.js';

export const ROOT_CLASSES = Object.freeze({
  oled: 'ytark-theme-oled',
  noScrim: 'ytark-no-player-scrim',
  hideWatermark: 'ytark-hide-watermark',
});

export const WATERMARK_ATTRIBUTE = 'data-ytark-watermark';

export const OLED_SURFACE_SELECTORS = Object.freeze([
  '#container',
  '.ytLrTvBrowseRendererHost',
  '.ytLrGuideResponseContainer',
  '.ytLrGuideResponseCollapsed .ytLrGuideResponseContainer',
  '.ytLrClassicSearchPageHost',
  '.ytLrAccountSelectorHost',
  '.ytLrTvSurfaceContentRendererContentHasOffsetInlineSearchBar',
  'ytlr-guide-response yt-focus-container',
]);

export const OLED_DIALOG_SELECTORS = Object.freeze([
  '.ytLrAnimatedOverlaySidesheet .ytLrAnimatedOverlayContainer',
  'ytlr-overlay-panel-renderer',
]);

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

function entryPanelCss(rootPrefix, tokens) {
  const p = rootPrefix ? `${rootPrefix} ` : '';
  return `
${p}.ytark-entry {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  z-index: 2147483000;
  display: flex; align-items: center; justify-content: center;
  background-color: ${tokens.backdrop};
  color: ${tokens.textPrimary};
  font-family: "YouTube Noto", Roboto, Arial, sans-serif;
}
${p}.ytark-entry__panel {
  width: 56rem; max-width: 90%;
  padding: 2rem 2.5rem;
  border-radius: 1.25rem;
  background-color: ${tokens.surfaceRaised};
  box-shadow: 0 0 0 0.0625rem ${tokens.divider};
}
${p}.ytark-entry__title { font-size: 1.75rem; font-weight: 500; margin: 0 0 1rem 0; }
${p}.ytark-entry__input {
  box-sizing: border-box; width: 100%;
  font-size: 1.75rem; line-height: 2.5rem;
  padding: 0.5rem 1rem;
  color: ${tokens.textPrimary};
  background-color: ${tokens.background};
  border: 0.125rem solid ${tokens.divider};
  border-radius: 0.75rem;
  outline: none;
}
${p}.ytark-entry__input:focus { border-color: ${tokens.focusRing}; box-shadow: 0 0.1875rem 0 0 ${tokens.accent}; }
${p}.ytark-entry__status { min-height: 2rem; margin: 0.75rem 0; font-size: 1.25rem; color: ${tokens.textSecondary}; }
${p}.ytark-entry__keys { display: flex; flex-wrap: wrap; gap: 0.5rem; }
${p}.ytark-entry__key {
  min-width: 4.25rem; height: 3.25rem; padding: 0 0.75rem;
  font-size: 1.375rem; font-family: inherit;
  color: ${tokens.textPrimary};
  background-color: ${tokens.background};
  border: 0.0625rem solid ${tokens.divider};
  border-radius: 0.625rem;
}
${p}.ytark-entry__key--wide { min-width: 9rem; }
${p}.ytark-entry__key:focus, ${p}.ytark-entry__key.ytark-entry__key--focused {
  outline: 0.1875rem solid ${tokens.focusRing}; outline-offset: 0.125rem;
  background-color: ${tokens.focusRing}; color: ${tokens.focusText};
}
${p}.ytark-entry__hint { margin-top: 1rem; font-size: 1.125rem; color: ${tokens.textSecondary}; }
`;
}

/** Static feature CSS; activates only through the root classes. */
export function buildAppearanceCss(oled = OLED_TOKENS, youtube = YOUTUBE_TOKENS) {
  return `/* ytark-appearance v1 */
${scoped(ROOT_CLASSES.oled, OLED_SURFACE_SELECTORS)} {
  background-color: ${oled.background} !important;
}
${scoped(ROOT_CLASSES.oled, OLED_DIALOG_SELECTORS)} {
  background-color: ${oled.background} !important;
}
html.${ROOT_CLASSES.oled} .ytLrAnimatedOverlaySidesheet .ytLrAnimatedOverlayContainer {
  box-shadow: inset 0.0625rem 0 0 ${oled.divider} !important;
}
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
}
${entryPanelCss('', youtube)}
${entryPanelCss(`html.${ROOT_CLASSES.oled}`, oled)}`;
}

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.% ,+-]+\)|black|white|transparent|red|blue|gray|grey|navy)$/i;

export function colorValue(value, fallback) {
  const candidate = String(value || '').trim();
  return SAFE_COLOR.test(candidate) ? candidate : fallback;
}

/** The user's saved custom colours (kept while OLED Black overrides them). */
export function buildCustomColorCss(focusColor, routeColor) {
  const focus = colorValue(focusColor, '#0f0f0f');
  const route = colorValue(routeColor, '#0f0f0f');
  return [
    `ytlr-guide-response yt-focus-container { background-color: ${focus}; }`,
    `#container { background-color: ${route} !important; }`,
  ].join('\n');
}
