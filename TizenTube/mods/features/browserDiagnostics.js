/**
 * Opt-in, local-only userscript diagnostics. This module deliberately does no
 * storage read, listener registration, sampling, or timer work while disabled.
 * Its JSON schema is an allowlist: callers can only submit a fixed event name,
 * bounded outcome/quality values, and a finite relative number.
 */
import { configRead, configWrite, lastPersistSucceeded } from '../config.js';
import { YTARK_BUILD_INFO } from '../assets/buildInfo.generated.js';
import { summarizeStartupSessions } from './browserDiagnosticsSummary.js';
import { parseStartupDestination } from './startupDestination.js';

export const BROWSER_DIAGNOSTICS_KEY = 'ytark-browser-diagnostics-v1';
export const BROWSER_DIAGNOSTICS_DRAFT_KEY = 'ytark-browser-diagnostics-draft-v1';
export const BROWSER_DIAGNOSTICS_SCHEMA = 1;
export const BROWSER_DIAGNOSTICS_LIMITS = Object.freeze({
  sessions: 20,
  eventsPerSession: 200,
  bytes: 256 * 1024,
  durationMs: 5 * 60 * 1000,
  draftBatchMs: 750,
});

const EVENT_OUTCOMES = Object.freeze({
  'recording-started': ['launch', 'partial'],
  'recording-ended': ['complete', 'replaced', 'event-limit'],
  'ui-module-evaluated': ['observed'], 
  'dom-body-available': ['observed'],
  'controls-ready': ['observed'],
  'resolver-ready': ['observed'],
  'guide-executor-ready': ['observed'],
  'guide-refresh-dispatched': ['dispatched'],
  'guide-refresh-failed': ['failed'],
  'guide-refresh-timeout': ['timeout'],
  'startup-navigation-dispatched': ['explicit-destination', 'soft-reload', 'disabled'],
  'startup-navigation-skipped': ['already-home'],
  'startup-navigation-failed': ['failed'],
  'startup-navigation-cancelled': ['user-input'],
  'startup-readiness-mode': [
    'faster', 'normal-disabled', 'normal-interrupted', 'normal-storage-unavailable', 'normal-fallback',
  ],
  'startup-readiness-complete': ['complete'],
  'startup-readiness-timeout': ['timeout'],
  'startup-readiness-interrupted': ['interrupted'],
  'first-remote-input-received': ['dpad-left', 'dpad-right', 'dpad-up', 'dpad-down', 'ok', 'back'],
  'remote-handler-sync-duration': ['dpad-left', 'dpad-right', 'dpad-up', 'dpad-down', 'ok', 'back'],
  'remote-handler-render-opportunity': ['dpad-left', 'dpad-right', 'dpad-up', 'dpad-down', 'ok', 'back', 'unsupported'],
  'first-playing-event': ['observed'],
  'playback-playing': ['initial', 'resume', 'seek', 'buffering-recovery', 'unknown'],
  'first-video-frame-callback': ['observed', 'unsupported'],
  'buffering-interval': ['recovered'],
});
const EVENT_NAMES = new Set(Object.keys(EVENT_OUTCOMES));
const QUALITIES = new Set(['observed', 'proxy', 'degraded', 'unsupported']);
const CLOCK_DOMAINS = new Set(['performance', 'date-fallback', 'unavailable']);
const CAPTURES = new Set(['launch', 'partial']);
const SESSION_STATUSES = new Set(['active', 'complete', 'interrupted', 'replaced', 'truncated']);
const DESTINATIONS = new Set(['none', 'search', 'home', 'sports', 'news', 'music', 'podcasts', 'movies', 'gaming', 'live', 'subscriptions', 'library', 'more', 'other', 'invalid']);
const MAX_CLOCK_STEP_MS = 60_000;
const SAFE_VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;
const SAFE_TAG = /^s[0-9]{1,7}$/;
const SAFE_BASE = /^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function validNumber(value, maximum = BROWSER_DIAGNOSTICS_LIMITS.durationMs) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function sanitizeContext(value) {
  const source = isRecord(value) ? value : {};
  const version = typeof source.bundleVersion === 'string' && SAFE_VERSION.test(source.bundleVersion)
    ? source.bundleVersion : null;
  const scriptTag = typeof source.scriptTag === 'string' && SAFE_TAG.test(source.scriptTag)
    ? source.scriptTag : null;
  const baseTag = typeof source.baseTag === 'string' && SAFE_BASE.test(source.baseTag)
    ? source.baseTag : null;
  const startupDestination = DESTINATIONS.has(source.startupDestination) ? source.startupDestination : 'invalid';
  return {
    packageId: source.packageId === 'io.github.twoarchiver.ytark' ? source.packageId : null,
    bundleVersion: version,
    bundleVersionSource: 'bundled-build-metadata',
    packageVersion: null,
    packageVersionSource: 'not-exposed-to-userscript',
    scriptTag,
    baseTag,
    reloadHomeOnStartup: typeof source.reloadHomeOnStartup === 'boolean' ? source.reloadHomeOnStartup : null,
    fasterStartup: typeof source.fasterStartup === 'boolean' ? source.fasterStartup : null,
    startupDestination,
  };
}

