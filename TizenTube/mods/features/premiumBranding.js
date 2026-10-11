import { configRead, configChangeEmitter } from '../config.js';

/**
 * Cosmetic YouTube Premium-style wordmark.
 *
 * The YouTube TV / Leanback header renders its logo inside a `ytlr-logo-entity`
 * host (Polymer wraps it as `ytlr-redux-connect-ytlr-logo-entity`) and the
 * visible artwork is either an inline-image element or a CSS `background-image`
 * on a descendant such as `ytlr-thumbnail-details`. The previous implementation
 * only looked for `ytlr-logo` with an `img`/`svg`/`yt-icon` child, so it never
 * matched the real markup and silently left the stock header in place.
 *
 * This module patches the actual host markup:
 *   - every logo host found (header and any secondary placement) gets exactly
 *     one wordmark,
 *   - the native artwork is hidden, never removed, and its inline styles are
 *     restored byte-for-byte when the option is turned off,
 *   - the wordmark is drawn from local DOM/CSS only: a red play emblem plus the
 *     label rendered with the frontend's own font and inherited colour, so no
 *     webfont, SVG document or remote image is required and light/dark theme
 *     contrast is preserved,
 *   - observation stays scoped to the logo hosts (or a short, bounded search
 *     for them) and disconnects as soon as the work is done.
 */

const HOST_SELECTORS = [
  'ytlr-logo-entity',
  'ytlr-redux-connect-ytlr-logo-entity',
  'ytlr-logo',
  // Older/alternate bundles name the same entity differently.
  'ytlr-tv-surface-logo-entity',
  '[data-ytark-logo-host]',
];

const BACKGROUND_ARTWORK_SELECTOR = 'ytlr-thumbnail-details, .ytlr-thumbnail-details';

const ELEMENT_ARTWORK_SELECTOR = 'img, svg, yt-icon, iron-icon, canvas, video';

const WORDMARK_SELECTOR = '[data-ytark-premium-wordmark="true"]';

const PLAYER_OVERLAY_SELECTOR = [
  'ytlr-player',
  'ytd-player',
  'html5-video-player',
  'ytlr-watch-default',
  'yt-unified-overlay-stage',
  '[data-player-overlay]',
  '[aria-modal="true"]',
].join(', ');

const STYLE_ELEMENT_ID = 'ytark-premium-logo-style';
const HIDDEN_CLASS = 'ytark-premium-logo-artwork-hidden';
const WORDMARK_ATTRIBUTE = 'data-ytark-premium-wordmark';
const WORDMARK_CLASS = 'ytark-premium-wordmark';

/** Bounded search window after a navigation; long enough for Polymer to mount. */
const OBSERVATION_WINDOW_MS = 12_000;
/** Hard cap on observed mutation batches so a busy page cannot loop forever. */
const MAX_MUTATION_BATCHES = 60;
const MAX_SEARCH_BATCHES = 40;
const RECONCILE_DELAY_MS = 120;
const MAX_PATCH_ATTEMPTS = 40;

const STYLE_SHEET = `
.${HIDDEN_CLASS} {
  visibility: hidden !important;
}
[${WORDMARK_ATTRIBUTE}="true"] {
  display: inline-flex !important;
  align-items: center;
  gap: 0.34em;
  white-space: nowrap;
  color: inherit;
  font-family: inherit;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1;
  max-width: 100%;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
[${WORDMARK_ATTRIBUTE}="true"] > .ytark-premium-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.52em;
  height: 1.06em;
  flex: none;
  border-radius: 0.26em;
  background-color: #ff0033;
}
[${WORDMARK_ATTRIBUTE}="true"] > .ytark-premium-mark::after {
  content: '';
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0.26em 0 0.26em 0.42em;
  border-color: transparent transparent transparent #ffffff;
  margin-left: 0.07em;
}
[${WORDMARK_ATTRIBUTE}="true"] > .ytark-premium-text {
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
}
[${WORDMARK_ATTRIBUTE}="true"] > .ytark-premium-text > .ytark-premium-suffix {
  font-weight: 400;
  opacity: 0.92;
}
`;

