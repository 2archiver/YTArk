// DeArrow (https://dearrow.ajay.app) title and thumbnail replacement.
//
// Design, following the DeArrow API documentation
// (https://wiki.sponsor.ajay.app/w/API_Docs/DeArrow):
//
// * Lookups use the hash-prefix endpoint GET /api/branding/{first 4 hex chars of
//   sha256(videoID)}. The server sees a bucket shared by many videos instead of
//   the video being watched. The full video ID is never sent to sponsor.ajay.app.
// * Responses are used in server order: the first title and the first thumbnail
//   are the candidates. A candidate is applied only when it is trusted
//   (locked === true or votes >= 0) and not marked original. Runner-up
//   submissions are never promoted.
// * Thumbnail images come from dearrow-thumb.ajay.app. That endpoint takes the
//   full video ID, so thumbnail replacement discloses the video ID to that
//   service. It is a separate opt-in (enableDeArrowThumbnails).
// * Branding is applied by a fetch response boundary: the YouTube browse,
//   search and next responses are read and rewritten before the app receives
//   them. JSON.parse stays synchronous. Mounted objects are never mutated after
//   the app has rendered them.
//
// No module-level side effects: everything is created through factories so that
// the tests can drive it with fake fetch and fake timers.

import sha256 from '../tiny-sha256.js';

