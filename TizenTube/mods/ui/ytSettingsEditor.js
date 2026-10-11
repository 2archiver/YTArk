/**
 * "Customize YouTube Settings" editor (YTArk Settings).
 *
 * Shows the sections detected on the native YouTube Settings page in their
 * current order with their visibility, and offers remote-friendly Move up,
 * Move down and Show/Hide actions, entry pinning/hiding and a scoped
 * "Restore default layout". All changes are stored under `ytSettingsLayout`
 * by stable section/entry ids and apply the next time YouTube Settings loads.
 */

import { configRead, configWrite, resetConfigKeys } from '../config.js';
import { showModal, showToast, buttonItem, overlayPanelItemListRenderer, overlayMessageRenderer } from './ytUI.js';
import {
  editorEntries, moveCategory, setCategoryHidden, setRowPinned, setRowHidden, isCustomized, YTARK_CATEGORY_ID,
} from '../features/ytSettingsLayout.js';
import { tx } from '../translations/text.js';

export const EDITOR_MODAL_ID = 'ytark-yt-settings-editor';
export const SECTION_MODAL_ID = 'ytark-yt-settings-section';
export const ROWS_MODAL_ID = 'ytark-yt-settings-rows';
export const ROW_MODAL_ID = 'ytark-yt-settings-row';

const custom = (action, parameters) => ({ customAction: { action, parameters } });
const POPUP_BACK = { signalAction: { signal: 'POPUP_BACK' } };
const deferred = (action, parameters) => custom('YTARK_DEFERRED', { action, parameters });

function catalog() {
  return configRead('ytSettingsCatalog');
}

function layout() {
  return configRead('ytSettingsLayout');
}

export function editorModel() {
  return editorEntries(catalog(), layout());
}

function entryStatus(entry) {
  const parts = [];
  if (entry.protected) parts.push(tx('ytark.ytSettings.protected', 'Protected · always shown'));
  else if (entry.hidden) parts.push(tx('ytark.ytSettings.hidden', 'Hidden'));
  else parts.push(tx('ytark.ytSettings.shown', 'Shown'));
  parts.push(tx('ytark.ytSettings.position', 'Position {{position}} of {{total}}', { position: entry.position, total: entry.total }));
  if (!entry.present) parts.push(tx('ytark.ytSettings.dormant', 'Not on the page right now (for example signed out or guest)'));
  const pinned = entry.rows.filter(row => row.pinned).length;
  if (pinned) parts.push(tx('ytark.ytSettings.pinnedCount', '{{count}} pinned', { count: pinned }));
  return parts.join(' · ');
}

function entryIcon(entry) {
  if (entry.id === YTARK_CATEGORY_ID) return 'STAR';
  if (entry.protected) return 'INFO';
  return entry.hidden ? 'VISIBILITY_OFF' : 'SETTINGS';
}

export function showYtSettingsEditor({ update = false, focusId } = {}) {
  const entries = editorModel();
  const rows = [];
  const ids = [];
  if (!entries.length) {
    rows.push(overlayMessageRenderer(tx('ytark.ytSettings.empty',
      'Open the YouTube Settings page once (Settings in the YouTube sidebar) so YTArk can detect its sections, then come back here.')));
    ids.push('__empty');
  }
  for (const entry of entries) {
    rows.push(buttonItem(
      { title: entry.title, subtitle: entryStatus(entry) },
      { icon: entryIcon(entry), secondaryIcon: 'CHEVRON_RIGHT' },
      [custom('YTARK_YTS_SECTION', { id: entry.id })],
    ));
    ids.push(entry.id);
  }
  rows.push(buttonItem(
    {
      title: tx('ytark.ytSettings.restore', 'Restore default layout'),
      subtitle: isCustomized(layout())
        ? tx('ytark.ytSettings.restoreSubtitle', 'Undo section order, hidden sections, hidden entries and pins')
        : tx('ytark.ytSettings.restoreUnchanged', 'The layout is already YouTube\'s default'),
    },
    { icon: 'UNDO' },
    [custom('YTARK_YTS_RESTORE_CONFIRM', { refreshEditor: true })],
  ));
  ids.push('__restore');
  const selectedIndex = focusId && ids.includes(focusId) ? ids.indexOf(focusId) : 0;
  return showModal(
    {
      title: tx('ytark.ytSettings.title', 'Customize YouTube Settings'),
      subtitle: tx('ytark.ytSettings.subtitle', 'Changes apply the next time YouTube Settings opens. Protected sections always stay visible.'),
    },
    overlayPanelItemListRenderer(rows, selectedIndex),
    EDITOR_MODAL_ID,
    update,
  );
}

function findEntry(id) {
  return editorModel().find(entry => entry.id === id) || null;
}

const SECTION_ACTIONS = ['up', 'down', 'visibility', 'rows', 'done'];

