/**
 * "Hide channel watermark" (Appearance > Player).
 *
 * The clickable channel watermark (the "branding watermark" a channel sets in
 * YouTube Studio) reaches a player as one renderer:
 *
 *   playerResponse.annotations[i].playerAnnotationsExpandedRenderer.featuredChannel
 *     { watermark: { thumbnails: [{ url: 'https://i.ytimg.com/an/<id>/featured_channel.jpg?...' }] },
 *       navigationEndpoint, channelName, subscribeButton, startTimeMs, endTimeMs }
 *
 * Primary path (renderer identity): while the setting is on, that annotation
 * is taken out of each player response before the frontend reads it, so no
 * watermark node, click target or focus target is ever created and nothing
 * flashes on video changes, fullscreen transitions or re-renders. The removed
 * entries are kept (non-enumerable `__ytarkHiddenAnnotations` on the response
 * plus a bounded in-memory list) and are put back into the same arrays when
 * the setting is turned off, so a frontend that re-reads a cached response
 * gets the original data again.
 *
 * Safety net (turning the setting on during a video): an already rendered
 * watermark is found only inside the player and only by the exact image URL
 * of a featuredChannel renderer seen in a response. Its container is marked
 * `data-ytark-watermark="hidden"` (hidden by the managed stylesheet) and made
 * non-focusable; every attribute is restored on disable. Channel avatars in
 * feeds, headers, comments and account menus use other URLs and live outside
 * the player, so they are never matched. Watermarks burned into the video
 * pixels are part of the picture and cannot be removed.
 *
 * Current YouTube TV frontends may not draw the branding watermark at all; in
 * that case there is simply nothing to remove and every path is a no-op.
 */

import { configRead, configChangeEmitter } from '../config.js';
import { WATERMARK_ATTRIBUTE } from '../ui/appearanceStyles.js';

const HIDDEN_VALUE = 'hidden';
const HIDDEN_PROPERTY = '__ytarkHiddenAnnotations';
const MAX_RECORDS = 12;
const MAX_URLS = 24;
const MAX_SCANNED_NODES = 4000;
const MAX_CLIMB = 6;

export const PLAYER_ROOT_SELECTOR = 'ytlr-watch-default, ytlr-player, ytlr-player-container, .html5-video-player';
const PLAYER_CHROME_SELECTOR = 'video, ytlr-progress-bar, ytlr-redux-connect-ytlr-progress-bar, [idomkey="player-bar-renderer"], [idomkey="progress-bar"], [idomkey="slider"]';
const FOCUSABLE_SELECTOR = 'button, a, [tabindex], [hybridnavfocusable="true"], [role="button"], [role="link"]';

/** Recently processed annotation lists (strong refs to small arrays only). */
const records = [];
/** Exact watermark image URLs seen in featuredChannel renderers. */
const watermarkUrls = [];
/** element -> original attribute snapshot for restoration. */
const hiddenNodes = new Map();

export const trace = { stripped: 0, restored: 0, domHidden: 0, lastAction: 'idle' };

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isFeaturedChannelAnnotation(entry) {
  return isPlainObject(entry)
    && isPlainObject(entry.playerAnnotationsExpandedRenderer)
    && isPlainObject(entry.playerAnnotationsExpandedRenderer.featuredChannel);
}

export function watermarkUrlsOf(entry) {
  if (!isFeaturedChannelAnnotation(entry)) return [];
  const thumbs = entry.playerAnnotationsExpandedRenderer.featuredChannel.watermark
    && entry.playerAnnotationsExpandedRenderer.featuredChannel.watermark.thumbnails;
  if (!Array.isArray(thumbs)) return [];
  return thumbs
    .map(thumb => (thumb && typeof thumb.url === 'string' ? thumb.url : ''))
    .filter(url => url && url.length <= 1000);
}

function rememberUrl(url) {
  if (!url || watermarkUrls.includes(url)) return;
  watermarkUrls.push(url);
  while (watermarkUrls.length > MAX_URLS) watermarkUrls.shift();
}

function rememberRecord(record) {
  const existing = records.findIndex(item => item.list === record.list);
  if (existing !== -1) records.splice(existing, 1);
  records.push(record);
  while (records.length > MAX_RECORDS) records.shift();
}

