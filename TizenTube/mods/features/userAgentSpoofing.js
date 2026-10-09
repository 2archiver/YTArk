import { configRead, configWrite, configChangeEmitter } from '../config.js';

// Profiles retained for services that behave differently on a known Cobalt TV
// UA. They are opt-in and must never be used to infer Android APK architecture.
const DEVICE_PROFILES = {
  androidTv64: {
    architecture: 'Linux arm64-v8a',
    os: 'Android 10',
    rasterizer: 'gles',
    manufacturer: 'Sony',
    deviceType: 'ATV',
    chipsetModel: 'sdm845',
    modelYear: 13140765,
    firmwareVersion: '52.1.C.0.268',
    brand: 'KDDI',
    model: 'SOV38',
  },
  androidTv32: {
    architecture: 'Linux armeabi-v7a',
    os: 'Android 14',
    rasterizer: 'gles',
    manufacturer: 'Google',
    deviceType: 'ATV',
    chipsetModel: 'sabrina',
    modelYear: 2020,
    firmwareVersion: 'UTTC.250917.004',
    brand: 'google',
    model: 'Chromecast',
  },
  tclTv32: {
    architecture: 'Linux armeabi-v7a',
    os: 'Android 12',
    rasterizer: 'gles',
    manufacturer: 'TCL',
    deviceType: 'ATV',
    chipsetModel: 'merak',
    modelYear: 2023,
    firmwareVersion: 'STT2.221228.001',
    brand: 'TCL',
    model: 'Smart TV Pro',
  },
  fireTv32: {
    architecture: 'Linux armeabi-v7a',
    os: 'Android 7.1.2',
    rasterizer: 'gles',
    manufacturer: 'Amazon',
    deviceType: 'ATV',
    chipsetModel: 'mt8695',
    modelYear: 0,
    firmwareVersion: 'NS6294',
    brand: 'Amazon',
    model: 'AFTMM',
  },
};

const COBALT_VERSION = '25.lts.30.1034958-gold';
const V8_VERSION = 'v8/8.8.278.17-jit';
const STARBOARD_VERSION = '15';
const AUX_FIELD = 'com.google.android.youtube.tv/5.30.301';
const APPLIED_KEY = 'ytark-user-agent-transition';
const RESET_KEY = 'ytark-user-agent-reset-transition';
const RESET_TOKEN = 'native-cobalt-v1';
let handlingConfigChange = false;

export function generateUserAgent(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return `Mozilla/5.0 (${profile.architecture}; ${profile.os}) Cobalt/${COBALT_VERSION} (unlike Gecko) ${V8_VERSION} ${profile.rasterizer} Starboard/${STARBOARD_VERSION}, ${profile.manufacturer}_${profile.deviceType}_${profile.chipsetModel}_${profile.modelYear}/${profile.firmwareVersion} (${profile.brand}, ${profile.model}) ${AUX_FIELD}`;
}

function getStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function profileToken(name, userAgent) {
  // Exact UA string is stable and bounded; no random selection or architecture
  // inference is involved in this transition key.
  return `${name}:${userAgent}`;
}

/** Apply one known profile at most once per explicit profile transition. */
export function applyUserAgentProfile(profileName, bridge, locationRef, storageRef) {
  const storage = getStorage(storageRef);
  const profile = DEVICE_PROFILES[profileName];
  if (!storage || !profile || !bridge || typeof bridge.SetUserAgent !== 'function') {
    return { applied: false, reloaded: false, reason: 'unsupported-profile-or-bridge' };
  }

  const userAgent = generateUserAgent(profile);
  const token = profileToken(profileName, userAgent);
  try {
    if (storage.getItem(APPLIED_KEY) === token) {
      return { applied: true, reloaded: false, reason: 'already-applied' };
    }

    if (typeof bridge.GetUserAgent === 'function') {
      try {
        if (bridge.GetUserAgent() === userAgent) {
          storage.setItem(APPLIED_KEY, token);
          return { applied: true, reloaded: false, reason: 'already-active' };
        }
      } catch (_) {
        // Some Cobalt builds expose SetUserAgent without a getter; continue with
        // the persisted, one-shot transition guard below.
      }
    }

    // Persist before changing/reloading. If Cobalt cannot persist the browser UA,
    // do not reload so this can never become an unbounded startup loop.
    storage.removeItem(RESET_KEY);
    storage.setItem(APPLIED_KEY, token);
    storage.setItem('userAgent', userAgent); // migrate older YTArk profile storage
    try {
      bridge.SetUserAgent(userAgent);
    } catch (error) {
      storage.removeItem(APPLIED_KEY);
      storage.removeItem('userAgent');
      throw error;
    }
    const currentLocation = locationRef || (typeof location !== 'undefined' ? location : null);
    if (currentLocation && typeof currentLocation.reload === 'function') {
      currentLocation.reload();
      return { applied: true, reloaded: true, reason: 'profile-transition' };
    }
    return { applied: true, reloaded: false, reason: 'profile-set' };
  } catch (error) {
    console.warn('[YTArk] Could not apply the selected Cobalt user-agent profile:', error);
    return { applied: false, reloaded: false, reason: 'apply-failed' };
  }
}

