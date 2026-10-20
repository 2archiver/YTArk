// Focus-dwell preview guard.
//
// The reported defect: while a video keeps playing, browsing the cards
// underneath it and leaving the remote's focus on one card eventually
// starts that card's video *by itself*, replacing the playing one. No OK,
// click or Play was pressed.
//
// What the inspected code shows
// -----------------------------
// Two completely separate renderer fields drive a card:
//   * `onSelectCommand`  -> the deliberate OK/Play/click activation. It
//     carries the `watchEndpoint` navigation and is what opens a video.
//   * `onFocusCommand`   -> an automatic command the frontend runs when
//     remote focus dwells on a card. YTArk's `addPreviews`
//     (features/adblock.js) injects a `startInlinePlaybackCommand` here
//     so a focused card can *preview*; the frontend may also provide its
//     own focus command natively.
// A long *press* is different again: `addLongPress` injects an
// `onLongPressCommand` that only opens a menu (Play, Watch Later, ...).
// It never starts playback by itself, and a long focus duration is not a
// long press - the two are separate fields with separate triggers. The
// reproduction ("leave focus on a card ... without pressing OK/Play") is
// therefore a focus-dwell path, and long-press handlers are not involved.
//
// The inline-playback preview plays the same `watchEndpoint` OK uses, so
// on the watch page (a player is mounted) a dwelling focus adopts the
// main player and replaces the playing video. `blockAdoption` is meant to
// stop that, but it is a hint the frontend build may not honour, and it
// cannot be relied on to keep the playing video on screen.
//
// The fix
// -------
// YTArk already owns one activation boundary: the patched command
// resolver (resolveCommand.js). Every command the frontend dispatches -
// navigation, playback, popup, and a focus command - is resolved through
// it. This module decides, at that boundary, whether an *automatic*
// inline-playback (focus preview) command may run:
//
//   * On a browse page (home, search) no player is mounted, so a focus
//     preview is a harmless overlay: allowed.
//   * On the watch page a player is mounted. A preview of the *same*
//     video is a harmless re-preview: allowed. A preview of a *different*
//     video would replace the playing one: blocked.
//
// Deliberate activation (OK/Play/click -> `watchEndpoint`) and ordinary
// playback-end autoplay/queue (the player's own next-up, not a focus
// command) never pass through this guard, so they are unaffected. The
// guard reads the *current* playback context when the command actually
// fires, so a stale or late preview left over from a route, menu or
// playback change is judged against the video that is playing *now*,
// not the video that was playing when the dwell timer was armed.

/** True for the automatic inline-playback (focus-dwell preview) command. */
export function isInlinePlaybackCommand(command) {
  return !!command && typeof command === 'object'
    && !!command.startInlinePlaybackCommand
    && typeof command.startInlinePlaybackCommand === 'object';
}

/**
 * The video an inline-playback preview would play, or null.
 * `playbackEndpoint` is a copy of the tile's `onSelectCommand`, so the
 * id lives at `playbackEndpoint.watchEndpoint.videoId`; accept a bare
 * `playbackEndpoint.videoId` too for builds that unwrap it.
 */
export function inlinePlaybackVideoId(command) {
  const inline = command && command.startInlinePlaybackCommand;
  if (!inline || typeof inline !== 'object') return null;
  const endpoint = inline.playbackEndpoint;
  if (!endpoint || typeof endpoint !== 'object') return null;
  const watchEndpoint = endpoint.watchEndpoint && typeof endpoint.watchEndpoint === 'object'
    ? endpoint.watchEndpoint
    : endpoint;
  const videoId = watchEndpoint && watchEndpoint.videoId;
  return typeof videoId === 'string' && videoId.length > 0 ? videoId : null;
}

/** The video the player currently has loaded, or null when nothing is. */
export function loadedVideoId(playerService) {
  const config = playerService && playerService.loadedPlaybackConfig;
  const watchEndpoint = config && config.watchEndpoint;
  const videoId = watchEndpoint && watchEndpoint.videoId;
  return typeof videoId === 'string' && videoId.length > 0 ? videoId : null;
}

/**
 * Find the frontend PlayerService (lazily; absent while only browsing).
 * Returns null when the registry or the service is not available yet.
 * The registry entry either exposes its service map directly or through
 * a `mappings` property; both shapes are accepted so a frontend change
 * cannot throw.
 */
export function findPlayerService(scope) {
  try {
    const values = Object.values((scope && scope._yttv) || {});
    const holder = values.find(entry => entry && entry.mappings);
    const mappings = holder && holder.mappings ? holder.mappings : holder;
    return mappings && typeof mappings.get === 'function' ? mappings.get('PlayerService') : null;
  } catch (_) {
    return null;
  }
}

/**
 * The live playback context the guard judges against: whether a player is
 * mounted (a watch page) and which video it holds. A mounted `<video>` is
 * the reliable "a player is on screen" signal - browse pages do not mount
 * one, so their overlay previews stay available.
 */
export function readPlaybackContext({ documentObject, playerService } = {}) {
  let mounted = false;
  try {
    mounted = !!(documentObject && typeof documentObject.querySelector === 'function'
      && documentObject.querySelector('video'));
  } catch (_) {
    mounted = false;
  }
  return { playerMounted: mounted, playerVideoId: loadedVideoId(playerService) };
}

/**
 * Whether an automatic focus-dwell preview must be blocked.
 *
 * @param {object} command  the command being resolved.
 * @param {{playerMounted?: boolean, playerVideoId?: string|null}} context
 * @returns {boolean} true when running the command would replace a
 *   different playing video. Never true for a deliberate activation:
 *   those are `watchEndpoint` commands, not inline previews.
 */
export function shouldBlockFocusPreview(command, context = {}) {
  if (!isInlinePlaybackCommand(command)) return false;
  const target = inlinePlaybackVideoId(command);
  if (!target) return false;                 // not a video preview
  if (!context.playerMounted) return false;  // browse page: overlay preview
  const current = context.playerVideoId;
  if (!current) return false;                // mounted but nothing loaded yet
  if (target === current) return false;      // re-previewing the playing video
  return true;                               // would replace the playing video
}

/**
 * Decide one resolved command against the live context. Returns the
 * command unchanged when it may run, or null when the guard blocks it.
 * Kept as a single entry point so the resolver patch stays a one-liner.
 */
export function adjudicate(command, context) {
  return shouldBlockFocusPreview(command, context) ? null : command;
}
