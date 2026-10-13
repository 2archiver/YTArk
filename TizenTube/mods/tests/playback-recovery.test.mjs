// Playback recovery policy/controller tests. The test surface models only the
// documented player-state hooks and PlayerService.loadVideo contract.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, FakeMutationObserver, keyEvent } from './helpers/fake-dom.mjs';
import { setupEnvironment, initEnglish } from './helpers/ytlr-harness.mjs';

const env = setupEnvironment();
await initEnglish();
const config = await import('../config.js');
const recovery = await import('../features/playbackRecovery.js');
recovery.resetPlaybackRecoveryForTests();

function makeClock(start = 1_000_000) {
  let now = start;
  let sequence = 0;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    now: () => now,
    advance(ms) { now += ms; },
    timeouts,
    intervals,
    setTimeout(fn, delay) { const id = ++sequence; timeouts.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn, delay) { const id = ++sequence; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    runTimeout(id) { const entry = timeouts.get(id); if (!entry) return false; timeouts.delete(id); entry.fn(); return true; },
  };
}

function makePlayer({ live = false, error = false, restricted = false } = {}) {
  const doc = env.doc;
  doc.body.children.slice().forEach(child => doc.body.removeChild(child));
  const player = new FakeElement('div', doc);
  player.addClass('html5-video-player');
  player.innerText = restricted ? 'Sign in to confirm your age' : '';
  const video = new FakeElement('video', doc);
  video.paused = false;
  video.ended = false;
  video.error = error ? { code: 2 } : null;
  video.currentTime = 42.5;
  video.duration = live ? Infinity : 3600;
  video.playbackRate = 1.5;
  video.volume = 0.75;
  video.muted = false;
  video.readyState = 2;
  video.networkState = 2;
  video.seekable = {
    length: live ? 0 : 1,
    start: () => 0,
    end: () => live ? NaN : 3600,
  };
  const state = { isPlaying: !error, isBuffering: !error, isError: error, isEnded: false, isLive: live };
  player.getPlayerStateObject = () => state;
  player.getVideoData = () => ({ video_id: 'abc123', isLive: live });
  player.appendChild(video);
  doc.body.appendChild(player);
  env.windowStub.location.hash = '#/watch?v=abc123';
  env.windowStub.navigator = { onLine: true };
  const calls = [];
  const service = {
    loadedPlaybackConfig: {
      clickTrackingParams: 'keep-me',
      watchEndpoint: { videoId: 'abc123', startTimeSeconds: 99 },
    },
    loadVideo(value) { calls.push(value); },
  };
  return { player, video, state, service, calls };
}

const activeControllers = new Set();

function makeController(playerContext, clock = makeClock(), extra = {}) {
  const controller = new recovery.PlaybackRecoveryController({
    windowRef: env.windowStub,
    documentRef: env.doc,
    MutationObserver: FakeMutationObserver,
    readConfig: key => key === 'enablePlaybackRecovery' ? true : config.configRead(key),
    getService: () => playerContext.service,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    resolve: extra.resolve || (() => {}),
  });
  activeControllers.add(controller);
  return controller;
}

function scheduledDelay(clock, delay) {
  return [...clock.timeouts.entries()].find(([, item]) => item.delay === delay)?.[0] || null;
}

afterEach(() => {
  for (const controller of activeControllers) controller.destroy();
  activeControllers.clear();
  recovery.resetPlaybackRecoveryForTests();
  FakeMutationObserver.reset();
  config.configWrite('enablePlaybackRecovery', false);
});

