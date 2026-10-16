/** One-shot startup navigation, dispatched only after the real resolver exists. */
import { parseStartupDestination } from './startupDestination.js';

/** Parse the stored destination; malformed or unsupported data never becomes a raw command. */
export function readStartupDestination(raw, warn = null) {
  return parseStartupDestination(raw, warn);
}

export function createStartupNavigation({ configRead, resolveCommand, hasResolver, mark = () => {}, warn = null }) {
  let status = 'pending';
  let dispatched = null;
  let errorCategory = null;
  return {
    get status() { return status; },
    get done() { return status !== 'pending'; },
    get dispatched() { return dispatched; },
    get errorCategory() { return errorCategory; },
    /**
     * A real navigation key/click before readiness means the viewer has taken
     * control. Drop the delayed automatic action instead of navigating over
     * the route they just selected. This never consumes their input event.
     */
    cancelForUserInput() {
      if (status !== 'pending') return false;
      status = 'cancelled';
      errorCategory = 'user-input';
      mark('startup-navigation-cancelled', 'user-input');
      return true;
    },
    /** Returns false only while the resolver dependency is not available. */
    tryRun() {
      if (status !== 'pending') return true;
      let reload;
      try { reload = configRead('reloadHomeOnStartup'); }
      catch (error) {
        status = 'failed';
        errorCategory = 'configuration';
        if (typeof warn === 'function') { try { warn(error); } catch (_) { /* best effort */ } }
        mark('startup-navigation-failed', 'failed');
        return true;
      }
      if (!reload) {
        status = 'disabled';
        dispatched = 'disabled';
        mark('startup-navigation-dispatched', 'disabled');
        return true;
      }
      let ready = false;
      try { ready = hasResolver() === true; } catch (_) { ready = false; }
      if (!ready) return false;

      let destination = null;
      try { destination = readStartupDestination(configRead('launchToOnStartup'), warn); }
      catch (error) {
        if (typeof warn === 'function') { try { warn(error); } catch (_) { /* best effort */ } }
      }
      const category = destination ? 'explicit-destination' : 'soft-reload';
      const command = destination || { signalAction: { signal: 'SOFT_RELOAD_PAGE' } };
      // An invocation that throws can have performed a side effect already.
      // Consume the attempt once, but mark it failed rather than pretending it
      // was dispatched or retrying an ambiguous navigation.
      try {
        const result = resolveCommand(command);
        if (result === false) {
          status = 'failed';
          errorCategory = 'resolver-rejected';
          mark('startup-navigation-failed', 'failed');
          return true;
        }
        status = 'dispatched';
        dispatched = category;
        mark('startup-navigation-dispatched', category);
      } catch (error) {
        status = 'failed';
        errorCategory = 'dispatch-threw';
        if (typeof warn === 'function') { try { warn(error); } catch (_) { /* best effort */ } }
        mark('startup-navigation-failed', 'failed');
      }
      return true;
    },
    timeOut() {
      if (status === 'pending') {
        status = 'timed-out';
        errorCategory = 'resolver-unavailable';
      }
      return status;
    },
  };
}

export default createStartupNavigation;
