/*global navigate*/
import '../spatial-navigation-polyfill.js';
import css from './ui.css';
import { configRead, configWrite } from '../config.js';
import updateStyle from './theme.js';
import { showToast } from './ytUI.js';
import modernUI from './settings.js';
import resolveCommand, { patchResolveCommand } from '../resolveCommand.js';
import { pipToFullscreen } from '../features/pictureInPicture.js';
import getCommandExecutor from './customCommandExecution.js';
import { t } from 'i18next';

// Initialize the remote settings controls when the TV DOM exists; requiring a
// video element here would make settings unavailable on a quiet home screen.
let startupChecks = 0;
let controlsInitialized = false;
let resolverPatched = false;
const MAX_STARTUP_CHECKS = 160;
const startupInterval = setInterval(() => {
  startupChecks += 1;
  if (!controlsInitialized && document.body) {
    try {
      execute_once_dom_loaded();
      controlsInitialized = true;
    } catch (error) {
      console.warn('[YTArk] TV controls are waiting for the app DOM:', error);
    }
  }

  if (!resolverPatched && window._yttv) {
    const hasResolver = Object.keys(window._yttv).some(key => {
      const module = window._yttv[key];
      return module && module.instance && typeof module.instance.resolveCommand === 'function';
    });
    if (hasResolver) {
      patchResolveCommand();
      resolverPatched = true;
    }
  }

  if ((controlsInitialized && resolverPatched) || startupChecks >= MAX_STARTUP_CHECKS) {
    clearInterval(startupInterval);
  }
}, 250);

let keyTimeout = null;

const keys = {
  49: 1,
  50: 2,
  51: 3,
  52: 4,
  53: 5,
  54: 6,
  55: 7,
  56: 8,
  57: 9,
  48: 0
};

