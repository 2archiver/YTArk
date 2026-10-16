import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStartupSessions, measureStartupSample } from '../features/browserDiagnosticsSummary.js';

function event(name, outcome, relativeMs, quality = 'observed') {
  return { source: 'browser', clock: 'performance', relativeMs, event: name, outcome, quality, valueMs: null };
}

function sample(id, {
  mode = 'normal-disabled', durationMs = 100, launchKind = 'cold', status = 'complete',
  capture = 'launch', clockQuality = 'monotonic', truncated = false, missingEnd = false,
  fallback = false, readinessTimedOut = false, navigationCancelled = false,
  build = '3.7.0', scriptTag = 's38', destination = 'home', reload = true,
} = {}) {
  const fasterStartup = mode === 'faster' || mode === 'normal-interrupted'
    || mode === 'normal-storage-unavailable' || mode === 'normal-fallback';
  const events = [
    event('recording-started', capture, 0),
    event('ui-module-evaluated', 'observed', 10, 'proxy'),
    event('startup-readiness-mode', mode, 11),
  ];
  if (fallback) events.push(event('startup-readiness-mode', 'normal-fallback', 12));
  if (navigationCancelled) events.push(event('startup-navigation-cancelled', 'user-input', 15));
  if (!missingEnd) events.push(event('controls-ready', 'observed', 10 + durationMs));
  if (readinessTimedOut) events.push(event('startup-readiness-timeout', 'timeout', 20));
  if (status !== 'active') events.push(event('recording-ended', status === 'complete' ? 'complete' : status, 10 + durationMs));
  return {
    schema: 1, id, capture, status, clockDomain: 'performance', clockQuality,
    context: {
      packageId: 'io.github.twoarchiver.ytark', bundleVersion: build,
      scriptTag, baseTag: 'v2.0.2', reloadHomeOnStartup: reload,
      fasterStartup, startupDestination: destination, startupComparisonKind: launchKind,
    },
    events, truncated,
  };
}

