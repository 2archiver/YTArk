// DeArrow reliability for the cases the field report called out:
// a late branding result must never rename a tile the frontend has
// since recycled to show another video, prefix lookups stay
// prefix-only, and disabling is immediate. Branding is applied to
// the response data before the app receives it, so each response is
// branded independently and a slow bucket can only affect responses
// still waiting on it. (features/dearrowBranding.js)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  BRANDING_API,
  createBrandingService,
  createResponseBrander,
  installDeArrowFetchBoundary,
} from '../features/dearrowBranding.js';
import { parseWithoutHooks } from '../utils/rawJson.js';

const ID_X = 'dQw4w9WgXcQ'; // prefix 5f6b
const ID_Y = 'aqz-KE-bpKQ'; // prefix 671e

function deferred() {
  let resolve; const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function sha256Prefix(id) { return createHash('sha256').update(id).digest('hex').substring(0, 4); }
function trusted(extra) { return { votes: 3, locked: false, original: false, UUID: 'u', ...extra }; }

function tileFixture(videoID, title) {
  return {
    tileRenderer: {
      contentId: videoID,
      onSelectCommand: { watchEndpoint: { videoId: videoID } },
      metadata: { tileMetadataRenderer: { title: { simpleText: title } } },
      header: { tileHeaderRenderer: { thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`, width: 480, height: 360 }] } } },
    },
  };
}
function browsePayload(tiles) {
  return { contents: { sectionListRenderer: { contents: [{ shelfRenderer: { content: { horizontalListRenderer: { items: tiles } } } }] } } };
}
function tileTitle(payload) {
  return payload.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items[0]
    .tileRenderer.metadata.tileMetadataRenderer.title.simpleText;
}

describe('DeArrow late results and recycled tiles', () => {
  it('never renames a recycled tile with a late result for another video', async () => {
    const xGate = deferred();
    const brandingCalls = [];
    const service = createBrandingService({
      fetchImpl: async (url) => {
        brandingCalls.push(String(url));
        // X's bucket is slow; every other bucket answers at once.
        if (url.endsWith(sha256Prefix(ID_X))) {
          await xGate.promise;
          return jsonResponse({ [ID_X]: { titles: [trusted({ title: 'Late X title' })], thumbnails: [] } });
        }
        return jsonResponse({ [ID_Y]: { titles: [trusted({ title: 'Honest Y title' })], thumbnails: [] } });
      },
    });
    const brander = createResponseBrander({
      service, parseWithoutHooks, isEnabled: () => true, thumbnailsEnabled: () => false, budgetMs: 40,
    });

    let liveResponse = browsePayload([tileFixture(ID_X, 'Original X')]);
    const target = { fetch: async () => jsonResponse(liveResponse) };
    installDeArrowFetchBoundary(target, { brander, isEnabled: () => true, service });

    // 1. The first browse is held only for the budget. X's slow
    //    bucket does not arrive in time, so the tile keeps its
    //    original title and the request keeps running in the
    //    background.
    const first = await target.fetch('https://www.youtube.com/youtubei/v1/browse');
    assert.equal(tileTitle(await first.json()), 'Original X');

    // 2. The frontend recycles the tile to show a different video:
    //    a fresh response. Y's bucket answers immediately, so the
    //    recycled tile is branded with Y's own title.
    liveResponse = browsePayload([tileFixture(ID_Y, 'Original Y')]);
    const second = await target.fetch('https://www.youtube.com/youtubei/v1/browse');
    const secondBody = await second.json();
    assert.equal(tileTitle(secondBody), 'Honest Y title');

    // 3. X's late result finally arrives and fills the cache. It
    //    must not reach back and rename the tile that is already
    //    rendering Y's branded data.
    xGate.resolve();
    await service.lookup([ID_X]); // drain the late result into the cache
    assert.equal(tileTitle(secondBody), 'Honest Y title', 'the recycled tile keeps Y\'s title');

    // 4. A later response that shows X again reuses the cached,
    //    late-arrived branding; the cache is simply populated.
    liveResponse = browsePayload([tileFixture(ID_X, 'Original X again')]);
    const third = await target.fetch('https://www.youtube.com/youtubei/v1/browse');
    assert.equal(tileTitle(await third.json()), 'Late X title');

    // Both lookups used the documented hash-prefix endpoint only.
    assert.deepEqual(brandingCalls.map(url => url.slice(-4)).sort(), ['5f6b', '671e']);
  });

  it('keeps lookups prefix-only and never falls back to a full video ID', async () => {
    const urls = [];
    const service = createBrandingService({
      fetchImpl: async url => { urls.push(String(url)); return jsonResponse({}); },
    });
    await service.lookup([ID_X, ID_Y]);
    assert.equal(urls.length, 2);
    for (const url of urls) {
      assert.equal(url, `${BRANDING_API}/${url.slice(-4)}`);
      assert.match(url, /\/[0-9a-f]{4}$/, 'a four-character hash prefix, nothing longer');
      assert.equal(url.includes(ID_X) || url.includes(ID_Y), false, 'no full video id is ever sent');
      assert.equal(url.includes('videoID='), false, 'no full-id query fallback');
    }
  });

  it('stops applying branding the moment DeArrow is switched off, including in-flight work', async () => {
    const gate = deferred();
    const service = createBrandingService({
      fetchImpl: async () => { await gate.promise; return jsonResponse({ [ID_X]: { titles: [trusted({ title: 'too late' })], thumbnails: [] } }); },
    });
    const state = { enabled: true };
    const brander = createResponseBrander({
      service, parseWithoutHooks, isEnabled: () => state.enabled, thumbnailsEnabled: () => false, budgetMs: 5000,
    });
    const target = { fetch: async () => jsonResponse(browsePayload([tileFixture(ID_X, 'Original X')])) };
    installDeArrowFetchBoundary(target, { brander, isEnabled: () => state.enabled, service });

    // A request that was already in flight when DeArrow is switched
    // off must not be applied: the live `isEnabled()` check at the
    // response boundary discards it.
    const pending = target.fetch('https://www.youtube.com/youtubei/v1/browse');
    state.enabled = false;
    gate.resolve();
    const body = await (await pending).json();
    assert.equal(tileTitle(body), 'Original X', 'a result that lands after disable is discarded');

    // And a fresh request while it is off makes no branding request
    // at all and passes the response through untouched.
    let brandingCalls = 0;
    const offService = createBrandingService({ fetchImpl: async () => { brandingCalls++; return jsonResponse({}); } });
    const offBrander = createResponseBrander({
      service: offService, parseWithoutHooks, isEnabled: () => false, thumbnailsEnabled: () => false,
    });
    const offTarget = { fetch: async () => jsonResponse(browsePayload([tileFixture(ID_X, 'Original X')])) };
    installDeArrowFetchBoundary(offTarget, { brander: offBrander, isEnabled: () => false, service: offService });
    const passthrough = await offTarget.fetch('https://www.youtube.com/youtubei/v1/browse');
    assert.equal(tileTitle(await passthrough.json()), 'Original X');
    assert.equal(brandingCalls, 0, 'no branding request is made while DeArrow is off');
  });
});
