/**
 * Explicit activation for the YTArk Settings entry in the TV guide.
 *
 * The bug this fixes
 * ------------------
 * The guide entry injected by `ui/customGuideAction.js` carried
 * `{ customAction: { action: 'TT_SETTINGS_SHOW' } }` as its
 * `navigationEndpoint`. The YouTube TV frontend resolves a guide entry's
 * navigation endpoint when the entry receives *focus* — that is how the
 * sidebar browses — so merely scrolling past the entry opened the YTArk
 * Settings panel, with no OK/Enter and no click.
 *
 * The fix
 * -------
 * The entry now carries its own action (`YTARK_GUIDE_SETTINGS_OPEN`) which is
 * only honoured after an *explicit* activation was seen: an OK/Enter keydown or
 * a click/pointer press. Focusing, hovering, scrolling past, a visibility
 * change or a selection change never arms it, so the endpoint the frontend
 * resolves on focus is ignored and the row only highlights.
 *
 * Two paths lead to exactly one panel:
 *
 *   1. The frontend resolves the entry's endpoint on OK (the normal case): the
 *      resolver sees an armed activation and opens the panel.
 *   2. A frontend that resolves guide endpoints on focus only would leave OK
 *      with nothing to do, so when the OK/Enter press lands on the entry itself
 *      (matched by its own label, inside the guide container, or by the marker
 *      attribute set on the first match) the panel is opened after a short
 *      delay — unless path 1 already opened it.
 *
 * Both paths funnel through one per-activation token, so a press can never open
 * two panels, and no key is swallowed: this module never calls
 * preventDefault/stopPropagation, it only decides whether its own action runs.
 * Any other command the resolver sees (POPUP_BACK, a browse/watch endpoint,
 * …) disarms the activation, so an OK spent elsewhere — for example on a
 * modal's Back button — cannot leak into a focus event on the entry and reopen
 * the panel.
 *
 * Back behaviour: nothing here navigates, so the frontend's POPUP_BACK closes
 * the panel and restores the sidebar exactly where it was, with focus back on
 * the entry. The listeners are installed once per page and are never removed
 * and re-added, so repeated opening cannot stack handlers.
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

/** Record an explicit user activation (OK/Enter keydown, click or press). */
export function armActivation() {
  state.armedAt = now();
  return state.armedAt;
}

/** Drop a pending activation (an OK spent on anything else, or a panel open). */
export function disarmActivation() {
  state.armedAt = 0;
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
 * Keydown/press handling. Arms the activation for the command path and, when
 * the press is on the entry itself, schedules the fallback open. Never
 * prevents or stops anything: unrelated keys reach the frontend untouched.
 */
export function handleActivationEvent(event) {
  if (!event) return false;
  const type = String(event.type || '');
  const isKey = type === 'keydown';
  if (isKey) {
    const code = Number(event.keyCode !== undefined ? event.keyCode : event.which);
    if (!ACTIVATION_KEY_CODES.includes(code)) return false;
    if (event.repeat) return false;
  } else if (type !== 'click' && type !== 'pointerdown' && type !== 'mousedown') {
    return false;
  }
  const target = eventTarget(event);
  // A text field's Enter belongs to the text entry panel, not to the guide.
  if (isEditable(target)) return false;

  armActivation();
  if (!isGuideEntryTarget(target)) return false;

  state.token += 1;
  const token = state.token;
  if (typeof setTimeout !== 'function') return openOnce(token);
  setTimeout(() => {
    if (token === state.token) openOnce(token);
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
  };
}

/** Test hook: forget the installation state so a harness can reinstall. */
export function resetGuideActivationForTests() {
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
