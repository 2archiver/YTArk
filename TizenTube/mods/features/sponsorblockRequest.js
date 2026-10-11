// SponsorBlock request, validation and seek-target rules.
//
// SponsorBlock is an optional service. Nothing in this module throws for a
// network, HTTP, JSON or shape problem: every failure resolves to
// { ok: false, reason }, so the caller keeps normal playback running.
//
// Deadline model: a settlement deadline bounds the whole lookup (the request
// AND the body read). AbortController is used as best-effort cancellation when
// the runtime provides it, but the deadline settles the lookup even when the
// controller is missing or fetch ignores its signal. Late results from a
// request that already timed out are discarded.

export const SPONSORBLOCK_TIMEOUT_MS = 8000;

/** Category whose entries are single points (start === end), not ranges. */
export const POINT_CATEGORY = 'poi_highlight';

/**
 * Strict time validation: a JSON number, finite and not negative.
 * Booleans, null, strings (including numeric strings) and NaN/Infinity are
 * rejected. SponsorBlock returns numeric JSON, so no coercion is applied.
 */
export function finiteTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Keep well-formed entries only.
 * - Ranges (every category except poi_highlight) need start < end.
 * - poi_highlight entries are points: start === end.
 * The original entry is preserved (including UUID) with a normalised pair.
 */
export function validSegments(segments) {
  if (!Array.isArray(segments)) return [];
  const kept = [];
  for (const entry of segments) {
    if (!entry || typeof entry !== 'object' || typeof entry.category !== 'string') continue;
    if (!Array.isArray(entry.segment) || entry.segment.length !== 2) continue;
    const start = finiteTime(entry.segment[0]);
    const end = finiteTime(entry.segment[1]);
    if (start === null || end === null) continue;
    const isPoint = entry.category === POINT_CATEGORY;
    if (isPoint ? start !== end : end <= start) continue;
    kept.push({ ...entry, segment: [start, end] });
  }
  return kept;
}

/**
 * Parse a /skipSegments/{hashPrefix} body for one exact video ID.
 * An absent video in a valid body is a normal "no segments" answer.
 */
export function segmentsForVideo(results, videoID) {
  if (!Array.isArray(results)) return { ok: false, reason: 'malformed' };
  const match = results.find(entry => entry && entry.videoID === videoID);
  if (!match) return { ok: true, segments: [], reason: 'none' };
  return { ok: true, segments: validSegments(match.segments), reason: 'found' };
}

/**
 * Where a segment may seek, or null when it must not be acted on.
 * A skip needs finite media with a known duration (live streams report
 * Infinity or NaN and are never seeked), a range inside [0, duration], and a
 * non-point category. Points never produce a seek target.
 */
export function skipTargetFor(segment, duration) {
  if (!segment || !Array.isArray(segment.segment) || segment.category === POINT_CATEGORY) return null;
  const start = finiteTime(segment.segment[0]);
  const end = finiteTime(segment.segment[1]);
  if (start === null || end === null || end <= start) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (end > duration || start >= duration) return null;
  return { start, end };
}

function failure(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

/**
 * Fetch skip segments for one video, bounded by a settlement deadline.
 * Resolves exactly once, never rejects, and clears its timer on every path.
 */
export async function fetchSkipSegments({
  api,
  videoID,
  hash,
  categories,
  fetchImpl,
  timeoutMs = SPONSORBLOCK_TIMEOUT_MS,
}) {
  if (typeof fetchImpl !== 'function') return failure('unavailable');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const url = `${api}/skipSegments/${hash}?categories=${encodeURIComponent(JSON.stringify(categories))}`;

  // The work promise can never reject, so a late rejection after the deadline
  // is absorbed here instead of surfacing as an unhandled rejection.
  const work = (async () => {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response) return failure('network');
    if (response.status === 404) return { ok: true, segments: [], reason: 'none' };
    if (response.ok === false) return failure('http', { status: response.status });
    const body = await response.json();
    return segmentsForVideo(body, videoID);
  })().catch((error) => failure(error && error.name === 'AbortError' ? 'timeout' : 'network'));

  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) {
        try { controller.abort(); } catch (_) { /* best effort only */ }
      }
      resolve(failure('timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
