import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
const mockLocalStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null; },
  setItem(key, value) { this[key] = String(value); },
  removeItem(key) { delete this[key]; },
};
Object.assign(mockLocalStorage, store);
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage, configurable: true, writable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: mockLocalStorage,
    h5vcc: null,
    addEventListener() {},
  }, configurable: true, writable: true,
});
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
}

const now = Date.now();
mockLocalStorage['ytaf-configuration'] = JSON.stringify({
  enableWhoIsWatchingMenu: false,
});
mockLocalStorage['yt.leanback.default::recurring_actions'] = JSON.stringify({
  data: { data: {
    'startup-screen-account-selector-with-guest': { lastFired: now + 7 * 24 * 60 * 60 * 1000 },
    'startup-screen-signed-out-welcome-back': { lastFired: now + 7 * 24 * 60 * 60 * 1000 },
    whos_watching_fullscreen_zero_accounts: { lastFired: 0 },
  } },
});

const { configRead, configWrite } = await import('../config.js');
const { removeAdSlotRenderers } = await import('../features/adRendererPolicy.js');
const {
  retirementState, retireUserAgentOverride, RETIRED_MARKER_KEY, LEGACY_APPLIED_KEY, LEGACY_UA_KEY,
} = await import('../features/userAgentRetirement.js');
const { restoreGuestAccountSelector, restoreLegacyAccountActions } =
  await import('../ui/disableWhosWatching.js');

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value, priority = '') {
    this.values.set(name, { value: String(value), priority: String(priority) });
  }
  getPropertyValue(name) { return this.values.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
  removeProperty(name) { this.values.delete(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toLowerCase();
    this.style = new FakeStyle();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  querySelector(selector) {
    if (selector === 'img, svg, yt-icon') {
      return this.children.find(child => ['img', 'svg', 'yt-icon'].includes(child.tagName)) || null;
    }
    const attrMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (attrMatch) {
      return this.children.find(child => child.getAttribute(attrMatch[1]) === attrMatch[2]) || null;
    }
    return null;
  }
}

describe('guest/sign-in renderer preservation', () => {
  it('removes ad slots without removing YouTube guest or account actions', () => {
    const guestFeedNudge = { feedNudgeRenderer: { text: 'Sign in', button: 'Continue as guest' } };
    const guestAlert = { alertWithActionsRenderer: { actions: ['Sign in', 'Continue as guest'] } };
    const ad = { adSlotRenderer: { slotId: 'masthead' } };
    const rows = [guestFeedNudge, ad, guestAlert];
    const filtered = removeAdSlotRenderers(rows);
    assert.deepEqual(filtered, [guestFeedNudge, guestAlert]);
    assert.equal(filtered[0], guestFeedNudge);
    assert.equal(filtered[1], guestAlert);
    assert.deepEqual(rows, [guestFeedNudge, ad, guestAlert]);
    assert.equal(removeAdSlotRenderers(null), null);
  });

  it('restores legacy Continue as guest and sign-in actions once without rescheduling them', () => {
    const signedOutWelcome = now + 7 * 24 * 60 * 60 * 1000;
    const previouslySuppressed = { data: { data: {
      'startup-screen-account-selector-with-guest': { lastFired: signedOutWelcome },
      'startup-screen-signed-out-welcome-back': { lastFired: signedOutWelcome },
    } } };
    assert.deepEqual(restoreLegacyAccountActions(previouslySuppressed, now), [
      'startup-screen-account-selector-with-guest',
      'startup-screen-signed-out-welcome-back',
    ]);
    assert.equal(previouslySuppressed.data.data['startup-screen-account-selector-with-guest'].lastFired, 0);
    assert.equal(previouslySuppressed.data.data['startup-screen-signed-out-welcome-back'].lastFired, 0);
    assert.equal(restoreGuestAccountSelector(previouslySuppressed, now), false);
    assert.deepEqual(restoreLegacyAccountActions(previouslySuppressed, now), []);

    const persisted = JSON.parse(mockLocalStorage['yt.leanback.default::recurring_actions']);
    assert.equal(persisted.data.data['startup-screen-account-selector-with-guest'].lastFired, 0);
    assert.equal(persisted.data.data['startup-screen-signed-out-welcome-back'].lastFired, 0);
    assert.equal(mockLocalStorage['ytark-account-flow-preserved-v1'], '1');
  });
});

describe('retirement of the removed user-agent override', () => {
  function fakeStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
      values,
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    };
  }

  it('restores the platform user agent once for an install that had chosen a profile', () => {
    const storage = fakeStorage({
      [LEGACY_APPLIED_KEY]: 'androidTv32:Mozilla/5.0 (Linux; Android 9) spoofed',
      [LEGACY_UA_KEY]: 'Mozilla/5.0 (Linux; Android 9) spoofed',
    });
    let resetCount = 0;
    let setCount = 0;
    let reloadCount = 0;
    let activeUserAgent = 'Mozilla/5.0 (Linux; Android 9) spoofed';
    const bridge = {
      ResetUserAgent() { resetCount += 1; activeUserAgent = ''; },
      SetUserAgent(value) { setCount += 1; activeUserAgent = String(value); },
    };
    const location = { reload() { reloadCount += 1; } };

    const state = retirementState({
      meta: { retiredValues: { userAgentProfile: 'androidTv32' } },
      storage,
    });
    assert.equal(state.needed, true);
    assert.equal(state.appliedOverride, true);

    const result = retireUserAgentOverride(bridge, storage, location);
    assert.equal(result.needed, true);
    assert.equal(result.reset, true);
    assert.equal(result.reloaded, true, 'one reload so the restored user agent is in effect');
    assert.equal(resetCount, 1);
    assert.equal(setCount, 0);
    assert.equal(reloadCount, 1);
    // The platform's own user agent is back: nothing wrote a substitute string.
    assert.equal(activeUserAgent, '');
    assert.equal(storage.getItem(LEGACY_APPLIED_KEY), null);
    assert.equal(storage.getItem(LEGACY_UA_KEY), null);
    assert.equal(storage.getItem(RETIRED_MARKER_KEY), '1');

    // One-shot: a second run cannot reset or reload again.
    const again = retireUserAgentOverride(bridge, storage, location);
    assert.equal(again.reason, 'already-retired');
    assert.equal(again.reset, false);
    assert.equal(resetCount, 1);
    assert.equal(reloadCount, 1);
  });

  it('does nothing at all for an install that never chose a profile', () => {
    const storage = fakeStorage({});
    let resetCount = 0;
    let setCount = 0;
    let reloadCount = 0;
    const bridge = {
      ResetUserAgent() { resetCount += 1; },
      SetUserAgent() { setCount += 1; },
    };
    const location = { reload() { reloadCount += 1; } };

    assert.equal(retirementState({ meta: { retiredValues: {} }, storage }).needed, false);
    const result = retireUserAgentOverride(bridge, storage, location);
    assert.equal(result.needed, false);
    assert.equal(result.reason, 'nothing-to-retire');
    assert.equal(resetCount, 0);
    assert.equal(setCount, 0);
    assert.equal(reloadCount, 0, 'no reload for an untouched install');
    assert.equal(storage.getItem(RETIRED_MARKER_KEY), '1');
  });

  it('uses the empty-override reset when the bridge has no ResetUserAgent', () => {
    const storage = fakeStorage({ [LEGACY_APPLIED_KEY]: 'tclTv32:spoofed' });
    const calls = [];
    const bridge = { SetUserAgent(value) { calls.push(value); } };
    const location = { reload() {} };
    const result = retireUserAgentOverride(bridge, storage, location);
    assert.equal(result.reset, true);
    assert.deepEqual(calls, [''], 'the only string ever sent is the empty override');
  });

  it('records the retirement without a bridge and leaves unrelated storage alone', () => {
    const session = JSON.stringify({ data: { data: { signed_in: { lastFired: 1 } } } });
    const storage = fakeStorage({
      [LEGACY_APPLIED_KEY]: 'fireTv32:spoofed',
      'yt.leanback.default::recurring_actions': session,
      'ytaf-configuration': JSON.stringify({ uiTheme: 'oled', enableAdBlock: false }),
      'yt.leanback.default::some-account-key': 'account-data',
    });
    const result = retireUserAgentOverride(null, storage, null);
    assert.equal(result.needed, true);
    assert.equal(result.reset, false);
    assert.equal(result.reloaded, false);
    assert.equal(result.reason, 'cleared-without-bridge');
    assert.equal(storage.getItem('yt.leanback.default::recurring_actions'), session);
    assert.equal(storage.getItem('yt.leanback.default::some-account-key'), 'account-data');
    assert.equal(JSON.parse(storage.getItem('ytaf-configuration')).uiTheme, 'oled');
    assert.equal(storage.getItem(RETIRED_MARKER_KEY), '1');
  });
});
