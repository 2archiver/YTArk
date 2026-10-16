/**
 * One-shot startup navigation.
 *
 * `resolveCommand()` iterates `window._yttv` and silently returns `undefined`
 * when no module exposes a resolver instance, so dispatching the saved startup
 * destination (or the `reloadHomeOnStartup` soft reload) before the resolver
 * exists loses the navigation without a trace. This module defers the dispatch
 * until the resolver is actually available and guarantees it runs at most
 * once, without delaying the rest of the controls initialization.
 *
 * It never changes what is dispatched: an explicit `launchToOnStartup`
 * destination keeps priority over the `reloadHomeOnStartup` soft reload, and
 * with `reloadHomeOnStartup` off there is nothing to dispatch at all.
 */

/** Parse the stored startup destination; anything malformed means "none". */
export function readStartupDestination(raw, warn = null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (typeof warn === 'function') warn(error);
    return null;
  }
}

export function createStartupNavigation({ configRead, resolveCommand, hasResolver, mark = () => {}, warn = null }) {
  let done = false;
  let dispatched = null;
  return {
    /** True once navigation has run or was configured off. */
    get done() { return done; },
    /** The command actually dispatched ('explicit-destination' | 'soft-reload' | 'disabled' | null). */
    get dispatched() { return dispatched; },
    /**
     * Runs the navigation when its dependency exists. Returns true when the
     * step is complete (dispatched or disabled), false while it is deferred
     * because the command resolver is not available yet.
     */
    tryRun() {
      if (done) return true;
      if (!configRead('reloadHomeOnStartup')) {
        done = true;
        dispatched = 'disabled';
        mark('startup-navigation', 'disabled');
        return true;
      }
      if (!hasResolver()) return false;
      done = true;
      const destination = readStartupDestination(configRead('launchToOnStartup'), warn);
      dispatched = destination ? 'explicit-destination' : 'soft-reload';
      mark('startup-navigation', dispatched);
      resolveCommand(destination || { signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
      return true;
    },
  };
}

export default createStartupNavigation;