describe('honest local startup summary and Faster startup comparison', () => {
  test('an empty, partial or in-progress sample never becomes zero or complete', () => {
    const empty = summarizeStartupSessions({ sessions: [], status: 'empty' });
    assert.match(empty, /No browser startup sample is available yet/);
    assert.doesNotMatch(empty, /0\.0 ms|Median interval/);

    const partial = summarizeStartupSessions({ sessions: [sample('partial', { capture: 'partial', status: 'active' })] });
    assert.match(partial, /partial sample/i);
    assert.match(partial, /never treated as complete comparisons/i);
    assert.doesNotMatch(partial, /Median interval|Observed difference/);

    const active = summarizeStartupSessions({ sessions: [sample('active', { status: 'active', missingEnd: true })] });
    assert.match(active, /still in progress/);
    assert.doesNotMatch(active, /0\.0 ms|Median interval/);
  });

  test('missing, timed-out, truncated, non-monotonic and invalid timing marks are excluded', () => {
    const invalids = [
      sample('missing', { missingEnd: true }),
      sample('timeout', { status: 'timed-out' }),
      sample('readiness-timeout', { readinessTimedOut: true }),
      sample('truncated', { truncated: true }),
      sample('date-clock', { clockQuality: 'degraded' }),
      sample('zero', { durationMs: 0 }),
    ];
    for (const invalid of invalids) {
      const measured = measureStartupSample(invalid);
      assert.equal(measured.eligible, false, invalid.id);
      assert.notEqual(measured.durationMs, 0, 'invalid time is not rewritten as zero');
    }
    const malformed = sample('malformed');
    malformed.events.push(null);
    assert.equal(measureStartupSample(malformed).measured, false, 'malformed records are invalid, not a zero-duration sample');
    const oversized = sample('oversized-events');
    oversized.events = Array.from({ length: 201 }, () => event('controls-ready', 'observed', 20));
    assert.equal(measureStartupSample(oversized).measured, false, 'event-count bounds apply to summary input too');

    const text = summarizeStartupSessions({ sessions: [invalids[0]] });
    assert.match(text, /start or end mark is missing or ambiguous/);
    assert.doesNotMatch(text, /Median interval/);
    const readinessTimeout = summarizeStartupSessions({ sessions: [invalids[2]] });
    assert.match(readinessTimeout, /Startup readiness timed out; no duration is reported/);
    assert.doesNotMatch(readinessTimeout, /Latest launch measurement:|0\.0 ms/);
  });

  test('reports actual Faster startup use, including normal fallback instead of saved preference alone', () => {
    const enabledButInterrupted = sample('interrupted', { mode: 'normal-interrupted' });
    const summary = summarizeStartupSessions({ sessions: [enabledButInterrupted] });
    assert.match(summary, /Saved Faster startup preference: On/);
    assert.match(summary, /Normal cadence \(previous Faster startup launch was interrupted\)/);
    assert.match(summary, /Actual readiness mode: Normal cadence \(previous Faster startup launch was interrupted\)/);
    assert.doesNotMatch(summary, /Median interval|Observed difference/);

    const fallback = sample('fallback', { mode: 'faster', fallback: true });
    assert.match(summarizeStartupSessions({ sessions: [fallback] }), /Faster cadence, then normal fallback/);
  });

  test('requires three comparable launches in both modes and reports only a narrow measured difference', () => {
    const sessions = [
      sample('n3', { mode: 'normal-disabled', durationMs: 120 }),
      sample('f3', { mode: 'faster', durationMs: 90 }),
      sample('n2', { mode: 'normal-disabled', durationMs: 110 }),
      sample('f2', { mode: 'faster', durationMs: 80 }),
      sample('n1', { mode: 'normal-disabled', durationMs: 100 }),
      sample('f1', { mode: 'faster', durationMs: 70 }),
    ];
    const summary = summarizeStartupSessions({ sessions });
    assert.match(summary, /normal 110\.0 ms \(n=3\)/);
    assert.match(summary, /Faster 80\.0 ms \(n=3\)/);
    assert.match(summary, /Observed difference \(normal − Faster\): \+30\.0 ms/);
    assert.match(summary, /does not promise a startup benefit/);
    assert.match(summary, /not Android app start, full YouTube readiness, playback-ready, or first frame/);

    const tooFew = summarizeStartupSessions({ sessions: sessions.slice(0, 5) });
    assert.match(tooFew, /normal 3\/3; Faster 2\/3/);
    assert.doesNotMatch(tooFew, /Observed difference/);
    assert.match(tooFew, /five matched pairs, alternating normal and Faster/);
  });

  test('does not compare a startup route that was cancelled by user input', () => {
    const result = measureStartupSample(sample('cancelled-route', { navigationCancelled: true }));
    assert.equal(result.measured, true, 'the narrow interval remains a valid measurement');
    assert.equal(result.eligible, false, 'the run is not comparable with a dispatched startup route');
    assert.match(result.reason, /navigation was cancelled or failed/);
  });

  test('never mixes cold/warm labels, builds, script/base definitions, destination or reload settings', () => {
    const base = [
      sample('n1', { mode: 'normal-disabled' }), sample('n2', { mode: 'normal-disabled' }),
      sample('f1', { mode: 'faster' }), sample('f2', { mode: 'faster' }),
    ];
    const mismatches = [
      sample('warm-faster', { mode: 'faster', launchKind: 'warm' }),
      sample('old-build', { mode: 'faster', build: '3.6.0' }),
      sample('old-script', { mode: 'faster', scriptTag: 's37' }),
      sample('different-destination', { mode: 'faster', destination: 'sports' }),
      sample('different-previous-other-tab', { mode: 'faster', destination: 'movies' }),
      sample('no-reload', { mode: 'faster', reload: false }),
    ];
    const summary = summarizeStartupSessions({ sessions: [...base, ...mismatches] });
    assert.match(summary, /normal 2\/3; Faster 2\/3/);
    assert.match(summary, /For a fuller local comparison/);
    assert.match(summary, /keep the build, destination, TV and cold\/warm class the same/);
  });
});
