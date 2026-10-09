import sha256 from '../tiny-sha256.js';
import { configRead, configChangeEmitter } from '../config.js';
import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';

// Copied from https://github.com/ajayyy/SponsorBlock/blob/da1a535de784540ee10166a75a3eb8537073838c/src/config.ts#L113-L134
const barTypes = {
  sponsor: {
    color: '#00d400',
    opacity: '0.7',
    name: t('sponsorblock.segments.sponsor') || 'sponsored segment'
  },
  intro: {
    color: '#00ffff',
    opacity: '0.7',
    name: t('sponsorblock.segments.intro') || 'intro'
  },
  outro: {
    color: '#0202ed',
    opacity: '0.7',
    name: t('sponsorblock.segments.outro') || 'outro'
  },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: t('sponsorblock.segments.interaction') || 'interaction reminder'
  },
  selfpromo: {
    color: '#ffff00',
    opacity: '0.7',
    name: t('sponsorblock.segments.selfpromo') || 'self-promotion'
  },
  preview: {
    color: '#008fd6',
    opacity: '0.7',
    name: t('sponsorblock.segments.preview') || 'recap or preview'
  },
  filler: {
    color: "#7300FF",
    opacity: "0.9",
    name: t('sponsorblock.segments.filler') || 'tangents'
  },
  music_offtopic: {
    color: '#ff9900',
    opacity: '0.7',
    name: t('sponsorblock.segments.music_offtopic') || 'non-music part'
  },
  poi_highlight: {
    color: '#9b044c',
    opacity: '0.7',
    name: t('sponsorblock.segments.poi_highlight') || 'highlight'
  }
};

const sponsorblockAPI = 'https://sponsor.ajay.app/api';

class SponsorBlockHandler {
  video = null;
  active = true;

  attachVideoTimeout = null;
  overlayBuildTimeout = null;
  nextSkipTimeout = null;
  sliderInterval = null;
  attachAttempts = 0;
  overlayBuildAttempts = 0;
  sliderAttempts = 0;

  observer = null;
  scheduleSkipHandler = null;
  durationChangeHandler = null;
  segments = null;
  skippableCategories = [];
  manualSkippableCategories = [];
  skippedCategories = new Map();

  constructor(videoID) {
    this.videoID = videoID;
  }

  async init() {
    try {
      const videoHash = sha256(this.videoID).substring(0, 4);
      const categories = [
        'sponsor',
        'intro',
        'outro',
        'interaction',
        'selfpromo',
        'preview',
        'filler',
        'music_offtopic',
        'poi_highlight'
      ];
      const resp = await fetch(
        `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(
          JSON.stringify(categories)
        )}`
      );
      if (!resp || resp.ok === false) {
        throw new Error(`SponsorBlock returned HTTP ${resp ? resp.status : 'no response'}`);
      }
      const results = await resp.json();
      if (!this.active) return;

      const result = Array.isArray(results)
        ? results.find((v) => v && v.videoID === this.videoID)
        : null;
      if (!result || !Array.isArray(result.segments) || !result.segments.length) {
        console.info(this.videoID, 'No SponsorBlock segments found.');
        return;
      }

      this.segments = result.segments.filter(segment =>
        Array.isArray(segment.segment) && segment.segment.length === 2
        && Number.isFinite(Number(segment.segment[0]))
        && Number.isFinite(Number(segment.segment[1]))
        && Number(segment.segment[1]) > Number(segment.segment[0]));
      if (!this.segments.length) return;

      this.manualSkippableCategories = configRead('sponsorBlockManualSkips');
      this.skippableCategories = this.getSkippableCategories();

      this.scheduleSkipHandler = () => {
        const slider = document.querySelector('div[idomkey="slider"]');
        const sliderRect = slider?.getBoundingClientRect();
        const isOldUI = !document.querySelector('div[idomkey="Metadata-Section"]');
        if (isOldUI && sliderRect && this.segmentsoverlay) {
          this.segmentsoverlay.style.setProperty('top', `${sliderRect.top}px`, 'important');
        }
        this.scheduleSkip();
      };
      this.durationChangeHandler = () => this.buildOverlay();

      this.attachVideo();
      this.buildOverlay();
    } catch (error) {
      // SponsorBlock is optional. Network, CORS, JSON, or API failures must not
      // stop ordinary YouTube playback.
      console.warn('[YTArk SponsorBlock] Segment lookup failed; playback continues:', error);
    }
  }

