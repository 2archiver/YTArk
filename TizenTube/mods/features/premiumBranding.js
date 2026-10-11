import { configRead, configChangeEmitter } from '../config.js';
import { YOUTUBE_PREMIUM_WORDMARK } from '../assets/youtubePremiumLogo.generated.js';

/**
 * Cosmetic YouTube Premium wordmark (cosmetic header preference only).
 *
 * The artwork is the exact 2024 YouTube Premium lockup from Wikimedia Commons,
 * bundled as vector geometry by `tools/fetch_premium_logo.py` (download,
 * SHA-1 verification against the Commons revision metadata, sanitization) and
 * turned into `assets/youtubePremiumLogo.generated.js` by
 * `tools/build_logo_asset.py`. Nothing is fetched at runtime, nothing is
 * retyped in a font, and no raster preview is used.
 *
 * Rendering rules:
 *   - the red play emblem and its white triangle keep their literal source
 *     paint in every theme (`icon-red` / `icon-white` paint tokens),
 *   - the lettering paths use the `ytark-premium-ink` token, i.e.
 *     `fill: currentColor` on the wrapper, and the wrapper's colour is resolved
 *     from the real Leanback header foreground, so dark and light headers both
 *     stay legible without inverting or filtering the emblem,
 *   - a MutationObserver scoped to the logo host keeps the patch alive when the
 *     frontend re-renders the slot, and is disconnected on teardown.
 *
 * The YouTube TV / Leanback header renders its logo inside a `ytlr-logo-entity`
 * host (Polymer wraps it as `ytlr-redux-connect-ytlr-logo-entity`) and the
 * visible artwork is either an inline-image element or a CSS `background-image`
 * on a descendant such as `ytlr-thumbnail-details`.
 *
 * This module patches the actual host markup:
 *   - every logo host found (header and any secondary placement) gets exactly
 *     one wordmark,
 *   - the native artwork is hidden, never removed, and its inline styles are
 *     restored byte-for-byte when the option is turned off,
 *   - observation stays scoped to the logo hosts (or a short, bounded search
 *     for them) and disconnects as soon as the work is done.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';


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
/** Lettering paint token: only these paths follow the header foreground. */
const INK_CLASS = 'ytark-premium-ink';
const VECTOR_CLASS = 'ytark-premium-vector';
const THEME_ATTRIBUTE = 'data-ytark-premium-theme';
const INK_ATTRIBUTE = 'data-ytark-premium-ink';
const INK_SOURCE_ATTRIBUTE = 'data-ytark-premium-ink-source';

/**
 * Theme ink tokens. `dark` is the near-white foreground a dark Leanback header
 * uses, `light` the near-black foreground of the light header. They are only
 * used when the live header colour cannot be read (no getComputedStyle, no
 * mounted header) or when an app-level theme marker decides the theme.
 */
const INK_TOKENS = YOUTUBE_PREMIUM_WORDMARK.inkTokens;

/** Document-root theme markers the TV frontend/app sets when a theme is forced. */
const THEME_HINT_PATTERN = /(^|[\s_-])(dark|light)([\s_-]|$)/i;
const THEME_HINT_ATTRIBUTES = ['class', 'theme', 'data-theme', 'dark', 'style'];

/** Bounded search window after a navigation; long enough for Polymer to mount. */
const OBSERVATION_WINDOW_MS = 12_000;
/** Hard cap on observed mutation batches so a busy page cannot loop forever. */
const MAX_MUTATION_BATCHES = 60;
const MAX_SEARCH_BATCHES = 40;
const RECONCILE_DELAY_MS = 120;
const MAX_PATCH_ATTEMPTS = 40;
/** Bounded re-arm delay used only while no header logo host has been found. */
const SEARCH_RETRY_DELAY_MS = 2_000;

