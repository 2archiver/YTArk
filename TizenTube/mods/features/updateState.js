/**
 * Shared, testable update state contract for the YTArk userscript.
 *
 * Two surfaces show update information:
 *   - The native YTArk updater (Android, injected into the app) owns release
 *     discovery, download, verification and the installer handoff.
 *   - YTArk Settings -> Updates renders that state on the TV UI.
 *
 * When the native bridge (`window.ytarkUpdater`, contract 1) is present this
 * module only maps/validates the state the engine reports. When it is missing
 * the frontend performs its own read-only stable-release check against the
 * public GitHub API and reports that honestly, but it never claims a download
 * or installation happened and never invents progress.
 */

export const BRIDGE_NAME = 'ytarkUpdater';
export const CONTRACT_VERSION = 1;
export const RELEASES_API = 'https://api.github.com/repos/2archiver/YTArk/releases/latest';
export const RELEASE_ASSET_PREFIX = 'https://github.com/2archiver/YTArk/releases/download/';

export const COMMANDS = Object.freeze([
  'check',
  'download',
  'cancel',
  'install',
  'later',
  'skip',
  'open',
  'clearError',
]);

const CLEAN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LEGACY_VERSION = /^(\d+\.\d+\.\d+)-(?:ytark|personal)\.[1-9]\d*$/;
const VERSION_CODE_PATTERN = /version\s*code\s*[:=]?\s*(\d+)/i;

/** Valid engine states; the frontend only renders what it recognizes. */
export const ENGINE_STATES = Object.freeze([
  'idle',
  'checking',
  'current',
  'available',
  'check_error',
  'downloading',
  'verifying',
  'ready_to_install',
  'permission_required',
  'awaiting_installer',
  'installed',
  'installation_cancelled',
  'install_error',
  'download_error',
]);

export function versionCodeForVersion(version) {
  const match = CLEAN_VERSION.exec(String(version || ''));
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major <= 0 || minor >= 100 || patch >= 100) return null;
  return major * 1000000 + minor * 10000 + patch * 100;
}

export function numericVersionKey(version) {
  const value = String(version || '');
  const legacy = LEGACY_VERSION.exec(value);
  const clean = LEGACY_VERSION.exec(value) ? legacy[1] : value;
  const match = CLEAN_VERSION.exec(clean);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), legacy ? 0 : 1];
}

export function isNewerVersion(candidate, installed) {
  const left = numericVersionKey(candidate);
  const right = numericVersionKey(installed);
  if (!left) return false;
  if (!right) return true;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return false;
}

export function displayVersion(version) {
  const value = String(version || '');
  const legacy = LEGACY_VERSION.exec(value);
  if (legacy) return legacy[1];
  const match = CLEAN_VERSION.exec(value);
  if (!match) return value || 'unknown';
  return match[3] === '0' ? `${match[1]}.${match[2]}` : value;
}

