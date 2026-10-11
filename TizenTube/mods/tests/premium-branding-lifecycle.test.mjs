import { describe, it } from 'node:test';
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

const CONFIG_KEY = 'ytaf-configuration';
const localStorage = createLocalStorage();
const doc = createDocument();
const windowStub = createWindowStub({ localStorage, doc });
installGlobals({ doc, windowStub, localStorage });

const { configChangeEmitter, configRead, configWrite } = await import('../config.js');
const {
  cleanup,
  findLogoHosts,
  restoreHost,
  setPremiumLogo,
} = await import('../features/premiumBranding.js');

function makeLeanbackHost({ background = 'url("https://i.ytimg.com/youtube_logo.png")' } = {}) {
  const host = new FakeElement('ytlr-logo-entity', doc);
  host.__rectHeight = 52;
  host.__rectWidth = 168;
  host.style.setProperty('display', 'block');
  const thumbnail = new FakeElement('ytlr-thumbnail-details', doc);
  thumbnail.style.setProperty('background-image', background);
  thumbnail.style.setProperty('background-size', 'auto 100%');
  thumbnail.style.setProperty('background-repeat', 'no-repeat');
  host.appendChild(thumbnail);
  doc.body.appendChild(host);
  return { host, thumbnail };
}

function makeImageHost() {
  const host = new FakeElement('ytlr-logo', doc);
  host.style.setProperty('display', 'flex', 'important');
  host.style.setProperty('gap', '6px');
  const artwork = new FakeElement('img', doc);
  artwork.setAttribute('alt', 'YouTube');
  artwork.style.setProperty('display', 'inline-block');
  host.appendChild(artwork);
  doc.body.appendChild(host);
  return { host, artwork };
}

function wordmarks(host) {
  return host.querySelectorAll('[data-ytark-premium-wordmark="true"]');
}

function resetDom() {
  for (const child of [...doc.body.children]) doc.body.removeChild(child);
  FakeMutationObserver.reset();
}

describe('premium wordmark on the real Leanback logo markup', () => {
  it('replaces the ytlr-logo-entity background artwork with one local wordmark', async () => {
    resetDom();
    const { host, thumbnail } = makeLeanbackHost();
    assert.equal(configRead('enablePremiumLogo'), true);
    assert.deepEqual(findLogoHosts(doc), [host]);

    await waitFor(200);

    const marks = wordmarks(host);
    assert.equal(marks.length, 1, 'exactly one wordmark per logo location');
    const mark = marks[0];
    assert.equal(mark.getAttribute('aria-hidden'), 'true');
    assert.equal(mark.querySelector('.ytark-premium-text').textContent, 'YouTube Premium');
    assert.ok(mark.querySelector('.ytark-premium-mark'), 'local red play emblem is drawn with CSS');
    assert.equal(thumbnail.style.getPropertyValue('background-image'), 'none');
    assert.equal(thumbnail.style.getPropertyPriority('background-image'), 'important');
    assert.ok(thumbnail.classList.contains('ytark-premium-logo-artwork-hidden'));
    assert.equal(host.style.getPropertyValue('display'), 'inline-flex');
    assert.ok(doc.getElementById('ytark-premium-logo-style'), 'stylesheet is bundled, not fetched');
    assert.equal(window.__ytarkPremiumLogo.state, 'active');
    assert.equal(window.__ytarkPremiumLogo.patchedHosts, 1);
  });

  it('is idempotent and does not stack duplicate wordmarks', async () => {
    const host = findLogoHosts(doc)[0];
    const before = wordmarks(host)[0];
    assert.equal(setPremiumLogo(host, true, doc), true);
    assert.equal(setPremiumLogo(host, true, doc), true);
    await waitFor(200);
    assert.equal(wordmarks(host).length, 1);
    assert.equal(wordmarks(host)[0], before);
  });

  it('restores the stock artwork byte-for-byte when the option is turned off', async () => {
    const host = findLogoHosts(doc)[0];
    const thumbnail = host.querySelector('ytlr-thumbnail-details');
    configWrite('enablePremiumLogo', false);
    await waitFor(200);
    assert.equal(wordmarks(host).length, 0);
    assert.equal(thumbnail.style.getPropertyValue('background-image'),
      'url("https://i.ytimg.com/youtube_logo.png")');
    assert.equal(thumbnail.style.getPropertyPriority('background-image'), '');
    assert.equal(thumbnail.style.getPropertyValue('background-size'), 'auto 100%');
    assert.equal(thumbnail.classList.contains('ytark-premium-logo-artwork-hidden'), false);
    assert.equal(host.style.getPropertyValue('display'), 'block');
    assert.equal(host.style.getPropertyPriority('display'), '');
    assert.equal(window.__ytarkPremiumLogo.state, 'disabled');

    configWrite('enablePremiumLogo', true);
    await waitFor(200);
    assert.equal(wordmarks(host).length, 1);
    assert.equal(thumbnail.style.getPropertyValue('background-image'), 'none');
  });

  it('patches every existing logo location, including a second entity', async () => {
    const { host: second } = makeLeanbackHost();
    windowStub.dispatch('pageshow');
    await waitFor(200);
    assert.equal(wordmarks(second).length, 1);
    assert.equal(findLogoHosts(doc).length, 2);
    for (const host of findLogoHosts(doc)) assert.equal(wordmarks(host).length, 1);
  });
});