function responseTargets(response) {
  if (!isPlainObject(response)) return [];
  const targets = [response];
  if (isPlainObject(response.playerResponse)) targets.push(response.playerResponse);
  return targets;
}

function defineHidden(target, removed) {
  try {
    const previous = Object.prototype.hasOwnProperty.call(target, HIDDEN_PROPERTY) ? target[HIDDEN_PROPERTY] : [];
    Object.defineProperty(target, HIDDEN_PROPERTY, {
      value: previous.concat(removed.map(item => item.value)),
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch (_) {
    /* frozen response: the in-memory record still allows restoration */
  }
}

function stripList(target) {
  const list = target.annotations;
  const removed = [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (isFeaturedChannelAnnotation(list[index])) {
      removed.unshift({ index, value: list.splice(index, 1)[0] });
    }
  }
  if (!removed.length) return 0;
  const record = records.find(item => item.list === list) || { list, removed: [] };
  record.removed = record.removed.concat(removed).sort((a, b) => a.index - b.index);
  rememberRecord(record);
  defineHidden(target, removed);
  trace.stripped += removed.length;
  return removed.length;
}

/**
 * Process one parsed InnerTube response. Always records the watermark URLs
 * (so the DOM safety net can recognise an already drawn watermark later) and
 * removes featuredChannel annotations when `enabled`.
 * @returns {number} number of annotations removed
 */
export function filterWatermarkAnnotations(response, enabled = configRead('hidePlayerWatermark') === true) {
  let removed = 0;
  for (const target of responseTargets(response)) {
    const list = target.annotations;
    if (!Array.isArray(list) || !list.length) continue;
    let hasWatermark = false;
    for (const entry of list) {
      const urls = watermarkUrlsOf(entry);
      if (urls.length || isFeaturedChannelAnnotation(entry)) hasWatermark = true;
      urls.forEach(rememberUrl);
    }
    if (!hasWatermark) continue;
    if (enabled) {
      removed += stripList(target);
    } else {
      // Remember the list so turning the setting on can strip cached data too.
      if (!records.some(item => item.list === list)) rememberRecord({ list, removed: [] });
    }
  }
  return removed;
}

/** Strip watermark annotations from recently seen (possibly cached) responses. */
export function stripRememberedAnnotations() {
  let removed = 0;
  for (const record of records.slice()) {
    const list = record.list;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (isFeaturedChannelAnnotation(list[index])) {
        record.removed.push({ index, value: list.splice(index, 1)[0] });
        removed += 1;
      }
    }
    record.removed.sort((a, b) => a.index - b.index);
  }
  trace.stripped += removed;
  return removed;
}

/** Put every removed annotation back where it was. */
export function restoreWatermarkAnnotations() {
  let restored = 0;
  for (const record of records) {
    const list = record.list;
    for (const item of record.removed) {
      if (list.includes(item.value)) continue;
      list.splice(Math.min(item.index, list.length), 0, item.value);
      restored += 1;
    }
    record.removed = [];
  }
  trace.restored += restored;
  return restored;
}

// ---------------------------------------------------------------------------
// DOM safety net
// ---------------------------------------------------------------------------

function documentRef(d) {
  return d || (typeof document !== 'undefined' ? document : null);
}

function referencedUrl(element) {
  if (!element || typeof element.getAttribute !== 'function') return '';
  const src = element.getAttribute('src') || '';
  let background = '';
  try {
    background = element.style && typeof element.style.getPropertyValue === 'function'
      ? String(element.style.getPropertyValue('background-image') || '') : '';
  } catch (_) {
    background = '';
  }
  return `${src} ${background}`;
}

function matchesKnownWatermark(element, urls) {
  const text = referencedUrl(element);
  if (!text.trim()) return false;
  return urls.some(url => text.includes(url));
}

function containsChrome(element) {
  if (!element || typeof element.querySelector !== 'function') return false;
  try {
    if (element.matches && element.matches(PLAYER_CHROME_SELECTOR)) return true;
    return !!element.querySelector(PLAYER_CHROME_SELECTOR);
  } catch (_) {
    return true;
  }
}

function elementChildren(element) {
  return Array.from(element && element.children ? element.children : []);
}

/** Bounded depth-first list of element descendants (document order). */
function descendants(root, limit = MAX_SCANNED_NODES) {
  const result = [];
  const stack = elementChildren(root).reverse();
  while (stack.length && result.length < limit) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) continue;
    result.push(node);
    const kids = elementChildren(node);
    for (let index = kids.length - 1; index >= 0; index -= 1) stack.push(kids[index]);
  }
  return result;
}