/** host -> restoration state for the applied patch. */
const patchByHost = new WeakMap();

let activeStyleDocument = null;

export const trace = {
  state: 'disabled',
  reason: '',
  hostCount: 0,
  patchedHosts: 0,
  attempts: 0,
  patchedAt: 0,
};

function publishTrace() {
  if (typeof window === 'undefined') return;
  try {
    window.__ytarkPremiumLogo = {
      state: trace.state,
      reason: trace.reason,
      hostCount: trace.hostCount,
      patchedHosts: trace.patchedHosts,
      attempts: trace.attempts,
      patchedAt: trace.patchedAt,
    };
  } catch (_) {
    /* diagnostics must never break the header */
  }
}

function reportOnce(reason) {
  if (trace.reason === reason) return;
  trace.reason = reason;
  console.warn(`[YTArk Premium] ${reason}`);
  publishTrace();
}

function documentRef(doc) {
  if (doc) return doc;
  return typeof document !== 'undefined' ? document : null;
}

function saveStyle(element, property) {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function restoreStyle(element, property, saved) {
  if (!element || !element.style || !saved) return;
  if (saved.value) element.style.setProperty(property, saved.value, saved.priority);
  else element.style.removeProperty(property);
}

function classListOf(element) {
  if (!element) return null;
  if (element.classList) return element.classList;
  if (!element._ytarkClasses) {
    element._ytarkClasses = {
      add: (name) => {
        const current = String(element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!current.includes(name)) current.push(name);
        element.setAttribute('class', current.join(' '));
      },
      remove: (name) => {
        const current = String(element.getAttribute('class') || '')
          .split(/\s+/).filter(Boolean).filter(value => value !== name);
        element.setAttribute('class', current.join(' '));
      },
      contains: (name) => String(element.getAttribute('class') || '').split(/\s+/).includes(name),
    };
  }
  return element._ytarkClasses;
}

export function ensureStyleSheet(doc) {
  const target = documentRef(doc) || activeStyleDocument;
  if (!target) return false;
  if (activeStyleDocument === target && target.getElementById
      && target.getElementById(STYLE_ELEMENT_ID)) return true;
  if (!target.head || typeof target.createElement !== 'function') return false;
  if (target.getElementById && target.getElementById(STYLE_ELEMENT_ID)) {
    activeStyleDocument = target;
    return true;
  }
  const style = target.createElement('style');
  style.setAttribute('id', STYLE_ELEMENT_ID);
  style.textContent = STYLE_SHEET;
  target.head.appendChild(style);
  activeStyleDocument = target;
  return true;
}

export function makeWordmark(doc) {
  const target = documentRef(doc);
  if (!target || typeof target.createElement !== 'function') return null;

  const wordmark = target.createElement('span');
  wordmark.setAttribute(WORDMARK_ATTRIBUTE, 'true');
  wordmark.setAttribute('aria-hidden', 'true');
  wordmark.setAttribute('class', WORDMARK_CLASS);
  wordmark.setAttribute('part', 'ytark-premium-wordmark');

  const mark = target.createElement('span');
  mark.setAttribute('class', 'ytark-premium-mark');
  mark.setAttribute('aria-hidden', 'true');

  const text = target.createElement('span');
  text.setAttribute('class', 'ytark-premium-text');
  text.textContent = 'YouTube Premium';

  wordmark.appendChild(mark);
  wordmark.appendChild(text);
  return wordmark;
}

function isPlayerOverlay(host) {
  if (!host || typeof host.closest !== 'function') return false;
  try {
    return !!host.closest(PLAYER_OVERLAY_SELECTOR);
  } catch (_) {
    return true;
  }
}

function isHiddenArtifact(element) {
  return !!element && ((element.getAttribute
      && element.getAttribute(WORDMARK_ATTRIBUTE) === 'true')
    || (element.classList && element.classList.contains(WORDMARK_CLASS)));
}

export function findLogoHosts(doc) {
  const target = documentRef(doc);
  if (!target || typeof target.querySelectorAll !== 'function') return [];
  const hosts = [];
  for (const selector of HOST_SELECTORS) {
    let matches;
    try {
      matches = Array.from(target.querySelectorAll(selector));
    } catch (_) {
      continue;
    }
    for (const candidate of matches) {
      if (!candidate || hosts.includes(candidate)) continue;
      if (isPlayerOverlay(candidate)) continue;
      // Never patch our own injected nodes or a host that holds nothing but them.
      if (isHiddenArtifact(candidate)) continue;
      hosts.push(candidate);
    }
  }
  return hosts;
}

function inlineBackground(element) {
  if (!element || !element.style) return '';
  return String(element.style.getPropertyValue('background-image') || '');
}

/**
 * Describe how the native artwork is drawn so it can be hidden and restored.
 * Returns null when nothing recognizable is present (the stock header is kept).
 */
function describeArtwork(host) {
  if (!host || typeof host.querySelector !== 'function') return null;

  let backgroundHost = null;
  try {
    backgroundHost = host.querySelector(BACKGROUND_ARTWORK_SELECTOR);
  } catch (_) {
    backgroundHost = null;
  }
  if (backgroundHost && inlineBackground(backgroundHost)) {
    return { mode: 'background', node: backgroundHost };
  }

  let elementArtwork = null;
  try {
    elementArtwork = host.querySelector(ELEMENT_ARTWORK_SELECTOR);
  } catch (_) {
    elementArtwork = null;
  }
  if (elementArtwork && elementArtwork !== host) {
    return { mode: 'element', node: elementArtwork };
  }

  if (inlineBackground(host)) return { mode: 'background', node: host };
  if (backgroundHost) return { mode: 'background', node: backgroundHost };
  return null;
}

/**
 * True when the node itself can receive remote/D-pad focus. Hiding such a node
 * would remove a focus target, so the guard below prefers to hide its artwork.
 */
function isFocusTarget(node) {
  if (!node || typeof node.getAttribute !== 'function') return false;
  const tag = String(node.tagName || '').toLowerCase();
  if (tag === 'a' || tag === 'button') return true;
  const tabindex = node.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== undefined && Number(tabindex) >= 0) return true;
  const role = node.getAttribute('role');
  return role === 'button' || role === 'link';
}

