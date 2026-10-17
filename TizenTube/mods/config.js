// YTArk userscript configuration.
import { isSafeStartupDestination } from './features/startupDestination.js';
//
// Every YTArk preference lives in one JSON object stored under
// localStorage['ytaf-configuration']. The key name is inherited from TizenTube
// and is kept so that saved preferences survive every update. YTArk never
// reads or writes Google account, cookie or session storage from here.
//
// Schema history
//   (no marker)  YTArk <= 2.2.0: missing keys were merged from defaults.
//   2            YTArk 2.3.0: explicit `configSchemaVersion`. The appearance and
//                player-cleanup keys introduced in 2.3 receive install-type-aware
//                defaults exactly once (see migrateConfig) and explicit stored
//                choices win from then on.
//   3            YTArk 2.5.0: retired preferences are removed from the stored
//                object (see RETIRED_KEYS). Every retained preference keeps its
//                value, including the individual settings a removed preset had
//                already applied; only the removed keys and their bookkeeping
//                disappear. The values a retired key held are reported once
//                through getConfigMeta().retiredValues so a feature can finish
//                its own cleanup (the retired Cobalt user-agent override).
//   4            YTArk 2.8.0: adds opt-in playback recovery; it defaults off and
//                merges without changing stored preferences or YouTube session data.
//   5            Removes the legacy startup-animation keys (the original marker-5
//                release is documented in docs/SETTINGS-3.5-AUDIT.md).
//   6            Adds default-off browser diagnostic recording. Existing settings
//                are merged missing-key-only; explicit user choices are retained.
//   7            Adds a local cold/warm label for comparing future startup samples.
//                It does not enable diagnostics or change any runtime setting.

const CONFIG_KEY = 'ytaf-configuration';
export const CONFIG_SCHEMA_VERSION = 7;

/**
 * Preferences that no longer exist, with the schema that retired them.
 *
 *   userAgentProfile      the user-selectable Cobalt user-agent override
 *                         (removed with its settings rows; the platform's own
 *                         user agent is the only one YTArk uses)
 *   enableFixedUI         the vague "Fix UI" toggle (it only flipped YouTube's
 *                         own animation/quality switches and defaulted to off
 *                         on the Cobalt build)
 *   tvActivePreset        preset bookkeeping (Presets and Undo Preset removed)
 *   tvLastPresetSnapshot  the orphaned undo snapshot
 *   tvQuickQuality        duplicate of `preferredVideoQuality`, which is the
 *                         one authoritative quality preference
 *   videoPreferredCodec   legacy duplicate of `preferredVideoCodec`; its value
 *                         is copied to the key the player reads before it is
 *                         dropped (see migrateConfig)
 *   uiTheme               the OLED/youtube theme choice (the OLED theme was
 *                         removed in 3.0; the stored value is discarded, the
 *                         app keeps the normal YouTube/YTArk theming and the
 *                         user's custom colours)
 */
export const RETIRED_KEYS = Object.freeze([
  'userAgentProfile',
  'enableFixedUI',
  'tvActivePreset',
  'tvLastPresetSnapshot',
  'tvQuickQuality',
  'videoPreferredCodec',
  'uiTheme',
  'skipStartupAnimation',
  'enableSkipStartupAnimation',
]);
/** Presence of YouTube TV's own storage means the app has run before. Only the
 * existence of the key is checked; its contents are never read. */
const LEANBACK_HISTORY_KEY = 'yt.leanback.default::recurring_actions';
/** `lastSeenVersion` value for an installation migrated from <= 2.2. */
export const LEGACY_VERSION_MARKER = 'legacy';

/** Defaults of a fresh installation; these are also the product defaults. */
export const FRESH_INSTALL_DEFAULTS = Object.freeze({
  hidePlayerWatermark: true,
  removePlayerScrim: true,
});

/** Values an installation upgraded from <= 2.2 keeps until the user opts in. */
export const UPGRADE_DEFAULTS = Object.freeze({
  hidePlayerWatermark: false,
  removePlayerScrim: false,
});

