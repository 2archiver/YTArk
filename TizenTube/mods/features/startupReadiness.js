/** Reduces the optional mod-readiness polling delay, not engine/session/splash work.
 * One timer, one initialization path; after 2s acceleration falls back to 250ms.
 * An *interrupted* accelerated launch — a crash, but also any ordinary process
 * termination before readiness finished — leaves a marker that forces the next
 * launch down the normal path exactly once. The marker is never treated as a
 * confirmed crash and never disables the user's setting permanently.
 * `onGiveUp` (optional) runs once when the bounded 40s window expires without
 * a successful readiness tick, so callers can report work that never became
 * possible instead of losing it silently.
 */
export function startReadiness({ enabled = false, storage, tick, onGiveUp = null, now = () => Date.now(),
  later = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) }) {
  const marker = 'ytark-faster-startup-in-progress';
  let accelerated = false;
  let stopped = false;
  let timer;
  const began = now();
  try {
    const interrupted = storage && storage.getItem(marker) === '1';
    accelerated = !!enabled && !!storage && !interrupted;
    if (accelerated) storage.setItem(marker, '1');
    else if (storage) storage.removeItem(marker);
  } catch (_) { accelerated = false; }
  const finish = (gaveUp) => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) cancel(timer);
    try { if (storage) storage.removeItem(marker); } catch (_) { /* normal startup remains independent */ }
    if (gaveUp && typeof onGiveUp === 'function') {
      try { onGiveUp(); } catch (_) { /* reporting is best effort */ }
    }
  };
  const run = () => {
    if (stopped) return;
    let ready = false;
    try { ready = tick(); } catch (_) { accelerated = false; }
    if (ready) { finish(false); return; }
    if (now() - began >= 40000) { finish(true); return; }
    if (now() - began >= 2000) accelerated = false;
    timer = later(run, accelerated ? 50 : 250);
  };
  timer = later(run, accelerated ? 0 : 250);
  return () => finish(false);
}
