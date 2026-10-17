const START_EVENT = 'ui-module-evaluated';
const END_EVENT = 'controls-ready';
const VALID_LAUNCH_KINDS = new Set(['cold', 'warm']);
const VALID_DESTINATIONS = new Set(['none', 'search', 'home', 'sports', 'news', 'music', 'podcasts', 'movies', 'gaming', 'live', 'subscriptions', 'library', 'more']);
const SAFE_BUILD_VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;
const SAFE_SCRIPT_TAG = /^s[0-9]{1,7}$/;
const SAFE_BASE_TAG = /^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;
const MAX_RETAINED_SESSIONS = 20;
const MAX_EVENTS_PER_SESSION = 200;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeSession(session) {
  if (!isRecord(session) || !Array.isArray(session.events)
      || session.events.length > MAX_EVENTS_PER_SESSION || !isRecord(session.context)
      || session.events.some(event => !isRecord(event))) return null;
  return session;
}

function modeFor(session) {
  const modes = session.events.filter(event => event.event === 'startup-readiness-mode');
  if (!modes.length) return { label: 'not recorded', comparisonMode: null };
  const initial = modes[0].outcome;
  const fallback = modes.slice(1).some(event => event.outcome === 'normal-fallback');
  if (initial === 'faster') {
    if (session.context.fasterStartup !== true) return { label: 'mode/preference mismatch', comparisonMode: null };
    return fallback
      ? { label: 'Faster cadence, then normal fallback', comparisonMode: null }
      : { label: 'Faster cadence used', comparisonMode: 'faster' };
  }
  if (initial === 'normal-disabled' && session.context.fasterStartup === false) {
    return { label: 'Normal cadence (Faster startup off)', comparisonMode: 'normal' };
  }
  if (initial === 'normal-interrupted') return { label: 'Normal cadence (previous Faster startup launch was interrupted)', comparisonMode: null };
  if (initial === 'normal-storage-unavailable') return { label: 'Normal cadence (startup storage unavailable)', comparisonMode: null };
  if (initial === 'normal-fallback') return { label: 'Normal cadence (Faster startup fallback)', comparisonMode: null };
  return { label: 'actual mode unavailable or not comparable', comparisonMode: null };
}

