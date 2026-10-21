const START_EVENT = 'ui-module-evaluated';
const END_EVENT = 'controls-ready';
const MAX_RETAINED_SESSIONS = 20;
const MAX_EVENTS_PER_SESSION = 200;
const MAX_INTERVAL_MS = 5 * 60 * 1000;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeSession(session) {
  if (!isRecord(session) || !Array.isArray(session.events)
      || session.events.length > MAX_EVENTS_PER_SESSION || !isRecord(session.context)
      || session.events.some(event => !isRecord(event))) return null;
  const statuses = new Set(['active', 'complete', 'interrupted', 'replaced', 'truncated']);
  const events = session.events.map(event => ({
    // Event names/outcomes are used only for fixed comparisons below; never
    // carry arbitrary stored text into the overlay summary.
    event: typeof event.event === 'string' && event.event.length <= 64 ? event.event : '',
    outcome: typeof event.outcome === 'string' && event.outcome.length <= 40 ? event.outcome : '',
    quality: ['observed', 'proxy', 'degraded', 'unsupported'].includes(event.quality) ? event.quality : 'unavailable',
    relativeMs: Number.isFinite(event.relativeMs) && event.relativeMs >= 0
      && event.relativeMs <= MAX_INTERVAL_MS ? event.relativeMs : null,
  }));
  return {
    capture: session.capture === 'launch' ? 'launch' : 'partial',
    status: statuses.has(session.status) ? session.status : 'invalid',
    clockDomain: session.clockDomain === 'performance' ? 'performance' : 'unavailable',
    clockQuality: session.clockQuality === 'monotonic' ? 'monotonic' : 'unavailable',
    context: { fasterStartup: typeof session.context.fasterStartup === 'boolean' ? session.context.fasterStartup : null },
    events,
    truncated: session.truncated === true,
  };
}

function actualReadinessMode(session) {
  const modes = session.events.filter(event => event.event === 'startup-readiness-mode');
  if (!modes.length) return 'not recorded';
  const initial = modes[0].outcome;
  const fallback = modes.slice(1).some(event => event.outcome === 'normal-fallback');
  if (initial === 'faster') return fallback ? 'Faster cadence, then normal fallback' : 'Faster cadence';
  if (initial === 'normal-disabled') return 'Normal cadence (Faster startup off)';
  if (initial === 'normal-interrupted') return 'Normal cadence (previous Faster launch interrupted)';
  if (initial === 'normal-storage-unavailable') return 'Normal cadence (startup storage unavailable)';
  if (initial === 'normal-fallback') return 'Normal cadence after Faster startup fallback';
  return 'unavailable';
}

function startupMeasurement(input) {
  const session = safeSession(input);
  if (!session) return { session: null, measured: false, reason: 'Sample is invalid or unsupported.' };
  if (session.capture !== 'launch') return { session, measured: false, reason: 'Partial sample; not a launch capture.' };
  // A completed startup is final. The recording itself continues for up to
  // five minutes and may end as complete, interrupted or still active; that
  // later lifetime must not invalidate the startup interval.
  if (session.status === 'replaced') return { session, measured: false, reason: 'Launch sample was replaced by a later capture.' };
  if (session.truncated === true || session.status === 'truncated') {
    return { session, measured: false, reason: 'Event limit reached; sample is incomplete.' };
  }
  const completed = session.events.filter(event => event.event === 'startup-readiness-complete');
  if (completed.length !== 1) {
    return { session, measured: false, reason: 'Startup readiness did not complete in this sample.' };
  }
  if (session.clockDomain !== 'performance' || session.clockQuality !== 'monotonic') {
    return { session, measured: false, reason: 'Reliable monotonic browser clock is unavailable.' };
  }
  if (session.events.some(event => event.event === 'startup-readiness-timeout'
      || event.event === 'startup-readiness-interrupted')) {
    return { session, measured: false, reason: 'Startup readiness timed out or was interrupted.' };
  }
  const starts = session.events.filter(event => event.event === START_EVENT);
  const ends = session.events.filter(event => event.event === END_EVENT);
  if (starts.length !== 1 || ends.length !== 1) {
    return { session, measured: false, reason: 'Required start/end mark is missing or ambiguous.' };
  }
  const start = starts[0];
  const end = ends[0];
  if (!Number.isFinite(start.relativeMs) || !Number.isFinite(end.relativeMs)
      || start.relativeMs < 0 || end.relativeMs <= start.relativeMs
      || end.relativeMs - start.relativeMs > MAX_INTERVAL_MS
      || !['observed', 'proxy'].includes(start.quality) || end.quality !== 'observed') {
    return { session, measured: false, reason: 'Start/end timing is unavailable or invalid.' };
  }
  return {
    session,
    measured: true,
    durationMs: end.relativeMs - start.relativeMs,
    mode: actualReadinessMode(session),
    preference: session.context.fasterStartup,
  };
}

