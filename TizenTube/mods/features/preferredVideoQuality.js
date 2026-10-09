import { configRead, configChangeEmitter } from '../config.js';

const PLAYER_SELECTOR = '.html5-video-player';
const RETRY_DELAY_MS = 500;
const MAX_QUALITY_RETRIES = 12;

function resolution(label) {
  const match = String(label || '').match(/(\d{3,4})/);
  return match ? Number(match[1]) : 0;
}

function isElement(node) {
  return !!node && node.nodeType === 1;
}

class PreferredQualityHandler {
  constructor(documentRef) {
    this.document = documentRef || (typeof document !== 'undefined' ? document : null);
    this.player = null;
    this.video = null;
    this.lastVideoId = null;
    this.hasAppliedQuality = false;
    this.retryCount = 0;
    this.retryTimer = null;
    this.attachTimer = null;
    this.reconcileTimer = null;
    this.observer = null;
    this.fallbackAttempted = false;
    this.destroyed = false;
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleVideoReady = this.handleVideoReady.bind(this);
    this.handleVideoError = this.handleVideoError.bind(this);
    this.handleConfigChange = this.handleConfigChange.bind(this);
    this.init();
  }

  init() {
    if (!this.document) return;
    this.destroyed = false;
    configChangeEmitter.addEventListener('configChange', this.handleConfigChange);
    this.observePlayerChanges();
    this.reconcilePlayer();
  }

