// Startup staging contracts: dependency order, one-shot stages, terminal
// failures, shared discovery caching and the bounded deferred runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStartupStages, createSharedDiscovery, startDeferredStage,
} from '../features/startupPipeline.js';

test('stages run in dependency order and only once', () => {
  const calls = [];
  const pipeline = createStartupStages({
    stages: [
      { id: 'controls', run: () => { calls.push('controls'); return true; } },
      { id: 'resolver', run: () => { calls.push('resolver'); return true; } },
      { id: 'navigation', requires: ['controls', 'resolver'], run: () => { calls.push('navigation'); return true; } },
    ],
  });
  const first = pipeline.run();
  assert.deepEqual(calls, ['controls', 'resolver', 'navigation']);
  assert.equal(first.criticalDone, true);
  pipeline.run();
  pipeline.run();
  assert.deepEqual(calls, ['controls', 'resolver', 'navigation'], 'no stage runs twice');
});

test('a pending dependency blocks its dependants and readiness stays false', () => {
  let resolverReady = false;
  const calls = [];
  const pipeline = createStartupStages({
    stages: [
      { id: 'controls', run: () => { calls.push('controls'); return true; } },
      { id: 'resolver', run: () => { calls.push('resolver'); return resolverReady; } },
      { id: 'navigation', requires: ['controls', 'resolver'], run: () => { calls.push('navigation'); return true; } },
    ],
  });
  const first = pipeline.run();
  assert.equal(first.criticalDone, false);
  assert.deepEqual(first.pending, ['resolver', 'navigation']);
  assert.deepEqual(calls, ['controls', 'resolver'], 'navigation never runs before the resolver');
  resolverReady = true;
  const second = pipeline.run();
  assert.equal(second.criticalDone, true);
  assert.deepEqual(calls, ['controls', 'resolver', 'resolver', 'navigation']);
});

test('an optional stage never holds the critical path', () => {
  const pipeline = createStartupStages({
    stages: [
      { id: 'controls', run: () => true },
      { id: 'guideRefresh', critical: false, requires: ['controls'], run: () => false },
    ],
  });
  const result = pipeline.run();
  assert.equal(result.criticalDone, true, 'optional work is not readiness');
  assert.equal(result.done, false);
  assert.deepEqual(result.pending, ['guideRefresh']);
});

test('a throwing stage is terminal, reported once, and does not abort the rest', () => {
  const warnings = [];
  let attempts = 0;
  const pipeline = createStartupStages({
    warn: (id) => warnings.push(id),
    stages: [
      { id: 'controls', run: () => { attempts += 1; throw new Error('dom'); } },
      { id: 'resolver', run: () => true },
    ],
  });
  const result = pipeline.run();
  assert.equal(attempts, 1, 'a throwing stage is never retried');
  assert.deepEqual(warnings, ['controls']);
  assert.deepEqual(result.failed, ['controls']);
  assert.equal(result.criticalDone, true, 'a failed critical stage resolves readiness instead of hanging it');
  assert.equal(pipeline.run().failed.length, 1);
});

test('shared discovery caches the answer, bounds probes and stops after success', () => {
  let time = 0;
  let probes = 0;
  const discovery = createSharedDiscovery({
    probe: () => { probes += 1; return probes >= 2; },
    now: () => time,
    minIntervalMs: 100,
    maxProbes: 3,
  });
  assert.equal(discovery.read(), false);
  assert.equal(discovery.read(), false, 'a fresh cached miss is reused');
  assert.equal(probes, 1, 'no duplicate probe inside the interval');
  time = 100;
  assert.equal(discovery.read(), true);
  assert.equal(probes, 2);
  time = 10_000;
  assert.equal(discovery.read(), true);
  assert.equal(probes, 2, 'a satisfied discovery never probes again');
});

test('shared discovery bounds a dependency that never appears', () => {
  let probes = 0;
  const discovery = createSharedDiscovery({
    probe: () => { probes += 1; return false; },
    now: () => 0,
    minIntervalMs: 0,
    maxProbes: 4,
  });
  for (let index = 0; index < 20; index += 1) discovery.read();
  assert.equal(probes, 4, 'the probe budget is finite');
  assert.equal(discovery.exhausted, true);
});

test('the deferred runner is bounded and always clears its terminal timer', () => {
  let time = 0;
  let timer = null;
  let runs = 0;
  const done = [];
  const handle = startDeferredStage({
    run: () => { runs += 1; return false; },
    now: () => time,
    later: (fn, ms) => { timer = { fn, ms }; return 1; },
    cancel: () => { timer = null; },
    deadlineMs: 2_000,
    delayMs: 500,
    onDone: (reason) => done.push(reason),
  });
  while (timer !== null) {
    const task = timer;
    timer = null;
    time += task.ms;
    task.fn();
  }
  assert.deepEqual(done, ['timeout']);
  assert.ok(runs <= 5, `bounded retries: ${runs}`);
  assert.equal(handle.finished, true);
  assert.equal(timer, null, 'no timer survives the terminal state');
});

test('the deferred runner stops as soon as the optional work completes', () => {
  let time = 0;
  let timer = null;
  let runs = 0;
  const reasons = [];
  startDeferredStage({
    run: () => { runs += 1; return runs === 2; },
    now: () => time,
    later: (fn, ms) => { timer = { fn, ms }; return 1; },
    cancel: () => { timer = null; },
    deadlineMs: 10_000,
    delayMs: 250,
    onDone: (reason) => reasons.push(reason),
  });
  while (timer !== null) {
    const task = timer;
    timer = null;
    time += task.ms;
    task.fn();
  }
  assert.equal(runs, 2);
  assert.deepEqual(reasons, ['complete']);
  assert.equal(timer, null);
});