function isHidden(node) {
  return !!(node && node.classList && node.classList.contains(HIDDEN_CLASS));
}

/**
 * The visual artwork inside a focus target: hide the image instead of the
 * control so the focus ring and the search/account controls keep working.
 */
function artworkInsideControl(node) {
  if (!node || typeof node.querySelector !== 'function') return null;
  try {
    return node.querySelector(ELEMENT_ARTWORK_SELECTOR);
  } catch (_) {
    return null;
  }
}

function accessibleName(node) {
  if (!node || typeof node.getAttribute !== 'function') return '';
  const label = node.getAttribute('aria-label');
  if (label) return String(label).trim();
  const alt = node.getAttribute('alt');
  if (alt) return String(alt).trim();
  const title = node.getAttribute('title');
  if (title) return String(title).trim();
  const text = typeof node.textContent === 'string' ? node.textContent.trim() : '';
  return text.length <= 60 ? text : '';
}

/**
 * Keep the accessible name of the region after the stock artwork is hidden:
 * an <img alt="YouTube"> inside the focusable logo control is not read out any
 * more once it is invisible, so the name is re-attached to the focus target.
 * The wordmark itself is always aria-hidden (cosmetic branding is never
 * announced as a subscription state).
 */
function applyFocusContract(host, artworkNode) {
  const contract = { focusTarget: null, addedLabel: null, previousLabel: null };
  const focusTarget = isFocusTarget(host) ? host
    : (isFocusTarget(artworkNode) ? artworkNode
      : (host && typeof host.closest === 'function' ? closestFocusTarget(host) : null));
  if (focusTarget) contract.focusTarget = focusTarget;
  const name = accessibleName(artworkNode) || accessibleName(isFocusTarget(host) ? host : null);
  if (focusTarget && name && typeof focusTarget.getAttribute === 'function'
      && !focusTarget.getAttribute('aria-label')) {
    contract.previousLabel = focusTarget.getAttribute('aria-label');
    focusTarget.setAttribute('aria-label', name);
    contract.addedLabel = name;
  }
  return contract;
}

