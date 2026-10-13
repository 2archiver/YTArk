/*global navigate*/
import '../spatial-navigation-polyfill.js';
import css from './ui.css';
import { configRead, configWrite, configWriteMany, configChangeEmitter } from '../config.js';
import updateStyle from './theme.js';
import { showToast } from './ytUI.js';
import { initWhatsNew, changelogEntryFor } from '../features/whatsNew.js';
import { tx } from '../translations/text.js';
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

// Start-up work is split into idempotent steps so that a failure part-way
// through (and the retry that follows) can never inject styles, panels, key
// handlers or start-up navigation twice.
const startupSteps = {
  css: false,
  panel: false,
  listeners: false,
  navigation: false,
  theme: false,
  longPress: false,
};

// One notice per session when settings cannot be saved (no toast spam).
configChangeEmitter.addEventListener('configPersistError', () => {
  try {
    showToast('YTArk', tx('ytark.storage.saveFailed', 'Settings could not be saved on this TV. Changes apply until the app restarts.'));
  } catch (_) {
    /* the toast is best effort */
  }
});

/** Custom colours only show with the YouTube default theme. */
function saveCustomColor(key, value) {
  if (configRead('uiTheme') === 'oled') {
    configWriteMany({ [key]: value, uiTheme: 'youtube' });
    showToast('YTArk', tx('ytark.appearance.colorsSwitched', 'Theme set to YouTube default so your colours are visible.'));
  } else {
    configWrite(key, value);
  }
  updateStyle();
}

function startupDestination() {
  const raw = configRead('launchToOnStartup');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn('[YTArk] Ignoring an invalid startup destination:', error);
    return null;
  }
}

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

  // Add CSS to head (once).
  if (!startupSteps.css) {
    const existingStyle = document.querySelector('style[nonce]');
    if (existingStyle) {
      existingStyle.textContent += css;
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    }
    startupSteps.css = true;
  }

  // Appearance: apply the managed theme once the TV DOM exists.
  //
  // ui/theme.js already applies the theme at import time, but that can run
  // before <head> exists, and the frontend rebuilds parts of the document as
  // routes load. Re-applying here puts the managed stylesheet in <head> next to
  // YTArk's own CSS and re-asserts the root classes, which is what makes OLED
  // Black (and the player/watermark switches) actually paint. Later route
  // changes are covered by theme.js's own <html class> and <head> observers.
  if (!startupSteps.theme) {
    startupSteps.theme = true;
    try {
      updateStyle();
    } catch (error) {
      console.warn('[YTArk] The appearance theme could not be applied:', error);
    }
  }

  // Long-press menus: YTArk injects long-press actions into renderer payloads
  // (features/adblock.js, gated by the `enableLongPress` setting). The Cobalt
  // frontend only dispatches them when its own feature switch is on, so keep
  // that switch in step with the user's preference. This is the one part of the
  // removed "Fix UI" toggle that did real work; the rest only flipped
  // animation/quality switches the frontend sets for this device itself.
  if (!startupSteps.longPress) {
    startupSteps.longPress = true;
    try {
      if (window.tectonicConfig && window.tectonicConfig.featureSwitches) {
        window.tectonicConfig.featureSwitches.supportsLongPress = configRead('enableLongPress') === true;
      }
    } catch (error) {
      console.warn('[YTArk] The long-press feature switch could not be set:', error);
    }
  }

  // We handle key events ourselves.
  if (window.__spatialNavigation__) window.__spatialNavigation__.keyMode = 'NONE';

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

  if (!startupSteps.panel) try {
    uiContainer.innerHTML = `
<h1>YTArk Settings</h1>
<label for="__barColor">Navigation Bar Color: <input type="text" id="__barColor"/></label>
<label for="__routeColor">Main Content Color: <input type="text" id="__routeColor"/></label>
<div><small>Sponsor segments skipping - https://sponsor.ajay.app</small></div>
`;
    document.querySelector('body').appendChild(uiContainer);

    uiContainer.querySelector('#__barColor').value = configRead('focusContainerColor');
    uiContainer.querySelector('#__barColor').addEventListener('change', (evt) => {
      saveCustomColor('focusContainerColor', evt.target.value);
    });

    uiContainer.querySelector('#__routeColor').value = configRead('routeColor');
    uiContainer.querySelector('#__routeColor').addEventListener('change', (evt) => {
      saveCustomColor('routeColor', evt.target.value);
    });
    startupSteps.panel = true;
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

  if (!startupSteps.listeners) {
    document.addEventListener('keydown', eventHandler, true);
    document.addEventListener('keyup', (evt) => handledRemoteKeys.delete(evt.keyCode), true);
    startupSteps.listeners = true;
  }
  if (!startupSteps.navigation) {
    startupSteps.navigation = true;
    if (configRead('reloadHomeOnStartup')) {
      const destination = startupDestination();
      resolveCommand(destination || {
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

  // Post-update What's new: evaluated once, announced once, never over playback.
  try {
    initWhatsNew({
      announce: (version) => {
        const entry = changelogEntryFor(version);
        showToast(
          tx('ytark.whatsNew.toastTitle', 'YTArk updated to {{version}}', { version: entry ? entry.display : version }),
          tx('ytark.whatsNew.toastBody', 'Version history and release notes are in YTArk Updates.'),
        );
      },
    });
  } catch (error) {
    console.warn('[YTArk] What\'s new could not be evaluated:', error);
  }
}