/**
 * Explicit activation for the YTArk Settings entry in the TV guide.
 *
 * The guide entry already carries a dedicated `YTARK_GUIDE_SETTINGS_OPEN`
 * action: the TV frontend may resolve navigation endpoints on focus as well as
 * on OK, so a Settings action must not be attached directly to the focused row.
 * The residual edge fixed here was that any OK press armed a one-second token,
 * and the row's own OK was not consumed. A delayed guide resolution could
 * therefore reuse an unrelated token, or let the same OK reach content below.
 *
 * The frontend resolver and the short fallback are two paths to one panel:
 * the resolver opens only with an explicit row activation; if that frontend
 * build does not resolve on OK, the fallback opens only after OK/Enter/click
 * targets the YTArk row. The event is synchronously consumed before fallback,
 * so it cannot also activate content underneath. Repeats do not create another
 * timer or panel. Any subsequent navigation, editable-field event, or unrelated
 * resolver command cancels the pending activation and fallback timer.
 *
 * Matching is bounded to the event target's ancestors or the frontend's
 * `.zylon-focus` marker when remote events target the document. Listeners are
 * installed once per page. Actual TV focus restoration and remote key mapping
 * still require device verification.
 */

import { t } from 'i18next';
import { showSettingsMenu } from './settings.js';

/** The entry's own action; resolved only after an explicit activation. */
export const GUIDE_SETTINGS_ACTION = 'YTARK_GUIDE_SETTINGS_OPEN';
/** Marker set on the rendered entry once it has been matched (idempotent). */
export const GUIDE_ENTRY_ATTRIBUTE = 'data-ytark-guide-entry';
/** Sidebar containers the entry can be rendered in. */
export const GUIDE_CONTAINER_SELECTOR = [
  'ytlr-guide-response',
  '.ytLrGuideResponseContainer',
  '.ytLrGuideResponseCollapsed',
].join(', ');
/** Remote OK/Enter key codes this build sees (DPAD_CENTER, Enter, space). */
export const ACTIVATION_KEY_CODES = Object.freeze([13, 32]);
/** How long one explicit press stays valid for the command path. */
export const ACTIVATION_WINDOW_MS = 1000;
/** How long path 2 waits for the frontend before opening the panel itself. */
export const FALLBACK_DELAY_MS = 200;
/** Ancestors inspected while matching the pressed row (bounded, no DOM scan). */
const MAX_ANCESTOR_DEPTH = 8;
/** A row's own text is short; a whole sidebar is not. */
const MAX_ROW_TEXT_LENGTH = 120;

const state = {
  armedAt: 0,
  token: 0,
  openedToken: -1,
  installed: false,
  listeners: 0,
  lastOpenAt: 0,
  fallbackTimer: null,
};

function now() {
  return typeof Date !== 'undefined' ? Date.now() : 0;
}

/** The entry's own label, in the active UI language. */
export function guideEntryLabel() {
  try {
    const label = t('settings.ttSettings.title');
    return typeof label === 'string' && label && label !== 'settings.ttSettings.title'
      ? label : 'YTArk Settings';
  } catch (_) {
    return 'YTArk Settings';
  }
}

/** Clear the one outstanding fallback, if any. */
function clearFallbackTimer() {
  if (state.fallbackTimer === null) return;
  try {
    if (typeof clearTimeout === 'function') clearTimeout(state.fallbackTimer);
  } catch (_) {
    /* token validation below still makes a late callback harmless */
  }
  state.fallbackTimer = null;
}

/** Record an explicit user activation (OK/Enter keydown, click or press). */
export function armActivation() {
  state.armedAt = now();
  return state.armedAt;
}

/** Drop a pending activation and invalidate its fallback callback. */
export function disarmActivation() {
  state.armedAt = 0;
  state.token += 1;
  clearFallbackTimer();
}

function cancelPendingActivation() {
  if (state.armedAt !== 0 || state.fallbackTimer !== null) disarmActivation();
}

