import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_DIAGNOSTICS_KEY, BROWSER_DIAGNOSTICS_DRAFT_KEY, BROWSER_DIAGNOSTICS_LIMITS,
  BrowserDiagnosticRecorder, classifyStartupDestination, createDiagnosticClock, remoteKeyCategory,
} from '../features/browserDiagnostics.js';

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); this.reads = 0; this.writes = 0; }
  getItem(key) { this.reads += 1; return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.writes += 1; this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class FakeObserver {
  constructor(callback) { this.callback = callback; this.active = false; }
  observe(root, options) { this.root = root; this.options = options; this.active = true; }
  disconnect() { this.active = false; }
}

function harness({ enabled = false, storage = new MemoryStorage(), frameCallbacks = true } = {}) {
  let now = 10;
  let nextTimer = 1;
  let nextFrame = null;
  const tasks = new Map();
  const documentListeners = new Map();
  const videoListeners = new Map();
  const video = {
    tagName: 'VIDEO', isConnected: true, paused: false,
    addEventListener(name, callback) {
      if (!videoListeners.has(name)) videoListeners.set(name, new Set());
      videoListeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { videoListeners.get(name)?.delete(callback); },
    emit(name) { for (const callback of [...(videoListeners.get(name) || [])]) callback({ type: name, target: video }); },
    ...(frameCallbacks ? {
      requestVideoFrameCallback(callback) { this.frameCallback = callback; return 1; },
      cancelVideoFrameCallback() { this.frameCallback = null; },
    } : {}),
  };
  const doc = {
    visibilityState: 'visible', pictureInPictureElement: null, documentElement: {},
    addEventListener(name, callback) {
      if (!documentListeners.has(name)) documentListeners.set(name, new Set());
      documentListeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { documentListeners.get(name)?.delete(callback); },
    querySelectorAll(selector) { return selector === 'video' ? [video] : []; },
    emit(name, event) { for (const callback of [...(documentListeners.get(name) || [])]) callback(event); },
  };
  const win = {
    isPipPlaying: false,
    crypto: { randomUUID: () => 'session-id-1' },
    requestAnimationFrame(callback) { nextFrame = callback; return 7; },
    cancelAnimationFrame() { nextFrame = null; },
  };
  const context = {
    packageId: 'io.github.twoarchiver.ytark',
    bundleVersion: '3.6.0', scriptTag: 's37', baseTag: 'v2.0.2',
    packageVersion: 'should-not-be-read',
    reloadHomeOnStartup: true, fasterStartup: false, startupDestination: 'home',
    url: 'https://private.invalid/watch?v=secret', account: 'not-allowed',
  };
  const recorder = new BrowserDiagnosticRecorder({
    storage, documentObject: doc, windowObject: win, enabled, context,
    clockFactory: () => createDiagnosticClock({ performanceObject: { now: () => now } }),
    schedule(callback, ms) { const id = nextTimer++; tasks.set(id, { callback, ms }); return id; },
    cancel(id) { tasks.delete(id); },
    mutationObserverFactory: FakeObserver,
  });
  return {
    recorder, storage, doc, win, video, tasks, documentListeners, videoListeners,
    setTime(value) { now = value; }, advance(ms) { now += ms; },
    runTimer(ms) {
      const entry = [...tasks.entries()].find(([, task]) => task.ms === ms);
      if (!entry) return false;
      tasks.delete(entry[0]); entry[1].callback(); return true;
    },
    runNextTimer() {
      const entry = tasks.entries().next().value;
      if (!entry) return false;
      tasks.delete(entry[0]); entry[1].callback(); return true;
    },
    fireFrame() { const callback = nextFrame; nextFrame = null; if (callback) callback(0); },
    fireVideoFrame() { const callback = video.frameCallback; video.frameCallback = null; if (callback) callback(0); },
  };
}

test('safe launch destinations are reduced to fixed categories', () => {
  const destinations = [
    ['FEtopics', 'home'], ['FEtopics_sports', 'sports'], ['FEtopics_news', 'news'],
    ['FEtopics_music', 'music'], ['FEtopics_podcasts', 'podcasts'],
    ['FEtopics_movies', 'movies'], ['FEtopics_gaming', 'gaming'], ['FEtopics_live', 'live'],
    ['FEsubscriptions', 'subscriptions'], ['FElibrary', 'library'], ['FEtopics_more', 'more'],
  ];
  for (const [browseId, expected] of destinations) {
    assert.equal(classifyStartupDestination(JSON.stringify({ browseEndpoint: { browseId } })), expected, browseId);
  }
  assert.equal(classifyStartupDestination('{"browseEndpoint":{"browseId":"FEshorts"}}'), 'invalid');
});

test('the default-off recorder does not read storage, install listeners or create timers', () => {
  const h = harness({ enabled: false });
  assert.equal(h.recorder.status, 'off');
  assert.equal(h.storage.reads, 0);
  assert.equal(h.storage.writes, 0);
  assert.equal(h.documentListeners.size, 0);
  assert.equal(h.videoListeners.size, 0);
  assert.equal(h.tasks.size, 0);
  assert.equal(h.recorder.record('ui-module-evaluated'), false);
});

test('launch capture writes only allowlisted local fields and names a launch origin honestly', () => {
  const h = harness({ enabled: true });
  assert.equal(h.recorder.status, 'recording');
  assert.equal(h.recorder.active.capture, 'launch');
  assert.equal(h.recorder.active.events[0].event, 'recording-started');
  assert.equal(h.recorder.record('ui-module-evaluated', 'observed', 'proxy'), true);
  assert.equal(h.recorder.record('unapproved-event', 'observed'), false);
  h.recorder._persist({ draft: h.recorder._plainSession(h.recorder.active) });
  const raw = h.storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY);
  assert.ok(raw);
  assert.equal(h.storage.getItem(BROWSER_DIAGNOSTICS_KEY), JSON.stringify({ schema: 1, sessions: [], evicted: 0 }));
  assert.doesNotMatch(raw, /should-not-be-read|private\.invalid|secret|account|videoId|cookie/i);
  const saved = JSON.parse(raw).session;
  assert.equal(saved.context.packageId, 'io.github.twoarchiver.ytark');
  assert.equal(saved.context.bundleVersion, '3.6.0');
  assert.equal(saved.context.packageVersion, null);
  assert.equal(saved.context.startupDestination, 'home', 'the startup destination is reduced to a category');
  assert.equal(saved.context.reloadHomeOnStartup, true);
  assert.equal(saved.context.startupComparisonKind, undefined, 'retired user launch labels are neither stored nor displayed');
  assert.equal(saved.events[0].clock, 'performance');
  const summary = h.recorder.startupSummary();
  assert.match(summary, /Scope: userscript evaluation/);
  assert.match(summary, /not Android app start/);
  assert.doesNotMatch(summary, /remote-handler|account|private\\.invalid|should-not-be-read|cold|warm/i);
  h.recorder.disable();
});

test('partial capture, interrupted-draft recovery, retention and Clear are separate bounded operations', () => {
  const storage = new MemoryStorage();
  const first = harness({ enabled: false, storage });
  first.recorder.enable({ capture: 'partial' });
  assert.equal(first.recorder.active.capture, 'partial');
  first.recorder.record('controls-ready', 'observed', 'observed');
  first.recorder._persist({ draft: first.recorder._plainSession(first.recorder.active) });
  assert.ok(storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY));

  // A new userscript instance sees an unfinished draft as interrupted, not as a completed sample.
  const restarted = harness({ enabled: true, storage });
  assert.equal(restarted.recorder.sessions[0].status, 'interrupted');
  assert.equal(restarted.recorder.sessions[0].capture, 'partial');
  assert.equal(restarted.recorder.active.capture, 'launch');
  assert.match(restarted.recorder.startupSummary(), /Latest sample: Launch · active/);
  restarted.recorder._finish('complete');
  restarted.runNextTimer(); // final persistence
  const historyBeforeDisable = storage.getItem(BROWSER_DIAGNOSTICS_KEY);
  assert.ok(historyBeforeDisable);
  assert.equal(storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY), null);

  const unfinished = harness({ enabled: true, storage });
  unfinished.recorder._persist({ draft: unfinished.recorder._plainSession(unfinished.recorder.active) });
  unfinished.recorder.disable();
  assert.equal(storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY), null, 'disable immediately discards the unfinished draft');
  assert.equal(storage.getItem(BROWSER_DIAGNOSTICS_KEY), historyBeforeDisable, 'disable preserves completed local samples');
  assert.equal(unfinished.recorder.record('controls-ready'), false, 'no events are collected after disable');
  unfinished.recorder.clear();
  assert.equal(storage.getItem(BROWSER_DIAGNOSTICS_KEY), null);
  assert.equal(storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY), null);
  assert.equal(unfinished.recorder.status, 'off');
});

