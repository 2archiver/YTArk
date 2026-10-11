/**
 * YTArk appearance manager.
 *
 * Owns exactly one managed <style data-ytark-managed-theme="true"> element and
 * three root classes on <html>:
 *   - `ytark-theme-oled`       OLED Black theme
 *   - `ytark-no-player-scrim`  "Remove player dimming"
 *   - `ytark-hide-watermark`   "Hide channel watermark" (DOM safety net)
 *
 * The stylesheet holds the user's saved custom colours plus the static,
 * class-scoped feature rules from appearanceStyles.js. Switching a feature
 * flips a class; switching the theme back restores the saved custom colours
 * because they were never overwritten. The Premium wordmark keeps resolving
 * its ink from the live header colour through its own (single) theme
 * observer, which already reacts to class changes on <html>.
 */

import { configRead, configChangeEmitter } from '../config.js';
import { ROOT_CLASSES, buildAppearanceCss, buildCustomColorCss } from './appearanceStyles.js';

const STYLE_ATTRIBUTE = 'data-ytark-managed-theme';
const STYLE_SELECTOR = `style[${STYLE_ATTRIBUTE}="true"]`;
const WATCHED_KEYS = ['uiTheme', 'removePlayerScrim', 'hidePlayerWatermark', 'focusContainerColor', 'routeColor'];
const STATIC_CSS = buildAppearanceCss();

let managedStyle = null;
let rootObserver = null;
let lastWrittenCss = null;

function doc() {
  return typeof document !== 'undefined' ? document : null;
}

function copyNonce(target, d) {
  if (!target || target.nonce) return;
  try {
    const source = d.querySelector && d.querySelector('style[nonce], script[nonce]');
    if (source && source.nonce) target.nonce = source.nonce;
  } catch (_) {
    /* a page without a nonce source needs none */
  }
}

function getManagedStyle(d) {
  if (managedStyle && managedStyle.parentNode && managedStyle.isConnected !== false) return managedStyle;
  let existing = null;
  try {
    existing = d.querySelector(STYLE_SELECTOR);
  } catch (_) {
    existing = null;
  }
  if (existing) {
    managedStyle = existing;
    return managedStyle;
  }
  const parent = d.head || d.documentElement;
  if (!parent || typeof d.createElement !== 'function') return null;
  managedStyle = d.createElement('style');
  managedStyle.setAttribute(STYLE_ATTRIBUTE, 'true');
  copyNonce(managedStyle, d);
  parent.appendChild(managedStyle);
  lastWrittenCss = null;
  return managedStyle;
}

function hasClass(element, name) {
  if (element.classList && typeof element.classList.contains === 'function') return element.classList.contains(name);
  return String(element.getAttribute && element.getAttribute('class') || '').split(/\s+/).includes(name);
}

function setClass(element, name, enabled) {
  if (!element || !element.classList) return false;
  const present = hasClass(element, name);
  if (enabled && !present) {
    element.classList.add(name);
    return true;
  }
  if (!enabled && present) {
    element.classList.remove(name);
    return true;
  }
  return false;
}

/** Desired root classes for the current configuration. */
export function desiredRootClasses() {
  return {
    [ROOT_CLASSES.oled]: configRead('uiTheme') === 'oled',
    [ROOT_CLASSES.noScrim]: configRead('removePlayerScrim') === true,
    [ROOT_CLASSES.hideWatermark]: configRead('hidePlayerWatermark') === true,
  };
}

export function applyRootClasses(d = doc()) {
  const root = d && d.documentElement;
  if (!root) return false;
  let changed = false;
  const desired = desiredRootClasses();
  for (const name of Object.keys(desired)) {
    if (setClass(root, name, desired[name])) changed = true;
  }
  return changed;
}

function watchRoot(d) {
  if (rootObserver || typeof MutationObserver === 'undefined' || !d || !d.documentElement) return;
  // The frontend may rewrite <html class>; restore only our own classes.
  rootObserver = new MutationObserver(() => {
    applyRootClasses(d);
  });
  rootObserver.observe(d.documentElement, { attributes: true, attributeFilter: ['class'] });
}

/** Rebuild the managed stylesheet (only when its text changes) and root classes. */
export function updateStyle() {
  const d = doc();
  if (!d || !d.documentElement) return;
  const style = getManagedStyle(d);
  if (style) {
    copyNonce(style, d);
    const css = `${buildCustomColorCss(configRead('focusContainerColor'), configRead('routeColor'))}\n${STATIC_CSS}`;
    if (css !== lastWrittenCss || style.textContent !== css) {
      style.textContent = css;
      lastWrittenCss = css;
    }
  }
  applyRootClasses(d);
  watchRoot(d);
}

function onConfigChange(event) {
  const key = event && event.detail && event.detail.key;
  if (WATCHED_KEYS.includes(key)) updateStyle();
}

export function currentTheme() {
  return configRead('uiTheme') === 'oled' ? 'oled' : 'youtube';
}

/** Test/diagnostic hook: tear down the observer and forget the style element. */
export function resetThemeForTests() {
  if (rootObserver) rootObserver.disconnect();
  rootObserver = null;
  managedStyle = null;
  lastWrittenCss = null;
}

const installedFlag = '__ytarkAppearanceInstalled';
if (typeof window !== 'undefined' && !window[installedFlag]) {
  try {
    window[installedFlag] = true;
  } catch (_) {
    /* frozen window objects are not expected; continue without the guard */
  }
  configChangeEmitter.addEventListener('configChange', onConfigChange);
  // Early application: <html> exists before the frontend renders, so the
  // theme is in place before the first YouTube TV surface paints.
  if (typeof document !== 'undefined') updateStyle();
}

export default updateStyle;