function sanitizeEvent(value, sessionClock) {
  if (!isRecord(value) || !EVENT_NAMES.has(value.event)) return null;
  const allowed = EVENT_OUTCOMES[value.event];
  if (!allowed.includes(value.outcome)) return null;
  const quality = QUALITIES.has(value.quality) ? value.quality : 'degraded';
  const relativeMs = value.relativeMs === null || value.relativeMs === undefined
    ? null : (validNumber(value.relativeMs) ? value.relativeMs : null);
  const valueMs = value.valueMs === null || value.valueMs === undefined
    ? null : (validNumber(value.valueMs) ? value.valueMs : null);
  if (value.relativeMs !== null && value.relativeMs !== undefined && relativeMs === null) return null;
  if (value.valueMs !== null && value.valueMs !== undefined && valueMs === null) return null;
  return {
    source: 'browser',
    clock: sessionClock,
    relativeMs,
    event: value.event,
    outcome: value.outcome,
    quality,
    valueMs,
  };
}

function sanitizeSession(value) {
  if (!isRecord(value) || value.schema !== BROWSER_DIAGNOSTICS_SCHEMA
      || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)
      || !CAPTURES.has(value.capture) || !SESSION_STATUSES.has(value.status)
      || !CLOCK_DOMAINS.has(value.clockDomain) || !Array.isArray(value.events)
      || value.events.length > BROWSER_DIAGNOSTICS_LIMITS.eventsPerSession) return null;
  const events = [];
  for (const item of value.events) {
    const event = sanitizeEvent(item, value.clockDomain);
    if (!event) return null;
    events.push(event);
  }
  return {
    schema: BROWSER_DIAGNOSTICS_SCHEMA,
    id: value.id,
    capture: value.capture,
    status: value.status,
    clockDomain: value.clockDomain,
    clockQuality: value.clockQuality === 'monotonic' ? 'monotonic'
      : value.clockQuality === 'degraded' ? 'degraded' : 'unavailable',
    context: sanitizeContext(value.context),
    events,
    truncated: value.truncated === true,
  };
}

function readDataset(storage) {
  if (!storage) return { sessions: [], draft: null, status: 'unavailable', evicted: 0 };
  let raw;
  let rawDraft;
  try {
    raw = storage.getItem(BROWSER_DIAGNOSTICS_KEY);
    rawDraft = storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY);
  } catch (_) {
    return { sessions: [], draft: null, status: 'unavailable', evicted: 0 };
  }
  if ((raw === null || raw === undefined || raw === '')
      && (rawDraft === null || rawDraft === undefined || rawDraft === '')) {
    return { sessions: [], draft: null, status: 'empty', evicted: 0 };
  }
  const totalBytes = (typeof raw === 'string' ? utf8Length(raw) : 0)
    + (typeof rawDraft === 'string' ? utf8Length(rawDraft) : 0);
  if (totalBytes > BROWSER_DIAGNOSTICS_LIMITS.bytes || (raw !== null && typeof raw !== 'string')
      || (rawDraft !== null && typeof rawDraft !== 'string')) {
    return { sessions: [], draft: null, status: 'oversized', evicted: 0 };
  }
  let parsed = { schema: BROWSER_DIAGNOSTICS_SCHEMA, sessions: [], evicted: 0 };
  if (raw) {
    try { parsed = JSON.parse(raw); } catch (_) {
      return { sessions: [], draft: null, status: 'corrupt', evicted: 0 };
    }
  }
  if (!isRecord(parsed) || !Number.isInteger(parsed.schema)) {
    return { sessions: [], draft: null, status: 'corrupt', evicted: 0 };
  }
  if (parsed.schema !== BROWSER_DIAGNOSTICS_SCHEMA) {
    return { sessions: [], draft: null, status: parsed.schema > BROWSER_DIAGNOSTICS_SCHEMA ? 'future-schema' : 'corrupt', evicted: 0 };
  }
  if (!Array.isArray(parsed.sessions) || parsed.sessions.length > BROWSER_DIAGNOSTICS_LIMITS.sessions) {
    return { sessions: [], draft: null, status: 'corrupt', evicted: 0 };
  }
  const sessions = [];
  for (const item of parsed.sessions) {
    const clean = sanitizeSession(item);
    if (!clean || clean.status === 'active') return { sessions: [], draft: null, status: 'corrupt', evicted: 0 };
    sessions.push(clean);
  }
  let draft = null;
  if (rawDraft) {
    let parsedDraft;
    try { parsedDraft = JSON.parse(rawDraft); } catch (_) {
      return { sessions: [], draft: null, status: 'corrupt', evicted: 0 };
    }
    if (!isRecord(parsedDraft) || parsedDraft.schema !== BROWSER_DIAGNOSTICS_SCHEMA) {
      return { sessions: [], draft: null, status: parsedDraft && parsedDraft.schema > BROWSER_DIAGNOSTICS_SCHEMA ? 'future-schema' : 'corrupt', evicted: 0 };
    }
    draft = sanitizeSession(parsedDraft.session);
    if (!draft || draft.status !== 'active') return { sessions: [], draft: null, status: 'corrupt', evicted: 0 };
  }
  if (sessions.length + (draft ? 1 : 0) > BROWSER_DIAGNOSTICS_LIMITS.sessions) {
    return { sessions: [], draft: null, status: 'corrupt', evicted: 0 };
  }
  const evicted = Number.isInteger(parsed.evicted) && parsed.evicted >= 0 && parsed.evicted <= 1_000_000
    ? parsed.evicted : 0;
  return { sessions, draft, status: 'ready', evicted };
}