const defaultConfig = {
  // Client-side ad filtering defaults on for fresh installs; explicit stored
  // user choices are preserved by the missing-key-only merge below.
  enableAdBlock: true,
  enableSponsorBlock: true,
  // A local header-only visual; it never changes account or server entitlements.
  enablePremiumLogo: true,
  enableSponsorBlockToasts: true,
  sponsorBlockManualSkips: ['intro', 'outro', 'filler'],
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockPreview: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockFiller: false,
  enableSponsorBlockHighlight: true,
  videoSpeed: 1,
  preferredVideoQuality: 'auto',
  enableDeArrow: true,
  enableDeArrowThumbnails: false,
  focusContainerColor: '#0f0f0f',
  routeColor: '#0f0f0f',
  enableHqThumbnails: false,
  enableChapters: true,
  enableLongPress: true,
  enableShorts: true,
  dontCheckUpdateUntil: 0,
  enableWhoIsWatchingMenu: false,
  permanentlyEnableWhoIsWatchingMenu: false,
  enableWhosWatchingMenuOnAppExit: false,
  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,
  enablePreviousNextButtons: true,
  enableSuperThanksButton: false,
  enableAIAskButton: false,
  enableSpeedControlsButton: true,
  enablePatchingVideoPlayer: true,
  enableMPButton: true,
  enableSwapMPWithPIP: false,
  enablePreviews: true,
  enableHideWatchedVideos: false,
  hideWatchedVideosThreshold: 80,
  hideWatchedVideosPages: [],
  enableHideEndScreenCards: false,
  enableYouThereRenderer: true,
  lastAnnouncementCheck: 0,
  enableScreenDimming: false,
  dimmingTimeout: 60,
  dimmingOpacity: 0.5,
  enablePaidPromotionOverlay: true,
  speedSettingsIncrement: 0.25,
  // `preferredVideoCodec` is the one codec preference; the legacy
  // `videoPreferredCodec` key is copied into it and then retired (schema 3).
  preferredVideoCodec: 'any',
  launchToOnStartup: null,
  reloadHomeOnStartup: true,
  disabledSidebarContents: [],
  sidebarContentsOrder: [],
  disableChannelsOnSidebar: false,
  // The guide entry keeps YTArk Settings reachable when the sidebar is minimal.
  enableYtarkGuideEntry: true,
  enableUpdater: true,
  // Optional mod-readiness polling acceleration. Essential readiness, session
  // restoration and the engine/system splash are unchanged. Off by default.
  fasterStartup: false,
  // Browser-side startup/playback measurements. Default-off on fresh installs
  // and missing-key-only on upgrades; native updater diagnostics are separate.
  recordBrowserDiagnostics: false,
  // Labels only future local samples; no cold/warm state is inferred from the browser.
  startupDiagnosticRunKind: 'unclassified',
  // Automatic retries are an explicit opt-in because PlayerService.loadVideo is not a general recovery API.
  enablePlaybackRecovery: false,
  autoFrameRate: false,
  autoFrameRatePauseVideoFor: 0,
  enableSigninReminder: false,
  sortSubscriptionsByAlphabet: false,
  enableClock: false,
  isClock12HourFormat: false,
  clockShowSeconds: false,
  clockHideWhenVideoPlaying: false,
  disableEnlargingThumbnails: false,
  enableShrinkingThumbnails: false,
  hideRelatedVideosPlayer: false,

  // YTArk 2.3: appearance and player cleanup (product defaults; installations
  // upgraded from <= 2.2 receive UPGRADE_DEFAULTS once instead).
  ...FRESH_INSTALL_DEFAULTS,
  // Native YouTube Settings page layout. Stable category/row identities only.
  ytSettingsLayout: { order: [], hidden: [], pinned: [], hiddenRows: [] },
  // Sections detected on the native YouTube Settings page (no account data).
  ytSettingsCatalog: null,
  // "What's new" bookkeeping, stored by version only.
  lastSeenVersion: '',
  whatsNewVersion: '',
  whatsNewDismissedVersion: '',
  configSchemaVersion: CONFIG_SCHEMA_VERSION,
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return Array.isArray(value) ? value.slice() : { ...value };
  }
}

function uniqueStrings(list, limit = 100, maxLength = 200) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (typeof item !== 'string' || !item || item.length > maxLength || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export function sanitizeLayout(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    order: uniqueStrings(source.order),
    hidden: uniqueStrings(source.hidden),
    pinned: uniqueStrings(source.pinned, 30),
    hiddenRows: uniqueStrings(source.hiddenRows),
  };
}

const SANITIZERS = {
  launchToOnStartup(value) {
    return value === null || isSafeStartupDestination(value) ? value : null;
  },
  startupDiagnosticRunKind(value) {
    return ['unclassified', 'cold', 'warm'].includes(value) ? value : 'unclassified';
  },
  ytSettingsLayout(value) {
    return sanitizeLayout(value);
  },
  ytSettingsCatalog(value) {
    return isPlainObject(value) && Array.isArray(value.categories) ? value : null;
  },
  sponsorBlockManualSkips(value, fallback) {
    return Array.isArray(value) ? uniqueStrings(value, 20, 40) : cloneValue(fallback);
  },
  hideWatchedVideosPages(value, fallback) {
    return Array.isArray(value) ? uniqueStrings(value, 20, 40) : cloneValue(fallback);
  },
  disabledSidebarContents(value, fallback) {
    return Array.isArray(value) ? uniqueStrings(value, 100, 200) : cloneValue(fallback);
  },
  sidebarContentsOrder(value, fallback) {
    if (!Array.isArray(value)) return cloneValue(fallback);
    return value.filter(item => (typeof item === 'string' && item.length > 0 && item.length <= 200)
      || (isPlainObject(item) && typeof item.browseId === 'string' && item.browseId.length > 0));
  },
};

