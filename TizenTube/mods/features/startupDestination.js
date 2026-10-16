/**
 * The only destinations YTArk may issue automatically at startup. The UI
 * exposes these standard browse tabs and an empty search box; watch/Shorts or
 * arbitrary command objects are never accepted from saved configuration.
 */

export const SAFE_STARTUP_BROWSE_IDS = Object.freeze([
  'FEtopics',
  'FEtopics_sports',
  'FEtopics_news',
  'FEtopics_music',
  'FEtopics_podcasts',
  'FEtopics_movies',
  'FEtopics_gaming',
  'FEtopics_live',
  'FEsubscriptions',
  'FElibrary',
  'FEtopics_more',
]);

const SAFE_BROWSE_IDS = new Set(SAFE_STARTUP_BROWSE_IDS);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** True only for one of the exact, UI-supported startup command shapes. */
export function isSafeStartupDestination(value) {
  let command = value;
  if (typeof value === 'string') {
    if (value.length > 4000) return false;
    try { command = JSON.parse(value); } catch (_) { return false; }
  }
  if (!isRecord(command)) return false;
  const keys = Object.keys(command);
  if (keys.length !== 1) return false;
  if (keys[0] === 'browseEndpoint') {
    const endpoint = command.browseEndpoint;
    return isRecord(endpoint) && Object.keys(endpoint).length === 1
      && typeof endpoint.browseId === 'string' && SAFE_BROWSE_IDS.has(endpoint.browseId);
  }
  if (keys[0] === 'searchEndpoint') {
    const endpoint = command.searchEndpoint;
    return isRecord(endpoint) && Object.keys(endpoint).length === 1
      && endpoint.query === '';
  }
  return false;
}

/** Parse and copy only a safe startup destination; all else means no explicit route. */
export function parseStartupDestination(raw, warn = null) {
  if (raw === null || raw === undefined || raw === '') return null;
  let command = raw;
  try {
    if (typeof raw === 'string') command = JSON.parse(raw);
  } catch (error) {
    if (typeof warn === 'function') { try { warn(error); } catch (_) { /* optional */ } }
    return null;
  }
  if (!isSafeStartupDestination(command)) {
    if (typeof warn === 'function') {
      try { warn(new Error('Unsupported startup destination was ignored.')); } catch (_) { /* optional */ }
    }
    return null;
  }
  // Rebuild the known command shape instead of forwarding an arbitrary object.
  if (command.browseEndpoint) return { browseEndpoint: { browseId: command.browseEndpoint.browseId } };
  return { searchEndpoint: { query: '' } };
}