export function classifyStartupDestination(raw) {
  if (raw === null || raw === undefined || raw === '') return 'none';
  const command = parseStartupDestination(raw);
  if (!command) return 'invalid';
  if (command.searchEndpoint) return 'search';
  const id = command.browseEndpoint && command.browseEndpoint.browseId;
  if (id === 'FEtopics') return 'home';
  if (id === 'FEtopics_sports') return 'sports';
  if (id === 'FEtopics_news') return 'news';
  if (id === 'FEtopics_music') return 'music';
  if (id === 'FEtopics_podcasts') return 'podcasts';
  if (id === 'FEtopics_movies') return 'movies';
  if (id === 'FEtopics_gaming') return 'gaming';
  if (id === 'FEtopics_live') return 'live';
  if (id === 'FEsubscriptions') return 'subscriptions';
  if (id === 'FElibrary') return 'library';
  if (id === 'FEtopics_more') return 'more';
  return 'invalid';
}

function makeContext() {
  let reload = null;
  let faster = null;
  let destination = 'invalid';
  try { reload = configRead('reloadHomeOnStartup') === true; } catch (_) { /* unavailable */ }
  try { faster = configRead('fasterStartup') === true; } catch (_) { /* unavailable */ }
  try {
    destination = reload === false ? 'none' : classifyStartupDestination(configRead('launchToOnStartup'));
  } catch (_) { /* unavailable */ }
  return sanitizeContext({
    packageId: YTARK_BUILD_INFO && YTARK_BUILD_INFO.appId,
    bundleVersion: YTARK_BUILD_INFO && YTARK_BUILD_INFO.versionName,
    scriptTag: YTARK_BUILD_INFO && YTARK_BUILD_INFO.scriptTag,
    baseTag: YTARK_BUILD_INFO && YTARK_BUILD_INFO.baseTag,
    reloadHomeOnStartup: reload,
    fasterStartup: faster,
    startupDestination: destination,
  });
}

/** One stable clock for one recorder/session. Date fallback is always degraded. */
export function createDiagnosticClock({ performanceObject, wallNow = () => Date.now(), maxWallStepMs = MAX_CLOCK_STEP_MS } = {}) {
  let perf = performanceObject;
  if (perf === undefined) {
    try { perf = typeof performance !== 'undefined' ? performance : null; } catch (_) { perf = null; }
  }
  let perfNow = null;
  if (perf) {
    try { if (typeof perf.now === 'function') perfNow = perf.now.bind(perf); } catch (_) { perfNow = null; }
  }
  let domain = 'unavailable';
  let origin = null;
  let last = null;
  let invalid = false;
  if (perfNow) {
    try {
      const value = perfNow();
      if (Number.isFinite(value) && value >= 0) {
        domain = 'performance';
        origin = value;
        last = value;
      } else perfNow = null;
    } catch (_) { perfNow = null; }
  }
  if (!perfNow) {
    domain = 'date-fallback';
    try {
      const value = wallNow();
      if (Number.isFinite(value)) { origin = value; last = value; }
      else { domain = 'unavailable'; invalid = true; }
    } catch (_) { domain = 'unavailable'; invalid = true; }
  }

  function read() {
    if (invalid || origin === null || domain === 'unavailable') {
      return { relativeMs: null, domain, quality: 'degraded' };
    }
    let value;
    try { value = domain === 'performance' ? perfNow() : wallNow(); } catch (_) {
      invalid = true;
      return { relativeMs: null, domain, quality: 'degraded' };
    }
    if (!Number.isFinite(value) || value < last
        || (domain === 'date-fallback' && value - last > maxWallStepMs)) {
      invalid = true;
      return { relativeMs: null, domain, quality: 'degraded' };
    }
    last = value;
    const relativeMs = value - origin;
    if (!validNumber(relativeMs, 24 * 60 * 60 * 1000)) {
      invalid = true;
      return { relativeMs: null, domain, quality: 'degraded' };
    }
    return { relativeMs, domain, quality: domain === 'performance' ? 'monotonic' : 'degraded' };
  }

  return {
    domain,
    get quality() { return invalid ? 'degraded' : domain === 'performance' ? 'monotonic' : domain === 'date-fallback' ? 'degraded' : 'unavailable'; },
    read,
    duration(start, end) {
      if (!start || !end || start.domain !== domain || end.domain !== domain
          || start.relativeMs === null || end.relativeMs === null || end.relativeMs < start.relativeMs) return null;
      const duration = end.relativeMs - start.relativeMs;
      return validNumber(duration, 24 * 60 * 60 * 1000) ? duration : null;
    },
  };
}

function defaultStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch (_) { return null; }
}

function safeConnected(video) {
  try { return video && video.isConnected !== false; } catch (_) { return false; }
}

function visibleAndInline(documentObject, windowObject) {
  try {
    if (documentObject && documentObject.visibilityState === 'hidden') return false;
    if (documentObject && documentObject.pictureInPictureElement) return false;
    if (windowObject && windowObject.isPipPlaying === true) return false;
  } catch (_) { return false; }
  return true;
}

/**
 * Stateful recorder with injected DOM/storage/timer dependencies for host tests.
 * Only fixed enums and safe context fields cross the persistence boundary.
 */
export class BrowserDiagnosticRecorder {
  constructor({
    storage = null,
    documentObject = null,
    windowObject = null,
    enabled = false,
    context = makeContext,
    clockFactory = () => createDiagnosticClock(),
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    mutationObserverFactory = null,
  } = {}) {
    this.storage = storage;
    this.document = documentObject;
    this.window = windowObject;
    this.contextFactory = typeof context === 'function' ? context : () => context;
    this.clockFactory = clockFactory;
    this.schedule = schedule;
    this.cancel = cancel;
    this.mutationObserverFactory = mutationObserverFactory;
    this.enabled = false;
    this.active = null;
    this.sessions = [];
    this.evicted = 0;
    this.storageStatus = 'empty';
    this.historyDirty = false;
    this.durationTimer = null;
    this.persistTimer = null;
    this.finalPersistTimer = null;
    this.generation = 0;
    this.observer = null;
    this.videoListeners = new Map();
    this.remoteSamples = 0;
    this.onKeyDown = (event) => this.handleRemoteInput(event);
    this.onLoadedMetadata = (event) => this.attachVideo(event && event.target);
    if (enabled) this.enable({ capture: 'launch' });
  }

  get status() {
    if (!this.enabled) return 'off';
    if (!this.active) return 'complete';
    return 'recording';
  }

  get storageState() { return this.storageStatus; }

  _loadForEnable() {
    const data = readDataset(this.storage);
    this.storageStatus = data.status;
    if (data.status === 'ready') {
      this.sessions = data.sessions.slice(-BROWSER_DIAGNOSTICS_LIMITS.sessions);
      this.evicted = data.evicted;
      if (data.draft) {
        const interrupted = { ...data.draft, status: 'interrupted' };
        this.sessions.push(interrupted);
        this._trimSessions();
        this.historyDirty = true;
      }
    }
  }

  _newId() {
    try {
      const cryptoObject = this.window && this.window.crypto;
      if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    } catch (_) { /* use local fallback */ }
    return `sample_${Math.floor(Math.random() * 0x7fffffff).toString(36)}_${this.sessions.length + 1}`;
  }

  enable({ capture = 'partial' } = {}) {
    if (this.enabled) return this.active;
    this.enabled = true;
    this._loadForEnable();
    this._startSession(CAPTURES.has(capture) ? capture : 'partial');
    return this.active;
  }

  setEnabled(enabled) {
    if (enabled) return this.enable({ capture: 'partial' });
    this.disable();
    return null;
  }

  _startSession(capture) {
    // The active draft consumes one of the twenty retained session slots too.
    // Evict deterministically before opening a new sample, not only at finish.
    while (this.sessions.length >= BROWSER_DIAGNOSTICS_LIMITS.sessions) {
      this.sessions.shift();
      this.evicted += 1;
      this.historyDirty = true;
    }
    const clock = this.clockFactory();
    const start = clock.read();
    this.active = {
      schema: BROWSER_DIAGNOSTICS_SCHEMA,
      id: this._newId(),
      capture,
      status: 'active',
      clockDomain: CLOCK_DOMAINS.has(clock.domain) ? clock.domain : 'unavailable',
      clockQuality: clock.quality,
      context: sanitizeContext(this.contextFactory()),
      events: [],
      truncated: false,
      startedAt: start,
      clock,
    };
    this.remoteSamples = 0;
    this._startCollectors();
    this.record('recording-started', capture, capture === 'launch' ? 'observed' : 'proxy');
    this.durationTimer = this.schedule(() => this._finish('complete'), BROWSER_DIAGNOSTICS_LIMITS.durationMs);
    this._schedulePersist();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this._stopCollectors();
    if (this.durationTimer !== null) this.cancel(this.durationTimer);
    if (this.persistTimer !== null) this.cancel(this.persistTimer);
    if (this.finalPersistTimer !== null) this.cancel(this.finalPersistTimer);
    this.durationTimer = null;
    this.persistTimer = null;
    this.finalPersistTimer = null;
    this.generation += 1;
    // An in-memory/unfinished draft is discarded immediately. Completed reports
    // remain until Clear or deterministic retention eviction.
    this.active = null;
    try { if (this.storage) this.storage.removeItem(BROWSER_DIAGNOSTICS_DRAFT_KEY); }
    catch (_) { this.storageStatus = 'unavailable'; }
  }

