/** Live TV components keep semantic element names even when CSS classes are
 * obfuscated. Inline fallbacks avoid depending on a conditional CSS parser.
 * No media, artwork, fullscreen overlay stage or arbitrary descendants are painted. */
export const LIVE_OLED = [
  '#container', '#app-background', 'ytlr-tv-browse-renderer', 'ytlr-tv-surface-content-renderer',
  'ytlr-guide-response', 'ytlr-classic-search-page', 'ytlr-account-selector',
  'ytlr-overlay-panel-renderer', 'ytlr-overlay-panel-header-renderer', 'yt-overlay-toast-renderer',
];
export const LIVE_GLASS = [
  'ytlr-guide-response', 'ytlr-search-bar ytlr-text-box',
  'ytlr-overlay-panel-renderer', 'yt-overlay-toast-renderer',
];
const FOCUS = 'yt-button-container.zylon-focus, ytlr-button.zylon-focus';
const INTEREST = [...LIVE_OLED, ...LIVE_GLASS, FOCUS].join(',');
const ORIGINAL_ATTRIBUTE = 'data-ytark-appearance-original';
const SAFE_PROPERTY = /^(?:background-(?:color|image)|box-sizing|backdrop-filter|border-(?:(?:top|right|bottom|left)-(?:color|width|style)|(?:top-left|top-right|bottom-left|bottom-right)-radius))$/;
const MEDIA = 'video, img, canvas, svg, ytlr-thumbnail-details, .caption-window, .captions-text';
export function createLiveAppearance({ documentObject, read, windowObject = null } = {}) {
  const d = documentObject;
  const w = windowObject || (d && d.defaultView);
  const originals = new Map();
  let observer = null;
  let timer = null;
  let running = false;
  let full = false;
  let applying = false;
  let mediaQuery = null;
  const onTransparencyChange = () => queue(true);
  const changed = new Set();
  let counts = { oled:0, glass:0, blur:false };
  const enabled = () => read('oledBlack') === true || read('liquidGlass') === true;
  function remember(node, key) {
    if (!originals.has(node)) {
      // Navigation animations may clone themed components. A bounded snapshot
      // travels with such a clone so disabling the theme still restores it.
      let saved = [];
      try {
        const value = JSON.parse(node.getAttribute?.(ORIGINAL_ATTRIBUTE) || 'null');
        if (Array.isArray(value) && value.length <= 32) saved = value.filter(entry =>
          Array.isArray(entry) && SAFE_PROPERTY.test(entry[0]) && Array.isArray(entry[1])
          && typeof entry[1][0] === 'string' && entry[1][0].length <= 1024
          && ['', 'important'].includes(entry[1][1]));
      } catch (_) { /* malformed metadata never changes unrelated styles */ }
      originals.set(node, new Map(saved));
    }
    const props = originals.get(node);
    if (!props.has(key)) props.set(key, [node.style.getPropertyValue(key), node.style.getPropertyPriority(key)]);
  }
  function paint(node, values) {
    if (!node || !node.style || node.matches?.(MEDIA)) return;
    if (!originals.has(node) && originals.size >= 256) return;
    for (const key of Object.keys(values)) {
      remember(node, key);
      if (node.style.getPropertyValue(key) !== values[key] || node.style.getPropertyPriority(key) !== 'important') {
        node.style.setProperty(key, values[key], 'important');
      }
    }
    node.setAttribute?.(ORIGINAL_ATTRIBUTE, JSON.stringify([...originals.get(node)]));
  }
  function restore(node) {
    const props = originals.get(node);
    if (!props) return;
    for (const [key, [value, priority]] of props) {
      if (value) node.style.setProperty(key, value, priority);
      else node.style.removeProperty(key);
    }
    originals.delete(node);
    node.removeAttribute?.(ORIGINAL_ATTRIBUTE);
  }
  function nodes(selector) { try { return Array.from(d.querySelectorAll(selector)); } catch (_) { return []; } }
  function blurSupported() { try { return !!w?.CSS?.supports?.('backdrop-filter', 'blur(8px)'); } catch (_) { return false; } }
  function focus(node) {
    if (!node || !node.matches?.('yt-button-container, ytlr-button')) return;
    restore(node);
    if (!read('liquidGlass') || !node.matches(FOCUS) || !w?.getComputedStyle) return;
    // zylon-focus is also present on entire ancestor chains; only leaf buttons
    // with the native bright focus fill receive the glass focus gradient.
    const match = w.getComputedStyle(node).backgroundColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match || match.slice(1).some(value => Number(value) < 180)) return;
    paint(node, { 'background-image':'linear-gradient(135deg, rgb(255, 255, 255), rgb(215, 225, 242))' });
  }
  function apply() {
    if (!d || !d.body || applying) return;
    applying = true;
    try {
      for (const node of [...originals.keys()]) restore(node);
      counts = { oled:0, glass:0, blur:blurSupported() };
      if (!enabled()) {
        if (observer) observer.disconnect();
        observer=null; running=false;
        mediaQuery?.removeEventListener?.('change', onTransparencyChange);
        mediaQuery=null;
        return;
      }
      const watch = /WEB_PAGE_TYPE_(WATCH|SHORTS)/.test(d.body.className || '');
      if (read('oledBlack') === true) {
        for (const node of nodes(LIVE_OLED.join(','))) {
          // Browse surfaces can cover the separate player layer in watch mode.
          if (watch && node.matches?.('ytlr-tv-browse-renderer, ytlr-tv-surface-content-renderer')) continue;
          paint(node, {'background-color':'rgb(0, 0, 0)'});
          counts.oled += 1;
        }
      }
      if (read('liquidGlass') === true) {
        let reduce = false;
        try { reduce = w?.matchMedia?.('(prefers-reduced-transparency: reduce), (prefers-reduced-motion: reduce)').matches === true; } catch (_) { /* unavailable */ }
        for (const node of nodes(LIVE_GLASS.join(','))) {
          const values = {
            'background-color': reduce ? 'rgb(24, 28, 36)' : 'rgba(24, 28, 36, 0.9)',
            'background-image':'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.015))',
            'box-sizing':'border-box',
          };
          for (const side of ['top','right','bottom','left']) {
            values[`border-${side}-color`]='rgba(255, 255, 255, 0.3)';
            values[`border-${side}-width`]='1px';
            values[`border-${side}-style`]='solid';
          }
          for (const corner of ['top-left','top-right','bottom-left','bottom-right']) values[`border-${corner}-radius`]='1.25rem';
          values['backdrop-filter']=counts.blur && !reduce ? 'blur(8px)' : 'none';
          paint(node, values);
          counts.glass += 1;
        }
        for (const node of nodes(FOCUS)) focus(node);
      }
    } finally { applying = false; }
  }
  function queue(needsFull, node = null) {
    full = full || needsFull;
    if (node) changed.add(node);
    if (timer !== null) return;
    const later = w?.requestAnimationFrame ? callback => w.requestAnimationFrame(callback) : callback => setTimeout(callback, 16);
    timer = later(() => {
      timer = null;
      if (!running || !enabled()) { changed.clear(); full=false; return; }
      for (const node of [...originals.keys()]) if (node.isConnected === false) restore(node);
      if (full) apply();
      else for (const target of changed) focus(target);
      changed.clear(); full=false;
    });
  }
  function start() {
    if (!d || !d.body || running || !enabled()) return;
    running = true;
    try {
      mediaQuery=w?.matchMedia?.('(prefers-reduced-transparency: reduce), (prefers-reduced-motion: reduce)') || null;
      mediaQuery?.addEventListener?.('change', onTransparencyChange);
    } catch (_) { /* unavailable */ }
    const Observer = w?.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    if (!Observer) return;
    observer = new Observer(records => {
      if (!enabled() || applying) return;
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target === d.body) queue(true);
          else if (record.target.matches?.('yt-button-container, ytlr-button')) queue(false, record.target);
          continue;
        }
        for (const node of [...record.addedNodes || [], ...record.removedNodes || []]) {
          if (node.nodeType === 1 && (node.matches?.(INTEREST) || node.querySelector?.(INTEREST))) { queue(true); break; }
        }
      }
    });
    // Deliberately omit style attributes: our own writes cannot form a loop.
    observer.observe(d.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  }
  function status() {
    const sample = nodes('#container')[0];
    let background = 'unavailable';
    try { if (sample && w?.getComputedStyle) background = w.getComputedStyle(sample).backgroundColor; } catch (_) { /* unavailable */ }
    return { ...counts, background, managedNodes:originals.size };
  }
  function destroy() {
    running = false;
    mediaQuery?.removeEventListener?.('change', onTransparencyChange);
    mediaQuery=null;
    if (observer) observer.disconnect();
    observer=null;
    if (timer !== null) {
      if (w?.cancelAnimationFrame) w.cancelAnimationFrame(timer); else clearTimeout(timer);
      timer=null;
    }
    for (const node of [...originals.keys()]) restore(node);
    changed.clear(); full=false;
  }
  return { apply, start, status, destroy };
}
