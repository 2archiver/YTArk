// Remote-control and accessibility guards for the cosmetic Premium wordmark.
// The wordmark must never steal focus, never remove a focus target and never
// announce cosmetic branding as a subscription state.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  FakeMutationObserver,
  FakeElement,
  createDocument,
  createLocalStorage,
  createWindowStub,
  installGlobals,
  waitFor,
} from './helpers/fake-dom.mjs';

const localStorage = createLocalStorage({ 'ytaf-configuration': JSON.stringify({ enablePremiumLogo: true }) });
const doc = createDocument();
const windowStub = createWindowStub({ localStorage, doc });
installGlobals({ doc, windowStub, localStorage });

const { configWrite } = await import('../config.js');
const {
  cleanup,
  findLogoHosts,
  restoreHost,
  setPremiumLogo,
} = await import('../features/premiumBranding.js');

function makeFocusableLogoHost({ withLabel = false } = {}) {
  const host = new FakeElement('ytlr-logo-entity', doc);
  host.setAttribute('role', 'button');
  host.setAttribute('tabindex', '0');
  if (withLabel) host.setAttribute('aria-label', 'YouTube Home');
  host.__rectHeight = 52;
  host.__rectWidth = 168;
  host.style.setProperty('color', 'rgb(255, 255, 255)');
  const artwork = new FakeElement('img', doc);
  artwork.setAttribute('alt', 'YouTube');
  artwork.setAttribute('class', 'ytlr-logo-artwork');
  artwork.style.setProperty('background-image', 'url("https://i.ytimg.com/youtube_logo.png")');
  host.appendChild(artwork);
  doc.body.appendChild(host);
  return { host, artwork };
}

function wordmarkOf(host) {
  return host.querySelector('[data-ytark-premium-wordmark="true"]');
}

function resetDom() {
  for (const child of [...doc.body.children]) doc.body.removeChild(child);
  FakeMutationObserver.reset();
}

beforeEach(() => {
  resetDom();
  doc.activeElement = doc.body;
});

describe('focus and accessibility guards', () => {
  it('keeps the logo control focusable and hides only the artwork it paints', () => {
    const { host, artwork } = makeFocusableLogoHost();
    assert.equal(setPremiumLogo(host, true, doc), true);
    assert.equal(host.getAttribute('role'), 'button', 'the focus role is preserved');
    assert.equal(host.getAttribute('tabindex'), '0', 'the control stays in the remote-control order');
    assert.equal(host.style.getPropertyValue('visibility'), '', 'the control itself is never hidden');
    assert.equal(artwork.classList.contains('ytark-premium-logo-artwork-hidden'), true,
      'the stock artwork inside the control is hidden instead');
    assert.equal(artwork.style.getPropertyValue('visibility'), 'hidden');
    const wordmark = wordmarkOf(host);
    assert.ok(wordmark, 'the wordmark is rendered inside the focusable control');
    assert.equal(wordmark.getAttribute('aria-hidden'), 'true',
      'cosmetic branding is not announced as a subscription state');
    assert.equal(wordmark.getAttribute('role'), null);
    assert.equal(wordmark.getAttribute('tabindex'), null, 'the wordmark can never take remote focus');
  });

  it('re-attaches the accessible name that the hidden artwork carried', () => {
    const { host } = makeFocusableLogoHost();
    assert.equal(host.getAttribute('aria-label'), null);
    setPremiumLogo(host, true, doc);
    assert.equal(host.getAttribute('aria-label'), 'YouTube',
      'hiding <img alt="YouTube"> must not leave the focus target unnamed');

    const labelled = makeFocusableLogoHost({ withLabel: true });
    setPremiumLogo(labelled.host, true, doc);
    assert.equal(labelled.host.getAttribute('aria-label'), 'YouTube Home',
      'an existing accessible name is never overwritten');
  });

  it('removes only the name it added when the option is turned off', () => {
    const { host, artwork } = makeFocusableLogoHost();
    const before = JSON.stringify({
      role: host.getAttribute('role'),
      tabindex: host.getAttribute('tabindex'),
      color: host.style.getPropertyValue('color'),
      artworkVisibility: artwork.style.getPropertyValue('visibility'),
      artworkClass: artwork.getAttribute('class'),
    });
    setPremiumLogo(host, true, doc);
    assert.equal(host.getAttribute('aria-label'), 'YouTube');
    restoreHost(host);
    assert.equal(host.getAttribute('aria-label'), null, 'the injected name is removed again');
    assert.equal(wordmarkOf(host), null, 'no wordmark is left behind');
    const after = JSON.stringify({
      role: host.getAttribute('role'),
      tabindex: host.getAttribute('tabindex'),
      color: host.style.getPropertyValue('color'),
      artworkVisibility: artwork.style.getPropertyValue('visibility'),
      artworkClass: artwork.getAttribute('class'),
    });
    assert.equal(after, before, 'the stock header is restored byte for byte');
    assert.equal(artwork.getAttribute('class'), 'ytlr-logo-artwork');
    assert.equal(artwork.style.getPropertyValue('visibility'), '');
  });

  it('never leaves the stock artwork hidden when the wordmark is rejected', () => {
    const host = new FakeElement('ytlr-logo-entity', doc);
    const empty = new FakeElement('div', doc);
    host.appendChild(empty);
    doc.body.appendChild(host);
    assert.equal(setPremiumLogo(host, true, doc), false);
    assert.equal(host.getAttribute('aria-label'), null);
    assert.equal(empty.classList.contains('ytark-premium-logo-artwork-hidden'), false);
  });

  it('does not patch the player overlay or duplicate a wordmark in one location', () => {
    const host = new FakeElement('ytlr-logo-entity', doc);
    host.setAttribute('role', 'button');
    host.setAttribute('tabindex', '0');
    host.style.setProperty('background-image', 'url("https://i.ytimg.com/youtube_logo.png")');
    doc.body.appendChild(host);

    setPremiumLogo(host, true, doc);
    setPremiumLogo(host, true, doc);
    assert.equal(host.querySelectorAll('[data-ytark-premium-wordmark="true"]').length, 1,
      'applying twice keeps exactly one wordmark');
    assert.equal(host.classList.contains('ytark-premium-logo-artwork-hidden'), false,
      'a focusable host is never hidden, only the stock background paint is cleared');
    assert.equal(host.style.getPropertyValue('background-image'), 'none');
    assert.equal(host.getAttribute('tabindex'), '0');
    restoreHost(host);
    assert.equal(host.style.getPropertyValue('background-image'),
      'url("https://i.ytimg.com/youtube_logo.png")',
      'the stock background image is restored exactly');
  });

  it('patches every logo location once and keeps the wordmark out of the tab order', async () => {
    const first = makeFocusableLogoHost();
    const second = makeFocusableLogoHost({ withLabel: true });
    await waitFor(50);
    const hosts = findLogoHosts(doc);
    assert.ok(hosts.length >= 1);
    for (const host of hosts) setPremiumLogo(host, true, doc);
    const wordmarks = doc.body.querySelectorAll('[data-ytark-premium-wordmark="true"]');
    assert.equal(wordmarks.length, hosts.length, 'exactly one wordmark per logo location');
    for (const wordmark of wordmarks) {
      assert.equal(wordmark.getAttribute('tabindex'), null);
      assert.equal(wordmark.getAttribute('aria-hidden'), 'true');
      assert.notEqual(wordmark, doc.activeElement);
    }
    for (const host of hosts) assert.equal(host.getAttribute('tabindex'), '0');
    cleanup();
    configWrite('enablePremiumLogo', true);
    void first;
    void second;
  });
});