export function showYtSettingsSection(id, { update = false, focus = 'up' } = {}) {
  const entry = findEntry(id);
  if (!entry) return showYtSettingsEditor({ update: true });
  const rows = [
    buttonItem(
      {
        title: tx('ytark.ytSettings.moveUp', 'Move up'),
        subtitle: entry.position === 1 ? tx('ytark.ytSettings.atTop', 'Already at the top') : undefined,
      },
      { icon: 'UP_ARROW' },
      [custom('YTARK_YTS_MOVE', { id, direction: -1 })],
    ),
    buttonItem(
      {
        title: tx('ytark.ytSettings.moveDown', 'Move down'),
        subtitle: entry.position === entry.total ? tx('ytark.ytSettings.atBottom', 'Already at the bottom') : undefined,
      },
      { icon: 'DOWN_ARROW' },
      [custom('YTARK_YTS_MOVE', { id, direction: 1 })],
    ),
    buttonItem(
      entry.protected
        ? { title: tx('ytark.ytSettings.cannotHide', 'Always shown'), subtitle: tx('ytark.ytSettings.protectedReason', 'Account, sign-in, help and YTArk sections stay visible so you can always get back') }
        : { title: entry.hidden ? tx('ytark.ytSettings.show', 'Show section') : tx('ytark.ytSettings.hide', 'Hide section'), subtitle: tx('ytark.ytSettings.hideNote', 'Hiding only removes it from this page; its settings keep working') },
      { icon: entry.protected ? 'INFO' : (entry.hidden ? 'VISIBILITY_OFF' : 'EYE_OFF'), secondaryIcon: entry.protected ? undefined : (entry.hidden ? 'CHECK_BOX_OUTLINE_BLANK' : 'CHECK_BOX') },
      [custom('YTARK_YTS_TOGGLE_HIDDEN', { id })],
    ),
    buttonItem(
      {
        title: tx('ytark.ytSettings.entries', 'Pin or hide entries'),
        subtitle: entry.protected || !entry.rows.length
          ? tx('ytark.ytSettings.noEntries', 'No customizable entries in this section')
          : tx('ytark.ytSettings.entryCount', '{{count}} entries', { count: entry.rows.length }),
      },
      { icon: 'MENU', secondaryIcon: 'CHEVRON_RIGHT' },
      [custom('YTARK_YTS_ROWS', { id })],
    ),
    buttonItem(
      { title: tx('ytark.ytSettings.done', 'Done') },
      { icon: 'CHECK_CIRCLE_THICK' },
      [POPUP_BACK, deferred('YTARK_YTS_EDITOR', { update: true, focusId: id })],
    ),
  ];
  const selectedIndex = Math.max(0, SECTION_ACTIONS.indexOf(focus));
  return showModal(
    { title: entry.title, subtitle: entryStatus(entry) },
    overlayPanelItemListRenderer(rows, selectedIndex),
    SECTION_MODAL_ID,
    update,
    { onDismiss: [deferred('YTARK_YTS_EDITOR', { update: true, focusId: id })] },
  );
}

export function moveYtSettingsSection(id, direction) {
  const result = moveCategory(catalog(), layout(), id, Number(direction) < 0 ? -1 : 1);
  if (!result.moved) {
    showToast(tx('ytark.ytSettings.title', 'Customize YouTube Settings'),
      Number(direction) < 0 ? tx('ytark.ytSettings.atTop', 'Already at the top') : tx('ytark.ytSettings.atBottom', 'Already at the bottom'));
    return false;
  }
  configWrite('ytSettingsLayout', result.layout);
  showYtSettingsSection(id, { update: true, focus: Number(direction) < 0 ? 'up' : 'down' });
  return true;
}

export function toggleYtSettingsSection(id) {
  const entry = findEntry(id);
  if (!entry) return false;
  const result = setCategoryHidden(catalog(), layout(), id, !entry.hidden);
  if (!result.changed) {
    showToast(tx('ytark.ytSettings.title', 'Customize YouTube Settings'),
      tx('ytark.ytSettings.protectedReason', 'Account, sign-in, help and YTArk sections stay visible so you can always get back'));
    return false;
  }
  configWrite('ytSettingsLayout', result.layout);
  showYtSettingsSection(id, { update: true, focus: 'visibility' });
  return true;
}

function rowStatus(row) {
  const parts = [];
  if (row.protected) parts.push(tx('ytark.ytSettings.rowProtected', 'Protected'));
  if (row.pinned) parts.push(tx('ytark.ytSettings.rowPinned', 'Pinned to the top'));
  if (row.hidden) parts.push(tx('ytark.ytSettings.rowHidden', 'Hidden'));
  if (!row.pinned && !row.hidden) parts.push(tx('ytark.ytSettings.rowShown', 'Shown in place'));
  return parts.join(' · ');
}

