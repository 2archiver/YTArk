// Customization of the native YouTube TV Settings page
// (features/ytSettingsLayout.js, ui/customYTSettings.js, ui/ytSettingsEditor.js).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupEnvironment, initEnglish, lastModal, findRow, press,
} from './helpers/ytlr-harness.mjs';

const { recorded, video } = setupEnvironment();
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

describe('native Android screen routing through the real custom-action path', () => {
  it('opens only the two YTArk-owned screens and blocks storage while playback is active', async () => {
    const { handleYtarkAction } = await import('../ui/ytarkActions.js');
    window.location.href = 'https://www.youtube.com/tv';
    configWrite('uiTheme', 'oled');
    assert.equal(handleYtarkAction('YTARK_NATIVE_UPDATES_OPEN', {}), true);
    assert.equal(window.location.href, 'ytark://updates?theme=oled');

    configWrite('uiTheme', 'youtube');
    video.paused = true;
    video.ended = false;
    video.networkState = 1;
    assert.equal(handleYtarkAction('YTARK_NATIVE_STORAGE_OPEN', {}), true);
    assert.equal(window.location.href, 'ytark://storage?theme=youtube');

    window.location.href = 'https://www.youtube.com/tv';
    video.paused = false;
    assert.equal(handleYtarkAction('YTARK_NATIVE_STORAGE_OPEN', {}), false);
    assert.equal(window.location.href, 'https://www.youtube.com/tv',
      'active playback keeps the storage route closed');
    assert.equal(handleYtarkAction('YTARK_NATIVE_ADMIN_OPEN', {}), false,
      'no arbitrary native component is routed');
  });

  it('explains the launcher route when the base ignores the navigation', async () => {
    // The pinned Cobalt base cancels a ytark:// navigation silently and cannot
    // report that, so the only observable outcome is that the page stays
    // visible. The row must then tell the user the route that does work
    // instead of leaving them on a dead entry.
    const { handleYtarkAction } = await import('../ui/ytarkActions.js');
    const { toasts } = await import('./helpers/ytlr-harness.mjs');
    window.location.href = 'https://www.youtube.com/tv';
    video.paused = true;
    video.ended = false;
    video.networkState = 1;
    const before = toasts(recorded).length;
    assert.equal(handleYtarkAction('YTARK_NATIVE_STORAGE_OPEN', {}), true);
    await new Promise(resolve => setTimeout(resolve, 2400));
    const shown = toasts(recorded).slice(before).map(toast => `${toast.title} ${toast.subtitle}`);
    assert.ok(shown.some(text => /Cache & Storage did not open here/.test(text)),
      `the storage fallback must be explained, got ${JSON.stringify(shown)}`);
    assert.ok(shown.some(text => /TV apps row, then choose Cache & Storage/.test(text)),
      'the fallback names the route that works');

    const latest = toasts(recorded).length;
    assert.equal(handleYtarkAction('YTARK_NATIVE_UPDATES_OPEN', {}), true);
    await new Promise(resolve => setTimeout(resolve, 2400));
    const updates = toasts(recorded).slice(latest).map(toast => `${toast.title} ${toast.subtitle}`);
    assert.ok(updates.some(text => /Open YTArk Updates in the TV apps row\./.test(text)),
      'the updates fallback names the TV apps row');

    // When the platform really takes the navigation over the page is hidden and
    // no "did not open" guidance may appear.
    const count = toasts(recorded).length;
    const previousState = document.visibilityState;
    document.visibilityState = 'hidden';
    assert.equal(handleYtarkAction('YTARK_NATIVE_UPDATES_OPEN', {}), true);
    await new Promise(resolve => setTimeout(resolve, 2400));
    assert.equal(toasts(recorded).length, count, 'a taken-over navigation shows no fallback');
    document.visibilityState = previousState;
  });
});

describe('legacy layout restore through the real command path', () => {
  it('does not dispatch the retired editor actions named in the bundle contract', async () => {
    // release/bundle-contract.json is the single list of retired commands: the
    // release workflows assert those names are absent from the shipped bundle
    // and sources, and this test asserts the real command handler rejects them.
    // Both layers therefore fail if the editor is ever half-reinstated.
    const contract = (await import('../../../release/bundle-contract.json', { with: { type: 'json' } })).default;
    const { retiredActions } = contract;
    assert.ok(retiredActions.length > 0, 'the bundle contract must name the retired commands');
    const { handleYtarkAction } = await import('../ui/ytarkActions.js');
    for (const action of retiredActions) {
      assert.equal(handleYtarkAction(action, {}), false, `${action} must not be dispatchable`);
    }
    assert.equal(retiredActions.includes('YTARK_YTS_RESTORE_CONFIRM'), false,
      'the retained layout restore command must not be retired');
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

});
