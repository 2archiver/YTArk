import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startReadiness } from '../features/startupReadiness.js';

function harness(enabled, interrupted = false, readyAt = 80, throws = false) {
  let time = 0, count = 0, next;
  const data = new Map(interrupted ? [['ytark-faster-startup-in-progress', '1']] : []);
  const delays = [];
  const stop = startReadiness({ enabled,
    storage: { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) },
    now: () => time,
    later: (fn,ms) => { delays.push(ms); next = { fn, ms }; return count; },
    cancel: () => { next = null; },
    tick: () => { count++; if (throws) throw Error('not ready'); return time >= readyAt; },
  });
  const first = next.ms;
  while(next && count < 1000) { const task = next; next = null; time += task.ms; task.fn(); }
  return { first, delays, count, time, data, stop };
}
test('normal startup retains readiness checks and its 250ms cadence', () => {
  const h = harness(false); assert.equal(h.first,250); assert.equal(h.time,250); assert.equal(h.count,1);
});
test('opt in actually runs readiness earlier without inventing readiness', () => {
  const h = harness(true); assert.equal(h.first,0); assert.equal(h.time,100); assert.equal(h.count,3); assert.equal(h.data.size,0);
});
test('crashed accelerated launch falls back normally once', () => {
  const h = harness(true,true); assert.equal(h.first,250); assert.equal(h.data.size,0);
});
test('slow readiness and acceleration exceptions use bounded normal fallback', () => {
  const h=harness(true,false,10000); assert.ok(h.delays.includes(250)); assert.equal(h.time,10000);
  const e=harness(true,false,10000,true); assert.equal(e.time,40000); assert.ok(e.count<170); assert.equal(e.data.size,0);
});
