import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptionFallback, trackLanguage, isManualTrackCommand } from '../features/captionFallback.js';
import { createQualityNotice, nativeQualityToast } from '../features/qualityNotice.js';

function clock() {
  let time = 0; let next = 1; const pending = new Map();
  return {
    now: () => time,
    later: (fn, ms) => { const id = next++; pending.set(id, { fn, at: time + ms }); return id; },
    cancel: id => pending.delete(id),
    count: () => pending.size,
    advance(ms) {
      const end = time + ms;
      for (let n = 0; n < 100; n++) {
        const task = [...pending].sort((a,b) => a[1].at - b[1].at)[0];
        if (!task || task[1].at > end) break;
        time = task[1].at; pending.delete(task[0]); task[1].fn();
      }
      time = end;
    },
  };
}
function captionFixture({ audio = [{ id: 'ja.4' }], current = {}, tracks = [{ languageCode: 'en', vssId: '.en' }], enabled = true } = {}) {
  const timer = clock(); const calls = [];
  const settings = { enableCaptionFallback: enabled, preferredAudioLanguage: 'en', fallbackCaptionLanguage: 'en' };
  let selected = current;
  const player = {
    getAvailableAudioTracks: () => audio,
    getOption: (module, key) => key === 'tracklist' ? tracks : selected,
    setOption: (module, key, value) => { calls.push(value); selected = value; },
  };
  const fallback = new CaptionFallback({ settings: key => settings[key], later: timer.later, cancel: timer.cancel });
  return { fallback, player, calls, settings, timer, select: value => { selected = value; } };
}
test('caption fallback applies only an available matching caption and confirms it without looping', () => {
  const f = captionFixture();
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.calls.length, 1);
  f.timer.advance(500);
  assert.equal(f.fallback.status, 'applied');
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.calls.length, 1);
  assert.equal(f.timer.count(), 0);
});
test('preferred audio, existing captions and unknown audio prevent automatic caption changes', () => {
  for (const options of [
    { audio: [{ languageCode: 'en-GB' }] },
    { current: { languageCode: 'de' } },
    { audio: [] }, { audio: [{ id: 'unknown' }] },
    { audio: [{ id: 'ja.4' }, { id: 'unknown' }] },
  ]) {
    const f = captionFixture(options);
    f.fallback.check(f.player, 'video-1');
    assert.equal(f.calls.length, 0);
    f.fallback.destroy();
  }
});
test('missing captions or target language never fabricate translated tracks', () => {
  for (const tracks of [[], [{ languageCode: 'de' }]]) {
    const f = captionFixture({ tracks });
    f.fallback.check(f.player, 'video-1');
    f.timer.advance(20000);
    assert.equal(f.calls.length, 0);
    assert.equal(f.timer.count(), 0);
  }
});
test('human captions are preferred to ASR and regional audio language is parsed conservatively', () => {
  const f = captionFixture({ tracks: [{ languageCode: 'en', kind: 'asr' }, { languageCode: 'en', vssId: '.en' }] });
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.calls[0].kind, undefined);
  assert.equal(trackLanguage({ id: 'en-US.4' }), 'en-us');
  assert.equal(trackLanguage({ id: 'dubbed' }), null);
  f.fallback.destroy();
});
test('manual caption commands win and a later video gets a fresh decision', () => {
  const f = captionFixture();
  f.fallback.check(f.player, 'video-1');
  f.fallback.respectManualSelection();
  f.select({});
  f.timer.advance(10000);
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.calls.length, 1);
  f.fallback.check(f.player, 'video-2');
  assert.equal(f.calls.length, 2);
  f.fallback.destroy();
  assert.equal(isManualTrackCommand({ commandExecutorCommand: { commands: [{ selectSubtitlesTrackCommand: {} }] } }), true);
  assert.equal(isManualTrackCommand({ openPopupAction: { popup: { selectSubtitlesTrackCommand: {} } } }), false);
});
test('manual changes observed after fallback are not reapplied', () => {
  const f = captionFixture();
  f.fallback.check(f.player, 'video-1');
  f.timer.advance(500);
  f.select({});
  f.fallback.check(f.player, 'video-1');
  f.timer.advance(2000);
  assert.equal(f.fallback.status, 'manual');
  assert.equal(f.calls.length, 1);
});
test('unsupported player APIs, stale metadata and opt-out do not mutate playback', () => {
  const f = captionFixture();
  f.player.getPlayerResponse = () => ({ videoDetails: { videoId: 'previous-video' } });
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.calls.length, 0);
  f.settings.enableCaptionFallback = false;
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.timer.count(), 0);
  assert.equal(f.fallback.status, 'off');
  f.settings.enableCaptionFallback = true;
  f.player.getOption = undefined;
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.fallback.status, 'unsupported');
  assert.equal(f.calls.length, 0);
});
test('late audio data is retried within a finite budget and recovered after API availability', () => {
  const f = captionFixture({ audio: [] });
  f.fallback.check(f.player, 'video-1');
  f.timer.advance(20000);
  assert.equal(f.timer.count(), 0);
  assert.equal(f.calls.length, 0);
  f.player.getAvailableAudioTracks = () => [{ id: 'ja.4' }];
  f.fallback.check(f.player, 'video-1');
  assert.equal(f.calls.length, 1);
  f.fallback.destroy();
});
test('quality notices coalesce changes, obey cooldown, do not duplicate and reset on navigation', () => {
  const timer = clock(); let quality = '720p'; let enabled = true; const notices = [];
  const notice = createQualityNotice({ notify: (...args) => notices.push(args), current: () => quality,
    enabled: () => enabled, ...timer });
  notice.request('one'); quality = '1080p'; notice.request('one'); timer.advance(1200);
  assert.deepEqual(notices, [['Quality', '1080p']]);
  notice.request('one'); timer.advance(1200); assert.equal(notices.length, 1);
  quality = '720p'; notice.request('one'); timer.advance(1200); assert.equal(notices.length, 1);
  timer.advance(8000); assert.equal(notices.at(-1)[1], '720p');
  quality = '1080p'; notice.request('one'); notice.reset('two'); timer.advance(2000);
  assert.equal(notices.length, 2);
  notice.request('two'); timer.advance(1200); assert.equal(notices.length, 3);
  enabled = false; quality = '480p'; notice.request('two'); timer.advance(1200);
  assert.equal(notices.length, 3); notice.stop(); assert.equal(timer.count(), 0);
});
test('quality notices reject unknown labels and hidden playback', () => {
  const timer = clock(); const notices = []; let quality = 'auto'; let visible = true;
  const notice = createQualityNotice({ notify: (...args) => notices.push(args), current: () => quality,
    enabled: () => true, visible: () => visible, ...timer });
  notice.request('one'); timer.advance(1200); assert.equal(notices.length, 0);
  quality = '1080p'; visible = false; notice.request('one'); timer.advance(1200);
  assert.equal(notices.length, 0); notice.stop();
});
test('native quality notification uses the TV toast and contains no navigation or focus command', () => {
  const calls = []; globalThis.window = { _yttv: { app: { instance: { resolveCommand: c => calls.push(c) } } } };
  assert.equal(nativeQualityToast('Quality', '1080p'), true);
  assert.equal(calls[0].openPopupAction.popupType, 'TOAST');
  assert.equal(calls[0].openPopupAction.popup.overlayToastRenderer.subtitle.simpleText, '1080p');
  delete globalThis.window;
});