function closestFocusTarget(node) {
  let current = node;
  let depth = 0;
  while (current && depth < 12) {
    if (isFocusTarget(current)) return current;
    current = current.parentNode;
    depth += 1;
  }
  return null;
}

function releaseFocusContract(contract) {
  if (!contract || !contract.focusTarget || contract.addedLabel === null) return;
  const target = contract.focusTarget;
  if (typeof target.getAttribute !== 'function') return;
  if (target.getAttribute('aria-label') !== contract.addedLabel) return;
  if (contract.previousLabel) target.setAttribute('aria-label', contract.previousLabel);
  else if (typeof target.removeAttribute === 'function') target.removeAttribute('aria-label');
}

function focusableHostHeight(host) {
  if (!host || typeof host.getBoundingClientRect !== 'function') return 0;
  try {
    const rect = host.getBoundingClientRect();
    return rect && rect.height ? rect.height : 0;
  } catch (_) {
    return 0;
  }
}

function applyWordmarkSizing(host, wordmark) {
  const height = focusableHostHeight(host) || focusableHostHeight(host && host.parentNode);
  let fontSize = height > 6 ? height * 0.52 : 0;
  if (!fontSize || fontSize < 15) fontSize = 22;
  if (fontSize > 44) fontSize = 44;
  wordmark.style.setProperty('font-size', `${Math.round(fontSize * 10) / 10}px`);
  wordmark.style.setProperty('min-height', '1.06em');
}

export function restoreHost(host) {
  if (!host) return false;
  stopHostObserver(host);
  const state = patchByHost.get(host);
  if (!state) {
    // Defensive: remove an orphaned wordmark left by a previous document.
    let orphan = null;
    try {
      orphan = host.querySelector(WORDMARK_SELECTOR);
    } catch (_) {
      orphan = null;
    }
    if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
    return false;
  }

  if (state.wordmark && state.wordmark.parentNode) {
    state.wordmark.parentNode.removeChild(state.wordmark);
  }
  releaseFocusContract(state.focusContract);
  for (const entry of state.hidden) {
    if (entry.visibility !== undefined) {
      const list = classListOf(entry.node);
      if (list) list.remove(HIDDEN_CLASS);
      restoreStyle(entry.node, 'visibility', entry.visibility);
    }
    if (entry.backgroundImage !== undefined) {
      restoreStyle(entry.node, 'background-image', entry.backgroundImage);
      restoreStyle(entry.node, 'background-size', entry.backgroundSize);
      restoreStyle(entry.node, 'background-repeat', entry.backgroundRepeat);
      restoreStyle(entry.node, 'background-position', entry.backgroundPosition);
    }
  }
  restoreStyle(host, 'display', state.hostDisplay);
  restoreStyle(host, 'align-items', state.hostAlignItems);
  restoreStyle(host, 'gap', state.hostGap);
  restoreStyle(host, 'min-height', state.hostMinHeight);
  patchByHost.delete(host);
  trace.patchedHosts = Math.max(0, trace.patchedHosts - 1);
  return true;
}

/**
 * Replace the recognised native logo artwork inside one host with the local
 * cosmetic wordmark. Returns false when the markup is not safely patchable, in
 * which case the stock logo is left untouched.
 */
