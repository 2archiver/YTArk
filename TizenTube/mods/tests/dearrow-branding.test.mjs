// DeArrow branding: lookups must use the documented hash-prefix endpoint, apply
// only trusted server-ordered candidates, cache and de-duplicate bucket requests,
// and deliver branded data through a response boundary that never changes a
// response after the app has received it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  BRANDING_API,
  THUMBNAIL_API,
  applyBranding,
  brandingPrefix,
  collectVideoTiles,
  createBrandingService,
  createResponseBrander,
  installDeArrowFetchBoundary,
  isDeArrowThumbnailUrl,
  isInspectableUrl,
  selectThumbnailTimestamp,
  selectTitle,
  thumbnailUrl,
} from '../features/dearrowBranding.js';
import { parseWithoutHooks, jsonHooksSuppressed } from '../utils/rawJson.js';

const ID_A = 'dQw4w9WgXcQ';
const ID_B = 'aqz-KE-bpKQ';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sha256Prefix(id) {
  return createHash('sha256').update(id).digest('hex').substring(0, 4);
}

function trusted(extra) {
  return { votes: 3, locked: false, original: false, UUID: 'u', ...extra };
}

function tileFixture(videoID, title = 'Clickbait!!!') {
  return {
    tileRenderer: {
      contentId: videoID,
      onSelectCommand: { watchEndpoint: { videoId: videoID } },
      metadata: { tileMetadataRenderer: { title: { simpleText: title } } },
      header: { tileHeaderRenderer: { thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg?sqp=1`, width: 480, height: 360 }] } } },
    },
  };
}

function lockupFixture(videoID, title = 'Clickbait lockup') {
  return {
    lockupViewModel: {
      contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      contentId: videoID,
      metadata: { lockupMetadataViewModel: { title: { content: title } } },
      contentImage: { thumbnailViewModel: { image: { sources: [{ url: `https://i.ytimg.com/vi/${videoID}/hq.jpg` }] } } },
    },
  };
}

function browsePayload(tiles) {
  return { contents: { sectionListRenderer: { contents: [{ shelfRenderer: { content: { horizontalListRenderer: { items: tiles } } } }] } } };
}

describe('DeArrow hash-prefix lookup', () => {
  it('uses the first four hex characters of sha256(videoID)', () => {
    for (const id of [ID_A, ID_B, 'AAAAAAAAAAA']) {
      assert.equal(brandingPrefix(id), sha256Prefix(id));
      assert.match(brandingPrefix(id), /^[0-9a-f]{4}$/);
    }
  });

  it('never sends the full video ID to the branding endpoint', async () => {
    const urls = [];
    const service = createBrandingService({
      fetchImpl: async url => { urls.push(String(url)); return new Response('{}', { status: 200 }); },
    });
    await service.lookup([ID_A]);
    assert.equal(urls.length, 1);
    assert.equal(urls[0], `${BRANDING_API}/${sha256Prefix(ID_A)}`);
    assert.ok(!urls[0].includes(ID_A));
    assert.ok(!urls[0].includes('videoID'));
  });

  it('sends no credentials and no referrer', async () => {
    let init;
    const service = createBrandingService({
      fetchImpl: async (_url, options) => { init = options; return new Response('{}', { status: 200 }); },
    });
    await service.lookup([ID_A]);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
  });

  it('ignores malformed video IDs before any request', async () => {
    let calls = 0;
    const service = createBrandingService({ fetchImpl: async () => { calls++; return new Response('{}'); } });
    const result = await service.lookup(['../etc', 'short', 'x'.repeat(40)]);
    assert.equal(calls, 0);
    assert.equal(result.size, 0);
  });
});

describe('DeArrow selection policy (first server-ordered candidate, trusted, not original)', () => {
  it('takes the first title and drops > formatting markers', () => {
    assert.equal(selectTitle({ titles: [trusted({ title: 'Honest >title' }), trusted({ title: 'Runner-up', votes: 99 })] }), 'Honest title');
  });

  it('does not promote the runner-up when the winner is original', () => {
    assert.equal(selectTitle({ titles: [trusted({ title: 'Me at the zoo', original: true }), trusted({ title: 'Other' })] }), null);
  });

  it('rejects untrusted candidates: votes below zero and not locked', () => {
    assert.equal(selectTitle({ titles: [trusted({ title: 'Bad', votes: -1 })] }), null);
    assert.equal(selectTitle({ titles: [trusted({ title: 'Locked', votes: -5, locked: true })] }), 'Locked');
    assert.equal(selectTitle({ titles: [trusted({ title: 'Zero', votes: 0 })] }), 'Zero');
  });

  it('ignores blank, non-string or missing titles', () => {
    assert.equal(selectTitle({ titles: [trusted({ title: '   ' })] }), null);
    assert.equal(selectTitle({ titles: [trusted({ title: 42 })] }), null);
    assert.equal(selectTitle({ titles: [] }), null);
    assert.equal(selectTitle(undefined), null);
  });

  it('does not select the most-voted title when another ranks first', () => {
    const entry = { titles: [trusted({ title: 'First', votes: 1 }), trusted({ title: 'Most voted', votes: 50 })] };
    assert.equal(selectTitle(entry), 'First');
  });

  it('chooses the first thumbnail timestamp; null timestamps and originals are not replaced', () => {
    assert.equal(selectThumbnailTimestamp({ thumbnails: [trusted({ timestamp: 12.5 })] }), 12.5);
    assert.equal(selectThumbnailTimestamp({ thumbnails: [trusted({ timestamp: null, original: true })] }), null);
    assert.equal(selectThumbnailTimestamp({ thumbnails: [trusted({ timestamp: 3, original: true })] }), null);
    assert.equal(selectThumbnailTimestamp({ thumbnails: [trusted({ timestamp: 3, votes: -2 })] }), null);
    assert.equal(selectThumbnailTimestamp({ thumbnails: [trusted({ timestamp: -1 })] }), null);
  });
});

describe('DeArrow thumbnail URL', () => {
  it('builds a getThumbnail URL with a redirect only to i.ytimg.com', () => {
    const url = thumbnailUrl(ID_A, 12.5, 'https://i.ytimg.com/vi/x/hq.jpg');
    assert.ok(url.startsWith(`${THUMBNAIL_API}?`));
    assert.ok(url.includes('time=12.5'));
    assert.ok(url.includes(`redirectUrl=${encodeURIComponent('https://i.ytimg.com/vi/x/hq.jpg')}`));
    const noRedirect = thumbnailUrl(ID_A, 1, 'https://example.com/x.jpg');
    assert.ok(!noRedirect.includes('redirectUrl'));
    assert.equal(isDeArrowThumbnailUrl(url), true);
    assert.equal(isDeArrowThumbnailUrl('https://i.ytimg.com/vi/x/sddefault.jpg'), false);
  });
});

describe('DeArrow branding cache', () => {
  it('serves repeat lookups from cache until the positive TTL expires', async () => {
    let clock = 0;
    let calls = 0;
    const service = createBrandingService({
      now: () => clock,
      positiveTtlMs: 1000,
      fetchImpl: async () => { calls++; return jsonResponse({ [ID_A]: { titles: [trusted({ title: 'T' })], thumbnails: [] } }); },
    });
    assert.equal((await service.lookup([ID_A])).get(ID_A).titles[0].title, 'T');
    await service.lookup([ID_A]);
    assert.equal(calls, 1);
    clock = 1001;
    await service.lookup([ID_A]);
    assert.equal(calls, 2);
  });

  it('negative-caches a video missing from an answered bucket', async () => {
    let calls = 0;
    const service = createBrandingService({
      fetchImpl: async () => { calls++; return jsonResponse({ [ID_B]: { titles: [trusted({ title: 'other' })] } }); },
    });
    assert.equal((await service.lookup([ID_A])).get(ID_A), null);
    assert.equal((await service.lookup([ID_A])).get(ID_A), null);
    assert.equal(calls, 1);
  });

  it('negative-caches a 404 bucket', async () => {
    let calls = 0;
    const service = createBrandingService({ fetchImpl: async () => { calls++; return new Response('', { status: 404 }); } });
    await service.lookup([ID_A]);
    await service.lookup([ID_A]);
    assert.equal(calls, 1);
  });

  it('backs off after an HTTP error instead of retrying on every page', async () => {
    let clock = 0;
    let calls = 0;
    const service = createBrandingService({
      now: () => clock,
      errorBackoffMs: 500,
      fetchImpl: async () => { calls++; return new Response('', { status: 500 }); },
    });
    assert.equal((await service.lookup([ID_A])).get(ID_A), null);
    await service.lookup([ID_A]);
    assert.equal(calls, 1);
    clock = 600;
    await service.lookup([ID_A]);
    assert.equal(calls, 2);
  });

  it('de-duplicates concurrent lookups for the same bucket', async () => {
    let calls = 0;
    const gate = deferred();
    const service = createBrandingService({
      fetchImpl: async () => { calls++; await gate.promise; return jsonResponse({ [ID_A]: { titles: [trusted({ title: 'once' })] } }); },
    });
    const first = service.lookup([ID_A]);
    const second = service.lookup([ID_A]);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(a.get(ID_A).titles[0].title, 'once');
    assert.equal(b.get(ID_A).titles[0].title, 'once');
  });

  it('times out a stalled request and treats it as no branding', async () => {
    const service = createBrandingService({
      timeoutMs: 20,
      fetchImpl: () => new Promise(() => {}),
    });
    const result = await service.lookup([ID_A]);
    assert.equal(result.get(ID_A), null);
  });

  it('bounds the number of cached buckets', async () => {
    const service = createBrandingService({
      maxPrefixes: 2,
      fetchImpl: async () => jsonResponse({}),
    });
    const ids = [];
    for (let i = 0; ids.length < 3; i++) {
      const candidate = `${String(i).padStart(5, '0')}AAAAAA`.slice(0, 11).replace(/[^A-Za-z0-9_-]/g, 'B');
      if (!ids.some(id => brandingPrefix(id) === brandingPrefix(candidate))) ids.push(candidate);
    }
    for (const id of ids) await service.lookup([id]);
    assert.equal(service._cacheSize(), 2);
  });
});

describe('DeArrow tile application', () => {
  it('replaces tile and lockup titles and thumbnails from branding data', () => {
    const tiles = collectVideoTiles(browsePayload([tileFixture(ID_A), lockupFixture(ID_B)]));
    assert.equal(tiles.length, 2);
    const branding = new Map([
      [ID_A, { titles: [trusted({ title: 'Honest tile' })], thumbnails: [trusted({ timestamp: 7 })] }],
      [ID_B, { titles: [trusted({ title: 'Honest lockup' })], thumbnails: [] }],
    ]);
    assert.equal(applyBranding(tiles, branding, { titles: true, thumbnails: true }), true);
    const tile = tiles.find(t => t.kind === 'tile').item;
    const lockup = tiles.find(t => t.kind === 'lockup').item;
    assert.equal(tile.tileRenderer.metadata.tileMetadataRenderer.title.simpleText, 'Honest tile');
    assert.equal(tile.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.startsWith(THUMBNAIL_API), true);
    assert.equal(lockup.lockupViewModel.metadata.lockupMetadataViewModel.title.content, 'Honest lockup');
    assert.equal(lockup.lockupViewModel.contentImage.thumbnailViewModel.image.sources[0].url, `https://i.ytimg.com/vi/${ID_B}/hq.jpg`);
  });

  it('leaves thumbnails alone when thumbnail replacement is off', () => {
    const tiles = collectVideoTiles(browsePayload([tileFixture(ID_A)]));
    const branding = new Map([[ID_A, { titles: [trusted({ title: 'T' })], thumbnails: [trusted({ timestamp: 1 })] }]]);
    applyBranding(tiles, branding, { titles: true, thumbnails: false });
    assert.equal(tiles[0].item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.includes('hqdefault'), true);
  });

  it('only collects lockups that are videos', () => {
    const shorts = lockupFixture(ID_A);
    shorts.lockupViewModel.contentType = 'LOCKUP_CONTENT_TYPE_SHORT';
    assert.equal(collectVideoTiles(browsePayload([shorts])).length, 0);
  });
});

describe('DeArrow fetch response boundary', () => {
  function setup({ enabled = true, thumbs = false, budgetMs = 2000, brandingFetch }) {
    const state = { enabled, thumbs, brandingCalls: [] };
    const service = createBrandingService({
      fetchImpl: (url, options) => { state.brandingCalls.push(String(url)); return brandingFetch(url, options); },
    });
    const brander = createResponseBrander({
      service,
      parseWithoutHooks,
      isEnabled: () => state.enabled,
      thumbnailsEnabled: () => state.thumbs,
      budgetMs,
    });
    const target = {
      fetch: async () => jsonResponse(browsePayload([tileFixture(ID_A)])),
    };
    installDeArrowFetchBoundary(target, { brander, isEnabled: () => state.enabled, service });
    return { target, state, service };
  }

  it('does not resolve the browse response until the branding response has arrived', async () => {
    const gate = deferred();
    const { target } = setup({
      brandingFetch: async () => { await gate.promise; return jsonResponse({ [ID_A]: { titles: [trusted({ title: 'Delayed honest title' })] } }); },
    });
    let settled = false;
    const pending = target.fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false').then(r => { settled = true; return r; });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(settled, false);
    gate.resolve();
    const response = await pending;
    const body = await response.json();
    assert.equal(body.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items[0].tileRenderer.metadata.tileMetadataRenderer.title.simpleText, 'Delayed honest title');
  });

  it('passes the response through unchanged when DeArrow is off: no branding request, same object', async () => {
    const original = jsonResponse(browsePayload([tileFixture(ID_A)]));
    let brandingCalls = 0;
    const service = createBrandingService({ fetchImpl: async () => { brandingCalls++; return jsonResponse({}); } });
    const brander = createResponseBrander({ service, parseWithoutHooks, isEnabled: () => false, thumbnailsEnabled: () => false });
    const target = { fetch: async () => original };
    installDeArrowFetchBoundary(target, { brander, isEnabled: () => false, service });
    const response = await target.fetch('https://www.youtube.com/youtubei/v1/browse');
    assert.equal(response, original);
    assert.equal(brandingCalls, 0);
  });

  it('ignores requests that are not browse, search or next', async () => {
    const original = jsonResponse(browsePayload([tileFixture(ID_A)]));
    let brandingCalls = 0;
    const service = createBrandingService({ fetchImpl: async () => { brandingCalls++; return jsonResponse({}); } });
    const brander = createResponseBrander({ service, parseWithoutHooks, isEnabled: () => true, thumbnailsEnabled: () => false });
    const target = { fetch: async () => original };
    installDeArrowFetchBoundary(target, { brander, isEnabled: () => true, service });
    const response = await target.fetch('https://www.youtube.com/youtubei/v1/guide');
    assert.equal(response, original);
    assert.equal(brandingCalls, 0);
    assert.equal(isInspectableUrl('http://localhost:8099/youtubei/v1/search?x=1'), true);
    assert.equal(isInspectableUrl('https://www.youtube.com/youtubei/v1/next'), true);
    assert.equal(isInspectableUrl('https://www.youtube.com/youtubei/v1/browsefoo'), false);
  });

  it('keeps the original response when branding is not yet cached and the budget elapses', async () => {
    const { target } = setup({
      budgetMs: 15,
      brandingFetch: () => new Promise(() => {}),
      thumbs: false,
    });
    const response = await target.fetch('https://www.youtube.com/youtubei/v1/browse');
    const body = await response.json();
    assert.equal(body.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items[0].tileRenderer.metadata.tileMetadataRenderer.title.simpleText, 'Clickbait!!!');
  });

  it('discards a branding result that arrives after DeArrow was switched off', async () => {
    const gate = deferred();
    const { target, state } = setup({
      brandingFetch: async () => { await gate.promise; return jsonResponse({ [ID_A]: { titles: [trusted({ title: 'Too late' })] } }); },
    });
    const pending = target.fetch('https://www.youtube.com/youtubei/v1/browse');
    state.enabled = false;
    gate.resolve();
    const response = await pending;
    const body = await response.json();
    assert.equal(body.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items[0].tileRenderer.metadata.tileMetadataRenderer.title.simpleText, 'Clickbait!!!');
  });

  it('applies thumbnail replacement only when enableDeArrowThumbnails is also on', async () => {
    const brandingFetch = async () => jsonResponse({ [ID_A]: { titles: [], thumbnails: [trusted({ timestamp: 4 })] } });
    const off = setup({ thumbs: false, brandingFetch });
    const offBody = await (await off.target.fetch('https://www.youtube.com/youtubei/v1/browse')).json();
    assert.ok(offBody.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items[0].tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.includes('hqdefault'));

    const on = setup({ thumbs: true, brandingFetch });
    const onBody = await (await on.target.fetch('https://www.youtube.com/youtubei/v1/browse')).json();
    const url = onBody.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items[0].tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url;
    assert.ok(isDeArrowThumbnailUrl(url));
    assert.ok(url.includes('time=4'));
  });

  it('returns the original response for malformed JSON', async () => {
    const malformed = new Response('{not json', { status: 200 });
    const service = createBrandingService({ fetchImpl: async () => jsonResponse({}) });
    const brander = createResponseBrander({ service, parseWithoutHooks, isEnabled: () => true, thumbnailsEnabled: () => false });
    const target = { fetch: async () => malformed };
    installDeArrowFetchBoundary(target, { brander, isEnabled: () => true, service });
    const response = await target.fetch('https://www.youtube.com/youtubei/v1/browse');
    assert.equal(response, malformed);
  });

  it('installs once', () => {
    const target = { fetch: async () => new Response('') };
    const service = createBrandingService({ fetchImpl: async () => jsonResponse({}) });
    const brander = createResponseBrander({ service, parseWithoutHooks, isEnabled: () => true, thumbnailsEnabled: () => false });
    assert.equal(installDeArrowFetchBoundary(target, { brander, isEnabled: () => true, service }), true);
    assert.equal(installDeArrowFetchBoundary(target, { brander, isEnabled: () => true, service }), false);
  });
});

describe('raw JSON parse helper', () => {
  it('suppresses the hook flag only for the duration of the call', () => {
    assert.equal(jsonHooksSuppressed(), false);
    assert.deepEqual(parseWithoutHooks('{"a":1}'), { a: 1 });
    assert.equal(jsonHooksSuppressed(), false);
  });
});
