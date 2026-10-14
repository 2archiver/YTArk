/**
 * Dispatcher for the YTArk 2.3 custom actions (settings menus, search,
 * changelog, What's new and the YouTube Settings editor). resolveCommand.js
 * forwards every unknown custom action here.
 */

import { resetConfigKeys } from '../config.js';
import { showToast } from './ytUI.js';
import { showSettingsMenu, showPanel, showResetConfirm, resetScope } from './settings.js';
import { buildSettingsTree, findNode } from './settingsRegistry.js';
import {
  showSettingsSearch, openSearchResult, editSearchQuery, setSearchQuery, resetSearchState,
} from './settingsSearch.js';
import { showChangelog, showChangelogVersion, showChangelogNote, showReleaseQr } from './changelogReader.js';
import { dismissWhatsNew } from '../features/whatsNew.js';
import { startVersionResolution } from '../features/appVersion.js';
import {
  showRestoreLayoutConfirm, restoreYtSettingsLayout,
} from './ytSettingsEditor.js';
import { tx } from '../translations/text.js';
import { currentTheme } from './theme.js';

const NATIVE_SCREEN_ROUTES = new Set(['updates', 'storage']);

function openNativeRoute(screen) {
  const theme = currentTheme();
  const route = NATIVE_SCREEN_ROUTES.has(screen) ? `ytark://${screen}?theme=${theme}` : '';
  if (!route) {
    showToast('YTArk', 'That native screen is not available through YTArk navigation.');
    return false;
  }
  try {
    if (typeof window === 'undefined' || !window.location) throw new Error('The Android route is unavailable.');
    // Only the two YTArk-owned screen routes are emitted. The exported native
    // Activities validate the exact scheme/host again; no package, component,
    // file path, or command can be supplied by this userscript action.
    const documentAtRequest = typeof document !== 'undefined' ? document : null;
    if (documentAtRequest) {
      setTimeout(() => {
        if (documentAtRequest.visibilityState === 'visible') {
          showToast('YTArk', `Android did not open ${screen}. Open YTArk Updates from the TV apps row, or retry from YTArk Settings.`);
        }
      }, 2200);
    }
    window.location.href = route;
    return true;
  } catch (error) {
    showToast('YTArk', `Could not open ${screen}. Open YTArk Updates from the TV apps row, or retry from YTArk Settings.`);
    console.warn('[YTArk] Could not open a native YTArk screen:', error);
    return false;
  }
}

function defer(callback) {
  setTimeout(() => {
    try {
      callback();
    } catch (error) {
      console.warn('[YTArk] Deferred action failed:', error);
    }
  }, 0);
}

export function handleYtarkAction(action, parameters) {
  const p = parameters && typeof parameters === 'object' && !Array.isArray(parameters) ? parameters : {};
  switch (action) {
    case 'YTARK_NATIVE_UPDATES_OPEN':
      return openNativeRoute('updates');
    case 'YTARK_NATIVE_STORAGE_OPEN': {
      const video = typeof document !== 'undefined' && document.querySelector
        ? document.querySelector('video') : null;
      if (video && ((!video.paused && !video.ended) || video.networkState === 2)) {
        showToast('YTArk Cache & Storage', 'Pause playback and wait for streaming to stop before clearing temporary cache.');
        return false;
      }
      return openNativeRoute('storage');
    }
    case 'YTARK_MENU_SHOW':
      showSettingsMenu(p.menuId || 'root', { focusId: p.focusId, update: !!p.update, returnTo: p.returnTo });
      return true;
    case 'YTARK_PANEL_SHOW':
      showPanel(p.id, { update: !!p.update });
      return true;
    case 'YTARK_VERSION_REREAD':
      // Ask the platform for the installed package metadata again and show the
      // About panel in place. This never invents a version: it either gets the
      // installed one or keeps reporting this build's packaging metadata.
      startVersionResolution({ force: true });
      defer(() => showPanel('about', { update: true }));
      return true;
    case 'YTARK_SETTING_UNAVAILABLE': {
      const node = findNode(buildSettingsTree(), p.id);
      showToast(node ? node.title : 'YTArk',
        node && node.unavailable ? node.unavailable : tx('ytark.unavailable.generic', 'Not available on this device.'));
      return true;
    }
    case 'YTARK_RESET_SECTION_CONFIRM':
      showResetConfirm(p.menuId);
      return true;
    case 'YTARK_RESET_SECTION': {
      const scope = resetScope(p.menuId);
      if (!scope) return true;
      resetConfigKeys(scope.keys);
      showToast('YTArk', tx('ytark.reset.done', '{{section}}: defaults restored', { section: scope.node.title }));
      defer(() => showSettingsMenu(p.menuId, { update: true, focusId: `${p.menuId}.__reset` }));
      return true;
    }
    case 'YTARK_SEARCH_OPEN':
      resetSearchState();
      showSettingsSearch({ update: false });
      // Opening Search focuses the real text field straight away and asks the
      // platform for its keyboard, so the first OK lands in a field rather than
      // on a passive row that needs a second press.
      editSearchQuery();
      return true;
    case 'YTARK_SEARCH_SHOW':
      showSettingsSearch({ update: p.update !== false, focusId: p.focusId });
      return true;
    case 'YTARK_SEARCH_EDIT':
      editSearchQuery();
      return true;
    case 'YTARK_SEARCH_CLEAR':
      setSearchQuery('');
      showSettingsSearch({ update: true, focusId: '__field' });
      return true;
    case 'YTARK_SEARCH_SET_QUERY':
      setSearchQuery(p.query);
      showSettingsSearch({ update: true });
      return true;
    case 'YTARK_SEARCH_OPEN_RESULT':
      openSearchResult(p.id);
      return true;
    case 'YTARK_CHANGELOG_SHOW':
      showChangelog({ update: !!p.update, focusVersion: p.focusVersion });
      return true;
    case 'YTARK_CHANGELOG_VERSION':
      showChangelogVersion(p.version);
      return true;
    case 'YTARK_CHANGELOG_NOTE':
      showChangelogNote(p.index);
      return true;
    case 'YTARK_CHANGELOG_QR':
      showReleaseQr(p.version);
      return true;
    case 'YTARK_WHATS_NEW_DISMISS':
      dismissWhatsNew();
      if (p.refresh === 'changelog') showChangelog({ update: true });
      else showSettingsMenu('root', { update: true, focusId: 'search' });
      return true;
    case 'YTARK_YTS_RESTORE_CONFIRM':
      showRestoreLayoutConfirm();
      return true;
    case 'YTARK_YTS_RESTORE':
      restoreYtSettingsLayout();
      return true;
    case 'YTARK_DEFERRED':
      if (typeof p.action === 'string' && p.action.startsWith('YTARK_')) {
        defer(() => handleYtarkAction(p.action, p.parameters));
      }
      return true;
    default:
      return false;
  }
}