export function setPremiumLogo(host, enabled, doc) {
  if (!host || !host.style) return false;
  const target = documentRef(doc);
  if (!target) return false;

  if (!enabled) {
    restoreHost(host);
    return true;
  }
  if (isPlayerOverlay(host)) {
    if (patchByHost.has(host)) restoreHost(host);
    return false;
  }

  const current = patchByHost.get(host);
  if (current && current.wordmark && current.wordmark.parentNode === host
      && current.wordmark.isConnected !== false) {
    return true;
  }
  if (current) restoreHost(host);

  const artwork = describeArtwork(host);
  if (!artwork || !artwork.node || !artwork.node.style) {
    reportOnce('no patchable header logo artwork was recognised; the stock logo is unchanged');
    return false;
  }

  ensureStyleSheet(target);
  const wordmark = makeWordmark(target);
  if (!wordmark) return false;

  // A focusable control must keep its box, its focus ring and its place in the
  // remote-control order: hide the artwork it paints, never the control itself.
  let paintedNode = artwork.node;
  let visibilityHide = true;
  if (isFocusTarget(artwork.node)) {
    const inner = artworkInsideControl(artwork.node);
    if (inner && inner !== artwork.node) {
      paintedNode = inner;
    } else if (artwork.mode === 'background') {
      // The focus target itself carries the stock artwork as a background:
      // clearing the background paint is enough, so the control stays visible.
      visibilityHide = false;
    } else {
      visibilityHide = false;
    }
  }

  const hidden = [];
  if (visibilityHide) {
    const list = classListOf(paintedNode);
    if (list) list.add(HIDDEN_CLASS);
    hidden.push({
      node: paintedNode,
      visibility: saveStyle(paintedNode, 'visibility'),
    });
    paintedNode.style.setProperty('visibility', 'hidden', 'important');
  }
  if (artwork.mode === 'background' && paintedNode === artwork.node) {
    // Replace the native wordmark image with our own text lockup: keep the box
    // but stop the old background from painting through the wordmark.
    hidden.push({
      node: artwork.node,
      backgroundImage: saveStyle(artwork.node, 'background-image'),
      backgroundSize: saveStyle(artwork.node, 'background-size'),
      backgroundRepeat: saveStyle(artwork.node, 'background-repeat'),
      backgroundPosition: saveStyle(artwork.node, 'background-position'),
    });
    artwork.node.style.setProperty('background-image', 'none', 'important');
    artwork.node.style.setProperty('background-size', 'auto', 'important');
    artwork.node.style.setProperty('background-repeat', 'no-repeat', 'important');
    artwork.node.style.setProperty('background-position', 'center', 'important');
  }
  const focusContract = applyFocusContract(host, artwork.node);

  const state = {
    artwork: artwork.node,
    artworkMode: artwork.mode,
    paintedNode,
    focusContract,
    hidden,
    wordmark,
    hostDisplay: saveStyle(host, 'display'),
    hostAlignItems: saveStyle(host, 'align-items'),
    hostGap: saveStyle(host, 'gap'),
    hostMinHeight: saveStyle(host, 'min-height'),
  };

  host.style.setProperty('display', 'inline-flex', 'important');
  host.style.setProperty('align-items', 'center', 'important');
  host.style.setProperty('gap', '0.34em', 'important');
  if (artwork.mode === 'background') {
    host.style.setProperty('min-height', '1.06em', 'important');
  }
  applyWordmarkSizing(host, wordmark);
  host.appendChild(wordmark);
  patchByHost.set(host, state);
  trace.patchedHosts += 1;
  trace.patchedAt = Date.now();
  trace.state = 'active';
  publishTrace();
  return true;
}

// ---------------------------------------------------------------------------
// Lifecycle: bounded search, scoped re-application, clean teardown
// ---------------------------------------------------------------------------

