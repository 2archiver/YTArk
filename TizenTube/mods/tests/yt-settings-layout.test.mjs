// Customization of the native YouTube TV Settings page
// (features/ytSettingsLayout.js, ui/customYTSettings.js, ui/ytSettingsEditor.js).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, rowTitle, rowSubtitle, findRow, press, selectedIndex,
  toasts, tick,
} from './helpers/ytlr-harness.mjs';

const { recorded } = setupEnvironment();
await initEnglish();
const { configRead, configWrite } = await import('../config.js');
const layout = await import('../features/ytSettingsLayout.js');
const { PatchSettings } = await import('../ui/customYTSettings.js');
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const resolveCommand = resolve.default;

const runs = text => ({ runs: [{ text }] });
const category = (categoryId, title, items) => ({
  settingCategoryCollectionRenderer: { categoryId, title: runs(title), items, trackingParams: 'x' },
});
const actionRow = (title, itemId, extra = {}) => ({
  settingActionRenderer: { title: runs(title), itemId, serviceEndpoint: { browseEndpoint: { browseId: `FE${itemId}` } }, ...extra },
});
const booleanRow = (title, setting) => ({
  settingBooleanRenderer: {
    title: runs(title),
    enableServiceEndpoint: { setClientSettingEndpoint: { settingDatas: [{ clientSettingEnum: { item: setting }, boolValue: true }] } },
    disableServiceEndpoint: { setClientSettingEndpoint: { settingDatas: [{ clientSettingEnum: { item: setting }, boolValue: false }] } },
    accessibility: { accessibilityData: { label: title } },
  },
});

function settingsResponse({ signedIn = true, extra = [] } = {}) {
  const items = [];
  if (signedIn) {
    items.push(category('SETTING_CAT_ACCOUNT_SWITCHER', 'Account', [
      actionRow('jane.doe@example.com', 'CURRENT_ACCOUNT', { serviceEndpoint: { requestAccountSelectorCommand: {} } }),
      actionRow('Sign out', 'SIGN_OUT'),
    ]));
  }
  items.push(
    category('SETTING_CAT_TVHTML5_GENERAL', 'General', [
      booleanRow('Restricted mode', 'SAFETY_MODE'),
      actionRow('Autoplay next video', 'AUTONAV'),
      booleanRow('Previews', 'ENABLE_PREVIEWS_WITH_SOUND'),
    ]),
    category('SETTING_CAT_TVHTML5_HISTORY', 'Privacy', [actionRow('Device recommendations', 'RECOMMEND')]),
    category('SETTING_CAT_TVHTML5_LINK_PHONE', 'Link with TV code', [actionRow('Link with TV code', 'LINK_TV_CODE')]),
    category('SETTING_CAT_PURCHASES', 'Purchases and memberships', [actionRow('Get YouTube Premium', 'PREMIUM_LANDING_PAGE')]),
    category('SETTING_CAT_TVHTML5_ABOUT', 'About', [actionRow('Terms of service', 'TOS')]),
    ...extra,
  );
  return { responseContext: {}, title: runs('Settings'), items };
}

const ids = response => response.items.map(item => item.settingCategoryCollectionRenderer.categoryId);
const cat = (response, id) => response.items.map(item => item.settingCategoryCollectionRenderer).find(item => item.categoryId === id);

beforeEach(() => {
  configWrite('ytSettingsLayout', layout.defaultLayout());
  configWrite('ytSettingsCatalog', null);
  recorded.length = 0;
});

