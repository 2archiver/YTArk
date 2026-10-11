/**
 * Retirement of the removed Cobalt user-agent override.
 *
 * YTArk 2.5 removed the user-facing "User-Agent profile" control and every
 * user-selectable override (`features/userAgentSpoofing.js` is gone). The
 * platform's own Cobalt user agent is the only one YTArk uses: nothing here
 * ever builds, stores or applies a substitute string, so authentication,
 * playback and client compatibility keep working exactly as the YouTube client
 * expects.
 *
 * What is left is a one-way migration for installations that had chosen an
 * experimental profile in 2.2–2.4. A chosen profile was pushed into Cobalt with
 * `SetUserAgent(...)` and persisted there, so simply deleting the preference
 * would leave the override active with no way to turn it off. This module
 * therefore:
 *
 *   1. detects the retired preference (reported once by the settings migration,
 *      `getConfigMeta().retiredValues.userAgentProfile`) and the legacy
 *      localStorage markers an applied override left behind,
 *   2. asks the platform bridge for its built-in user agent again
 *      (`ResetUserAgent()`, or `SetUserAgent('')`, which is how the Cobalt
 *      bridge returns to its own string),
 *   3. clears exactly those legacy keys — never YouTube/Google account,
 *      cookie or session storage, and never another YTArk preference — and
 *   4. records a one-shot completion marker so the reset and its single reload
 *      can never repeat or loop.
 *
 * Installations that never chose a profile do nothing at all: no bridge call,
 * no reload and no storage write beyond the marker check.
 */

import { getConfigMeta } from '../config.js';

/** Written once when retirement finished; keeps it from ever repeating. */
export const RETIRED_MARKER_KEY = 'ytark-user-agent-retired';
/** 2.x marker: a profile override was pushed into Cobalt (`name:userAgent`). */
export const LEGACY_APPLIED_KEY = 'ytark-user-agent-transition';
/** 2.x marker: a native reset was already requested. */
export const LEGACY_RESET_KEY = 'ytark-user-agent-reset-transition';
/** Older builds stored the generated override string itself. */
export const LEGACY_UA_KEY = 'userAgent';
/** The retired preference name (settings schema 3 removes it). */
export const RETIRED_PREFERENCE = 'userAgentProfile';
/** The supported default: the platform's own Cobalt user agent. */
export const SUPPORTED_DEFAULT = 'native';

const BRIDGE_WAIT_MS = 250;
const BRIDGE_WAIT_ATTEMPTS = 80;

function storageOrDefault(storageRef) {
  if (storageRef) return storageRef;
  try {
    return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
  } catch (_) {
    return null;
  }
}

function readItem(storage, key) {
  try {
    if (typeof storage.getItem === 'function') return storage.getItem(key);
    const value = storage[key];
    return value === undefined ? null : value;
  } catch (_) {
    return null;
  }
}

function removeItem(storage, key) {
  try {
    if (typeof storage.removeItem === 'function') storage.removeItem(key);
    else delete storage[key];
    return true;
  } catch (_) {
    return false;
  }
}

