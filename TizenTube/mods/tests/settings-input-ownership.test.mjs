import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsInputOwner } from '../ui/settingsInputOwnership.js';

function event(type, keyCode, target = null, extra = {}) {
  return {
    type, keyCode, which: keyCode, target, repeat: false,
    defaultPrevented: false, propagationStopped: false, immediatePropagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; this.propagationStopped = true; },
    ...extra,
  };
}

function harness() {
  let open = true;
  let dismissals = 0;
  let restores = 0;
  const root = {
    contains(target) { return target === this || target.parent === this; },
  };
  const owner = createSettingsInputOwner({
    isPanelOpen: () => open,
    dismissPanel: () => { dismissals += 1; open = false; },
    findModalRoot: () => root,
    restoreModalFocus: target => { restores += 1; return target === root; },
  });
  return { owner, root, close: () => { open = false; }, get open() { return open; },
    get dismissals() { return dismissals; }, get restores() { return restores; } };
}

function assertConsumed(input) {
  assert.equal(input.defaultPrevented, true);
  assert.equal(input.propagationStopped, true);
  assert.equal(input.immediatePropagationStopped, true);
}

describe('Settings remote-input ownership', () => {
  test('routes Back through the visible panel once and consumes a held repeat after close', () => {
    const h = harness();
    const first = event('keydown', 10009, h.root);
    assert.equal(h.owner.handleKeyDown(first), true);
    assertConsumed(first);
    assert.equal(h.dismissals, 1);
    assert.equal(h.open, false);

    const repeat = event('keydown', 10009, null, { repeat: true });
    assert.equal(h.owner.handleKeyDown(repeat), true, 'the held key cannot Back out of the app');
    assertConsumed(repeat);
    assert.equal(h.dismissals, 1, 'one physical hold issues one dismissal');

    const release = event('keyup', 10009);
    assert.equal(h.owner.handleKeyUp(release), true);
    assertConsumed(release);
    assert.equal(h.owner.heldBackKeyCount, 0);
  });

  test('leaves D-pad and OK with the focused visible panel, not a global handler', () => {
    const h = harness();
    for (const code of [13, 32, 37, 38, 39, 40]) {
      const input = event('keydown', code, { parent: h.root });
      assert.equal(h.owner.handleKeyDown(input), false, `key ${code} is passed to the modal focus controller`);
      assert.equal(input.defaultPrevented, false);
      assert.equal(input.propagationStopped, false);
    }
    assert.equal(h.dismissals, 0);
  });

  test('blocks activation from stale focus behind a detectable visible panel and restores panel focus', () => {
    const h = harness();
    const input = event('keydown', 13, { parent: null });
    assert.equal(h.owner.handleKeyDown(input), true);
    assertConsumed(input);
    assert.equal(h.restores, 1);
    assert.equal(h.dismissals, 0, 'focus correction does not close the panel');
  });

  test('consumes red/green shortcuts only while Settings owns the modal', () => {
    const h = harness();
    for (const code of [403, 404]) {
      const down = event('keydown', code);
      assert.equal(h.owner.handleKeyDown(down), true);
      assertConsumed(down);
      const up = event('keyup', code);
      assert.equal(h.owner.handleKeyUp(up), true);
      assertConsumed(up);
    }
    h.close();
    const outside = event('keydown', 404);
    assert.equal(h.owner.handleKeyDown(outside), false, 'input outside Settings is untouched');
    assert.equal(outside.defaultPrevented, false);
  });

  test('lets an Android TV text field handle its own Back before closing the panel', () => {
    const h = harness();
    const input = event('keydown', 27, { tagName: 'INPUT' });
    assert.equal(h.owner.handleKeyDown(input), false);
    assert.equal(input.defaultPrevented, false);
    assert.equal(h.dismissals, 0);
    assert.equal(h.open, true);
  });

  test('does not take over unrelated keys or D-pad input when no Settings panel is open', () => {
    const h = harness();
    h.close();
    for (const code of [13, 37, 39, 10009, 403, 404]) {
      const input = event('keydown', code);
      assert.equal(h.owner.handleKeyDown(input), false, `key ${code} is not globally suppressed`);
      assert.equal(input.defaultPrevented, false);
    }
  });
});