test('Clear while enabled removes saved samples and begins a new partial sample', () => {
  const storage = new MemoryStorage({
    [BROWSER_DIAGNOSTICS_KEY]: JSON.stringify({ schema: 1, sessions: [], evicted: 0 }),
    [BROWSER_DIAGNOSTICS_DRAFT_KEY]: '{"schema":1}',
  });
  const h = harness({ enabled: true, storage });
  h.recorder.clear();
  assert.equal(storage.getItem(BROWSER_DIAGNOSTICS_KEY), null);
  assert.equal(storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY), null);
  assert.equal(h.recorder.status, 'recording');
  assert.equal(h.recorder.active.capture, 'partial');
  h.recorder.disable();
});

test('a later monotonic-clock rollback degrades the sample-level clock label', () => {
  const h = harness({ enabled: true });
  assert.equal(h.recorder.active.clockQuality, 'monotonic');
  h.setTime(9);
  assert.equal(h.recorder.record('controls-ready', 'observed', 'observed'), true);
  assert.equal(h.recorder.active.clockQuality, 'degraded');
  assert.match(h.recorder.startupSummary(), /Valid startup duration for latest sample: unavailable/);
  h.recorder.disable();
});

test('session duration, event count and UTF-8 storage size have hard bounds', () => {
  const h = harness({ enabled: true });
  for (let index = 0; index < BROWSER_DIAGNOSTICS_LIMITS.eventsPerSession + 5; index += 1) {
    if (!h.recorder.active) break;
    h.recorder.record('controls-ready', 'observed');
  }
  assert.equal(h.recorder.status, 'complete');
  assert.equal(h.recorder.sessions.at(-1).status, 'truncated');
  assert.equal(h.recorder.sessions.at(-1).events.length, BROWSER_DIAGNOSTICS_LIMITS.eventsPerSession);
  h.runNextTimer();
  assert.ok(h.storage.getItem(BROWSER_DIAGNOSTICS_KEY).length < BROWSER_DIAGNOSTICS_LIMITS.bytes);
  assert.equal([...h.tasks.values()].some(task => task.ms === BROWSER_DIAGNOSTICS_LIMITS.durationMs), false);
});