  getSkippableCategories() {
    const skippableCategories = [];
    if (configRead('enableSponsorBlockSponsor')) {
      skippableCategories.push('sponsor');
    }
    if (configRead('enableSponsorBlockIntro')) {
      skippableCategories.push('intro');
    }
    if (configRead('enableSponsorBlockOutro')) {
      skippableCategories.push('outro');
    }
    if (configRead('enableSponsorBlockInteraction')) {
      skippableCategories.push('interaction');
    }
    if (configRead('enableSponsorBlockSelfPromo')) {
      skippableCategories.push('selfpromo');
    }
    if (configRead('enableSponsorBlockPreview')) {
      skippableCategories.push('preview');
    }
    if (configRead('enableSponsorBlockFiller')) {
      skippableCategories.push('filler');
    }
    if (configRead('enableSponsorBlockMusicOfftopic')) {
      skippableCategories.push('music_offtopic');
    }
    return skippableCategories;
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;

    this.video = document.querySelector('video');
    if (!this.video) {
      if (this.attachAttempts++ < 20 && this.active) {
        this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 250);
      }
      return;
    }
    this.attachAttempts = 0;

    console.info(this.videoID, 'Video found, binding...');

    this.video.addEventListener('play', this.scheduleSkipHandler);
    this.video.addEventListener('pause', this.scheduleSkipHandler);
    this.video.addEventListener('timeupdate', this.scheduleSkipHandler);
    this.video.addEventListener('durationchange', this.durationChangeHandler);
  }

  buildOverlay() {
    clearTimeout(this.overlayBuildTimeout);
    this.overlayBuildTimeout = null;
    if (this.segmentsoverlay) {
      console.info('Overlay already built');
      return;
    }

    if (!this.video || !Number.isFinite(this.video.duration) || this.video.duration <= 0) {
      if (this.overlayBuildAttempts++ < 20 && this.active) {
        this.overlayBuildTimeout = setTimeout(() => this.buildOverlay(), 250);
      }
      return;
    }

    const videoDuration = this.video.duration;
    const slider = document.querySelector('div[idomkey="slider"]');
    if (!slider) {
      if (this.overlayBuildAttempts++ < 20 && this.active) {
        this.overlayBuildTimeout = setTimeout(() => this.buildOverlay(), 250);
      }
      return;
    }
    this.overlayBuildAttempts = 0;

    this.segmentsoverlay = document.createElement('div');

    this.segmentsoverlay.classList.add('ytLrProgressBarSlider', 'ytLrProgressBarSliderRectangularProgressBar');
    this.segmentsoverlay.style.setProperty('z-index', '10', 'important');
    this.segmentsoverlay.style.setProperty('background-color', 'rgba(0, 0, 0, 0)', 'important');
    this.segmentsoverlay.style.setProperty('width', '72rem', 'important');
    this.segmentsoverlay.style.setProperty('left', '4rem', 'important');
    const sliderRect = slider.getBoundingClientRect();
    if (!slider.classList.contains('ytLrProgressBarSlider')) {
      for (let i = 0; i < slider.classList.length; i++) {
        this.segmentsoverlay.classList.add(slider.classList[i]);
      }
      this.segmentsoverlay.style.setProperty('height', `${sliderRect.height}px`, 'important');
      this.segmentsoverlay.style.setProperty('bottom', `${sliderRect.bottom - sliderRect.top}px`, 'important');
    }
    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;
      const barType = barTypes[segment.category] || {
        color: 'blue',
        opacity: 0.7
      };

      const leftPercent = videoDuration ? (100.0 * start) / videoDuration : 0;
      const widthPercent = videoDuration ? (100.0 * (end - start)) / videoDuration : 0;

      const elm = document.createElement('div');
      elm.style.setProperty('background-color', barType.color, 'important');
      elm.style.setProperty('opacity', barType.opacity, 'important');
      elm.style.setProperty('height', '100%', 'important');
      elm.style.setProperty('width', `${segment.category === 'poi_highlight' ? 1 : widthPercent}%`, 'important');
      elm.style.setProperty('left', `${leftPercent}%`, 'important');
      elm.style.setProperty('position', 'absolute', 'important');
      console.info('Generated element', elm, 'from', segment);
      this.segmentsoverlay.appendChild(elm);
    });

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.removedNodes) {
          for (const node of mutation.removedNodes) {
            if (node === this.segmentsoverlay && this.slider && this.slider.isConnected) {
              this.slider.appendChild(this.segmentsoverlay);
            }
          }
        }

        const progressBar = document.querySelector('ytlr-progress-bar');
        const isFocusable = !progressBar || progressBar.getAttribute('hybridnavfocusable') !== 'false';
        this.segmentsoverlay.style.setProperty('display', isFocusable ? 'block' : 'none', 'important');
      });
    });

    this.sliderAttempts = 0;
    this.sliderInterval = setInterval(() => {
      this.slider = document.querySelector('ytlr-redux-connect-ytlr-progress-bar');
      if (this.slider) {
        clearInterval(this.sliderInterval);
        this.sliderInterval = null;
        this.observer.observe(this.slider, { childList: true, subtree: true });
        this.slider.appendChild(this.segmentsoverlay);
      } else if (++this.sliderAttempts >= 20 || !this.active) {
        clearInterval(this.sliderInterval);
        this.sliderInterval = null;
        this.observer.disconnect();
        this.observer = null;
        if (this.segmentsoverlay) this.segmentsoverlay.remove();
        this.segmentsoverlay = null;
      }
    }, 500);
  }

  scheduleSkip() {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;

    if (!this.active || !this.video || !Array.isArray(this.segments)) {
      return;
    }

    if (this.video.paused) {
      console.info(this.videoID, 'Currently paused, ignoring...');
      return;
    }

    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments.filter(
      (seg) =>
        seg.segment[0] > this.video.currentTime - 0.3 &&
        seg.segment[1] > this.video.currentTime - 0.3
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      console.info(this.videoID, 'No more segments');
      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;
    console.info(
      this.videoID,
      'Scheduling skip of',
      segment,
      'in',
      start - this.video.currentTime
    );

    this.nextSkipTimeout = setTimeout(() => {
      if (this.video.paused) {
        console.info(this.videoID, 'Currently paused, ignoring...');
        return;
      }
      if (!this.skippableCategories.includes(segment.category)) {
        console.info(
          this.videoID,
          'Segment',
          segment.category,
          'is not skippable, ignoring...'
        );
        return;
      }

      const skipName = barTypes[segment.category]?.name || segment.category;
      console.info(this.videoID, 'Skipping', segment);
      if (!this.manualSkippableCategories.includes(segment.category)) {
        const wasSkippedBefore = this.skippedCategories.get(segment.UUID)
        if (wasSkippedBefore) {
          wasSkippedBefore.count++;
          wasSkippedBefore.lastSkipped = Date.now();
          this.skippedCategories.set(segment.UUID, wasSkippedBefore);

          if (wasSkippedBefore.lastSkipped - wasSkippedBefore.firstSkipped < 1000) {
            if (!wasSkippedBefore.hasShownToast) {
              if (configRead('enableSponsorBlockToasts')) {
                showToast('SponsorBlock', t('sponsorblock.toasts.notSkipping', { segment: skipName, count: wasSkippedBefore.count }));
              }
              wasSkippedBefore.hasShownToast = true;
              this.skippedCategories.set(segment.UUID, wasSkippedBefore);
            }
            return;
          }
        } else {
          this.skippedCategories.set(segment.UUID, {
            count: 1,
            firstSkipped: Date.now(),
            lastSkipped: Date.now(),
            hasShownToast: false
          });
        }
        if (configRead('enableSponsorBlockToasts')) {
          showToast('SponsorBlock', t('sponsorblock.toasts.skipping', { segment: skipName }));
        }
        if (this.video.duration - end < 1) {
          this.video.currentTime = end - 1;
        } else this.video.currentTime = end;
        this.scheduleSkip();
      }
    }, (start - this.video.currentTime) * 1000);
  }

  destroy() {
    console.info(this.videoID, 'Destroying');

    this.active = false;

    if (this.nextSkipTimeout) {
      clearTimeout(this.nextSkipTimeout);
      this.nextSkipTimeout = null;
    }

    if (this.attachVideoTimeout) {
      clearTimeout(this.attachVideoTimeout);
      this.attachVideoTimeout = null;
    }
    if (this.overlayBuildTimeout) {
      clearTimeout(this.overlayBuildTimeout);
      this.overlayBuildTimeout = null;
    }

    if (this.sliderInterval) {
      clearInterval(this.sliderInterval);
      this.sliderInterval = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.segmentsoverlay) {
      this.segmentsoverlay.remove();
      this.segmentsoverlay = null;
    }

    if (this.video) {
      this.video.removeEventListener('play', this.scheduleSkipHandler);
      this.video.removeEventListener('pause', this.scheduleSkipHandler);
      this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
      this.video.removeEventListener(
        'durationchange',
        this.durationChangeHandler
      );
    }

    this.skippedCategories.clear();
  }
}

