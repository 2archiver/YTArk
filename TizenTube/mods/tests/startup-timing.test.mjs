// Session-relative clock tests. The recorder no longer emits unconditional console timings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticClock } from '../features/startupTiming.js';

test('performance.now produces monotonic session-relative values and durations', () => {
  let time = 18.5;
  const clock = createDiagnosticClock({ performanceObject: { now: () => time } });
  const start = clock.read();
  time += 125.25;
  const end = clock.read();
  assert.equal(clock.domain, 'performance');
  assert.equal(clock.quality, 'monotonic');
  assert.equal(start.relativeMs, 0);
  assert.equal(end.relativeMs, 125.25);
  assert.equal(clock.duration(start, end), 125.25);
  assert.equal(clock.duration(end, start), null, 'negative elapsed time is not repaired');
});

test('a performance-clock rollback degrades subsequent values instead of using wall time', () => {
  let time = 100;
  const clock = createDiagnosticClock({
    performanceObject: { now: () => time },
    wallNow: () => 9_000_000,
  });
  assert.equal(clock.read().relativeMs, 0);
  time = 90;
  const invalid = clock.read();
  assert.equal(invalid.relativeMs, null);
  assert.equal(invalid.quality, 'degraded');
  assert.equal(clock.quality, 'degraded');
  time = 110;
  assert.equal(clock.read().relativeMs, null, 'one clock failure invalidates the session clock');
});

test('Date.now fallback is labelled degraded and stops on rollback or a large jump', () => {
  let wall = 20_000;
  const clock = createDiagnosticClock({ performanceObject: null, wallNow: () => wall, maxWallStepMs: 1000 });
  const first = clock.read();
  assert.equal(clock.domain, 'date-fallback');
  assert.equal(first.relativeMs, 0);
  assert.equal(first.quality, 'degraded');
  wall += 250;
  const second = clock.read();
  assert.equal(second.relativeMs, 250);
  assert.equal(clock.duration(first, second), 250);
  wall -= 1;
  assert.equal(clock.read().relativeMs, null);
  assert.equal(clock.duration(first, clock.read()), null);
});

test('an unavailable clock stays unavailable and no cross-domain arithmetic is allowed', () => {
  const noClock = createDiagnosticClock({ performanceObject: null, wallNow: () => Number.NaN });
  const unavailable = noClock.read();
  assert.equal(noClock.domain, 'unavailable');
  assert.equal(unavailable.relativeMs, null);
  assert.equal(noClock.duration(unavailable, unavailable), null);

  let performanceTime = 10;
  let wallTime = 100;
  const perfClock = createDiagnosticClock({ performanceObject: { now: () => performanceTime } });
  const dateClock = createDiagnosticClock({ performanceObject: null, wallNow: () => wallTime });
  const perf = perfClock.read();
  const date = dateClock.read();
  performanceTime += 20;
  wallTime += 20;
  assert.equal(perfClock.duration(perf, dateClock.read()), null);
  assert.equal(dateClock.duration(date, perfClock.read()), null);
});
