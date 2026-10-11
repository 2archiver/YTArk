// "Hide channel watermark": renderer-level removal with recoverable originals,
// and the player-scoped DOM safety net (features/playerWatermark.js).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement } from './helpers/fake-dom.mjs';
import { setupEnvironment, tick } from './helpers/ytlr-harness.mjs';

const { doc, windowStub } = setupEnvironment();
const { configWrite, configChangeEmitter } = await import('../config.js');
const watermark = await import('../features/playerWatermark.js');
const { WATERMARK_ATTRIBUTE } = await import('../ui/appearanceStyles.js');

const URL_A = 'https://i.ytimg.com/an/pqtrbu8Q0EppLzeGZbE7ww/featured_channel.jpg?v=5fbd8df4';
const URL_B = 'https://i.ytimg.com/an/otherChannel/featured_channel.jpg?v=1';

function featuredChannel(url = URL_A) {
  return {
    playerAnnotationsExpandedRenderer: {
      featuredChannel: {
        startTimeMs: '0',
        endTimeMs: '978000',
        watermark: { thumbnails: [{ url, width: 40, height: 40 }] },
        navigationEndpoint: { browseEndpoint: { browseId: 'UCpqtrbu8Q0EppLzeGZbE7ww' } },
        channelName: 'Example',
      },
      annotationId: 'abc',
    },
  };
}

const otherAnnotation = () => ({ playerAnnotationsExpandedRenderer: { annotationId: 'cards-only' } });

function playerResponse(url) {
  return { videoDetails: { videoId: 'v1' }, annotations: [otherAnnotation(), featuredChannel(url)] };
}

function el(tag, attributes = {}, parent = null) {
  const node = new FakeElement(tag, doc);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (parent) parent.appendChild(node);
  return node;
}

/** A watch page with a rendered watermark next to other overlays. */
function buildPlayer({ watermarkUrl = URL_A } = {}) {
  for (const child of [...doc.body.children]) child.detach();
  const page = el('ytlr-watch-default', { hybridnavfocusable: 'true' }, doc.body);
  const video = el('video', {}, page);
  const overlays = el('div', { class: 'overlays' }, page);
  const wrapper = el('div', { tabindex: '0', role: 'button' }, overlays);
  const thumb = el('ytlr-thumbnail-details', {}, wrapper);
  thumb.style.setProperty('background-image', `url("${watermarkUrl}")`);
  const skip = el('button', { tabindex: '0' }, overlays);
  skip.textContent = 'Skip';
  const captions = el('div', { class: 'caption-window' }, page);
  captions.textContent = 'Subtitle text';
  const progress = el('ytlr-progress-bar', { hybridnavfocusable: 'true' }, page);
  // Outside the player: a feed avatar and the Premium header artwork.
  const feedAvatar = el('ytlr-thumbnail-details', { class: 'avatar' }, doc.body);
  feedAvatar.style.setProperty('background-image', 'url("https://yt3.ggpht.com/avatar=s88")');
  const header = el('ytlr-logo-entity', {}, doc.body);
  const headerArt = el('ytlr-thumbnail-details', {}, header);
  headerArt.style.setProperty('background-image', 'url("https://i.ytimg.com/youtube_logo.png")');
  return { page, video, overlays, wrapper, thumb, skip, captions, progress, feedAvatar, header, headerArt };
}

beforeEach(() => {
  configWrite('hidePlayerWatermark', false);
  watermark.resetWatermarkStateForTests();
});

describe('renderer-level removal', () => {
  it('removes only the featuredChannel annotation and keeps a recoverable original', () => {
    const response = playerResponse();
    const removed = watermark.filterWatermarkAnnotations(response, true);
    assert.equal(removed, 1);
    assert.deepEqual(response.annotations, [otherAnnotation()]);
    assert.equal(response.__ytarkHiddenAnnotations.length, 1);
    assert.equal(Object.keys(response).includes('__ytarkHiddenAnnotations'), false, 'the original is not enumerable');
    assert.doesNotMatch(JSON.stringify(response), /featured_channel/);
  });

  it('leaves responses alone while the setting is off and handles nested player responses', () => {
    const response = playerResponse();
    assert.equal(watermark.filterWatermarkAnnotations(response, false), 0);
    assert.equal(response.annotations.length, 2);
    const nested = { playerResponse: playerResponse(URL_B) };
    assert.equal(watermark.filterWatermarkAnnotations(nested, true), 1);
    assert.equal(nested.playerResponse.annotations.length, 1);
  });

  it('strips cached responses when turned on and restores them in place when turned off', () => {
    const cached = playerResponse();
    watermark.filterWatermarkAnnotations(cached, false);
    configWrite('hidePlayerWatermark', true);
    assert.deepEqual(cached.annotations, [otherAnnotation()]);
    configWrite('hidePlayerWatermark', false);
    assert.equal(cached.annotations.length, 2);
    assert.ok(watermark.isFeaturedChannelAnnotation(cached.annotations[1]), 'restored at its original index');
    watermark.restoreWatermarkAnnotations();
    assert.equal(cached.annotations.length, 2, 'restoring twice never duplicates');
  });

  it('does nothing when a video has no watermark or the data is malformed', () => {
    for (const response of [
      {}, { annotations: [] }, { annotations: 'x' }, { annotations: [null, 3, {}] },
      { annotations: [{ playerAnnotationsExpandedRenderer: { featuredChannel: { watermark: 'bad' } } }] },
      { playerResponse: 'not an object' },
    ]) {
      assert.doesNotThrow(() => watermark.filterWatermarkAnnotations(response, true));
    }
    assert.deepEqual(watermark.knownWatermarkUrls(), []);
  });
});