/**
 * Normalize one stored value against its default. Wrong but unambiguous types
 * are coerced (for example "true" or "80"), anything else falls back to the
 * default so a malformed value cannot crash a feature.
 */
export function normalizeValue(key, value) {
  if (!Object.prototype.hasOwnProperty.call(defaultConfig, key)) return value;
  const fallback = defaultConfig[key];
  if (Object.prototype.hasOwnProperty.call(SANITIZERS, key)) return SANITIZERS[key](value, fallback);
  if (fallback === null) return value === undefined ? null : value;
  switch (typeof fallback) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fallback;
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      return fallback;
    }
    case 'string':
      return typeof value === 'string' ? value : fallback;
    default:
      if (Array.isArray(fallback)) return Array.isArray(value) ? value : cloneValue(fallback);
      if (isPlainObject(fallback)) return isPlainObject(value) ? value : cloneValue(fallback);
      return value;
  }
}

/** Normalize every known key in place; returns the keys that were repaired. */
export function normalizeConfig(config) {
  const repaired = [];
  for (const key of Object.keys(defaultConfig)) {
    if (config[key] === undefined) continue;
    const normalized = normalizeValue(key, config[key]);
    if (JSON.stringify(normalized) !== JSON.stringify(config[key])) {
      config[key] = normalized;
      repaired.push(key);
    }
  }
  return repaired;
}

/**
 * Migrate a stored configuration object to the current schema. Pure: callers
 * decide whether and when to persist the result.
 *
 * @param {object|null} stored     Parsed stored object, or null when absent.
 * @param {{hasLeanbackHistory?: boolean}} env
 * @returns {{config: object, freshInstall: boolean, migratedFrom: number|null,
 *            repaired: string[], changed: boolean}}
 */
export function migrateConfig(stored, env = {}) {
  const config = isPlainObject(stored) ? { ...stored } : {};
  const hadStoredConfig = isPlainObject(stored) && Object.keys(stored).length > 0;
  const storedSchema = Number(config.configSchemaVersion);
  const schema = Number.isFinite(storedSchema) && storedSchema > 0 ? storedSchema : 0;
  let freshInstall = false;
  let migratedFrom = null;
  let changed = false;
  const retiredValues = {};

  if (schema < CONFIG_SCHEMA_VERSION) {
    const existingInstall = hadStoredConfig || env.hasLeanbackHistory === true;
    if (existingInstall) {
      // Keep the current appearance: new options start off until chosen.
      for (const key of Object.keys(UPGRADE_DEFAULTS)) {
        if (config[key] === undefined) config[key] = UPGRADE_DEFAULTS[key];
      }
      if (!config.lastSeenVersion) config.lastSeenVersion = LEGACY_VERSION_MARKER;
      migratedFrom = schema || 1;
    } else {
      freshInstall = true;
    }
    if (config.preferredVideoCodec === undefined && typeof config.videoPreferredCodec === 'string'
        && config.videoPreferredCodec !== 'any') {
      config.preferredVideoCodec = config.videoPreferredCodec;
    }
    // Retire removed preferences. Only these keys go; every retained
    // preference keeps the value the user (or an applied preset) left behind,
    // and account/session storage is never read or written here. The previous
    // values are reported once so a feature can complete its own cleanup.
    for (const key of RETIRED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
      retiredValues[key] = cloneValue(config[key]);
      delete config[key];
      changed = true;
    }
    config.configSchemaVersion = CONFIG_SCHEMA_VERSION;
    changed = true;
  }

  for (const key of Object.keys(defaultConfig)) {
    if (config[key] === undefined) config[key] = cloneValue(defaultConfig[key]);
  }
  const repaired = normalizeConfig(config);
  if (repaired.length) changed = true;
  return { config, freshInstall, migratedFrom, repaired, retiredValues, changed };
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

function storage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

function readStored() {
  const store = storage();
  if (!store) return { value: null, hasLeanbackHistory: false };
  let hasLeanbackHistory = false;
  try {
    const marker = store[LEANBACK_HISTORY_KEY];
    hasLeanbackHistory = marker !== undefined && marker !== null;
  } catch (_) {
    hasLeanbackHistory = false;
  }
  try {
    const stored = store[CONFIG_KEY];
    if (stored === undefined || stored === null || stored === 'undefined' || stored === 'null' || stored === '') {
      return { value: null, hasLeanbackHistory };
    }
    const parsed = JSON.parse(stored);
    if (!isPlainObject(parsed)) {
      console.warn('[YTArk] Saved settings were not an object; defaults are used for this session.');
      // A corrupt object still proves the app has run before.
      return { value: {}, hasLeanbackHistory: true };
    }
    return { value: parsed, hasLeanbackHistory };
  } catch (err) {
    console.warn('[YTArk] Saved settings could not be read; defaults are used for this session:', err);
    return { value: {}, hasLeanbackHistory: true };
  }
}

const loaded = readStored();
const migration = migrateConfig(loaded.value, { hasLeanbackHistory: loaded.hasLeanbackHistory });
const localConfig = migration.config;
const configMeta = Object.freeze({
  freshInstall: migration.freshInstall,
  migratedFrom: migration.migratedFrom,
  repaired: migration.repaired.slice(),
  /** Values of preferences this schema retired, reported exactly once. */
  retired: Object.keys(migration.retiredValues || {}),
  retiredValues: Object.freeze({ ...(migration.retiredValues || {}) }),
  schemaVersion: CONFIG_SCHEMA_VERSION,
});
if (migration.repaired.length) {
  console.warn('[YTArk] Repaired malformed saved settings:', migration.repaired.join(', '));
}

export const configChangeEmitter = {
  listeners: {},
  addEventListener(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    if (this.listeners[type].includes(callback)) return;
    this.listeners[type].push(callback);
  },
  removeEventListener(type, callback) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(cb => cb !== callback);
  },
  listenerCount(type) {
    return this.listeners[type] ? this.listeners[type].length : 0;
  },
  dispatchEvent(event) {
    const type = event.type;
    if (!this.listeners[type]) return;
    this.listeners[type].slice().forEach(cb => {
      try {
        cb.call(this, event);
      } catch (error) {
        console.warn('[YTArk] A settings listener failed:', error);
      }
    });
  }
};

