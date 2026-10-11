/**
 * Post-update "What's new" bookkeeping.
 *
 * A card is offered in YTArk Settings only after a genuinely newer installed
 * version is detected, until it is dismissed for that version. Fresh installs,
 * relaunches of the same version and downgrades never show it. A single
 * non-blocking toast announces the update once, and only when no video is
 * playing. Everything is stored by version string in the YTArk configuration;
 * login and session storage are never touched.
 */

import { configRead, configWrite, configWriteMany, LEGACY_VERSION_MARKER } from '../config.js';
import { isNewerVersion, numericVersionKey } from './updateState.js';
import { YTARK_CHANGELOG } from '../assets/changelog.generated.js';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:ytark|personal)\.[1-9]\d*)?$/;
const TOAST_DELAY_MS = 8000;

export function normalizeVersion(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().replace(/^v/, '');
  return VERSION_PATTERN.test(text) ? text : '';
}

export function changelogEntryFor(version, changelog = YTARK_CHANGELOG) {
  const wanted = normalizeVersion(version);
  if (!wanted || !changelog || !Array.isArray(changelog.entries)) return null;
  return changelog.entries.find(entry => entry && entry.version === wanted) || null;
}

export function installedVersion() {
  try {
    const getVersion = typeof window !== 'undefined' && window.h5vcc && window.h5vcc.tizentube
      && window.h5vcc.tizentube.GetVersion;
    if (typeof getVersion === 'function') return normalizeVersion(getVersion());
  } catch (error) {
    console.warn('[YTArk] Could not read the installed version:', error);
  }
  return '';
}

/**
 * Pure decision. Returns the configuration updates to persist and whether the
 * card should be shown / the update announced.
 */
export function evaluateWhatsNew({ installed, lastSeen, pending, dismissed, changelog = YTARK_CHANGELOG }) {
  const version = normalizeVersion(installed);
  if (!version) return { updates: {}, show: false, announce: false, version: '' };
  const updates = {};
  let announce = false;
  const seen = typeof lastSeen === 'string' ? lastSeen : '';
  if (!seen) {
    // Fresh install or no history: remember the version silently.
    updates.lastSeenVersion = version;
  } else if (seen === LEGACY_VERSION_MARKER
      || (numericVersionKey(seen) && isNewerVersion(version, seen))) {
    updates.lastSeenVersion = version;
    updates.whatsNewVersion = version;
    announce = true;
  } else if (seen !== version) {
    // Downgrade or unparseable history: record, never announce.
    updates.lastSeenVersion = version;
  }
  const pendingVersion = updates.whatsNewVersion || (typeof pending === 'string' ? pending : '');
  const show = !!pendingVersion && pendingVersion === version && dismissed !== version
    && !!changelogEntryFor(version, changelog);
  return { updates, show, announce: announce && show, version };
}

/** Current card state, read from configuration. */
export function whatsNewState(installed = installedVersion()) {
  const version = normalizeVersion(installed);
  const pending = configRead('whatsNewVersion');
  const show = !!version && pending === version && configRead('whatsNewDismissedVersion') !== version
    && !!changelogEntryFor(version);
  return { show, version, entry: show ? changelogEntryFor(version) : null };
}

export function dismissWhatsNew(installed = installedVersion()) {
  const version = normalizeVersion(installed);
  if (!version) return false;
  configWrite('whatsNewDismissedVersion', version);
  return true;
}

function currentLocation() {
  if (typeof window !== 'undefined' && window.location) return window.location;
  return typeof location !== 'undefined' ? location : null;
}

/** True while the watch page (playback) is showing. */
export function isWatching() {
  try {
    const where = currentLocation();
    return !!where && /\/watch/.test(String(where.hash || ''));
  } catch (_) {
    return false;
  }
}

let evaluated = false;
let toastTimer = null;
let waitingForRoute = null;

function scheduleAnnouncement(announce) {
  if (typeof setTimeout !== 'function') return;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    if (!isWatching()) {
      announce();
      return;
    }
    if (waitingForRoute || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    // Wait until playback is left instead of interrupting it.
    waitingForRoute = () => {
      if (isWatching()) return;
      window.removeEventListener('hashchange', waitingForRoute, false);
      waitingForRoute = null;
      announce();
    };
    window.addEventListener('hashchange', waitingForRoute, false);
  }, TOAST_DELAY_MS);
}

/**
 * Evaluate once per session. `announce` is called at most once, later, and
 * never while a video is playing.
 */
export function initWhatsNew({ installed = installedVersion(), announce } = {}) {
  if (evaluated) return null;
  evaluated = true;
  const result = evaluateWhatsNew({
    installed,
    lastSeen: configRead('lastSeenVersion'),
    pending: configRead('whatsNewVersion'),
    dismissed: configRead('whatsNewDismissedVersion'),
  });
  if (Object.keys(result.updates).length) configWriteMany(result.updates);
  if (result.announce && typeof announce === 'function') scheduleAnnouncement(() => announce(result.version));
  return result;
}

export function resetWhatsNewForTests() {
  evaluated = false;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = null;
  if (waitingForRoute && typeof window !== 'undefined' && window.removeEventListener) {
    window.removeEventListener('hashchange', waitingForRoute, false);
  }
  waitingForRoute = null;
}
