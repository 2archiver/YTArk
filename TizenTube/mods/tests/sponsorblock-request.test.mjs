// SponsorBlock is optional: lookups must be bounded in both the request and
// the body read, must only apply segments for the exact video requested, must
// never seek outside playable media, and must degrade to "no segments" on any
// failure so normal playback continues.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  FakeMutationObserver,
  createDocument,
  createLocalStorage,
  createWindowStub,
  installGlobals,
} from './helpers/fake-dom.mjs';

const localStorage = createLocalStorage({
  'ytaf-configuration': JSON.stringify({ enableSponsorBlockToasts: false }),
});
const doc = createDocument();
const windowStub = createWindowStub({ localStorage, doc });
installGlobals({ doc, windowStub, localStorage });
// The handler module syncs the current route on import; give it a non-video route.
if (typeof globalThis.location === 'undefined') {
  Object.defineProperty(globalThis, 'location', {
    value: { hash: '', href: 'https://www.youtube.com/tv' }, configurable: true, writable: true,
  });
}

const {
  fetchSkipSegments,
  finiteTime,
  segmentsForVideo,
  skipTargetFor,
  validSegments,
  SPONSORBLOCK_TIMEOUT_MS,
} = await import('../features/sponsorblockRequest.js');
const { SponsorBlockHandler } = await import('../features/sponsorblock.js');

