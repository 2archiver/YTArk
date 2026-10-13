/**
 * Remote-friendly text entry for YTArk (used by Search settings).
 *
 * A small DOM panel with a real, editable <input>, plus a built-in on-screen
 * key grid for D-pad-only typing. The input is a real field, not a look-alike:
 * it takes the caret, receives no middleware, and is focused as soon as the
 * panel is in the document, because focusing an editable element is what makes
 * a platform input method appear where the platform provides one.
 *
 * Keyboard channels (no invented bridge)
 * -------------------------------------
 * The pinned Cobalt base's JavaScript bridge (`h5vcc.tizentube`) has no
 * keyboard/IME method — `h5vcc_tizentube.mojom` at the pinned base tag declares
 * only InstallAppFromURL, GetVersion, GetArchitecture, GetBrandAndModel,
 * SetFrameRate and SetUserAgent — so YTArk cannot call a native "show the
 * keyboard" function and does not pretend to. What it does instead:
 *
 *   - keeps a real editable element focused (the platform routes its own IME
 *     there when it has one: Android's `adjustResize` window, an Android TV
 *     remote-app keyboard or a browser/emulator IME),
 *   - calls the standard VirtualKeyboard API (`navigator.virtualKeyboard.show()`)
 *     when the engine implements it — feature-detected, never assumed,
 *   - re-focuses the field for the first moments after it opens, in case the
 *     frontend's own focus handling moves it,
 *   - and always offers the on-screen key grid, so typing works with the remote
 *     alone even where no input method exists (search must never be unusable).
 *
 * While open it listens at the window capture phase and keeps the YouTube
 * frontend from also reacting to the keys. Back closes the panel (Android closes
 * its own keyboard first, before the page sees Back) and returns focus to where
 * it was.
 *
 * Styling comes from the managed appearance stylesheet (`.ytark-entry*`),
 * which follows the shared tokens and the OLED theme.
 */

import { tx } from '../translations/text.js';

const BACK_KEY_CODES = [27, 461, 10009, 166];
const BACK_KEY_NAMES = ['Escape', 'GoBack', 'BrowserBack', 'Back'];
const ENTER = 13;
const ARROWS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
/** Re-focus attempts while the field is still the intended target (ms). */
const FOCUS_RETRY_DELAYS = [0, 80, 320, 900];

function currentWindow() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * Real input-method channels this engine exposes, if any. Only APIs that exist
 * are ever used; a platform without them yields an empty list, and the panel
 * then says so instead of pretending a TV keyboard was requested.
 */
export function platformKeyboardChannels(win = currentWindow()) {
  const channels = [];
  try {
    const virtual = win && win.navigator && win.navigator.virtualKeyboard;
    if (virtual && typeof virtual.show === 'function') channels.push('virtualKeyboard');
  } catch (_) {
    /* an engine without the API has no channel */
  }
  return channels;
}

function focusEditable(input, { caret = true } = {}) {
  if (typeof input.focus !== 'function') return false;
  try {
    input.focus({ preventScroll: true });
  } catch (_) {
    try {
      input.focus();
    } catch (_) {
      /* a non-focusable field is reported by the caller's status */
    }
  }
  if (caret) {
    try {
      const end = String(input.value || '').length;
      if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
    } catch (_) {
      /* engines without caret control keep the default position */
    }
  }
  return true;
}

/**
 * Focus the field and ask every real channel for the platform keyboard.
 * Returns the channel names that were actually requested (possibly none).
 */
export function requestPlatformKeyboard(input, win = currentWindow()) {
  const requested = [];
  if (!input) return requested;
  focusEditable(input);
  for (const channel of platformKeyboardChannels(win)) {
    try {
      if (channel === 'virtualKeyboard') {
        win.navigator.virtualKeyboard.show();
        requested.push(channel);
      }
    } catch (_) {
      /* the platform refused; the on-screen key grid still types */
    }
  }
  return requested;
}

const KEY_ROWS = [
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  ['i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'],
  ['q', 'r', 's', 't', 'u', 'v', 'w', 'x'],
  ['y', 'z', '0', '1', '2', '3', '4', '5'],
  ['6', '7', '8', '9', '-', '\'', 'space', 'delete'],
  ['clear', 'done'],
];