describe('playback recovery preference and pure player policy', () => {
  it('is persisted off by default and preserves an explicit off/on choice across migration', () => {
    assert.equal(config.configDefault('enablePlaybackRecovery'), false);
    config.configWrite('enablePlaybackRecovery', false);
    assert.equal(config.configRead('enablePlaybackRecovery'), false);
    config.configWrite('enablePlaybackRecovery', true);
    assert.equal(config.configRead('enablePlaybackRecovery'), true);
    config.configWrite('enablePlaybackRecovery', false);
  });

  it('preserves the current VOD position and player configuration when a seek range exists', () => {
    const context = makePlayer();
    const snapshot = recovery.capturePlaybackContext({
      player: context.player,
      video: context.video,
      service: context.service,
      locationRef: env.windowStub.location,
    });
    assert.equal(snapshot.position, 42.5);
    const retry = recovery.makeRecoveryConfig(snapshot);
    assert.equal(retry.watchEndpoint.startTimeSeconds, 42);
    assert.equal(retry.clickTrackingParams, 'keep-me');
    assert.equal(context.service.loadedPlaybackConfig.watchEndpoint.startTimeSeconds, 99,
      'recovery does not mutate PlayerService state');
  });

  it('requires the supported player-state hook and a current matching watch route', () => {
    const context = makePlayer();
    const capture = () => recovery.capturePlaybackContext({
      player: context.player, video: context.video, service: context.service,
      locationRef: env.windowStub.location,
    });
    assert.ok(capture());
    const stateHook = context.player.getPlayerStateObject;
    context.player.getPlayerStateObject = () => null;
    assert.equal(capture(), null, 'no recovery is offered without supported player state');
    context.player.getPlayerStateObject = stateHook;
    env.windowStub.location.hash = '#/browse';
    assert.equal(capture(), null, 'stale player data is not trusted after leaving the watch route');
    env.windowStub.location.hash = '#/watch?v=abc123';
    context.player.getVideoData = () => ({ video_id: 'different-video' });
    assert.equal(capture(), null, 'a route/player identity mismatch is not recovered');
  });

  it('uses live-edge intent without restoring a stale timestamp and labels live only by supported state', () => {
    const live = makePlayer({ live: true });
    const snapshot = recovery.capturePlaybackContext({
      player: live.player, video: live.video, service: live.service, locationRef: env.windowStub.location,
    });
    assert.equal(snapshot.live, true);
    assert.equal(snapshot.liveEdge, true);
    assert.equal(snapshot.position, null);
    assert.equal(recovery.makeRecoveryConfig(snapshot).watchEndpoint.startTimeSeconds, undefined);

    const liveDvr = makePlayer({ live: true });
    liveDvr.video.seekable = { length: 1, start: () => 0, end: () => 1000 };
    liveDvr.video.currentTime = 900;
    const dvrSnapshot = recovery.capturePlaybackContext({
      player: liveDvr.player, video: liveDvr.video, service: liveDvr.service,
      locationRef: env.windowStub.location,
    });
    assert.equal(dvrSnapshot.liveEdge, false);
    assert.equal(dvrSnapshot.position, 900);
    assert.equal(recovery.makeRecoveryConfig(dvrSnapshot).watchEndpoint.startTimeSeconds, 900,
      'a supported non-edge DVR position is preserved');

    const outsideDvrRange = makePlayer({ live: true });
    outsideDvrRange.video.seekable = { length: 1, start: () => 50, end: () => 1000 };
    outsideDvrRange.video.currentTime = 10;
    const outsideSnapshot = recovery.capturePlaybackContext({
      player: outsideDvrRange.player, video: outsideDvrRange.video,
      service: outsideDvrRange.service, locationRef: env.windowStub.location,
    });
    assert.equal(outsideSnapshot.position, null, 'an unseekable DVR time is not restored');
    assert.equal(recovery.makeRecoveryConfig(outsideSnapshot).watchEndpoint.startTimeSeconds, undefined);

    const unknownDuration = makePlayer();
    unknownDuration.video.duration = NaN;
    unknownDuration.state.isLive = false;
    unknownDuration.player.getVideoData = () => ({ video_id: 'abc123' });
    const unknown = recovery.capturePlaybackContext({
      player: unknownDuration.player, video: unknownDuration.video,
      service: unknownDuration.service, locationRef: env.windowStub.location,
    });
    assert.equal(unknown.live, false, 'NaN duration is not guessed to mean live');
  });

  it('requires sustained buffering and excludes pause, seek, load, completion, offline and background cases', () => {
    const base = {
      noProgressMs: recovery.RECOVERY_STALL_MS,
      expectedToAdvance: true,
      readyState: 2,
      networkState: 2,
    };
    assert.equal(recovery.stallEvidence(base), true);
    assert.equal(recovery.stallEvidence({ ...base, noProgressMs: recovery.RECOVERY_STALL_MS - 1 }), false);
    for (const field of ['hidden', 'completed', 'seeking', 'loading', 'intentionalPause', 'offline']) {
      assert.equal(recovery.stallEvidence({ ...base, [field]: true }), false, field);
    }
    assert.equal(recovery.stallEvidence({ ...base, live: true, readyState: 4, networkState: 1 }), false,
      'live timestamps alone do not trigger retries');
    assert.equal(recovery.stallEvidence({ ...base, live: true,
      noProgressMs: recovery.LIVE_STALL_MS, playerBuffering: true }), true);
  });
});