const STYLE_SHEET = `
.${HIDDEN_CLASS} {
  visibility: hidden !important;
}
[${WORDMARK_ATTRIBUTE}="true"] {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: 100%;
  color: inherit;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
[${WORDMARK_ATTRIBUTE}="true"] > svg.${VECTOR_CLASS} {
  display: block;
  width: auto;
  max-width: 100%;
  overflow: visible;
}
[${WORDMARK_ATTRIBUTE}="true"] path.${INK_CLASS} {
  fill: currentColor;
}
`;

/** host -> restoration state for the applied patch. */
const patchByHost = new WeakMap();

let activeStyleDocument = null;

export const trace = {
  state: 'disabled',
  reason: '',
  hostCount: 0,
  renderedHosts: 0,
  patchedHosts: 0,
  attempts: 0,
  patchedAt: 0,
  theme: '',
  inkSource: '',
};

function publishTrace() {
  if (typeof window === 'undefined') return;
  try {
    let hosts = [];
    if (typeof document !== 'undefined' && document.body) {
      try {
        hosts = findLogoHosts(document).map((host) => ({
          tag: host && host.tagName ? String(host.tagName).toLowerCase() : 'unknown',
          rendered: isRenderedHost(host),
          box: hostBox(host),
          patched: patchByHost.has(host),
        }));
      } catch (_) {
        hosts = [];
      }
    }
    window.__ytarkPremiumLogo = {
      state: trace.state,
      reason: trace.reason,
      hostCount: trace.hostCount,
      renderedHosts: trace.renderedHosts,
      patchedHosts: trace.patchedHosts,
      attempts: trace.attempts,
      patchedAt: trace.patchedAt,
      theme: trace.theme,
      inkSource: trace.inkSource,
      hosts,
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
  if (typeof target.createElementNS !== 'function') return null;

  const wordmark = target.createElement('span');
  wordmark.setAttribute(WORDMARK_ATTRIBUTE, 'true');
  wordmark.setAttribute('aria-hidden', 'true');
  wordmark.setAttribute('class', WORDMARK_CLASS);
  wordmark.setAttribute('part', 'ytark-premium-wordmark');

  const svg = target.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('class', VECTOR_CLASS);
  svg.setAttribute('viewBox', YOUTUBE_PREMIUM_WORDMARK.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'presentation');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-ytark-premium-source', YOUTUBE_PREMIUM_WORDMARK.provenance.sourcePage);

  for (const entry of YOUTUBE_PREMIUM_WORDMARK.paths) {
    const node = target.createElementNS(SVG_NAMESPACE, entry.tag);
    for (const name of Object.keys(entry.attributes)) {
      node.setAttribute(name, entry.attributes[name]);
    }
    if (entry.paint === 'ink') {
      // Lettering only: the ink token follows the header foreground, while the
      // emblem keeps its literal source paint in both themes.
      node.setAttribute('class', INK_CLASS);
      node.setAttribute('fill', 'currentColor');
    } else {
      node.setAttribute('fill', entry.fill);
      node.setAttribute('data-ytark-premium-paint', entry.paint);
    }
    svg.appendChild(node);
  }

  wordmark.appendChild(svg);
  return wordmark;
}

// ---------------------------------------------------------------------------
// Theme resolution: the lettering follows the real header foreground
// ---------------------------------------------------------------------------

function activeWindow() {
  return typeof window !== 'undefined' ? window : null;
}

export function parseCssColor(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!text) return null;
  const short = /^#([0-9a-f]{3})$/.exec(text);
  if (short) {
    const digits = short[1];
    return {
      r: parseInt(digits[0] + digits[0], 16),
      g: parseInt(digits[1] + digits[1], 16),
      b: parseInt(digits[2] + digits[2], 16),
      a: 1,
    };
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text);
  if (long) {
    return {
      r: parseInt(long[1].slice(0, 2), 16),
      g: parseInt(long[1].slice(2, 4), 16),
      b: parseInt(long[1].slice(4, 6), 16),
      a: long[2] ? parseInt(long[2], 16) / 255 : 1,
    };
  }
  const functional = /^rgba?\(([^)]*)\)$/.exec(text);
  if (functional) {
    const parts = functional[1].split(/[,/]/).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const channels = parts.slice(0, 3).map((part) => {
        const number = parseFloat(part);
        if (Number.isNaN(number)) return null;
        return part.endsWith('%') ? Math.round((number / 100) * 255) : Math.round(number);
      });
      if (channels.every(channel => channel !== null && channel >= 0 && channel <= 255)) {
        const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
        return {
          r: channels[0], g: channels[1], b: channels[2],
          a: Number.isNaN(alpha) ? 1 : alpha,
        };
      }
    }
    return null;
  }
  if (text === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (text === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

function relativeLuminance(color) {
  const channel = (value) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function toHex(color) {
  const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

/** Theme marker an app-level override leaves on the document root, if any. */
function appThemeHint(doc) {
  const target = documentRef(doc);
  if (!target) return null;
  const roots = [target.documentElement, target.body].filter(Boolean);
  for (const root of roots) {
    if (typeof root.getAttribute !== 'function') continue;
    for (const attribute of THEME_HINT_ATTRIBUTES) {
      const value = root.getAttribute(attribute);
      if (!value) continue;
      const match = THEME_HINT_PATTERN.exec(String(value));
      if (match) return match[2].toLowerCase();
    }
  }
  return null;
}

function prefersDarkTheme() {
  const win = activeWindow();
  if (!win || typeof win.matchMedia !== 'function') return null;
  try {
    const query = win.matchMedia('(prefers-color-scheme: dark)');
    if (!query) return null;
    return query.matches ? 'dark' : 'light';
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the lettering colour for one header host.
 *
 * Priority: the header's own computed foreground (which already reflects any
 * app theme override) → an app-level theme marker → the OS colour preference →
 * the dark token. The emblem's paint is never part of this decision.
 */
export function resolveInkColor(host) {
  const win = activeWindow();
  if (host && win && typeof win.getComputedStyle === 'function') {
    try {
      const computed = win.getComputedStyle(host);
      const parsed = computed ? parseCssColor(computed.color) : null;
      if (parsed && parsed.a >= 0.5) {
        return {
          color: toHex(parsed),
          theme: relativeLuminance(parsed) >= 0.5 ? 'dark' : 'light',
          source: 'header-foreground',
        };
      }
    } catch (_) {
      /* fall through to the documented fallbacks */
    }
  }
  const hint = appThemeHint();
  if (hint) {
    return { color: INK_TOKENS[hint] || INK_TOKENS.dark, theme: hint, source: 'app-theme' };
  }
  const preferred = prefersDarkTheme();
  if (preferred) {
    return { color: INK_TOKENS[preferred], theme: preferred, source: 'prefers-color-scheme' };
  }
  return { color: INK_TOKENS.dark, theme: 'dark', source: 'default' };
}

/** Apply the resolved ink to one wordmark; safe to call on every reconcile. */
export function applyInk(host, wordmark) {
  if (!wordmark || typeof wordmark.setAttribute !== 'function') return null;
  const ink = resolveInkColor(host);
  wordmark.setAttribute(THEME_ATTRIBUTE, ink.theme);
  wordmark.setAttribute(INK_ATTRIBUTE, ink.color);
  wordmark.setAttribute(INK_SOURCE_ATTRIBUTE, ink.source);
  if (wordmark.style && typeof wordmark.style.setProperty === 'function') {
    wordmark.style.setProperty('color', ink.color);
  }
  trace.theme = ink.theme;
  trace.inkSource = ink.source;
  return ink;
}

/** Re-apply the ink of every mounted wordmark (theme switch, app override). */
export function refreshInk(doc) {
  const target = documentRef(doc);
  if (!target || typeof target.querySelectorAll !== 'function') return false;
  let wordmarks = [];
  try {
    wordmarks = Array.from(target.querySelectorAll(WORDMARK_SELECTOR));
  } catch (_) {
    wordmarks = [];
  }
  let changed = false;
  for (const wordmark of wordmarks) {
    const host = wordmark.parentNode;
    if (!host) continue;
    const ink = applyInk(host, wordmark);
    if (ink) changed = true;
  }
  if (changed) publishTrace();
  return changed;
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

/**
 * Layout box of the host; zeros when it is not laid out (detached, hidden or
 * not mounted yet).
 */
function hostBox(host) {
  if (!host || typeof host.getBoundingClientRect !== 'function') return { height: 0, width: 0 };
  try {
    const rect = host.getBoundingClientRect();
    return {
      height: rect && Number(rect.height) > 0 ? Number(rect.height) : 0,
      width: rect && Number(rect.width) > 0 ? Number(rect.width) : 0,
    };
  } catch (_) {
    return { height: 0, width: 0 };
  }
}

/**
 * A host only counts as an active header slot when it is connected AND laid
 * out. Patching a detached or zero-box host is how a stray wordmark ends up
 * outside the intended header (rendered at the top-left of the document flow
 * instead of inside the header container): the replacement is only made for
 * slots that are actually visible, and the search cycle plus the per-host
 * observer apply the patch the moment a slot gets a box.
 */
export function isRenderedHost(host) {
  if (!host) return false;
  if (typeof host.isConnected === 'boolean' && host.isConnected === false) return false;
  return hostBox(host).height >= 6;
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

/**
 * Size the bundled vector against the header slot it replaces. The artwork is
 * pure vector geometry, so the same viewBox scales cleanly at 720p, 1080p and
 * 4K; only the pixel height changes. Falls back to the previous default when
 * the frontend does not report a box yet.
 */
function applyWordmarkSizing(host, wordmark) {
  const height = focusableHostHeight(host) || focusableHostHeight(host && host.parentNode);
  let pixelHeight = height > 6 ? height * 0.52 : 0;
  if (!pixelHeight || pixelHeight < 15) pixelHeight = 22;
  if (pixelHeight > 44) pixelHeight = 44;
  pixelHeight = Math.round(pixelHeight * 10) / 10;
  const ratio = YOUTUBE_PREMIUM_WORDMARK.width / YOUTUBE_PREMIUM_WORDMARK.height;
  const pixelWidth = Math.round(pixelHeight * ratio * 10) / 10;
  wordmark.style.setProperty('height', `${pixelHeight}px`);
  let svg = null;
  if (typeof wordmark.querySelector === 'function') {
    try {
      svg = wordmark.querySelector(`svg.${VECTOR_CLASS}`);
    } catch (_) {
      svg = null;
    }
  }
  if (svg && typeof svg.setAttribute === 'function') {
    svg.setAttribute('height', `${pixelHeight}px`);
    svg.setAttribute('width', `${pixelWidth}px`);
    if (svg.style && typeof svg.style.setProperty === 'function') {
      svg.style.setProperty('height', `${pixelHeight}px`);
      svg.style.setProperty('width', `${pixelWidth}px`);
    }
  }
  return { pixelHeight, pixelWidth };
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

  // Never replace artwork in a slot that is not being rendered: a detached
  // or hidden host has no header position, so a wordmark placed there would
  // appear away from the header (the top-left corner regression). The stock
  // artwork is left untouched until the host is actually laid out.
  if (!isRenderedHost(host)) {
    if (patchByHost.has(host)) restoreHost(host);
    reportOnce('the logo host has no rendered box yet; waiting for layout');
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
  host.appendChild(wordmark);
  const sizing = applyWordmarkSizing(host, wordmark);
  if (artwork.mode === 'background') {
    host.style.setProperty('min-height', `${sizing.pixelHeight}px`, 'important');
  }
  applyInk(host, wordmark);
  patchByHost.set(host, state);
  trace.patchedHosts += 1;
  trace.patchedAt = Date.now();
  trace.state = 'active';
  publishTrace();
  // Every patched host gets its own scoped observer so re-renders, theme
  // changes and route changes are handled without scanning the page, and so
  // cleanup can always find the host through observedHosts.
  watchHost(host);
  return true;
}

// ---------------------------------------------------------------------------
// Lifecycle: bounded search, scoped re-application, clean teardown
// ---------------------------------------------------------------------------

let searchObserver = null;
let searchRoot = null;
let searchDeadline = null;
let searchRetry = null;
let searchBatches = 0;
const hostObservers = new WeakMap();
const observedHosts = new Set();
let reconcileTimer = null;
let cleanupRequested = false;

function stopSearchObserver() {
  if (searchObserver) searchObserver.disconnect();
  if (searchDeadline !== null) clearTimeout(searchDeadline);
  if (searchRetry !== null) clearTimeout(searchRetry);
  searchObserver = null;
  searchRoot = null;
  searchDeadline = null;
  searchRetry = null;
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
    if (!state) {
      if (host.isConnected === false) {
        stopHostObserver(host);
        return;
      }
      // The slot was skipped (no box yet, or unknown artwork) and the
      // frontend just re-rendered it: apply now if it is an active header.
      if (!isPlayerOverlay(host) && isRenderedHost(host)) {
        setPremiumLogo(host, true, activeStyleDocument || undefined);
      }
      return;
    }
    if (state.wordmark && state.wordmark.parentNode === host) {
      applyWordmarkSizing(host, state.wordmark);
      // A header re-render can change the theme token without replacing the
      // slot, so the ink is re-resolved whenever the host mutates.
      applyInk(host, state.wordmark);
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
  // Drop hosts the frontend removed (route change) so no stale observer or
  // patch entry survives a navigation.
  forgetDetachedHosts();
  const hosts = findLogoHosts(document);
  trace.hostCount = hosts.length;
  trace.renderedHosts = 0;

  for (const host of hosts) {
    const rendered = isRenderedHost(host);
    if (rendered) trace.renderedHosts += 1;
    if (patchByHost.has(host)) {
      const state = patchByHost.get(host);
      if (!rendered && state.wordmark) {
        // The header slot lost its layout (route change that hides it):
        // detach the wordmark again so nothing is ever drawn outside an
        // active, rendered header.
        restoreHost(host);
        watchHost(host);
        continue;
      }
      if (state.wordmark && state.wordmark.parentNode === host) {
        applyInk(host, state.wordmark);
        applyWordmarkSizing(host, state.wordmark);
        watchHost(host);
        continue;
      }
    }
    // Every candidate is watched, patched or not: a slot that gets a box
    // later must be picked up without waiting for the next search cycle.
    if (setPremiumLogo(host, true, document)) watchHost(host);
    else watchHost(host);
  }

  if (hosts.length > 0) {
    trace.state = trace.patchedHosts > 0 ? 'active'
      : trace.renderedHosts > 0 ? 'idle'
        : 'waiting';
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
  // cleanup() releases the theme watchers; re-arm them with the search cycle.
  startThemeObserver();
  startThemeMediaQuery();

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
    // Nothing was patched yet (the header mounts later on a slow cold start):
    // re-arm a bounded number of short search cycles instead of watching the
    // whole document forever.
    if (!cleanupRequested && trace.patchedHosts === 0
        && trace.attempts < MAX_PATCH_ATTEMPTS && configRead('enablePremiumLogo')) {
      searchRetry = setTimeout(() => {
        searchRetry = null;
        if (!cleanupRequested) startObserver(true);
      }, SEARCH_RETRY_DELAY_MS);
    }
  }, OBSERVATION_WINDOW_MS);

  scheduleReconcile();
}

function onNavigation() {
  if (!configRead('enablePremiumLogo')) return;
  // Drop stale references: Polymer replaces the header on navigation.
  forgetDetachedHosts();
  // The header (and with it the theme token) may have been replaced.
  refreshInk(document);
  // A pagehide cleanup followed by a pageshow return must be able to re-arm the
  // bounded observation cycle without reloading the userscript.
  startObserver(true);
}

/**
 * `observedHosts` holds every patched or watched host, so cleanup can reach
 * hosts that the document query can no longer see (detached subtrees are
 * invisible to querySelectorAll). Without this, each route change that
 * replaces the header would leave a stale observer and patch entry behind.
 */
function forgetDetachedHosts() {
  for (const host of Array.from(observedHosts)) {
    if (host.isConnected === false) {
      restoreHost(host);
    }
  }
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
  stopThemeWatchers();
  for (const host of Array.from(observedHosts)) stopHostObserver(host);
  if (reconcileTimer !== null) clearTimeout(reconcileTimer);
  reconcileTimer = null;
  if (typeof document !== 'undefined' && document.body) forgetHosts(document);
  // Route/config/page listeners stay installed so a back-forward-cache return
  // can start a fresh bounded cycle without reloading the userscript.
}

// ---------------------------------------------------------------------------
// Theme changes: refresh the ink without touching the emblem paint
// ---------------------------------------------------------------------------

let themeObserver = null;
let themeMediaQuery = null;
let themeMediaListener = null;
let themeRefreshTimer = null;

function onThemeChange() {
  if (cleanupRequested) return;
  if (!configRead('enablePremiumLogo')) return;
  if (themeRefreshTimer !== null) return;
  // Debounced: app theme switches flip several root attributes at once.
  themeRefreshTimer = setTimeout(() => {
    themeRefreshTimer = null;
    if (cleanupRequested) return;
    if (typeof document === 'undefined' || !document.body) return;
    refreshInk(document);
  }, RECONCILE_DELAY_MS);
}

function startThemeObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const roots = [document.documentElement, document.body].filter(Boolean);
  if (!roots.length) return;
  if (themeObserver) themeObserver.disconnect();
  themeObserver = new MutationObserver(() => onThemeChange());
  for (const root of roots) {
    // Scoped to the document root's own attributes: no subtree, no pages.
    themeObserver.observe(root, { attributes: true, attributeFilter: THEME_HINT_ATTRIBUTES });
  }
}

function startThemeMediaQuery() {
  const win = activeWindow();
  if (!win || typeof win.matchMedia !== 'function') return;
  if (themeMediaQuery && themeMediaListener) return;
  try {
    themeMediaQuery = win.matchMedia('(prefers-color-scheme: dark)');
  } catch (_) {
    themeMediaQuery = null;
    return;
  }
  if (!themeMediaQuery) return;
  themeMediaListener = () => onThemeChange();
  if (typeof themeMediaQuery.addEventListener === 'function') {
    themeMediaQuery.addEventListener('change', themeMediaListener);
  } else if (typeof themeMediaQuery.addListener === 'function') {
    themeMediaQuery.addListener(themeMediaListener);
  }
}

function stopThemeWatchers() {
  if (themeObserver) themeObserver.disconnect();
  themeObserver = null;
  if (themeRefreshTimer !== null) clearTimeout(themeRefreshTimer);
  themeRefreshTimer = null;
  if (themeMediaQuery && themeMediaListener) {
    try {
      if (typeof themeMediaQuery.removeEventListener === 'function') {
        themeMediaQuery.removeEventListener('change', themeMediaListener);
      } else if (typeof themeMediaQuery.removeListener === 'function') {
        themeMediaQuery.removeListener(themeMediaListener);
      }
    } catch (_) {
      /* nothing to release */
    }
  }
  themeMediaQuery = null;
  themeMediaListener = null;
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
  startThemeMediaQuery();
  if (document.body) {
    startThemeObserver();
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      startThemeObserver();
      startObserver();
    }, { once: true });
  }
}

configChangeEmitter.addEventListener('configChange', onConfigChange);
initialize();

export { onNavigation };
