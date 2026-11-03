/** Optional TV player capability adapter. Missing language/track APIs are unknown,
 * never evidence that preferred audio is absent. No network or caption downloads. */
export function trackLanguage(track) {
  if (!track || typeof track !== 'object') return null;
  const explicit = track.languageCode || track.language;
  const source = typeof explicit === 'string' ? explicit : track.id;
  if (typeof source !== 'string') return null;
  const match = source.match(/^([a-z]{2,3}(?:-[A-Za-z]{2,4})?)(?:[.;]|$)/);
  return match ? match[1].toLowerCase() : null;
}
export function languageMatches(track, preferred) {
  const language = trackLanguage(track);
  const wanted = String(preferred || '').toLowerCase();
  return !!language && (language === wanted || (!wanted.includes('-') && language.split('-')[0] === wanted));
}
function captionKey(track) {
  if (!track || !trackLanguage(track)) return null;
  return [trackLanguage(track), track.vssId || track.id || '', track.kind || ''].join(':');
}
export function isManualTrackCommand(command, depth = 0) {
  if (!command || typeof command !== 'object' || depth > 4) return false;
  if (command.selectSubtitlesTrackCommand || command.toggleSubtitlesCommand
      || command.selectAudioTrackCommand) return true;
  const children = command.commandExecutorCommand && command.commandExecutorCommand.commands;
  return Array.isArray(children) && children.slice(0, 32).some(child => isManualTrackCommand(child, depth + 1));
}
export class CaptionFallback {
  constructor({ settings, notify = () => {}, later = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) } = {}) {
    this.settings = settings;
    this.notify = notify;
    this.later = later;
    this.cancel = cancel;
    this.timer = null;
    this.player = null;
    this.videoId = null;
    this.status = 'off';
    this.attempts = 0;
    this.manual = false;
    this.applied = null;
    this.settling = 0;
  }
  reset(player = null, videoId = null) {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.player = player;
    this.videoId = videoId;
    this.attempts = 0;
    this.manual = false;
    this.applied = null;
    this.settling = 0;
    this.status = 'waiting';
  }
  respectManualSelection() {
    this.manual = true;
    this.status = 'manual';
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
  retry() {
    if (this.timer !== null || this.attempts >= 12 || this.manual) return;
    this.timer = this.later(() => {
      this.timer = null;
      this.attempts += 1;
      this.check(this.player, this.videoId);
    }, 500);
  }
  check(player, videoId) {
    if (player !== this.player || videoId !== this.videoId) this.reset(player, videoId);
    if (!this.settings('enableCaptionFallback')) {
      if (this.timer !== null) this.cancel(this.timer);
      this.timer = null;
      this.status = 'off';
      return;
    }
    if (this.manual || !player || !videoId) return;
    try {
      if (typeof player.getOption !== 'function' || typeof player.setOption !== 'function') {
        this.status = 'unsupported';
        return;
      }
      const current = player.getOption('captions', 'track');
      // An unknown caption state must not be treated as captions being off.
      if (!current || typeof current !== 'object') { this.status = 'waiting'; this.retry(); return; }
      const currentKey = captionKey(current);
      if (this.applied) {
        if (currentKey === this.applied) { this.status = 'applied'; return; }
        // Give an asynchronous setOption one bounded second to settle.
        if (this.settling++ < 2) { this.retry(); return; }
        this.respectManualSelection();
        return;
      }
      if (currentKey) { this.status = 'captions-already-on'; return; }
      let response = null;
      if (typeof player.getPlayerResponse === 'function') response = player.getPlayerResponse();
      if (response && response.videoDetails && response.videoDetails.videoId !== videoId) {
        this.status = 'waiting'; this.retry(); return;
      }
      let audio = typeof player.getAvailableAudioTracks === 'function' ? player.getAvailableAudioTracks() : null;
      const captionRenderer = response && response.captions && response.captions.playerCaptionsTracklistRenderer;
      if (!Array.isArray(audio) && captionRenderer) audio = captionRenderer.audioTracks;
      if (!Array.isArray(audio) || !audio.length || audio.some(track => !trackLanguage(track))) {
        this.status = 'audio-unknown'; this.retry(); return;
      }
      if (audio.some(track => languageMatches(track, this.settings('preferredAudioLanguage')))) {
        this.status = 'preferred-audio-available';
        return;
      }
      const tracks = player.getOption('captions', 'tracklist');
      const captions = Array.isArray(tracks) ? tracks : captionRenderer && captionRenderer.captionTracks;
      if (!Array.isArray(captions) || !captions.length) { this.status = 'captions-unavailable'; this.retry(); return; }
      const selected = captions.find(track => languageMatches(track, this.settings('fallbackCaptionLanguage')) && track.kind !== 'asr')
        || captions.find(track => languageMatches(track, this.settings('fallbackCaptionLanguage')));
      if (!selected) { this.status = 'language-unavailable'; return; }
      // No translated track is fabricated; select only a track actually advertised.
      this.applied = captionKey(selected);
      const result = player.setOption('captions', 'track', selected);
      if (result === false) { this.applied = null; this.status = 'unsupported'; return; }
      this.status = 'requested';
      this.retry();
      // Confirmation is reflected in status after the player reports its track.
    } catch (_) {
      this.status = 'unsupported';
      if (this.timer !== null) this.cancel(this.timer);
      this.timer = null;
    }
  }
  destroy() { this.reset(); this.status = 'off'; }
}
