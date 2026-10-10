import { configRead, configChangeEmitter } from '../config.js';

const LOGO_SELECTOR = 'ytlr-logo';
const PLAYER_OVERLAY_SELECTOR = 'ytlr-player, ytd-player, #player, .html5-video-player, [data-player-overlay], [aria-modal="true"]';
const WORDMARK_SELECTOR = '[data-ytark-premium-wordmark="true"]';
const SVG_NS = 'http://www.w3.org/2000/svg';
const OBSERVATION_WINDOW_MS = 25_000;
const MAX_MUTATION_BATCHES = 48;
const RECONCILE_DELAY_MS = 80;
const patchByHost = new WeakMap();

function saveStyle(element, property) {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function restoreStyle(element, property, value) {
  if (!element || !element.style) return;
  if (value.value) element.style.setProperty(property, value.value, value.priority);
  else element.style.removeProperty(property);
}

function makeWordmark(doc) {
  const wordmark = doc.createElement('span');
  wordmark.setAttribute('data-ytark-premium-wordmark', 'true');
  wordmark.setAttribute('aria-hidden', 'true');
  wordmark.style.setProperty('display', 'inline-flex');
  wordmark.style.setProperty('align-items', 'center');
  wordmark.style.setProperty('gap', '0.38em');
  wordmark.style.setProperty('white-space', 'nowrap');
  wordmark.style.setProperty('font-family', 'Roboto, Arial, sans-serif');
  wordmark.style.setProperty('font-size', '1em');
  wordmark.style.setProperty('font-weight', '500');
  wordmark.style.setProperty('line-height', '1');
  wordmark.style.setProperty('color', 'inherit');
  wordmark.style.setProperty('pointer-events', 'none');
  wordmark.style.setProperty('user-select', 'none');

  const icon = doc.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 40 28');
  icon.setAttribute('width', '1.75em');
  icon.setAttribute('height', '1.23em');
  icon.setAttribute('focusable', 'false');
  icon.setAttribute('aria-hidden', 'true');

  const background = doc.createElementNS(SVG_NS, 'rect');
  background.setAttribute('x', '1');
  background.setAttribute('y', '2');
  background.setAttribute('width', '38');
  background.setAttribute('height', '24');
  background.setAttribute('rx', '6');
  background.setAttribute('fill', '#ff0000');

  const play = doc.createElementNS(SVG_NS, 'path');
  play.setAttribute('d', 'M16 8.5 27 14 16 19.5Z');
  play.setAttribute('fill', '#ffffff');
  icon.appendChild(background);
  icon.appendChild(play);

  const label = doc.createElement('span');
  label.textContent = 'YouTube Premium';
  label.style.setProperty('font-weight', '600');
  label.style.setProperty('letter-spacing', '-0.025em');

  wordmark.appendChild(icon);
  wordmark.appendChild(label);
  return wordmark;
}

function findArtwork(host) {
  if (!host || typeof host.querySelector !== 'function') return null;
  return host.querySelector('img, svg, yt-icon');
}

function isFocusTarget(element) {
  if (!element) return false;
  if (element.hasAttribute && element.hasAttribute('tabindex')) return true;
  if (element.hasAttribute && element.hasAttribute('focusable')
      && String(element.getAttribute('focusable')).toLowerCase() !== 'false') return true;
  if (element.isContentEditable) return true;

  const tag = String(element.tagName || '').toUpperCase();
  if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(tag)) return true;
  if (tag === 'A' && element.hasAttribute && element.hasAttribute('href')) return true;

  const role = element.getAttribute && String(element.getAttribute('role') || '').toLowerCase();
  return ['button', 'link', 'menuitem', 'option', 'radio', 'switch', 'tab', 'treeitem']
    .includes(role);
}

