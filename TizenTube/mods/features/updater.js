// YTArk Updates surface.
//
// The native Android updater owns release discovery, download, verification
// and the installer handoff. This module renders its real state on the
// YouTube TV settings UI through the versioned `window.ytarkUpdater` bridge
// (contract 1) and, when that bridge is not connected yet, performs an honest
// read-only stable-release check so the page never shows a blank card or a
// fabricated status.

import { settleWithin } from './settlementDeadline.js';
import {
  showModal, showToast, buttonItem, overlayPanelItemListRenderer, overlayMessageRenderer,
  scrollPaneRenderer, QrCodeRenderer,
} from '../ui/ytUI.js';
import qrcode from 'qrcode-npm';
import {
  BRIDGE_NAME,
  buildCommand,
  actionsForState,
  describeState,
  displayVersion,
  formatBytes,
  RELEASES_API,
  officialReleasePageUrl,
  LATEST_RELEASE_PAGE,
  RELEASES_PAGE,
  formatTimestamp,
  parseNativeState,
  validateReleasePayload,
  unknownArchitectureMessage,
  incompatibleArchitectureMessage,
} from './updateState.js';
import { deriveAbiEvidence, VERDICTS } from './abiEvidence.js';
import { installedPackageVersion, installedVersionLabel, normalizePackageVersion } from './appVersion.js';

const POLL_INTERVAL_MS = 1500;
const POLL_DEADLINE_MS = 15 * 60 * 1000;
const MAX_POLLS = 600;
const CHECK_TIMEOUT_MS = 12_000;
// The Cobalt bridge can bind shortly after the page script runs, so the first
// architecture read may legitimately come back empty. Bounded retries turn
// "bridge not ready yet" into a real value instead of an unknown verdict.
const ARCH_RETRY_DELAYS_MS = [0, 1500, 4000];
const SETTLED_STATES = ['idle', 'current', 'available', 'check_error',
  'ready_to_install', 'permission_required', 'installed', 'installation_cancelled',
  'install_error', 'download_error'];

export function adaptBridge(bridge) {
  if (!bridge || typeof bridge.getState !== 'function') return null;
  const read = () => {
    try {
      return parseNativeState(bridge.getState());
    } catch (error) {
      console.warn('[YTArk Updates] The native updater state could not be read:', error);
      return null;
    }
  };
  const send = (command, payload) => {
    const request = buildCommand(command, payload);
    if (!request) return { ok: false, error: `Unsupported update command: ${command}` };
    try {
      if (typeof bridge.command !== 'function') return { ok: false, error: 'The updater bridge cannot accept commands.' };
      const response = bridge.command(request);
      let parsed = response;
      if (typeof response === 'string') {
        try {
          parsed = JSON.parse(response);
        } catch (_) {
          return { ok: false, error: 'The updater bridge returned an unreadable response.' };
        }
      }
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'The updater bridge returned an empty response.' };
      }
      return { ok: parsed.ok !== false, error: typeof parsed.error === 'string' ? parsed.error : '' };
    } catch (error) {
      return { ok: false, error: `The updater bridge rejected the command: ${error}` };
    }
  };
  return { read, send, available: true };
}

export function makeBridge() {
  return adaptBridge(typeof window !== 'undefined' ? window[BRIDGE_NAME] : null);
}

/**
 * The installed YTArk package version, as the platform reports it.
 *
 * `GetVersion()` is an asynchronous bridge call on the pinned Cobalt base, so a
 * plain synchronous read used to yield `undefined` — or, worse, the string
 * "[object Promise]" — which this function reported as the installed version.
 * The value is normalized here, and when the platform has not answered, the
 * asynchronous resolver in features/appVersion.js (which handles the callback,
 * Promise and synchronous binding shapes) supplies it.
 *
 * This stays *package* metadata only: the architecture evidence and the update
 * comparison must never be driven by this build's packaging metadata, or a
 * device that never reported itself could be told it is armeabi-v7a.
 */
export function nativeInstalledVersion() {
  try {
    const getVersion = window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.GetVersion;
    if (typeof getVersion === 'function') {
      const sync = normalizePackageVersion(String(getVersion() || ''));
      if (sync) return sync;
    }
  } catch (error) {
    console.warn('[YTArk Updates] Could not read the installed version:', error);
  }
  return installedPackageVersion() || 'unknown';
}

