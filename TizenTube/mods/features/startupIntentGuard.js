const STARTUP_INTENT_KEYS = new Set([
  8, 13, 27, 32, 36, 37, 38, 39, 40, 10009, 403, 404, 461,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
]);
const KEY_NAMES = new Map([
  ['Backspace', 8], ['Enter', 13], ['Escape', 27], ['Esc', 27],
  [' ', 32], ['Space', 32], ['Spacebar', 32], ['Home', 36],
  ['ArrowLeft', 37], ['ArrowUp', 38], ['ArrowRight', 39], ['ArrowDown', 40],
]);

function isTextEntry(target) {
  if (!target) return false;
  try {
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select'
      || target.isContentEditable === true || target.getAttribute?.('contenteditable') === 'true';
  } catch (_) { return true; }
}

function keyCode(event) {
  try {
    const numeric = Number(event && (event.keyCode || event.which || 0));
    if (Number.isInteger(numeric) && numeric > 0) return numeric;
    const key = String(event && event.key || '');
    if (KEY_NAMES.has(key)) return KEY_NAMES.get(key);
    if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
    if (/^Numpad[0-9]$/.test(key)) return 48 + Number(key.slice(-1));
    if (/^ColorF[0-9]$/.test(key)) return 403 + Number(key.slice(-1));
  } catch (_) { /* unrecognized input is ignored */ }
  return 0;
}

/**
 * Observes deliberate input only while startup navigation is pending. The
 * guard cancels a late automatic route but never prevents, stops, or retargets
 * the user's event. It is one-shot and removes all of its listeners on the
 * first relevant action or explicit disposal.
 */
export function installStartupIntentGuard({ documentObject, cancelNavigation } = {}) {
  if (!documentObject || typeof documentObject.addEventListener !== 'function'
      || typeof cancelNavigation !== 'function') {
    return { dispose() {}, get active() { return false; } };
  }
  let active = true;
  const listeners = [];
  const remove = () => {
    for (const [type, handler, capture] of listeners.splice(0)) {
      try { documentObject.removeEventListener(type, handler, capture); } catch (_) { /* best effort */ }
    }
  };
  const finish = () => {
    if (!active) return false;
    active = false;
    remove();
    try { cancelNavigation(); } catch (_) { /* cancellation must not affect input */ }
    return true;
  };
  const onKeyDown = (event) => {
    if (isTextEntry(event && event.target)) return;
    if (!STARTUP_INTENT_KEYS.has(keyCode(event))) return;
    finish();
  };
  const onPointer = () => finish();
  const listen = (type, handler) => {
    try {
      documentObject.addEventListener(type, handler, true);
      listeners.push([type, handler, true]);
    } catch (_) { /* environments without this event still keep the other guards */ }
  };
  listen('keydown', onKeyDown);
  listen('pointerdown', onPointer);
  listen('click', onPointer);
  listen('touchstart', onPointer);
  return {
    dispose() {
      if (!active) return;
      active = false;
      remove();
    },
    get active() { return active; },
  };
}

export default installStartupIntentGuard;