  clear() {
    this._stopCollectors();
    if (this.durationTimer !== null) this.cancel(this.durationTimer);
    if (this.persistTimer !== null) this.cancel(this.persistTimer);
    if (this.finalPersistTimer !== null) this.cancel(this.finalPersistTimer);
    this.durationTimer = null;
    this.persistTimer = null;
    this.finalPersistTimer = null;
    this.generation += 1;
    this.active = null;
    this.sessions = [];
    this.evicted = 0;
    let cleared = false;
    try {
      if (this.storage) {
        this.storage.removeItem(BROWSER_DIAGNOSTICS_KEY);
        this.storage.removeItem(BROWSER_DIAGNOSTICS_DRAFT_KEY);
        cleared = true;
      }
      this.storageStatus = this.storage ? 'empty' : 'unavailable';
      this.historyDirty = false;
    } catch (_) { this.storageStatus = 'unavailable'; }
    if (this.enabled) this._startSession('partial');
    return cleared;
  }

  _finish(status, terminalAlreadyRecorded = false) {
    if (!this.active) return;
    const current = this.active;
    if (!terminalAlreadyRecorded && current.events.length < BROWSER_DIAGNOSTICS_LIMITS.eventsPerSession) {
      const outcome = status === 'replaced' ? 'replaced' : 'complete';
      const time = current.clock.read();
      current.clockQuality = current.clock.quality;
      current.events.push({
        source: 'browser', clock: current.clockDomain, relativeMs: time.relativeMs,
        event: 'recording-ended', outcome, quality: time.quality === 'monotonic' ? 'observed' : 'degraded', valueMs: null,
      });
    }
    if (this.durationTimer !== null) this.cancel(this.durationTimer);
    if (this.persistTimer !== null) this.cancel(this.persistTimer);
    if (this.finalPersistTimer !== null) this.cancel(this.finalPersistTimer);
    this.durationTimer = null;
    this.persistTimer = null;
    this.finalPersistTimer = null;
    this._stopCollectors();
    current.status = SESSION_STATUSES.has(status) && status !== 'active' ? status : 'complete';
    this.active = null;
    this.sessions.push(this._plainSession(current));
    this._trimSessions();
    this.historyDirty = true;
    const generation = this.generation;
    this.finalPersistTimer = this.schedule(() => {
      this.finalPersistTimer = null;
      if (this.enabled && generation === this.generation) this._persist({ draft: this.active ? this._plainSession(this.active) : null, historyChanged: true });
    }, 0);
  }

  _plainSession(session) {
    return {
      schema: session.schema,
      id: session.id,
      capture: session.capture,
      status: session.status,
      clockDomain: session.clockDomain,
      clockQuality: session.clockQuality,
      context: sanitizeContext(session.context),
      events: session.events.map((event) => sanitizeEvent(event, session.clockDomain)).filter(Boolean),
      truncated: session.truncated === true,
    };
  }

  _trimSessions() {
    while (this.sessions.length > BROWSER_DIAGNOSTICS_LIMITS.sessions) {
      this.sessions.shift();
      this.evicted += 1;
    }
  }

  record(eventName, outcome = 'observed', quality = 'observed', valueMs = null) {
    try { return this._record(eventName, outcome, quality, valueMs); }
    catch (_) { return false; } // diagnostics must never break player/UI behavior
  }

  _record(eventName, outcome = 'observed', quality = 'observed', valueMs = null) {
    const session = this.active;
    if (!this.enabled || !session || !EVENT_NAMES.has(eventName)
        || !EVENT_OUTCOMES[eventName].includes(outcome) || !QUALITIES.has(quality)) return false;
    if (session.events.length >= BROWSER_DIAGNOSTICS_LIMITS.eventsPerSession - 1) {
      session.truncated = true;
      const time = session.clock.read();
      session.clockQuality = session.clock.quality;
      session.events.push({
        source: 'browser', clock: session.clockDomain, relativeMs: time.relativeMs,
        event: 'recording-ended', outcome: 'event-limit', quality: 'degraded', valueMs: null,
      });
      this._finish('truncated', true);
      return false;
    }
    if (valueMs !== null && !validNumber(valueMs)) valueMs = null;
    const time = session.clock.read();
    session.clockQuality = session.clock.quality;
    const clockQuality = time.quality === 'monotonic' ? quality : 'degraded';
    const event = sanitizeEvent({
      event: eventName,
      outcome,
      quality: clockQuality,
      relativeMs: time.relativeMs,
      valueMs,
    }, session.clockDomain);
    if (!event) return false;
    session.events.push(event);
    this._schedulePersist();
    return true;
  }

