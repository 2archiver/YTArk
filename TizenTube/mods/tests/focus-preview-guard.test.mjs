// The focus-dwell preview guard: an automatic inline-playback (focus
// preview) command must never replace a different, currently playing
// video. Deliberate OK/Play (watchEndpoint) activation and genuine
// browse-page previews are unaffected. Long-press is a separate
// onLongPressCommand path and is not exercised here.
// (features/focusPreviewGuard.js + the resolver boundary in resolveCommand.js.)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement } from './helpers/fake-dom.mjs';
import {
  setupEnvironment, initEnglish,
} from './helpers/ytlr-harness.mjs';

const { doc, windowStub, recorded } = setupEnvironment();
await initEnglish();
const guard = await import('../features/focusPreviewGuard.js');

// One frontend registry: the resolver instance the tests record into,
// plus the mappings registry that holds PlayerService. The resolver is
// patched once over this structure, so tests only mutate the live
// PlayerService config and never reassign _yttv (which would drop the
// patch).
const playerService = { loadedPlaybackConfig: {} };
const mappings = new Map([['PlayerService', playerService]]);
windowStub._yttv = {
  app: { instance: { resolveCommand(cmd) { recorded.push(cmd); return true; } } },
  registry: { mappings },
};
// The existing watchEndpoint handler touches the player container;
// keep it present so a deliberate activation reaches the recorder.
const playerContainer = new FakeElement('ytlr-player-container', doc);
doc.body.appendChild(playerContainer);
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const resolveCommand = resolve.default;

/** A focus-dwell inline-playback command for `videoId`. */
function previewCommand(videoId) {
  return {
    startInlinePlaybackCommand: {
      blockAdoption: true,
      delayMs: 3000,
      durationMs: 40000,
      muted: false,
      resumeVideo: true,
      playbackEndpoint: { watchEndpoint: { videoId } },
    },
  };
}

/** A deliberate OK/Play activation for `videoId`. */
function selectCommand(videoId) {
  return { watchEndpoint: { videoId } };
}

/** Point the frontend PlayerService at `videoId` (undefined = nothing loaded). */
function setPlayingVideo(videoId) {
  playerService.loadedPlaybackConfig = videoId === undefined
    ? {}
    : { watchEndpoint: { videoId } };
}

/** Remove the mounted player element (browse page: no player on screen). */
function detachPlayer() {
  const video = doc.querySelector('video');
  if (video && video.parentNode) video.parentNode.removeChild(video);
}

function reattachPlayer() {
  if (!doc.querySelector('video')) doc.body.appendChild(new FakeElement('video', doc));
}

beforeEach(() => {
  recorded.length = 0;
  reattachPlayer();
  setPlayingVideo(undefined);
});

describe('inline playback command recognition', () => {
  it('recognises only the automatic focus-dwell preview command', () => {
    assert.equal(guard.isInlinePlaybackCommand(previewCommand('aaa')), true);
    assert.equal(guard.isInlinePlaybackCommand(selectCommand('aaa')), false);
    assert.equal(guard.isInlinePlaybackCommand({ watchEndpoint: { videoId: 'x' } }), false);
    assert.equal(guard.isInlinePlaybackCommand(null), false);
  });

  it('reads the preview target from playbackEndpoint.watchEndpoint', () => {
    assert.equal(guard.inlinePlaybackVideoId(previewCommand('dQw4w9WgXcQ')), 'dQw4w9WgXcQ');
    assert.equal(guard.inlinePlaybackVideoId({ startInlinePlaybackCommand: {} }), null);
  });

  it('reads a bare playbackEndpoint.videoId too', () => {
    assert.equal(
      guard.inlinePlaybackVideoId({ startInlinePlaybackCommand: { playbackEndpoint: { videoId: 'xyz' } } }),
      'xyz',
    );
  });
});

describe('shouldBlockFocusPreview', () => {
  it('blocks a preview of a different video while a player is mounted', () => {
    assert.equal(
      guard.shouldBlockFocusPreview(previewCommand('OTHER456'), { playerMounted: true, playerVideoId: 'PLAYING123' }),
      true,
    );
  });

  it('allows the same video to be re-previewed', () => {
    assert.equal(
      guard.shouldBlockFocusPreview(previewCommand('PLAYING123'), { playerMounted: true, playerVideoId: 'PLAYING123' }),
      false,
    );
  });

  it('allows previews on a browse page where no player is mounted', () => {
    assert.equal(
      guard.shouldBlockFocusPreview(previewCommand('OTHER456'), { playerMounted: false, playerVideoId: null }),
      false,
    );
  });

  it('allows a preview when a player is mounted but nothing is loaded yet', () => {
    assert.equal(
      guard.shouldBlockFocusPreview(previewCommand('OTHER456'), { playerMounted: true, playerVideoId: null }),
      false,
    );
  });

  it('never blocks a deliberate watchEndpoint activation', () => {
    assert.equal(
      guard.shouldBlockFocusPreview(selectCommand('OTHER456'), { playerMounted: true, playerVideoId: 'PLAYING123' }),
      false,
    );
  });
});

describe('resolver boundary', () => {
  it('consumes a dwelling focus preview that would replace the playing video', () => {
    setPlayingVideo('PLAYING123');
    resolveCommand(previewCommand('OTHER456'));
    assert.equal(recorded.length, 0, 'the replacement preview must not reach the frontend');
  });

  it('still forwards a preview of the video that is already playing', () => {
    setPlayingVideo('PLAYING123');
    resolveCommand(previewCommand('PLAYING123'));
    assert.equal(recorded.length, 1, 'a same-video re-preview is harmless');
  });

  it('still forwards a browse-page preview when no player is mounted', () => {
    detachPlayer();
    setPlayingVideo(undefined);
    resolveCommand(previewCommand('HOME_PREVIEW'));
    assert.equal(recorded.length, 1, 'overlay previews on browse pages stay available');
  });

  it('still forwards a deliberate OK/Play activation while a video plays', () => {
    setPlayingVideo('PLAYING123');
    resolveCommand(selectCommand('OTHER456'));
    assert.equal(recorded.length, 1, 'deliberate activation must open the card exactly once');
    assert.equal(recorded[0].watchEndpoint.videoId, 'OTHER456');
  });

  it('re-judges a late preview against the video playing now, not when it was armed', () => {
    // The dwell timer was armed on the browse page (no player), the user
    // then started a video, and only now the late preview fires.
    setPlayingVideo('NOW_PLAYING');
    resolveCommand(previewCommand('LATE_TARGET'));
    assert.equal(recorded.length, 0, 'a late preview must not replace the newly playing video');
  });

  it('reads the loaded video through the frontend PlayerService', () => {
    setPlayingVideo('PLAYING123');
    assert.equal(guard.loadedVideoId(guard.findPlayerService(windowStub)), 'PLAYING123');
    setPlayingVideo(undefined);
    assert.equal(guard.loadedVideoId(guard.findPlayerService(windowStub)), null);
  });

  it('uses the mounted <video> as the watch-page signal', () => {
    const ctx = guard.readPlaybackContext({ documentObject: doc, playerService: null });
    assert.equal(ctx.playerMounted, true);
    detachPlayer();
    const browseCtx = guard.readPlaybackContext({ documentObject: doc, playerService: null });
    assert.equal(browseCtx.playerMounted, false);
  });
});