let searchObserver = null;
let searchRoot = null;
let searchDeadline = null;
let searchBatches = 0;
const hostObservers = new WeakMap();
const observedHosts = new Set();
let reconcileTimer = null;
let cleanupRequested = false;

function stopSearchObserver() {
  if (searchObserver) searchObserver.disconnect();
  if (searchDeadline !== null) clearTimeout(searchDeadline);
  searchObserver = null;
  searchRoot = null;
  searchDeadline = null;
  searchBatches = 0;
}

function stopHostObserver(host) {
  const observer = hostObservers.get(host);
  if (observer) {
    observer.disconnect();
    hostObservers.delete(host);
  }
  observedHosts.delete(host);
}

function forgetHosts(doc) {
  const target = documentRef(doc);
  if (!target || typeof target.querySelectorAll !== 'function') return;
  let hosts = [];
  try {
    hosts = Array.from(target.querySelectorAll(WORDMARK_SELECTOR));
  } catch (_) {
    hosts = [];
  }
  for (const wordmark of hosts) {
    const host = wordmark.parentNode;
    if (host) restoreHost(host);
    else if (wordmark.parentNode) wordmark.parentNode.removeChild(wordmark);
  }
}

function watchHost(host) {
  if (!host || typeof MutationObserver === 'undefined' || hostObservers.has(host)) return;
  const observer = new MutationObserver(() => {
    if (cleanupRequested) return;
    if (!configRead('enablePremiumLogo')) return;
    const state = patchByHost.get(host);
    if (!state) return;
    if (state.wordmark && state.wordmark.parentNode === host) {
      applyWordmarkSizing(host, state.wordmark);
      const list = classListOf(state.artwork);
      if (list && !list.contains(HIDDEN_CLASS)) list.add(HIDDEN_CLASS);
      return;
    }
    // The frontend re-rendered the slot: re-apply our own patch only.
    if (host.isConnected === false) {
      stopHostObserver(host);
      patchByHost.delete(host);
      return;
    }
    restoreHost(host);
    setPremiumLogo(host, true, activeStyleDocument || undefined);
  });
  observer.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  hostObservers.set(host, observer);
  observedHosts.add(host);
}

function containsHostCandidate(node) {
  if (!node || node.nodeType !== 1) return false;
  for (const selector of HOST_SELECTORS) {
    try {
      if (node.matches && node.matches(selector)) return true;
      if (node.querySelector && node.querySelector(selector)) return true;
    } catch (_) {
      /* unsupported selector for this engine: ignore */
    }
  }
  return false;
}

function reconcile() {
  reconcileTimer = null;
  if (typeof document === 'undefined' || !document.body) return;
  if (cleanupRequested) return;

  if (!configRead('enablePremiumLogo')) {
    forgetHosts(document);
    stopSearchObserver();
    trace.state = 'disabled';
    publishTrace();
    return;
  }

  ensureStyleSheet(document);
  trace.attempts += 1;
  const hosts = findLogoHosts(document);
  trace.hostCount = hosts.length;

  for (const host of hosts) {
    if (patchByHost.has(host)) {
      const state = patchByHost.get(host);
      if (state.wordmark && state.wordmark.parentNode === host) {
        watchHost(host);
        continue;
      }
    }
    if (setPremiumLogo(host, true, document)) watchHost(host);
  }

  if (hosts.length > 0) {
    trace.state = patchByHost ? 'active' : 'idle';
    publishTrace();
  } else if (trace.attempts < MAX_PATCH_ATTEMPTS) {
    reportOnce('the YouTube TV header logo host has not been found yet');
  }
}

function scheduleReconcile() {
  if (cleanupRequested) return;
  if (reconcileTimer !== null) return;
  reconcileTimer = setTimeout(reconcile, RECONCILE_DELAY_MS);
}