describe('player-scoped DOM safety net', () => {
  it('hides only the watermark inside the player when turned on mid-video', () => {
    watermark.filterWatermarkAnnotations(playerResponse(), false);
    const dom = buildPlayer();
    configWrite('hidePlayerWatermark', true);
    assert.equal(dom.wrapper.getAttribute(WATERMARK_ATTRIBUTE), 'hidden');
    assert.equal(dom.wrapper.getAttribute('aria-hidden'), 'true');
    assert.equal(dom.wrapper.getAttribute('tabindex'), '-1', 'the invisible focus/click target is removed');
    for (const untouched of [dom.overlays, dom.skip, dom.captions, dom.video, dom.progress, dom.page,
      dom.feedAvatar, dom.header, dom.headerArt]) {
      assert.equal(untouched.getAttribute(WATERMARK_ATTRIBUTE), null);
      assert.notEqual(untouched.getAttribute('aria-hidden'), 'true');
    }
    assert.equal(dom.skip.getAttribute('tabindex'), '0');
  });

  it('moves focus from a focused watermark to a visible player control', () => {
    watermark.filterWatermarkAnnotations(playerResponse(), false);
    const dom = buildPlayer();
    dom.wrapper.focus();
    configWrite('hidePlayerWatermark', true);
    assert.notEqual(doc.activeElement, dom.wrapper);
    assert.ok([dom.skip, dom.page, dom.progress].includes(doc.activeElement), 'focus lands on a player control');
  });

  it('restores visibility, focusability and accessibility exactly on disable', () => {
    watermark.filterWatermarkAnnotations(playerResponse(), false);
    const dom = buildPlayer();
    configWrite('hidePlayerWatermark', true);
    configWrite('hidePlayerWatermark', false);
    assert.equal(dom.wrapper.getAttribute(WATERMARK_ATTRIBUTE), null);
    assert.equal(dom.wrapper.getAttribute('aria-hidden'), null);
    assert.equal(dom.wrapper.getAttribute('tabindex'), '0');
    assert.equal(watermark.hiddenHostCount(), 0);
  });

  it('releases a recycled node that no longer shows the watermark', async () => {
    watermark.filterWatermarkAnnotations(playerResponse(), false);
    const dom = buildPlayer();
    configWrite('hidePlayerWatermark', true);
    assert.equal(watermark.hiddenHostCount(), 1);
    dom.thumb.style.setProperty('background-image', 'url("https://i.ytimg.com/vi/next/hq.jpg")');
    windowStub.dispatch('hashchange');
    await tick();
    assert.equal(watermark.hiddenHostCount(), 0);
    assert.equal(dom.wrapper.getAttribute(WATERMARK_ATTRIBUTE), null);
  });

  it('is a safe no-op when the frontend draws no watermark', () => {
    watermark.filterWatermarkAnnotations(playerResponse(), false);
    const dom = buildPlayer({ watermarkUrl: 'https://i.ytimg.com/vi/unrelated/hq.jpg' });
    configWrite('hidePlayerWatermark', true);
    assert.equal(watermark.hiddenHostCount(), 0);
    assert.equal(dom.wrapper.getAttribute(WATERMARK_ATTRIBUTE), null);
  });

  it('does not accumulate state, attributes or listeners over repeated cycles', () => {
    watermark.filterWatermarkAnnotations(playerResponse(), false);
    const dom = buildPlayer();
    const listeners = configChangeEmitter.listenerCount('configChange');
    for (let index = 0; index < 25; index += 1) {
      configWrite('hidePlayerWatermark', true);
      configWrite('hidePlayerWatermark', false);
    }
    configWrite('hidePlayerWatermark', true);
    assert.equal(watermark.hiddenHostCount(), 1);
    assert.equal(dom.wrapper.getAttribute('tabindex'), '-1');
    configWrite('hidePlayerWatermark', false);
    assert.equal(dom.wrapper.getAttribute('tabindex'), '0');
    assert.equal(configChangeEmitter.listenerCount('configChange'), listeners);
  });
});
