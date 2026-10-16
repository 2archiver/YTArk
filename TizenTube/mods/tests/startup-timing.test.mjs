// Startup measurement marks: monotonic, idempotent per name, log-only, and
// never a gate for any feature. The default clock is performance.now() where
// supported with a Date.now-relative fallback for the actual runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStartupTiming, attachStartupProbes } from '../features/startupTiming.js';

function harness() {
  let time = 0;
  const lines = [];
  const timing = createStartupTiming({ now: () => time, log: (line) => lines.push(line) });
  return { timing, lines, advance: (ms) => { time += ms; } };
}

test('marks are recorded once per name on the injected monotonic clock', () => {
  const h = harness();
  const first = h.timing.mark('script-eval');
  h.advance(120);
  const second = h.timing.mark('dom-body', 'detail');
  const again = h.timing.mark('script-eval');
  assert.equal(first.t, 0);
  assert.equal(second.t, 120);
  assert.equal(again, first, 'the first occurrence of a mark wins');
  assert.equal(h.timing.marks().length, 2);
  assert.deepEqual(h.lines, [
    '[YTArk][startup] script-eval t=0ms',
    '[YTArk][startup] dom-body t=120ms detail',
  ]);
});

test('the report is a compact single line of rounded marks', () => {
  const h = harness();
  h.timing.mark('script-eval');
  h.advance(250.6);
  h.timing.mark('controls-ready');
  assert.equal(h.timing.report(), 'script-eval=0ms controls-ready=251ms');
  assert.equal(h.timing.has('controls-ready'), true);
  assert.equal(h.timing.get('missing'), null);
});

test('the default clock falls back to a Date.now-relative value without performance.now', () => {
  const timing = createStartupTiming({ log: () => {} });
  const entry = timing.mark('fallback-clock');
  assert.ok(Number.isFinite(entry.t) && entry.t >= 0, 'a finite non-negative mark on any runtime');
  assert.ok(Number.isFinite(entry.wall) && entry.wall > 0, 'the wall clock is recorded alongside');
});

test('probes mark the first remote key and first playback exactly once', () => {
  const h = harness();
  const listeners = new Map();
  const fakeDocument = {
    addEventListener: (type, fn) => { listeners.set(type, fn); },
  };
  attachStartupProbes(h.timing, fakeDocument);
  assert.ok(listeners.has('keydown') && listeners.has('playing'));
  h.advance(3000);
  listeners.get('keydown')();
  listeners.get('keydown')();
  h.advance(4000);
  listeners.get('playing')();
  assert.equal(h.timing.get('first-remote-key').t, 3000);
  assert.equal(h.timing.get('first-playback').t, 7000, 'marks stay monotonic and first-wins');
  assert.equal(h.timing.marks().length, 2);
});

test('a throwing logger never breaks marking', () => {
  const timing = createStartupTiming({ now: () => 5, log: () => { throw new Error('log down'); } });
  const entry = timing.mark('resilient');
  assert.equal(entry.t, 5);
});
