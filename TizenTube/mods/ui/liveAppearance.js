/** Live TV components keep semantic element names even when CSS classes are
 * obfuscated. Inline fallbacks avoid depending on a conditional CSS parser.
 * No media, artwork, fullscreen overlay stage or arbitrary descendants are painted. */
export const LIVE_OLED = [
  '#container', '#app-background', 'ytlr-tv-browse-renderer', 'ytlr-tv-surface-content-renderer',
  'ytlr-guide-response', 'ytlr-classic-search-page', 'ytlr-account-selector',
  'yt-overlay-toast-renderer',
];
export const LIVE_GLASS = [
  'ytlr-guide-response', 'ytlr-search-bar ytlr-text-box',
  'yt-overlay-toast-renderer',
  '[role="tablist"]', '[role="tablist"] > [role="tab"]', '[role="tab"][aria-selected="true"]',
];
const PANEL_HEADER = 'ytlr-overlay-panel-header-renderer';
const INTEREST = [...LIVE_OLED, ...LIVE_GLASS, PANEL_HEADER].join(',');
const ORIGINAL_ATTRIBUTE = 'data-ytark-appearance-original';
const SAFE_PROPERTY = /^(?:background-(?:color|image)|box-sizing|backdrop-filter|box-shadow|border-(?:(?:top|right|bottom|left)-(?:color|width|style)|(?:top-left|top-right|bottom-left|bottom-right)-radius))$/;
const MEDIA = 'video, img, canvas, svg, ytlr-thumbnail-details, .caption-window, .captions-text';
export function createLiveAppearance({ documentObject, read, windowObject = null } = {}) {
  const d = documentObject;
  const w = windowObject || (d && d.defaultView);
  const originals = new Map();
  let observer = null;
  let routeObserver = null;
  let lastWatch = false;
  let timer = null;
  let running = false;
  let full = false;
  let applying = false;
  let mediaQuery = null;
  const onTransparencyChange = () => queue(true);
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
  function blurSupported() { try { return !!w?.CSS?.supports?.('backdrop-filter', 'blur(4px)'); } catch (_) { return false; } }
  const isWatch = () => /WEB_PAGE_TYPE_(WATCH|SHORTS)/.test(d.body.className || '');
  function panelSurfaces() {
    const viewport = w?.innerWidth || d.documentElement?.clientWidth || 0;
    const height = w?.innerHeight || d.documentElement?.clientHeight || 0;
    if (!viewport) return [];
    // Renderer content can itself be a fullscreen host. Only theme a visibly
    // bounded panel; never paint the full-screen overlay that contains it.
    const panels = new Set(nodes('.ytLrOverlayPanelRendererContent, .ytLrOverlayTwoPanelRendererActionPanel').filter(node => {
      const rect = node.getBoundingClientRect?.();
      return !!rect && rect.width >= viewport * 0.15 && rect.width < viewport * 0.85
        && (!height || rect.height <= height * 1.05);
    }));
    for (const header of nodes(PANEL_HEADER)) {
      // The semantic panel renderer may span the entire screen. Find the
      // bounded side panel around its header, never style the fullscreen host.
      let candidate = null;
      for (let node = header.parentElement; node && node !== d.body; node = node.parentElement) {
        const rect = node.getBoundingClientRect?.();
        if (!rect || rect.width <= 0) continue;
        if (rect.width >= viewport * 0.85) break;
        if (rect.width >= viewport * 0.15) candidate = node;
      }
      if (candidate) panels.add(candidate);
    }
    return [...panels];
  }
  function apply() {
    if (!d || !d.body || applying) return;
    applying = true;
    try {
      for (const node of [...originals.keys()]) restore(node);
      counts = { oled:0, glass:0, blur:blurSupported() };
      if (!enabled()) {
        if (observer) observer.disconnect();
        observer=null; routeObserver?.disconnect(); routeObserver=null; running=false;
        mediaQuery?.removeEventListener?.('change', onTransparencyChange);
        mediaQuery=null;
        return;
      }
      const watch = isWatch();
      lastWatch = watch;
      const panels = panelSurfaces();
      if (read('oledBlack') === true) {
        for (const node of [...nodes(LIVE_OLED.join(',')), ...panels]) {
          // Browse surfaces can cover the separate player layer in watch mode.
          if (watch && node.matches?.('ytlr-tv-browse-renderer, ytlr-tv-surface-content-renderer')) continue;
          paint(node, {'background-color':'rgb(0, 0, 0)', 'background-image':'none'});
          counts.oled += 1;
        }
      }
      if (enabled()) for (const header of nodes(PANEL_HEADER)) {
        paint(header, {'background-color':'transparent', 'background-image':'none'});
      }
      if (read('liquidGlass') === true) {
        let reduce = false;
        try { reduce = w?.matchMedia?.('(prefers-reduced-transparency: reduce), (prefers-reduced-motion: reduce)').matches === true; } catch (_) { /* unavailable */ }
        for (const node of [...nodes(LIVE_GLASS.join(',')), ...panels]) {
          const panel = panels.includes(node) || node.matches?.('.ytLrDialogRenderer, [role="tablist"]');
          const oled = read('oledBlack') === true;
          // A translucent panel over sharp text creates the reported double-text
          // effect. Keep enough opacity to occlude the page beneath it, then use
          // a restrained blur only where the browser actually supports it.
          const values = {
            'background-color': reduce
              ? (oled ? 'rgb(0, 0, 0)' : 'rgb(20, 24, 32)')
              : (oled ? 'rgba(0, 0, 0, 0.94)' : 'rgba(18, 22, 30, 0.92)'),
            'background-image': reduce
              ? 'none'
              : 'linear-gradient(145deg, rgba(255, 255, 255, 0.19), rgba(255, 255, 255, 0.055) 48%, rgba(255, 255, 255, 0.025))',
          };
          // Decorative edge is an inset shadow, not a CSS border: it cannot
          // consume layout space or change the dimensions of the native panel.
          values['box-shadow']='inset 0 0 0 1px rgba(255, 255, 255, 0.22), 0 0.5rem 1.5rem rgba(0, 0, 0, 0.22)';
          // Full-height menus and the guide never blur the underlying page.
          // During playback even small surfaces use the static clear tint.
          const small = node.matches?.('ytlr-search-bar ytlr-text-box, yt-overlay-toast-renderer');
          values['backdrop-filter'] = counts.blur && !reduce && !watch && (panel || small)
            ? (panel ? 'blur(10px)' : 'blur(6px)') : 'none';
          paint(node, values);
          counts.glass += 1;
        }
      }
    } finally { applying = false; }
  }
  function queue(needsFull) {
    full = full || needsFull;
    if (timer !== null) return;
    const later = w?.requestAnimationFrame ? callback => w.requestAnimationFrame(callback) : callback => setTimeout(callback, 16);
    timer = later(() => {
      timer = null;
      if (!running || !enabled()) { full=false; return; }
      for (const node of [...originals.keys()]) if (node.isConnected === false) restore(node);
      if (full) apply();
      full=false;
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
        for (const node of [...record.addedNodes || [], ...record.removedNodes || []]) {
          if (node.nodeType === 1 && (node.matches?.(INTEREST) || node.querySelector?.(INTEREST))) { queue(true); break; }
        }
      }
    });
    // Deliberately omit style attributes: our own writes cannot form a loop.
    observer.observe(d.body, { childList:true, subtree:true });
    lastWatch = isWatch();
    routeObserver = new Observer(() => {
      const watch = isWatch();
      if (watch !== lastWatch) { lastWatch = watch; queue(true); }
    });
    routeObserver.observe(d.body, { attributes:true, attributeFilter:['class'] });
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
    routeObserver?.disconnect(); routeObserver=null;
    if (timer !== null) {
      if (w?.cancelAnimationFrame) w.cancelAnimationFrame(timer); else clearTimeout(timer);
      timer=null;
    }
    for (const node of [...originals.keys()]) restore(node);
    full=false;
  }
  return { apply, start, status, destroy };
}
