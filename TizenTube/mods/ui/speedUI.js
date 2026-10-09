import { configRead, configChangeEmitter } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';
import { t } from 'i18next';

let activeVideo = null;
let videoObserver = null;
let attachTimer = null;
let attachAttempts = 0;
const handledKeys = new Set();

function isTextEntryTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select'
    || target.isContentEditable === true || target.getAttribute?.('contenteditable') === 'true';
}

function applySavedSpeed(video) {
  if (!video) return;
  const speed = Number(configRead('videoSpeed'));
  if (!Number.isFinite(speed) || speed <= 0) return;
  try {
    if (Math.abs(Number(video.playbackRate) - speed) > 0.001) video.playbackRate = speed;
  } catch (error) {
    console.warn('[YTArk speed] Could not apply the saved playback speed:', error);
  }
}

function detachVideo() {
  if (!activeVideo) return;
  activeVideo.removeEventListener('loadedmetadata', onVideoReady);
  activeVideo.removeEventListener('canplay', onVideoReady);
  activeVideo = null;
}

function onVideoReady(event) {
  applySavedSpeed(event.currentTarget || activeVideo);
}

function attachVideo() {
  if (typeof document === 'undefined') return;
  const video = document.querySelector('video');
  if (video === activeVideo) return;
  detachVideo();
  if (video && typeof video.addEventListener === 'function') {
    activeVideo = video;
    activeVideo.addEventListener('loadedmetadata', onVideoReady);
    activeVideo.addEventListener('canplay', onVideoReady);
    applySavedSpeed(activeVideo);
    attachAttempts = 0;
    clearTimeout(attachTimer);
    attachTimer = null;
    return;
  }
  if (attachTimer === null && attachAttempts < 20) {
    attachTimer = setTimeout(() => {
      attachTimer = null;
      attachAttempts += 1;
      attachVideo();
    }, 500);
  }
}

function observeVideos() {
  if (typeof document === 'undefined' || !document.body || typeof MutationObserver === 'undefined') return;
  if (videoObserver) videoObserver.disconnect();
  videoObserver = new MutationObserver(records => {
    let relevant = false;
    for (const record of records) {
      if (record.target && record.target.closest && record.target.closest('video')) {
        relevant = true;
        break;
      }
      for (const node of Array.from(record.addedNodes || [])) {
        if (node.nodeType === 1 && ((node.matches && node.matches('video'))
            || (node.querySelector && node.querySelector('video')))) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
      for (const node of Array.from(record.removedNodes || [])) {
        if (node === activeVideo || (node.nodeType === 1 && node.contains && node.contains(activeVideo))) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) attachVideo();
  });
  videoObserver.observe(document.body, { childList: true, subtree: true });
}

configChangeEmitter.addEventListener('configChange', event => {
  if (event.detail && event.detail.key === 'videoSpeed') applySavedSpeed(activeVideo);
});

if (typeof document !== 'undefined') {
  observeVideos();
  attachVideo();
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', event => {
    if (event.keyCode !== 406 && event.keyCode !== 191) return;
    if (isTextEntryTarget(event.target)) return;
    if (event.repeat || handledKeys.has(event.keyCode)) return;
    handledKeys.add(event.keyCode);
    event.preventDefault();
    event.stopPropagation();
    speedSettings();
  }, true);

  document.addEventListener('keyup', event => {
    handledKeys.delete(event.keyCode);
  }, true);
}

function speedSettings() {
  const currentSpeed = Number(configRead('videoSpeed')) || 1;
  const maxSpeed = 5;
  const increment = Number(configRead('speedSettingsIncrement')) || 0.25;
  const safeIncrement = increment > 0 && increment <= 1 ? increment : 0.25;
  const buttons = [];
  let selectedIndex = 0;

  for (let step = 1; step * safeIncrement <= maxSpeed + 0.001; step += 1) {
    const fixedSpeed = Math.round(step * safeIncrement * 100) / 100;
    buttons.push(buttonItem(
      { title: `${fixedSpeed}x` },
      null,
      [
        { signalAction: { signal: 'POPUP_BACK' } },
        {
          setClientSettingEndpoint: {
            settingDatas: [{
              clientSettingEnum: { item: 'videoSpeed' },
              intValue: fixedSpeed.toString(),
            }],
          },
        },
        { customAction: { action: 'SET_PLAYER_SPEED', parameters: fixedSpeed.toString() } },
      ]
    ));
    if (Math.abs(currentSpeed - fixedSpeed) < 0.001) selectedIndex = buttons.length - 1;
  }

  buttons.push(buttonItem(
    { title: t('player.playbackSpeed.fixStuttering') },
    null,
    [
      { signalAction: { signal: 'POPUP_BACK' } },
      {
        setClientSettingEndpoint: {
          settingDatas: [{
            clientSettingEnum: { item: 'videoSpeed' },
            intValue: '1.0001',
          }],
        },
      },
      { customAction: { action: 'SET_PLAYER_SPEED', parameters: '1.0001' } },
    ]
  ));

  showModal(
    { title: t('player.playbackSpeed.title'), subtitle: `Current speed: ${currentSpeed}x` },
    overlayPanelItemListRenderer(buttons, selectedIndex),
    'tt-speed'
  );
}

export { speedSettings, applySavedSpeed };