export const BRANDING_API = 'https://sponsor.ajay.app/api/branding';
export const THUMBNAIL_API = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail';
const I_YTIMG_PREFIX = 'https://i.ytimg.com/';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const INSPECTED_PATH_RE = /\/youtubei\/v1\/(browse|search|next)(?=[/?#]|$)/;
const TIMED_OUT = Symbol('dearrow-budget-exceeded');

export const DEFAULTS = Object.freeze({
  timeoutMs: 3000,           // per prefix request
  budgetMs: 2500,            // max extra delay a single browse response may take
  positiveTtlMs: 30 * 60e3,  // cached branding
  negativeTtlMs: 5 * 60e3,   // bucket answered but this video has no branding
  errorBackoffMs: 60e3,      // network, HTTP or shape failure: do not retry sooner
  maxPrefixes: 64,           // bounded cache (one entry per 4-char bucket)
  maxConcurrent: 8,
});

export function isVideoId(value) {
  return typeof value === 'string' && VIDEO_ID_RE.test(value);
}

/** First four hex characters of sha256(videoID): the bucket sent to the API. */
export function brandingPrefix(videoID) {
  return sha256(videoID).substring(0, 4);
}

/** True for thumbnail URLs produced by applyBranding (used by HQ rewriting). */
export function isDeArrowThumbnailUrl(url) {
  return typeof url === 'string' && url.startsWith(`${THUMBNAIL_API}?`);
}

/** Pick the title to show: first server-ordered submission, trusted and not original. */
export function selectTitle(entry) {
  const first = Array.isArray(entry?.titles) ? entry.titles[0] : undefined;
  if (!first || typeof first !== 'object') return null;
  if (!(first.locked === true || (typeof first.votes === 'number' && first.votes >= 0))) return null;
  if (first.original === true) return null;
  if (typeof first.title !== 'string') return null;
  // The API marks auto-formatter exemptions with '>'; the docs say to drop them.
  const title = first.title.replace(/>/g, '').trim();
  return title || null;
}

/** Pick the thumbnail timestamp: first server-ordered submission, trusted and not original. */
export function selectThumbnailTimestamp(entry) {
  const first = Array.isArray(entry?.thumbnails) ? entry.thumbnails[0] : undefined;
  if (!first || typeof first !== 'object') return null;
  if (!(first.locked === true || (typeof first.votes === 'number' && first.votes >= 0))) return null;
  if (first.original === true) return null;
  if (typeof first.timestamp !== 'number' || !Number.isFinite(first.timestamp) || first.timestamp < 0) return null;
  return first.timestamp;
}

export function thumbnailUrl(videoID, timestamp, originalUrl) {
  const params = [
    `videoID=${encodeURIComponent(videoID)}`,
    `time=${encodeURIComponent(String(timestamp))}`,
  ];
  // The docs require redirectUrl to start with https://i.ytimg.com/ so that the
  // service falls back to YouTube's own image when it cannot generate a frame.
  if (typeof originalUrl === 'string' && originalUrl.startsWith(I_YTIMG_PREFIX)) {
    params.push(`redirectUrl=${encodeURIComponent(originalUrl)}`);
  }
  return `${THUMBNAIL_API}?${params.join('&')}`;
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(onTimeout), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Branding lookups with a bounded cache, negative caching, in-flight
 * de-duplication per bucket and a concurrency cap.
 *
 * lookup(ids) resolves to Map<videoID, entry | null>. It never rejects.
 * snapshot(ids) reads the cache only and never touches the network.
 */
export function createBrandingService(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = () => Date.now(),
    timeoutMs = DEFAULTS.timeoutMs,
    positiveTtlMs = DEFAULTS.positiveTtlMs,
    negativeTtlMs = DEFAULTS.negativeTtlMs,
    errorBackoffMs = DEFAULTS.errorBackoffMs,
    maxPrefixes = DEFAULTS.maxPrefixes,
    maxConcurrent = DEFAULTS.maxConcurrent,
    AbortControllerImpl = globalThis.AbortController,
  } = options;

  const cache = new Map();    // prefix -> { expiresAt, failed, byVideo: Map<videoID, entry> }
  const inflight = new Map(); // prefix -> Promise<record>
  const queue = [];
  let active = 0;
  let epoch = 0;

  function runGated(task) {
    return new Promise(resolve => {
      const start = () => {
        active++;
        Promise.resolve()
          .then(task)
          .catch(() => null)
          .then(value => {
            active--;
            resolve(value);
            const next = queue.shift();
            if (next) next();
          });
      };
      if (active < maxConcurrent) start(); else queue.push(start);
    });
  }

  function remember(prefix, record) {
    cache.delete(prefix);
    cache.set(prefix, record);
    while (cache.size > maxPrefixes) {
      cache.delete(cache.keys().next().value); // oldest insertion first
    }
    return record;
  }

  function parseBucket(body) {
    const byVideo = new Map();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return byVideo;
    for (const [videoID, entry] of Object.entries(body)) {
      if (!isVideoId(videoID) || !entry || typeof entry !== 'object') continue;
      byVideo.set(videoID, {
        titles: Array.isArray(entry.titles) ? entry.titles : [],
        thumbnails: Array.isArray(entry.thumbnails) ? entry.thumbnails : [],
      });
    }
    return byVideo;
  }

  async function requestBucket(prefix) {
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const work = (async () => {
      const response = await fetchImpl(`${BRANDING_API}/${prefix}`, {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller ? controller.signal : undefined,
      });
      if (response.status === 404) return { status: 404, byVideo: new Map() };
      if (!response.ok) throw new Error(`DeArrow branding returned HTTP ${response.status}`);
      return { status: 200, byVideo: parseBucket(await response.json()) };
    })();
    let outcome;
    try {
      outcome = await withTimeout(work, timeoutMs, TIMED_OUT);
    } catch (_) {
      outcome = null;
    }
    if (outcome === TIMED_OUT && controller) controller.abort();
    if (outcome === TIMED_OUT || outcome === null) {
      // Swallow the late rejection of the abandoned work.
      work.catch(() => {});
      return remember(prefix, { expiresAt: now() + errorBackoffMs, failed: true, byVideo: new Map() });
    }
    if (outcome.status === 404) {
      return remember(prefix, { expiresAt: now() + negativeTtlMs, failed: false, byVideo: new Map() });
    }
    return remember(prefix, { expiresAt: now() + positiveTtlMs, failed: false, byVideo: outcome.byVideo });
  }

  function getRecord(prefix) {
    const cached = cache.get(prefix);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached);
    if (cached) cache.delete(prefix);
    if (inflight.has(prefix)) return inflight.get(prefix);
    const pending = runGated(() => requestBucket(prefix)).then(record => {
      inflight.delete(prefix);
      return record || { expiresAt: 0, failed: true, byVideo: new Map() };
    });
    inflight.set(prefix, pending);
    return pending;
  }

  function resultsFrom(ids, recordFor) {
    const out = new Map();
    for (const id of ids) {
      const record = recordFor(brandingPrefix(id));
      out.set(id, record ? (record.byVideo.get(id) || null) : null);
    }
    return out;
  }

  return {
    get epoch() { return epoch; },

    /** Drop pending results from before this call. Used when DeArrow is switched off. */
    invalidate() { epoch++; },

    async lookup(videoIDs) {
      const ids = [...new Set((videoIDs || []).filter(isVideoId))];
      const prefixes = [...new Set(ids.map(brandingPrefix))];
      const records = new Map();
      await Promise.all(prefixes.map(async prefix => {
        records.set(prefix, await getRecord(prefix));
      }));
      return resultsFrom(ids, prefix => records.get(prefix));
    },

    snapshot(videoIDs) {
      const ids = [...new Set((videoIDs || []).filter(isVideoId))];
      return resultsFrom(ids, prefix => {
        const cached = cache.get(prefix);
        return cached && cached.expiresAt > now() ? cached : null;
      });
    },

    /** Test helper. */
    _cacheSize() { return cache.size; },
  };
}

/** Walk a parsed response and collect tile objects that carry a video ID. */
export function collectVideoTiles(root, { maxNodes = 200000 } = {}) {
  const found = [];
  const seen = new Set();
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < maxNodes) {
    const node = stack.pop();
    visited++;
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const value of node) if (value && typeof value === 'object') stack.push(value);
      continue;
    }
    if (node.tileRenderer && typeof node.tileRenderer === 'object') {
      const videoID = node.tileRenderer.contentId || node.tileRenderer.onSelectCommand?.watchEndpoint?.videoId;
      if (isVideoId(videoID)) found.push({ item: node, videoID, kind: 'tile' });
    } else if (node.lockupViewModel && typeof node.lockupViewModel === 'object') {
      const lockup = node.lockupViewModel;
      if (lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && isVideoId(lockup.contentId)) {
        found.push({ item: node, videoID: lockup.contentId, kind: 'lockup' });
      }
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return found;
}

