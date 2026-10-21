import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStartupSessions, measureStartupSample } from '../features/browserDiagnosticsSummary.js';
import { BROWSER_DIAGNOSTICS_KEY, BrowserDiagnosticRecorder } from '../features/browserDiagnostics.js';

function event(name, outcome, relativeMs, quality = 'observed') {
  return { source: 'browser', clock: 'performance', relativeMs, event: name, outcome, quality, valueMs: null };
}

function sample(id, {
  mode = 'normal-disabled', durationMs = 100, status = 'complete', capture = 'launch',
  clockQuality = 'monotonic', truncated = false, missingEnd = false, fallback = false,
  readiness = 'complete', readinessTimeout = false, navigation = null, fasterStartup = mode !== 'normal-disabled',
} = {}) {
  const events = [
    event('recording-started', capture, 0),
    event('ui-module-evaluated', 'observed', 10, 'proxy'),
    event('startup-readiness-mode', mode, 11),
  ];
  if (fallback) events.push(event('startup-readiness-mode', 'normal-fallback', 12));
  if (navigation) events.push(event(`startup-navigation-${navigation}`, navigation === 'cancelled' ? 'user-input' : 'failed', 15));
  if (readiness === 'complete') events.push(event('startup-readiness-complete', 'complete', 10 + durationMs));
  if (readiness === 'interrupted') events.push(event('startup-readiness-interrupted', 'interrupted', 20));
  if (readinessTimeout) events.push(event('startup-readiness-timeout', 'timeout', 20));
  if (!missingEnd) events.push(event('controls-ready', 'observed', 10 + durationMs));
  if (status !== 'active') {
    const endOutcome = status === 'replaced' ? 'replaced' : status === 'truncated' ? 'event-limit' : 'complete';
    events.push(event('recording-ended', endOutcome, 10 + durationMs));
  }
  return {
    schema: 1, id, capture, status, clockDomain: 'performance', clockQuality,
    context: {
      packageId: 'io.github.twoarchiver.ytark', bundleVersion: '3.7.0',
      scriptTag: 's38', baseTag: 'v2.0.2', reloadHomeOnStartup: true,
      fasterStartup,
      // An old persisted field must be ignored, not emitted or used to form groups.
      startupComparisonKind: 'cold',
    },
    events, truncated,
  };
}

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); this.reads = 0; }
  getItem(key) { this.reads += 1; return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

describe('bounded local startup summary', () => {
  test('empty and unavailable storage are reported without inventing timings', () => {
    const empty = summarizeStartupSessions({ sessions: [], status: 'empty' });
    assert.match(empty, /Startup summary · local browser scope/);
    assert.match(empty, /Recording: Off/);
    assert.match(empty, /No browser startup sample is available yet/);
    assert.match(empty, /Valid startup duration for latest sample: unavailable/);
    assert.match(empty, /Actual readiness mode: not recorded/);
    assert.doesNotMatch(empty, /0\.0 ms|Median|Observed difference|cold|warm/i);

    const unavailable = summarizeStartupSessions({ sessions: [], status: 'unavailable', recordingEnabled: true });
    assert.match(unavailable, /Recording: On/);
    assert.match(unavailable, /Local browser diagnostic storage is unavailable/);
    assert.doesNotMatch(unavailable, /0\.0 ms|Median|Observed difference/);
  });

  test('reports the latest sample result, a valid monotonic launch duration, saved preference and actual mode', () => {
    const launch = sample('launch-fast', { mode: 'faster', durationMs: 321.4, fasterStartup: true });
    const summary = summarizeStartupSessions({ sessions: [launch], recordingEnabled: true });
    assert.match(summary, /Recording: On/);
    assert.match(summary, /Latest sample: Launch · complete/);
    assert.match(summary, /Latest result: Startup readiness completed\./);
    assert.match(summary, /Valid startup duration for latest sample: 321\.4 ms \(monotonic browser clock\)/);
    assert.match(summary, /Faster startup preference: On\. Actual readiness mode: Faster cadence\./);
    assert.match(summary, /userscript evaluation → YTArk controls ready/);
    assert.doesNotMatch(summary, /cold|warm|group|cohort|comparison|Median|Observed difference/i);

    const interruptedFaster = sample('interrupted-faster', {
      mode: 'normal-interrupted', fasterStartup: true,
    });
    const interruptedSummary = summarizeStartupSessions({ sessions: [interruptedFaster] });
    assert.match(interruptedSummary, /Faster startup preference: On/);
    assert.match(interruptedSummary, /Actual readiness mode: Normal cadence \(previous Faster launch interrupted\)/);
    const fallback = summarizeStartupSessions({ sessions: [sample('fallback', { mode: 'faster', fallback: true })] });
    assert.match(fallback, /Actual readiness mode: Faster cadence, then normal fallback/);
  });

  test('rejects incomplete, partial, truncated, timed-out, invalid-clock and ambiguous intervals', () => {
    const invalids = [
      sample('missing-end', { missingEnd: true }),
      sample('partial', { capture: 'partial' }),
      sample('active', { status: 'active', readiness: null, missingEnd: true }),
      sample('timeout', { readinessTimeout: true }),
      sample('truncated', { truncated: true }),
      sample('date-clock', { clockQuality: 'degraded' }),
      sample('zero-duration', { durationMs: 0 }),
    ];
    for (const invalid of invalids) {
      const measured = measureStartupSample(invalid);
      assert.equal(measured.measured, false, invalid.id);
      assert.notEqual(measured.durationMs, 0, 'invalid timing is not rewritten as zero');
    }
    const reason = (id) => measureStartupSample(invalids.find((item) => item.id === id)).reason;
    assert.match(reason('missing-end'), /start\/end mark is missing or ambiguous/);
    assert.match(reason('partial'), /Partial sample/);
    assert.match(reason('timeout'), /timed out or was interrupted/);
    assert.match(reason('truncated'), /Event limit reached/);
    assert.match(reason('date-clock'), /monotonic browser clock/);
    const summary = summarizeStartupSessions({ sessions: invalids });
    assert.match(summary, /Valid startup duration for latest sample: unavailable/);
    assert.doesNotMatch(summary, /Valid startup duration for latest sample: \d|0\.0 ms/);
  });

  test('a completed startup survives the five-minute session and a later interruption', () => {
    // The recording runs for up to five minutes and may end as interrupted
    // when the viewer closes the app. Once readiness completed, the startup
    // interval is final and must still be shown.
    const stillActive = sample('active-after-startup', { status: 'active', readiness: 'complete' });
    const interruptedLater = sample('interrupted-after-startup', { status: 'interrupted' });
    for (const completed of [stillActive, interruptedLater]) {
      const measured = measureStartupSample(completed);
      assert.equal(measured.measured, true, completed.id);
      assert.equal(measured.durationMs, 100, completed.id);
    }
    const replaced = measureStartupSample(sample('replaced', { status: 'replaced' }));
    assert.equal(replaced.measured, false, 'a replaced capture is not a launch measurement');
    const summary = summarizeStartupSessions({ sessions: [interruptedLater] });
    assert.match(summary, /Valid startup duration for latest sample: 100\.0 ms/);
  });

  test('reports the latest sample rather than borrowing a valid interval from an older sample', () => {
    const latestPartial = sample('latest-partial', {
      capture: 'partial', status: 'active', mode: 'normal-disabled', fasterStartup: false,
      readiness: null, missingEnd: true,
    });
    const previousLaunch = sample('older-valid-launch', {
      mode: 'faster', durationMs: 87.5, fasterStartup: true,
    });
    const summary = summarizeStartupSessions({ sessions: [latestPartial, previousLaunch] });
    assert.match(summary, /Latest sample: Partial · active/);
    assert.match(summary, /Latest result: Sample is still recording/);
    assert.match(summary, /Valid startup duration for latest sample: unavailable \(Partial sample; not a launch capture\.\)/);
    assert.match(summary, /Faster startup preference: Off\. Actual readiness mode: Normal cadence \(Faster startup off\)/);
    assert.doesNotMatch(summary, /87\.5 ms|Faster startup preference: On/);
    assert.doesNotMatch(summary, /difference|median|group|cohort/i);
  });

  test('describes readiness and navigation outcomes, including cancellation, instead of guessing completion', () => {
    const cancelled = summarizeStartupSessions({ sessions: [sample('cancelled', { navigation: 'cancelled', readiness: null })] });
    assert.match(cancelled, /Startup navigation was cancelled by input/);
    const failed = summarizeStartupSessions({ sessions: [sample('failed', { navigation: 'failed', readiness: null })] });
    assert.match(failed, /Startup navigation failed/);
    const interrupted = summarizeStartupSessions({ sessions: [sample('interrupted-result', {
      status: 'interrupted', readiness: 'interrupted',
    })] });
    assert.match(interrupted, /Startup readiness was interrupted/);
  });

  test('reads existing schema-1 samples and ignores their retired user labels', () => {
    const oldValidSample = sample('old-saved-launch', { mode: 'normal-disabled', durationMs: 145.2 });
    const storage = new MemoryStorage({
      [BROWSER_DIAGNOSTICS_KEY]: JSON.stringify({ schema: 1, evicted: 0, sessions: [oldValidSample] }),
    });
    const recorder = new BrowserDiagnosticRecorder({ storage, enabled: false });
    const summary = recorder.startupSummary();
    assert.equal(storage.reads, 2, 'history and active draft are read only for the explicit summary request');
    assert.match(summary, /Latest sample: Launch · complete/);
    assert.match(summary, /Valid startup duration for latest sample: 145\.2 ms/);
    assert.match(summary, /Faster startup preference: Off/);
    assert.match(summary, /Actual readiness mode: Normal cadence \(Faster startup off\)/);
    assert.doesNotMatch(summary, /startupComparisonKind|cold|warm|comparison/i);
    assert.equal(recorder.status, 'off', 'reading a saved sample never enables recording');
  });

  test('bounds direct summary fields and never reflects hostile stored text', () => {
    const hostile = sample('safe-id');
    hostile.status = '<script>alert(1)</script>'.repeat(1000);
    hostile.context.fasterStartup = '<img onerror=alert(1)>';
    hostile.events[2].outcome = 'https://secret.example/token=abc';
    const summary = summarizeStartupSessions({ sessions: [hostile] });
    assert.match(summary, /Latest sample: Launch · invalid/);
    assert.match(summary, /Faster startup preference: Unavailable\. Actual readiness mode: unavailable/);
    assert.doesNotMatch(summary, /<script|<img|secret\.example|token=abc|alert\(1\)/);
    assert.ok(summary.length < 2000, 'summary output is bounded');
  });

  test('bounds session and event work and rejects malformed direct inputs', () => {
    const oversized = sample('too-many-events');
    oversized.events = Array.from({ length: 201 }, () => event('controls-ready', 'observed', 20));
    assert.equal(measureStartupSample(oversized).measured, false);
    const malformed = sample('malformed');
    malformed.events.push(null);
    assert.equal(measureStartupSample(malformed).measured, false);

    const sessions = Array.from({ length: 22 }, (_, index) => sample(`session-${index}`, { durationMs: 100 + index }));
    const summary = summarizeStartupSessions({ sessions });
    assert.match(summary, /Latest sample: Launch · complete/);
    assert.doesNotMatch(summary, /Median|Observed difference|all 22/);
  });
});