function isFocusTarget(element) {
  if (!element || typeof element.getAttribute !== 'function') return false;
  const tag = String(element.tagName || '').toLowerCase();
  if (tag === 'a' || tag === 'button') return true;
  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== undefined && Number(tabindex) >= 0) return true;
  if (element.getAttribute('hybridnavfocusable') === 'true') return true;
  const role = element.getAttribute('role');
  return role === 'button' || role === 'link';
}

function ownText(element, except) {
  const all = typeof element.textContent === 'string' ? element.textContent : '';
  const inner = except && typeof except.textContent === 'string' ? except.textContent : '';
  return (inner ? all.replace(inner, '') : all).trim();
}

/** True when `container` shows anything besides `except` (text or imagery). */
function hasOtherContent(container, except) {
  if (ownText(container, except)) return true;
  for (const node of descendants(container)) {
    if (isInside(node, except)) continue;
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'img' || tag === 'svg' || tag === 'canvas' || tag === 'video' || tag === 'yt-icon') return true;
    if (referencedUrl(node).trim()) return true;
    if (typeof node.textContent === 'string' && node.textContent.trim()) return true;
  }
  return false;
}

/**
 * The container to hide for one matched watermark image. Conservative: it
 * climbs only through wrappers that hold nothing but the watermark (a single
 * child, or a focus/click target with no other text or imagery), never past
 * the player root and never into anything holding the video, the progress bar
 * or other player controls. Sibling overlays (skip buttons, end screens,
 * captions, SponsorBlock markers) therefore stay untouched.
 */
export function watermarkHostFor(element, root) {
  let host = element;
  for (let depth = 0; depth < MAX_CLIMB; depth += 1) {
    const parent = host.parentNode;
    if (!parent || parent === root || typeof parent.getAttribute !== 'function') break;
    if (containsChrome(parent)) break;
    const kids = elementChildren(parent);
    const exclusive = kids.length === 1 && kids[0] === host && !ownText(parent, host);
    if (exclusive || (isFocusTarget(parent) && !hasOtherContent(parent, host))) {
      host = parent;
      continue;
    }
    break;
  }
  return host;
}

function playerRoots(d) {
  if (!d || typeof d.querySelectorAll !== 'function') return [];
  let roots = [];
  try {
    roots = Array.from(d.querySelectorAll(PLAYER_ROOT_SELECTOR));
  } catch (_) {
    roots = [];
  }
  // Keep only outermost roots so nested player wrappers are scanned once.
  return roots.filter(root => !roots.some(other => other !== root && other.contains && other.contains(root)));
}

/** Find rendered watermark hosts inside the player for the known URLs. */
export function findRenderedWatermarks(d = documentRef(), urls = watermarkUrls) {
  const target = documentRef(d);
  if (!target || !urls.length) return [];
  const hosts = [];
  for (const root of playerRoots(target)) {
    for (const node of descendants(root)) {
      if (!matchesKnownWatermark(node, urls)) continue;
      const host = watermarkHostFor(node, root);
      if (!hosts.includes(host)) hosts.push(host);
    }
  }
  return hosts;
}

function snapshot(element) {
  return {
    ariaHidden: element.getAttribute('aria-hidden'),
    tabindex: element.getAttribute('tabindex'),
  };
}

function restoreAttribute(element, name, value) {
  if (value === null || value === undefined) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function focusableWithin(element) {
  const list = [];
  try {
    if (element.matches && element.matches(FOCUSABLE_SELECTOR)) list.push(element);
    if (element.querySelectorAll) list.push(...Array.from(element.querySelectorAll(FOCUSABLE_SELECTOR)));
  } catch (_) {
    /* unsupported selector: nothing extra to neutralise */
  }
  return list;
}

function isInside(node, container) {
  let current = node;
  while (current) {
    if (current === container) return true;
    current = current.parentNode;
  }
  return false;
}

/** Move focus out of a container that is about to be hidden. */
export function moveFocusOutOf(container, d = documentRef()) {
  const target = documentRef(d);
  const active = target && target.activeElement;
  if (!active || !isInside(active, container)) return null;
  const roots = playerRoots(target);
  const root = roots.find(candidate => isInside(container, candidate)) || roots[0] || null;
  let fallback = null;
  if (root) {
    try {
      fallback = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).find(node => !isInside(node, container)
        && node.getAttribute(WATERMARK_ATTRIBUTE) !== HIDDEN_VALUE
        && node.getAttribute('aria-hidden') !== 'true'
        && node.getAttribute('tabindex') !== '-1') || null;
    } catch (_) {
      fallback = null;
    }
    if (!fallback && typeof root.focus === 'function') fallback = root;
  }
  if (fallback && typeof fallback.focus === 'function') {
    fallback.focus();
    return fallback;
  }
  if (typeof active.blur === 'function') active.blur();
  return null;
}