const API = 'https://sponsor.ajay.app/api';
const VIDEO = 'abc123DEF45';
const CATEGORIES = ['sponsor', 'intro'];
const never = () => new Promise(() => {});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Record every timer created and cleared while a test runs.
function trackTimers() {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const live = new Set();
  globalThis.setTimeout = (fn, ms, ...args) => {
    const handle = realSet(fn, ms, ...args);
    live.add(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    live.delete(handle);
    return realClear(handle);
  };
  return {
    live,
    restore() {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function options(fetchImpl, extra = {}) {
  return { api: API, videoID: VIDEO, hash: 'ab12', categories: CATEGORIES, fetchImpl, ...extra };
}

describe('finiteTime', () => {
  it('accepts only finite, non-negative JSON numbers', () => {
    assert.equal(finiteTime(0), 0);
    assert.equal(finiteTime(12.5), 12.5);
    for (const bad of [null, undefined, true, false, '', '5', ' 5', '0x10', NaN, Infinity, -Infinity, -1, [], {}]) {
      assert.equal(finiteTime(bad), null, `rejects ${JSON.stringify(bad)}`);
    }
  });
});

describe('validSegments', () => {
  it('drops null, boolean, string and negative values instead of coercing them', () => {
    const kept = validSegments([
      { category: 'sponsor', segment: [null, 5] },
      { category: 'sponsor', segment: [true, 9] },
      { category: 'sponsor', segment: ['10', '20'] },
      { category: 'sponsor', segment: [-10, -1] },
      { category: 'sponsor', segment: [5, 2] },
      { category: 'sponsor', segment: [1, 1] },
      { category: 'sponsor', segment: [1] },
      { segment: [1, 2] },
      null,
    ]);
    assert.deepEqual(kept, []);
  });

  it('keeps valid forward ranges and preserves their identifiers', () => {
    const kept = validSegments([{ category: 'sponsor', UUID: 'u1', segment: [10, 20] }]);
    assert.deepEqual(kept, [{ category: 'sponsor', UUID: 'u1', segment: [10, 20] }]);
  });

  it('keeps poi_highlight as a point and never as a range', () => {
    const kept = validSegments([
      { category: 'poi_highlight', segment: [42, 42] },
      { category: 'poi_highlight', segment: [40, 50] },
      { category: 'sponsor', segment: [42, 42] },
    ]);
    assert.deepEqual(kept, [{ category: 'poi_highlight', segment: [42, 42] }]);
  });
});

describe('skipTargetFor', () => {
  const sponsor = (start, end) => ({ category: 'sponsor', segment: [start, end] });

  it('returns a target only for an in-bounds range of finite media', () => {
    assert.deepEqual(skipTargetFor(sponsor(10, 20), 100), { start: 10, end: 20 });
    assert.deepEqual(skipTargetFor(sponsor(10, 100), 100), { start: 10, end: 100 });
  });

  it('refuses out-of-duration, live and unknown-duration media', () => {
    assert.equal(skipTargetFor(sponsor(10, 120), 100), null, 'end past duration');
    assert.equal(skipTargetFor(sponsor(100, 110), 100), null, 'start at or past duration');
    assert.equal(skipTargetFor(sponsor(10, 20), Infinity), null, 'live stream');
    assert.equal(skipTargetFor(sponsor(10, 20), NaN), null, 'duration not known');
    assert.equal(skipTargetFor(sponsor(10, 20), 0), null, 'empty media');
  });

  it('never produces a seek target for a point highlight', () => {
    assert.equal(skipTargetFor({ category: 'poi_highlight', segment: [30, 30] }, 100), null);
  });
});

describe('segmentsForVideo', () => {
  it('ignores results for other videos', () => {
    const outcome = segmentsForVideo([
      { videoID: 'otherVideo1', segments: [{ category: 'sponsor', segment: [1, 9] }] },
    ], VIDEO);
    assert.deepEqual(outcome, { ok: true, segments: [], reason: 'none' });
  });

  it('applies only the matching video segments', () => {
    const outcome = segmentsForVideo([
      { videoID: 'otherVideo1', segments: [{ category: 'sponsor', segment: [1, 9] }] },
      { videoID: VIDEO, segments: [{ category: 'sponsor', segment: [5, 15] }] },
    ], VIDEO);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.reason, 'found');
    assert.deepEqual(outcome.segments, [{ category: 'sponsor', segment: [5, 15] }]);
  });

  it('reports a non-array body as malformed', () => {
    assert.deepEqual(segmentsForVideo({ error: 'nope' }, VIDEO), { ok: false, reason: 'malformed' });
  });
});

describe('fetchSkipSegments: deadline and cleanup', () => {
  afterEach(() => { FakeMutationObserver.reset(); });

  it('requests the hash prefix with URL-encoded categories and clears its timer on success', async () => {
    const timers = trackTimers();
    try {
      let requested = '';
      const outcome = await fetchSkipSegments(options(async (url) => {
        requested = url;
        return jsonResponse([{ videoID: VIDEO, segments: [{ category: 'sponsor', segment: [2, 4] }] }]);
      }));
      assert.equal(requested,
        `${API}/skipSegments/ab12?categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}`);
      assert.deepEqual(outcome.segments, [{ category: 'sponsor', segment: [2, 4] }]);
      assert.equal(timers.live.size, 0, 'the deadline timer is cleared on success');
    } finally {
      timers.restore();
    }
  });

  it('treats HTTP 404 as a normal "no segments" answer, not a service error', async () => {
    const outcome = await fetchSkipSegments(options(async () => jsonResponse({}, 404)));
    assert.deepEqual(outcome, { ok: true, segments: [], reason: 'none' });
  });

  it('reports other HTTP errors as failures', async () => {
    const outcome = await fetchSkipSegments(options(async () => jsonResponse({}, 503)));
    assert.deepEqual(outcome, { ok: false, reason: 'http', status: 503 });
  });

  it('settles on the deadline when the controller is present and fetch ignores the signal', async () => {
    const timers = trackTimers();
    try {
      const started = Date.now();
      const outcome = await fetchSkipSegments(options(() => never(), { timeoutMs: 30 }));
      assert.deepEqual(outcome, { ok: false, reason: 'timeout' });
      assert.ok(Date.now() - started < 2000, 'the lookup gives up promptly');
      assert.equal(timers.live.size, 0);
    } finally {
      timers.restore();
    }
  });

  it('settles on the deadline when AbortController is absent', async () => {
    const realController = globalThis.AbortController;
    globalThis.AbortController = undefined;
    try {
      let receivedSignal = 'not-called';
      const outcome = await fetchSkipSegments(options((url, init) => {
        receivedSignal = init;
        return never();
      }, { timeoutMs: 30 }));
      assert.deepEqual(outcome, { ok: false, reason: 'timeout' });
      assert.equal(receivedSignal, undefined, 'no signal is passed without a controller');
    } finally {
      globalThis.AbortController = realController;
    }
  });

  it('aborts the request through the controller when it is available', async () => {
    let aborted = false;
    const outcome = await fetchSkipSegments(options((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }), { timeoutMs: 20 }));
    assert.deepEqual(outcome, { ok: false, reason: 'timeout' });
    assert.equal(aborted, true, 'best-effort cancellation is requested at the deadline');
  });

  it('settles on the deadline when the JSON body never finishes', async () => {
    const timers = trackTimers();
    try {
      const outcome = await fetchSkipSegments(options(async () => ({
        ok: true,
        status: 200,
        json: () => never(),
      }), { timeoutMs: 30 }));
      assert.deepEqual(outcome, { ok: false, reason: 'timeout' });
      assert.equal(timers.live.size, 0);
    } finally {
      timers.restore();
    }
  });

  it('absorbs a late rejection without an unhandled-rejection event', async () => {
    const unhandled = [];
    const listener = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const outcome = await fetchSkipSegments(options(() => new Promise((resolve, reject) => {
        setTimeout(() => reject(new TypeError('late failure')), 40);
      }), { timeoutMs: 10 }));
      assert.deepEqual(outcome, { ok: false, reason: 'timeout' });
      await sleep(80);
      assert.deepEqual(unhandled, [], 'the late rejection is absorbed');
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('turns a rejected request and a missing response into network-class failures', async () => {
    assert.deepEqual(await fetchSkipSegments(options(async () => { throw new TypeError('Failed to fetch'); })),
      { ok: false, reason: 'network' });
    assert.deepEqual(await fetchSkipSegments(options(async () => undefined)),
      { ok: false, reason: 'network' });
  });

  it('reports an unavailable fetch without throwing', async () => {
    assert.deepEqual(await fetchSkipSegments(options(undefined)), { ok: false, reason: 'unavailable' });
  });

  it('uses a bounded default timeout', () => {
    assert.ok(SPONSORBLOCK_TIMEOUT_MS > 0 && SPONSORBLOCK_TIMEOUT_MS <= 15000);
  });
});

describe('SponsorBlockHandler lifecycle', () => {
  const realFetch = globalThis.fetch;
  let handler = null;

  afterEach(() => {
    if (handler) handler.destroy();
    handler = null;
    globalThis.fetch = realFetch;
  });

  function responseFor(videoID, segments) {
    return jsonResponse([{ videoID, segments }]);
  }

  it('discards a response that arrives after the handler was destroyed', async () => {
    globalThis.fetch = async () => {
      await sleep(20);
      return responseFor(VIDEO, [{ category: 'sponsor', segment: [5, 15] }]);
    };
    handler = new SponsorBlockHandler(VIDEO, { timeoutMs: 1000 });
    const pending = handler.init();
    handler.destroy();
    await pending;
    assert.equal(handler.segments, null, 'a stale response never applies to a destroyed handler');
  });

  it('settles and stays silent when the lookup hangs past the deadline', async () => {
    globalThis.fetch = () => never();
    handler = new SponsorBlockHandler(VIDEO, { timeoutMs: 25 });
    await handler.init();
    assert.equal(handler.segments, null);
  });

  it('applies valid ranges and point highlights, and drops malformed entries', async () => {
    globalThis.fetch = async () => responseFor(VIDEO, [
      { category: 'sponsor', UUID: 'a', segment: [5, 15] },
      { category: 'sponsor', UUID: 'b', segment: [-3, 2] },
      { category: 'poi_highlight', UUID: 'c', segment: [30, 30] },
      { category: 'sponsor', UUID: 'd', segment: ['1', '2'] },
    ]);
    handler = new SponsorBlockHandler(VIDEO, { timeoutMs: 1000 });
    await handler.init();
    assert.deepEqual(handler.segments.map(s => s.UUID), ['a', 'c']);
  });
});

describe('scheduleSkip safety', () => {
  function fakeVideo(duration, currentTime = 0) {
    const state = { seeks: [], currentTime, duration, paused: false };
    const video = {
      paused: false,
      duration,
      get currentTime() { return state.currentTime; },
      set currentTime(value) { state.seeks.push(value); state.currentTime = value; },
      addEventListener() {},
      removeEventListener() {},
    };
    return { video, state };
  }

  function handlerWith(video, segments, categories = ['sponsor']) {
    const handler = new SponsorBlockHandler(VIDEO);
    handler.video = video;
    handler.segments = segments;
    handler.skippableCategories = categories;
    handler.manualSkippableCategories = [];
    return handler;
  }

  it('seeks to a valid in-bounds range once, and never re-seeks it', async () => {
    const { video, state } = fakeVideo(100, 0);
    const handler = handlerWith(video, [{ category: 'sponsor', UUID: 'x', segment: [0.01, 10] }]);
    handler.scheduleSkip();
    await sleep(60);
    assert.deepEqual(state.seeks, [10], 'one seek to the end of the range');

    // A late timeupdate at the same position must not seek the range again.
    handler.scheduleSkip();
    await sleep(60);
    assert.deepEqual(state.seeks, [10]);
    handler.destroy();
  });

  it('never seeks to a range that runs past the media duration', async () => {
    const { video, state } = fakeVideo(100, 0);
    const handler = handlerWith(video, [{ category: 'sponsor', UUID: 'y', segment: [0.01, 150] }]);
    handler.scheduleSkip();
    await sleep(60);
    assert.deepEqual(state.seeks, []);
    handler.destroy();
  });

  it('does not let a point highlight block a later valid skip', async () => {
    const { video, state } = fakeVideo(100, 0);
    const handler = handlerWith(video, [
      { category: 'poi_highlight', UUID: 'h', segment: [0.005, 0.005] },
      { category: 'sponsor', UUID: 's', segment: [0.02, 5] },
    ]);
    handler.scheduleSkip();
    await sleep(60);
    assert.deepEqual(state.seeks, [5], 'the sponsor range is still skipped');
    handler.destroy();
  });

  it('never seeks in live or unknown-duration media', async () => {
    const { video, state } = fakeVideo(Infinity, 0);
    const handler = handlerWith(video, [{ category: 'sponsor', UUID: 'l', segment: [0.01, 10] }]);
    handler.scheduleSkip();
    await sleep(60);
    assert.deepEqual(state.seeks, []);
    handler.destroy();
  });
});
