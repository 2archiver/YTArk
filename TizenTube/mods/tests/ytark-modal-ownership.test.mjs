import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsInputOwner } from '../ui/settingsInputOwnership.js';
import {
  hasVisibleYtarkModal,
  hasVisibleYtarkSettingsPanel,
  noteYtarkModalCommand,
  registerYtarkModal,
  restoreYtarkModal,
  resetYtarkModalStateForTests,
  ytarkModalBackCommand,
} from '../ui/ytarkModalOwnership.js';

const popupBack = { signalAction: { signal: 'POPUP_BACK' } };

function keyEvent(keyCode) {
  return {
    type: 'keydown', keyCode, target: null,
    defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.propagationStopped = true; },
  };
}

beforeEach(() => resetYtarkModalStateForTests());

test('generic YTArk dialogs do not become Settings remote-input owners', () => {
  registerYtarkModal('feedback-dialog', popupBack, false);
  let dismissals = 0;
  const owner = createSettingsInputOwner({
    isPanelOpen: hasVisibleYtarkSettingsPanel,
    dismissPanel: () => { dismissals += 1; },
  });

  assert.equal(hasVisibleYtarkModal(), true);
  assert.equal(hasVisibleYtarkSettingsPanel(), false);
  const back = keyEvent(10009);
  assert.equal(owner.handleKeyDown(back), false);
  assert.equal(back.defaultPrevented, false);
  assert.equal(dismissals, 0);
});

test('a Settings modal owns Back and supplies its own dismissal command', () => {
  registerYtarkModal('ytark-menu-root', popupBack, true);
  const owner = createSettingsInputOwner({
    isPanelOpen: hasVisibleYtarkSettingsPanel,
    dismissPanel: () => noteYtarkModalCommand(ytarkModalBackCommand()),
  });

  const back = keyEvent(10009);
  assert.equal(owner.handleKeyDown(back), true);
  assert.equal(back.defaultPrevented, true);
  assert.equal(back.propagationStopped, true);
  assert.equal(hasVisibleYtarkSettingsPanel(), false);
  assert.equal(hasVisibleYtarkModal(), false);
});

test('only a Back command closes ownership; ordinary commands leave the modal tracked', () => {
  registerYtarkModal('ytark-panel-about', popupBack, true);
  assert.equal(noteYtarkModalCommand({ browseEndpoint: { browseId: 'FEtopics' } }), false);
  assert.equal(hasVisibleYtarkSettingsPanel(), true);
  assert.equal(noteYtarkModalCommand({ commandExecutorCommand: { commands: [popupBack, { customAction: { action: 'RETURN_TO_PARENT' } }] } }), true);
  assert.equal(hasVisibleYtarkModal(), false);
});

test('failed modal opening can restore the previous owner without leaking a child scope', () => {
  registerYtarkModal('ytark-menu-navigation', popupBack, true);
  const previous = registerYtarkModal('generic-confirmation', popupBack, false);
  assert.equal(hasVisibleYtarkSettingsPanel(), false);
  restoreYtarkModal(previous);
  assert.equal(hasVisibleYtarkSettingsPanel(), true);
});
