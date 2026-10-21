/**
 * Dependency-ordered startup stages.
 *
 * Each stage runs at most once and only after its declared dependencies have
 * completed. A stage that returns false stays pending and is retried by the
 * next bounded readiness tick; a stage that throws is terminal, because its
 * side effect may already have happened and retrying could duplicate it.
 * Readiness is the set of *critical* stages being resolved (done or failed);
 * optional stages never hold the critical path and are dispatched afterwards
 * by the bounded deferred runner below.
 */

export function createStartupStages({ stages = [], warn = null } = {}) {
  const records = stages.map((stage) => ({
    id: stage.id,
    requires: Array.isArray(stage.requires) ? stage.requires.slice() : [],
    critical: stage.critical !== false,
    run: stage.run,
    done: false,
    failed: false,
    error: null,
  }));
  const resolved = (record) => record.done || record.failed;
  const criticalResolved = () => records.filter((record) => record.critical).every(resolved);

  function run(context) {
    const ran = [];
    for (const record of records) {
      if (resolved(record)) continue;
      const waiting = record.requires.some((id) => {
        const dependency = records.find((candidate) => candidate.id === id);
        return !dependency || !dependency.done;
      });
      if (waiting) continue;
      ran.push(record.id);
      try {
        if (record.run(context) === true) record.done = true;
      } catch (error) {
        record.failed = true;
        record.error = error;
        if (typeof warn === 'function') {
          try { warn(record.id, error); } catch (_) { /* reporting is best effort */ }
        }
      }
    }
    return {
      ran,
      criticalDone: criticalResolved(),
      done: records.every(resolved),
      pending: records.filter((record) => !resolved(record)).map((record) => record.id),
      failed: records.filter((record) => record.failed).map((record) => record.id),
    };
  }

  return {
    run,
    get criticalDone() { return criticalResolved(); },
    get done() { return records.every(resolved); },
    get stages() { return records; },
  };
}

/**
 * Shared, rate-limited dependency discovery.
 *
 * The old readiness loop rescanned `window._yttv` and the command registry on
 * every tick even when the previous answer was still fresh. One cache now
 * serves every consumer, stops probing after a success, and bounds the number
 * of probes so a missing dependency cannot turn startup into a busy loop.
 */
export function createSharedDiscovery({ probe, now = () => Date.now(), minIntervalMs = 100, maxProbes = 240 } = {}) {
  let available = false;
  let checked = false;
  let checkedAt = 0;
  let probes = 0;
  const interval = Number.isFinite(minIntervalMs) && minIntervalMs >= 0 ? minIntervalMs : 100;
  const limit = Number.isFinite(maxProbes) && maxProbes > 0 ? Math.floor(maxProbes) : 240;
  return {
    get available() { return available; },
    get probes() { return probes; },
    get exhausted() { return probes >= limit; },
    /** Returns the cached answer unless the cache is stale and can still probe. */
    read(force = false) {
      if (available) return true;
      if (!force) {
        if (checked && now() - checkedAt < interval) return false;
        if (probes >= limit) return false;
      }
      checked = true;
      checkedAt = now();
      probes += 1;
      try { available = probe() === true; } catch (_) { available = false; }
      return available;
    },
    /** Stop probing after another component proved the dependency exists. */
    satisfy() { available = true; },
  };
}

/**
 * Bounded background runner for optional startup work.
 *
 * Used only after the critical startup stages are resolved, so a slow optional
 * dependency (a late command executor, for example) can no longer decide when
 * controls are considered ready. Every exit path clears the timer.
 */
export function startDeferredStage({
  run,
  now = () => Date.now(),
  later = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  deadlineMs = 10_000,
  delayMs = 250,
  onDone = null,
} = {}) {
  const started = now();
  let timer = null;
  let stopped = false;
  let finished = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) { cancel(timer); timer = null; }
  };
  const finish = (reason) => {
    if (finished) return;
    finished = true;
    stop();
    if (typeof onDone === 'function') {
      try { onDone(reason); } catch (_) { /* reporting is best effort */ }
    }
  };
  const step = () => {
    timer = null;
    if (stopped) return;
    let result = false;
    try { result = run() === true; } catch (_) { result = true; }
    if (result) return finish('complete');
    if (now() - started >= deadlineMs) return finish('timeout');
    timer = later(step, delayMs);
    return undefined;
  };
  timer = later(step, 0);
  return { stop, get finished() { return finished; } };
}

export default createStartupStages;
