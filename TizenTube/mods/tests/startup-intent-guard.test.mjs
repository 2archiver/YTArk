import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installStartupIntentGuard } from '../features/startupIntentGuard.js';

function input(type, keyCode = 0, extra = {}) {
  return {
    type, keyCode, target: null, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...extra,
  };
}

function harness() {
  const listeners = new Map();
  const removed = [];
  const doc = {
    addEventListener(type, listener, capture) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      assert.equal(capture, true, 'intent observation is installed in capture phase');
    },
    removeEventListener(type, listener, capture) {
      removed.push([type, listener, capture]);
      listeners.get(type)?.delete(listener);
    },
  };
  const cancels = [];
  const guard = installStartupIntentGuard({ documentObject: doc, cancelNavigation: () => cancels.push('cancelled') });
  return {
    doc, guard, cancels, removed,
    emit(event) { for (const listener of [...(listeners.get(event.type) || [])]) listener(event); },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

describe('startup navigation user-intent guard', () => {
  test('observes deliberate D-pad/OK/Back and pointer input once without consuming it', () => {
    for (const code of [36, 37, 38, 39, 40, 13, 32, 8, 27, 10009, 403, 404, 461, 48, 49, 57]) {
      const h = harness();
      const key = input('keydown', code);
      h.emit(key);
      assert.deepEqual(h.cancels, ['cancelled'], `key ${code} cancels delayed navigation`);
      assert.equal(key.defaultPrevented, false, 'the guard never prevents user input');
      assert.equal(key.propagationStopped, false, 'the guard never stops propagation');
      assert.equal(h.guard.active, false);
      assert.equal(h.count(), 0, 'one input removes all listeners');
    }
    for (const type of ['pointerdown', 'click', 'touchstart']) {
      const h = harness();
      h.emit(input(type));
      assert.deepEqual(h.cancels, ['cancelled'], `${type} cancels delayed navigation`);
    }
  });

  test('maps named browser remote keys and numeric seek keys as user intent', () => {
    for (const key of ['ArrowUp', 'ArrowRight', 'Enter', 'Escape', '1', 'Numpad9']) {
      const h = harness();
      h.emit(input('keydown', 0, { key }));
      assert.deepEqual(h.cancels, ['cancelled'], `${key} cancels a delayed automatic route`);
    }
  });

  test('ignores text entry and unrelated keys, including repeat events not mapped to navigation', () => {
    const h = harness();
    const text = input('keydown', 13, { target: { tagName: 'INPUT' } });
    h.emit(text);
    h.emit(input('keydown', 65));
    h.emit(input('keydown', 65, { repeat: true }));
    assert.deepEqual(h.cancels, []);
    assert.equal(h.guard.active, true);
    assert.equal(h.count(), 4, 'listeners remain installed only while startup navigation is pending');
  });

  test('a held mapped key cancels once and no stale callback/listener remains', () => {
    const h = harness();
    h.emit(input('keydown', 40));
    h.emit(input('keydown', 40, { repeat: true }));
    assert.deepEqual(h.cancels, ['cancelled']);
    assert.equal(h.removed.length, 4);
    h.guard.dispose();
    assert.equal(h.removed.length, 4, 'disposal after cancellation is idempotent');
  });
});
