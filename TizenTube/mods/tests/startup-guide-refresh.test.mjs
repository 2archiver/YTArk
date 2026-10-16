import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStartupGuideRefresh } from '../features/startupGuideRefresh.js';

function executorFixture() {
  const calls = [];
  class GuideCommand { constructor(name) { this.name = name; } }
  return {
    calls,
    executor: {
      commandFunction: GuideCommand,
      executeFunction(command) { calls.push(command); },
    },
  };
}

test('both executor and command constructor must be ready before one dispatch', () => {
  const marks = [];
  let current = null;
  const refresh = createStartupGuideRefresh({ getExecutor: () => current, mark: (...mark) => marks.push(mark) });
  assert.equal(refresh.tryDispatch(), 'pending');
  assert.equal(refresh.done, false);
  current = { executeFunction() {} };
  assert.equal(refresh.tryDispatch(), 'pending', 'executor alone is not sufficient');
  assert.deepEqual(marks, [], 'no readiness or success mark while the constructor is absent');
  const fixture = executorFixture();
  current = fixture.executor;
  assert.equal(refresh.tryDispatch(), 'dispatched');
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].name, 'reloadGuideAction');
  assert.deepEqual(marks, [
    ['guide-executor-ready', 'observed'],
    ['guide-refresh-dispatched', 'dispatched'],
  ]);
  assert.equal(refresh.tryDispatch(), 'dispatched');
  assert.equal(fixture.calls.length, 1, 'repeated readiness ticks cannot dispatch twice');
});

test('dependency lookup can fail temporarily and recover before the bounded timeout', () => {
  const fixture = executorFixture();
  const marks = [];
  let tries = 0;
  const refresh = createStartupGuideRefresh({
    getExecutor() { tries += 1; if (tries === 1) throw new Error('registry not ready'); return fixture.executor; },
    mark: (...mark) => marks.push(mark),
  });
  assert.equal(refresh.tryDispatch(), 'pending');
  assert.equal(refresh.tryDispatch(), 'dispatched');
  assert.equal(fixture.calls.length, 1);
  assert.equal(marks.filter(([name]) => name === 'guide-executor-ready').length, 1);
});

test('constructor failure is terminal and is never retried', () => {
  let executions = 0;
  let constructions = 0;
  let warnings = 0;
  const marks = [];
  class BrokenCommand { constructor() { constructions += 1; throw new Error('constructor'); } }
  const refresh = createStartupGuideRefresh({
    getExecutor: () => ({ commandFunction: BrokenCommand, executeFunction() { executions += 1; } }),
    mark: (...mark) => marks.push(mark),
    warn: () => { warnings += 1; },
  });
  assert.equal(refresh.tryDispatch(), 'failed');
  assert.equal(refresh.errorCategory, 'command-construction');
  assert.equal(refresh.tryDispatch(), 'failed');
  assert.equal(constructions, 1);
  assert.equal(executions, 0);
  assert.equal(warnings, 1);
  assert.equal(marks.filter(([name]) => name === 'guide-refresh-failed').length, 1);
});

test('ambiguous executor throws are terminal, preventing duplicate side effects', () => {
  let executions = 0;
  let warnings = 0;
  const marks = [];
  class GuideCommand {}
  const refresh = createStartupGuideRefresh({
    getExecutor: () => ({ commandFunction: GuideCommand, executeFunction() { executions += 1; throw new Error('after dispatch'); } }),
    mark: (...mark) => marks.push(mark),
    warn: () => { warnings += 1; },
  });
  assert.equal(refresh.tryDispatch(), 'failed');
  assert.equal(refresh.errorCategory, 'executor-call');
  assert.equal(refresh.tryDispatch(), 'failed');
  assert.equal(executions, 1);
  assert.equal(warnings, 1);
  assert.equal(marks.at(-1)[0], 'guide-refresh-failed');
  assert.equal(marks.some(([name]) => name === 'guide-refresh-dispatched'), false);
});

test('missing dependencies time out honestly without calling an executor', () => {
  const marks = [];
  const refresh = createStartupGuideRefresh({ getExecutor: () => null, mark: (...mark) => marks.push(mark) });
  assert.equal(refresh.tryDispatch(), 'pending');
  assert.equal(refresh.timeOut(), 'timed-out');
  assert.equal(refresh.timeOut(), 'timed-out');
  assert.equal(refresh.done, true);
  assert.deepEqual(marks, [['guide-refresh-timeout', 'timeout']]);
});