function execute_once_dom_loaded() {

  // Add CSS to head.

  const existingStyle = document.querySelector('style[nonce]');
  if (existingStyle) {
    existingStyle.textContent += css;
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Fix UI issues.
  const ui = configRead('enableFixedUI');
  if (ui) {
    try {
      window.tectonicConfig.featureSwitches.isLimitedMemory = false;
      window.tectonicConfig.clientData.legacyApplicationQuality = 'full-animation';
      window.tectonicConfig.featureSwitches.enableAnimations = true;
      window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = true;
      window.tectonicConfig.featureSwitches.enableListAnimations = true;
      window.tectonicConfig.featureSwitches.supportsLongPress = true;
    } catch (e) { }
  }

  // We handle key events ourselves.
  window.__spatialNavigation__.keyMode = 'NONE';

  var ARROW_KEY_CODE = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

  var uiContainer = document.createElement('div');
  uiContainer.classList.add('ytaf-ui-container');
  uiContainer.style['display'] = 'none';
  uiContainer.setAttribute('tabindex', 0);
  uiContainer.addEventListener(
    'focus',
    () => console.info('uiContainer focused!'),
    true
  );
  uiContainer.addEventListener(
    'blur',
    () => console.info('uiContainer blured!'),
    true
  );

  let previousFocus = null;
  uiContainer.addEventListener('keydown', (evt) => {
    const focusedElement = document.activeElement || document.querySelector(':focus');
    const tag = String(focusedElement && focusedElement.tagName || '').toLowerCase();
    const isTextEntry = tag === 'input' || tag === 'textarea' || tag === 'select'
      || (focusedElement && (focusedElement.isContentEditable
        || focusedElement.getAttribute?.('contenteditable') === 'true'));

    if (evt.keyCode === 27 && !isTextEntry) {
      evt.preventDefault();
      evt.stopPropagation();
      uiContainer.style.display = 'none';
      uiContainer.blur();
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
      return;
    }
    if (isTextEntry) {
      if ((evt.key === 'Enter' || evt.keyCode === 13) && focusedElement) {
        focusedElement.dispatchEvent(new Event('change'));
      }
      return;
    }

    if (evt.keyCode in ARROW_KEY_CODE) {
      navigate(ARROW_KEY_CODE[evt.keyCode]);
      evt.preventDefault();
      evt.stopPropagation();
    } else if (evt.keyCode === 13 || evt.keyCode === 32) {
      if (!focusedElement) return;
      if (focusedElement.type === 'checkbox') {
        focusedElement.checked = !focusedElement.checked;
        focusedElement.dispatchEvent(new Event('change'));
      } else if (evt.keyCode === 13 && typeof focusedElement.click === 'function') {
        focusedElement.click();
      }
      evt.preventDefault();
      evt.stopPropagation();
    }
  }, true);

  try {
    uiContainer.innerHTML = `
<h1>TizenTube Theme Configuration</h1>
<label for="__barColor">Navigation Bar Color: <input type="text" id="__barColor"/></label>
<label for="__routeColor">Main Content Color: <input type="text" id="__routeColor"/></label>
<div><small>Sponsor segments skipping - https://sponsor.ajay.app</small></div>
`;
    document.querySelector('body').appendChild(uiContainer);

    uiContainer.querySelector('#__barColor').value = configRead('focusContainerColor');
    uiContainer.querySelector('#__barColor').addEventListener('change', (evt) => {
      configWrite('focusContainerColor', evt.target.value);
      updateStyle();
    });

    uiContainer.querySelector('#__routeColor').value = configRead('routeColor');
    uiContainer.querySelector('#__routeColor').addEventListener('change', (evt) => {
      configWrite('routeColor', evt.target.value);
      updateStyle();
    });
  } catch (e) { }

  const handledRemoteKeys = new Set();
  const isTextEntryTarget = (target) => {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select'
      || target.isContentEditable === true
      || target.getAttribute?.('contenteditable') === 'true';
  };

  const eventHandler = (evt) => {
    // Only act on keydown. keypress/keyup used to open duplicate settings on
    // remotes that synthesize a full key event sequence.
    if (evt.type !== 'keydown') return true;
    if (isTextEntryTarget(evt.target)) return true;

    if (evt.keyCode in keys && !evt.repeat) {
      const percentage = keys[evt.keyCode] * 10;
      const video = document.querySelector('video');
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = (percentage / 100) * video.duration;
      }
    }

    const container = document.getElementById('container');
    if (window.screenTurnedOffAt && Date.now() - window.screenTurnedOffAt > 1000) {
      for (const child of document.body.children) {
        if (child.tagName.toLowerCase() === 'script' || child.tagName.toLowerCase() === 'svg') continue;
        child.style.setProperty('display', 'block', 'important');
      }
      window.screenTurnedOffAt = null;
    }

    if (configRead('enableScreenDimming') && container) {
      if (keyTimeout) clearTimeout(keyTimeout);
      container.style.setProperty('opacity', '1', 'important');
      keyTimeout = setTimeout(() => {
        const videoPlayer = document.querySelector('.html5-video-player');
        const state = videoPlayer && typeof videoPlayer.getPlayerStateObject === 'function'
          ? videoPlayer.getPlayerStateObject() : null;
        if (state && state.isPlaying) return;
        container.style.setProperty('opacity', String(1 - configRead('dimmingOpacity')), 'important');
      }, configRead('dimmingTimeout') * 1000);
    }

    if (evt.keyCode === 403 || evt.keyCode === 404) {
      if (evt.repeat || handledRemoteKeys.has(evt.keyCode)) return false;
      handledRemoteKeys.add(evt.keyCode);
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.keyCode === 403) {
        if (uiContainer.style.display === 'none') {
          previousFocus = document.activeElement;
          uiContainer.style.display = 'block';
          uiContainer.focus();
        } else {
          uiContainer.style.display = 'none';
          uiContainer.blur();
          if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
            previousFocus.focus();
          }
        }
      } else {
        modernUI();
      }
      return false;
    }

    if (evt.keyCode === 39 && window.isPipPlaying
        && document.querySelector('ytlr-search-text-box > .zylon-focus')) {
      const ytlrPlayer = document.querySelector('ytlr-player');
      if (ytlrPlayer) {
        ytlrPlayer.style.setProperty('background-color', 'rgb(0, 0, 0)');
        pipToFullscreen();
      }
    }
    return true;
  };

  document.addEventListener('keydown', eventHandler, true);
  document.addEventListener('keyup', (evt) => handledRemoteKeys.delete(evt.keyCode), true);
  if (configRead('showWelcomeToast')) {
    setTimeout(() => {
      showToast(t('welcomeMsg.title'), t('welcomeMsg.subtitle'));
    }, 2000);
  }

  if (configRead('reloadHomeOnStartup')) {
    if (configRead('launchToOnStartup')) {
      resolveCommand(JSON.parse(configRead('launchToOnStartup')));
    } else {
      resolveCommand({
        signalAction: {
          signal: 'SOFT_RELOAD_PAGE'
        }
      });
    }
  }

  const commandExecutor = getCommandExecutor();
  if (commandExecutor) {
    commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
  }

  // Fix UI issues, again. Love, Googol.

  if (configRead('enableFixedUI')) {
    try {
      const observer = new MutationObserver((_, _2) => {
        const body = document.body;
        if (body.classList.contains('app-quality-root')) {
          body.classList.remove('app-quality-root');
        }
      });
      observer.observe(document.body, { attributes: true, childList: false, subtree: false });
    } catch (e) { }
  }
}