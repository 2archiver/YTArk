// Startup navigation must never be dispatched into an absent command resolver:
// resolveCommand() silently returns undefined when window._yttv has no resolver
// instance, so the saved destination or the reloadHomeOnStartup soft reload
// would be lost without a trace. It must also run at most once, keep the
// explicit destination priority, and complete immediately when disabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStartupNavigation, readStartupDestination } from '../features/startupNavigation.js';

function harness({ reload = true, destination = null, resolver = false, home = false } = {}) {
  const commands = [];
  const marks = [];
  let hasResolver = resolver;
  const nav = createStartupNavigation({
    configRead: (key) => (key === 'reloadHomeOnStartup' ? reload : destination),
    resolveCommand: (cmd) => { commands.push(cmd); return true; },
    hasResolver: () => hasResolver,
    isHomeRoute: () => home,
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

test('a deliberate user input cancels delayed startup navigation without issuing a replacement route', () => {
  const h = harness();
  assert.equal(h.nav.tryRun(), false, 'the resolver has not appeared yet');
  assert.equal(h.nav.cancelForUserInput(), true);
  assert.equal(h.nav.status, 'cancelled');
  assert.equal(h.nav.errorCategory, 'user-input');
  h.setResolver(true);
  assert.equal(h.nav.tryRun(), true);
  assert.deepEqual(h.commands, [], 'no saved destination or soft reload overrides the user');
  assert.deepEqual(h.marks, [['startup-navigation-cancelled', 'user-input']]);
});

test('a cold start that already sits on Home skips the redundant soft reload', () => {
  const h = harness({ resolver: true, home: true });
  assert.equal(h.nav.tryRun(), true);
  assert.deepEqual(h.commands, [], 'no duplicate Home reload');
  assert.equal(h.nav.status, 'skipped');
  assert.equal(h.nav.dispatched, 'already-home');
  assert.deepEqual(h.marks, [['startup-navigation-skipped', 'already-home']]);
  assert.equal(h.nav.tryRun(), true, 'a skipped navigation stays one-shot');
});

test('a restored non-Home route still receives the soft reload', () => {
  const h = harness({ resolver: true, home: false });
  assert.equal(h.nav.tryRun(), true);
  assert.deepEqual(h.commands, [{ signalAction: { signal: 'SOFT_RELOAD_PAGE' } }]);
});

test('an explicit startup destination keeps priority over the Home check', () => {
  const destination = JSON.stringify({ browseEndpoint: { browseId: 'FEsubscriptions' } });
  const h = harness({ destination, resolver: true, home: true });
  assert.equal(h.nav.tryRun(), true);
  assert.deepEqual(h.commands, [{ browseEndpoint: { browseId: 'FEsubscriptions' } }]);
  assert.equal(h.nav.dispatched, 'explicit-destination');
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

test('destination parsing accepts only the fixed startup allowlist and exact command shapes', () => {
  const warnings = [];
  const warn = error => warnings.push(error);
  assert.deepEqual(readStartupDestination('{"browseEndpoint":{"browseId":"FEtopics"}}', warn),
    { browseEndpoint: { browseId: 'FEtopics' } });
  assert.deepEqual(readStartupDestination('{"searchEndpoint":{"query":""}}', warn),
    { searchEndpoint: { query: '' } });
  assert.equal(readStartupDestination(null, warn), null);
  assert.equal(readStartupDestination('', warn), null);
  for (const unsupported of [
    '{"browseEndpoint":{"browseId":"FEshorts"}}',
    '{"watchEndpoint":{"videoId":"secret"}}',
    '{"browseEndpoint":{"browseId":"FEtopics","params":"x"}}',
    '{"browseEndpoint":{"browseId":"FEtopics"},"watchEndpoint":{}}',
    '{"searchEndpoint":{"query":"a user query"}}',
    '[1,2]', '"home"', 'nope',
  ]) assert.equal(readStartupDestination(unsupported, warn), null, unsupported);
  assert.ok(warnings.length >= 6, 'unsupported and malformed destinations are reported for diagnostics only');
});
