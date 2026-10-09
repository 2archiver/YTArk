window.queuedVideos = window.queuedVideos || {
  videos: [],
  lastVideoId: null,
};

import resolveCommand from '../resolveCommand.js';

const PLAYER_SELECTOR = '.html5-video-player';
let player = null;
let observer = null;
let attachTimer = null;
let attachAttempts = 0;
let lastEndedVideoId = null;

function contentId(item) {
  return item?.tileRenderer?.contentId || item?.lockupViewModel?.contentId
    || item?.contentId || null;
}

function watchCommand(item) {
  return item?.tileRenderer?.onSelectCommand
    || item?.lockupViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand
    || null;
}

function openQueueItem(item) {
  const command = watchCommand(item);
  if (!command) return false;
  setTimeout(() => resolveCommand(command), 500);
  return true;
}

function onPlayerStateChange() {
  if (!player || !Array.isArray(window.queuedVideos.videos)
      || !window.queuedVideos.videos.length) return;
  let state = null;
  let data = null;
  try {
    state = typeof player.getPlayerStateObject === 'function' ? player.getPlayerStateObject() : null;
    data = typeof player.getVideoData === 'function' ? player.getVideoData() : null;
  } catch (_) {
    return;
  }
  const videoId = data && data.video_id;
  if (state?.isEnded && videoId && lastEndedVideoId !== videoId) {
    lastEndedVideoId = videoId;
    const queue = window.queuedVideos.videos;
    const index = queue.findIndex(item => contentId(item) === videoId);
    const currentIndex = index >= 0 ? index : queue.findIndex(item => contentId(item) === window.queuedVideos.lastVideoId);
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    if (nextIndex >= queue.length || !openQueueItem(queue[nextIndex])) {
      resolveCommand({ customAction: { action: 'CLEAR_QUEUE' } });
    }
    return;
  }

  if (state?.isPlaying && videoId) {
    lastEndedVideoId = null;
    window.queuedVideos.lastVideoId = videoId;
    const container = document.getElementById('container');
    if (container) container.style.setProperty('opacity', '1', 'important');
  }
}

function detachPlayer() {
  if (player && typeof player.removeEventListener === 'function') {
    player.removeEventListener('onStateChange', onPlayerStateChange);
  }
  player = null;
}

function attachPlayer() {
  if (typeof document === 'undefined') return;
  const nextPlayer = document.querySelector(PLAYER_SELECTOR);
  if (nextPlayer === player) return;
  detachPlayer();
  if (nextPlayer && typeof nextPlayer.addEventListener === 'function') {
    player = nextPlayer;
    player.addEventListener('onStateChange', onPlayerStateChange);
    attachAttempts = 0;
    clearTimeout(attachTimer);
    attachTimer = null;
    return;
  }
  if (attachTimer === null && attachAttempts < 20) {
    attachTimer = setTimeout(() => {
      attachTimer = null;
      attachAttempts += 1;
      attachPlayer();
    }, 500);
  }
}

function observePlayer() {
  if (typeof document === 'undefined' || !document.body || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(records => {
    let relevant = false;
    for (const record of records) {
      const target = record.target;
      if (target && target.closest && target.closest(PLAYER_SELECTOR)) {
        relevant = true;
        break;
      }
      for (const node of Array.from(record.addedNodes || [])) {
        if (node.nodeType === 1 && ((node.matches && node.matches(PLAYER_SELECTOR))
            || (node.querySelector && node.querySelector(PLAYER_SELECTOR)))) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
      for (const node of Array.from(record.removedNodes || [])) {
        if (node === player || (node.nodeType === 1 && node.contains && node.contains(player))) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) attachPlayer();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

observePlayer();
attachPlayer();
