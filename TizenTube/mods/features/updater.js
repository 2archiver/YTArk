// YTArk Updates surface.
//
// The native Android updater owns release discovery, download, verification
// and the installer handoff. This module renders its real state on the
// YouTube TV settings UI through the versioned `window.ytarkUpdater` bridge
// (contract 1) and, when that bridge is not connected yet, performs an honest
// read-only stable-release check so the page never shows a blank card or a
// fabricated status.

import { settleWithin } from './settlementDeadline.js';
import { showModal, showToast, buttonItem, overlayPanelItemListRenderer, overlayMessageRenderer, QrCodeRenderer } from '../ui/ytUI.js';
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
} from './updateState.js';

const POLL_INTERVAL_MS = 1500;
const POLL_DEADLINE_MS = 15 * 60 * 1000;
const MAX_POLLS = 600;
const CHECK_TIMEOUT_MS = 12_000;
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

export function nativeInstalledVersion() {
  try {
    const getVersion = window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.GetVersion;
    if (typeof getVersion === 'function') return String(getVersion() || 'unknown');
  } catch (error) {
    console.warn('[YTArk Updates] Could not read the installed version:', error);
  }
  return 'unknown';
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

  const state = {
    model: null,
    fallback: null,
    fallbackError: '',
    checking: false,
    lastSuccessAt: 0,
    renderSignature: '',
    pollTimer: null,
    pollStartedAt: 0,
    pollCount: 0,
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
    lines.push(`Installed version: ${installed.display || installed.version || 'unknown'}`);
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

  function statusLabel(model) {
    switch (model.state) {
      case 'checking': return 'Checking the official YTArk release…';
      case 'current': return 'Up to date';
      case 'available': return 'Update available';
      case 'check_error': return `Couldn't check: ${model.error || 'unknown error'}`;
      default: return 'Not checked yet';
    }
  }

  // Manual-install card. The repacked build cannot connect the native engine
  // to this surface, so the card only reports a verified release check and
  // links to the official page. It offers no download or install control.
  function renderManual(model) {
    const signature = signatureOf(model);
    const release = model.available || state.fallback;
    const pageUrl = officialReleasePageUrl(release ? release.tag : '');
    const installed = model.installed.display || model.installed.version || 'unknown';
    const latest = release && release.display
      ? (release.abi ? `${release.display} (${release.abi})` : release.display)
      : 'not checked yet';
    const lastSuccess = formatTimestamp(model.lastSuccessAt) || 'none yet';
    const lines = [
      `Installed: ${installed}`,
      `Latest stable: ${latest}`,
      `Status: ${statusLabel(model)}`,
      `Last successful check: ${lastSuccess}`,
      'Check here, then download the ARMv7 APK from the official page.',
      `Official page: ${pageUrl}`,
      'Manual install: this screen does not download or install. Android asks you to confirm any install.',
    ];
    if (state.fallbackError && model.state !== 'check_error') lines.push(state.fallbackError);
    if (release && release.size) lines.push(`Download size: ${formatBytes(release.size)}`);

    const items = [ui.overlayMessageRenderer(lines.join('\n'))];
    if (release && release.notes) {
      items.push(ui.overlayMessageRenderer(`Release notes\n${release.notes}`));
    }
    const qr = qrCodeDataUrl(pageUrl);
    if (qr) items.push(ui.QrCodeRenderer(qr));
    items.push(ui.buttonItem(
      { title: state.checking ? 'Checking…' : 'Check again' },
      { icon: 'SYSTEM_UPDATE' },
      [{ customAction: { action: 'YTARK_UPDATE_COMMAND', parameters: 'check' } }],
    ));
    items.push(ui.buttonItem(
      { title: 'Close' },
      { icon: 'CLOSE' },
      [{ signalAction: { signal: 'POPUP_BACK' } }],
    ));

    state.renderSignature = signature;
    try {
      ui.showModal(
        { title: 'YTArk Updates', subtitle: 'Manual update check · official release page' },
        ui.overlayPanelItemListRenderer(items, 0),
        'ytark-updates',
        true,
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
    const signature = signatureOf(model);
    const status = describeState(model);
    const lines = noteLines(model);
    if (state.fallbackError) lines.push(state.fallbackError);
    const notes = model.available && model.available.notes
      ? model.available.notes
      : state.fallback && state.fallback.notes ? state.fallback.notes : '';
    if (notes) lines.push('', 'Release notes', notes);

    const actions = actionsForState(model);
    const items = [
      ui.overlayMessageRenderer(status),
      ui.overlayMessageRenderer(lines.join('\n')),
    ];
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

    state.renderSignature = signature;
    try {
      ui.showModal(
        {
          title: 'YTArk Updates',
          subtitle: 'Verified updates from the official YTArk stable release',
        },
        ui.overlayPanelItemListRenderer(items, 0),
        'ytark-updates',
        true,
      );
    } catch (error) {
      // A renderer failure must never break navigation or leave a stale spinner.
      console.warn('[YTArk Updates] The update panel could not be rendered:', error);
      state.renderSignature = '';
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
    state.fallbackError = '';
    const pending = currentModel();
    pending.state = 'checking';
    state.model = pending;
    render(state.model);
    try {
      const installedVersion = readInstalledVersion();
      const payload = await fetchReleasePayload(checkTimeoutMs);
      const result = validateReleasePayload(payload, {
        installedVersion,
        architecture: readArchitecture(),
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
      ui.showToast('YTArk Updates', describeState(state.model));
    }
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

  function open() {
    state.renderSignature = '';
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
  }

  return {
    open,
    refresh,
    handleAction,
    dispose,
    runFallbackCheck,
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