function completionResult(session) {
  if (!session) return 'No sample is saved.';
  if (session.truncated === true || session.status === 'truncated') return 'Stopped at the event limit.';
  const readiness = [...session.events].reverse().find(event => [
    'startup-readiness-complete', 'startup-readiness-timeout', 'startup-readiness-interrupted',
  ].includes(event.event));
  if (readiness?.event === 'startup-readiness-complete') return 'Startup readiness completed.';
  if (readiness?.event === 'startup-readiness-timeout') return 'Startup readiness timed out.';
  if (readiness?.event === 'startup-readiness-interrupted') return 'Startup readiness was interrupted.';
  const navigation = [...session.events].reverse().find(event => [
    'startup-navigation-cancelled', 'startup-navigation-failed', 'startup-navigation-dispatched',
    'startup-navigation-skipped',
  ].includes(event.event));
  if (navigation?.event === 'startup-navigation-skipped') return 'Startup navigation was skipped because Home was already open.';
  if (navigation?.event === 'startup-navigation-cancelled') return 'Startup navigation was cancelled by input.';
  if (navigation?.event === 'startup-navigation-failed') return 'Startup navigation failed.';
  if (navigation?.event === 'startup-navigation-dispatched') return 'Startup navigation was dispatched.';
  if (session.status === 'active') return 'Sample is still recording.';
  if (session.status === 'complete') return 'Sample completed; readiness result was not recorded.';
  if (session.status === 'interrupted') return 'Sample was interrupted.';
  if (session.status === 'replaced') return 'Sample was replaced by a later capture.';
  return `Sample result: ${String(session.status)}.`;
}

function sampleLabel(session) {
  if (!session) return 'No sample';
  return `${session.capture === 'launch' ? 'Launch' : 'Partial'} · ${String(session.status)}`;
}

function preferenceText(value) {
  return value === true ? 'On' : value === false ? 'Off' : 'Unavailable';
}

function storageMessage(status) {
  if (status === 'unavailable') return 'Local browser diagnostic storage is unavailable.';
  if (status === 'corrupt' || status === 'oversized' || status === 'future-schema') {
    return 'Saved samples are unreadable, oversized, or use an unsupported schema; no timing is shown.';
  }
  return 'No browser startup sample is available yet.';
}

/** Compact, bounded native-overlay summary; no user labels or cross-sample arithmetic. */
export function summarizeStartupSessions({
  sessions = [], status = 'empty', recordingEnabled = false, activeRecording = false,
} = {}) {
  const cleanSessions = Array.isArray(sessions)
    ? sessions.slice(0, MAX_RETAINED_SESSIONS).map(safeSession).filter(Boolean) : [];
  const latest = cleanSessions[0] || null;
  const latestMeasurement = latest ? startupMeasurement(latest) : null;
  const mode = latest ? actualReadinessMode(latest) : 'not recorded';
  const preference = latest ? latest.context.fasterStartup : null;
  const lines = [
    'Startup summary · local browser scope',
    `Recording: ${recordingEnabled ? 'On' : 'Off'}${recordingEnabled ? (activeRecording ? ' · sample active' : ' · no active sample') : ''}.`,
    `Latest sample: ${sampleLabel(latest)}.`,
    `Latest result: ${completionResult(latest)}`,
    latestMeasurement?.measured
      ? `Valid startup duration for latest sample: ${latestMeasurement.durationMs.toFixed(1)} ms (monotonic browser clock).`
      : `Valid startup duration for latest sample: unavailable${latestMeasurement ? ` (${latestMeasurement.reason})` : ''}.`,
    `Faster startup preference: ${preferenceText(preference)}. Actual readiness mode: ${mode}.`,
    'Scope: userscript evaluation → YTArk controls ready (not Android app start); local only, nothing is sent automatically.',
  ];
  if (!latest) lines.splice(2, 0, storageMessage(status));
  return lines.slice(0, 8).join('\n');
}

export function measureStartupSample(session) {
  return startupMeasurement(session);
}
