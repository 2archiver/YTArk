/**
 * Dispatcher for the YTArk custom actions (settings menus, changelog,
 * What's new and the YouTube Settings editor). resolveCommand.js forwards
 * every unknown custom action here.
 */

import { configRead, resetConfigKeys } from '../config.js';
import { showToast } from './ytUI.js';
import {
  showSettingsMenu, showPanel, showResetConfirm, resetScope,
  showBrowserStartupSummary, showBrowserDiagnosticsReport, showBrowserDiagnosticSessions, showBrowserDiagnosticsClearConfirm,
} from './settings.js';
import {
  setBrowserDiagnosticsEnabled, startBrowserDiagnosticSample, clearBrowserDiagnosticData,
} from '../features/browserDiagnostics.js';
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
    case 'YTARK_DIAGNOSTICS_SET': {
      const result = setBrowserDiagnosticsEnabled(p.enabled === true);
      const message = result.enabled
        ? (result.preferenceSaved
          ? (result.storageState === 'unavailable'
            ? 'Browser diagnostics enabled, but local storage is unavailable so reports may not persist. A full launch capture starts on the next launch.'
            : 'Browser diagnostics enabled. Measurements stay on this device; a full browser launch capture starts on the next launch.')
          : (result.storageState === 'unavailable'
            ? 'Recording started for this session, but the enable choice could not be saved and local storage is unavailable.'
            : 'Recording started for this session, but the enable choice could not be saved for the next launch.'))
        : [
          'Browser diagnostics stopped immediately; the unfinished sample was discarded.',
          ...(result.preferenceSaved ? [] : ['The opt-out could not be saved and may not survive an app restart.']),
          ...(result.storageState === 'unavailable' ? ['The recorder could not confirm removal of the unfinished sample.'] : []),
          'Completed reports remain until cleared.',
        ].join(' ');
      showToast('YTArk Diagnostics', message);
      defer(() => showPanel('about.diagnostics', { update: true }));
      return true;
    }
    case 'YTARK_DIAGNOSTICS_NEW_SAMPLE': {
      const result = startBrowserDiagnosticSample();
      showToast('YTArk Diagnostics', result.preferenceSaved === false
        ? 'A partial sample started, but recording could not be saved as enabled for the next launch.'
        : result.storageState === 'unavailable'
          ? 'A partial sample started in memory, but local storage is unavailable so it may not persist.'
          : 'A new partial browser sample started. Earlier events were not reconstructed.');
      defer(() => showPanel('about.diagnostics', { update: true }));
      return true;
    }
    case 'YTARK_DIAGNOSTICS_STARTUP_SUMMARY':
      showBrowserStartupSummary();
      return true;
    case 'YTARK_DIAGNOSTICS_LATEST':
      showBrowserDiagnosticsReport();
      return true;
    case 'YTARK_DIAGNOSTICS_SESSIONS':
      showBrowserDiagnosticSessions();
      return true;
    case 'YTARK_DIAGNOSTICS_REPORT': {
      const index = Number(p.index);
      showBrowserDiagnosticsReport(Number.isInteger(index) && index >= 0 ? index : null);
      return true;
    }
    case 'YTARK_DIAGNOSTICS_CLEAR_CONFIRM':
      showBrowserDiagnosticsClearConfirm();
      return true;
    case 'YTARK_DIAGNOSTICS_CLEAR': {
      const cleared = clearBrowserDiagnosticData();
      const enabled = configRead('recordBrowserDiagnostics') === true;
      showToast('YTArk Diagnostics', cleared
        ? (enabled
          ? 'Browser diagnostic data cleared. Recording restarted as a new partial sample.'
          : 'Browser diagnostic data cleared. Other settings and app data were not changed.')
        : 'In-memory browser data was cleared, but local storage could not confirm removal of saved reports. Other settings and app data were not changed.');
      defer(() => showPanel('about.diagnostics', { update: true }));
      return true;
    }
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
      showChangelog({ update: !!p.update, focusVersion: p.focusVersion, settingsInputOwner: p.settingsInputOwner === true });
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
      if (p.refresh === 'changelog') showChangelog({ update: true, settingsInputOwner: p.settingsInputOwner === true });
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