// Route changes and setting changes are independent from YouTube playback. A
// failed SponsorBlock request leaves the stock player untouched.
window.sponsorblock = null;

function currentVideoId() {
  try {
    const route = new URL(location.hash.substring(1), location.href);
    return route.searchParams.get('v') || route.searchParams.get('video_id') || '';
  } catch (_) {
    const match = location.hash.match(/[?&]v=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

function syncSponsorBlock() {
  const videoID = currentVideoId();
  const enabled = configRead('enableSponsorBlock');
  if (window.sponsorblock && (!enabled || window.sponsorblock.videoID !== videoID)) {
    try {
      window.sponsorblock.destroy();
    } catch (error) {
      console.warn('[YTArk SponsorBlock] Could not detach old video handler:', error);
    }
    window.sponsorblock = null;
  }

  if (enabled && videoID && (!window.sponsorblock || window.sponsorblock.videoID !== videoID)) {
    const handler = new SponsorBlockHandler(videoID);
    window.sponsorblock = handler;
    handler.init().catch(error => {
      console.warn('[YTArk SponsorBlock] Optional initialization failed:', error);
    });
  }
}

window.addEventListener('hashchange', syncSponsorBlock, false);
configChangeEmitter.addEventListener('configChange', (event) => {
  const key = event.detail && event.detail.key;
  if (key === 'enableSponsorBlock') {
    syncSponsorBlock();
  } else if (key === 'sponsorBlockManualSkips'
      || /^enableSponsorBlock(?:Sponsor|Intro|Outro|Interaction|SelfPromo|Preview|Filler|MusicOfftopic)$/.test(key || '')) {
    if (window.sponsorblock) {
      window.sponsorblock.manualSkippableCategories = configRead('sponsorBlockManualSkips');
      window.sponsorblock.skippableCategories = window.sponsorblock.getSkippableCategories();
    }
  }
});

syncSponsorBlock();
