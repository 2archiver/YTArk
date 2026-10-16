const BACK_KEYS = new Set([8, 27, 10009, 461]);
const PANEL_NAVIGATION_KEYS = new Set([13, 32, 37, 38, 39, 40]);
const SETTINGS_SHORTCUT_KEYS = new Set([403, 404]);

function codeOf(event) {
  try { return Number(event && (event.keyCode || event.which) || 0); }
  catch (_) { return 0; }
}

function isTextEntry(target) {
  if (!target) return false;
  try {
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select'
      || target.isContentEditable === true || target.getAttribute?.('contenteditable') === 'true';
  } catch (_) { return true; }
}

function consume(event) {
  try { event.preventDefault(); } catch (_) { /* synthetic/legacy event */ }
  try { event.stopImmediatePropagation(); } catch (_) { /* not supported */ }
  try { event.stopPropagation(); } catch (_) { /* not supported */ }
}

/**
 * Settings-scoped remote-input ownership. It does not take over ordinary
 * D-pad/OK navigation when the visible popup has focus; it blocks the legacy
 * colour-key shortcuts, routes Back through the visible popup's own dismissal
 * command, and guards against stale focus behind a detectable modal root.
 */
export function createSettingsInputOwner({
  isPanelOpen = () => false,
  dismissPanel = () => {},
  findModalRoot = () => null,
  restoreModalFocus = () => false,
} = {}) {
  const heldBackKeys = new Set();

  function handleKeyDown(event) {
    if (!event || event.type !== 'keydown') return false;
    const code = codeOf(event);
    if (heldBackKeys.has(code)) {
      consume(event);
      return true;
    }
    if (!isPanelOpen()) return false;
    if (SETTINGS_SHORTCUT_KEYS.has(code)) {
      consume(event);
      return true;
    }
    // Android TV text entry/IME Back belongs to the text-entry surface first.
    const eventTarget = event.target || (typeof document !== 'undefined' ? document.activeElement : null);
    if (isTextEntry(eventTarget)) return false;
    if (BACK_KEYS.has(code)) {
      heldBackKeys.add(code);
      consume(event);
      try { dismissPanel(); } catch (_) { /* keep the panel as the owner */ }
      return true;
    }
    if (!PANEL_NAVIGATION_KEYS.has(code)) return false;

    const root = findModalRoot();
    const target = event.target || (typeof document !== 'undefined' ? document.activeElement : null);
    let inside = false;
    try { inside = !!(root && target && (root === target || root.contains(target))); } catch (_) { inside = false; }
    if (root && !inside) {
      consume(event);
      try { restoreModalFocus(root); } catch (_) { /* focus restoration is best effort */ }
      return true;
    }
    // The popup's own focus/controller handles in-panel D-pad and OK events.
    return false;
  }

  function handleKeyUp(event) {
    if (!event || event.type !== 'keyup') return false;
    const code = codeOf(event);
    if (heldBackKeys.has(code)) {
      consume(event);
      heldBackKeys.delete(code);
      return true;
    }
    if (isPanelOpen() && SETTINGS_SHORTCUT_KEYS.has(code)) {
      consume(event);
      return true;
    }
    return false;
  }

  return {
    handleKeyDown,
    handleKeyUp,
    get heldBackKeyCount() { return heldBackKeys.size; },
  };
}

export default createSettingsInputOwner;
