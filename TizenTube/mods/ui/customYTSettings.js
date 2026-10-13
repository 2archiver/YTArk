/**
 * YTArk integration with the native YouTube TV Settings page.
 *
 * Adds one YTArk section (YTArk Settings, Search, YTArk Updates
 * and, when the page layout is customized, a restore entry), records the
 * detected sections for legacy saved layouts and applies
 * the saved layout. Patching is idempotent: revisiting the page never adds a
 * second YTArk section. If anything about the page shape is unexpected, the
 * YTArk entry is still added so YTArk Settings stays reachable.
 */

import { SettingActionRenderer, SettingsCategory } from './ytUI.js';
import { t } from 'i18next';
import { configRead, configWrite } from '../config.js';
import {
  applySettingsLayout, extractCatalog, mergeCatalog, catalogEquals, isSettingsResponse, categoryOf,
  YTARK_CATEGORY_ID,
} from '../features/ytSettingsLayout.js';
import { tx } from '../translations/text.js';

const ROW_THUMBNAIL = 'https://www.gstatic.com/ytlr/img/parent_code.png';

function actionRow(title, itemId, action, parameters, summary) {
  return SettingActionRenderer(title, itemId, { customAction: { action, parameters } }, summary, ROW_THUMBNAIL);
}

export function makeYtarkCategory(customized) {
  const rows = [
    actionRow(t('settings.ttSettings.title'), 'tizentube_open_action', 'TT_SETTINGS_SHOW', [], t('settings.ttSettings.summary')),
    actionRow(tx('ytark.stock.search', 'Search YTArk settings'), 'ytark_search_action', 'YTARK_SEARCH_OPEN', {},
      tx('ytark.search.entryDescription', 'Find any YTArk setting by name or keyword')),
    actionRow('YTArk Updates', 'ytark_updates_action', 'YTARK_NATIVE_UPDATES_OPEN', {},
      tx('ytark.stock.updatesSummary', 'Check the official stable YTArk release')),
  ];
  if (customized) {
    rows.push(actionRow(tx('ytark.stock.restore', 'Restore YouTube Settings layout'), 'ytark_restore_layout_action',
      'YTARK_YTS_RESTORE_CONFIRM', {}, tx('ytark.ytSettings.restoreSubtitle', 'Undo section order, hidden sections, hidden entries and pins')));
  }
  return SettingsCategory(YTARK_CATEGORY_ID, rows, 'YTArk');
}

function hasYtarkCategory(items) {
  return items.some(item => {
    const category = categoryOf(item);
    return category && category.categoryId === YTARK_CATEGORY_ID;
  });
}

function recordCatalog(items) {
  const detected = extractCatalog(items, 'YTArk');
  if (!detected.some(entry => entry.id === YTARK_CATEGORY_ID)) {
    detected.unshift({ id: YTARK_CATEGORY_ID, title: 'YTArk', protected: true, rows: [] });
  }
  const previous = configRead('ytSettingsCatalog');
  const merged = mergeCatalog(previous, detected);
  if (!catalogEquals(previous, merged)) configWrite('ytSettingsCatalog', merged);
}

/** Patch a parsed settings response in place. Returns true when patched. */
function PatchSettings(settingsObject) {
  if (!isSettingsResponse(settingsObject)) return false;
  if (hasYtarkCategory(settingsObject.items)) return false;
  try {
    recordCatalog(settingsObject.items);
  } catch (error) {
    console.warn('[YTArk] Could not record the YouTube Settings sections:', error);
  }
  try {
    const result = applySettingsLayout(settingsObject, configRead('ytSettingsLayout'), {
      makeYtarkCategory,
      pinnedTitle: tx('ytark.ytSettings.pinned', 'Pinned'),
    });
    if (result.applied) return true;
  } catch (error) {
    console.warn('[YTArk] The YouTube Settings layout could not be applied; showing the stock layout:', error);
  }
  if (!hasYtarkCategory(settingsObject.items)) settingsObject.items.unshift(makeYtarkCategory(false));
  return true;
}

export {
  PatchSettings
};
