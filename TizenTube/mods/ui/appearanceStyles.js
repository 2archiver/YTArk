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
  oled: 'ytark-oled-black',
  glass: 'ytark-liquid-glass',
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
  'yt-button-container.zylon-focus',
  'ytlr-button.zylon-focus',
  '.ytLrButtonFocused',
]);

function scoped(rootClass, selectors) {
  return selectors.map(selector => `html.${rootClass} ${selector}`).join(',\n');
}

// Solid TV surfaces only. Never paint watch/player hosts or use universal
// descendant rules: transparent transport controls must leave the video visible.
export const OLED_SURFACES = Object.freeze([
  'body', '#container', '#app-background', 'body.WEB_PAGE_TYPE_BROWSE ytlr-tv-browse-renderer', 'body.WEB_PAGE_TYPE_BROWSE ytlr-tv-surface-content-renderer',
  'ytlr-guide-response', 'ytlr-classic-search-page', 'ytlr-account-selector', 'yt-overlay-toast-renderer', 'ytlr-browse', 'ytlr-search', 'ytlr-settings',
  '.ytLrGuide', '.ytLrGuideRenderer', '.ytLrGuideContent',
  '.ytLrBrowse', '.ytLrSearch', '.ytLrSettings',
  '.ytLrTvBrowseRendererHost', '.ytLrGuideResponseContainer',
  '.ytLrClassicSearchPageHost', '.ytLrAccountSelectorHost',
  '.ytLrOverlayPanelRendererContent', '.ytLrOverlayTwoPanelRendererActionPanel',
  'ytlr-overlay-panel-renderer',
  '.ytLrOverlayPanelRenderer', '.ytLrOverlayPanelHeaderRenderer',
  '.ytLrDialogRenderer', '.ytLrAccountPicker', '.ytLrOverlayToastRenderer',
]);

export function buildOledCss() {
  return `html.${ROOT_CLASSES.oled} {
  background-color: rgb(0, 0, 0) !important;
  --yt-spec-base-background: #000;
  --yt-spec-raised-background: #000;
  --yt-spec-menu-background: #000;
  --yt-spec-brand-background-primary: #000;
  --yt-spec-brand-background-secondary: #000;
}
${scoped(ROOT_CLASSES.oled, OLED_SURFACES)} {
  background-color: rgb(0, 0, 0) !important;
  background-image: none !important;
}
/* Keep YouTube's high-contrast focus pill, including focused panel rows. */
${scoped(ROOT_CLASSES.oled, FOCUSED_SELECTORS)} {
  background-color: rgb(241, 241, 241) !important;
  color: rgb(15, 15, 15) !important;
  text-shadow: none;
}`;
}

// Limit glass to solid menu/toast surfaces, never the fullscreen video layer.
export const GLASS_SURFACES = Object.freeze([
  '.ytLrOverlayPanelRenderer', 'ytlr-overlay-panel-renderer', '.ytLrDialogRenderer', '.ytLrOverlayToastRenderer',
  'ytlr-guide-response', 'ytlr-search-bar ytlr-text-box', 'yt-overlay-toast-renderer',
]);
export function buildGlassCss() {
  const panels = scoped(ROOT_CLASSES.glass, GLASS_SURFACES);
  return `${panels} {
  background-color: rgba(20, 24, 32, 0.96) !important;
  background-image: linear-gradient(135deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.01)) !important;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 1rem;
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.3);
}
${scoped(ROOT_CLASSES.glass, ['.ytLrOverlayPanelHeaderRenderer', '.ytLrOverlayPanelRendererContent'])} {
  background-color: transparent !important;
  background-image: none !important;
}
${scoped(ROOT_CLASSES.glass, FOCUSED_SELECTORS)} {
  background-color: rgb(241, 241, 241) !important;
  background-image: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(225, 232, 244, 0.86)) !important;
  color: rgb(15, 15, 15) !important;
  border-radius: 0.75rem;
}
@supports (backdrop-filter: blur(8px)) {
  ${panels} {
    background-color: rgba(20, 24, 32, 0.86) !important;
    backdrop-filter: blur(8px);
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-reduced-motion: reduce) {
  ${panels} {
    background-color: rgb(20, 24, 32) !important;
    backdrop-filter: none;
  }
}`;
}

/** Static feature CSS; activates only through the root classes. */
export function buildAppearanceCss() {
  return `/* ytark-appearance v4 */
${buildOledCss()}
${buildGlassCss()}
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
