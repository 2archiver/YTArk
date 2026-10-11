// Pure SponsorBlock segment request and validation.
//
// SponsorBlock is optional. This module never throws for a network, HTTP, JSON
// or shape problem: it resolves to { ok: false, reason } so the caller can keep
// normal playback running. A bounded timeout stops a stalled server from
// holding the lookup open, and segments are accepted only when they match the
// requested video ID and describe a forward, finite range.

export const SPONSORBLOCK_TIMEOUT_MS = 8000;

/** Keep only well-formed, forward, finite [start, end] pairs. */
export function validSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.filter(segment => Array.isArray(segment && segment.segment)
    && segment.segment.length === 2
    && Number.isFinite(Number(segment.segment[0]))
    && Number.isFinite(Number(segment.segment[1]))
    && Number(segment.segment[1]) > Number(segment.segment[0]));
}

/**
 * Parse a /skipSegments/{hashPrefix} response for one exact video.
 * Returns the validated segments for `videoID` (possibly empty).
 */
export function segmentsForVideo(results, videoID) {
  if (!Array.isArray(results)) return { ok: false, reason: 'malformed' };
  const match = results.find(entry => entry && entry.videoID === videoID);
  if (!match) return { ok: true, segments: [] };
  return { ok: true, segments: validSegments(match.segments) };
}

/**
 * Fetch skip segments for a video. `fetchImpl` is injectable for tests.
 * `isCurrent` lets the caller discard a response that arrives after the user
 * has moved to another video.
 */
export async function fetchSkipSegments({
  api,
  videoID,
  hash,
  categories,
  fetchImpl,
  timeoutMs = SPONSORBLOCK_TIMEOUT_MS,
}) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'unavailable' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const url = `${api}/skipSegments/${hash}?categories=${encodeURIComponent(JSON.stringify(categories))}`;
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response || response.ok === false) {
      return { ok: false, reason: 'http', status: response ? response.status : 0 };
    }
    const results = await response.json();
    return segmentsForVideo(results, videoID);
  } catch (error) {
    const reason = error && error.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, reason };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
