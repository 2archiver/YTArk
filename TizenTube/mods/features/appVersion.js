/**
 * Installed-version resolution: what "YTArk version" means at runtime.
 *
 * Root cause this module fixes
 * ----------------------------
 * About YTArk reported "Version unknown" on every 2.4 build. The only version
 * source was `window.h5vcc.tizentube.GetVersion()`, read *synchronously*
 * (`String(getVersion())`). The pinned Cobalt base declares that bridge method
 * as an asynchronous mojo call —
 * `cobalt/browser/h5vcc_tizentube/public/mojom/h5vcc_tizentube.mojom`:
 * `GetVersion() => (string version)` — whose browser-side implementation
 * (`h5vcc_tizentube_impl.cc`) hands the value to a callback and returns
 * nothing, and whose Java side (`StarboardBridge.getVersion()`) answers with
 * the installed package's `versionName`. A synchronous read therefore sees
 * `undefined` (or a pending Promise), the strict version pattern rejects it,
 * and the UI falls back to "unknown".
 *
 * What this module does
 * ---------------------
 *   1. Reads the installed package metadata through the bridge and accepts
 *      every shape the binding can have: a synchronous string, a callback
 *      argument, or a returned Promise. Bounded retries cover a bridge that
 *      binds after the page script runs.
 *   2. Keeps that value as the *authority* for the installed version, and
 *      publishes it to listeners so a surface that rendered a loading state
 *      can show the real version when it arrives.
 *   3. Falls back to the packaging metadata embedded in this bundle
 *      (`assets/buildInfo.generated.js`, generated from
 *      `release/version.properties` by `tools/build_buildinfo.py`) so a release
 *      build can always state its own version offline. The fallback is never
 *      presented as package metadata: `source` tells the two apart, and the
 *      architecture evidence in `features/abiEvidence.js` keeps using the
 *      package value only.
 *   4. Never invents a version: no GitHub "latest release" lookup, no upstream
 *      YouTube version and no hardcoded label. Nothing here needs the network.
 */

import { YTARK_BUILD_INFO } from '../assets/buildInfo.generated.js';

/** Where a reported version came from. */
export const VERSION_SOURCES = Object.freeze({
  /** The installed APK's own `versionName`, read through the platform bridge. */
  package: 'package',
  /** This bundle's packaging metadata (release/version.properties). */
  bundle: 'bundle',
  /** Nothing usable yet. */
  unavailable: 'unavailable',
});

/**
 * A YTArk package version: clean SemVer, plus the historical `-ytark.N` suffix.
 *
 * Deliberately stricter than the changelog's version pattern: `-personal.N` is
 * the upstream TizenTube/personal-build convention (and the Android base this
 * build is repacked from is `v2.0.2-personal.14`), so accepting it here could
 * report the base's version as the installed YTArk version. Anything that does
 * not match is treated as "the platform did not answer".
 */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-ytark\.[1-9]\d*)?$/;
/** The Cobalt bridge binds shortly after the page script runs on some builds. */
const RESOLVE_DELAYS_MS = Object.freeze([0, 500, 2000, 6000]);
/** One bridge read may not answer at all; never wait indefinitely. */
const READ_TIMEOUT_MS = 2500;
const MAX_VERSION_LENGTH = 40;

/**
 * The YouTube TV frontend's own client version, when it publishes one in a
 * recognizable form. It is a *frontend* version (for example
 * `v2.20250101.01.00`), not the Cobalt base and not the YTArk version, and it
 * is only reported when it is actually present.
 */
const FRONTEND_VERSION_PATTERN = /^v?\d{1,3}\.\d{4,}(\.\d+)*$/;

const BUILD_INFO = Object.freeze({ ...YTARK_BUILD_INFO });

const state = {
  version: '',
  source: VERSION_SOURCES.unavailable,
  resolved: false,
  attempt: 0,
  timer: null,
  pending: false,
  listeners: new Set(),
};

function bridge() {
  try {
    return typeof window !== 'undefined' && window.h5vcc && window.h5vcc.tizentube
      ? window.h5vcc.tizentube : null;
  } catch (_) {
    return null;
  }
}

/** Normalize one raw version value; '' means "not a version". */
export function normalizePackageVersion(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/^v/i, '').slice(0, MAX_VERSION_LENGTH);
  return VERSION_PATTERN.test(text) ? text : '';
}