  recordNavigation(category) {
    const allowed = ['explicit-destination', 'soft-reload', 'disabled'].includes(category) ? category : 'disabled';
    return this.record('startup-navigation-dispatched', allowed, 'observed');
  }

  recordStartupReadinessMode(mode) {
    const allowed = EVENT_OUTCOMES['startup-readiness-mode'].includes(mode) ? mode : null;
    return allowed ? this.record('startup-readiness-mode', allowed, 'observed') : false;
  }

  startupSummary() {
    // An explicit summary request may read saved diagnostics while collection is
    // off; the default-off bootstrap itself still does not touch these keys.
    if (!this.enabled && !this.storage) this.storage = defaultStorage();
    const recent = this._readSamplesForSummary();
    return summarizeStartupSessions({
      sessions: recent.samples, status: recent.status,
      recordingEnabled: this.enabled, activeRecording: !!this.active,
    });
  }

  beginRemoteHandler(category) {
    if (!this.enabled || !this.active || !['dpad-left', 'dpad-right', 'dpad-up', 'dpad-down', 'ok', 'back'].includes(category)
        || this.remoteSamples >= 8) return null;
    this.remoteSamples += 1;
    return { sessionId: this.active.id, category, started: this.active.clock.read() };
  }

  endRemoteHandler(sample) {
    if (!sample || !this.enabled || !this.active || sample.sessionId !== this.active.id) return;
    const ended = this.active.clock.read();
    const elapsed = this.active.clock.duration(sample.started, ended);
    this.record('remote-handler-sync-duration', sample.category, elapsed === null ? 'degraded' : 'observed', elapsed);
    let raf = null;
    try { raf = this.window && this.window.requestAnimationFrame; } catch (_) { /* unavailable */ }
    if (typeof raf !== 'function') {
      this.record('remote-handler-render-opportunity', 'unsupported', 'unsupported');
      return;
    }
    try {
      raf.call(this.window, () => {
        if (!this.enabled || !this.active || this.active.id !== sample.sessionId) return;
        const paintedOpportunity = this.active.clock.read();
        const delay = this.active.clock.duration(sample.started, paintedOpportunity);
        this.record('remote-handler-render-opportunity', delay === null ? 'unsupported' : sample.category,
          delay === null ? 'unsupported' : 'proxy', delay);
      });
    } catch (_) {
      this.record('remote-handler-render-opportunity', 'unsupported', 'unsupported');
    }
  }

  handleRemoteInput(event) {
    if (!this.enabled || !this.active || !event || event.type !== 'keydown' || isTextEntry(event.target)
        || this.active.events.some((item) => item.event === 'first-remote-input-received')) return;
    const category = remoteKeyCategory(event);
    if (category) this.record('first-remote-input-received', category, 'proxy');
  }

  _startCollectors() {
    if (!this.document || typeof this.document.addEventListener !== 'function') return;
    try { this.document.addEventListener('keydown', this.onKeyDown, true); } catch (_) { /* unavailable */ }
    try { this.document.addEventListener('loadedmetadata', this.onLoadedMetadata, true); } catch (_) { /* best effort */ }
    try {
      const Observer = this.mutationObserverFactory || (this.window && this.window.MutationObserver);
      if (typeof Observer === 'function' && this.document.documentElement) {
        this.observer = new Observer((records) => this._onMutations(records));
        this.observer.observe(this.document.documentElement, { childList: true, subtree: true });
      }
    } catch (_) { this.observer = null; }
    try {
      if (typeof this.document.querySelectorAll === 'function') {
        for (const video of this.document.querySelectorAll('video')) this.attachVideo(video);
      }
    } catch (_) { /* a delayed player may be found through observer/events */ }
  }

  _onMutations(records) {
    if (!this.enabled || !this.active) return;
    for (const record of records || []) {
      for (const node of record.addedNodes || []) this._attachVideosIn(node);
      for (const node of record.removedNodes || []) this._detachVideosIn(node);
    }
    for (const video of this.videoListeners.keys()) if (!safeConnected(video)) this.detachVideo(video);
  }

  _attachVideosIn(node) {
    if (!node) return;
    try {
      if (String(node.tagName || '').toLowerCase() === 'video') this.attachVideo(node);
      if (typeof node.querySelectorAll === 'function') {
        for (const video of node.querySelectorAll('video')) this.attachVideo(video);
      }
    } catch (_) { /* unsupported node */ }
  }

  _detachVideosIn(node) {
    if (!node) return;
    for (const video of this.videoListeners.keys()) {
      if (video === node || (typeof node.contains === 'function' && node.contains(video)) || !safeConnected(video)) {
        this.detachVideo(video);
      }
    }
  }

  attachVideo(video) {
    try { return this._attachVideo(video); }
    catch (_) { return false; } // hostile/partial media objects must not escape into playback code
  }

