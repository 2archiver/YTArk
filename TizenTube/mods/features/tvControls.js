/**
 * YTArk Quick Controls
 *
 * Adds TV-optimized presets, theme management, quick quality selection,
 * and a one-level undo to the YTArk settings UI.
 *
 * Presets change only their listed keys, leaving accounts and unrelated
 * preferences alone. Native Android update controls are provided by YTArk.
 */

import { configRead, configWrite } from '../config.js';
import updateStyle from '../ui/theme.js';

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const PRESETS = {
  cleanTV: {
    label: 'Clean TV',
    changes: {
      enableShorts: false,
      enablePreviews: false,
      enableHideEndScreenCards: true,
      hideRelatedVideosPlayer: true,
      enablePaidPromotionOverlay: false,
      enableYouThereRenderer: false,
    },
  },
  midnightBlue: {
    label: 'Midnight Blue',
    changes: {
      focusContainerColor: '#0a1628',
      routeColor: '#0d1f3c',
    },
  },
  classicDark: {
    label: 'Classic Dark',
    changes: {
      focusContainerColor: '#0f0f0f',
      routeColor: '#0f0f0f',
    },
  },
};

// ---------------------------------------------------------------------------
// Preset application with one-level undo
// ---------------------------------------------------------------------------

function takeSnapshot(keys) {
  const snap = {};
  for (const k of keys) {
    snap[k] = configRead(k);
  }
  return snap;
}

function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;

  // Snapshot current values for the keys this preset touches
  const keys = Object.keys(preset.changes);
  const snapshot = takeSnapshot(keys);

  // Save snapshot for undo
  configWrite('tvLastPresetSnapshot', JSON.stringify({ presetKey, snapshot }));
  configWrite('tvActivePreset', presetKey);

  // Apply each change
  for (const [k, v] of Object.entries(preset.changes)) {
    configWrite(k, v);
  }

  // Update theme stylesheet if colors changed
  if (preset.changes.focusContainerColor || preset.changes.routeColor) {
    updateThemeStylesheet();
  }
}

function undoLastPreset() {
  const raw = configRead('tvLastPresetSnapshot');
  if (!raw) return false;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  const { snapshot } = parsed;
  if (!snapshot || typeof snapshot !== 'object') return false;

  for (const [k, v] of Object.entries(snapshot)) {
    configWrite(k, v);
  }

  configWrite('tvActivePreset', null);
  configWrite('tvLastPresetSnapshot', null);

  // Update theme stylesheet if colors were restored
  if (snapshot.focusContainerColor !== undefined || snapshot.routeColor !== undefined) {
    updateThemeStylesheet();
  }

  return true;
}

// ---------------------------------------------------------------------------
// Theme stylesheet management — shared with ui/theme.js
// ---------------------------------------------------------------------------

function updateThemeStylesheet() {
  updateStyle();
}

// ---------------------------------------------------------------------------
// Quick quality selection
// ---------------------------------------------------------------------------

const QUALITY_LEVELS = ['auto', '2160', '1440', '1080', '720'];

function setQuickQuality(level) {
  configWrite('tvQuickQuality', level);
  if (level === 'auto') {
    configWrite('preferredVideoQuality', 'auto');
  } else {
    configWrite('preferredVideoQuality', level + 'p');
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init() {
  // Restore theme from config on startup.
  updateThemeStylesheet();
}

// Run init when module loads
init();

// ---------------------------------------------------------------------------
// Exports for the settings UI and resolveCommand
// ---------------------------------------------------------------------------

export {
  PRESETS,
  QUALITY_LEVELS,
  applyPreset,
  undoLastPreset,
  setQuickQuality,
  updateThemeStylesheet,
};
