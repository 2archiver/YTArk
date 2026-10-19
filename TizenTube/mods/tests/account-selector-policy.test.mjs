import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { automaticAccountSelectorAction, ACCOUNT_SELECTOR_TRIGGERS } from '../features/accountSelectorPolicy.js';

const onExit = () => ({ requestAccountSelectorCommand: {
  identityActionContext: { eventTrigger: ACCOUNT_SELECTOR_TRIGGERS.ON_EXIT },
} });

describe('canonical automatic profile-picker policy', () => {
  test('Off suppresses only the verified automatic On-exit selector and preserves app exit', () => {
    assert.equal(automaticAccountSelectorAction(onExit(), false), 'exit');
    assert.equal(automaticAccountSelectorAction(onExit(), true), 'allow');
  });

  test('manual, absent and unknown trigger contexts remain host-owned', () => {
    assert.equal(automaticAccountSelectorAction({ requestAccountSelectorCommand: {} }, false), 'allow');
    assert.equal(automaticAccountSelectorAction({ requestAccountSelectorCommand: {
      identityActionContext: { eventTrigger: 'ACCOUNT_EVENT_TRIGGER_USER_ACTION' },
    } }, false), 'allow');
    assert.equal(automaticAccountSelectorAction({ requestAccountSelectorCommand: {
      identityActionContext: { eventTrigger: 'ACCOUNT_EVENT_TRIGGER_ON_STARTUP' },
    } }, false), 'allow', 'unverified triggers are not guessed to be automatic');
    assert.equal(automaticAccountSelectorAction({ navigateEndpoint: { browseId: 'FEtopics' } }, false), 'allow');
  });
});