/**
 * What the panel shows as the installed version: the platform's package value
 * when there is one, otherwise this build's packaging metadata (labelled), and
 * only then "unknown". The latest available release is never used here.
 */
export function installedDisplayText(installed) {
  const fromModel = installed ? (installed.display || installed.version || '') : '';
  if (fromModel && fromModel !== 'unknown') return fromModel;
  return installedVersionLabel() || 'unknown';
}

export function nativeArchitecture() {
  try {
    const getArchitecture = window.h5vcc && window.h5vcc.tizentube
      && window.h5vcc.tizentube.GetArchitecture;
    if (typeof getArchitecture === 'function') return String(getArchitecture() || '');
  } catch (error) {
    console.warn('[YTArk Updates] Could not read the device architecture:', error);
  }
  return '';
}

function delay(milliseconds) {
  return new Promise(resolve => { setTimeout(resolve, milliseconds); });
}

/**
 * Read the device architecture with bounded retries so a delayed bridge
 * binding does not produce a spurious "unknown" verdict. Never throws; an
 * empty string means "still nothing to report".
 */
export async function queryArchitectureWithRetry(readArchitecture, {
  delaysMs = ARCH_RETRY_DELAYS_MS,
} = {}) {
  const read = typeof readArchitecture === 'function' ? readArchitecture : () => '';
  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    if (attempt > 0) await delay(delaysMs[attempt]);
    let value = '';
    try {
      value = String(read() || '');
    } catch (_) {
      value = '';
    }
    if (value.trim()) return { raw: value, attempts: attempt + 1 };
  }
  return { raw: '', attempts: delaysMs.length };
}

/** Build the structured evidence, total and exception-free. */
export function buildAbiEvidence(readArchitecture, readInstalledVersion, { delaysMs } = {}) {
  return queryArchitectureWithRetry(readArchitecture, { delaysMs })
    .then(async (architecture) => {
      let installed = '';
      try {
        installed = String(readInstalledVersion() || '');
      } catch (_) {
        installed = '';
      }
      let evidence;
      try {
        evidence = deriveAbiEvidence({
          bridgeRaw: architecture.raw,
          installedVersionRaw: installed,
        });
      } catch (error) {
        evidence = {
          schemaVersion: 1,
          verdict: VERDICTS.unknown,
          reason: 'evidence-error',
          architecture: null,
          bridge: { status: 'error', detail: String(error).slice(0, 200) },
          installedBuild: { status: 'unknown', version: 'unknown' },
          details: ['The architecture evidence could not be computed; treating it as unknown.'],
        };
      }
      return { evidence, architectureQuery: architecture };
    });
}

const qrCache = new Map();
const RELEASES_PAGE_PREFIX = `${RELEASES_PAGE}/`;

/** Data URL of a QR code for an official https URL; '' when generation fails. */
export function qrCodeDataUrl(url) {
  // Only official YTArk release pages are encoded; anything else gets no QR.
  if (typeof url !== 'string' || !url.startsWith(RELEASES_PAGE_PREFIX)) return '';
  if (qrCache.has(url)) return qrCache.get(url);
  let dataUrl = '';
  try {
    const qr = qrcode.qrcode(6, 'M');
    qr.addData(url);
    qr.make();
    const match = qr.createImgTag(6, 8).match(/src="([^"]+)"/);
    dataUrl = match ? match[1] : '';
  } catch (error) {
    console.warn('[YTArk Updates] Could not draw the release page QR code:', error);
  }
  qrCache.set(url, dataUrl);
  return dataUrl;
}

const MAX_RELEASE_BYTES = 512 * 1024;

