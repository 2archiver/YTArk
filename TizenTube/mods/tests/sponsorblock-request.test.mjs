// SponsorBlock is optional: lookups must be bounded, must only apply segments
// for the exact video requested, and must degrade to "no segments" on any
// failure so playback continues.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  fetchSkipSegments,
  segmentsForVideo,
  validSegments,
  SPONSORBLOCK_TIMEOUT_MS,
} = await import('../features/sponsorblockRequest.js');

const API = 'https://sponsor.ajay.app/api';
const CATEGORIES = ['sponsor', 'intro'];

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function baseOptions(fetchImpl, extra = {}) {
  return {
    api: API,
    videoID: 'abc123DEF45',
    hash: 'ab12',
    categories: CATEGORIES,
    fetchImpl,
    ...extra,
  };
}

describe('validSegments', () => {
  it('keeps only finite forward two-value ranges', () => {
    const kept = validSegments([
      { segment: [10, 20] },
      { segment: [30, 30] },          // zero-length: dropped
      { segment: [50, 40] },          // backwards: dropped
      { segment: ['a', 5] },          // not finite: dropped
      { segment: [1] },               // wrong arity: dropped
      { segment: [60, Infinity] },    // not finite: dropped
      null,
    ]);
    assert.deepEqual(kept, [{ segment: [10, 20] }]);
  });

  it('returns an empty list for a non-array input', () => {
    assert.deepEqual(validSegments(undefined), []);
    assert.deepEqual(validSegments({ segment: [1, 2] }), []);
  });
});

describe('segmentsForVideo', () => {
  it('ignores results for other videos, so stale or mixed responses cannot leak', () => {
    const outcome = segmentsForVideo([
      { videoID: 'otherVideo1', segments: [{ segment: [1, 9] }] },
    ], 'abc123DEF45');
    assert.deepEqual(outcome, { ok: true, segments: [] });
  });

  it('applies only the matching video segments', () => {
    const outcome = segmentsForVideo([
      { videoID: 'otherVideo1', segments: [{ segment: [1, 9] }] },
      { videoID: 'abc123DEF45', segments: [{ segment: [5, 15], category: 'sponsor' }] },
    ], 'abc123DEF45');
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.segments, [{ segment: [5, 15], category: 'sponsor' }]);
  });

  it('reports a non-array body as malformed', () => {
    assert.deepEqual(segmentsForVideo({ error: 'nope' }, 'abc123DEF45'),
      { ok: false, reason: 'malformed' });
  });
});

describe('fetchSkipSegments', () => {
  it('requests the hash prefix with URL-encoded categories and returns segments', async () => {
    let requested = '';
    const outcome = await fetchSkipSegments(baseOptions(async (url) => {
      requested = url;
      return jsonResponse([{ videoID: 'abc123DEF45', segments: [{ segment: [2, 4] }] }]);
    }));
    assert.equal(requested,
      `${API}/skipSegments/ab12?categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}`);
    assert.deepEqual(outcome, { ok: true, segments: [{ segment: [2, 4] }] });
  });

  it('turns an HTTP error into a failure result instead of throwing', async () => {
    const outcome = await fetchSkipSegments(baseOptions(async () => jsonResponse({}, 503)));
    assert.deepEqual(outcome, { ok: false, reason: 'http', status: 503 });
  });

  it('turns unreadable JSON into a network-class failure', async () => {
    const outcome = await fetchSkipSegments(baseOptions(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    })));
    assert.deepEqual(outcome, { ok: false, reason: 'network' });
  });

  it('turns a rejected request into a failure result', async () => {
    const outcome = await fetchSkipSegments(baseOptions(async () => {
      throw new TypeError('Failed to fetch');
    }));
    assert.deepEqual(outcome, { ok: false, reason: 'network' });
  });

  it('aborts a stalled server after the bounded timeout', async () => {
    const started = Date.now();
    const outcome = await fetchSkipSegments(baseOptions(
      (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
      { timeoutMs: 25 },
    ));
    assert.deepEqual(outcome, { ok: false, reason: 'timeout' });
    assert.ok(Date.now() - started < 2000, 'the lookup gives up promptly');
  });

  it('reports an unavailable fetch without throwing', async () => {
    const outcome = await fetchSkipSegments(baseOptions(undefined));
    assert.deepEqual(outcome, { ok: false, reason: 'unavailable' });
  });

  it('uses a bounded default timeout', () => {
    assert.ok(SPONSORBLOCK_TIMEOUT_MS > 0 && SPONSORBLOCK_TIMEOUT_MS <= 15000);
  });
});