describe('structural detection and idempotent insertion', () => {
  it('recognises the settings page by its renderer structure only', () => {
    assert.equal(layout.isSettingsResponse(settingsResponse()), true);
    assert.equal(layout.isSettingsResponse({ title: runs('Library') }), false);
    assert.equal(layout.isSettingsResponse({ title: runs('Guide'), items: [{ guideSectionRenderer: {} }] }), false);
    assert.equal(PatchSettings({ title: runs('Not settings'), items: [{ tileRenderer: {} }] }), false);
  });

  it('adds one YTArk section at the top and never a second one on revisits', () => {
    const response = settingsResponse();
    assert.equal(PatchSettings(response), true);
    assert.equal(ids(response)[0], layout.YTARK_CATEGORY_ID);
    assert.equal(PatchSettings(response), false);
    const reparsed = JSON.parse(JSON.stringify(response));
    PatchSettings(reparsed);
    assert.equal(ids(reparsed).filter(id => id === layout.YTARK_CATEGORY_ID).length, 1);
    const ytark = cat(response, layout.YTARK_CATEGORY_ID);
    assert.deepEqual(ytark.items.map(row => row.settingActionRenderer.itemId),
      ['tizentube_open_action', 'ytark_search_action', 'ytark_updates_action'],
      'What\'s new is not duplicated on the YouTube Settings page: it lives in YTArk Updates');
  });

  it('records the sections without any account identity', () => {
    PatchSettings(settingsResponse());
    const catalog = configRead('ytSettingsCatalog');
    assert.deepEqual(catalog.categories.map(entry => entry.id), [
      layout.YTARK_CATEGORY_ID, 'SETTING_CAT_ACCOUNT_SWITCHER', 'SETTING_CAT_TVHTML5_GENERAL', 'SETTING_CAT_TVHTML5_HISTORY',
      'SETTING_CAT_TVHTML5_LINK_PHONE', 'SETTING_CAT_PURCHASES', 'SETTING_CAT_TVHTML5_ABOUT',
    ]);
    const account = catalog.categories.find(entry => entry.id === 'SETTING_CAT_ACCOUNT_SWITCHER');
    assert.equal(account.protected, true);
    assert.deepEqual(account.rows, [], 'rows of protected sections are not stored');
    assert.doesNotMatch(JSON.stringify(catalog), /@|jane/i);
    assert.equal(catalog.categories.find(entry => entry.id === 'SETTING_CAT_TVHTML5_ABOUT').protected, true);
    assert.equal(catalog.categories.find(entry => entry.id === 'SETTING_CAT_TVHTML5_LINK_PHONE').protected, true);
    const general = catalog.categories.find(entry => entry.id === 'SETTING_CAT_TVHTML5_GENERAL');
    assert.deepEqual(general.rows.map(row => row.id), ['setting:SAFETY_MODE', 'item:AUTONAV', 'setting:ENABLE_PREVIEWS_WITH_SOUND']);
  });
});