describe('alternative logo markup and safety guards', () => {
  it('hides an element-based logo and restores it', () => {
    const { host, artwork } = makeImageHost();
    assert.equal(setPremiumLogo(host, true, doc), true);
    assert.equal(wordmarks(host).length, 1);
    assert.equal(artwork.style.getPropertyValue('visibility'), 'hidden');
    assert.ok(artwork.classList.contains('ytark-premium-logo-artwork-hidden'));
    assert.equal(host.style.getPropertyValue('display'), 'inline-flex');
    assert.equal(host.style.getPropertyValue('gap'), '0.34em');

    assert.equal(setPremiumLogo(host, false, doc), true);
    assert.equal(wordmarks(host).length, 0);
    assert.equal(artwork.style.getPropertyValue('visibility'), '');
    assert.equal(artwork.classList.contains('ytark-premium-logo-artwork-hidden'), false);
    assert.equal(host.style.getPropertyValue('display'), 'flex');
    assert.equal(host.style.getPropertyPriority('display'), 'important');
    assert.equal(host.style.getPropertyValue('gap'), '6px');
  });

  it('keeps a focusable logo control focusable and never focusable as the wordmark', () => {
    const { host, artwork } = makeImageHost();
    host.tagName = 'a';
    host.setAttribute('href', '/tv');
    host.setAttribute('tabindex', '0');
    host.setAttribute('aria-label', 'YouTube TV home');
    assert.equal(setPremiumLogo(host, true, doc), true);
    const mark = wordmarks(host)[0];
    assert.equal(mark.getAttribute('tabindex'), null);
    assert.equal(host.getAttribute('tabindex'), '0');
    assert.equal(host.getAttribute('aria-label'), 'YouTube TV home');
    assert.equal(artwork.style.getPropertyValue('visibility'), 'hidden');
    assert.equal(setPremiumLogo(host, false, doc), true);
    resetDom();
  });

  it('refuses hosts inside the player overlay and unknown markup', () => {
    resetDom();
    const player = new FakeElement('ytlr-player', doc);
    const overlayHost = new FakeElement('ytlr-logo-entity', doc);
    const overlayThumb = new FakeElement('ytlr-thumbnail-details', doc);
    overlayThumb.style.setProperty('background-image', 'url("x.png")');
    overlayHost.appendChild(overlayThumb);
    player.appendChild(overlayHost);
    doc.body.appendChild(player);

    assert.deepEqual(findLogoHosts(doc), []);
    assert.equal(setPremiumLogo(overlayHost, true, doc), false);
    assert.equal(wordmarks(overlayHost).length, 0);
    assert.equal(overlayThumb.style.getPropertyValue('background-image'), 'url("x.png")');

    const unknownHost = new FakeElement('ytlr-logo-entity', doc);
    doc.body.appendChild(unknownHost);
    assert.equal(setPremiumLogo(unknownHost, true, doc), false);
    assert.equal(wordmarks(unknownHost).length, 0);
    assert.equal(unknownHost.children.length, 0);
    resetDom();
  });
});

describe('logo lifecycle across navigation, teardown and config changes', () => {
  it('cleans up on pagehide, re-applies on pageshow, and disconnects observers', async () => {
    resetDom();
    const { host, thumbnail } = makeLeanbackHost();
    windowStub.dispatch('pageshow');
    await waitFor(200);
    assert.equal(wordmarks(host).length, 1);

    windowStub.dispatch('pagehide');
    assert.equal(wordmarks(host).length, 0);
    assert.equal(thumbnail.style.getPropertyValue('background-image'),
      'url("https://i.ytimg.com/youtube_logo.png")');

    windowStub.dispatch('pageshow');
    await waitFor(200);
    assert.equal(wordmarks(host).length, 1);

    const listenerCount = configChangeEmitter.listeners.configChange.length;
    cleanup();
    assert.equal(wordmarks(host).length, 0);
    assert.equal(FakeMutationObserver.activeCount, 0, 'no observer is left observing');
    assert.equal(configChangeEmitter.listeners.configChange.length, listenerCount,
      'config listener stays installed for later re-enables');

    windowStub.dispatch('pageshow');
    await waitFor(200);
    assert.equal(wordmarks(host).length, 1);
  });

  it('re-applies when the frontend re-renders the logo slot', async () => {
    const host = findLogoHosts(doc)[0];
    assert.equal(wordmarks(host).length, 1);
    // Simulate Polymer wiping the slot content on a route change.
    for (const child of [...host.children]) {
      if (child.getAttribute('data-ytark-premium-wordmark') === 'true') host.removeChild(child);
    }
    windowStub.dispatch('pageshow');
    await waitFor(200);
    assert.equal(wordmarks(host).length, 1);
  });

  it('drops a detached host, disconnects its observer and re-applies on re-attach', async () => {
    resetDom();
    const { host } = makeLeanbackHost();
    windowStub.dispatch('pageshow');
    await waitFor(200);
    const mark = wordmarks(host)[0];
    assert.ok(mark);
    host.detach();
    windowStub.dispatch('pagehide');
    assert.equal(FakeMutationObserver.activeCount, 0,
      'no observer keeps a detached logo host alive');
    doc.body.appendChild(host);
    windowStub.dispatch('pageshow');
    await waitFor(200);
    assert.equal(wordmarks(host).length, 1, 're-attaching the header yields exactly one wordmark');
  });
});