test('throwing media-property reads stay contained and are reported as unsupported', () => {
  const h = harness({ enabled: true });
  Object.defineProperty(h.video, 'requestVideoFrameCallback', {
    configurable: true, get() { throw new Error('unavailable media property'); },
  });
  Object.defineProperty(h.video, 'paused', {
    configurable: true, get() { throw new Error('unavailable paused state'); },
  });
  assert.doesNotThrow(() => h.video.emit('play'));
  assert.doesNotThrow(() => h.video.emit('waiting'));
  const frame = h.recorder.active.events.find(event => event.event === 'first-video-frame-callback');
  assert.equal(frame.outcome, 'unsupported');
  assert.equal(frame.quality, 'unsupported');

  const broken = { isConnected: true };
  Object.defineProperty(broken, 'addEventListener', {
    get() { throw new Error('partial media object'); },
  });
  assert.doesNotThrow(() => h.recorder.attachVideo(broken));
  h.recorder.disable();
});

test('the active draft shares the 20-session retention cap with completed history', () => {
  const prior = Array.from({ length: 20 }, (_, index) => ({
    schema: 1, id: `saved-${index}`, capture: 'launch', status: 'complete',
    clockDomain: 'performance', clockQuality: 'monotonic', context: {}, events: [], truncated: false,
  }));
  const storage = new MemoryStorage({
    [BROWSER_DIAGNOSTICS_KEY]: JSON.stringify({ schema: 1, sessions: prior, evicted: 0 }),
  });
  const h = harness({ enabled: true, storage });
  assert.equal(h.recorder.sessions.length, 19);
  assert.equal(h.recorder.evicted, 1);
  assert.equal(h.recorder.sessions.length, BROWSER_DIAGNOSTICS_LIMITS.sessions - 1,
    'the active draft reserves one slot even though session browsing is no longer exposed');
  assert.ok(h.recorder.active, 'the one remaining slot belongs to the active sample');
  h.runTimer(BROWSER_DIAGNOSTICS_LIMITS.draftBatchMs);
  const history = JSON.parse(storage.getItem(BROWSER_DIAGNOSTICS_KEY));
  const draft = JSON.parse(storage.getItem(BROWSER_DIAGNOSTICS_DRAFT_KEY));
  assert.equal(history.sessions.length + 1, BROWSER_DIAGNOSTICS_LIMITS.sessions);
  assert.equal(draft.session.status, 'active');
  h.recorder.disable();
});

