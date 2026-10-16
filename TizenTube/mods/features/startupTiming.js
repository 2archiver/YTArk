/**
 * Lightweight monotonic startup marks for measuring the real launch path.
 *
 * The marks live on one clock: `performance.now()` where the Cobalt runtime
 * supports it, with a Date.now-relative fallback otherwise. They are never
 * mixed with the native Android clock — the native side logs its own
 * `elapsedRealtime` marks (updater `StartupTimeline`, logcat tag `YTArkStartup`)
 * and the two timelines are read side by side, not subtracted, unless an
 * explicit calibration event is captured.
 *
 * Marking is idempotent per name (first occurrence wins), log-only and has no
 * effect on startup work; there is no configuration surface and nothing here
 * gates a feature.
 */

export function createStartupTiming({ now = null, log = null } = {}) {
  const marks = [];
  const byName = new Map();
  const wallBase = Date.now();
  const clock = typeof now === 'function'
    ? now
    : () => {
      try {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
          return performance.now();
        }
      } catch (_) { /* fall through to the Date.now-relative clock */ }
      return Date.now() - wallBase;
    };
  const write = typeof log === 'function'
    ? log
    : (line) => { try { console.info(line); } catch (_) { /* logging is best effort */ } };

  function mark(name, detail) {
    if (byName.has(name)) return byName.get(name);
    const entry = {
      name,
      t: clock(),
      wall: Date.now(),
      detail: detail === undefined || detail === null ? null : String(detail),
    };
    marks.push(entry);
    byName.set(name, entry);
    try {
      write(`[YTArk][startup] ${name} t=${Math.round(entry.t)}ms${entry.detail ? ` ${entry.detail}` : ''}`);
    } catch (_) { /* logging is best effort and must never break marking */ }
    return entry;
  }

  return {
    mark,
    has: (name) => byName.has(name),
    get: (name) => byName.get(name) || null,
    marks: () => marks.slice(),
    report: () => marks.map((entry) => `${entry.name}=${Math.round(entry.t)}ms`).join(' '),
  };
}

/**
 * One-shot remote-responsiveness and playback-readiness probes. The first
 * keydown after script start approximates when the UI answers the remote; the
 * first `playing` event approximates playback readiness. Both listeners are
 * passive, capture-phase and removed after their first event.
 */
export function attachStartupProbes(timing, target) {
  const doc = target || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.addEventListener !== 'function') return;
  try {
    doc.addEventListener('keydown', () => timing.mark('first-remote-key'), { capture: true, once: true, passive: true });
    doc.addEventListener('playing', () => timing.mark('first-playback'), { capture: true, once: true, passive: true });
  } catch (_) {
    // An environment without listener options still gets plain listeners.
    try {
      doc.addEventListener('keydown', () => timing.mark('first-remote-key'), true);
      doc.addEventListener('playing', () => timing.mark('first-playback'), true);
    } catch (__) { /* probes are best effort */ }
  }
}

export const startupTiming = createStartupTiming();
export default startupTiming;
