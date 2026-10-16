// Startup navigation must never be dispatched into an absent command resolver:
// resolveCommand() silently returns undefined when window._yttv has no resolver
// instance, so the saved destination or the reloadHomeOnStartup soft reload
// would be lost without a trace. It must also run at most once, keep the
// explicit destination priority, and complete immediately when disabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStartupNavigation, readStartupDestination } from '../features/startupNavigation.js';

function harness({ reload = true, destination = null, resolver = false } = {}) {
  const commands = [];
  const marks = [];
  let hasResolver = resolver;
  const nav = createStartupNavigation({
    configRead: (key) => (key === 'reloadHomeOnStartup' ? reload : destination),
    resolveCommand: (cmd) => { commands.push(cmd); return true; },
    hasResolver: () => hasResolver,
    mark: (name, detail) => marks.push([name, detail]),
  });
  return { nav, commands, marks, setResolver: (value) => { hasResolver = value; } };
}

test('navigation is deferred while the resolver is absent and dispatched once it appears', () => {
  const h = harness();
  assert.equal(h.nav.tryRun(), false, 'no dispatch into an absent resolver');
  assert.equal(h.commands.length, 0);
  assert.equal(h.nav.done, false);
  h.setResolver(true);
  assert.equal(h.nav.tryRun(), true);
  assert.deepEqual(h.commands, [{ signalAction: { signal: 'SOFT_RELOAD_PAGE' } }]);
  assert.equal(h.nav.dispatched, 'soft-reload');
});

test('repeated readiness ticks never dispatch twice', () => {
  const h = harness({ resolver: true });
  assert.equal(h.nav.tryRun(), true);
  assert.equal(h.nav.tryRun(), true);
  assert.equal(h.nav.tryRun(), true);
  assert.equal(h.commands.length, 1, 'exactly one startup navigation per launch');
});

test('an explicit startup destination keeps priority over the soft reload', () => {
  const destination = JSON.stringify({ browseEndpoint: { browseId: 'FEsubscriptions' } });
  const h = harness({ destination, resolver: true });
  assert.equal(h.nav.tryRun(), true);
  assert.deepEqual(h.commands, [{ browseEndpoint: { browseId: 'FEsubscriptions' } }]);
  assert.equal(h.nav.dispatched, 'explicit-destination');
  assert.deepEqual(h.marks, [['startup-navigation-dispatched', 'explicit-destination']],
    'the measurement mark records which command was issued');
});

test('reloadHomeOnStartup off completes the step without dispatching anything', () => {
  const h = harness({ reload: false });
  assert.equal(h.nav.tryRun(), true, 'a disabled reload does not wait for the resolver');
  assert.equal(h.commands.length, 0);
  assert.equal(h.nav.dispatched, 'disabled');
});

test('a malformed stored destination falls back to the soft reload', () => {
  const h = harness({ destination: '{"browseEndpoint":', resolver: true });
  assert.equal(h.nav.tryRun(), true);
  assert.deepEqual(h.commands, [{ signalAction: { signal: 'SOFT_RELOAD_PAGE' } }]);
});

test('an ambiguous resolver rejection is recorded as failed and never retried', () => {
  let calls = 0;
  const marks = [];
  const warnings = [];
  const nav = createStartupNavigation({
    configRead: key => key === 'reloadHomeOnStartup' ? true : null,
    hasResolver: () => true,
    resolveCommand: () => { calls += 1; throw new Error('after side effect'); },
    mark: (...mark) => marks.push(mark),
    warn: () => { warnings.push('warned'); },
  });
  assert.equal(nav.tryRun(), true);
  assert.equal(nav.status, 'failed');
  assert.equal(nav.errorCategory, 'dispatch-threw');
  assert.equal(nav.tryRun(), true);
  assert.equal(calls, 1);
  assert.deepEqual(marks, [['startup-navigation-failed', 'failed']]);
  assert.equal(warnings.length, 1);
});

test('a resolver that is present but rejects a command is not reported as dispatched', () => {
  const marks = [];
  const nav = createStartupNavigation({
    configRead: key => key === 'reloadHomeOnStartup' ? true : null,
    hasResolver: () => true,
    resolveCommand: () => false,
    mark: (...mark) => marks.push(mark),
  });
  assert.equal(nav.tryRun(), true);
  assert.equal(nav.status, 'failed');
  assert.equal(nav.dispatched, null);
  assert.deepEqual(marks, [['startup-navigation-failed', 'failed']]);
});

test('destination parsing keeps objects and refuses arrays, scalars and malformed JSON', () => {
  const warnings = [];
  const warn = (error) => warnings.push(error);
  assert.deepEqual(readStartupDestination('{"a":1}', warn), { a: 1 });
  assert.equal(readStartupDestination(null, warn), null);
  assert.equal(readStartupDestination('', warn), null);
  assert.equal(readStartupDestination('[1,2]', warn), null, 'arrays are not destinations');
  assert.equal(readStartupDestination('"home"', warn), null, 'scalars are not destinations');
  assert.equal(readStartupDestination('nope', warn), null);
  assert.equal(warnings.length, 1, 'only the malformed JSON is reported');
});