/** True while one explicit activation is still valid. */
export function activationArmed(at = now()) {
  return state.armedAt !== 0 && at - state.armedAt <= ACTIVATION_WINDOW_MS;
}

/** Open the panel at most once per activation. */
function openOnce(token) {
  if (state.openedToken === token) return false;
  state.openedToken = token;
  state.armedAt = 0;
  state.lastOpenAt = now();
  try {
    showSettingsMenu('root', {});
  } catch (error) {
    console.warn('[YTArk] The guide entry could not open YTArk Settings:', error);
    return false;
  }
  return true;
}

/**
 * Path 1: the frontend resolved the entry's endpoint. Honoured only for an
 * explicit activation; a focus/scroll/visibility resolution is ignored.
 * @returns {{opened: boolean, reason: string}}
 */
export function activationFromCommand() {
  if (!activationArmed()) {
    return { opened: false, reason: 'no-explicit-activation' };
  }
  clearFallbackTimer();
  state.token += 1;
  const opened = openOnce(state.token);
  return { opened, reason: opened ? 'explicit-command' : 'already-open' };
}

function textOf(node) {
  try {
    const text = typeof node.textContent === 'string' ? node.textContent : '';
    return text.replace(/\s+/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

/**
 * True when the pressed/focused element is the YTArk guide entry. Bounded: it
 * walks at most a few ancestors of the event target and never scans the
 * document. The match is the entry's own label (which this build injected), so
 * it follows the UI language and cannot match an unrelated row.
 */
export function isGuideEntryTarget(target, label = guideEntryLabel()) {
  if (!target || typeof target !== 'object') return false;
  try {
    if (typeof target.closest === 'function'
        && target.closest(`[${GUIDE_ENTRY_ATTRIBUTE}="true"]`)) return true;
  } catch (_) {
    /* an element without closest() is matched by text below */
  }
  let node = target;
  for (let depth = 0; node && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const text = textOf(node);
    if (text && text.length <= MAX_ROW_TEXT_LENGTH && text === label) {
      markEntry(node);
      return true;
    }
    node = node.parentNode;
  }
  return false;
}

/** Idempotently mark a matched row so later presses need no text comparison. */
function markEntry(node) {
  try {
    if (node && typeof node.setAttribute === 'function'
        && node.getAttribute && node.getAttribute(GUIDE_ENTRY_ATTRIBUTE) !== 'true') {
      node.setAttribute(GUIDE_ENTRY_ATTRIBUTE, 'true');
    }
  } catch (_) {
    /* marking is an optimisation only */
  }
}

function eventTarget(event) {
  const doc = typeof document !== 'undefined' ? document : null;
  return (event && (event.target || event.srcElement))
    || (doc && doc.activeElement) || null;
}

/**
 * Some TV remotes dispatch key events at the document rather than the focused
 * row. Fall back only to the frontend's active guide marker, never an arbitrary
 * OK press elsewhere in the app.
 */
function focusedGuideEntryTarget() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;
  try {
    for (const candidate of doc.querySelectorAll('.zylon-focus')) {
      let node = candidate;
      for (let depth = 0; node && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        if (node.matches && node.matches(GUIDE_CONTAINER_SELECTOR)) {
          if (isGuideEntryTarget(candidate)) return candidate;
          break;
        }
        node = node.parentNode;
      }
    }
  } catch (_) {
    /* the event target path remains available on older DOMs */
  }
  return null;
}

/**
 * Keydown/press handling. Unrelated activations reach the frontend untouched;
 * a press on the YTArk entry is consumed before scheduling the fallback open.
 */
export function handleActivationEvent(event) {
  if (!event) return false;
  const type = String(event.type || '');
  const isKey = type === 'keydown';
  let repeat = false;
  if (isKey) {
    const code = Number(event.keyCode !== undefined ? event.keyCode : event.which);
    if (!ACTIVATION_KEY_CODES.includes(code)) {
      cancelPendingActivation();
      return false;
    }
    repeat = event.repeat === true;
  } else if (type !== 'click' && type !== 'pointerdown' && type !== 'mousedown') {
    return false;
  }
  const target = eventTarget(event);
  const doc = typeof document !== 'undefined' ? document : null;
  // A text field's Enter belongs to the text entry panel, not to the guide.
  if (isEditable(target) || (isKey && doc && isEditable(doc.activeElement))) {
    cancelPendingActivation();
    return false;
  }

  const focusedGuideTarget = isKey ? focusedGuideEntryTarget() : null;
  const activationTarget = isGuideEntryTarget(target)
    ? target : (focusedGuideTarget && isGuideEntryTarget(focusedGuideTarget) ? focusedGuideTarget : null);
  if (!activationTarget) {
    cancelPendingActivation();
    return false;
  }

  // Consume only the activation whose target is the YTArk guide row. A held OK
  // remains owned by this row but never creates another panel/timer.
  try { event.preventDefault(); } catch (_) { /* legacy event */ }
  try { event.stopImmediatePropagation(); } catch (_) { /* older event object */ }
  try { event.stopPropagation(); } catch (_) { /* older event object */ }
  if (repeat) return true;

  clearFallbackTimer();
  armActivation();
  state.token += 1;
  const token = state.token;
  if (typeof setTimeout !== 'function') return openOnce(token);
  state.fallbackTimer = setTimeout(() => {
    state.fallbackTimer = null;
    if (token === state.token && activationArmed()) openOnce(token);
  }, FALLBACK_DELAY_MS);
  return true;
}

function isEditable(target) {
  if (!target) return false;
  try {
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select'
      || target.isContentEditable === true
      || (typeof target.getAttribute === 'function'
        && target.getAttribute('contenteditable') === 'true');
  } catch (_) {
    return false;
  }
}

/**
 * The patched command resolver reports every command it sees. Anything that is
 * not the guide entry's own action means the activation went somewhere else
 * (a modal Back button, a browse endpoint, …) and must not be reusable.
 */
export function noteResolverCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return;
  if (cmd.customAction && cmd.customAction.action === GUIDE_SETTINGS_ACTION) return;
  const commands = cmd.commandExecutorCommand && cmd.commandExecutorCommand.commands;
  if (Array.isArray(commands) && commands.some(item => item && item.customAction
      && item.customAction.action === GUIDE_SETTINGS_ACTION)) return;
  disarmActivation();
}

function installListeners() {
  if (state.installed || typeof document === 'undefined'
      || typeof document.addEventListener !== 'function') return false;
  state.installed = true;
  document.addEventListener('keydown', handleActivationEvent, true);
  document.addEventListener('click', handleActivationEvent, true);
  state.listeners += 2;
  return true;
}

/** Install the listeners once per page. Safe to call repeatedly. */
export function installGuideActivation() {
  return installListeners();
}

/** Diagnostics/tests. */
export function guideActivationState() {
  return {
    armed: activationArmed(),
    token: state.token,
    openedToken: state.openedToken,
    installed: state.installed,
    listeners: state.listeners,
    lastOpenAt: state.lastOpenAt,
    fallbackPending: state.fallbackTimer !== null,
  };
}

/** Test hook: forget the installation state so a harness can reinstall. */
export function resetGuideActivationForTests() {
  clearFallbackTimer();
  state.armedAt = 0;
  state.token = 0;
  state.openedToken = -1;
  state.installed = false;
  state.listeners = 0;
  state.lastOpenAt = 0;
}

const installedFlag = '__ytarkGuideActivationInstalled';
if (typeof window !== 'undefined' && !window[installedFlag]) {
  try {
    window[installedFlag] = true;
  } catch (_) {
    /* continue without the guard if window is frozen */
  }
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installGuideActivation, { once: true });
  } else {
    installGuideActivation();
  }
}
