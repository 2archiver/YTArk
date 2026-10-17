/*global navigate*/
import '../spatial-navigation-polyfill.js';
import { startReadiness } from '../features/startupReadiness.js';
import { browserDiagnostics, remoteKeyCategory } from '../features/browserDiagnostics.js';
import { createStartupNavigation } from '../features/startupNavigation.js';
import { installStartupIntentGuard } from '../features/startupIntentGuard.js';
import { createSettingsInputOwner } from './settingsInputOwnership.js';
import { createStartupGuideRefresh } from '../features/startupGuideRefresh.js';
import css from './ui.css';
import { configRead, configWrite, configWriteMany, configChangeEmitter } from '../config.js';
import updateStyle from './theme.js';
import {
  showToast, hasVisibleYtarkModal, hasVisibleYtarkSettingsPanel, ytarkModalBackCommand,
} from './ytUI.js';
import { tx } from '../translations/text.js';
import modernUI from './settings.js';
import resolveCommand, { patchResolveCommand } from '../resolveCommand.js';
import { pipToFullscreen } from '../features/pictureInPicture.js';
import getCommandExecutor from './customCommandExecution.js';
import { t } from 'i18next';

// This mark is exactly where ui.js begins evaluating, after its static imports;
// it is not a process-start or Android-launch timestamp. Recording is opt-in.
browserDiagnostics.record('ui-module-evaluated', 'observed', 'proxy');

/** True when the app exposes a command resolver instance to patch and call. */
function hasCommandResolver() {
  try {
    return !!window._yttv && Object.keys(window._yttv).some((key) => {
      const module = window._yttv[key];
      return module && module.instance && typeof module.instance.resolveCommand === 'function';
    });
  } catch (_) {
    return false;
  }
}

// Initialize controls when the TV DOM exists; a quiet Home need not contain a
// video element. Startup diagnostics never participate in readiness decisions.
let controlsInitialized = false;
let resolverObserved = false;
let resolverPatchAttempted = false;
let startupStorage;
try { startupStorage = window.localStorage; } catch (_) { /* normal startup */ }

const startupSteps = {
  css: false,
  panel: false,
  listeners: false,
  theme: false,
  longPress: false,
};

const diagnosticMark = (event, outcome = 'observed') => browserDiagnostics.record(event, outcome, 'observed');
// Navigation waits for the resolver. The guide refresh has its own dependency
// check for both executor and command constructor and is bounded independently
// of the controls/navigation effects.
const startupNavigation = createStartupNavigation({
  configRead,
  resolveCommand,
  hasResolver: hasCommandResolver,
  mark: (event, outcome) => {
    if (event === 'startup-navigation-dispatched') browserDiagnostics.recordNavigation(outcome);
    else if (event === 'startup-navigation-failed') diagnosticMark(event, 'failed');
    else if (event === 'startup-navigation-cancelled') diagnosticMark(event, outcome);
  },
  warn: () => console.warn('[YTArk] Startup navigation configuration or dispatch failed.'),
});
const startupIntentGuard = installStartupIntentGuard({
  documentObject: typeof document !== 'undefined' ? document : null,
  cancelNavigation: () => startupNavigation.cancelForUserInput(),
});
const startupGuideRefresh = createStartupGuideRefresh({
  getExecutor: getCommandExecutor,
  mark: diagnosticMark,
  warn: () => console.warn('[YTArk] The optional guide refresh failed; startup navigation and controls remain available.'),
});

startReadiness({
  enabled: configRead('fasterStartup') === true,
  storage: startupStorage,
  onInterrupted: () => diagnosticMark('startup-readiness-interrupted', 'interrupted'),
  onMode: mode => browserDiagnostics.recordStartupReadinessMode(mode),
  onReady: () => diagnosticMark('startup-readiness-complete', 'complete'),
  onGiveUp: () => {
    startupIntentGuard.dispose();
    if (!startupNavigation.done) {
      startupNavigation.timeOut();
      diagnosticMark('startup-navigation-failed', 'failed');
      console.warn('[YTArk] Startup navigation was unavailable within the bounded readiness window.');
    }
    if (!startupGuideRefresh.done) startupGuideRefresh.timeOut();
    diagnosticMark('startup-readiness-timeout', 'timeout');
  },
  tick: () => {
    if (!controlsInitialized && document.body) {
      diagnosticMark('dom-body-available');
      try {
        execute_once_dom_loaded();
        controlsInitialized = true;
        diagnosticMark('controls-ready');
      } catch (_) {
        console.warn('[YTArk] TV controls are waiting for the app DOM.');
      }
    }

    if (!resolverObserved && hasCommandResolver()) {
      resolverObserved = true;
      diagnosticMark('resolver-ready');
    }
    if (resolverObserved && !resolverPatchAttempted) {
      // A patch attempt may have partially wrapped a resolver before throwing;
      // never repeat it and risk duplicate handlers/effects.
      resolverPatchAttempted = true;
      try { patchResolveCommand(); }
      catch (_) { console.warn('[YTArk] The TV command resolver could not be patched.'); }
    }

    // Guide refresh needs getCommandExecutor()'s executor AND constructor. A
    // missing dependency stays pending; a late arrival can be used by a later
    // readiness tick. Invocation failure is terminal to avoid duplicate effects.
    startupGuideRefresh.tryDispatch();
    if (controlsInitialized) startupNavigation.tryRun();
    if (startupNavigation.done) startupIntentGuard.dispose();

    return controlsInitialized && resolverObserved && resolverPatchAttempted
      && startupNavigation.done && startupGuideRefresh.done;
  },
});

let keyTimeout = null;