/** Display form: `2.5.0` -> `2.5`, `2.1.2` -> `2.1.2` (patch-zero rule). */
export function displayVersionOf(version) {
  const text = normalizePackageVersion(version);
  if (!text) return '';
  const match = VERSION_PATTERN.exec(text);
  return match[3] === '0' ? `${match[1]}.${match[2]}` : text;
}

/**
 * Read the installed package version once, accepting a synchronous return, a
 * callback argument or a returned Promise. Resolves '' when the bridge is
 * missing, throws, or does not answer within the timeout.
 */
export function readBridgeVersion(native = bridge(), { timeoutMs = READ_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (!native || typeof native.GetVersion !== 'function') {
      resolve('');
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(normalizePackageVersion(value));
    };
    if (typeof setTimeout === 'function' && timeoutMs > 0) {
      timer = setTimeout(() => finish(''), timeoutMs);
    }
    try {
      // One call covers every binding shape: a callback-style binding uses the
      // argument, a Promise-style binding ignores it, a synchronous binding
      // returns the string.
      const returned = native.GetVersion((value) => finish(value));
      if (typeof returned === 'string') finish(returned);
      else if (returned && typeof returned.then === 'function') {
        returned.then(value => finish(value), () => finish(''));
      }
    } catch (error) {
      console.warn('[YTArk] The installed version could not be requested from the bridge:', error);
      finish('');
    }
  });
}

function notify() {
  const info = installedVersionInfo();
  for (const listener of Array.from(state.listeners)) {
    try {
      listener(info);
    } catch (error) {
      console.warn('[YTArk] A version listener failed:', error);
    }
  }
}

function clearTimer() {
  if (state.timer !== null && typeof clearTimeout === 'function') clearTimeout(state.timer);
  state.timer = null;
}

function setVersion(version, source) {
  clearTimer();
  const changed = state.version !== version || state.source !== source || !state.resolved;
  state.version = version;
  state.source = source;
  state.resolved = true;
  state.pending = false;
  if (changed) notify();
}

/** One bounded read; falls back to the next delay or to the build metadata. */
async function runAttempt(delays, readTimeoutMs) {
  state.pending = true;
  try {
    const version = await readBridgeVersion(bridge(), { timeoutMs: readTimeoutMs });
    if (version) {
      setVersion(version, VERSION_SOURCES.package);
      return;
    }
    state.attempt += 1;
    if (state.attempt < delays.length) {
      state.pending = false;
      scheduleAttempt(delays, readTimeoutMs);
      return;
    }
    // No package metadata after every bounded attempt: report this build's own
    // packaging metadata instead of "unknown", labelled by its source.
    setVersion(BUILD_INFO.versionName, VERSION_SOURCES.bundle);
  } catch (error) {
    console.warn('[YTArk] The installed version could not be resolved:', error);
    state.pending = false;
    setVersion(BUILD_INFO.versionName, VERSION_SOURCES.bundle);
  }
}

function scheduleAttempt(delays, readTimeoutMs) {
  if (state.pending) return;
  if (state.resolved && state.source === VERSION_SOURCES.package) return;
  const delay = state.attempt < delays.length ? delays[state.attempt] : 0;
  if (delay > 0 && typeof setTimeout === 'function') {
    clearTimer();
    state.timer = setTimeout(() => {
      state.timer = null;
      runAttempt(delays, readTimeoutMs);
    }, delay);
    return;
  }
  runAttempt(delays, readTimeoutMs);
}

function attemptResolution(delays = RESOLVE_DELAYS_MS, readTimeoutMs = READ_TIMEOUT_MS) {
  scheduleAttempt(delays, readTimeoutMs);
}

/**
 * Start (or restart) resolution. Idempotent: repeated calls never stack
 * timers, and a resolved package version is never downgraded.
 *
 * @param {{force?: boolean, delays?: number[], readTimeoutMs?: number}} options
 *   `force` re-reads the bridge even after a completed fallback (the About
 *   "read again" row); `delays` and `readTimeoutMs` bound the retry schedule.
 */
export function startVersionResolution(options = {}) {
  if (options.force) {
    clearTimer();
    state.attempt = 0;
    state.resolved = false;
    state.pending = false;
  }
  attemptResolution(options.delays || RESOLVE_DELAYS_MS, options.readTimeoutMs || READ_TIMEOUT_MS);
  return installedVersionInfo();
}

