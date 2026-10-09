import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const storage = {};
const mockLocalStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null; },
  setItem(key, value) { this[key] = String(value); },
  removeItem(key) { delete this[key]; },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage, configurable: true, writable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: { localStorage: mockLocalStorage, h5vcc: null }, configurable: true, writable: true,
});
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
}

const { configRead, configWrite } = await import('../config.js');
const { PreferredQualityHandler, resolution } = await import('../features/preferredVideoQuality.js');

describe('requested stream quality is bounded by available quality data', () => {
  it('defaults to Auto and resolves only supplied qualities at or below the selected ceiling', () => {
    assert.equal(configRead('preferredVideoQuality'), 'auto');
    const handler = new PreferredQualityHandler(null);
    const available = [
      { quality: 'hd2160', qualityLabel: '2160p' },
      { quality: 'hd1440', qualityLabel: '1440p' },
      { quality: 'hd1080', qualityLabel: '1080p' },
      { quality: 'hd720', qualityLabel: '720p60' },
    ];
    assert.equal(handler.determineQuality('2160p', available).quality, 'hd2160');
    assert.equal(handler.determineQuality('1440p', available).quality, 'hd1440');
    assert.equal(handler.determineQuality('1080p', available).quality, 'hd1080');
    assert.equal(handler.determineQuality('720p', available).quality, 'hd720');
    assert.equal(handler.determineQuality('480p', available), null);
    assert.equal(handler.determineQuality('720p', [{ quality: 'uhd', qualityLabel: '2160p' }]), null);
    assert.equal(resolution('1080p60'), 1080);
    handler.destroy();
  });

  it('requests only formats present in the player and falls back once to a lower level or Auto', () => {
    const handler = new PreferredQualityHandler(null);
    const calls = [];
    let currentQuality = 'hd1440';
    handler.player = {
      getAvailableQualityData() {
        return [
          { quality: 'hd1440', qualityLabel: '1440p' },
          { quality: 'hd1080', qualityLabel: '1080p' },
        ];
      },
      setPlaybackQualityRange(minimum, maximum) {
        calls.push([minimum, maximum]);
        currentQuality = minimum;
        return true;
      },
      getPlaybackQuality() { return currentQuality; },
    };

    assert.equal(handler.applyQuality('2160p'), true);
    assert.deepEqual(calls[0], ['hd1440', 'hd1440']);
    assert.equal(window.__ytarkQualityStatus.selected, '2160p');
    assert.equal(window.__ytarkQualityStatus.actual, '1440p');

    configWrite('preferredVideoQuality', '2160p');
    handler.fallbackAttempted = false;
    handler.handleVideoError();
    assert.deepEqual(calls[1], ['hd1440', 'hd1440']);
    assert.equal(handler.fallbackAttempted, true);
    handler.handleVideoError();
    assert.equal(calls.length, 2, 'a second video error must not start another fallback loop');
    handler.destroy();
  });
});