/** Remove the opt-in override and request a native Cobalt reset once. */
export function resetUserAgentProfile(bridge, locationRef, storageRef) {
  const storage = getStorage(storageRef);
  if (!storage) return { applied: false, reloaded: false, reason: 'storage-unavailable' };

  try {
    if (storage.getItem(RESET_KEY) === RESET_TOKEN) {
      storage.removeItem('userAgent');
      storage.removeItem(APPLIED_KEY);
      return { applied: true, reloaded: false, reason: 'already-reset' };
    }
    storage.setItem(RESET_KEY, RESET_TOKEN);
    storage.setItem(APPLIED_KEY, 'native');
    storage.removeItem('userAgent');

    if (bridge && typeof bridge.ResetUserAgent === 'function') {
      bridge.ResetUserAgent();
    } else if (bridge && typeof bridge.SetUserAgent === 'function') {
      // The Cobalt bridge uses an empty override to return to its built-in UA.
      bridge.SetUserAgent('');
    }

    if (!handlingConfigChange) {
      handlingConfigChange = true;
      configWrite('userAgentProfile', 'native');
      handlingConfigChange = false;
    }

    const currentLocation = locationRef || (typeof location !== 'undefined' ? location : null);
    if (currentLocation && typeof currentLocation.reload === 'function') {
      currentLocation.reload();
      return { applied: true, reloaded: true, reason: 'native-reset' };
    }
    return { applied: true, reloaded: false, reason: 'native-reset' };
  } catch (error) {
    handlingConfigChange = false;
    console.warn('[YTArk] Could not reset the Cobalt user-agent profile:', error);
    return { applied: false, reloaded: false, reason: 'reset-failed' };
  }
}

function bridgeForWindow() {
  return typeof window !== 'undefined' && window.h5vcc
    && window.h5vcc.tizentube ? window.h5vcc.tizentube : null;
}

function applyConfiguredProfile(profileName) {
  const bridge = bridgeForWindow();
  if (profileName === 'native' || !profileName) {
    // The ordinary default is the real Cobalt UA. Explicit reset is available
    // from YTArk settings if a previous opt-in profile needs recovery.
    return;
  }
  applyUserAgentProfile(profileName, bridge);
}

let savedProfileWait = null;

function applySavedProfileWhenReady() {
  const profile = configRead('userAgentProfile');
  if (!profile || profile === 'native') return true;
  const contentContainer = typeof document !== 'undefined'
    && document.querySelector('.content-container');
  const bridge = bridgeForWindow();
  if (!contentContainer || !bridge || typeof bridge.SetUserAgent !== 'function') return false;
  applyConfiguredProfile(profile);
  return true;
}

function startSavedProfileTransition() {
  if (typeof document === 'undefined' || applySavedProfileWhenReady()) return;
  if (savedProfileWait !== null) return;
  let attempts = 0;
  savedProfileWait = setInterval(() => {
    attempts += 1;
    if (applySavedProfileWhenReady() || attempts >= 80) {
      clearInterval(savedProfileWait);
      savedProfileWait = null;
    }
  }, 250);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSavedProfileTransition, { once: true });
  } else {
    startSavedProfileTransition();
  }
}

configChangeEmitter.addEventListener('configChange', (event) => {
  if (handlingConfigChange || !event.detail || event.detail.key !== 'userAgentProfile') return;
  if (event.detail.value === 'native') {
    resetUserAgentProfile(bridgeForWindow());
  } else {
    applyConfiguredProfile(event.detail.value);
  }
});

export { DEVICE_PROFILES };