export function assetSuffixForArchitecture(architecture) {
  if (architecture === 'arm64-v8a') return 'arm64';
  if (architecture === 'armeabi-v7a') return 'armv7';
  return null;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Validate one engine state snapshot; unknown or malformed data is rejected. */
export function parseNativeState(payload) {
  let state = payload;
  if (typeof payload === 'string') {
    try {
      state = JSON.parse(payload);
    } catch (_) {
      return null;
    }
  }
  if (!isPlainObject(state)) return null;
  if (state.contract !== CONTRACT_VERSION) return null;
  if (typeof state.state !== 'string' || !ENGINE_STATES.includes(state.state)) return null;

  const installed = isPlainObject(state.installed) ? state.installed : {};
  const available = isPlainObject(state.available) ? state.available : null;
  const download = isPlainObject(state.download) ? state.download : {};
  const numberOrZero = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  return {
    contract: CONTRACT_VERSION,
    state: state.state,
    installed: {
      version: typeof installed.version === 'string' ? installed.version : 'unknown',
      display: typeof installed.display === 'string' && installed.display
        ? installed.display : displayVersion(installed.version),
      code: numberOrZero(installed.code),
    },
    available: available && typeof available.version === 'string' ? {
      version: available.version,
      display: typeof available.display === 'string' && available.display
        ? available.display : displayVersion(available.version),
      tag: typeof available.tag === 'string' ? available.tag : '',
      abi: typeof available.abi === 'string' ? available.abi : 'unknown',
      size: numberOrZero(available.size),
      notes: typeof available.notes === 'string' ? available.notes : '',
    } : null,
    lastSuccessAt: numberOrZero(state.lastSuccessAt),
    lastAttemptAt: numberOrZero(state.lastAttemptAt),
    nextCheckAt: numberOrZero(state.nextCheckAt),
    error: typeof state.error === 'string' ? state.error : '',
    download: {
      active: download.active === true,
      phase: typeof download.phase === 'string' ? download.phase : 'idle',
      received: numberOrZero(download.received),
      total: numberOrZero(download.total),
    },
    verified: state.verified === true,
    permissionRequired: state.permissionRequired === true,
    snoozed: state.snoozed === true,
    skipped: state.skipped === true,
  };
}

/** Build a validated bridge command; anything unknown is refused locally. */
export function buildCommand(command, payload) {
  if (!COMMANDS.includes(command)) return null;
  const request = { contract: CONTRACT_VERSION, command };
  if (payload && isPlainObject(payload)) {
    for (const key of Object.keys(payload)) {
      if (key === 'tag' && typeof payload.tag === 'string' && /^v\d+\.\d+\.\d+$/.test(payload.tag)) {
        request.tag = payload.tag;
      }
    }
  }
  return JSON.stringify(request);
}

/**
 * Validate the public stable-release payload for the fallback (read-only)
 * check. Returns `{ release }` or `{ error }`; it never throws.
 */
export function validateReleasePayload(payload, { installedVersion, architecture } = {}) {
  if (!isPlainObject(payload)) return { error: 'The release response was not an object.' };
  if (payload.message === 'Not Found') {
    return { error: 'No stable YTArk release is published yet.' };
  }
  if (payload.draft !== false || payload.prerelease !== false) {
    return { error: 'The latest release is not a published stable release.' };
  }
  const tag = String(payload.tag_name || '');
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    return { error: `The release tag ${tag || '(missing)'} is not a clean stable version.` };
  }
  const version = tag.slice(1);
  const expectedCode = versionCodeForVersion(version);
  if (expectedCode === null) return { error: 'The release version is outside the YTArk mapping.' };
  const body = String(payload.body || '');
  const bodyCode = VERSION_CODE_PATTERN.exec(body);
  if (!bodyCode || Number(bodyCode[1]) !== expectedCode) {
    return { error: 'The release notes do not confirm the expected Android versionCode.' };
  }
  const suffix = assetSuffixForArchitecture(architecture);
  if (!suffix) {
    return { error: 'This device does not report a supported ARM ABI for YTArk updates.' };
  }
  const assetName = `YTArk-v${version}-${suffix}.apk`;
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const matches = assets.filter(asset => isPlainObject(asset) && asset.name === assetName);
  if (matches.length !== 1) {
    return {
      error: `The release has ${matches.length} assets named ${assetName}; expected exactly one.`,
    };
  }
  const asset = matches[0];
  const expectedUrl = `${RELEASE_ASSET_PREFIX}${tag}/${assetName}`;
  if (asset.browser_download_url !== expectedUrl) {
    return { error: 'The release asset URL does not match the official YTArk release metadata.' };
  }
  const digest = typeof asset.digest === 'string'
    ? asset.digest.replace(/^sha256:/i, '').toLowerCase() : '';
  const release = {
    tag,
    version,
    display: displayVersion(version),
    versionCode: expectedCode,
    assetName,
    size: Number(asset.size) > 0 ? Number(asset.size) : 0,
    notes: cleanNotes(body),
    abi: architecture,
  };
  if (digest && !/^[0-9a-f]{64}$/.test(digest)) {
    return { error: 'The release asset digest is malformed.' };
  }
  release.sha256Published = digest;
  release.newer = isNewerVersion(version, installedVersion);
  return { release };
}