function writeItem(storage, key, value) {
  try {
    if (typeof storage.setItem === 'function') storage.setItem(key, String(value));
    else storage[key] = String(value);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Decide whether this installation carries a retired override. Pure: it only
 * reads the migration report and the legacy markers.
 *
 * @returns {{needed: boolean, profile: string, appliedOverride: boolean,
 *            alreadyRetired: boolean, reasons: string[]}}
 */
export function retirementState({ meta, storage } = {}) {
  const store = storageOrDefault(storage);
  const retiredValues = (meta || getConfigMeta() || {}).retiredValues || {};
  const profile = typeof retiredValues[RETIRED_PREFERENCE] === 'string'
    ? retiredValues[RETIRED_PREFERENCE] : '';
  const alreadyRetired = !!store && readItem(store, RETIRED_MARKER_KEY) === '1';
  const legacyUa = !!store && typeof readItem(store, LEGACY_UA_KEY) === 'string'
    && readItem(store, LEGACY_UA_KEY) !== '';
  const appliedToken = !!store ? String(readItem(store, LEGACY_APPLIED_KEY) || '') : '';
  // The reset path stored the literal `native`; a profile token is `name:ua`.
  const appliedOverride = !!appliedToken && appliedToken !== SUPPORTED_DEFAULT;
  const reasons = [];
  if (profile && profile !== SUPPORTED_DEFAULT) reasons.push(`retired preference ${RETIRED_PREFERENCE}=${profile}`);
  if (appliedOverride) reasons.push('a profile override was applied to Cobalt');
  if (legacyUa) reasons.push('a stored override string was found');
  return {
    needed: !alreadyRetired && reasons.length > 0,
    profile: profile || (appliedOverride ? appliedToken.split(':')[0] : ''),
    appliedOverride: appliedOverride || legacyUa,
    alreadyRetired,
    reasons,
  };
}

/**
 * Perform the retirement once. Never throws; never writes a user agent.
 *
 * @returns {{needed: boolean, reset: boolean, reloaded: boolean, cleared: string[],
 *            reason: string}}
 */
export function retireUserAgentOverride(bridge, storageRef, locationRef) {
  const storage = storageOrDefault(storageRef);
  if (!storage) return { needed: false, reset: false, reloaded: false, cleared: [], reason: 'storage-unavailable' };

  const state = retirementState({ storage });
  if (state.alreadyRetired) {
    return { needed: false, reset: false, reloaded: false, cleared: [], reason: 'already-retired' };
  }
  if (!state.needed) {
    // Nothing was ever overridden: only remember that retirement was checked.
    writeItem(storage, RETIRED_MARKER_KEY, '1');
    return { needed: false, reset: false, reloaded: false, cleared: [], reason: 'nothing-to-retire' };
  }

  // Mark first: a reload below must never be able to start this again.
  writeItem(storage, RETIRED_MARKER_KEY, '1');

  let reset = false;
  try {
    if (bridge && typeof bridge.ResetUserAgent === 'function') {
      bridge.ResetUserAgent();
      reset = true;
    } else if (bridge && typeof bridge.SetUserAgent === 'function') {
      // The Cobalt bridge treats an empty override as "use your built-in UA".
      bridge.SetUserAgent('');
      reset = true;
    }
  } catch (error) {
    console.warn('[YTArk] The platform user agent could not be restored:', error);
  }

  const cleared = [LEGACY_UA_KEY, LEGACY_APPLIED_KEY, LEGACY_RESET_KEY]
    .filter(key => removeItem(storage, key));

  let reloaded = false;
  if (reset) {
    // One reload so the restored platform user agent is in effect for the
    // session. The marker above makes this the only reload this causes.
    const currentLocation = locationRef || (typeof location !== 'undefined' ? location : null);
    if (currentLocation && typeof currentLocation.reload === 'function') {
      try {
        currentLocation.reload();
        reloaded = true;
      } catch (error) {
        console.warn('[YTArk] The one-time user-agent reload could not be requested:', error);
      }
    }
  }

  console.info('[YTArk] Retired the removed user-agent override; the platform user agent is in use.'
    + ` (${state.reasons.join('; ')})`);
  return { needed: true, reset, reloaded, cleared, reason: reset ? 'restored-platform-ua' : 'cleared-without-bridge' };
}

function bridgeForWindow() {
  try {
    return typeof window !== 'undefined' && window.h5vcc && window.h5vcc.tizentube
      ? window.h5vcc.tizentube : null;
  } catch (_) {
    return null;
  }
}

let waitTimer = null;

/**
 * Run the migration once per installation, waiting (bounded) for the platform
 * bridge when a reset is actually needed. Without a needed override this is a
 * single marker check and no timers.
 */
export function startUserAgentRetirement() {
  let state;
  try {
    state = retirementState({});
  } catch (error) {
    console.warn('[YTArk] The retired user-agent override could not be inspected:', error);
    return null;
  }
  if (!state.needed) return retireUserAgentOverride(bridgeForWindow());
  if (waitTimer !== null) return null;

  let attempts = 0;
  const finish = () => {
    waitTimer = null;
    return retireUserAgentOverride(bridgeForWindow());
  };
  const step = () => {
    attempts += 1;
    const bridge = bridgeForWindow();
    if (bridge && (typeof bridge.ResetUserAgent === 'function' || typeof bridge.SetUserAgent === 'function')) {
      finish();
      return;
    }
    if (attempts >= BRIDGE_WAIT_ATTEMPTS) {
      // No bridge on this runtime: clear the retired markers anyway so the
      // migration is recorded and never retried.
      finish();
      return;
    }
    waitTimer = setTimeout(step, BRIDGE_WAIT_MS);
  };
  waitTimer = setTimeout(step, BRIDGE_WAIT_MS);
  return null;
}

/** Test/diagnostic hook. */
export function resetRetirementForTests() {
  if (waitTimer !== null) clearTimeout(waitTimer);
  waitTimer = null;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUserAgentRetirement, { once: true });
  } else {
    startUserAgentRetirement();
  }
}
