/** Restore legacy layouts without discarding unrelated preferences. */
import { resetConfigKeys } from '../config.js';
import { showModal, showToast, buttonItem, overlayPanelItemListRenderer, overlayMessageRenderer } from './ytUI.js';
import { tx } from '../translations/text.js';
const custom = (action, parameters) => ({ customAction: { action, parameters } });
const POPUP_BACK = { signalAction: { signal: 'POPUP_BACK' } };

export function showRestoreLayoutConfirm() {
  const items = [
    overlayMessageRenderer(tx('ytark.ytSettings.restoreScope',
      'This restores YouTube\'s own order for the YouTube Settings page, shows hidden sections and entries again and removes pins. Your YTArk settings, YouTube settings, Google account and app data are not changed.')),
    buttonItem({ title: tx('ytark.ytSettings.restore', 'Restore default layout') }, { icon: 'UNDO' },
      [POPUP_BACK, custom('YTARK_YTS_RESTORE', {})]),
    buttonItem({ title: tx('ytark.reset.cancel', 'Cancel') }, { icon: 'CLOSE' }, [POPUP_BACK]),
  ];
  return showModal(
    { title: tx('ytark.ytSettings.restoreConfirmTitle', 'Restore the YouTube Settings layout?'), subtitle: 'YouTube Settings layout' },
    overlayPanelItemListRenderer(items, 2),
    'ytark-yt-settings-restore',
    false,
  );
}

/** Reset only the layout (the detected catalog and every other key stay). */
export function restoreYtSettingsLayout() {
  resetConfigKeys(['ytSettingsLayout']);
  showToast('YouTube Settings layout',
    tx('ytark.ytSettings.restored', 'Default layout restored. It applies the next time YouTube Settings opens.'));
  return true;
}
