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

/**
 * YTArk publishes ARMv7 (`armeabi-v7a`) releases only from 2.1.2 onwards, so
 * only that ABI maps to a release asset. Asset selection happens exclusively
 * on a `compatible` verdict (see features/abiEvidence.js): a missing, delayed,
 * empty, malformed or 64-bit-only report is missing information (`unknown`)
 * and never a categorical "unsupported device" result.
 */
export function assetSuffixForArchitecture(architecture) {
  return architecture === 'armeabi-v7a' ? 'armv7' : null;
}

/** Status line for the unknown-ABI case: missing information, not a verdict. */
export function unknownArchitectureMessage(evidence) {
  const details = evidence && Array.isArray(evidence.details) ? evidence.details : [];
  const body = details.length ? details.join(' ') : 'The architecture query returned no usable value.';
  return 'Could not confirm this device\'s app architecture. ' + body
    + ' The release check, release notes and retrying detection still work; the manual '
    + 'route on the official release page always does.';
}

/** Status line for the explicit non-ARM case (the only categorical message). */
export function incompatibleArchitectureMessage(evidence) {
  const bridge = evidence && evidence.bridge && evidence.bridge.abi ? evidence.bridge.abi : 'a non-ARM architecture';
  return `This device reports ${bridge} as its first supported Android ABI, a non-ARM userspace. `
    + 'YTArk publishes ARMv7 (armeabi-v7a) builds only, so no YTArk release is compatible '
    + 'with this device. The official release page is still opened below for reference.';
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
 *
 * Asset selection is verdict-driven: a `compatible` verdict (explicit
 * armeabi-v7a evidence or trusted installed-build evidence) requires exactly
 * one official ARMv7 asset with the exact URL and a published SHA-256 digest.
 * An `unknown` or `incompatible` verdict returns the release metadata for the
 * manual route WITHOUT selecting any asset — there is nothing to install
 * automatically in this surface, so no asset is ever guessed.
 */
export function validateReleasePayload(payload, { installedVersion, architecture, abiVerdict } = {}) {
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
  // Verdict resolution: an explicit verdict wins. Callers that only pass an
  // architecture keep the legacy input shape: exact armeabi-v7a is compatible
  // evidence; anything else (64-bit report, empty, malformed) is missing
  // information, i.e. unknown — never a categorical unsupported result.
  const verdict = abiVerdict
    || (assetSuffixForArchitecture(architecture) ? 'compatible' : 'unknown');
  if (verdict !== 'compatible' && verdict !== 'unknown' && verdict !== 'incompatible') {
    return { error: 'The release check was given an unusable architecture verdict.' };
  }
  if (verdict === 'compatible' && !assetSuffixForArchitecture(architecture)) {
    // Inconsistent evidence (features/abiEvidence.js only ever reports
    // "compatible" with an exact armeabi-v7a architecture). Refuse the check
    // instead of guessing an asset name from a missing or alien value.
    return { error: 'The release check was given inconsistent architecture evidence.' };
  }
  const baseRelease = {
    tag,
    version,
    display: displayVersion(version),
    versionCode: expectedCode,
    abi: verdict === 'compatible' ? architecture : null,
    abiVerdict: verdict,
    notes: cleanNotes(body),
    newer: isNewerVersion(version, installedVersion),
  };
  if (verdict !== 'compatible') {
    // No asset selection without compatible evidence: the UI shows the
    // verified release metadata and the manual route instead.
    return { release: baseRelease };
  }
  const assetName = `YTArk-v${version}-${assetSuffixForArchitecture(architecture)}.apk`;
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const matches = assets.filter(asset => isPlainObject(asset) && asset.name === assetName);
  if (matches.length !== 1) {
    return {
      error: `The release has ${matches.length} assets named ${assetName}; expected exactly one. `
        + 'No arm64, unsigned, source or first-asset fallback is ever selected.',
    };
  }
  const asset = matches[0];
  const expectedUrl = `${RELEASE_ASSET_PREFIX}${tag}/${assetName}`;
  if (asset.browser_download_url !== expectedUrl) {
    return { error: 'The release asset URL does not match the official YTArk release metadata.' };
  }
  const digest = typeof asset.digest === 'string'
    ? asset.digest.replace(/^sha256:/i, '').toLowerCase() : '';
  if (!digest || !/^[0-9a-f]{64}$/.test(digest)) {
    return { error: 'The release asset has no valid published SHA-256 digest.' };
  }
  return {
    release: Object.assign(baseRelease, {
      assetName,
      size: Number(asset.size) > 0 ? Number(asset.size) : 0,
      sha256Published: digest,
    }),
  };
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
      return state.installedAhead
        ? 'This build is newer than the latest published stable YTArk release. Nothing was changed.'
        : 'Up to date: the latest published stable YTArk release is installed (as of the last successful check).';
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

export const RELEASES_PAGE = 'https://github.com/2archiver/YTArk/releases';
export const LATEST_RELEASE_PAGE = `${RELEASES_PAGE}/latest`;

/**
 * Official, human-openable release page for the manual-install fallback.
 * Only a clean vX.Y.Z tag is turned into a tag URL; anything else falls back
 * to the latest stable release page so the link never points at a guess.
 */
export function officialReleasePageUrl(tag) {
  const clean = typeof tag === 'string' && /^v\d+\.\d+\.\d+$/.test(tag);
  return clean ? `${RELEASES_PAGE}/tag/${tag}` : LATEST_RELEASE_PAGE;
}