function makeEvent(type, detail) {
  if (typeof CustomEvent === 'function') {
    try {
      return new CustomEvent(type, { detail });
    } catch (_) {
      /* fall through to a plain event object */
    }
  }
  return { type, detail };
}

let persistFailureReported = false;
let lastPersistOk = true;

function persist(reasonKey) {
  const store = storage();
  try {
    if (!store) throw new Error('localStorage is unavailable');
    store[CONFIG_KEY] = JSON.stringify(localConfig);
    lastPersistOk = true;
    return true;
  } catch (err) {
    lastPersistOk = false;
    console.warn('[YTArk] Settings could not be saved:', err);
    if (!persistFailureReported) {
      // One notification per session: the UI shows a single toast.
      persistFailureReported = true;
      configChangeEmitter.dispatchEvent(makeEvent('configPersistError', { key: reasonKey, error: String(err) }));
    }
    return false;
  }
}

// Persist the schema marker once so the migration never runs twice. A fresh
// installation must persist too: on the next launch YouTube's own storage
// exists, and without the marker it would be mistaken for an upgrade.
if (migration.changed) {
  persist('configSchemaVersion');
}

export function configRead(key) {
  if (localConfig[key] === undefined) {
    if (!Object.prototype.hasOwnProperty.call(defaultConfig, key)) {
      console.warn('[YTArk] Unknown setting requested:', key);
      return undefined;
    }
    localConfig[key] = cloneValue(defaultConfig[key]);
  }
  return localConfig[key];
}

export function configDefault(key) {
  return cloneValue(defaultConfig[key]);
}

export function configKeys() {
  return Object.keys(defaultConfig);
}

export function configWrite(key, value) {
  localConfig[key] = value;
  persist(key);
  configChangeEmitter.dispatchEvent(makeEvent('configChange', { key, value }));
}

/** Write several keys with one storage write, then notify for each key. */
export function configWriteMany(values) {
  if (!isPlainObject(values)) return;
  const keys = Object.keys(values);
  if (!keys.length) return;
  for (const key of keys) localConfig[key] = values[key];
  persist(keys[0]);
  for (const key of keys) {
    configChangeEmitter.dispatchEvent(makeEvent('configChange', { key, value: values[key] }));
  }
}

/** Restore the given keys to their defaults (never touches other data). */
export function resetConfigKeys(keys) {
  const values = {};
  for (const key of keys || []) {
    if (Object.prototype.hasOwnProperty.call(defaultConfig, key)) values[key] = cloneValue(defaultConfig[key]);
  }
  configWriteMany(values);
  return Object.keys(values);
}

export function getConfigMeta() {
  return configMeta;
}

export function lastPersistSucceeded() {
  return lastPersistOk;
}