function hasAccessibleArtworkName(artwork) {
  if (!artwork || typeof artwork.hasAttribute !== 'function') return false;
  if (artwork.hasAttribute('aria-label') || artwork.hasAttribute('aria-labelledby')) return true;
  if (String(artwork.tagName || '').toLowerCase() === 'img' && artwork.hasAttribute('alt')
      && String(artwork.getAttribute('alt') || '').trim().length > 0) return true;
  if (artwork.hasAttribute('role')
      && String(artwork.getAttribute('role')).toLowerCase() === 'img'
      && artwork.querySelector && artwork.querySelector('title')) return true;
  return false;
}

function isPlayerOverlay(host) {
  if (!host || typeof host.closest !== 'function') return false;
  try {
    return !!host.closest(PLAYER_OVERLAY_SELECTOR);
  } catch (_) {
    return true;
  }
}

function findLogoHost(doc) {
  if (!doc) return null;
  const candidates = typeof doc.querySelectorAll === 'function'
    ? Array.from(doc.querySelectorAll(LOGO_SELECTOR))
    : [doc.querySelector && doc.querySelector(LOGO_SELECTOR)].filter(Boolean);
  return candidates.find(candidate => !isPlayerOverlay(candidate)) || null;
}

function restoreHost(host) {
  const state = patchByHost.get(host);
  if (!state) {
    const orphan = host && host.querySelector && host.querySelector(WORDMARK_SELECTOR);
    if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
    return;
  }

  if (state.wordmark && state.wordmark.parentNode) {
    state.wordmark.parentNode.removeChild(state.wordmark);
  }
  restoreStyle(state.artwork, 'display', state.artworkDisplay);
  restoreStyle(host, 'display', state.hostDisplay);
  restoreStyle(host, 'align-items', state.hostAlignItems);
  restoreStyle(host, 'gap', state.hostGap);
  patchByHost.delete(host);
}

/**
 * Replaces only artwork inside the recognized YouTube TV logo host. The source
 * artwork and inline styles are preserved and restored when the option is off.
 * Returns false for unfamiliar or focusable markup, leaving the stock header in place.
 */
export function setPremiumLogo(host, enabled, doc) {
  if (!host) return false;
  const documentRef = doc || (typeof document !== 'undefined' ? document : null);
  if (!documentRef) return false;

  if (!enabled) {
    restoreHost(host);
    return true;
  }

  const artwork = findArtwork(host);
  const current = patchByHost.get(host);

  // Never alter a control, D-pad target, player overlay, or the only
  // accessible name for a logo. Restore an existing patch if markup changes.
  if (!artwork || artwork === host || isPlayerOverlay(host)
      || isFocusTarget(host) || isFocusTarget(artwork)
      || hasAccessibleArtworkName(artwork) || !host.style || !artwork.style) {
    if (current) restoreHost(host);
    return false;
  }
  if (current && current.wordmark && current.wordmark.parentNode === host
      && current.artwork === artwork) return true;
  if (current) restoreHost(host);

  const wordmark = makeWordmark(documentRef);
  const state = {
    artwork,
    artworkDisplay: saveStyle(artwork, 'display'),
    hostDisplay: saveStyle(host, 'display'),
    hostAlignItems: saveStyle(host, 'align-items'),
    hostGap: saveStyle(host, 'gap'),
    wordmark,
  };

  artwork.style.setProperty('display', 'none', 'important');
  host.style.setProperty('display', 'inline-flex', 'important');
  host.style.setProperty('align-items', 'center', 'important');
  host.style.setProperty('gap', '0.38em', 'important');
  host.appendChild(wordmark);
  patchByHost.set(host, state);
  return true;
}

let observer = null;
let observerRoot = null;
let observerDeadline = null;
let observerBatches = 0;
let currentHost = null;
let reconcileTimer = null;
let didReportFallback = false;

function reportFallback(reason) {
  if (didReportFallback) return;
  didReportFallback = true;
  console.warn(`[YTArk Premium] ${reason}. The cosmetic patch is limited to recognized, non-focusable header artwork.`);
}

function stopObserver() {
  if (observer) observer.disconnect();
  if (observerDeadline !== null) clearTimeout(observerDeadline);
  observer = null;
  observerDeadline = null;
  observerRoot = null;
  observerBatches = 0;
}

