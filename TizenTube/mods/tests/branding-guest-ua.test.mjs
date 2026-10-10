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
const { setPremiumLogo } = await import('../features/premiumBranding.js');
const { removeAdSlotRenderers } = await import('../features/adRendererPolicy.js');
const { DEVICE_PROFILES, generateUserAgent, applyUserAgentProfile } =
  await import('../features/userAgentSpoofing.js');
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

const fakeDocument = {
  createElement(tagName) { return new FakeElement(tagName); },
  createElementNS(_namespace, tagName) { return new FakeElement(tagName); },
};

function makeLogoHost() {
  const host = new FakeElement('ytlr-logo');
  host.style.setProperty('display', 'flex', 'important');
  host.style.setProperty('align-items', 'center');
  host.style.setProperty('gap', '6px');
  const artwork = new FakeElement('svg');
  artwork.style.setProperty('display', 'inline-block');
  host.appendChild(artwork);
  return { host, artwork };
}

describe('cosmetic YouTube-style logo', () => {
  it('toggles locally, restores the original artwork/styles, and is idempotent', () => {
    assert.equal(configRead('enablePremiumLogo'), true);
    const { host, artwork } = makeLogoHost();
    assert.equal(setPremiumLogo(host, true, fakeDocument), true);
    const mark = host.querySelector('[data-ytark-premium-wordmark="true"]');
    assert.ok(mark);
    assert.equal(host.children.length, 2);
    assert.equal(artwork.style.getPropertyValue('display'), 'none');
    assert.equal(artwork.style.getPropertyPriority('display'), 'important');
    assert.equal(mark.getAttribute('aria-hidden'), 'true');
    assert.equal(mark.children[1].textContent, 'YouTube Premium');

    assert.equal(setPremiumLogo(host, true, fakeDocument), true);
    assert.equal(host.children.length, 2);
    assert.equal(host.querySelector('[data-ytark-premium-wordmark="true"]'), mark);

    configWrite('enablePremiumLogo', false);
    assert.equal(configRead('enablePremiumLogo'), false);
    assert.equal(setPremiumLogo(host, configRead('enablePremiumLogo'), fakeDocument), true);
    assert.equal(host.children.length, 1);
    assert.equal(artwork.style.getPropertyValue('display'), 'inline-block');
    assert.equal(artwork.style.getPropertyPriority('display'), '');
    assert.equal(host.style.getPropertyValue('display'), 'flex');
    assert.equal(host.style.getPropertyPriority('display'), 'important');
    assert.equal(host.style.getPropertyValue('gap'), '6px');
  });

  it('does not replace focusable logo artwork or a focusable logo host', () => {
    const { host, artwork } = makeLogoHost();
    artwork.setAttribute('tabindex', '0');
    assert.equal(setPremiumLogo(host, true, fakeDocument), false);
    assert.equal(host.children.length, 1);
    assert.equal(artwork.style.getPropertyValue('display'), 'inline-block');

    artwork.attributes.delete('tabindex');
    host.setAttribute('tabindex', '0');
    assert.equal(setPremiumLogo(host, true, fakeDocument), false);
    assert.equal(host.children.length, 1);
    assert.equal(artwork.style.getPropertyValue('display'), 'inline-block');

    host.attributes.delete('tabindex');
    host.setAttribute('role', 'button');
    assert.equal(setPremiumLogo(host, true, fakeDocument), false);
    host.attributes.delete('role');
    host.closest = () => host;
    assert.equal(setPremiumLogo(host, true, fakeDocument), false);
    host.closest = () => null;
    artwork.setAttribute('focusable', 'true');
    assert.equal(setPremiumLogo(host, true, fakeDocument), false);
    artwork.attributes.delete('focusable');
    artwork.setAttribute('aria-label', 'YouTube');
    assert.equal(setPremiumLogo(host, true, fakeDocument), false);

    const { host: imageHost, artwork: imageArtwork } = makeLogoHost();
    imageArtwork.tagName = 'IMG';
    imageArtwork.setAttribute('alt', 'YouTube logo');
    assert.equal(setPremiumLogo(imageHost, true, fakeDocument), false);
    assert.equal(imageHost.children.length, 1);
  });
});

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

describe('deterministic bounded Cobalt User-Agent profiles', () => {
  it('generates stable, bounded strings without using them to pick APK architecture', () => {
    for (const [name, profile] of Object.entries(DEVICE_PROFILES)) {
      const first = generateUserAgent(profile);
      assert.equal(first, generateUserAgent(profile), `${name} should be deterministic`);
      assert.ok(first.length <= 512, `${name} User-Agent should remain bounded`);
      assert.match(first, /^Mozilla\/5\.0 \(Linux (?:arm64-v8a|armeabi-v7a); Android /);
    }
    assert.equal(generateUserAgent(null), null);
    assert.equal(configRead('userAgentProfile'), 'native');
  });

  it('applies one explicit profile transition once and does not loop reloads', () => {
    const storageValues = new Map();
    const storage = {
      getItem(key) { return storageValues.has(key) ? storageValues.get(key) : null; },
      setItem(key, value) { storageValues.set(key, String(value)); },
      removeItem(key) { storageValues.delete(key); },
    };
    let activeUserAgent = '';
    let setCount = 0;
    let reloadCount = 0;
    const bridge = {
      GetUserAgent() { return activeUserAgent; },
      SetUserAgent(value) { activeUserAgent = value; setCount += 1; },
    };
    const location = { reload() { reloadCount += 1; } };

    const first = applyUserAgentProfile('androidTv32', bridge, location, storage);
    assert.equal(first.reloaded, true);
    const repeated = applyUserAgentProfile('androidTv32', bridge, location, storage);
    assert.equal(repeated.reason, 'already-applied');
    assert.equal(repeated.reloaded, false);
    assert.equal(setCount, 1);
    assert.equal(reloadCount, 1);
    assert.ok(activeUserAgent.length <= 512);
  });
});
