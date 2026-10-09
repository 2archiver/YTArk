/**
 * tv-controls.test.mjs — Unit tests for YTArk Quick Controls
 *
 * Tests cover: quality selection/Auto, malformed config, presets/undo,
 * preservation of unrelated settings, and storage write failure.
 *
 * Run: node tests/tv-controls.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock browser globals (set up BEFORE any module imports)
// ---------------------------------------------------------------------------

let store = {};

const mockLocalStorage = {
  getItem(key) { return key in store ? store[key] : undefined; },
  setItem(key, value) { store[key] = String(value); },
  removeItem(key) { delete store[key]; },
  get length() { return Object.keys(store).length; },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

const mockWindow = {
  localStorage: mockLocalStorage,
  location: { hostname: 'localhost' },
  h5vcc: null,
};
Object.defineProperty(globalThis, 'window', {
  value: mockWindow,
  writable: true,
  configurable: true,
});

const mockStyleElements = [];
const mockDocument = {
  head: { appendChild: () => {} },
  createElement: (tag) => {
    const el = { tagName: tag, textContent: '', setAttribute: () => {}, parentNode: true };
    mockStyleElements.push(el);
    return el;
  },
  querySelector: () => null,
};
Object.defineProperty(globalThis, 'document', {
  value: mockDocument,
  writable: true,
  configurable: true,
});

// Pre-populate with clean defaults before importing modules.
// config.js reads localStorage at import time and merges with defaults.
store['ytaf-configuration'] = JSON.stringify({
  enableAdBlock: true,
  enableShorts: true,
  enablePreviews: true,
  enableHideEndScreenCards: false,
  hideRelatedVideosPlayer: false,
  enablePaidPromotionOverlay: true,
  enableYouThereRenderer: true,
  focusContainerColor: '#0f0f0f',
  routeColor: '#0f0f0f',
  enableUpdater: true,
  preferredVideoQuality: 'auto',
  videoSpeed: 1,
  enableClock: false,
});

// Import modules ONCE — they are ES module singletons
const { configRead, configWrite } = await import('../config.js');
const {
  PRESETS, QUALITY_LEVELS, applyPreset, undoLastPreset, setQuickQuality,
  updateThemeStylesheet,
} = await import('../features/tvControls.js');

// Helper: write a config value and confirm it stuck
function setAndVerify(key, value) {
  configWrite(key, value);
  assert.equal(configRead(key), value, `Expected ${key}=${value}, got ${configRead(key)}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Config resilience', () => {
  it('defaults ad blocking on but preserves an explicit saved opt-out', () => {
    assert.equal(configRead('enableAdBlock'), true);
    setAndVerify('enableAdBlock', false);
    assert.equal(configRead('enableAdBlock'), false);
  });

  it('reads default values for keys not in stored config', () => {
    // configRead should return defaults for any key not explicitly set
    const val = configRead('enableSigninReminder');
    assert.equal(val, false); // default from config.js
  });

  it('does not crash when localStorage write fails', () => {
    const origSetItem = mockLocalStorage.setItem;
    mockLocalStorage.setItem = () => { throw new Error('QuotaExceeded'); };
    // configWrite should not throw even when storage fails
    assert.doesNotThrow(() => configWrite('videoSpeed', 2));
    // Restore
    mockLocalStorage.setItem = origSetItem;
    // The in-memory state should still be updated
    assert.equal(configRead('videoSpeed'), 2);
  });
});

describe('TV Presets — Clean TV', () => {
  it('hides Shorts, previews, end cards, related; preserves others', () => {
    // Set known state for unrelated keys
    setAndVerify('enableAdBlock', false);
    setAndVerify('videoSpeed', 1.5);
    setAndVerify('enableClock', true);
    // Ensure starting state
    setAndVerify('enableShorts', true);
    setAndVerify('enablePreviews', true);

    applyPreset('cleanTV');

    // Preset changes
    assert.equal(configRead('enableShorts'), false);
    assert.equal(configRead('enablePreviews'), false);
    assert.equal(configRead('enableHideEndScreenCards'), true);
    assert.equal(configRead('hideRelatedVideosPlayer'), true);
    assert.equal(configRead('enablePaidPromotionOverlay'), false);
    assert.equal(configRead('enableYouThereRenderer'), false);
    // Unrelated settings preserved
    assert.equal(configRead('enableAdBlock'), false);
    assert.equal(configRead('videoSpeed'), 1.5);
    assert.equal(configRead('enableClock'), true);
  });
});

describe('TV Presets — Midnight Blue', () => {
  it('changes theme colors to midnight blue', () => {
    setAndVerify('focusContainerColor', '#0f0f0f');
    setAndVerify('routeColor', '#0f0f0f');

    applyPreset('midnightBlue');

    assert.equal(configRead('focusContainerColor'), '#0a1628');
    assert.equal(configRead('routeColor'), '#0d1f3c');
  });
});

describe('TV Presets — Classic Dark', () => {
  it('resets colors to classic dark', () => {
    setAndVerify('focusContainerColor', '#0a1628');
    setAndVerify('routeColor', '#0d1f3c');

    applyPreset('classicDark');

    assert.equal(configRead('focusContainerColor'), '#0f0f0f');
    assert.equal(configRead('routeColor'), '#0f0f0f');
  });
});

describe('Preset undo', () => {
  it('restores values from before the last preset', () => {
    setAndVerify('enableShorts', true);
    setAndVerify('enablePreviews', true);

    applyPreset('cleanTV');
    assert.equal(configRead('enableShorts'), false);

    const result = undoLastPreset();
    assert.equal(result, true);
    assert.equal(configRead('enableShorts'), true);
    assert.equal(configRead('enablePreviews'), true);
  });

  it('returns false when no snapshot exists', () => {
    configWrite('tvLastPresetSnapshot', null);
    const result = undoLastPreset();
    assert.equal(result, false);
  });

  it('saves a snapshot when applying a preset', () => {
    applyPreset('cleanTV');
    const snap = configRead('tvLastPresetSnapshot');
    assert.ok(snap, 'Snapshot should be saved');
    const parsed = JSON.parse(snap);
    assert.equal(parsed.presetKey, 'cleanTV');
    assert.ok(parsed.snapshot);
  });

  it('only undoes the last preset, not earlier ones', () => {
    setAndVerify('enableShorts', true);
    setAndVerify('focusContainerColor', '#0f0f0f');

    applyPreset('cleanTV');
    applyPreset('midnightBlue');

    assert.equal(configRead('enableShorts'), false);
    assert.equal(configRead('focusContainerColor'), '#0a1628');

    // Undo midnightBlue
    undoLastPreset();
    assert.equal(configRead('focusContainerColor'), '#0f0f0f');
    // cleanTV effects remain
    assert.equal(configRead('enableShorts'), false);
  });
});

describe('Quality selection', () => {
  it('QUALITY_LEVELS contains expected levels', () => {
    assert.deepEqual(QUALITY_LEVELS, ['auto', '2160', '1440', '1080', '720']);
  });

  it('setQuickQuality writes preferredVideoQuality correctly', () => {
    setQuickQuality('1080');
    assert.equal(configRead('preferredVideoQuality'), '1080p');
    assert.equal(configRead('tvQuickQuality'), '1080');
  });

  it('setQuickQuality auto writes "auto"', () => {
    setQuickQuality('auto');
    assert.equal(configRead('preferredVideoQuality'), 'auto');
  });
});

describe('Updater integration', () => {
  it('leaves web-app preferences intact for the native YTArk updater', () => {
    assert.equal(configRead('enableUpdater'), true);
  });
});

describe('PRESETS definitions', () => {
  it('cleanTV hides Shorts and previews', () => {
    assert.equal(PRESETS.cleanTV.changes.enableShorts, false);
    assert.equal(PRESETS.cleanTV.changes.enablePreviews, false);
  });

  it('midnightBlue sets dark blue colors', () => {
    assert.equal(PRESETS.midnightBlue.changes.focusContainerColor, '#0a1628');
  });

  it('classicDark resets to default dark', () => {
    assert.equal(PRESETS.classicDark.changes.focusContainerColor, '#0f0f0f');
  });
});