export function showYtSettingsRows(id, { update = false, focusRow } = {}) {
  const entry = findEntry(id);
  if (!entry) return showYtSettingsEditor({ update: true });
  const rows = [];
  const ids = [];
  if (entry.protected || !entry.rows.length) {
    rows.push(overlayMessageRenderer(tx('ytark.ytSettings.noEntries', 'No customizable entries in this section')));
    ids.push('__none');
  }
  if (!entry.protected) {
    for (const row of entry.rows) {
      rows.push(buttonItem(
        { title: row.title, subtitle: rowStatus(row) },
        { icon: row.hidden ? 'VISIBILITY_OFF' : 'SETTINGS', secondaryIcon: 'CHEVRON_RIGHT' },
        [custom('YTARK_YTS_ROW', { id, rowId: row.id })],
      ));
      ids.push(row.id);
    }
  }
  const selectedIndex = focusRow && ids.includes(focusRow) ? ids.indexOf(focusRow) : 0;
  return showModal(
    { title: entry.title, subtitle: tx('ytark.ytSettings.entriesSubtitle', 'Pinned entries move to a Pinned section near the top') },
    overlayPanelItemListRenderer(rows, selectedIndex),
    ROWS_MODAL_ID,
    update,
  );
}

function findRow(id, rowId) {
  const entry = findEntry(id);
  return entry ? entry.rows.find(row => row.id === rowId) || null : null;
}

export function showYtSettingsRow(id, rowId, { update = false, focus = 'pin' } = {}) {
  const row = findRow(id, rowId);
  if (!row) return showYtSettingsRows(id, { update: true });
  const rows = [
    buttonItem(
      { title: row.pinned ? tx('ytark.ytSettings.unpin', 'Unpin') : tx('ytark.ytSettings.pin', 'Pin to the top') },
      { icon: 'STAR', secondaryIcon: row.pinned ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK' },
      [custom('YTARK_YTS_ROW_PIN', { id, rowId })],
    ),
    buttonItem(
      row.protected
        ? { title: tx('ytark.ytSettings.cannotHide', 'Always shown'), subtitle: tx('ytark.ytSettings.protectedRowReason', 'Account and sign-in entries stay visible') }
        : { title: row.hidden ? tx('ytark.ytSettings.showEntry', 'Show entry') : tx('ytark.ytSettings.hideEntry', 'Hide entry'), subtitle: tx('ytark.ytSettings.hideNote', 'Hiding only removes it from this page; its settings keep working') },
      { icon: row.protected ? 'INFO' : 'VISIBILITY_OFF', secondaryIcon: row.protected ? undefined : (row.hidden ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK') },
      [custom('YTARK_YTS_ROW_HIDE', { id, rowId })],
    ),
    buttonItem(
      { title: tx('ytark.ytSettings.done', 'Done') },
      { icon: 'CHECK_CIRCLE_THICK' },
      [POPUP_BACK, deferred('YTARK_YTS_ROWS', { id, update: true, focusRow: rowId })],
    ),
  ];
  return showModal(
    { title: row.title, subtitle: rowStatus(row) },
    overlayPanelItemListRenderer(rows, focus === 'hide' ? 1 : 0),
    ROW_MODAL_ID,
    update,
    { onDismiss: [deferred('YTARK_YTS_ROWS', { id, update: true, focusRow: rowId })] },
  );
}

export function toggleYtSettingsRowPin(id, rowId) {
  const row = findRow(id, rowId);
  if (!row) return false;
  configWrite('ytSettingsLayout', setRowPinned(layout(), rowId, !row.pinned));
  showYtSettingsRow(id, rowId, { update: true, focus: 'pin' });
  return true;
}

export function toggleYtSettingsRowHidden(id, rowId) {
  const row = findRow(id, rowId);
  if (!row) return false;
  const result = setRowHidden(layout(), row, !row.hidden);
  if (!result.changed) {
    showToast(tx('ytark.ytSettings.title', 'Customize YouTube Settings'),
      tx('ytark.ytSettings.protectedRowReason', 'Account and sign-in entries stay visible'));
    return false;
  }
  configWrite('ytSettingsLayout', result.layout);
  showYtSettingsRow(id, rowId, { update: true, focus: 'hide' });
  return true;
}

export function showRestoreLayoutConfirm({ refreshEditor = false } = {}) {
  const items = [
    overlayMessageRenderer(tx('ytark.ytSettings.restoreScope',
      'This restores YouTube\'s own order for the YouTube Settings page, shows hidden sections and entries again and removes pins. Your YTArk settings, YouTube settings, Google account and app data are not changed.')),
    buttonItem({ title: tx('ytark.ytSettings.restore', 'Restore default layout') }, { icon: 'UNDO' },
      [POPUP_BACK, custom('YTARK_YTS_RESTORE', { refreshEditor })]),
    buttonItem({ title: tx('ytark.reset.cancel', 'Cancel') }, { icon: 'CLOSE' }, [POPUP_BACK]),
  ];
  return showModal(
    { title: tx('ytark.ytSettings.restoreConfirmTitle', 'Restore the YouTube Settings layout?'), subtitle: tx('ytark.ytSettings.title', 'Customize YouTube Settings') },
    overlayPanelItemListRenderer(items, 2),
    'ytark-yt-settings-restore',
    false,
  );
}

/** Reset only the layout (the detected catalog and every other key stay). */
export function restoreYtSettingsLayout() {
  resetConfigKeys(['ytSettingsLayout']);
  showToast(tx('ytark.ytSettings.title', 'Customize YouTube Settings'),
    tx('ytark.ytSettings.restored', 'Default layout restored. It applies the next time YouTube Settings opens.'));
  return true;
}
