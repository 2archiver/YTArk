/**
 * Shared YTArk design tokens.
 *
 * Every surface YTArk draws itself (the settings text-entry panel, the OLED
 * overrides for supported YouTube TV surfaces) reads its colours from here, so
 * the added screens and the stock surfaces agree. Values are literal colours
 * (no CSS custom properties) so the generated stylesheet stays plain.
 *
 * Contrast notes (WCAG relative luminance against #000000):
 *   textPrimary  #ffffff  21:1
 *   textSecondary #b3b3b3 ~10.5:1
 *   textDisabled  ~0.45 white  ~4.6:1 (still distinguishable, clearly dimmer)
 *   accent       #ff0033  YouTube red, kept for selection/brand marks only
 */

export const OLED_TOKENS = Object.freeze({
  background: '#000000',
  // Near-black raised surface, used only where separation is needed.
  surfaceRaised: '#0d0d0d',
  surfaceFocus: '#262626',
  divider: 'rgba(255, 255, 255, 0.14)',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  textDisabled: 'rgba(255, 255, 255, 0.45)',
  accent: '#ff0033',
  focusRing: '#ffffff',
  focusText: '#0f0f0f',
  error: '#ff8a80',
  backdrop: 'rgba(0, 0, 0, 0.72)',
});

/** YouTube TV's default dark look, used by YTArk's own panels outside OLED. */
export const YOUTUBE_TOKENS = Object.freeze({
  background: '#0f0f0f',
  surfaceRaised: '#212121',
  surfaceFocus: '#3d3d3d',
  divider: 'rgba(255, 255, 255, 0.16)',
  textPrimary: '#f1f1f1',
  textSecondary: '#aaaaaa',
  textDisabled: 'rgba(255, 255, 255, 0.45)',
  accent: '#ff0033',
  focusRing: '#f1f1f1',
  focusText: '#0f0f0f',
  error: '#ff8a80',
  backdrop: 'rgba(0, 0, 0, 0.6)',
});

export function tokensFor(theme) {
  return theme === 'oled' ? OLED_TOKENS : YOUTUBE_TOKENS;
}