/** Subscribe to resolution; returns the unsubscribe function. */
export function onVersionResolved(listener) {
  if (typeof listener !== 'function') return () => {};
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** The packaging metadata embedded in this bundle (never hand-written). */
export function buildInfo() {
  return BUILD_INFO;
}

/**
 * The version to display, with its source.
 * @returns {{version: string, display: string, source: string, resolved: boolean,
 *            loading: boolean}}
 */
export function installedVersionInfo() {
  if (state.resolved && state.version) {
    return {
      version: state.version,
      display: displayVersionOf(state.version) || state.version,
      source: state.source,
      resolved: true,
      loading: false,
    };
  }
  // Not resolved yet: the bundle metadata is a real, honest value for this
  // build, so it is shown while the package read is still in flight, marked as
  // loading only when even that is missing.
  if (BUILD_INFO.versionName) {
    return {
      version: BUILD_INFO.versionName,
      display: BUILD_INFO.displayVersion || displayVersionOf(BUILD_INFO.versionName),
      source: VERSION_SOURCES.bundle,
      resolved: false,
      loading: false,
    };
  }
  return { version: '', display: '', source: VERSION_SOURCES.unavailable, resolved: false, loading: true };
}

/**
 * The installed package version, or '' when the platform has not answered.
 * Update comparison and architecture evidence use this only: bundle metadata
 * must never masquerade as package metadata.
 */
export function installedPackageVersion() {
  return state.source === VERSION_SOURCES.package ? state.version : '';
}

/** Short honest label for a version line, e.g. `2.5 (build metadata)`. */
export function installedVersionLabel() {
  const info = installedVersionInfo();
  if (info.loading) return '';
  return info.source === VERSION_SOURCES.package
    ? info.display
    : `${info.display} (build metadata)`;
}

/**
 * Build details for About: only values that actually exist in this build's
 * packaging metadata. Never a placeholder and never derived at runtime.
 */
export function buildDetails() {
  const parts = [];
  if (BUILD_INFO.versionName) parts.push(`versionName ${BUILD_INFO.versionName}`);
  if (BUILD_INFO.versionCode) parts.push(`versionCode ${BUILD_INFO.versionCode}`);
  if (BUILD_INFO.scriptTag) parts.push(`userscript ${BUILD_INFO.scriptTag}`);
  if (BUILD_INFO.baseTag) parts.push(`Android base TizenTubeCobalt ${BUILD_INFO.baseTag}`);
  return parts.join(' · ');
}

function frontendCandidates() {
  try {
    const config = typeof window !== 'undefined' && window.yt && window.yt.config_ ? window.yt.config_ : null;
    if (!config) return [];
    return [
      config.INNERTUBE_CONTEXT && config.INNERTUBE_CONTEXT.client
        && config.INNERTUBE_CONTEXT.client.clientVersion,
      config.INNERTUBE_CONTEXT && config.INNERTUBE_CONTEXT.clientInformation
        && config.INNERTUBE_CONTEXT.clientInformation.clientVersion,
      config.INNERTUBE_CLIENT_VERSION,
      config.clientVersion,
    ];
  } catch (_) {
    return [];
  }
}

/**
 * The YouTube frontend's own client version, only when the running frontend
 * publishes one in a recognizable form. '' means "not reliably available", and
 * callers omit the field instead of guessing.
 */
export function youtubeFrontendVersion() {
  for (const candidate of frontendCandidates()) {
    if (typeof candidate !== 'string') continue;
    const text = candidate.trim().slice(0, MAX_VERSION_LENGTH);
    if (FRONTEND_VERSION_PATTERN.test(text)) return text;
  }
  return '';
}

/** Test/diagnostic hook: forget the resolved value and every listener. */
export function resetVersionForTests() {
  if (state.timer !== null && typeof clearTimeout === 'function') clearTimeout(state.timer);
  state.timer = null;
  state.version = '';
  state.source = VERSION_SOURCES.unavailable;
  state.resolved = false;
  state.attempt = 0;
  state.listeners.clear();
}

const installedFlag = '__ytarkVersionResolutionStarted';
if (typeof window !== 'undefined' && !window[installedFlag]) {
  try {
    window[installedFlag] = true;
  } catch (_) {
    /* a frozen window is not expected; continue without the guard */
  }
  // Early, bounded and non-blocking: About and the Updates card normally have
  // the real installed version long before the user reaches them.
  startVersionResolution();
}