async function fetchLatestRelease(fetchImplementation, timeoutMs) {
  const fetchFn = fetchImplementation
    || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) throw new Error('No network API is available in this runtime.');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const outcome = await settleWithin(async () => {
    const response = await fetchFn(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller ? controller.signal : undefined,
    });
    if (response.status === 403 || response.status === 429) {
      const retryAfter = response.headers && response.headers.get
        ? response.headers.get('retry-after') : null;
      const error = new Error(retryAfter
        ? `GitHub is rate-limiting update checks. Try again after ${retryAfter} seconds.`
        : 'GitHub is rate-limiting update checks. Try again later.');
      error.kind = 'rate-limited';
      throw error;
    }
    if (response.status === 404) {
      const error = new Error('No stable YTArk release is published yet.');
      error.kind = 'no-release';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`The release service answered with HTTP ${response.status}.`);
      error.kind = 'http';
      throw error;
    }
    if (typeof response.text === 'function') {
      const text = await response.text();
      if (String(text).length > MAX_RELEASE_BYTES) {
        const error = new Error('The release metadata is larger than expected and was ignored.');
        error.kind = 'too-large';
        throw error;
      }
      return JSON.parse(text);
    }
    return await response.json();
  }, timeoutMs);
  if (outcome.timedOut) {
    if (controller) {
      try { controller.abort(); } catch (_) { /* best effort only */ }
    }
    const error = new Error('The update check timed out. Nothing was downloaded or changed.');
    error.name = 'AbortError';
    throw error;
  }
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