export function startObserver(forceRestart = false) {
  if (typeof document === 'undefined' || !document.body) return;
  cleanupRequested = false;
  if (!configRead('enablePremiumLogo')) return;
  ensureStyleSheet(document);

  if (!forceRestart && searchObserver && searchRoot === document.body) return;
  stopSearchObserver();

  if (typeof MutationObserver === 'undefined') {
    scheduleReconcile();
    return;
  }

  searchRoot = document.body;
  searchObserver = new MutationObserver((records) => {
    searchBatches += 1;
    if (searchBatches > MAX_SEARCH_BATCHES) {
      stopSearchObserver();
      return;
    }
    let relevant = false;
    for (const record of records) {
      if (record.target && containsHostCandidate(record.target)) {
        relevant = true;
        break;
      }
      const added = record.addedNodes ? Array.from(record.addedNodes) : [];
      const removed = record.removedNodes ? Array.from(record.removedNodes) : [];
      for (const node of added.concat(removed)) {
        if (containsHostCandidate(node)) {
          relevant = true;
          break;
        }
        if (node.nodeType === 1 && node.isConnected === false) {
          const wordmark = node.querySelector ? node.querySelector(WORDMARK_SELECTOR) : null;
          if (wordmark && wordmark.parentNode) {
            restoreHost(wordmark.parentNode);
          }
        }
      }
      if (relevant) break;
    }
    if (relevant) scheduleReconcile();
  });
  searchObserver.observe(searchRoot, { childList: true, subtree: true });

  // The page-level search is deliberately short-lived. Once the wordmark is in
  // place the per-host observer keeps it correct without rescanning the page.
  searchDeadline = setTimeout(() => {
    stopSearchObserver();
  }, OBSERVATION_WINDOW_MS);

  scheduleReconcile();
}

function onNavigation() {
  if (!configRead('enablePremiumLogo')) return;
  // Drop stale references: Polymer replaces the header on navigation.
  forgetDetachedHosts();
  // A pagehide cleanup followed by a pageshow return must be able to re-arm the
  // bounded observation cycle without reloading the userscript.
  startObserver(true);
}

function forgetDetachedHosts() {
  if (typeof document === 'undefined') return;
  let wordmarks = [];
  try {
    wordmarks = Array.from(document.querySelectorAll(WORDMARK_SELECTOR));
  } catch (_) {
    wordmarks = [];
  }
  for (const wordmark of wordmarks) {
    const host = wordmark.parentNode;
    if (!host) continue;
    if (host.isConnected === false) {
      stopHostObserver(host);
      patchByHost.delete(host);
    }
  }
}

function onConfigChange(event) {
  if (!event || !event.detail || event.detail.key !== 'enablePremiumLogo') return;
  if (event.detail.value) {
    cleanupRequested = false;
    trace.state = 'enabled';
    trace.reason = '';
    startObserver(true);
    scheduleReconcile();
  } else {
    forgetHosts(document);
    stopSearchObserver();
    trace.state = 'disabled';
    publishTrace();
  }
}

export function cleanup() {
  cleanupRequested = true;
  stopSearchObserver();
  for (const host of Array.from(observedHosts)) stopHostObserver(host);
  if (reconcileTimer !== null) clearTimeout(reconcileTimer);
  reconcileTimer = null;
  if (typeof document !== 'undefined' && document.body) forgetHosts(document);
  // Route/config/page listeners stay installed so a back-forward-cache return
  // can start a fresh bounded cycle without reloading the userscript.
}

function initialize() {
  if (typeof document === 'undefined') return;
  document.addEventListener('yt-navigate-finish', onNavigation, true);
  document.addEventListener('yt-page-data-fetched', onNavigation, true);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', cleanup, true);
    window.addEventListener('pageshow', onNavigation, true);
    window.addEventListener('hashchange', onNavigation, true);
  }
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', () => startObserver(), { once: true });
}

configChangeEmitter.addEventListener('configChange', onConfigChange);
initialize();

export { onNavigation };
