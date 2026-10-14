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

const NATIVE_SCREEN_ROUTES = new Set(['updates']);

/**
 * How the user reaches each native screen without an in-page route.
 *
 * Verified against the pinned TizenTubeCobalt v2.0.2 source: the base does not
 * override ContentBrowserClient::HandleExternalProtocol, so a navigation to
 * `ytark://...` is cancelled silently by content's default implementation and
 * no Android intent is ever built — the page simply stays visible. The launcher
 * entry (UpdateLauncherActivity) opens Updates, and that screen offers Cache &
 * Storage. See docs/SETTINGS-2.9-RECOVERY-REVIEW.md.
 */
const NATIVE_SCREEN_FALLBACK = {
  updates: 'Open YTArk Updates in the TV apps row.',
};

function nativeFallback(screen) {
  return NATIVE_SCREEN_FALLBACK[screen]
    || `Open YTArk Updates in the TV apps row.`;
}

function openNativeRoute(screen) {
  const route = NATIVE_SCREEN_ROUTES.has(screen) ? `ytark://${screen}` : '';
  if (!route) {
    showToast('YTArk', 'That native screen is not available through YTArk navigation.');
    return false;
  }
  try {
    if (typeof window === 'undefined' || !window.location) throw new Error('The Android route is unavailable.');
    // The single YTArk-owned screen route is emitted. The exported native
    // activity validates the exact scheme/host again; no package, component,
    // file path, or command can be supplied by this userscript action.
    //
    // The assignment is kept because it is harmless and becomes the working
    // route again if the base ever handles the scheme; the platform cannot tell
    // us that it ignored the navigation, so the guidance below is shown when the
    // page is still visible afterwards.
    const documentAtRequest = typeof document !== 'undefined' ? document : null;
    if (documentAtRequest) {
      setTimeout(() => {
        // Only a hidden page proves the platform navigated away and took over.
        // An engine that does not report visibility at all is treated as "still
        // here", which is the observed behaviour of the pinned base.
        if (documentAtRequest.visibilityState !== 'hidden') {
          showToast('YTArk', `Updates did not open here. ${nativeFallback(screen)}`);
        }
      }, 2200);
    }
    window.location.href = route;
    return true;
  } catch (error) {
    showToast('YTArk', `${nativeFallback(screen)}`);
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