export function createUpdateController(overrides = {}) {
  const ui = {
    showModal,
    showToast,
    buttonItem,
    overlayPanelItemListRenderer,
    overlayMessageRenderer,
    QrCodeRenderer,
    ...(overrides.ui || {}),
  };
  const bridge = overrides.bridge !== undefined ? adaptBridge(overrides.bridge) : makeBridge();
  const fetchReleasePayload = overrides.fetchRelease
    || ((timeoutMs) => fetchLatestRelease(null, timeoutMs));
  const readInstalledVersion = overrides.installedVersion || nativeInstalledVersion;
  const readArchitecture = overrides.architecture || nativeArchitecture;
  const now = overrides.now || (() => Date.now());
  const checkTimeoutMs = overrides.checkTimeoutMs || CHECK_TIMEOUT_MS;
  const archRetryDelaysMs = overrides.archRetryDelaysMs || ARCH_RETRY_DELAYS_MS;

  const state = {
    model: null,
    fallback: null,
    fallbackError: '',
    evidence: null,
    checking: false,
    lastSuccessAt: 0,
    renderSignature: '',
    pollTimer: null,
    pollStartedAt: 0,
    pollCount: 0,
    // Set when the user closed the dialog (Back or Close). While dismissed the
    // controller never re-renders the modal and no polling is scheduled; the
    // next explicit open() clears it. This is what keeps repeated Settings
    // opens from stacking stale or duplicate update panels.
    dismissed: false,
  };

  function clearPolling() {
    if (state.pollTimer !== null) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    state.pollCount = 0;
    state.pollStartedAt = 0;
  }

  function baseModel() {
    return {
      contract: 1,
      state: 'idle',
      installed: { version: readInstalledVersion(), display: displayVersion(readInstalledVersion()), code: 0 },
      available: null,
      lastSuccessAt: state.lastSuccessAt,
      lastAttemptAt: 0,
      nextCheckAt: 0,
      error: '',
      download: { active: false, phase: 'idle', received: 0, total: 0 },
      verified: false,
      permissionRequired: false,
      snoozed: false,
      skipped: false,
    };
  }

  function currentModel() {
    return state.model || baseModel();
  }

  function signatureOf(model) {
    const bucket = model.state === 'downloading'
      ? Math.floor((model.download.received || 0) / (1024 * 512))
      : 0;
    return [
      model.state,
      model.installed.version,
      model.available ? model.available.version : '',
      model.error ? 'error' : '',
      bucket,
      state.fallbackError ? 'fallback-error' : '',
    ].join('|');
  }

  function noteLines(model) {
    const lines = [];
    const installed = model.installed;
    lines.push(`Installed version: ${installedDisplayText(installed)}`);
    if (installed.code) lines.push(`Android versionCode: ${installed.code}`);
    if (model.available) {
      lines.push(`Available stable version: ${model.available.display} (${model.available.abi})`);
      if (model.available.size) lines.push(`Download size: ${formatBytes(model.available.size)}`);
    } else if (state.fallback && state.fallback.version) {
      lines.push(`Available stable version: ${state.fallback.display} (${state.fallback.abi})`);
      if (state.fallback.size) lines.push(`Download size: ${formatBytes(state.fallback.size)}`);
    }
    const lastSuccess = formatTimestamp(model.lastSuccessAt);
    lines.push(lastSuccess
      ? `Last successful check: ${lastSuccess}`
      : 'Last successful check: none yet');
    if (model.nextCheckAt) {
      lines.push(`Next automatic check: ${formatTimestamp(model.nextCheckAt)}`);
    }
    if (model.download && model.download.active && model.download.received > 0) {
      const received = formatBytes(model.download.received);
      lines.push(model.download.total > 0
        ? `Progress: ${received} of ${formatBytes(model.download.total)}`
        : `Progress: ${received} downloaded (the engine has not reported a total yet)`);
    }
    return lines;
  }

  // The bundled changelog is readable offline from the Updates screen too.
  function changelogButton() {
    return ui.buttonItem(
      { title: 'What\'s new and changelog', subtitle: 'Version history bundled with this build' },
      { icon: 'BOOKMARK_BORDER' },
      [{ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: {} } }],
    );
  }

  function statusLabel(model) {
    const evidence = state.evidence;
    const release = model.available || state.fallback;
    if (state.checking) return 'Checking the official YTArk release…';
    if (model.state === 'check_error') return `Couldn't check: ${model.error || 'unknown error'}`;
    if (evidence) {
      if (evidence.verdict === VERDICTS.unknown) {
        return 'Could not confirm this device\'s app architecture';
      }
      if (evidence.verdict === VERDICTS.incompatible) {
        return 'This device is not compatible with the YTArk ARMv7 releases';
      }
    }
    if (model.state === 'available') {
      return release
        ? `YTArk ${release.display} is available for this device (ARMv7)`
        : 'Update available';
    }
    if (model.state === 'current') return 'Up to date';
    return 'Not checked yet';
  }

  /** One short, wrap-safe line per fact; the panel never carries long text. */
  function factLines(model) {
    const evidence = state.evidence;
    const release = model.available || state.fallback;
    const installed = installedDisplayText(model.installed);
    const lines = [`Installed: ${installed}`];
    if (release && release.display) {
      const abiNote = release.abi ? ` (${release.abi})` : '';
      lines.push(`Latest stable: ${release.display}${abiNote}`);
      if (release.size) lines.push(`Download size: ${formatBytes(release.size)}`);
    } else {
      lines.push('Latest stable: not checked yet');
    }
    const lastSuccess = formatTimestamp(model.lastSuccessAt) || 'none yet';
    lines.push(`Last successful check: ${lastSuccess}`);
    if (evidence && evidence.verdict === VERDICTS.compatible) {
      lines.push('Device architecture: armeabi-v7a (confirmed)');
    }
    if (state.fallbackError && model.state !== 'check_error') lines.push(state.fallbackError);
    return lines;
  }

  /** Evidence detail lines, shown only when the verdict is not compatible. */
  function evidenceDetailLines() {
    const evidence = state.evidence;
    if (!evidence || evidence.verdict === VERDICTS.compatible) return [];
    if (evidence.verdict === VERDICTS.unknown) return [unknownArchitectureMessage(evidence)];
    if (evidence.verdict === VERDICTS.incompatible) {
      return [incompatibleArchitectureMessage(evidence)].concat(evidence.details || []);
    }
    return [];
  }

  function notesButton(release) {
    if (!release || !release.notes) return null;
    return ui.buttonItem(
      { title: 'Release notes', subtitle: 'Full "What changed" text, scrollable' },
      { icon: 'BOOKMARK_BORDER' },
      [{ customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: 'notes' } }],
    );
  }

  /**
   * The manual-install card. The repacked build cannot connect the native
   * engine to this surface, so the card only reports a verified release check
   * and offers the manual route (official page + QR). It offers no download
   * or install control and never claims an installation happened.
   *
   * Layout contract: one short status line, a few short fact lines, at most
   * one evidence explanation, the manual route, then the action buttons.
   * Long release notes live in their own scrollable panel (see 'notes'), so
   * nothing can overflow the dialog or be clipped behind another pane.
   */
  function renderManual(model) {
    if (state.dismissed) return;
    const signature = signatureOf(model);
    const release = model.available || state.fallback;
    const pageUrl = officialReleasePageUrl(release ? release.tag : '');
    const items = [];
    let checkButtonIndex = -1;

    items.push(ui.overlayMessageRenderer(statusLabel(model)));
    items.push(ui.overlayMessageRenderer(factLines(model).join('\n')));
    for (const line of evidenceDetailLines()) {
      items.push(ui.overlayMessageRenderer(line));
    }

    const notesRow = notesButton(release);
    if (notesRow) items.push(notesRow);

    // Manual route: only when a release is known and the device is not
    // categorically incompatible.
    if (release && state.evidence && state.evidence.verdict !== VERDICTS.incompatible) {
      const route = [
        'To install, open the official page (or scan the QR code with your phone) and download the ARMv7 APK.',
        `Official page: ${pageUrl}`,
        'This screen does not download or install anything; Android asks you to confirm any install.',
      ];
      if (state.evidence && state.evidence.verdict === VERDICTS.unknown) {
        route.unshift('Until the architecture is confirmed, use this manual route:');
      }
      items.push(ui.overlayMessageRenderer(route.join('\n')));
      const qr = qrCodeDataUrl(pageUrl);
      if (qr) items.push(ui.QrCodeRenderer(qr));
    } else if (state.evidence && state.evidence.verdict === VERDICTS.incompatible) {
      items.push(ui.overlayMessageRenderer(`Official release page (reference): ${pageUrl}`));
    }

    items.push(ui.buttonItem(
      { title: 'Re-detect device architecture', subtitle: 'Re-read the device architecture, waiting for the bridge if needed' },
      { icon: 'REFRESH' },
      [{ customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: 'recheck-arch' } }],
    ));
    items.push(ui.buttonItem(
      { title: state.checking ? 'Checking…' : 'Check again' },
      { icon: 'SYSTEM_UPDATE' },
      [{ customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: 'check' } }],
    ));
    checkButtonIndex = items.length - 1;
    items.push(changelogButton());
    items.push(ui.buttonItem(
      { title: 'Close' },
      { icon: 'CLOSE' },
      [{ signalAction: { signal: 'POPUP_BACK' } }],
    ));

    state.renderSignature = signature;
    try {
      ui.showModal(
        { title: 'YTArk Updates', subtitle: 'Verified updates from the official YTArk stable release' },
        // Focus starts on the first meaningful action (Check again), not on a
        // passive status message.
        ui.overlayPanelItemListRenderer(items, Math.max(0, checkButtonIndex)),
        'ytark-updates',
        true,
        {
          onDismiss: [
            { customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: 'dismiss' } },
          ],
        },
      );
    } catch (error) {
      console.warn('[YTArk Updates] The update panel could not be rendered:', error);
      state.renderSignature = '';
    }
  }

  function render(model) {
    if (!bridge) {
      renderManual(model);
      return;
    }
    if (state.dismissed) return;
    const signature = signatureOf(model);
    const status = describeState(model);
    const lines = noteLines(model);
    if (state.fallbackError) lines.push(state.fallbackError);
    const notes = model.available && model.available.notes
      ? model.available.notes
      : state.fallback && state.fallback.notes ? state.fallback.notes : '';

    const actions = actionsForState(model);
    const items = [
      ui.overlayMessageRenderer(status),
      ui.overlayMessageRenderer(lines.join('\n')),
    ];
    if (notes) {
      items.push(ui.buttonItem(
        { title: 'Release notes', subtitle: 'Full "What changed" text, scrollable' },
        { icon: 'BOOKMARK_BORDER' },
        [{ customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: 'notes' } }],
      ));
    }
    let firstActionIndex = items.length;
    for (const action of actions) {
      items.push(ui.buttonItem(
        { title: action.label },
        { icon: action.id === 'check' ? 'SYSTEM_UPDATE'
          : action.id === 'download' ? 'DOWN_ARROW'
            : action.id === 'install' ? 'CHECK_CIRCLE_THICK'
              : action.id === 'cancel' ? 'CLOSE' : 'CHEVRON_RIGHT' },
        [{ customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: action.id } }],
      ));
    }
    items.push(changelogButton());

    state.renderSignature = signature;
    try {
      ui.showModal(
        {
          title: 'YTArk Updates',
          subtitle: 'Verified updates from the official YTArk stable release',
        },
        ui.overlayPanelItemListRenderer(items, Math.max(0, firstActionIndex)),
        'ytark-updates',
        true,
        {
          onDismiss: [
            { customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: 'dismiss' } },
          ],
        },
      );
    } catch (error) {
      // A renderer failure must never break navigation or leave a stale spinner.
      console.warn('[YTArk Updates] The update panel could not be rendered:', error);
      state.renderSignature = '';
    }
  }

  /** The release notes in their own scrollable panel (D-pad up/down scrolls). */
  function renderNotes() {
    if (state.dismissed) return;
    const release = state.model && state.model.available
      ? state.model.available
      : (state.fallback || null);
    if (!release || !release.notes) {
      ui.showToast('YTArk Updates', 'No release notes were published with this release.');
      return;
    }
    try {
      ui.showModal(
        { title: 'Release notes', subtitle: `YTArk ${release.display} · ${release.tag}` },
        ui.scrollPaneRenderer([ui.overlayMessageRenderer(release.notes)]),
        'ytark-update-notes',
        false,
      );
    } catch (error) {
      console.warn('[YTArk Updates] The release notes panel could not be rendered:', error);
    }
  }

  function schedulePolling(model) {
    clearPolling();
    if (SETTLED_STATES.includes(model.state)) return;
    state.pollStartedAt = now();
    state.pollTimer = setInterval(() => {
      state.pollCount += 1;
      if (now() - state.pollStartedAt > POLL_DEADLINE_MS || state.pollCount > MAX_POLLS) {
        clearPolling();
        return;
      }
      refresh();
    }, POLL_INTERVAL_MS);
  }

  async function runFallbackCheck() {
    if (state.checking) return state.model;
    state.checking = true;
    state.dismissed = false;
    state.fallbackError = '';
    const pending = currentModel();
    pending.state = 'checking';
    state.model = pending;
    render(state.model);
    try {
      // Evidence first: the architecture verdict decides how the release is
      // matched, and a delayed bridge must not turn into a device verdict.
      const { evidence } = await buildAbiEvidence(readArchitecture, readInstalledVersion,
        { delaysMs: archRetryDelaysMs });
      state.evidence = evidence;
      const installedVersion = String(readInstalledVersion() || 'unknown');
      const payload = await fetchReleasePayload(checkTimeoutMs);
      const result = validateReleasePayload(payload, {
        installedVersion,
        architecture: evidence.architecture || '',
        abiVerdict: evidence.verdict,
      });
      if (result.error) {
        state.fallback = null;
        state.fallbackError = result.error;
        const model = baseModel();
        model.state = 'check_error';
        model.error = result.error;
        state.model = model;
      } else {
        state.fallback = result.release;
        state.lastSuccessAt = now();
        const model = baseModel();
        model.lastSuccessAt = state.lastSuccessAt;
        // "available"/"current" describe the version comparison; the verdict
        // (carried on the evidence and the release) decides what the UI may
        // claim about this device.
        if (result.release.newer) {
          model.state = 'available';
          model.available = {
            version: result.release.version,
            display: result.release.display,
            tag: result.release.tag,
            abi: result.release.abi,
            size: result.release.size,
            notes: result.release.notes,
          };
        } else {
          model.state = 'current';
        }
        state.model = model;
      }
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'The update check timed out. Nothing was downloaded or changed.'
        : String((error && error.message) || error || 'The update check failed.');
      state.fallbackError = message;
      const model = baseModel();
      model.state = 'check_error';
      model.error = message;
      state.model = model;
    } finally {
      state.checking = false;
      render(state.model);
      ui.showToast('YTArk Updates', statusLabel(state.model));
    }
  }

  /** Recovery action: re-read the architecture (with retries) and re-match. */
  async function runArchitectureRecheck() {
    if (state.checking) return state.model;
    state.checking = true;
    state.dismissed = false;
    const pending = currentModel();
    pending.state = 'checking';
    state.model = pending;
    render(state.model);
    let evidence;
    try {
      ({ evidence } = await buildAbiEvidence(readArchitecture, readInstalledVersion,
        { delaysMs: archRetryDelaysMs }));
    } finally {
      state.checking = false;
    }
    state.evidence = evidence;
    // No usable release yet (or the last check failed): run the full check,
    // which refreshes both the evidence and the release metadata.
    if (!state.fallback || state.fallbackError) return runFallbackCheck();
    // Otherwise re-match the cached release with the fresh verdict.
    const release = state.fallback;
    state.fallbackError = '';
    const model = baseModel();
    model.lastSuccessAt = state.lastSuccessAt;
    model.state = release.newer ? 'available' : 'current';
    if (release.newer) {
      model.available = {
        version: release.version,
        display: release.display,
        tag: release.tag,
        abi: release.abi,
        size: release.size,
        notes: release.notes,
      };
    }
    state.model = model;
    render(state.model);
    return state.model;
  }

  async function runNativeCommand(command, payload) {
    const result = bridge.send(command, payload);
    if (!result.ok) {
      ui.showToast('YTArk Updates', result.error || 'The update engine refused that action.');
    }
    refresh();
    return result;
  }

  function refresh() {
    if (bridge) {
      const model = bridge.read();
      if (!model) {
        state.fallbackError = 'The native update engine did not report a readable state.';
        const fallbackModel = state.model || baseModel();
        fallbackModel.state = 'check_error';
        fallbackModel.error = state.fallbackError;
        state.model = fallbackModel;
        render(state.model);
        return state.model;
      }
      state.fallbackError = '';
      state.model = model;
      if (signatureOf(model) !== state.renderSignature) render(model);
      schedulePolling(model);
      return model;
    }
    if (!state.model) state.model = baseModel();
    render(state.model);
    return state.model;
  }

  async function handleAction(id) {
    const engineOnly = ['download', 'cancel', 'install', 'skip'];
    if (!bridge && engineOnly.includes(id)) {
      ui.showToast('YTArk Updates',
        'Downloads run in the native YTArk updater. Use the official download page to install manually.');
      return null;
    }
    switch (id) {
      case 'check':
        if (bridge) return runNativeCommand('check');
        return runFallbackCheck();
      case 'recheck-arch':
        if (bridge) {
          ui.showToast('YTArk Updates', 'The native updater checks the architecture on its own screen.');
          return null;
        }
        return runArchitectureRecheck();
      case 'notes':
        renderNotes();
        return null;
      case 'dismiss':
        // The dialog was closed (Back or Close): stop owned work so nothing
        // re-renders the panel or keeps a timer running in the background.
        dismiss();
        return null;
      case 'download':
        if (bridge) return runNativeCommand('download');
        return null;
      case 'cancel':
        return runNativeCommand('cancel');
      case 'install':
        return runNativeCommand('install');
      case 'skip':
        return runNativeCommand('skip');
      case 'later':
        if (bridge) await runNativeCommand('later');
        clearPolling();
        return null;
      case 'open':
        if (bridge) return runNativeCommand('open');
        ui.showToast('YTArk Updates', `Official page: ${LATEST_RELEASE_PAGE}`);
        return null;
      default:
        return null;
    }
  }

  /** Stop all owned work after the dialog closes; idempotent. */
  function dismiss() {
    clearPolling();
    state.dismissed = true;
    state.renderSignature = '';
  }

  function open() {
    state.renderSignature = '';
    state.dismissed = false;
    if (bridge) {
      const model = bridge.read();
      if (model) {
        state.model = model;
        render(model);
        schedulePolling(model);
        return model;
      }
      state.model = baseModel();
      state.fallbackError = 'The native update engine did not report a readable state.';
      state.model.state = 'check_error';
      state.model.error = state.fallbackError;
      render(state.model);
      return state.model;
    }
    ui.showToast('YTArk Updates', 'Checking the official YTArk stable release…');
    return runFallbackCheck();
  }

  function dispose() {
    clearPolling();
    state.model = null;
    state.renderSignature = '';
    state.dismissed = true;
  }

  return {
    open,
    refresh,
    handleAction,
    dismiss,
    dispose,
    runFallbackCheck,
    runArchitectureRecheck,
    runNativeCommand,
    state,
  };
}

let controller = null;

function activeController() {
  if (!controller) controller = createUpdateController();
  return controller;
}

/** Entry point for the YTArk Settings -> Updates action buttons. */
export function handleYtArkUpdateCommand(action, target) {
  if (typeof action !== 'string' || action.length === 0) return false;
  let controllerInstance = target;
  try {
    controllerInstance = controllerInstance || activeController();
    const result = controllerInstance.handleAction(action);
    if (result && typeof result.catch === 'function') {
      result.catch(error => console.warn('[YTArk Updates] Action failed:', action, error));
    }
    return true;
  } catch (error) {
    console.warn('[YTArk Updates] Action failed:', action, error);
    return false;
  }
}

export default function openYtArkUpdates() {
  try {
    return Promise.resolve(activeController().open()).catch((error) => {
      console.warn('[YTArk Updates] The update screen failed to open:', error);
      return null;
    });
  } catch (error) {
    console.warn('[YTArk Updates] The update screen failed to open:', error);
    return Promise.resolve(null);
  }
}

