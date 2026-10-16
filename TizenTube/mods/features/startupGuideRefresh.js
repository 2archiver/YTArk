/**
 * Bounded, one-shot refresh of the guide action. Resolver availability alone
 * is insufficient: the YTLR executor and the command constructor are separate
 * registry dependencies. Once invocation begins it is terminal even if it
 * throws, because the side effect may already have happened.
 */
export function createStartupGuideRefresh({ getExecutor, mark = () => {}, warn = null } = {}) {
  let status = 'pending';
  let executorReadyMarked = false;
  let errorCategory = null;

  function terminal(next, category = null) {
    if (status !== 'pending') return status;
    status = next;
    errorCategory = category;
    return status;
  }

  return {
    get status() { return status; },
    get done() { return status !== 'pending'; },
    get errorCategory() { return errorCategory; },
    tryDispatch() {
      if (status !== 'pending') return status;
      let executor;
      try { executor = typeof getExecutor === 'function' ? getExecutor() : null; }
      catch (_) {
        // Registry reflection can throw while Cobalt is still installing its
        // modules. No command was constructed or dispatched, so a later
        // bounded tick may retry dependency discovery.
        errorCategory = 'executor-resolution-pending';
        return status;
      }
      // Missing constructor/executor is a dependency-pending state. Do not
      // consume the request or mark success; a later bounded readiness tick may
      // observe the late registry entry.
      if (!executor || typeof executor.executeFunction !== 'function'
          || typeof executor.commandFunction !== 'function') return status;
      if (!executorReadyMarked) {
        executorReadyMarked = true;
        mark('guide-executor-ready', 'observed');
      }
      let command;
      try {
        command = new executor.commandFunction('reloadGuideAction');
        if (!command || (typeof command !== 'object' && typeof command !== 'function')) {
          terminal('failed', 'invalid-command');
          mark('guide-refresh-failed', 'failed');
          return status;
        }
      } catch (error) {
        terminal('failed', 'command-construction');
        if (typeof warn === 'function') { try { warn(error); } catch (_) { /* best effort */ } }
        mark('guide-refresh-failed', 'failed');
        return status;
      }
      // Mark the attempt before invoking an effectful executor. A throw can be
      // ambiguous, so it is not retried and cannot duplicate the refresh.
      try {
        executor.executeFunction(command);
        terminal('dispatched');
        mark('guide-refresh-dispatched', 'dispatched');
      } catch (error) {
        terminal('failed', 'executor-call');
        if (typeof warn === 'function') { try { warn(error); } catch (_) { /* best effort */ } }
        mark('guide-refresh-failed', 'failed');
      }
      return status;
    },
    timeOut() {
      if (status === 'pending') {
        terminal('timed-out', 'dependencies-unavailable');
        mark('guide-refresh-timeout', 'timeout');
      }
      return status;
    },
    fail(category = 'failed') {
      if (status === 'pending') {
        terminal('failed', category);
        mark('guide-refresh-failed', 'failed');
      }
      return status;
    },
  };
}

export default createStartupGuideRefresh;
