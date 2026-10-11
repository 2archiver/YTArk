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
  refreshInk,
  restoreHost,
  setPremiumLogo,
} = await import('../features/premiumBranding.js');
const { YOUTUBE_PREMIUM_WORDMARK } = await import('../assets/youtubePremiumLogo.generated.js');

function makeLeanbackHost({
  background = 'url("https://i.ytimg.com/youtube_logo.png")',
  color = 'rgb(255, 255, 255)',
} = {}) {
  const host = new FakeElement('ytlr-logo-entity', doc);
  host.__rectHeight = 52;
  host.__rectWidth = 168;
  host.style.setProperty('display', 'block');
  host.style.setProperty('color', color);
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

function vectorOf(host) {
  const mark = wordmarks(host)[0];
  return mark ? mark.querySelector('svg.ytark-premium-vector') : null;
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
    assert.equal(mark.querySelector('.ytark-premium-text'), null,
      'the previous text approximation is not rendered any more');
    const vector = mark.querySelector('svg.ytark-premium-vector');
    assert.ok(vector, 'the bundled vector artwork is rendered inline');
    assert.equal(vector.getAttribute('viewBox'), YOUTUBE_PREMIUM_WORDMARK.viewBox,
      'the upstream viewBox is preserved');
    assert.equal(vector.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
    assert.equal(vector.getAttribute('aria-hidden'), 'true');
    assert.equal(vector.getAttribute('focusable'), 'false');
    const paths = vector.querySelectorAll('path');
    assert.equal(paths.length, YOUTUBE_PREMIUM_WORDMARK.paths.length,
      'every source path is rendered, none is retyped or dropped');
    assert.equal(paths[0].getAttribute('fill'), '#FF0033', 'the red emblem keeps its source paint');
    assert.equal(paths[1].getAttribute('fill'), 'white', 'the play triangle keeps its source paint');
    assert.equal(paths[2].getAttribute('fill'), 'currentColor',
      'lettering follows the native header foreground');
    assert.equal(paths[2].getAttribute('class'), 'ytark-premium-ink');
    assert.equal(paths[0].getAttribute('class'), null);
    assert.equal(paths[0].getAttribute('d'), YOUTUBE_PREMIUM_WORDMARK.paths[0].attributes.d,
      'path data is copied byte for byte from the Wikimedia revision');
    assert.equal(vector.querySelectorAll('text').length, 0,
      'no font-rendered or retyped glyph is used');
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

describe('vector wordmark theming', () => {
  it('paints the lettering with the native dark header foreground and keeps the emblem red', async () => {
    resetDom();
    const { host } = makeLeanbackHost({ color: 'rgb(241, 241, 241)' });
    windowStub.dispatch('pageshow');
    await waitFor(200);
    const mark = wordmarks(host)[0];
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'dark');
    assert.equal(mark.getAttribute('data-ytark-premium-ink'), '#f1f1f1');
    assert.equal(mark.getAttribute('data-ytark-premium-ink-source'), 'header-foreground');
    assert.equal(mark.style.getPropertyValue('color'), '#f1f1f1');
    const vector = vectorOf(host);
    assert.equal(vector.getAttribute('height'), '27px', 'scaled from the header box, not from a font');
    assert.equal(vector.getAttribute('width'), '136.4px', 'the upstream aspect ratio is kept');
    assert.equal(vector.querySelectorAll('path')[0].getAttribute('fill'), '#FF0033');
  });

  it('switches only the lettering ink on a light header', async () => {
    resetDom();
    const { host } = makeLeanbackHost({ color: 'rgb(15, 15, 15)' });
    windowStub.dispatch('pageshow');
    await waitFor(200);
    const mark = wordmarks(host)[0];
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'light');
    assert.equal(mark.getAttribute('data-ytark-premium-ink'), '#0f0f0f');
    const paths = vectorOf(host).querySelectorAll('path');
    assert.equal(paths[0].getAttribute('fill'), '#FF0033', 'the red emblem is never inverted');
    assert.equal(paths[1].getAttribute('fill'), 'white', 'the triangle stays white in both themes');
    assert.equal(paths[2].getAttribute('fill'), 'currentColor');
  });

  it('follows an app theme override before the OS colour preference', async () => {
    resetDom();
    windowStub.setColorScheme('light');
    doc.documentElement.setAttribute('class', 'ytlr-dark-mode');
    const { host } = makeLeanbackHost({ color: '' });
    windowStub.dispatch('pageshow');
    await waitFor(200);
    const mark = wordmarks(host)[0];
    assert.equal(mark.getAttribute('data-ytark-premium-ink-source'), 'app-theme');
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'dark');
    assert.equal(mark.getAttribute('data-ytark-premium-ink'), '#f1f1f1');

    windowStub.setColorScheme('dark');
    doc.documentElement.setAttribute('class', 'ytlr-light-mode');
    refreshInk(doc);
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'light',
      'the app theme keeps priority over prefers-color-scheme');
    doc.documentElement.removeAttribute('class');
  });

  it('re-arms the theme watchers after a pagehide/pageshow cycle', async () => {
    resetDom();
    windowStub.setColorScheme('dark');
    const { host } = makeLeanbackHost({ color: '' });
    windowStub.dispatch('pageshow');
    await waitFor(200);
    let mark = wordmarks(host)[0];
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'dark');

    // cleanup() releases the theme watchers; the reload-free return must arm
    // them again so a later theme switch still repaints the lettering.
    windowStub.dispatch('pagehide');
    assert.equal(wordmarks(host).length, 0);
    windowStub.dispatch('pageshow');
    await waitFor(200);
    mark = wordmarks(host)[0];
    assert.ok(mark, 'the wordmark is mounted again after the return');
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'dark');

    windowStub.setColorScheme('light');
    await waitFor(200);
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'light',
      'the re-armed watcher still follows an OS theme change');
    assert.equal(wordmarks(host).length, 1, 'without duplicating the wordmark');
  });

  it('uses prefers-color-scheme only as a fallback', async () => {
    resetDom();
    windowStub.setColorScheme('dark');
    const { host } = makeLeanbackHost({ color: '' });
    windowStub.dispatch('pageshow');
    await waitFor(200);
    const mark = wordmarks(host)[0];
    assert.equal(mark.getAttribute('data-ytark-premium-ink-source'), 'prefers-color-scheme');
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'dark');

    windowStub.setColorScheme('light');
    await waitFor(200);
    assert.equal(mark.getAttribute('data-ytark-premium-ink-source'), 'prefers-color-scheme');
    assert.equal(mark.getAttribute('data-ytark-premium-theme'), 'light',
      'an OS theme change re-applies the ink without a reload');
    assert.equal(wordmarks(host).length, 1, 'and never duplicates the wordmark');
  });
});