test('remote and playback events are explicit proxies; unavailable frame callbacks stay unavailable', () => {
  const h = harness({ enabled: true });
  assert.equal(h.recorder.attachVideo(h.video), false, 'the existing document collector already attached this video once');
  h.setTime(20);
  h.video.emit('play');
  h.video.emit('playing');
  h.fireVideoFrame();
  h.video.emit('pause');
  h.video.paused = false;
  h.video.emit('playing');
  h.video.emit('waiting');
  h.advance(90);
  h.video.emit('playing');
  const events = h.recorder.active.events;
  assert.ok(events.some(event => event.event === 'playback-playing' && event.outcome === 'initial'));
  assert.ok(events.some(event => event.event === 'playback-playing' && event.outcome === 'resume'));
  const buffer = events.find(event => event.event === 'buffering-interval');
  assert.equal(buffer.outcome, 'recovered');
  assert.equal(buffer.quality, 'proxy');
  assert.equal(buffer.valueMs, 90);
  assert.ok(events.find(event => event.event === 'first-video-frame-callback').quality === 'proxy');

  h.doc.emit('keydown', { type: 'keydown', keyCode: 38, target: { tagName: 'DIV' } });
  const sample = h.recorder.beginRemoteHandler('dpad-up');
  h.advance(12);
  h.recorder.endRemoteHandler(sample);
  h.advance(16);
  h.fireFrame();
  assert.ok(h.recorder.active.events.some(event => event.event === 'first-remote-input-received' && event.outcome === 'dpad-up'));
  assert.ok(h.recorder.active.events.some(event => event.event === 'remote-handler-sync-duration' && event.valueMs === 12));
  const opportunity = h.recorder.active.events.find(event => event.event === 'remote-handler-render-opportunity');
  assert.equal(opportunity.outcome, 'dpad-up');
  assert.equal(opportunity.quality, 'proxy');
  const summary = h.recorder.startupSummary();
  assert.doesNotMatch(summary, /remote-handler-sync-duration|first-video-frame-callback|account|video ID/i,
    'advanced event browsing and identifiers are not exposed in the startup summary');
  h.recorder.disable();

  const noFrame = harness({ enabled: true, frameCallbacks: false });
  noFrame.video.emit('play');
  const unsupported = noFrame.recorder.active.events.find(event => event.event === 'first-video-frame-callback');
  assert.equal(unsupported.outcome, 'unsupported');
  assert.equal(unsupported.quality, 'unsupported');
  noFrame.recorder.disable();
});

test('remote key mapping ignores text entry and only names fixed D-pad/OK/Back classes', () => {
  assert.equal(remoteKeyCategory({ keyCode: 37, target: { tagName: 'DIV' } }), 'dpad-left');
  assert.equal(remoteKeyCategory({ keyCode: 13, target: { tagName: 'DIV' } }), 'ok');
  assert.equal(remoteKeyCategory({ keyCode: 10009, target: { tagName: 'DIV' } }), 'back');
  assert.equal(remoteKeyCategory({ keyCode: 461, target: { tagName: 'DIV' } }), 'back');
  assert.equal(remoteKeyCategory({ keyCode: 37, target: { tagName: 'INPUT' } }), null);
});
