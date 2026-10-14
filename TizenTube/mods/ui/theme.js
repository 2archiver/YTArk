/**
 * YTArk appearance manager.
 *
 * Owns exactly one managed <style data-ytark-managed-theme="true"> element and
 * two root classes on <html>:
 *   - `ytark-no-player-scrim`  "Remove player dimming"
 *   - `ytark-hide-watermark`   "Hide channel watermark" (DOM safety net)
 *
 * The stylesheet holds the user's saved custom colours plus the static,
 * class-scoped feature rules from appearanceStyles.js. Switching a feature
 * flips a class; the custom colours are independent of the feature classes
 * and are never overwritten. The Premium wordmark keeps resolving its ink
 * from the live header colour through its own (single) theme observer, which
 * already reacts to class changes on <html>.
 */

import { configRead, configChangeEmitter } from '../config.js';
import { ROOT_CLASSES, buildAppearanceCss, buildCustomColorCss } from './appearanceStyles.js';

const STYLE_ATTRIBUTE = 'data-ytark-managed-theme';
const STYLE_SELECTOR = `style[${STYLE_ATTRIBUTE}="true"]`;
const WATCHED_KEYS = ['removePlayerScrim', 'hidePlayerWatermark', 'focusContainerColor', 'routeColor'];
const STATIC_CSS = buildAppearanceCss();

let managedStyle = null;
let rootObserver = null;
let headObserver = null;
let styleRestorations = 0;
let lastWrittenCss = null;

/** Cap on re-creating the managed stylesheet if the frontend keeps removing it. */
export const MAX_STYLE_RESTORATIONS = 5;

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

/**
 * Keep the one managed <style> element alive.
 *
 * The frontend rebuilds parts of the document as routes change and can drop
 * injected head nodes, which silently disabled the theme (the class stayed on
 * <html> but no rule was left to apply). This observes only <head>'s child
 * list — never the whole document — and only acts when our own element is
 * missing, re-creating it through updateStyle(). Restorations are capped so a
 * frontend that insists on removing it cannot be fought in a loop; after the
 * cap the observer stops and the theme reports honestly instead of scanning.
 */
function watchHead(d) {
  if (headObserver || typeof MutationObserver === 'undefined' || !d || !d.head) return;
  headObserver = new MutationObserver(() => {
    if (styleRestorations >= MAX_STYLE_RESTORATIONS) {
      if (headObserver) headObserver.disconnect();
      headObserver = null;
      return;
    }
    let present = false;
    try {
      present = !!d.querySelector(STYLE_SELECTOR);
    } catch (_) {
      present = true; // never re-create on a failed lookup
    }
    if (present) {
      if (managedStyle && managedStyle.parentNode) return;
      managedStyle = null;
      return;
    }
    managedStyle = null;
    lastWrittenCss = null;
    styleRestorations += 1;
    updateStyle();
  });
  headObserver.observe(d.head, { childList: true });
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
  watchHead(d);
}

function onConfigChange(event) {
  const key = event && event.detail && event.detail.key;
  if (WATCHED_KEYS.includes(key)) updateStyle();
}

/** Test/diagnostic hook: tear down the observer and forget the style element. */
export function resetThemeForTests() {
  if (rootObserver) rootObserver.disconnect();
  rootObserver = null;
  if (headObserver) headObserver.disconnect();
  headObserver = null;
  styleRestorations = 0;
  managedStyle = null;
  lastWrittenCss = null;
}

/**
 * Honest status of the managed theme, for tests and diagnostics: whether the
 * stylesheet exists, what it currently holds and how often it had to be
 * restored after the frontend removed it.
 */
export function themeStatus(d = doc()) {
  let present = false;
  let cssLength = 0;
  try {
    const style = d && d.querySelector ? d.querySelector(STYLE_SELECTOR) : null;
    present = !!style;
    cssLength = style && typeof style.textContent === 'string' ? style.textContent.length : 0;
  } catch (_) {
    present = false;
  }
  const root = d && d.documentElement;
  return {
    stylePresent: present,
    cssLength,
    restorations: styleRestorations,
    rootClasses: root ? Object.keys(desiredRootClasses()).filter(name => hasClass(root, name)) : [],
  };
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