function hideHost(host, d) {
  if (hiddenNodes.has(host)) return false;
  moveFocusOutOf(host, d);
  const saved = [];
  for (const element of focusableWithin(host)) {
    saved.push({ element, ...snapshot(element) });
    element.setAttribute('tabindex', '-1');
  }
  if (!saved.some(item => item.element === host)) saved.push({ element: host, ...snapshot(host) });
  hiddenNodes.set(host, saved);
  host.setAttribute(WATERMARK_ATTRIBUTE, HIDDEN_VALUE);
  host.setAttribute('aria-hidden', 'true');
  trace.domHidden += 1;
  return true;
}

function restoreHost(host) {
  const saved = hiddenNodes.get(host);
  if (!saved) return false;
  if (host.getAttribute && host.getAttribute(WATERMARK_ATTRIBUTE) === HIDDEN_VALUE) {
    host.removeAttribute(WATERMARK_ATTRIBUTE);
  }
  for (const item of saved) {
    restoreAttribute(item.element, 'aria-hidden', item.ariaHidden);
    restoreAttribute(item.element, 'tabindex', item.tabindex);
  }
  hiddenNodes.delete(host);
  return true;
}

export function hideRenderedWatermarks(d = documentRef()) {
  let count = 0;
  for (const host of findRenderedWatermarks(d)) {
    if (hideHost(host, d)) count += 1;
  }
  return count;
}

export function restoreRenderedWatermarks() {
  let count = 0;
  for (const host of Array.from(hiddenNodes.keys())) {
    if (restoreHost(host)) count += 1;
  }
  return count;
}

/**
 * A reused node must not stay hidden once it no longer shows a watermark
 * (incremental DOM can recycle a node for different content).
 */
export function revalidateHiddenHosts() {
  let released = 0;
  for (const host of Array.from(hiddenNodes.keys())) {
    const stillWatermark = host.isConnected !== false
      && (matchesKnownWatermark(host, watermarkUrls)
        || descendants(host).some(node => matchesKnownWatermark(node, watermarkUrls)));
    if (!stillWatermark) {
      restoreHost(host);
      released += 1;
    }
  }
  return released;
}

export function hiddenHostCount() {
  return hiddenNodes.size;
}

export function knownWatermarkUrls() {
  return watermarkUrls.slice();
}

/** Apply the current setting to cached responses and the drawn player. */
export function applyWatermarkSetting(enabled = configRead('hidePlayerWatermark') === true, d = documentRef()) {
  if (enabled) {
    stripRememberedAnnotations();
    hideRenderedWatermarks(d);
    trace.lastAction = 'enabled';
  } else {
    restoreRenderedWatermarks();
    restoreWatermarkAnnotations();
    trace.lastAction = 'disabled';
  }
}

export function resetWatermarkStateForTests() {
  records.length = 0;
  watermarkUrls.length = 0;
  hiddenNodes.clear();
  trace.stripped = 0;
  trace.restored = 0;
  trace.domHidden = 0;
  trace.lastAction = 'idle';
}

function onConfigChange(event) {
  if (!event || !event.detail || event.detail.key !== 'hidePlayerWatermark') return;
  applyWatermarkSetting(event.detail.value === true);
}

function onRouteChange() {
  if (hiddenNodes.size) revalidateHiddenHosts();
}

const installedFlag = '__ytarkWatermarkInstalled';
if (typeof window !== 'undefined' && !window[installedFlag]) {
  try {
    window[installedFlag] = true;
  } catch (_) {
    /* continue without the guard */
  }
  configChangeEmitter.addEventListener('configChange', onConfigChange);
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('hashchange', onRouteChange, false);
  }
}