export function cleanNotes(body) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  const kept = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (kept.length) kept.push('');
      continue;
    }
    if (/version\s*code/i.test(line)) continue;
    if (/^#{1,6}\s*$/.test(line)) continue;
    kept.push(line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, ''));
    if (kept.join('\n').length > 1200) break;
  }
  return kept.join('\n').trim();
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

export function formatTimestamp(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return '';
  }
}

/**
 * Actions the current state allows. Keeping this table next to the state
 * machine prevents inert buttons and double submissions.
 */
export function actionsForState(state) {
  const actions = [];
  const busy = ['checking', 'downloading', 'verifying', 'awaiting_installer']
    .includes(state.state);
  if (!busy) actions.push({ id: 'check', label: 'Check for updates' });
  switch (state.state) {
    case 'available':
      actions.push({ id: 'download', label: 'Download update' });
      actions.push({ id: 'skip', label: 'Skip this version' });
      actions.push({ id: 'later', label: 'Later' });
      break;
    case 'downloading':
      actions.push({ id: 'cancel', label: 'Cancel download' });
      break;
    case 'download_error':
      actions.push({ id: 'download', label: 'Resume download' });
      break;
    case 'ready_to_install':
    case 'installation_cancelled':
      actions.push({ id: 'install', label: 'Install update' });
      actions.push({ id: 'later', label: 'Later' });
      break;
    case 'permission_required':
      actions.push({ id: 'install', label: 'Allow install and continue' });
      break;
    case 'install_error':
      actions.push({ id: 'install', label: 'Retry install' });
      break;
    default:
      break;
  }
  if (!busy || state.state === 'awaiting_installer') {
    if (!actions.some(action => action.id === 'open')) {
      actions.push({ id: 'open', label: 'Open YTArk Updates screen' });
    }
  }
  return actions;
}

/** Human-readable status line for one validated engine state. */
export function describeState(state) {
  switch (state.state) {
    case 'checking':
      return 'Checking the official YTArk stable release…';
    case 'current':
      return `You are running the latest published stable ${'YTArk'} release.`;
    case 'available':
      return state.available
        ? `YTArk ${state.available.display} is available for this device.`
        : 'An update is available.';
    case 'check_error':
      return state.error || 'The update check did not complete. Your installed app is unchanged.';
    case 'downloading': {
      const { received, total } = state.download;
      if (total > 0) {
        const percent = Math.max(0, Math.min(100, Math.floor((received * 100) / total)));
        return `Downloading YTArk update… ${percent}% (${formatBytes(received)} of ${formatBytes(total)})`;
      }
      return `Downloading YTArk update… ${formatBytes(received) || 'starting'}`;
    }
    case 'verifying':
      return 'Download complete. Verifying checksum, package identity, ABI and signing certificate…';
    case 'ready_to_install':
      return 'The update is verified and ready. Android will ask you to confirm the install.';
    case 'permission_required':
      return 'Android needs one-time permission for YTArk to open the package installer.';
    case 'awaiting_installer':
      return 'Waiting for Android to confirm the installation…';
    case 'installed':
      return 'Android confirms the new YTArk version is installed. Your app data was kept.';
    case 'installation_cancelled':
      return 'The installer closed without confirming. Your current YTArk version and data remain.';
    case 'install_error':
      return state.error || 'Android did not complete the installation. You can retry safely.';
    case 'download_error':
      return state.error || 'The update download did not complete. You can resume or retry.';
    case 'idle':
    default:
      return 'Ready to check the official YTArk stable release.';
  }
}
