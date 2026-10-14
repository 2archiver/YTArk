/**
 * Dispatcher for the YTArk custom actions (settings menus, changelog,
 * What's new and the YouTube Settings editor). resolveCommand.js forwards
 * every unknown custom action here.
 */

import { resetConfigKeys } from '../config.js';
import { showToast } from './ytUI.js';
import { showSettingsMenu, showPanel, showResetConfirm, resetScope } from './settings.js';
import { buildSettingsTree, findNode } from './settingsRegistry.js';
import { showChangelog, showChangelogVersion, showChangelogNote, showReleaseQr } from './changelogReader.js';
import { dismissWhatsNew } from '../features/whatsNew.js';
import { startVersionResolution } from '../features/appVersion.js';
import {
  showRestoreLayoutConfirm, restoreYtSettingsLayout,
} from './ytSettingsEditor.js';
import { tx } from '../translations/text.js';

/** The pinned host's existing async Mojo/JNI method is patched at its Java boundary.
 * It accepts exactly this screen sentinel, rejects URLs, and never installs anything.
 * No WebView interface or external protocol handling is assumed.
 */
function openNativeRoute(screen) {
  if (screen !== 'updates') return false;
  const host = typeof window !== 'undefined' && window.h5vcc && window.h5vcc.tizentube;
  if (!host || typeof host.InstallAppFromURL !== 'function') {
    showToast('YTArk Updates', 'The native Updates bridge is unavailable. This page requires the YTArk 3.1 APK.');
    return false;
  }
  try {
    const result = host.InstallAppFromURL('ytark://updates');
    Promise.resolve(result).then(ok => {
      if (ok === false) showToast('YTArk Updates', 'Updates could not open. Return to YTArk and try again.');
    }).catch(() => showToast('YTArk Updates', 'Updates could not open. Try again.'));
    return true;
  } catch (_) {
    showToast('YTArk Updates', 'Updates could not open. Try again.');
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
    case 'YTARK_MENU_SHOW':
      showSettingsMenu(p.menuId || 'root', { focusId: p.focusId, update: !!p.update });
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
      else showSettingsMenu('root', { update: true });
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