  _attachVideo(video) {
    if (!this.enabled || !this.active || !video || this.videoListeners.has(video)
        || typeof video.addEventListener !== 'function') return false;
    const state = { hasPlayed: false, wasPaused: false, seeking: false, buffering: false, bufferStarted: null, ended: false, frameQueued: false };
    const listeners = {};
    const listen = (name, fn) => { listeners[name] = fn; try { video.addEventListener(name, fn, true); } catch (_) { /* no-op */ } };
    listen('play', () => {
      if (!safeConnected(video)) return;
      if (state.ended) state.ended = false;
      this._scheduleFirstFrame(video, state);
    });
    listen('pause', () => { if (!state.ended) state.wasPaused = true; });
    listen('seeking', () => { state.seeking = true; });
    listen('seeked', () => { state.seeking = false; });
    const noteBuffering = () => {
      let paused;
      try { paused = video.paused; } catch (_) { return; }
      if (!state.hasPlayed || state.seeking || paused || !visibleAndInline(this.document, this.window) || state.buffering) return;
      state.buffering = true;
      state.bufferStarted = this.active ? this.active.clock.read() : null;
    };
    listen('waiting', noteBuffering);
    listen('stalled', noteBuffering);
    listen('playing', () => {
      if (!safeConnected(video)) return;
      if (!this.active) return;
      if (!this.active.events.some((event) => event.event === 'first-playing-event')) {
        this.record('first-playing-event', 'observed', 'proxy');
      }
      const bufferRecovered = state.buffering && visibleAndInline(this.document, this.window);
      let playbackKind = 'unknown';
      if (bufferRecovered) playbackKind = 'buffering-recovery';
      else if (state.seeking) playbackKind = 'seek';
      else if (state.wasPaused || state.hasPlayed) playbackKind = 'resume';
      else playbackKind = 'initial';
      if (bufferRecovered) {
        const bufferEnded = this.active.clock.read();
        const bufferDuration = this.active.clock.duration(state.bufferStarted, bufferEnded);
        this.record('buffering-interval', 'recovered', bufferDuration === null ? 'degraded' : 'proxy', bufferDuration);
      }
      this.record('playback-playing', playbackKind, 'proxy');
      state.hasPlayed = true;
      state.wasPaused = false;
      state.seeking = false;
      state.buffering = false;
      state.bufferStarted = null;
      this._scheduleFirstFrame(video, state);
    });
    listen('ended', () => { state.ended = true; state.buffering = false; state.bufferStarted = null; state.wasPaused = false; });
    this.videoListeners.set(video, { listeners, state });
    return true;
  }

  _scheduleFirstFrame(video, state) {
    const session = this.active;
    if (state.frameQueued || !session || !safeConnected(video) || !visibleAndInline(this.document, this.window)) return;
    state.frameQueued = true;
    let callback = null;
    try { callback = video.requestVideoFrameCallback; } catch (_) { /* unsupported */ }
    if (!this.enabled || this.active !== session) return;
    if (typeof callback !== 'function') {
      if (!session.events.some((event) => event.event === 'first-video-frame-callback')) {
        this.record('first-video-frame-callback', 'unsupported', 'unsupported');
      }
      return;
    }
    try {
      const sessionId = session.id;
      const handle = callback.call(video, () => {
        if (!this.enabled || !this.active || this.active.id !== sessionId || !safeConnected(video)) return;
        if (!this.active.events.some((event) => event.event === 'first-video-frame-callback')) {
          this.record('first-video-frame-callback', 'observed', 'proxy');
        }
      });
      if (!this.enabled || this.active !== session) return;
      const info = this.videoListeners.get(video);
      if (info) info.frameHandle = handle;
    } catch (_) {
      if (this.active === session && !session.events.some((event) => event.event === 'first-video-frame-callback')) {
        this.record('first-video-frame-callback', 'unsupported', 'unsupported');
      }
    }
  }

  detachVideo(video) {
    const info = this.videoListeners.get(video);
    if (!info) return;
    for (const [name, listener] of Object.entries(info.listeners)) {
      try { video.removeEventListener(name, listener, true); } catch (_) { /* best effort */ }
    }
    let cancelFrame = null;
    try { cancelFrame = video.cancelVideoFrameCallback; } catch (_) { /* unsupported property */ }
    if (info.frameHandle !== undefined && typeof cancelFrame === 'function') {
      try { cancelFrame.call(video, info.frameHandle); } catch (_) { /* best effort */ }
    }
    this.videoListeners.delete(video);
  }

  _stopCollectors() {
    if (this.document && typeof this.document.removeEventListener === 'function') {
      try { this.document.removeEventListener('keydown', this.onKeyDown, true); } catch (_) { /* best effort */ }
      try { this.document.removeEventListener('loadedmetadata', this.onLoadedMetadata, true); } catch (_) { /* best effort */ }
    }
    if (this.observer) { try { this.observer.disconnect(); } catch (_) { /* best effort */ } this.observer = null; }
    for (const video of [...this.videoListeners.keys()]) this.detachVideo(video);
  }