function setTitle(tile, title) {
  if (tile.kind === 'tile') {
    const holder = tile.item.tileRenderer?.metadata?.tileMetadataRenderer?.title;
    if (!holder || typeof holder !== 'object') return false;
    holder.simpleText = title;
    holder.runs = [{ text: title }];
    return true;
  }
  const holder = tile.item.lockupViewModel?.metadata?.lockupMetadataViewModel?.title;
  if (!holder || typeof holder !== 'object') return false;
  holder.content = title;
  return true;
}

function thumbnailSlot(tile) {
  if (tile.kind === 'tile') {
    const thumbnail = tile.item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail;
    return thumbnail && typeof thumbnail === 'object' ? { holder: thumbnail, key: 'thumbnails' } : null;
  }
  const image = tile.item.lockupViewModel?.contentImage?.thumbnailViewModel?.image;
  return image && typeof image === 'object' ? { holder: image, key: 'sources' } : null;
}

function setThumbnail(tile, url) {
  const slot = thumbnailSlot(tile);
  if (!slot) return false;
  slot.holder[slot.key] = [{ url, width: 1280, height: 640 }];
  return true;
}

function originalThumbnailUrl(tile) {
  const slot = thumbnailSlot(tile);
  const first = slot ? slot.holder[slot.key]?.[0] : undefined;
  return typeof first?.url === 'string' ? first.url : '';
}

/**
 * Apply branding to the collected tiles in place. Returns true if anything changed.
 * Only call this on a response object that has not been handed to the app yet.
 */
export function applyBranding(tiles, branding, { titles = true, thumbnails = false } = {}) {
  let changed = false;
  for (const tile of tiles) {
    const entry = branding.get(tile.videoID);
    if (!entry) continue;
    if (titles) {
      const title = selectTitle(entry);
      if (title && setTitle(tile, title)) changed = true;
    }
    if (thumbnails) {
      const timestamp = selectThumbnailTimestamp(entry);
      if (timestamp !== null && setThumbnail(tile, thumbnailUrl(tile.videoID, timestamp, originalThumbnailUrl(tile)))) {
        changed = true;
      }
    }
  }
  return changed;
}

export function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return '';
}

export function isInspectableUrl(url) {
  return INSPECTED_PATH_RE.test(String(url || ''));
}

/**
 * Build the response transformer. Returns async (response, epoch) => Response.
 * Any failure returns the original response unchanged.
 */
export function createResponseBrander({
  service,
  parseWithoutHooks,
  isEnabled,
  thumbnailsEnabled,
  budgetMs = DEFAULTS.budgetMs,
  ResponseImpl = globalThis.Response,
  HeadersImpl = globalThis.Headers,
}) {
  return async function brandResponse(response, epochAtRequest) {
    try {
      if (!response || !response.ok || typeof response.clone !== 'function') return response;
      const text = await response.clone().text();
      if (!/"(?:contentId|videoId)"/.test(text)) return response;

      const data = parseWithoutHooks(text);
      const tiles = collectVideoTiles(data);
      if (!tiles.length) return response;

      const ids = [...new Set(tiles.map(tile => tile.videoID))];
      const outcome = await withTimeout(service.lookup(ids), budgetMs, TIMED_OUT);
      // Budget exceeded: use only what is already cached. The request keeps
      // running in the background and fills the cache for the next load.
      const branding = outcome === TIMED_OUT ? service.snapshot(ids) : outcome;

      if (!isEnabled() || service.epoch !== epochAtRequest) return response;
      if (!applyBranding(tiles, branding, { titles: true, thumbnails: thumbnailsEnabled() })) return response;

      const headers = new HeadersImpl(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new ResponseImpl(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (_) {
      return response;
    }
  };
}

/**
 * Install the fetch response boundary on `target` (window). Idempotent.
 * When DeArrow is disabled, fetch is returned to the original behaviour: no
 * branding request is made and the response object is passed through untouched.
 */
export function installDeArrowFetchBoundary(target, { brander, isEnabled, service }) {
  const originalFetch = target.fetch;
  if (typeof originalFetch !== 'function' || target.__ytarkDeArrowBoundary) return false;

  target.fetch = function ytarkDeArrowFetch(input, init) {
    const url = requestUrl(input);
    if (!isInspectableUrl(url)) return originalFetch.apply(this, arguments);
    if (!isEnabled()) {
      service.invalidate(); // results from requests still in flight must not be applied
      return originalFetch.apply(this, arguments);
    }
    const epochAtRequest = service.epoch;
    return originalFetch.apply(this, arguments).then(response => brander(response, epochAtRequest));
  };
  target.__ytarkDeArrowBoundary = true;
  return true;
}
