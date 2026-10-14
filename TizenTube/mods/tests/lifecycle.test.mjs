// Repeated navigation and enable/disable cycles must not multiply timers,
// listeners, overlays, styles or settings entries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnvironment, initEnglish, lastModal, modalItems, rowTitle } from './helpers/ytlr-harness.mjs';

const { doc, recorded } = setupEnvironment();
await initEnglish();
const { configWrite, configChangeEmitter } = await import('../config.js');
const clock = await import('../ui/clock.js');
const { PatchSettings } = await import('../ui/customYTSettings.js');
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const resolveCommand = resolve.default;

const runs = text => ({ runs: [{ text }] });
const response = () => ({
  title: runs('Settings'),
  items: [
    { settingCategoryCollectionRenderer: { categoryId: 'SETTING_CAT_TVHTML5_GENERAL', title: runs('General'), items: [
      { settingActionRenderer: { title: runs('Autoplay next video'), itemId: 'AUTONAV' } },
    ] } },
    { settingCategoryCollectionRenderer: { categoryId: 'SETTING_CAT_TVHTML5_ABOUT', title: runs('About'), items: [] } },
  ],
});

describe('lifecycle', () => {
  it('keeps exactly one clock timer while shown and none after turning it off', () => {
    for (let index = 0; index < 20; index += 1) {
      configWrite('enableClock', true);
      configWrite('enableClock', true);
      assert.equal(clock.clockTimerActive(), true);
      assert.equal(doc.querySelectorAll('[id="tizentube-clock"]').length, 1);
      configWrite('enableClock', false);
      assert.equal(clock.clockTimerActive(), false);
      assert.equal(doc.querySelectorAll('[id="tizentube-clock"]').length, 0);
    }
  });

  it('does not add settings entries or rewrite the catalog on every visit', () => {
    let catalogWrites = 0;
    const listener = event => { if (event.detail.key === 'ytSettingsCatalog') catalogWrites += 1; };
    configChangeEmitter.addEventListener('configChange', listener);
    for (let visit = 0; visit < 10; visit += 1) {
      const page = response();
      PatchSettings(page);
      PatchSettings(page);
      const ids = page.items.map(item => item.settingCategoryCollectionRenderer.categoryId);
      assert.equal(ids.filter(id => id === 'tizentube_category').length, 1);
    }
    configChangeEmitter.removeEventListener('configChange', listener);
    assert.equal(catalogWrites, 1, 'an unchanged page is not written again');
  });

  it('re-renders menus in place without growing the configuration listener list', () => {
    const listeners = configChangeEmitter.listenerCount('configChange');
    for (let index = 0; index < 15; index += 1) {
      resolveCommand({ customAction: { action: 'TT_SETTINGS_SHOW', parameters: [] } });
      resolveCommand({ customAction: { action: 'YTARK_MENU_SHOW', parameters: { menuId: 'appearance', update: true } } });
      // A retired search command is a no-op: no panel, no listeners.
      resolveCommand({ customAction: { action: 'YTARK_SEARCH_SET_QUERY', parameters: { query: 'theme' } } });
    }
    assert.equal(configChangeEmitter.listenerCount('configChange'), listeners);
    const root = lastModal(recorded, 'tt-settings');
    assert.ok(root, 'the settings root is open');
    assert.equal(modalItems(root).filter(item => rowTitle(item) === 'Search settings').length, 0,
      'the removed settings search row is gone from the root');
  });
});