describe('ordering, hiding and pinning by stable ids', () => {
  it('reorders sections and appends unknown ones visibly', () => {
    configWrite('ytSettingsLayout', { order: ['SETTING_CAT_TVHTML5_HISTORY', 'SETTING_CAT_TVHTML5_GENERAL'], hidden: [], pinned: [], hiddenRows: [] });
    const response = settingsResponse({ extra: [category('SETTING_CAT_BRAND_NEW', 'New section', [actionRow('New', 'NEW_THING')])] });
    PatchSettings(response);
    assert.deepEqual(ids(response).slice(0, 3), [layout.YTARK_CATEGORY_ID, 'SETTING_CAT_TVHTML5_HISTORY', 'SETTING_CAT_TVHTML5_GENERAL']);
    assert.equal(ids(response).at(-1), 'SETTING_CAT_BRAND_NEW');
  });

  it('hides optional sections but never protected ones', () => {
    configWrite('ytSettingsLayout', {
      order: [], pinned: [], hiddenRows: [],
      hidden: ['SETTING_CAT_PURCHASES', 'SETTING_CAT_TVHTML5_ABOUT', 'SETTING_CAT_ACCOUNT_SWITCHER', layout.YTARK_CATEGORY_ID],
    });
    const response = settingsResponse();
    PatchSettings(response);
    assert.equal(ids(response).includes('SETTING_CAT_PURCHASES'), false);
    for (const id of ['SETTING_CAT_TVHTML5_ABOUT', 'SETTING_CAT_ACCOUNT_SWITCHER', layout.YTARK_CATEGORY_ID]) {
      assert.ok(ids(response).includes(id), `${id} is protected`);
    }
  });

  it('pins the genuine row object with its endpoints and accessibility data', () => {
    configWrite('ytSettingsLayout', { order: [], hidden: [], hiddenRows: [], pinned: ['item:AUTONAV', 'setting:SAFETY_MODE'] });
    const response = settingsResponse();
    const general = cat(response, 'SETTING_CAT_TVHTML5_GENERAL');
    const autoplay = general.items[1];
    const restricted = general.items[0];
    PatchSettings(response);
    assert.deepEqual(ids(response).slice(0, 2), [layout.YTARK_CATEGORY_ID, layout.PINNED_CATEGORY_ID]);
    const pinned = cat(response, layout.PINNED_CATEGORY_ID);
    assert.equal(pinned.items[0], autoplay, 'the same object, not a simulated copy');
    assert.equal(pinned.items[1], restricted);
    assert.equal(restricted.settingBooleanRenderer.accessibility.accessibilityData.label, 'Restricted mode');
    assert.deepEqual(cat(response, 'SETTING_CAT_TVHTML5_GENERAL').items.map(row => layout.rowIdOf(row)), ['setting:ENABLE_PREVIEWS_WITH_SOUND']);
  });

  it('hides optional rows, drops sections it emptied and keeps protected rows', () => {
    configWrite('ytSettingsLayout', { order: [], hidden: [], pinned: [], hiddenRows: ['item:PREMIUM_LANDING_PAGE', 'item:SIGN_OUT'] });
    const response = settingsResponse();
    PatchSettings(response);
    assert.equal(ids(response).includes('SETTING_CAT_PURCHASES'), false);
    assert.ok(cat(response, 'SETTING_CAT_ACCOUNT_SWITCHER').items.some(row => layout.rowIdOf(row) === 'item:SIGN_OUT'));
  });

  it('keeps a usable page and a restore route when everything optional is hidden', () => {
    const optional = ['SETTING_CAT_TVHTML5_GENERAL', 'SETTING_CAT_TVHTML5_HISTORY', 'SETTING_CAT_PURCHASES'];
    configWrite('ytSettingsLayout', { order: [], hidden: optional, pinned: [], hiddenRows: [] });
    const response = settingsResponse({ signedIn: false });
    PatchSettings(response);
    assert.deepEqual(ids(response), [layout.YTARK_CATEGORY_ID, 'SETTING_CAT_TVHTML5_LINK_PHONE', 'SETTING_CAT_TVHTML5_ABOUT']);
    const ytark = cat(response, layout.YTARK_CATEGORY_ID);
    assert.ok(ytark.items.some(row => row.settingActionRenderer.itemId === 'ytark_restore_layout_action'));
  });

  it('keeps dormant preferences when a section is missing (guest mode) without errors', () => {
    PatchSettings(settingsResponse({ signedIn: true }));
    configWrite('ytSettingsLayout', { order: ['SETTING_CAT_ACCOUNT_SWITCHER', 'SETTING_CAT_TVHTML5_ABOUT'], hidden: ['SETTING_CAT_PURCHASES'], pinned: [], hiddenRows: [] });
    const guest = settingsResponse({ signedIn: false });
    assert.doesNotThrow(() => PatchSettings(guest));
    const catalog = configRead('ytSettingsCatalog');
    const account = catalog.categories.find(entry => entry.id === 'SETTING_CAT_ACCOUNT_SWITCHER');
    assert.equal(account.present, false, 'remembered while absent');
    assert.deepEqual(configRead('ytSettingsLayout').order, ['SETTING_CAT_ACCOUNT_SWITCHER', 'SETTING_CAT_TVHTML5_ABOUT']);
    assert.equal(ids(guest)[1], 'SETTING_CAT_TVHTML5_ABOUT');
  });
});