let active = null;

export function isBackKey(event) {
  if (!event) return false;
  return BACK_KEY_CODES.includes(Number(event.keyCode)) || BACK_KEY_NAMES.includes(event.key);
}

function keyLabel(key) {
  switch (key) {
    case 'space': return tx('ytark.entry.space', 'Space');
    case 'delete': return tx('ytark.entry.delete', 'Delete');
    case 'clear': return tx('ytark.entry.clear', 'Clear');
    case 'done': return tx('ytark.entry.done', 'Done');
    default: return key;
  }
}

function isInside(node, container) {
  let current = node;
  while (current) {
    if (current === container) return true;
    current = current.parentNode;
  }
  return false;
}

/**
 * Open the panel. Only one instance exists at a time.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.value]
 * @param {number} [options.maxLength]
 * @param {(text: string) => string} [options.onChange] returns a status line
 * @param {(text: string, reason: 'submit'|'back') => void} [options.onClose]
 */
export function openTextEntry(options = {}) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  if (active) active.close('replaced');
  const d = document;
  const maxLength = Math.max(1, Math.min(200, Number(options.maxLength) || 80));
  const previousFocus = d.activeElement || null;
  let closed = false;
  let statusTimer = null;
  const keyButtons = [];
  let focusRow = -1;
  let focusCol = 0;
  let focusTimers = [];
  let keyboardChannels = [];

  const root = d.createElement('div');
  root.setAttribute('class', 'ytark-entry');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('data-ytark-text-entry', 'true');

  const panel = d.createElement('div');
  panel.setAttribute('class', 'ytark-entry__panel');
  root.appendChild(panel);

  const title = d.createElement('div');
  title.setAttribute('class', 'ytark-entry__title');
  title.setAttribute('id', 'ytark-entry-title');
  title.textContent = String(options.title || tx('ytark.search.entry', 'Search settings'));
  panel.appendChild(title);
  root.setAttribute('aria-labelledby', 'ytark-entry-title');

  const input = d.createElement('input');
  input.setAttribute('class', 'ytark-entry__input');
  input.setAttribute('type', 'text');
  input.setAttribute('maxlength', String(maxLength));
  // These are what make a platform input method treat the field as a real text
  // field. They are plain HTML attributes, not a bridge call.
  input.setAttribute('inputmode', 'text');
  input.setAttribute('enterkeyhint', 'search');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('tabindex', '0');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-label', title.textContent);
  input.setAttribute('placeholder', tx('ytark.entry.placeholder', 'Type a setting name'));
  input.value = String(options.value || '').slice(0, maxLength);
  panel.appendChild(input);

  const status = d.createElement('div');
  status.setAttribute('class', 'ytark-entry__status');
  status.setAttribute('aria-live', 'polite');
  panel.appendChild(status);

  const keys = d.createElement('div');
  keys.setAttribute('class', 'ytark-entry__keys');
  keys.setAttribute('role', 'group');
  keys.setAttribute('aria-label', tx('ytark.entry.keyboard', 'On-screen keyboard'));
  panel.appendChild(keys);

  KEY_ROWS.forEach((row, rowIndex) => {
    keyButtons[rowIndex] = [];
    const keyRow = d.createElement('div');
    keyRow.setAttribute('class', 'ytark-entry__key-row');
    keys.appendChild(keyRow);
    row.forEach((key, colIndex) => {
      const button = d.createElement('button');
      button.setAttribute('type', 'button');
      button.setAttribute('tabindex', '-1');
      button.setAttribute('data-key', key);
      const wide = key.length > 1;
      button.setAttribute('class', wide ? 'ytark-entry__key ytark-entry__key--wide' : 'ytark-entry__key');
      button.textContent = keyLabel(key);
      if (wide) button.setAttribute('aria-label', keyLabel(key));
      button.__ytarkKey = { row: rowIndex, col: colIndex, key };
      keyRow.appendChild(button);
      keyButtons[rowIndex][colIndex] = button;
    });
  });

  const hint = d.createElement('div');
  hint.setAttribute('class', 'ytark-entry__hint');
  hint.textContent = tx('ytark.entry.hint', 'OK types · Down moves to the keyboard · Back closes this panel');
  panel.appendChild(hint);

  function value() {
    return String(input.value || '').slice(0, maxLength);
  }

  function updateStatus() {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    if (typeof options.onChange === 'function') {
      try {
        status.textContent = String(options.onChange(value()) || '');
      } catch (error) {
        console.warn('[YTArk] Text entry status failed:', error);
      }
    }
  }

  function scheduleStatus() {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = setTimeout(updateStatus, 120);
  }

  function setValue(next) {
    input.value = String(next).slice(0, maxLength);
    scheduleStatus();
  }

  function focusInput() {
    focusRow = -1;
    for (const row of keyButtons) for (const button of row) button.classList.remove('ytark-entry__key--focused');
    // Focus the real field and ask any real input-method channel this engine
    // exposes. An engine without one returns an empty list and the on-screen
    // key grid below stays the typing method.
    keyboardChannels = requestPlatformKeyboard(input, win);
    if (root.setAttribute) root.setAttribute('data-ytark-keyboard', keyboardChannels.join(' ') || 'on-screen');
  }

  /**
   * The frontend's own focus handling can move focus a moment after the panel
   * is appended. Re-assert the field while it is still the intended target,
   * and never fight the user's own movement onto the on-screen keys.
   */
  function watchInitialFocus() {
    for (const delay of FOCUS_RETRY_DELAYS) {
      if (!delay) continue;
      focusTimers.push(setTimeout(() => {
        if (closed || focusRow !== -1) return;
        if (d.activeElement && isInside(d.activeElement, root)) return;
        focusInput();
      }, delay));
    }
  }

  function clearFocusTimers() {
    for (const timer of focusTimers) clearTimeout(timer);
    focusTimers = [];
  }

  function focusKey(row, col) {
    const targetRow = Math.max(0, Math.min(KEY_ROWS.length - 1, row));
    const targetCol = Math.max(0, Math.min(keyButtons[targetRow].length - 1, col));
    for (const list of keyButtons) for (const button of list) button.classList.remove('ytark-entry__key--focused');
    focusRow = targetRow;
    focusCol = targetCol;
    const button = keyButtons[targetRow][targetCol];
    button.classList.add('ytark-entry__key--focused');
    if (typeof button.focus === 'function') button.focus();
  }

  function press(key) {
    switch (key) {
      case 'space': setValue(`${value()} `); break;
      case 'delete': setValue(value().slice(0, -1)); break;
      case 'clear': setValue(''); break;
      case 'done': close('submit'); break;
      default: setValue(value() + key); break;
    }
  }

  function moveFocus(direction) {
    if (focusRow === -1) {
      if (direction === 'down') focusKey(0, 0);
      return;
    }
    const rowLength = keyButtons[focusRow].length;
    if (direction === 'left') focusKey(focusRow, focusCol === 0 ? rowLength - 1 : focusCol - 1);
    else if (direction === 'right') focusKey(focusRow, focusCol === rowLength - 1 ? 0 : focusCol + 1);
    else if (direction === 'up') {
      if (focusRow === 0) focusInput();
      else {
        const ratio = focusCol / Math.max(1, rowLength - 1);
        const nextLength = keyButtons[focusRow - 1].length;
        focusKey(focusRow - 1, Math.round(ratio * (nextLength - 1)));
      }
    } else if (direction === 'down' && focusRow < KEY_ROWS.length - 1) {
      const ratio = focusCol / Math.max(1, rowLength - 1);
      const nextLength = keyButtons[focusRow + 1].length;
      focusKey(focusRow + 1, Math.round(ratio * (nextLength - 1)));
    }
  }

  function swallow(event, preventDefault) {
    if (preventDefault && typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  function onKeyDown(event) {
    if (closed) return;
    if (isBackKey(event)) {
      swallow(event, true);
      close('back');
      return;
    }
    const target = event.target;
    const code = Number(event.keyCode);
    if (!isInside(target, root)) {
      // Focus escaped (the frontend moved it): bring it back, keep keys ours.
      swallow(event, true);
      if (focusRow >= 0) focusKey(focusRow, focusCol);
      else focusInput();
      return;
    }
    if (target === input) {
      if (code === ENTER) {
        swallow(event, true);
        // Remote OK requests the IME; it must not dismiss the editable field.
        // Done on the key grid submits on engines without an IME bridge.
        if (!event.repeat) focusInput();
        return;
      }
      if (code === 40) {
        swallow(event, true);
        moveFocus('down');
        return;
      }
      if (code === 38) {
        swallow(event, true);
        return;
      }
      // Typing and caret movement belong to the input; keep them from the app.
      swallow(event, false);
      return;
    }
    const keyInfo = target && target.__ytarkKey;
    if (keyInfo) {
      if (ARROWS[code]) {
        swallow(event, true);
        moveFocus(ARROWS[code]);
        return;
      }
      if (code === ENTER || code === 32) {
        swallow(event, true);
        if (!event.repeat) press(keyInfo.key);
        return;
      }
      if (code === 8) {
        swallow(event, true);
        press('delete');
        return;
      }
      if (typeof event.key === 'string' && event.key.length === 1) {
        swallow(event, true);
        setValue(value() + event.key.toLowerCase());
        return;
      }
    }
    swallow(event, false);
  }

  function onOtherKey(event) {
    if (closed) return;
    if (isInside(event.target, root) || isBackKey(event)) swallow(event, false);
  }

  function onInput() {
    scheduleStatus();
  }

  function onClick(event) {
    const keyInfo = event.target && event.target.__ytarkKey;
    if (!keyInfo) return;
    swallow(event, true);
    focusKey(keyInfo.row, keyInfo.col);
    press(keyInfo.key);
  }

  const win = typeof window !== 'undefined' ? window : null;
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('keydown', onKeyDown, true);
    win.addEventListener('keyup', onOtherKey, true);
    win.addEventListener('keypress', onOtherKey, true);
  }
  if (typeof input.addEventListener === 'function') input.addEventListener('input', onInput);
  if (typeof keys.addEventListener === 'function') keys.addEventListener('click', onClick);

  (d.body || d.documentElement).appendChild(root);
  focusInput();
  updateStatus();
  watchInitialFocus();
  if (!keyboardChannels.length) {
    hint.textContent = `${tx('ytark.entry.hint', 'OK types · Down moves to the keyboard · Back closes this panel')} ${tx('ytark.entry.onScreenOnly', 'This device did not offer a system keyboard here, so the on-screen keys are used.')}`;
  }

  function close(reason) {
    if (closed) return;
    closed = true;
    clearFocusTimers();
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('keydown', onKeyDown, true);
      win.removeEventListener('keyup', onOtherKey, true);
      win.removeEventListener('keypress', onOtherKey, true);
    }
    if (typeof input.removeEventListener === 'function') input.removeEventListener('input', onInput);
    if (typeof keys.removeEventListener === 'function') keys.removeEventListener('click', onClick);
    const text = value();
    if (typeof input.blur === 'function') input.blur();
    if (root.parentNode) root.parentNode.removeChild(root);
    if (active === controller) active = null;
    if (previousFocus && previousFocus.isConnected !== false && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus();
      } catch (_) {
        /* the frontend restores its own focus */
      }
    }
    if (reason !== 'replaced' && typeof options.onClose === 'function') {
      try {
        options.onClose(text, reason);
      } catch (error) {
        console.warn('[YTArk] Text entry close handler failed:', error);
      }
    }
  }

  const controller = {
    close,
    isOpen: () => !closed,
    element: root,
    input,
    keys: keyButtons,
    press,
    focusKey,
    status,
    /** Channels a platform keyboard was actually requested through (may be empty). */
    platformKeyboard: () => keyboardChannels.slice(),
    /** True when a platform keyboard channel was actually asked for. */
    keyboardRequested: () => keyboardChannels.length > 0,
    get value() { return value(); },
  };
  active = controller;
  return controller;
}

export function activeTextEntry() {
  return active;
}