function startupMeasurement(input) {
  const session = safeSession(input);
  if (!session) return { session: null, measured: false, eligible: false, reason: 'The saved sample is invalid or unsupported.' };
  if (session.capture !== 'launch') return { session, measured: false, eligible: false, reason: 'This is a partial sample, not a launch capture.' };
  if (session.status === 'active') return { session, measured: false, eligible: false, reason: 'The launch sample is still in progress.' };
  if (session.status !== 'complete') return { session, measured: false, eligible: false, reason: `The launch sample is ${String(session.status)} and is not complete.` };
  if (session.truncated === true) return { session, measured: false, eligible: false, reason: 'The event limit was reached; this sample is incomplete.' };
  if (session.clockDomain !== 'performance' || session.clockQuality !== 'monotonic') {
    return { session, measured: false, eligible: false, reason: 'A reliable monotonic browser clock is unavailable for this sample.' };
  }
  if (session.events.some(event => event.event === 'startup-readiness-timeout')) {
    return { session, measured: false, eligible: false, reason: 'Startup readiness timed out; no duration is reported.' };
  }

  const starts = session.events.filter(event => event.event === START_EVENT);
  const ends = session.events.filter(event => event.event === END_EVENT);
  if (starts.length !== 1 || ends.length !== 1) {
    return { session, measured: false, eligible: false, reason: 'The required start or end mark is missing or ambiguous.' };
  }
  const start = starts[0];
  const end = ends[0];
  if (!Number.isFinite(start.relativeMs) || !Number.isFinite(end.relativeMs)
      || start.relativeMs < 0 || end.relativeMs <= start.relativeMs
      || end.relativeMs - start.relativeMs > 5 * 60 * 1000
      || !['observed', 'proxy'].includes(start.quality) || end.quality !== 'observed') {
    return { session, measured: false, eligible: false, reason: 'The start/end timing is unavailable or invalid; no duration is reported.' };
  }

  const mode = modeFor(session);
  const navigationProblem = session.events.some(event =>
    event.event === 'startup-navigation-cancelled' || event.event === 'startup-navigation-failed');
  const comparisonMode = navigationProblem ? null : mode.comparisonMode;
  const context = session.context;
  const launchKind = VALID_LAUNCH_KINDS.has(context.startupComparisonKind)
    ? context.startupComparisonKind : 'unclassified';
  const definitionComplete = context.packageId === 'io.github.twoarchiver.ytark'
    && typeof context.bundleVersion === 'string' && SAFE_BUILD_VERSION.test(context.bundleVersion)
    && typeof context.scriptTag === 'string' && SAFE_SCRIPT_TAG.test(context.scriptTag)
    && typeof context.baseTag === 'string' && SAFE_BASE_TAG.test(context.baseTag)
    && typeof context.reloadHomeOnStartup === 'boolean'
    && VALID_DESTINATIONS.has(context.startupDestination);
  const eligible = !!comparisonMode && definitionComplete && VALID_LAUNCH_KINDS.has(launchKind);
  const signature = eligible ? JSON.stringify([
    context.bundleVersion,
    context.scriptTag,
    context.baseTag,
    context.reloadHomeOnStartup,
    context.startupDestination,
    launchKind,
  ]) : null;
  return {
    session,
    measured: true,
    eligible,
    reason: eligible ? '' : navigationProblem
      ? 'Startup navigation was cancelled or failed; this launch is not comparable.'
      : !comparisonMode
        ? 'The actual readiness mode was unavailable, interrupted, or fell back.'
        : !VALID_LAUNCH_KINDS.has(launchKind)
          ? 'Choose a cold-start or warm-start label before collecting comparable launches.'
          : 'Build or startup-definition metadata is missing or unsupported.',
    durationMs: end.relativeMs - start.relativeMs,
    mode: mode.label,
    comparisonMode,
    launchKind,
    signature,
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ms(value) {
  return `${value.toFixed(1)} ms`;
}

function launchKindLabel(kind) {
  if (kind === 'cold') return 'cold start (user-labelled)';
  if (kind === 'warm') return 'warm start (user-labelled)';
  return 'unclassified (not compared)';
}

function summarizeLatest(result) {
  if (!result || !result.session) return 'No valid startup sample is available.';
  if (!result.measured) return result.reason;
  const session = result.session;
  const kind = launchKindLabel(result.launchKind);
  const mode = result.mode || 'actual readiness mode not recorded';
  return `Latest launch measurement: ${ms(result.durationMs)} · ${mode} · ${kind}.`;
}

/**
 * A concise, bounded summary for the TV UI. Only complete monotonic launch
 * captures with the exact same build, startup definition and user-labelled
 * cold/warm class enter a comparison; no missing value is converted to zero.
 */
export function summarizeStartupSessions({ sessions = [], status = 'empty', evicted = 0 } = {}) {
  const cleanSessions = Array.isArray(sessions) ? sessions.slice(0, MAX_RETAINED_SESSIONS) : [];
  const measurements = cleanSessions.map(startupMeasurement);
  const latest = measurements[0] || null;
  const lines = [
    'Startup summary · local browser scope',
    'Measured interval: userscript module evaluation → YTArk controls initialized. This is a narrow userscript/UI bootstrap proxy, not Android app start, full YouTube readiness, playback-ready, or first frame.',
    summarizeLatest(latest),
  ];

  if (latest && latest.measured) {
    lines.push(`Saved Faster startup preference: ${latest.session.context.fasterStartup === null ? 'unavailable' : latest.session.context.fasterStartup ? 'On' : 'Off'}. Actual readiness mode: ${latest.mode}.`);
    lines.push(`Startup destination: ${latest.session.context.startupDestination}; reload on startup: ${latest.session.context.reloadHomeOnStartup === null ? 'unavailable' : latest.session.context.reloadHomeOnStartup ? 'On' : 'Off'}.`);
  } else if (latest && latest.session) {
    lines.push(`Latest sample: ${latest.reason}`);
  } else if (status === 'unavailable') {
    lines.push('Local browser diagnostic storage is unavailable.');
  } else if (status === 'corrupt' || status === 'oversized' || status === 'future-schema') {
    lines.push('Saved samples are invalid, oversized, or use an unsupported schema; no timing is shown.');
  } else {
    lines.push('No browser startup sample is available yet. A complete launch capture requires diagnostics enabled before the next launch.');
  }

  const anchor = measurements.find(item => item.eligible);
  if (!anchor) {
    lines.push('Comparison: unavailable. Partial, interrupted, timed-out, unsupported, invalid, unclassified, or Faster-fallback samples are never treated as complete comparisons.');
    lines.push('For a comparison, use the same TV and build, choose one cold/warm label, keep the startup destination unchanged, and collect complete launches with Faster startup both off and on.');
  } else {
    const cohort = measurements.filter(item => item.eligible && item.signature === anchor.signature);
    const normal = cohort.filter(item => item.comparisonMode === 'normal').map(item => item.durationMs);
    const faster = cohort.filter(item => item.comparisonMode === 'faster').map(item => item.durationMs);
    const context = anchor.session.context;
    lines.push(`Comparison group: ${launchKindLabel(anchor.launchKind)} · ${context.bundleVersion} · ${context.scriptTag} · ${context.startupDestination} · reload ${context.reloadHomeOnStartup ? 'on' : 'off'}.`);
    if (normal.length < 3 || faster.length < 3) {
      lines.push(`Comparable complete samples: normal ${normal.length}/3; Faster ${faster.length}/3. At least three per mode are required; no median difference is reported.`);
      lines.push('For a fuller local comparison, collect five matched pairs, alternating normal and Faster launches; keep the build, destination, TV and cold/warm class the same.');
    } else {
      const normalMedian = median(normal);
      const fasterMedian = median(faster);
      const difference = normalMedian - fasterMedian;
      const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
      lines.push(`Median interval: normal ${ms(normalMedian)} (n=${normal.length}) · Faster ${ms(fasterMedian)} (n=${faster.length}).`);
      lines.push(`Observed difference (normal − Faster): ${sign}${ms(Math.abs(difference))}. This describes only the interval above and does not promise a startup benefit.`);
    }
  }
  if (evicted > 0) lines.push(`${evicted} older local sample(s) were evicted by the storage bound.`);
  lines.push('Cold/warm labels are set by the user; the browser cannot detect process coldness. No samples are uploaded.');
  return lines.join('\n');
}

export function measureStartupSample(session) {
  return startupMeasurement(session);
}