describe('playback recovery controller', () => {
  it('uses the existing PlayerService retry hook, bounds retries and stops after sustained real progress', () => {
    const context = makePlayer();
    const clock = makeClock();
    const controller = makeController(context, clock);
    controller.tick();
    clock.advance(recovery.RECOVERY_STALL_MS + 1);
    controller.tick();
    const first = scheduledDelay(clock, recovery.RECOVERY_DELAYS_MS[0]);
    assert.ok(first, 'first retry is delayed');
    clock.runTimeout(first);
    assert.equal(context.calls.length, 1);
    assert.equal(context.calls[0].watchEndpoint.startTimeSeconds, 42);
    assert.equal(controller.incident.attempts, 1);

    context.video.currentTime += 1;
    clock.advance(10);
    controller.onTimeUpdate();
    assert.equal(controller.incident.recovering, false, 'actual media progress ends the attempt watchdog');
    clock.advance(recovery.SUCCESS_RESET_MS + 1);
    context.video.currentTime += 1;
    controller.onTimeUpdate();
    assert.equal(controller.incident, null, 'a minute of successful playback clears the incident budget');
    assert.equal(context.calls.length, 1, 'no unwanted second load is issued after recovery');
  });

  it('cancels a delayed retry as soon as real playback progress resumes', () => {
    const context = makePlayer();
    const clock = makeClock();
    const controller = makeController(context, clock);
    controller.tick();
    clock.advance(recovery.RECOVERY_STALL_MS + 1);
    controller.tick();
    const pending = scheduledDelay(clock, recovery.RECOVERY_DELAYS_MS[0]);
    assert.ok(pending);
    context.video.currentTime += 1;
    controller.onTimeUpdate();
    assert.equal(controller.incident.timer, null);
    assert.equal(clock.runTimeout(pending), false);
    assert.equal(context.calls.length, 0, 'the player is not reloaded after progress resumes');
  });

  it('does not fire a pending retry or watchdog while media is loading', () => {
    const context = makePlayer({ error: true });
    const clock = makeClock();
    const controller = makeController(context, clock);
    controller.tick();
    const pending = scheduledDelay(clock, recovery.RECOVERY_DELAYS_MS[0]);
    assert.ok(pending);
    clock.runTimeout(pending);
    assert.equal(context.calls.length, 1);
    const watchdog = controller.incident.watchdog;
    controller.onLoadStart();
    clock.runTimeout(watchdog);
    assert.equal(controller.incident.recovering, false);
    assert.equal(controller.ui.style.display, 'none');
    assert.equal(context.calls.length, 1, 'a slow media load is not interrupted by another loadVideo call');
    assert.equal(controller.performAttempt(false), false);
    assert.equal(context.calls.length, 1);
  });

  it('bounds automatic recovery and allows at most one serialized manual retry', () => {
    const context = makePlayer({ error: true });
    const clock = makeClock();
    const controller = makeController(context, clock);
    controller.tick();
    const runAndFail = delay => {
      const pending = scheduledDelay(clock, delay);
      assert.ok(pending, `scheduled retry at ${delay}ms`);
      clock.runTimeout(pending);
      const watchdog = controller.incident.watchdog;
      assert.ok(watchdog, 'each load attempt has a failure watchdog');
      clock.runTimeout(watchdog);
    };
    runAndFail(recovery.RECOVERY_DELAYS_MS[0]);
    runAndFail(recovery.RECOVERY_DELAYS_MS[1]);
    runAndFail(recovery.RECOVERY_DELAYS_MS[2]);
    assert.equal(controller.incident.attempts, recovery.RECOVERY_DELAYS_MS.length);
    assert.equal(context.calls.length, 3);
    assert.equal(controller.manualRetry(), true);
    assert.equal(context.calls.length, 4);
    assert.equal(controller.manualRetry(), false, 'concurrent or repeated manual calls do not overlap');
    clock.runTimeout(controller.incident.watchdog);
    runAndFail(recovery.RECOVERY_DELAYS_MS[1]);
    runAndFail(recovery.RECOVERY_DELAYS_MS[2]);
    assert.equal(context.calls.length, 6, 'one manual retry receives only its bounded retry budget');
    assert.equal(controller.manualRetry(), false, 'the incident cannot reset its budget indefinitely');
    assert.equal(env.doc.querySelector('[data-ytark-recovery-retry]').style.display, 'none');
  });

  it('does not retry a user-paused video or an ordinary loading/seek transition', () => {
    const context = makePlayer();
    const clock = makeClock();
    const controller = makeController(context, clock);
    controller.tick();
    context.video.paused = true;
    controller.onPause();
    clock.advance(recovery.RECOVERY_STALL_MS * 2);
    controller.tick();
    assert.equal(context.calls.length, 0);
    assert.equal(controller.incident, null);
    assert.equal(clock.timeouts.size, 0);
  });

  it('does not let a stale HTML media error override a user pause', () => {
    const context = makePlayer();
    const clock = makeClock();
    const controller = makeController(context, clock);
    context.video.error = { code: 2 };
    controller.tick();
    assert.ok(scheduledDelay(clock, recovery.RECOVERY_DELAYS_MS[0]));
    context.video.paused = true;
    controller.onPause();
    clock.advance(recovery.RECOVERY_STALL_MS * 2);
    controller.tick();
    assert.equal(context.calls.length, 0);
    assert.equal(controller.incident, null);
    assert.equal(clock.timeouts.size, 0);
  });

  it('recovers a media error even if the decoder has paused the element, but stops on access restrictions', () => {
    const recoverable = makePlayer({ error: true });
    recoverable.video.paused = true;
    const clock = makeClock();
    const controller = makeController(recoverable, clock);
    controller.tick();
    const first = scheduledDelay(clock, recovery.RECOVERY_DELAYS_MS[0]);
    assert.ok(first, 'a supported player error is eligible despite the decoder pause');
    clock.runTimeout(first);
    assert.equal(recoverable.calls.length, 1);
    controller.destroy();

    const restricted = makePlayer({ error: true, restricted: true });
    restricted.video.paused = true;
    const restrictedController = makeController(restricted, makeClock());
    restrictedController.tick();
    assert.equal(restricted.calls.length, 0);
    assert.equal(restrictedController.incident.state, 'restricted');
    const retry = env.doc.querySelector('[data-ytark-recovery-retry]');
    const back = env.doc.querySelector('[data-ytark-recovery-back]');
    assert.equal(retry.style.display, 'none', 'sign-in/access errors are not offered for blind retry');
    assert.notEqual(back.style.display, 'none');
    assert.equal(restrictedController.manualRetry(), false);
  });

  it('does not retry private, unavailable or unauthorized playback errors', () => {
    for (const text of ['This video is private', 'This video is not available',
      'You do not have access to this video', 'Not authorized to view this content']) {
      const context = makePlayer({ error: true });
      context.player.innerText = text;
      const controller = makeController(context, makeClock());
      controller.tick();
      assert.equal(context.calls.length, 0, text);
      assert.equal(controller.incident.state, 'restricted', text);
      controller.destroy();
    }
  });

  it('lets a late media error supersede loadstart and cancels scheduled retries on navigation', () => {
    const context = makePlayer({ error: true });
    const clock = makeClock();
    const controller = makeController(context, clock);
    controller.onLoadStart();
    controller.onError();
    assert.ok(scheduledDelay(clock, recovery.RECOVERY_DELAYS_MS[0]),
      'a media error is not suppressed by an earlier loadstart');
    env.windowStub.location.hash = '#/browse';
    controller.onNavigation();
    assert.equal(controller.incident, null, 'leaving the watch route cancels the incident immediately');
    assert.equal(clock.timeouts.size, 0);
  });

  it('does not retry in picture-in-picture or override a user pause from the Retry button', () => {
    const pip = makePlayer({ error: true });
    const pipClock = makeClock();
    const pipController = makeController(pip, pipClock);
    pipController.tick();
    const pipRetry = scheduledDelay(pipClock, recovery.RECOVERY_DELAYS_MS[0]);
    env.windowStub.isPipPlaying = true;
    pipClock.runTimeout(pipRetry);
    assert.equal(pip.calls.length, 0, 'a queued retry is stopped when PiP starts');
    env.windowStub.isPipPlaying = false;
    pipController.destroy();

    const paused = makePlayer({ error: true });
    const pausedController = makeController(paused, makeClock());
    pausedController.tick();
    pausedController.finishIncident('failed');
    paused.state.isError = false;
    paused.video.error = null;
    paused.video.paused = true;
    assert.equal(pausedController.manualRetry(), false, 'explicit pause blocks even a manual retry');
    assert.equal(paused.calls.length, 0);
  });

  it('keeps the remote Retry/Back overlay D-pad reachable and routes Back through the TV command resolver', () => {
    const context = makePlayer({ error: true });
    const clock = makeClock();
    const resolved = [];
    const controller = makeController(context, clock, { resolve: command => resolved.push(command) });
    controller.tick();
    controller.finishIncident('failed');
    const retry = env.doc.querySelector('[data-ytark-recovery-retry]');
    const back = env.doc.querySelector('[data-ytark-recovery-back]');
    assert.equal(env.doc.activeElement, retry);
    const right = keyEvent('keydown', 39, retry);
    controller.onOverlayKey(right);
    assert.equal(env.doc.activeElement, back);
    assert.equal(right.defaultPrevented, true);
    const backEvent = keyEvent('keydown', 4, back);
    controller.onOverlayKey(backEvent);
    assert.equal(backEvent.defaultPrevented, true);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].signalAction.signal, 'HISTORY_BACK');
  });
});