// One notice per session when settings cannot be saved (no toast spam).
configChangeEmitter.addEventListener('configPersistError', () => {
  try {
    showToast('YTArk', tx('ytark.storage.saveFailed', 'Settings could not be saved on this TV. Changes apply until the app restarts.'));
  } catch (_) {
    /* the toast is best effort */
  }
});

/** Save a red-button colour pick and repaint the managed stylesheet. */
function saveCustomColor(key, value) {
  configWrite(key, value);
  updateStyle();
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

  // Appearance: apply the managed appearance once the TV DOM exists.
  //
  // ui/theme.js already applies it at import time, but that can run
  // before <head> exists, and the frontend rebuilds parts of the document as
  // routes load. Re-applying here puts the managed stylesheet in <head> next to
  // YTArk's own CSS and re-asserts the root classes, which is what makes the
  // saved custom colours and the player/watermark switches actually paint.
  // Later route changes are covered by theme.js's own <html class> and <head>
  // observers.
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
  const modalRootSelector = [
    '[aria-modal="true"]', '[role="dialog"]', 'ytlr-overlay-section-renderer',
    'ytlr-overlay-panel-renderer', 'ytlr-overlay-panel', 'ytlr-popup-container',
  ].join(', ');
  const consumeRemoteEvent = (event) => {
    try { event.preventDefault(); } catch (_) { /* synthetic/legacy event */ }
    try { event.stopImmediatePropagation(); } catch (_) { /* not supported */ }
    try { event.stopPropagation(); } catch (_) { /* not supported */ }
  };
  const visibleModalRoot = () => {
    try {
      const roots = document.querySelectorAll(modalRootSelector);
      for (let index = roots.length - 1; index >= 0; index -= 1) {
        const root = roots[index];
        if (root && root.isConnected !== false && root.getAttribute?.('aria-hidden') !== 'true') return root;
      }
    } catch (_) { /* older Cobalt does not expose querySelectorAll consistently */ }
    return null;
  };
  const restoreModalFocus = (root) => {
    if (!root || typeof root.querySelectorAll !== 'function') return false;
    try {
      const candidates = root.querySelectorAll('[tabindex],button,[role="button"],a,input');
      const target = Array.from(candidates).find((element) => {
        if (!element || element.isConnected === false || element.disabled === true) return false;
        const tabindex = element.getAttribute?.('tabindex');
        return tabindex === null || tabindex === undefined || Number(tabindex) >= 0;
      });
      if (target && typeof target.focus === 'function') { target.focus(); return true; }
    } catch (_) { /* focus restoration is best effort */ }
    return false;
  };
  const isTextEntryTarget = (target) => {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select'
      || target.isContentEditable === true
      || target.getAttribute?.('contenteditable') === 'true';
  };
  const settingsInputOwner = createSettingsInputOwner({
    isPanelOpen: hasVisibleYtarkSettingsPanel,
    dismissPanel: () => resolveCommand(ytarkModalBackCommand() || { signalAction: { signal: 'POPUP_BACK' } }),
    findModalRoot: visibleModalRoot,
    restoreModalFocus,
  });

  const handleEvent = (evt) => {
    // Only act on keydown. keypress/keyup used to open duplicate settings on
    // remotes that synthesize a full key event sequence.
    if (evt.type !== 'keydown') return true;
    const code = Number(evt.keyCode || evt.which || 0);
    const ytarkModalOpen = hasVisibleYtarkModal();
    if (settingsInputOwner.handleKeyDown(evt)) return false;
    if (isTextEntryTarget(evt.target || document.activeElement)) return true;
    // A generic YTArk dialog is not a Settings input owner, but its remote
    // colour shortcuts must not open panels behind that dialog.
    if (ytarkModalOpen && (code === 403 || code === 404)) {
      handledRemoteKeys.add(code);
      consumeRemoteEvent(evt);
      return false;
    }
    if (ytarkModalOpen && [13, 32, 37, 38, 39, 40].includes(code)) return true;

    if (!ytarkModalOpen && evt.keyCode in keys && !evt.repeat) {
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
      if (evt.repeat || handledRemoteKeys.has(evt.keyCode)) {
        consumeRemoteEvent(evt);
        return false;
      }
      handledRemoteKeys.add(evt.keyCode);
      consumeRemoteEvent(evt);
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

    if (!ytarkModalOpen && evt.keyCode === 39 && window.isPipPlaying
        && document.querySelector('ytlr-search-text-box > .zylon-focus')) {
      const ytlrPlayer = document.querySelector('ytlr-player');
      if (ytlrPlayer) {
        ytlrPlayer.style.setProperty('background-color', 'rgb(0, 0, 0)');
        pipToFullscreen();
      }
    }
    return true;
  };

  const eventHandler = (evt) => {
    const category = evt && evt.type === 'keydown' ? remoteKeyCategory(evt) : null;
    const sample = browserDiagnostics.beginRemoteHandler(category);
    try { return handleEvent(evt); }
    finally { browserDiagnostics.endRemoteHandler(sample); }
  };

  if (!startupSteps.listeners) {
    document.addEventListener('keydown', eventHandler, true);
    document.addEventListener('keyup', (evt) => {
      const code = Number(evt && (evt.keyCode || evt.which) || 0);
      settingsInputOwner.handleKeyUp(evt);
      if (handledRemoteKeys.has(code)) consumeRemoteEvent(evt);
      handledRemoteKeys.delete(code);
    }, true);
    startupSteps.listeners = true;
  }
  // Startup navigation and optional guide refresh are dispatched by the
  // bounded readiness loop after their distinct dependencies are observable.
}
