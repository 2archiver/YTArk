import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, rowTitle, rowSubtitle,
  rowSecondaryIcon, findRow,
} from './helpers/ytlr-harness.mjs';

const { recorded, localStorage } = setupEnvironment();
await initEnglish();
const config = await import('../config.js');
const registry = await import('../ui/settingsRegistry.js');
const settings = await import('../ui/settings.js');
const resolver = await import('../resolveCommand.js');
resolver.patchResolveCommand();

const onExitRequest = () => ({ requestAccountSelectorCommand: {
  identityActionContext: { eventTrigger: 'ACCOUNT_EVENT_TRIGGER_ON_EXIT' },
} });

function lastRecorded() { return recorded.at(-1); }

describe('account selector resolver wiring', () => {
  it('renders one canonical Who’s watching checkbox row (checked = on)', () => {
    assert.equal(config.configKeys().includes('enableWhoIsWatchingMenu'), false);
    assert.equal(config.configKeys().includes('permanentlyEnableWhoIsWatchingMenu'), false);
    assert.equal(config.configKeys().includes('enableWhosWatchingMenuOnAppExit'), false);
    const node = registry.findNode(registry.buildSettingsTree(), 'nav.profilePicker');
    assert.equal(node.key, 'showAutomaticProfilePicker');
    assert.equal(node.statusOnly, undefined, 'a real checkbox row, not a status-only text row');

    settings.showSettingsMenu('navigation');
    let panel = lastModal(recorded, 'ytark-navigation');
    let row = findRow(panel, node.title);
    // Off: an outlined checkbox carries the state; the tiny On/Off
    // text the old status-only row showed is gone.
    assert.equal(rowSecondaryIcon(row), 'CHECK_BOX_OUTLINE_BLANK');
    assert.doesNotMatch(rowSubtitle(row), /\bOff\b/, 'the state is the checkbox, not On/Off text');

    config.configWrite('showAutomaticProfilePicker', true);
    settings.showSettingsMenu('navigation', { update: true });
    panel = lastModal(recorded, 'ytark-navigation');
    row = findRow(panel, node.title);
    // On: a filled checkbox.
    assert.equal(rowSecondaryIcon(row), 'CHECK_BOX');
    assert.doesNotMatch(rowSubtitle(row), /\bOn\b/);
    assert.equal(modalItems(panel).filter(item => /who.s watching/i.test(rowTitle(item))).length, 1);
    config.configWrite('showAutomaticProfilePicker', false);
  });

  it('keeps the canonical preference Off and converts the known automatic exit prompt to app exit', () => {
    assert.equal(config.configRead('showAutomaticProfilePicker'), false);
    resolver.default(onExitRequest());
    assert.deepEqual(lastRecorded(), { signalAction: { signal: 'EXIT_APP' } });
    assert.equal(config.configRead('showAutomaticProfilePicker'), false);
  });

  it('allows the verified automatic prompt when On and preserves explicit or unknown host flows when Off', () => {
    config.configWrite('showAutomaticProfilePicker', true);
    const onExit = onExitRequest();
    resolver.default(onExit);
    assert.equal(lastRecorded(), onExit, 'On leaves the automatic account selector to YouTube');

    config.configWrite('showAutomaticProfilePicker', false);
    const manual = { requestAccountSelectorCommand: {
      identityActionContext: { eventTrigger: 'ACCOUNT_EVENT_TRIGGER_USER_ACTION' },
    } };
    resolver.default(manual);
    assert.equal(lastRecorded(), manual, 'a manual user-action request remains host-owned');

    const unknown = { requestAccountSelectorCommand: {
      identityActionContext: { eventTrigger: 'ACCOUNT_EVENT_TRIGGER_FUTURE_UNKNOWN' },
    } };
    resolver.default(unknown);
    assert.equal(lastRecorded(), unknown, 'unknown trigger enums are not guessed to be automatic');

    const noContext = { requestAccountSelectorCommand: {} };
    resolver.default(noContext);
    assert.equal(lastRecorded(), noContext, 'manual host requests without trigger metadata are preserved');
    assert.equal(config.configRead('showAutomaticProfilePicker'), false);
    assert.equal(localStorage['yt.leanback.default::identity'], undefined,
      'the resolver does not read, delete, or rewrite account identity data');
  });
});
