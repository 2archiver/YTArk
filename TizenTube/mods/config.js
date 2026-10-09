const CONFIG_KEY = 'ytaf-configuration';
const defaultConfig = {
  // Client-side ad filtering defaults on for fresh installs; explicit stored
  // user choices are preserved by the missing-key-only merge below.
  enableAdBlock: true,
  enableSponsorBlock: true,
  // A local header-only visual; it never changes account or server entitlements.
  enablePremiumLogo: true,
  // Native Cobalt is the safe default; profile spoofing is opt-in/experimental.
  userAgentProfile: 'native',
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
  enableFixedUI: (window.h5vcc) ? false : true,
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
  showWelcomeToast: true,
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
  videoPreferredCodec: 'any',
  launchToOnStartup: null,
  reloadHomeOnStartup: true,
  disabledSidebarContents: [],
  sidebarContentsOrder: [],
  disableChannelsOnSidebar: false,
  enableUpdater: true,
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

  // YTArk Quick Controls
  tvActivePreset: null,
  tvLastPresetSnapshot: null,
  tvQuickQuality: null,
};

let localConfig;

try {
  const stored = window.localStorage[CONFIG_KEY];
  if (stored === undefined || stored === null || stored === 'undefined' || stored === 'null') {
    localConfig = {};
  } else {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null) {
      console.warn('Config was not a plain object, resetting to defaults');
      localConfig = {};
    } else {
      localConfig = parsed;
    }
  }
} catch (err) {
  console.warn('Config read failed:', err);
  localConfig = {};
}

// Merge defaults for any missing keys
for (const key of Object.keys(defaultConfig)) {
  if (localConfig[key] === undefined) {
    localConfig[key] = defaultConfig[key];
  }
}

export function configRead(key) {
  if (localConfig[key] === undefined) {
    console.warn('Populating key', key, 'with default value', defaultConfig[key]);
    localConfig[key] = defaultConfig[key];
  }

  return localConfig[key];
}

export function configWrite(key, value) {
  console.info('Setting key', key, 'to', value);
  localConfig[key] = value;
  try {
    window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);
  } catch (err) {
    console.warn('Config write to localStorage failed:', err);
  }
  configChangeEmitter.dispatchEvent(new CustomEvent('configChange', { detail: { key, value } }));
}

export const configChangeEmitter = {
  listeners: {},
  addEventListener(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  },
  removeEventListener(type, callback) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(cb => cb !== callback);
  },
  dispatchEvent(event) {
    const type = event.type;
    if (!this.listeners[type]) return;
    this.listeners[type].forEach(cb => {
      try {
        cb.call(this, event)
      } catch (_) {};
    });
  }
};
