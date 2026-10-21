/**
 * One bounded readiness poll. `performance.now()` is preferred for its
 * elapsed-time deadline. When that clock is absent or stops behaving
 * monotonically, scheduled-delay accounting and a hard tick ceiling guarantee
 * that initialization cannot retry forever after a wall-clock change.
 */
function defaultClock() {
  let performanceNow = null;
  try {
    const perf = typeof performance !== 'undefined' ? performance : null;
    if (perf && typeof perf.now === 'function') performanceNow = perf.now.bind(perf);
  } catch (_) { performanceNow = null; }
  let last = null;
  if (performanceNow) {
    try {
      const value = performanceNow();
      if (Number.isFinite(value) && value >= 0) last = value;
      else performanceNow = null;
    } catch (_) { performanceNow = null; }
  }
  let lastWall = Date.now();
  let invalid = false;
  return {
    reliable: !!performanceNow,
    read() {
      if (performanceNow && !invalid) {
        try {
          const value = performanceNow();
          if (!Number.isFinite(value) || value < last) invalid = true;
          else { last = value; return value; }
        } catch (_) { invalid = true; }
      }
      // Date.now is used only to help select a cadence, never as a trusted
      // deadline after rollback or an unexpectedly large wall-clock jump.
      try {
        const wall = Date.now();
        if (!Number.isFinite(wall) || wall < lastWall || wall - lastWall > 60_000) invalid = true;
        lastWall = Number.isFinite(wall) ? wall : lastWall;
      } catch (_) { invalid = true; }
      return null;
    },
    get invalid() { return invalid; },
  };
}

export function startReadiness({
  enabled = false,
  storage,
  tick,
  onGiveUp = null,
  onReady = null,
  onInterrupted = null,
  onMode = null,
  now = null,
  later = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
}) {
  const marker = 'ytark-faster-startup-in-progress';
  let accelerated = false;
  let stopped = false;
  let timer;
  let tickCount = 0;
  let elapsedBySchedule = 0;
  let scheduledDelay = 0;
  let firstTick = true;
  const clock = typeof now === 'function' ? null : defaultClock();
  const injectedStart = typeof now === 'function' ? now() : null;
  const clockStart = clock && clock.read();
  let interrupted = false;
  let initialReason = enabled ? 'storage-unavailable' : 'disabled';
  try {
    interrupted = !!(storage && storage.getItem(marker) === '1');
    if (interrupted) initialReason = 'interrupted';
    else if (enabled && storage) {
      accelerated = true;
      initialReason = 'faster';
      storage.setItem(marker, '1');
    } else {
      accelerated = false;
      if (storage) storage.removeItem(marker);
    }
  } catch (_) {
    accelerated = false;
    initialReason = 'storage-unavailable';
  }
  const notifyMode = (mode) => {
    if (typeof onMode === 'function') {
      try { onMode(mode); } catch (_) { /* diagnostics cannot block startup */ }
    }
  };
  notifyMode(accelerated ? 'faster' : `normal-${initialReason}`);
  const useNormalFallback = () => {
    if (!accelerated) return;
    accelerated = false;
    notifyMode('normal-fallback');
  };
  if (interrupted && typeof onInterrupted === 'function') {
    try { onInterrupted(); } catch (_) { /* diagnostics cannot block startup */ }
  }
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) { cancel(timer); timer = undefined; }
    try { if (storage) storage.removeItem(marker); } catch (_) { /* startup remains independent */ }
  };
  const finish = (gaveUp) => {
    if (stopped) return;
    stop();
    const callback = gaveUp ? onGiveUp : onReady;
    if (typeof callback === 'function') {
      try { callback(); } catch (_) { /* reporting is best effort */ }
    }
  };
  const run = () => {
    if (stopped) return;
    tickCount += 1;
    if (!firstTick) elapsedBySchedule += scheduledDelay;
    firstTick = false;
    let elapsed = elapsedBySchedule;
    try {
      if (typeof now === 'function') {
        const current = now();
        if (Number.isFinite(injectedStart) && Number.isFinite(current) && current >= injectedStart) elapsed = current - injectedStart;
      } else if (clock && !clock.invalid && clockStart !== null && clockStart !== undefined) {
        const current = clock.read();
        if (Number.isFinite(current) && current >= clockStart) elapsed = current - clockStart;
      }
    } catch (_) { /* tick accounting is the bounded fallback */ }

    let ready = false;
    try { ready = tick() === true; } catch (_) { useNormalFallback(); }
    if (ready) { finish(false); return; }
    if (elapsed >= 40_000 || tickCount >= 202) { finish(true); return; }
    if (elapsed >= 2_000) useNormalFallback();
    // The first two seconds cover a normal control hand-off. After that the
    // remaining window is a bounded recovery path, so a fixed 250 ms wake-up
    // is wasted work: back off to one probe per second at most.
    scheduledDelay = accelerated ? 50
      : elapsed < 6_000 ? 500
      : elapsed < 15_000 ? 750 : 1_000;
    timer = later(run, scheduledDelay);
  };
  scheduledDelay = accelerated ? 0 : 250;
  timer = later(run, scheduledDelay);
  // Teardown is not readiness: disposing the loop must not report success.
  return stop;
}

export default startReadiness;
