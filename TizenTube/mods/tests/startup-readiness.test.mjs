import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startReadiness } from '../features/startupReadiness.js';

function harness(enabled, interrupted = false, readyAt = 80, throws = false) {
  let time = 0, count = 0, next;
  const data = new Map(interrupted ? [['ytark-faster-startup-in-progress', '1']] : []);
  const delays = [];
  const modes = [];
  const stop = startReadiness({ enabled,
    storage: { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) },
    onMode: mode => modes.push(mode),
    now: () => time,
    later: (fn,ms) => { delays.push(ms); next = { fn, ms }; return count; },
    cancel: () => { next = null; },
    tick: () => { count++; if (throws) throw Error('not ready'); return time >= readyAt; },
  });
  const first = next.ms;
  while(next && count < 1000) { const task = next; next = null; time += task.ms; task.fn(); }
  return { first, delays, count, time, data, modes, stop };
}
test('normal startup retains readiness checks and records the actual normal mode', () => {
  const h = harness(false); assert.equal(h.first,250); assert.equal(h.time,250); assert.equal(h.count,1);
  assert.deepEqual(h.modes, ['normal-disabled']);
});
test('opt in actually runs readiness earlier and records Faster mode without inventing readiness', () => {
  const h = harness(true); assert.equal(h.first,0); assert.equal(h.time,100); assert.equal(h.count,3); assert.equal(h.data.size,0);
  assert.deepEqual(h.modes, ['faster']);
});
test('crashed accelerated launch falls back normally once and exposes the interrupted mode', () => {
  const h = harness(true,true); assert.equal(h.first,250); assert.equal(h.data.size,0);
  assert.deepEqual(h.modes, ['normal-interrupted']);
});
test('slow readiness and acceleration exceptions use a recorded bounded normal fallback', () => {
  const h=harness(true,false,10000); assert.ok(h.delays.includes(500), 'the recovery window backs off after the faster fallback');
  assert.ok(h.time >= 10000 && h.time < 11500, `readiness is observed on the next bounded tick (${h.time})`);
  assert.deepEqual(h.modes, ['faster', 'normal-fallback']);
  const e=harness(true,false,10000,true); assert.ok(e.time >= 40000 && e.time < 41500, `the window ends at 40 s (${e.time})`);
  assert.ok(e.count<170); assert.equal(e.data.size,0);
  assert.deepEqual(e.modes, ['faster', 'normal-fallback']);
});
test('the recovery window backs off instead of waking every 250 ms for the whole 40 s', () => {
  const h = harness(false, false, 39000);
  assert.equal(h.delays[0], 250, 'the first check stays prompt');
  assert.ok(h.delays.includes(500) && h.delays.includes(750) && h.delays.includes(1000),
    'later checks use the bounded backoff cadence');
  assert.ok(h.count < 90, `a slow launch uses fewer wake-ups: ${h.count}`);
});

test('disposing the loop stops the timer without reporting readiness', () => {
  let ready = 0, giveUps = 0, pending = null;
  const stop = startReadiness({
    enabled: false,
    storage: null,
    now: () => 0,
    later: (fn, ms) => { pending = { fn, ms }; return 1; },
    cancel: () => { pending = null; },
    onReady: () => { ready += 1; },
    onGiveUp: () => { giveUps += 1; },
    tick: () => false,
  });
  stop();
  assert.equal(pending, null, 'the terminal timer is cleared');
  assert.equal(ready, 0, 'teardown is not readiness');
  assert.equal(giveUps, 0, 'teardown is not a give-up');
});

test('the bounded window reports give-up exactly once and success never does', () => {
  let giveUps = 0;
  const timedOut = harnessWithGiveUp(true, 50000, () => { giveUps++; });
  assert.equal(giveUps, 1, 'an exhausted 40s window reports the give-up once');
  assert.equal(timedOut.data.size, 0, 'the interrupted marker is still cleared');
  giveUps = 0;
  harnessWithGiveUp(true, 80, () => { giveUps++; });
  assert.equal(giveUps, 0, 'a successful readiness tick never reports a give-up');
});

function harnessWithGiveUp(enabled, readyAt, onGiveUp) {
  let time = 0, count = 0, next;
  const data = new Map();
  const stop = startReadiness({ enabled,
    storage: { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) },
    now: () => time,
    later: (fn,ms) => { next = { fn, ms }; return count; },
    cancel: () => { next = null; },
    onGiveUp,
    tick: () => { count++; return time >= readyAt; },
  });
  while(next && count < 1000) { const task = next; next = null; time += task.ms; task.fn(); }
  return { data, stop };
}