  observePlayerChanges() {
    if (!this.document || !this.document.body || typeof MutationObserver === 'undefined') return;
    if (this.observer) this.observer.disconnect();
    this.observer = new MutationObserver(records => {
      let relevant = false;
      for (const record of records) {
        const target = record.target;
        if (target && target.closest && target.closest(PLAYER_SELECTOR)) {
          relevant = true;
          break;
        }
        for (const node of Array.from(record.addedNodes || [])) {
          if (isElement(node) && ((node.matches && node.matches(PLAYER_SELECTOR))
              || (node.querySelector && node.querySelector(PLAYER_SELECTOR)))) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
        for (const node of Array.from(record.removedNodes || [])) {
          if (node === this.player || (isElement(node) && node.contains && node.contains(this.player))) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (relevant && this.reconcileTimer === null) {
        this.reconcileTimer = setTimeout(() => {
          this.reconcileTimer = null;
          this.reconcilePlayer();
        }, 100);
      }
    });
    this.observer.observe(this.document.body, { childList: true, subtree: true });
  }

  reconcilePlayer() {
    if (this.destroyed || !this.document) return;
    const nextPlayer = this.document.querySelector(PLAYER_SELECTOR);
    if (!nextPlayer) {
      if (this.attachTimer === null && this.retryCount < MAX_QUALITY_RETRIES) {
        this.attachTimer = setTimeout(() => {
          this.attachTimer = null;
          this.retryCount += 1;
          this.reconcilePlayer();
        }, 500);
      }
      return;
    }
    if (nextPlayer !== this.player) {
      this.detachPlayer();
      this.player = nextPlayer;
      this.lastVideoId = null;
      this.hasAppliedQuality = false;
      this.retryCount = 0;
      this.fallbackAttempted = false;
      if (typeof this.player.addEventListener === 'function') {
        this.player.addEventListener('onStateChange', this.handleStateChange);
      }
      this.attachVideo();
    }
    this.handleStateChange();
  }

  attachVideo() {
    const nextVideo = this.document && this.document.querySelector('video');
    if (nextVideo === this.video) return;
    this.detachVideo();
    this.video = nextVideo;
    if (!this.video || typeof this.video.addEventListener !== 'function') return;
    this.video.addEventListener('loadedmetadata', this.handleVideoReady);
    this.video.addEventListener('canplay', this.handleVideoReady);
    this.video.addEventListener('loadstart', this.handleVideoReady);
    this.video.addEventListener('error', this.handleVideoError);
  }

  detachVideo() {
    if (this.video && typeof this.video.removeEventListener === 'function') {
      this.video.removeEventListener('loadedmetadata', this.handleVideoReady);
      this.video.removeEventListener('canplay', this.handleVideoReady);
      this.video.removeEventListener('loadstart', this.handleVideoReady);
      this.video.removeEventListener('error', this.handleVideoError);
    }
    this.video = null;
  }

  detachPlayer() {
    if (this.player && typeof this.player.removeEventListener === 'function') {
      this.player.removeEventListener('onStateChange', this.handleStateChange);
    }
    this.detachVideo();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  destroy() {
    this.destroyed = true;
    configChangeEmitter.removeEventListener('configChange', this.handleConfigChange);
    clearTimeout(this.attachTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.reconcileTimer);
    this.attachTimer = null;
    this.retryTimer = null;
    this.reconcileTimer = null;
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    this.detachPlayer();
  }

  handleConfigChange(event) {
    if (!event.detail || event.detail.key !== 'preferredVideoQuality') return;
    this.hasAppliedQuality = false;
    this.retryCount = 0;
    this.fallbackAttempted = false;
    this.clearRetry();
    this.applyQuality();
  }

  handleStateChange() {
    if (!this.player) return;
    let videoData = null;
    let state = null;
    try {
      videoData = typeof this.player.getVideoData === 'function'
        ? this.player.getVideoData() : null;
      state = typeof this.player.getPlayerStateObject === 'function'
        ? this.player.getPlayerStateObject() : null;
    } catch (error) {
      console.warn('[YTArk quality] Could not read player state:', error);
    }

    const videoId = videoData && videoData.video_id;
    if (videoId && videoId !== this.lastVideoId) {
      this.lastVideoId = videoId;
      this.hasAppliedQuality = false;
      this.retryCount = 0;
      this.fallbackAttempted = false;
      this.clearRetry();
    }

    const stats = this.getVideoStats();
    const isShorts = Object.values(stats).some(value => value === 'shortspage');
    if (!isShorts && !this.hasAppliedQuality) this.applyQuality();
    if (state && state.isError) this.handleVideoError();
  }

  getVideoStats() {
    if (!this.player || typeof this.player.getVideoStats !== 'function') return {};
    try {
      const stats = this.player.getVideoStats();
      return stats && typeof stats === 'object' ? stats : {};
    } catch (_) {
      return {};
    }
  }

  handleVideoReady() {
    this.attachVideo();
    this.retryCount = 0;
    this.hasAppliedQuality = false;
    this.clearRetry();
    this.applyQuality();
  }

  getAvailableQualities() {
    if (!this.player || typeof this.player.getAvailableQualityData !== 'function') return [];
    try {
      const qualities = this.player.getAvailableQualityData();
      return Array.isArray(qualities) ? qualities.filter(item => item && item.quality) : [];
    } catch (error) {
      console.warn('[YTArk quality] Stream quality data is not available yet:', error);
      return [];
    }
  }

  determineQuality(preference, availableQualities) {
    const targetValue = resolution(preference);
    if (!targetValue || !availableQualities.length) return null;
    const exact = availableQualities.find(item => resolution(item.qualityLabel) === targetValue);
    if (exact) return exact;

    const lower = availableQualities
      .filter(item => resolution(item.qualityLabel) > 0 && resolution(item.qualityLabel) <= targetValue)
      .sort((left, right) => resolution(right.qualityLabel) - resolution(left.qualityLabel));
    if (lower.length) return lower[0];

    // Treat the requested value as a ceiling. If the player only advertises
    // higher resolutions, leave its current/Auto choice untouched rather than
    // silently selecting a stream above the user's request.
    return null;
  }

  applyQuality(explicitQuality) {
    if (!this.player || typeof this.player.setPlaybackQualityRange !== 'function') {
      this.scheduleRetry();
      return false;
    }

    const preference = explicitQuality || configRead('preferredVideoQuality') || 'auto';
    if (preference === 'auto') {
      try {
        const result = this.player.setPlaybackQualityRange('auto', 'auto');
        if (result === false) return false;
        this.hasAppliedQuality = true;
        this.clearRetry();
        this.publishStatus('auto', this.getActualQuality());
        return true;
      } catch (error) {
        console.warn('[YTArk quality] Could not restore Auto quality:', error);
        this.scheduleRetry();
        return false;
      }
    }

    const available = this.getAvailableQualities();
    if (!available.length) {
      this.scheduleRetry();
      return false;
    }
    const chosen = this.determineQuality(preference, available);
    if (!chosen) {
      this.scheduleRetry();
      return false;
    }

    try {
      const result = this.player.setPlaybackQualityRange(chosen.quality, chosen.quality);
      if (result === false) {
        this.scheduleRetry();
        return false;
      }
      this.hasAppliedQuality = true;
      this.clearRetry();
      this.publishStatus(preference, this.getActualQuality() || chosen.qualityLabel || chosen.quality);
      return true;
    } catch (error) {
      console.warn('[YTArk quality] Failed to request the available stream quality:', error);
      this.scheduleRetry();
      return false;
    }
  }

  getActualQuality() {
    if (this.player && typeof this.player.getPlaybackQuality === 'function') {
      try {
        const quality = this.player.getPlaybackQuality();
        const match = this.getAvailableQualities().find(item => item.quality === quality);
        if (match && match.qualityLabel) return match.qualityLabel;
        if (quality) return String(quality);
      } catch (_) { }
    }
    if (this.video && Number(this.video.videoHeight) > 0) return `${Number(this.video.videoHeight)}p`;
    return null;
  }

  publishStatus(selected, actual) {
    if (typeof window !== 'undefined') {
      window.__ytarkQualityStatus = {
        selected: selected === 'auto' ? 'Auto' : String(selected),
        actual: actual || null,
      };
    }
  }

  scheduleRetry() {
    if (this.destroyed || this.retryTimer !== null || this.retryCount >= MAX_QUALITY_RETRIES) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryCount += 1;
      this.applyQuality();
    }, RETRY_DELAY_MS);
  }

  clearRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  handleVideoError() {
    const preference = configRead('preferredVideoQuality');
    if (!this.player || !preference || preference === 'auto' || this.fallbackAttempted) return;
    this.fallbackAttempted = true;
    const available = this.getAvailableQualities();
    if (!available.length) return;
    const target = resolution(preference);
    const fallback = available
      .filter(item => resolution(item.qualityLabel) > 0 && resolution(item.qualityLabel) < target)
      .sort((left, right) => resolution(right.qualityLabel) - resolution(left.qualityLabel))[0];
    if (fallback) {
      this.applyQuality(fallback.qualityLabel || fallback.quality);
    } else {
      this.applyQuality('auto');
    }
  }
}

const preferredVideoQualityHandler = typeof document !== 'undefined' && document.body
  ? new PreferredQualityHandler() : null;
if (typeof window !== 'undefined' && preferredVideoQualityHandler) {
  window.preferredVideoQualityHandler = preferredVideoQualityHandler;
}

export { PreferredQualityHandler, resolution };
