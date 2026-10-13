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
  showYtSettingsEditor, showYtSettingsSection, moveYtSettingsSection, toggleYtSettingsSection,
  showYtSettingsRows, showYtSettingsRow, toggleYtSettingsRowPin, toggleYtSettingsRowHidden,
  showRestoreLayoutConfirm, restoreYtSettingsLayout,
} from './ytSettingsEditor.js';
import { tx } from '../translations/text.js';

function openNativeRoute(host) {
  const route = `ytark://${host}`;
  try {
    if (typeof window === 'undefined' || !window.location) throw new Error('The Android route is unavailable.');
    // These are explicit ACTION_VIEW routes declared by repack_apk.py; no
    // invented JavaScript-to-Java bridge is assumed.
    window.location.href = route;
    return true;
  } catch (error) {
    showToast('YTArk', `Could not open native YTArk controls. Open ${route} from the TV launcher or use YTArk Updates.`);
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
    case 'YTARK_YTS_EDITOR':
      showYtSettingsEditor({ update: !!p.update, focusId: p.focusId });
      return true;
    case 'YTARK_YTS_SECTION':
      showYtSettingsSection(p.id);
      return true;
    case 'YTARK_YTS_MOVE':
      moveYtSettingsSection(p.id, p.direction);
      return true;
    case 'YTARK_YTS_TOGGLE_HIDDEN':
      toggleYtSettingsSection(p.id);
      return true;
    case 'YTARK_YTS_ROWS':
      showYtSettingsRows(p.id, { update: !!p.update, focusRow: p.focusRow });
      return true;
    case 'YTARK_YTS_ROW':
      showYtSettingsRow(p.id, p.rowId);
      return true;
    case 'YTARK_YTS_ROW_PIN':
      toggleYtSettingsRowPin(p.id, p.rowId);
      return true;
    case 'YTARK_YTS_ROW_HIDE':
      toggleYtSettingsRowHidden(p.id, p.rowId);
      return true;
    case 'YTARK_YTS_RESTORE_CONFIRM':
      showRestoreLayoutConfirm({ refreshEditor: p.refreshEditor === true });
      return true;
    case 'YTARK_YTS_RESTORE':
      restoreYtSettingsLayout();
      if (p.refreshEditor) defer(() => showYtSettingsEditor({ update: true, focusId: '__restore' }));
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
