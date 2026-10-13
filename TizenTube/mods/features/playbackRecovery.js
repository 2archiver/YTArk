// Bounded recovery for the pinned YouTube TV/Cobalt player integration.
//
// The project already uses the player element's getPlayerStateObject() /
// getVideoData() hooks and PlayerService.loadVideo(loadedPlaybackConfig) in
// pictureInPicture.js. Recovery uses those same hooks only; it does not reload
// the frontend, touch account storage, or guess at a private player retry API.

import { configRead, configChangeEmitter } from '../config.js';
import resolveCommand from '../resolveCommand.js';

export const RECOVERY_STALL_MS = 20_000;
export const LIVE_STALL_MS = 45_000;
export const RECOVERY_DELAYS_MS = Object.freeze([2_000, 5_000, 10_000]);
export const SUCCESS_RESET_MS = 60_000;
export const PLAYER_SELECTOR = '.html5-video-player';

const RECOVERY_TEXT_ID = 'ytark-playback-recovery';
const RESTRICTION_TEXT = /sign\s*in|age.?restricted|age verification|not available in your country|not available in your region|region.?restricted|country.?restricted|access denied|members.?only|members only|purchase required|subscription required|parental control|private video|video.{0,24}(?:not available|unavailable|private)|you (?:don't|do not) have access|not authori[sz]ed/i;
const NETWORK_ONLINE = 1;
const HAVE_FUTURE_DATA = 3;
const NETWORK_LOADING = 2;

function safeCall(target, name, fallback = null) {
  try {
    return target && typeof target[name] === 'function' ? target[name]() : fallback;
  } catch (_) {
    return fallback;
  }
}

/** Uses the same published YT TV player-service mapping used by pictureInPicture.js. */
export function findPlayerService(windowRef = typeof window !== 'undefined' ? window : null) {
  try {
    const registry = windowRef && windowRef._yttv;
    if (!registry) return null;
    const module = Object.values(registry).find(item => item && item.mappings
      && typeof item.mappings.get === 'function');
    const service = module && module.mappings.get('PlayerService');
    return service && typeof service.loadVideo === 'function' ? service : null;
  } catch (_) {
    return null;
  }
}

/** The watch id is read from the same hash route shape used by SponsorBlock. */
export function routeVideoId(locationRef) {
  try {
    const route = new URL(String(locationRef && locationRef.hash || '').replace(/^#/, ''),
      locationRef && locationRef.href || 'https://youtube.com/');
    return route.searchParams.get('v') || route.searchParams.get('video_id') || '';
  } catch (_) {
    const hash = String(locationRef && locationRef.hash || '');
    const match = hash.match(/[?&](?:v|video_id)=([^&]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
  }
}

function lastRangeEnd(ranges) {
  try {
    const length = ranges && ranges.length;
    return length > 0 ? Number(ranges.end(length - 1)) : NaN;
  } catch (_) {
    return NaN;
  }
}

function rangeContains(ranges, time) {
  if (!ranges || !Number.isFinite(time)) return false;
  try {
    for (let index = 0; index < Number(ranges.length); index += 1) {
      if (time >= Number(ranges.start(index)) && time <= Number(ranges.end(index))) return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

/** Snapshot enough public player context to reload through the existing route. */
export function capturePlaybackContext({ player, video, service, locationRef }) {
  if (!player || !video || !service || typeof service.loadVideo !== 'function') return null;
  const state = safeCall(player, 'getPlayerStateObject', null);
  if (!state) return null;
  const videoData = safeCall(player, 'getVideoData', null);
  const routeId = routeVideoId(locationRef);
  const dataId = String(videoData && videoData.video_id || '');
  // A stale player object can outlive a watch page during navigation. Only a
  // current supported watch route authorizes capture or recovery.
  if (!routeId || dataId && dataId !== routeId) return null;
  const id = routeId;

  const loaded = service.loadedPlaybackConfig;
  const watchEndpoint = loaded && loaded.watchEndpoint;
  if (!loaded || !watchEndpoint || String(watchEndpoint.videoId || '') !== id) return null;

  const duration = Number(video.duration);
  const live = !!(state && state.isLive === true)
    || !!(videoData && (videoData.isLive === true || videoData.is_live === true))
    || video.duration === Infinity;
  const position = Number(video.currentTime);
  const seekableEnd = lastRangeEnd(video.seekable);
  // A live stream with no seekable range is treated as live-edge content. When
  // a DVR range exists, preserve a non-edge position when the player supports it.
  const liveEdge = live && (!Number.isFinite(seekableEnd)
    || !Number.isFinite(position) || seekableEnd - position <= 30);
  const savedPosition = Number.isFinite(position) && position >= 0 ? position : null;
  const positionInRange = savedPosition !== null && rangeContains(video.seekable, savedPosition);
  const canSeek = live
    ? positionInRange && Number.isFinite(seekableEnd) && !liveEdge
    : positionInRange && Number.isFinite(duration) && duration > 0;

  return {
    id,
    state,
    live,
    liveEdge,
    position: canSeek ? savedPosition : null,
    playbackRate: Number(video.playbackRate) || 1,
    volume: Number.isFinite(Number(video.volume)) ? Number(video.volume) : 1,
    muted: video.muted === true,
    config: loaded,
  };
}

/**
 * Build a fresh normal-player configuration; live-edge intent omits a stale
 * timestamp, while seekable VOD/DVR content keeps its captured position.
 */
export function makeRecoveryConfig(context) {
  if (!context || !context.config || !context.config.watchEndpoint) return null;
  try {
    const copy = JSON.parse(JSON.stringify(context.config));
    if (!copy.watchEndpoint || String(copy.watchEndpoint.videoId || '') !== context.id) return null;
    if (context.live && context.liveEdge) {
      delete copy.watchEndpoint.startTimeSeconds;
    } else if (context.live && !Number.isFinite(context.position)) {
      delete copy.watchEndpoint.startTimeSeconds;
    } else if (Number.isFinite(context.position) && context.position >= 0) {
      copy.watchEndpoint.startTimeSeconds = Math.floor(context.position);
    }
    return copy;
  } catch (_) {
    return null;
  }
}

/** True only for a sustained, buffered/network-related lack of progress. */
export function stallEvidence(snapshot) {
  if (!snapshot || snapshot.hidden || snapshot.completed || snapshot.seeking
      || snapshot.loading || snapshot.intentionalPause || snapshot.offline
      || !snapshot.expectedToAdvance) return false;
  const threshold = snapshot.live ? LIVE_STALL_MS : RECOVERY_STALL_MS;
  if (!Number.isFinite(snapshot.noProgressMs) || snapshot.noProgressMs < threshold) return false;
  const buffering = snapshot.playerBuffering === true
    || snapshot.waitingMs >= threshold
    || Number(snapshot.readyState) < HAVE_FUTURE_DATA
    || Number(snapshot.networkState) === NETWORK_LOADING;
  // A live stream without sustained buffering/error evidence may simply have
  // no frame or timestamp change; do not interpret its timing as failure.
  if (snapshot.live && !buffering) return false;
  return buffering;
}

function hasRestrictionText(player) {
  try {
    const text = String(player && (player.innerText || player.textContent) || '').slice(0, 4000);
    return RESTRICTION_TEXT.test(text);
  } catch (_) {
    return false;
  }
}

function keyCode(event) {
  return Number(event && (event.keyCode || event.which)) || 0;
}

function nodeAffectsPlayer(node) {
  if (!node || node.nodeType !== 1) return false;
  try {
    if (typeof node.matches === 'function' && node.matches(`${PLAYER_SELECTOR}, video`)) return true;
    return typeof node.querySelector === 'function'
      && !!node.querySelector(`${PLAYER_SELECTOR}, video`);
  } catch (_) {
    return false;
  }
}

export class PlaybackRecoveryController {
  constructor(options = {}) {
    this.window = options.windowRef || (typeof window !== 'undefined' ? window : null);
    this.document = options.documentRef || (typeof document !== 'undefined' ? document : null);
    this.readConfig = options.readConfig || configRead;
    this.getService = options.getService || (() => findPlayerService(this.window));
    this.now = options.now || (() => Date.now());
    this.setTimeout = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeout = options.clearTimeout || (id => clearTimeout(id));
    this.setInterval = options.setInterval || ((fn, ms) => setInterval(fn, ms));
    this.clearInterval = options.clearInterval || (id => clearInterval(id));
    this.MutationObserver = options.MutationObserver
      || (this.window && this.window.MutationObserver)
      || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    this.resolve = options.resolve || resolveCommand;
    this.player = null;
    this.video = null;
    this.service = null;
    this.observer = null;
    this.sampleTimer = null;
    this.enabled = false;
    this.currentId = '';
    this.lastTime = NaN;
    this.lastProgressAt = this.now();
    this.waitingSince = 0;
    this.loading = false;
    this.seeking = false;
    this.expectedToAdvance = false;
    this.intentionalPause = false;
    this.offline = !!(this.window && this.window.navigator && this.window.navigator.onLine === false);
    this.incident = null;
    this.pendingRestore = null;
    this.ui = null;
    this.uiState = 'hidden';
    this.bound = {
      state: () => this.tick(),
      timeupdate: () => this.onTimeUpdate(),
      waiting: () => this.onWaiting(),
      stalled: () => this.onWaiting(),
      playing: () => this.onPlaying(),
      play: () => this.onPlaying(),
      pause: () => this.onPause(),
      seeking: () => this.onSeeking(),
      seeked: () => this.onSeeked(),
      loadstart: () => this.onLoadStart(),
      emptied: () => this.onLoadStart(),
      metadata: () => this.onLoaded(),
      canplay: () => this.onLoaded(),
      error: () => this.onError(),
      ended: () => this.cancelIncident('completed'),
      visibility: () => this.onVisibilityChange(),
      online: () => this.onOnline(),
      offline: () => this.onOffline(),
      navigation: () => this.onNavigation(),
      pagehide: () => this.onSuspended(),
      pageshow: () => this.onResumed(),
      keydown: event => this.onOverlayKey(event),
      domReady: () => this.start(),
      config: event => {
        if (!event || !event.detail || event.detail.key === 'enablePlaybackRecovery') this.refreshEnabled();
      },
    };
    this.refreshEnabled();
    configChangeEmitter.addEventListener('configChange', this.bound.config);
    this.installLifecycleListeners();
  }

  installLifecycleListeners() {
    if (!this.window || !this.document) return;
    if (!this.document.body) this.document.addEventListener('DOMContentLoaded', this.bound.domReady);
    this.window.addEventListener('online', this.bound.online);
    this.window.addEventListener('offline', this.bound.offline);
    this.window.addEventListener('hashchange', this.bound.navigation);
    this.window.addEventListener('popstate', this.bound.navigation);
    this.window.addEventListener('pagehide', this.bound.pagehide);
    this.window.addEventListener('pageshow', this.bound.pageshow);
    // Capturing at window lets Recovery's small, explicit button pair receive
    // remote keys before YTArk's general settings-navigation handler.
    this.window.addEventListener('keydown', this.bound.keydown, true);
    this.document.addEventListener('visibilitychange', this.bound.visibility);
  }

  refreshEnabled() {
    const next = this.readConfig('enablePlaybackRecovery') === true;
    if (next === this.enabled) return;
    this.enabled = next;
    if (next) this.start();
    else this.stop();
  }

  start() {
    if (!this.enabled || !this.document) return;
    this.reconcile();
    if (this.sampleTimer === null) this.sampleTimer = this.setInterval(() => this.tick(), 5_000);
    if (!this.observer && this.MutationObserver && this.document.body) {
      this.observer = new this.MutationObserver(records => {
        if (records.some(record => {
          const changed = [...(record.addedNodes || []), ...(record.removedNodes || [])];
          return changed.some(nodeAffectsPlayer);
        })) this.reconcile();
      });
      this.observer.observe(this.document.body, { childList: true, subtree: true });
    }
  }

  stop() {
    this.detach();
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    if (this.sampleTimer !== null) this.clearInterval(this.sampleTimer);
    this.sampleTimer = null;
    this.cancelIncident('disabled');
    this.pendingRestore = null;
    this.render('hidden');
  }

  destroy() {
    this.stop();
    configChangeEmitter.removeEventListener('configChange', this.bound.config);
    if (this.window) {
      this.window.removeEventListener('online', this.bound.online);
      this.window.removeEventListener('offline', this.bound.offline);
      this.window.removeEventListener('hashchange', this.bound.navigation);
      this.window.removeEventListener('popstate', this.bound.navigation);
      this.window.removeEventListener('pagehide', this.bound.pagehide);
      this.window.removeEventListener('pageshow', this.bound.pageshow);
      this.window.removeEventListener('keydown', this.bound.keydown, true);
    }
    if (this.document) {
      this.document.removeEventListener('visibilitychange', this.bound.visibility);
      this.document.removeEventListener('DOMContentLoaded', this.bound.domReady);
    }
  }

  reconcile() {
    if (!this.enabled || !this.document) return;
    const nextPlayer = this.document.querySelector(PLAYER_SELECTOR);
    const nextVideo = this.document.querySelector('video');
    if (nextPlayer !== this.player) {
      this.detach();
      this.player = nextPlayer || null;
      this.service = this.getService();
      if (this.player && typeof this.player.addEventListener === 'function') {
        this.player.addEventListener('onStateChange', this.bound.state);
      }
    }
    if (nextVideo !== this.video) {
      this.detachVideo();
      this.video = nextVideo || null;
      this.lastTime = Number(this.video && this.video.currentTime);
      this.lastProgressAt = this.now();
      this.waitingSince = 0;
      this.loading = false;
      this.seeking = false;
      this.intentionalPause = !!(this.video && this.video.paused);
      if (this.video) this.attachVideo();
    }
    if (this.player && !this.service) this.service = this.getService();
  }

  attachVideo() {
    if (!this.video || typeof this.video.addEventListener !== 'function') return;
    this.video.addEventListener('timeupdate', this.bound.timeupdate);
    this.video.addEventListener('waiting', this.bound.waiting);
    this.video.addEventListener('stalled', this.bound.stalled);
    this.video.addEventListener('playing', this.bound.playing);
    this.video.addEventListener('play', this.bound.play);
    this.video.addEventListener('pause', this.bound.pause);
    this.video.addEventListener('seeking', this.bound.seeking);
    this.video.addEventListener('seeked', this.bound.seeked);
    this.video.addEventListener('loadstart', this.bound.loadstart);
    this.video.addEventListener('emptied', this.bound.emptied);
    this.video.addEventListener('loadedmetadata', this.bound.metadata);
    this.video.addEventListener('canplay', this.bound.canplay);
    this.video.addEventListener('error', this.bound.error);
    this.video.addEventListener('ended', this.bound.ended);
  }

  detachVideo() {
    if (!this.video || typeof this.video.removeEventListener !== 'function') return;
    for (const [eventName, handler] of [
      ['timeupdate', this.bound.timeupdate], ['waiting', this.bound.waiting],
      ['stalled', this.bound.stalled], ['playing', this.bound.playing], ['play', this.bound.play],
      ['pause', this.bound.pause], ['seeking', this.bound.seeking], ['seeked', this.bound.seeked],
      ['loadstart', this.bound.loadstart], ['emptied', this.bound.emptied],
      ['loadedmetadata', this.bound.metadata], ['canplay', this.bound.canplay],
      ['error', this.bound.error], ['ended', this.bound.ended],
    ]) this.video.removeEventListener(eventName, handler);
  }

  detach() {
    this.detachVideo();
    if (this.player && typeof this.player.removeEventListener === 'function') {
      this.player.removeEventListener('onStateChange', this.bound.state);
    }
    this.video = null;
    this.player = null;
    this.service = null;
  }

  playerState() { return safeCall(this.player, 'getPlayerStateObject', null); }
  videoData() { return safeCall(this.player, 'getVideoData', null); }

  identity() {
    // getVideoData can remain populated briefly after leaving a watch page. The
    // route is the live navigation signal; no route ID means no recovery target.
    return routeVideoId(this.window && this.window.location);
  }

  currentLive() {
    const state = this.playerState();
    const data = this.videoData();
    return !!(state && state.isLive === true)
      || !!(data && (data.isLive === true || data.is_live === true))
      || !!(this.video && this.video.duration === Infinity);
  }

  onTimeUpdate() {
    if (!this.video) return;
    const current = Number(this.video.currentTime);
    if (Number.isFinite(current) && Number.isFinite(this.lastTime) && current > this.lastTime + 0.05) {
      this.lastProgressAt = this.now();
      this.waitingSince = 0;
      this.loading = false;
      this.onRealProgress();
    }
    if (Number.isFinite(current)) this.lastTime = current;
    this.restorePlaybackPreferences();
  }

  onRealProgress() {
    const incident = this.incident;
    if (!incident) return;
    if (incident.recovering) {
      incident.recovering = false;
      if (incident.watchdog !== null) this.clearTimeout(incident.watchdog);
      incident.watchdog = null;
    }
    if (incident.timer !== null) this.clearTimeout(incident.timer);
    incident.timer = null;
    if (!incident.successSince) incident.successSince = this.now();
    this.render('hidden');
    if (this.now() - incident.successSince >= SUCCESS_RESET_MS) this.cancelIncident('recovered');
  }

  onWaiting() {
    if (!this.waitingSince) this.waitingSince = this.now();
  }

  onError() {
    // A late media error can follow loadstart. Do not let the ordinary loading
    // guard suppress the only supported error signal that can start recovery.
    this.loading = false;
    if (!this.waitingSince) this.waitingSince = this.now();
    this.tick();
  }

  onPlaying() {
    this.loading = false;
    this.waitingSince = 0;
    this.intentionalPause = false;
    this.expectedToAdvance = true;
    this.lastProgressAt = Math.max(this.lastProgressAt, this.now());
    this.restorePlaybackPreferences();
  }

  onPause() {
    const state = this.playerState();
    // Only the player's explicit error state distinguishes a decoder pause from
    // a user pause. A stale HTMLMediaElement.error by itself must not override
    // an intentional pause or cause a later retry to start playback again.
    if (state && state.isError === true) {
      this.intentionalPause = false;
      this.expectedToAdvance = true;
      return;
    }
    this.intentionalPause = true;
    this.expectedToAdvance = false;
    this.cancelIncident('paused');
  }

  hasRecoverableError(state = this.playerState()) {
    return !!(state && state.isError === true)
      || !!(this.video && this.video.error && !this.intentionalPause);
  }

  onSeeking() {
    this.seeking = true;
    this.cancelIncident('seeking');
  }

  onSeeked() {
    this.seeking = false;
    this.lastTime = Number(this.video && this.video.currentTime);
    this.lastProgressAt = this.now();
    this.waitingSince = 0;
  }

  onLoadStart() {
    this.loading = true;
    this.waitingSince = 0;
    if (this.incident && this.incident.timer !== null) {
      this.clearTimeout(this.incident.timer);
      this.incident.timer = null;
    }
  }

  onLoaded() {
    this.loading = false;
    this.lastProgressAt = this.now();
    if (this.incident && this.incident.attempts > 0) {
      if (this.incident.watchdog !== null) this.clearTimeout(this.incident.watchdog);
      this.incident.watchdog = null;
      this.incident.recovering = false;
      this.incident.successSince = this.now();
      this.render('hidden');
    }
    this.restorePlaybackPreferences();
  }

  restorePlaybackPreferences() {
    const prefs = this.pendingRestore;
    if (!prefs || !this.video) return;
    if (prefs.id !== this.identity()) {
      this.pendingRestore = null;
      return;
    }
    try {
      if (Number.isFinite(prefs.playbackRate) && prefs.playbackRate > 0) this.video.playbackRate = prefs.playbackRate;
      if (Number.isFinite(prefs.volume)) this.video.volume = prefs.volume;
      this.video.muted = !!prefs.muted;
    } catch (_) {
      // A browser/player can reject a preference during a load; retry on its next media event.
      return;
    }
    this.pendingRestore = null;
  }

  onVisibilityChange() {
    if (!this.document || this.document.visibilityState === 'hidden') this.onSuspended();
    else this.onResumed();
  }

  onSuspended() {
    if (this.incident && this.incident.timer !== null) this.clearTimeout(this.incident.timer);
    if (this.incident && this.incident.watchdog !== null) this.clearTimeout(this.incident.watchdog);
    if (this.incident) {
      this.incident.timer = null;
      this.incident.watchdog = null;
      this.incident.recovering = false;
      this.incident.successSince = 0;
    }
    this.lastProgressAt = this.now();
    this.waitingSince = 0;
    this.pendingRestore = null;
    this.render('hidden');
  }

  onResumed() {
    this.reconcile();
    this.lastProgressAt = this.now();
    this.lastTime = Number(this.video && this.video.currentTime);
    this.waitingSince = 0;
  }

  onNavigation() {
    const id = this.identity();
    if (this.currentId && id !== this.currentId) this.cancelIncident('navigation');
    this.currentId = id;
    this.lastProgressAt = this.now();
    this.lastTime = Number(this.video && this.video.currentTime);
    this.waitingSince = 0;
  }

  onOffline() {
    this.offline = true;
    if (this.incident && this.incident.timer !== null) this.clearTimeout(this.incident.timer);
    if (this.incident && this.incident.watchdog !== null) this.clearTimeout(this.incident.watchdog);
    if (this.incident) {
      this.incident.timer = null;
      this.incident.watchdog = null;
      this.incident.recovering = false;
    }
    this.pendingRestore = null;
    this.render('offline');
  }

  onOnline() {
    this.offline = false;
    if (!this.incident || !this.enabled || this.isSuspended()) return;
    if (this.incident.attempts >= RECOVERY_DELAYS_MS.length) {
      this.finishIncident('failed');
      return;
    }
    this.scheduleAttempt(2_000);
  }

  isSuspended() {
    return !!(this.document && this.document.visibilityState === 'hidden')
      || !!(this.window && this.window.isPipPlaying === true);
  }

  hasCurrentStall(state) {
    const waitingMs = this.waitingSince ? this.now() - this.waitingSince : 0;
    return stallEvidence({
      hidden: this.isSuspended(),
      completed: !!(state && state.isEnded === true) || !!(this.video && this.video.ended === true),
      seeking: this.seeking,
      loading: this.loading,
      intentionalPause: this.intentionalPause || !!(this.video && this.video.paused === true),
      offline: this.offline,
      expectedToAdvance: this.expectedToAdvance,
      live: this.currentLive(),
      noProgressMs: this.now() - this.lastProgressAt,
      waitingMs,
      playerBuffering: !!(state && state.isBuffering === true),
      readyState: this.video && this.video.readyState,
      networkState: this.video && this.video.networkState,
    });
  }

  tick() {
    if (!this.enabled) return;
    this.reconcile();
    if (!this.player || !this.video || !this.service) return;
    const state = this.playerState();
    if (!state) return; // Recovery is never enabled without the actual player hook.
    const id = this.identity();
    if (!id) return;
    if (this.currentId && id !== this.currentId) {
      this.cancelIncident('navigation');
      this.lastProgressAt = this.now();
    }
    this.currentId = id;

    if (state.isEnded === true || this.video.ended === true) {
      this.cancelIncident('completed');
      return;
    }
    if (this.isSuspended()) {
      this.onSuspended();
      return;
    }
    if (this.offline || this.window && this.window.navigator && this.window.navigator.onLine === false) {
      if (this.incident) this.render('offline');
      return;
    }
    if (this.seeking || this.loading) return;
    const recoverableError = this.hasRecoverableError(state);
    if (!recoverableError && (this.intentionalPause || this.video.paused === true)) {
      if (!this.incident || !this.incident.recovering) {
        this.cancelIncident('paused');
        this.lastProgressAt = this.now();
        return;
      }
    }

    if (recoverableError) {
      if (hasRestrictionText(this.player)) {
        this.ensureIncident(id);
        this.finishIncident('restricted');
        return;
      }
      this.ensureIncident(id);
      if (this.incident && !this.incident.timer && !this.incident.recovering) this.scheduleAttempt();
      return;
    }

    const current = Number(this.video.currentTime);
    if (Number.isFinite(current) && Number.isFinite(this.lastTime) && current > this.lastTime + 0.05) {
      this.lastTime = current;
      this.lastProgressAt = this.now();
      this.waitingSince = 0;
      this.expectedToAdvance = true;
      this.onRealProgress();
    } else if (Number.isFinite(current)) {
      this.lastTime = current;
    }

    if (state.isPlaying === true || this.video.paused === false) this.expectedToAdvance = true;
    const stalled = this.hasCurrentStall(state);
    if (stalled) {
      this.ensureIncident(id);
      if (this.incident && !this.incident.timer && !this.incident.recovering) this.scheduleAttempt();
    } else if (this.incident && this.incident.successSince
        && this.now() - this.incident.successSince >= SUCCESS_RESET_MS) {
      this.cancelIncident('recovered');
    }
  }

  ensureIncident(id) {
    if (this.incident && this.incident.id === id) return this.incident;
    this.cancelIncident('new-incident');
    const context = capturePlaybackContext({
      player: this.player,
      video: this.video,
      service: this.service,
      locationRef: this.window && this.window.location,
    });
    if (!context || context.id !== id) {
      this.render('unavailable');
      return null;
    }
    this.incident = {
      id,
      context,
      attempts: 0,
      manualRetries: 0,
      timer: null,
      watchdog: null,
      recovering: false,
      successSince: 0,
      startedAt: this.now(),
      state: 'recovering',
    };
    this.render('recovering');
    return this.incident;
  }

  scheduleAttempt(delay) {
    const incident = this.incident;
    if (!incident || incident.timer !== null || incident.recovering) return;
    if (incident.attempts >= RECOVERY_DELAYS_MS.length) {
      this.finishIncident('failed');
      return;
    }
    const wait = Number.isFinite(delay) ? delay : RECOVERY_DELAYS_MS[incident.attempts];
    incident.timer = this.setTimeout(() => {
      incident.timer = null;
      this.performAttempt(false);
    }, wait);
    this.render('recovering');
  }

  performAttempt(manual) {
    const incident = this.incident;
    if (!incident || !this.enabled) return false;
    if (this.isSuspended()) {
      this.onSuspended();
      return false;
    }
    if (this.offline || this.window && this.window.navigator && this.window.navigator.onLine === false) {
      this.onOffline();
      return false;
    }
    if (this.loading) return false;
    if (this.seeking || this.video && this.video.ended) {
      this.cancelIncident(this.seeking ? 'seeking' : 'completed');
      return false;
    }
    const currentId = this.identity();
    if (currentId !== incident.id) {
      this.cancelIncident('navigation');
      return false;
    }
    const playerState = this.playerState();
    if (!playerState) {
      this.finishIncident('unavailable');
      return false;
    }
    const recoverableError = this.hasRecoverableError(playerState);
    if (!manual && !recoverableError && !this.hasCurrentStall(playerState)) {
      this.cancelIncident('recovered');
      return false;
    }
    if ((this.intentionalPause || this.video && this.video.paused === true) && !recoverableError) {
      if (!manual) this.cancelIncident('paused');
      return false;
    }
    if (incident.attempts >= RECOVERY_DELAYS_MS.length) {
      this.finishIncident('failed');
      return false;
    }

    const context = capturePlaybackContext({
      player: this.player,
      video: this.video,
      service: this.service,
      locationRef: this.window && this.window.location,
    });
    const config = makeRecoveryConfig(context);
    if (!context || !config) {
      this.finishIncident('unavailable');
      return false;
    }
    // Refresh the position and preferences before every retry, not from the
    // incident's first snapshot. A video that has moved since the first attempt
    // keeps the closest supported position.
    incident.context = context;
    incident.recovering = true;
    incident.state = 'recovering';
    incident.attempts += 1;
    incident.attemptAt = this.now();
    this.pendingRestore = context;
    this.expectedToAdvance = true;
    this.lastProgressAt = this.now();
    this.waitingSince = this.now();
    this.render('recovering');
    const watchdogMs = context.live ? LIVE_STALL_MS : RECOVERY_STALL_MS;
    incident.watchdog = this.setTimeout(() => this.onAttemptFailed(incident), watchdogMs);

    try {
      const result = this.service.loadVideo(config);
      if (result && typeof result.catch === 'function') {
        result.catch(() => this.onAttemptFailed(incident));
      }
    } catch (_) {
      this.onAttemptFailed(incident);
      return false;
    }
    return true;
  }

  onAttemptFailed(incident) {
    if (!this.incident || this.incident !== incident || !incident.recovering) return;
    if (incident.watchdog !== null) this.clearTimeout(incident.watchdog);
    incident.watchdog = null;
    incident.recovering = false;
    // A PlayerService reload can legitimately take longer than the retry
    // watchdog. Stop retrying while the media element is still in a load phase;
    // ordinary stalled/error policy can resume once loading has completed.
    if (this.loading) {
      incident.successSince = 0;
      this.render('hidden');
      return;
    }
    if (this.offline || this.window && this.window.navigator && this.window.navigator.onLine === false) {
      this.onOffline();
      return;
    }
    if (incident.attempts >= RECOVERY_DELAYS_MS.length) {
      this.finishIncident('failed');
      return;
    }
    this.scheduleAttempt();
  }

  finishIncident(reason) {
    if (!this.incident) {
      this.render(reason);
      return;
    }
    const incident = this.incident;
    if (incident.timer !== null) this.clearTimeout(incident.timer);
    if (incident.watchdog !== null) this.clearTimeout(incident.watchdog);
    incident.timer = null;
    incident.watchdog = null;
    incident.recovering = false;
    incident.state = reason;
    if (reason === 'failed' || reason === 'restricted' || reason === 'unavailable') {
      this.render(reason);
    }
  }

  cancelIncident(reason) {
    if (this.incident) {
      if (this.incident.timer !== null) this.clearTimeout(this.incident.timer);
      if (this.incident.watchdog !== null) this.clearTimeout(this.incident.watchdog);
    }
    this.incident = null;
    this.pendingRestore = null;
    if (reason === 'recovered' || reason === 'completed' || reason === 'navigation'
        || reason === 'paused' || reason === 'seeking' || reason === 'disabled'
        || reason === 'new-incident') this.render('hidden');
  }

  manualRetry() {
    if (!this.enabled || this.incident && (this.incident.state === 'restricted'
        || this.incident.recovering || this.incident.manualRetries >= 1)) return false;
    if (this.loading || this.seeking || this.isSuspended()
        || this.offline || this.window && this.window.navigator && this.window.navigator.onLine === false) return false;
    const id = this.identity();
    if (!id) return false;
    if (!this.incident || this.incident.id !== id) this.ensureIncident(id);
    if (!this.incident) return false;
    const state = this.playerState();
    const recoverableError = this.hasRecoverableError(state);
    if (!state || (this.intentionalPause || this.video && this.video.paused === true)
        && !recoverableError) return false;
    if (this.incident.timer !== null) this.clearTimeout(this.incident.timer);
    if (this.incident.watchdog !== null) this.clearTimeout(this.incident.watchdog);
    this.incident.timer = null;
    this.incident.watchdog = null;
    this.incident.manualRetries += 1;
    this.incident.attempts = 0;
    this.incident.recovering = false;
    this.incident.successSince = 0;
    this.intentionalPause = false;
    this.expectedToAdvance = true;
    return this.performAttempt(true);
  }

  back() {
    this.cancelIncident('navigation');
    try { this.resolve({ signalAction: { signal: 'HISTORY_BACK' } }); } catch (_) { /* best effort */ }
  }

  render(state) {
    if (state === 'hidden') {
      this.uiState = 'hidden';
      if (this.ui) this.ui.style.display = 'none';
      return;
    }
    if (!this.document || !this.document.body) return;
    const changedState = this.uiState !== state;
    this.uiState = state;
    if (!this.ui || !this.ui.isConnected) this.createUi();
    if (!this.ui) return;
    this.ui.style.display = 'flex';
    const label = this.ui.querySelector('[data-ytark-recovery-message]');
    const retry = this.ui.querySelector('[data-ytark-recovery-retry]');
    const back = this.ui.querySelector('[data-ytark-recovery-back]');
    if (state === 'recovering' || state === 'offline') {
      label.textContent = state === 'offline' ? 'Playback recovery paused while offline' : 'Recovering playback…';
      retry.style.display = 'none';
      back.style.display = 'none';
      return;
    }
    const manualRetryUsed = !!(this.incident && this.incident.manualRetries >= 1);
    label.textContent = state === 'restricted'
      ? 'This playback error may require sign-in, age or region access. Automatic recovery stopped.'
      : manualRetryUsed
        ? 'The bounded recovery attempts are exhausted. You can go back.'
        : state === 'unavailable'
          ? 'Automatic recovery is unavailable for this playback. You can retry once or go back.'
          : 'Playback could not recover after three attempts. You can retry once or go back.';
    retry.style.display = state === 'restricted' || manualRetryUsed ? 'none' : 'inline-block';
    back.style.display = 'inline-block';
    if (changedState) (state === 'restricted' || manualRetryUsed ? back : retry).focus();
  }

  createUi() {
    const root = this.document.createElement('div');
    root.id = RECOVERY_TEXT_ID;
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.style.cssText = 'position:fixed;z-index:2147483000;right:5%;bottom:6%;max-width:42rem;padding:14px 18px;background:rgba(0,0,0,.88);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:8px;font:18px sans-serif;display:none;align-items:center;gap:14px;box-shadow:0 4px 24px rgba(0,0,0,.55);';
    const label = this.document.createElement('span');
    label.setAttribute('data-ytark-recovery-message', 'true');
    const retry = this.document.createElement('button');
    retry.type = 'button';
    retry.setAttribute('data-ytark-recovery-retry', 'true');
    retry.textContent = 'Retry';
    retry.style.cssText = 'display:none;min-width:110px;min-height:48px;font-size:17px;';
    retry.addEventListener('click', () => this.manualRetry());
    const back = this.document.createElement('button');
    back.type = 'button';
    back.setAttribute('data-ytark-recovery-back', 'true');
    back.textContent = 'Back';
    back.style.cssText = 'display:none;min-width:110px;min-height:48px;font-size:17px;';
    back.addEventListener('click', () => this.back());
    root.appendChild(label);
    root.appendChild(retry);
    root.appendChild(back);
    this.document.body.appendChild(root);
    this.ui = root;
  }

  onOverlayKey(event) {
    if (!this.ui || this.ui.style.display === 'none') return;
    const target = event && event.target;
    if (!target || !this.ui.contains(target)) return;
    const code = keyCode(event);
    const retry = this.ui.querySelector('[data-ytark-recovery-retry]');
    const back = this.ui.querySelector('[data-ytark-recovery-back]');
    if (code === 37 || code === 39) {
      const next = target === retry ? back : retry;
      if (next && next.style.display !== 'none') next.focus();
      event.preventDefault();
      event.stopImmediatePropagation && event.stopImmediatePropagation();
      event.stopPropagation();
    } else if (code === 13 || code === 23 || code === 66 || code === 32) {
      if (typeof target.click === 'function') target.click();
      event.preventDefault();
      event.stopImmediatePropagation && event.stopImmediatePropagation();
      event.stopPropagation();
    } else if (code === 27 || code === 4 || code === 166) {
      this.back();
      event.preventDefault();
      event.stopImmediatePropagation && event.stopImmediatePropagation();
      event.stopPropagation();
    }
  }
}

let controller = null;

/** Install the singleton once. Exported for the test harness as well. */
export function initPlaybackRecovery(options = {}) {
  if (!controller) controller = new PlaybackRecoveryController(options);
  return controller;
}

export function resetPlaybackRecoveryForTests() {
  if (controller) controller.destroy();
  controller = null;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initPlaybackRecovery();