  _schedulePersist() {
    if (!this.enabled || !this.active || !this.storage || this.persistTimer !== null) return;
    this.persistTimer = this.schedule(() => {
      this.persistTimer = null;
      if (this.enabled && this.active) this._persist({ draft: this._plainSession(this.active) });
    }, BROWSER_DIAGNOSTICS_LIMITS.draftBatchMs);
  }

  _persist({ draft = null, historyChanged = false } = {}) {
    if (!this.storage) { this.storageStatus = 'unavailable'; return false; }
    const sessions = this.sessions.map((session) => sanitizeSession(session)).filter(Boolean);
    let evicted = this.evicted;
    while (sessions.length + (draft ? 1 : 0) > BROWSER_DIAGNOSTICS_LIMITS.sessions) {
      sessions.shift();
      evicted += 1;
    }
    let historyText = JSON.stringify({ schema: BROWSER_DIAGNOSTICS_SCHEMA, sessions, evicted });
    let draftText = draft ? JSON.stringify({ schema: BROWSER_DIAGNOSTICS_SCHEMA, session: draft }) : null;
    const total = () => utf8Length(historyText) + (draftText ? utf8Length(draftText) : 0);
    while (total() > BROWSER_DIAGNOSTICS_LIMITS.bytes && sessions.length > 0) {
      sessions.shift();
      evicted += 1;
      historyText = JSON.stringify({ schema: BROWSER_DIAGNOSTICS_SCHEMA, sessions, evicted });
    }
    if (total() > BROWSER_DIAGNOSTICS_LIMITS.bytes) {
      this.storageStatus = 'oversized';
      return false;
    }
    try {
      // Completed history is not rewritten when stopping or checkpointing a
      // draft. Disabling removes only the unfinished draft; saved reports stay.
      if (historyChanged || this.historyDirty || !this.storage.getItem(BROWSER_DIAGNOSTICS_KEY)) {
        this.storage.setItem(BROWSER_DIAGNOSTICS_KEY, historyText);
        this.historyDirty = false;
      } else if (sessions.length !== this.sessions.length || evicted !== this.evicted) {
        this.storage.setItem(BROWSER_DIAGNOSTICS_KEY, historyText);
      }
      if (draftText) this.storage.setItem(BROWSER_DIAGNOSTICS_DRAFT_KEY, draftText);
      else this.storage.removeItem(BROWSER_DIAGNOSTICS_DRAFT_KEY);
      this.sessions = sessions;
      this.evicted = evicted;
      this.storageStatus = 'ready';
      return true;
    } catch (_) {
      this.storageStatus = 'unavailable';
      return false;
    }
  }

  _readSamplesForSummary() {
    if (this.enabled && this.active) {
      const samples = [this._plainSession(this.active), ...this.sessions.slice().reverse()];
      return { samples: samples.slice(0, BROWSER_DIAGNOSTICS_LIMITS.sessions), status: this.storageStatus };
    }
    const data = readDataset(this.storage);
    this.storageStatus = data.status;
    return { samples: data.sessions.slice().reverse(), status: data.status };
  }

  _getStorageState() { return this.storageStatus; }
}

function isTextEntry(target) {
  if (!target) return false;
  try {
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select'
      || target.isContentEditable === true || target.getAttribute?.('contenteditable') === 'true';
  } catch (_) { return true; }
}

export function remoteKeyCategory(event) {
  if (!event || isTextEntry(event.target)) return null;
  const code = Number(event.keyCode || event.which || 0);
  if (code === 37) return 'dpad-left';
  if (code === 38) return 'dpad-up';
  if (code === 39) return 'dpad-right';
  if (code === 40) return 'dpad-down';
  if (code === 13 || code === 32) return 'ok';
  if (code === 27 || code === 8 || code === 10009 || code === 461) return 'back';
  return null;
}

export const browserDiagnostics = new BrowserDiagnosticRecorder({
  storage: null,
  documentObject: typeof document !== 'undefined' ? document : null,
  windowObject: typeof window !== 'undefined' ? window : null,
  enabled: false,
});

function initializeBrowserRecorder() {
  // Avoid even touching the diagnostics key or registering listeners when OFF.
  if (configRead('recordBrowserDiagnostics') !== true) return;
  browserDiagnostics.storage = defaultStorage();
  browserDiagnostics.enable({ capture: 'launch' });
}

initializeBrowserRecorder();

/** Persist the opt-in preference through the existing YTArk settings store. */
export function setBrowserDiagnosticsEnabled(enabled) {
  const value = enabled === true;
  configWrite('recordBrowserDiagnostics', value);
  if (value) browserDiagnostics.storage = defaultStorage();
  browserDiagnostics.setEnabled(value);
  return { enabled: value, preferenceSaved: lastPersistSucceeded(), storageState: browserDiagnostics.storageState };
}

export function clearBrowserDiagnosticData() {
  // Explicit Clear is allowed to open the recorder's separate storage even when
  // collection is OFF; automatic off-state initialization still touches none.
  browserDiagnostics.storage = defaultStorage();
  return browserDiagnostics.clear();
}

export default browserDiagnostics;
