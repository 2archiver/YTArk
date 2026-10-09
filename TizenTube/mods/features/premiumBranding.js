import { configRead, configChangeEmitter } from '../config.js';

const LOGO_SELECTOR = 'ytlr-logo';
const WORDMARK_SELECTOR = '[data-ytark-premium-wordmark="true"]';
const SVG_NS = 'http://www.w3.org/2000/svg';
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
 * Safely replaces only artwork inside a known YouTube TV logo host. The original
 * artwork and inline styles are retained and restored when the option is off.
 * Returns false if the frontend's logo markup is not recognizable.
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
  if (current && current.wordmark && current.wordmark.parentNode === host
      && current.artwork === artwork) return true;
  if (current) restoreHost(host);

  // Never replace an interactive or focusable node: logo changes must not alter
  // search/account controls or the D-pad focus order.
  if (!artwork || artwork === host || (artwork.hasAttribute && artwork.hasAttribute('tabindex')
      && artwork.getAttribute('tabindex') !== '-1')) return false;
  if (!host.style || !artwork.style) return false;

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
let currentHost = null;
let reconcileTimer = null;

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
  const nextHost = document.querySelector(LOGO_SELECTOR);
  if (currentHost && currentHost !== nextHost) restoreHost(currentHost);
  currentHost = nextHost;
  if (currentHost) setPremiumLogo(currentHost, configRead('enablePremiumLogo'), document);
}

function scheduleReconcile() {
  if (reconcileTimer !== null) return;
  reconcileTimer = setTimeout(reconcile, 80);
}

function startObserver() {
  if (typeof document === 'undefined' || !document.body || observerRoot === document.body) return;
  if (observer) observer.disconnect();
  observerRoot = document.body;
  if (typeof MutationObserver === 'undefined') {
    scheduleReconcile();
    return;
  }

  observer = new MutationObserver((records) => {
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
  scheduleReconcile();
}

function initialize() {
  if (typeof document === 'undefined') return;
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
}

configChangeEmitter.addEventListener('configChange', (event) => {
  if (event.detail && event.detail.key === 'enablePremiumLogo') scheduleReconcile();
});

initialize();

export { makeWordmark, restoreHost };