describe('editor flow through the real command path', () => {
  it('moves a section with Move down, keeps focus logic and refreshes the list on Done', async () => {
    PatchSettings(settingsResponse());
    resolveCommand({ customAction: { action: 'YTARK_YTS_EDITOR', parameters: {} } });
    let editor = lastModal(recorded, 'ytark-yt-settings-editor');
    const generalRow = findRow(editor, 'General');
    assert.match(rowSubtitle(generalRow), /Shown · Position 3 of 7/);
    await press(resolveCommand, generalRow);
    let section = lastModal(recorded, 'ytark-yt-settings-section');
    await press(resolveCommand, findRow(section, 'Move down'));
    section = lastModal(recorded, 'ytark-yt-settings-section');
    assert.equal(section.openPopupAction.updateAction, true, 'the action panel updates in place');
    assert.equal(selectedIndex(section), 1, 'focus stays on Move down');
    assert.equal(configRead('ytSettingsLayout').order.indexOf('SETTING_CAT_TVHTML5_GENERAL'), 3);
    await press(resolveCommand, findRow(section, 'Done'));
    await tick(10);
    editor = lastModal(recorded, 'ytark-yt-settings-editor');
    const titles = modalItems(editor).map(rowTitle);
    assert.equal(titles.indexOf('General'), 3);
    assert.equal(selectedIndex(editor), 3, 'focus follows the moved section');
  });

  it('refuses to hide a protected section with an explanation', async () => {
    PatchSettings(settingsResponse());
    resolveCommand({ customAction: { action: 'YTARK_YTS_SECTION', parameters: { id: 'SETTING_CAT_TVHTML5_ABOUT' } } });
    const section = lastModal(recorded, 'ytark-yt-settings-section');
    await press(resolveCommand, findRow(section, 'Always shown'));
    assert.deepEqual(configRead('ytSettingsLayout').hidden, []);
    assert.match(toasts(recorded).at(-1).subtitle, /stay visible/);
  });

  it('restores only the layout after a confirmation that names its scope', async () => {
    PatchSettings(settingsResponse());
    configWrite('enableAdBlock', false);
    configWrite('ytSettingsLayout', { order: ['SETTING_CAT_TVHTML5_ABOUT'], hidden: ['SETTING_CAT_PURCHASES'], pinned: ['item:AUTONAV'], hiddenRows: [] });
    const catalogBefore = JSON.stringify(configRead('ytSettingsCatalog'));
    resolveCommand({ customAction: { action: 'YTARK_YTS_RESTORE_CONFIRM', parameters: { refreshEditor: true } } });
    const confirm = lastModal(recorded, 'ytark-yt-settings-restore');
    assert.match(JSON.stringify(confirm), /Google account and app data are not changed/);
    await press(resolveCommand, findRow(confirm, 'Restore default layout'));
    assert.deepEqual(configRead('ytSettingsLayout'), layout.defaultLayout());
    assert.equal(configRead('enableAdBlock'), false, 'unrelated settings stay');
    assert.equal(JSON.stringify(configRead('ytSettingsCatalog')), catalogBefore, 'detected sections stay');
  });

  it('pins and hides entries from the entries list', async () => {
    PatchSettings(settingsResponse());
    resolveCommand({ customAction: { action: 'YTARK_YTS_ROWS', parameters: { id: 'SETTING_CAT_TVHTML5_GENERAL' } } });
    const rows = lastModal(recorded, 'ytark-yt-settings-rows');
    await press(resolveCommand, findRow(rows, 'Autoplay next video'));
    let row = lastModal(recorded, 'ytark-yt-settings-row');
    await press(resolveCommand, findRow(row, 'Pin to the top'));
    assert.deepEqual(configRead('ytSettingsLayout').pinned, ['item:AUTONAV']);
    row = lastModal(recorded, 'ytark-yt-settings-row');
    await press(resolveCommand, findRow(row, 'Hide entry'));
    assert.deepEqual(configRead('ytSettingsLayout').hiddenRows, ['item:AUTONAV']);
    assert.deepEqual(configRead('ytSettingsLayout').pinned, [], 'a hidden entry is not also pinned');
  });
});
