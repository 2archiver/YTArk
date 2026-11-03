/** Coalesce decoder changes; never announce a requested-but-unplayed quality. */
export function createQualityNotice({ notify, enabled, current, visible = () => true,
  now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), cancel = clearTimeout } = {}) {
  let timer = null;
  let generation = 0;
  let last = null;
  let lastAt = -Infinity;
  let videoId = null;
  function reset(id = null) {
    generation += 1;
    if (timer !== null) cancel(timer);
    timer = null;
    videoId = id;
    last = null;
    lastAt = -Infinity;
  }
  function request(id) {
    if (id !== videoId) reset(id);
    if (!id || !enabled()) return;
    if (timer !== null) cancel(timer);
    const token = generation;
    timer = later(() => {
      timer = null;
      if (token !== generation || !enabled() || !visible()) return;
      const quality = current();
      // Restrict output to a real resolution label, never arbitrary player text.
      if (typeof quality !== 'string' || !/^\d{3,4}p(?:\d{2,3})?$/.test(quality)) return;
      if (quality === last) return;
      const time = now();
      if (time - lastAt < 8000) {
        // Keep only one pending update after an ABR burst, bounded by the cooldown.
        timer = later(() => { timer = null; request(id); }, 8000 - (time - lastAt));
        return;
      }
      try {
        if (notify('Quality', quality) === false) return;
        last = quality;
        lastAt = time;
      } catch (_) { /* an unavailable toast must not affect playback */ }
    }, 1200);
  }
  return { request, reset, stop: () => reset() };
}

/** Uses YouTube TV's native toast renderer; no overlay DOM or focus changes. */
export function nativeQualityToast(title, subtitle) {
  if (typeof window === 'undefined' || !window._yttv) return false;
  for (const key of Object.keys(window._yttv)) {
    const instance = window._yttv[key] && window._yttv[key].instance;
    if (instance && typeof instance.resolveCommand === 'function') {
      instance.resolveCommand({ openPopupAction: { popupType: 'TOAST', popup: {
        overlayToastRenderer: { title: { simpleText: title }, subtitle: { simpleText: subtitle } },
      } } });
      return true;
    }
  }
  return false;
}