function containsLogo(node) {
  if (!node || node.nodeType !== 1) return false;
  try {
    return (node.matches && node.matches(LOGO_SELECTOR))
      || (node.querySelector && !!node.querySelector(LOGO_SELECTOR));
  } catch (_) {
    return false;
  }
}

function reconcile() {
  reconcileTimer = null;
  if (typeof document === 'undefined') return;
  const nextHost = findLogoHost(document);
  if (currentHost && currentHost !== nextHost) restoreHost(currentHost);
  currentHost = nextHost;

  if (!configRead('enablePremiumLogo')) {
    if (currentHost) restoreHost(currentHost);
    stopObserver();
    return;
  }
  if (currentHost && !setPremiumLogo(currentHost, true, document)) {
    reportFallback('the current TV logo markup is not safely patchable');
  }
}

function scheduleReconcile() {
  if (reconcileTimer !== null) return;
  reconcileTimer = setTimeout(reconcile, RECONCILE_DELAY_MS);
}

function startObserver(forceRestart = false) {
  if (typeof document === 'undefined' || !document.body || !configRead('enablePremiumLogo')) return;
  if (!forceRestart && observer && observerRoot === document.body) return;
  stopObserver();

  observerRoot = document.body;
  if (typeof MutationObserver === 'undefined') {
    reportFallback('MutationObserver is unavailable');
    scheduleReconcile();
    return;
  }

  observer = new MutationObserver((records) => {
    observerBatches += 1;
    if (observerBatches > MAX_MUTATION_BATCHES) {
      stopObserver();
      console.warn('[YTArk Premium] The bounded header observation limit was reached; no further DOM changes will be watched this navigation.');
      return;
    }
    let relevant = false;
    for (const record of records) {
      const target = record.target;
      if (target && target.closest && target.closest(LOGO_SELECTOR)) {
        relevant = true;
        break;
      }
      for (const node of Array.from(record.addedNodes || [])) {
        if (containsLogo(node)) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
      for (const node of Array.from(record.removedNodes || [])) {
        if (containsLogo(node) || (currentHost && (node === currentHost
            || (node.contains && node.contains(currentHost))))) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) scheduleReconcile();
  });

  observer.observe(observerRoot, { childList: true, subtree: true });
  observerDeadline = setTimeout(() => {
    stopObserver();
    if (!currentHost && configRead('enablePremiumLogo')) {
      reportFallback('the YTArk header was not found within the observation window');
    }
  }, OBSERVATION_WINDOW_MS);
  scheduleReconcile();
}

function onNavigation() {
  if (currentHost && currentHost.isConnected === false) {
    restoreHost(currentHost);
    currentHost = null;
  }
  startObserver(true);
}

function onConfigChange(event) {
  if (!event.detail || event.detail.key !== 'enablePremiumLogo') return;
  if (event.detail.value) {
    didReportFallback = false;
    startObserver(true);
  } else {
    if (currentHost) restoreHost(currentHost);
    currentHost = null;
    stopObserver();
  }
  scheduleReconcile();
}

function cleanup() {
  stopObserver();
  if (reconcileTimer !== null) clearTimeout(reconcileTimer);
  reconcileTimer = null;
  if (currentHost) restoreHost(currentHost);
  currentHost = null;
  // Keep route/config listeners installed so a back-forward-cache return can
  // start a fresh bounded observation cycle without reloading the userscript.
}

function initialize() {
  if (typeof document === 'undefined') return;
  document.addEventListener('yt-navigate-finish', onNavigation, true);
  document.addEventListener('yt-page-data-fetched', onNavigation, true);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', cleanup, true);
    window.addEventListener('pageshow', onNavigation, true);
  }
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', () => startObserver(), { once: true });
}

configChangeEmitter.addEventListener('configChange', onConfigChange);
initialize();

export { makeWordmark, restoreHost, startObserver, cleanup };
