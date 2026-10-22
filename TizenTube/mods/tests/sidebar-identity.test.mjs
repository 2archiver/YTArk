import { readFileSync } from 'node:fs';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnvironment, initEnglish, tick, lastModal, modalItems, rowTitle, rowCommands, rowSecondaryIcon } from './helpers/ytlr-harness.mjs';
import { guideEntryIdentity as id } from '../ui/guideIdentity.js';

const env = setupEnvironment();
await initEnglish();
const { configRead, configWrite, migrateConfig, CONFIG_SCHEMA_VERSION } = await import('../config.js');
await import('../ui/customGuideAction.js');
const { default: showSetting } = await import('../ui/sidebarModification.js');
const { default: resolveCommand, patchResolveCommand } = await import('../resolveCommand.js');
patchResolveCommand();

// Guest Shorts uses the sanitized live TVHTML5 capture; route/browse variants
// are synthetic contract fixtures. Physical TV/Kids still need device evidence (docs/YTARK-4.3-REVIEW.md).
const entry = (endpoint, title = '同じ名前') => ({ guideEntryRenderer: {
  navigationEndpoint: endpoint, formattedTitle: { simpleText: title }, icon: { iconType: 'SEARCH' },
} });
const search = () => entry({ searchEndpoint: {} }, 'Search');
const routeShorts = () => entry({ commandMetadata: { webCommandMetadata: { url: '/shorts' } }, reelWatchEndpoint: { videoId: 'unchanged' } }, 'Shorts');
const captured = JSON.parse(readFileSync(new URL('./fixtures/guest-tv-guide-2026-10-22.json', import.meta.url), 'utf8'));
const shorts = () => structuredClone(captured.items[0].guideSectionRenderer.items[2]);
const browse = browseId => entry({ browseEndpoint: { browseId } });
const fixture = () => ({ items: [
  { unrelatedRenderer: {} },
  { guideSectionRenderer: { items: [search(), shorts(), browse('FEwhat_to_watch'), entry({ unknownCommand: {} }), null] } },
  { guideSectionRenderer: { items: [browse('UCone'), browse('UCtwo'), { separatorRenderer: {} }] } },
  { guideSectionRenderer: {} },
] });
const parse = (value = fixture()) => JSON.parse(JSON.stringify(value));
const stock = r => r.items.flatMap(item => item.guideSectionRenderer?.items || []).filter(item => !item?.__ytarkGuideEntry);
const ids = r => stock(r).map(id).filter(Boolean);
beforeEach(() => {
  configWrite('disabledSidebarContents', []);
  configWrite('sidebarContentsOrder', []);
  configWrite('enableYtarkGuideEntry', true);
  env.recorded.length = 0;
});

describe('shared guide identity', () => {
  it('uses endpoint evidence, preserving browse/channel identity and ignoring labels/icons', () => {
    assert.equal(id(search()), 'search');
    assert.equal(id(shorts()), 'FEshorts');
    assert.equal(id(routeShorts()), 'FEshorts');
    assert.equal(id(browse('FEshorts')), 'FEshorts');
    assert.equal(id(browse('UCone')), 'UCone');
    assert.equal(id(browse('UCtwo')), 'UCtwo');
    assert.equal(id(entry({ commandMetadata: { webCommandMetadata: { url: '/results?search_query=x' } } })), 'search');
    for (const endpoint of [{}, { reelWatchEndpoint: {} }, { watchEndpoint: {} }, { searchEndpoint: false },
      { commandMetadata: { webCommandMetadata: { url: 'https://evil.example/shorts' } } }]) assert.equal(id(entry(endpoint)), null);
    assert.equal(id(null), null);
  });
  for (const hidden of [[], ['FEshorts'], ['search'], ['search', 'FEshorts']]) {
    it(`independently hides ${JSON.stringify(hidden)} without dropping unknown rows`, () => {
      configWrite('disabledSidebarContents', hidden);
      const r = parse();
      assert.equal(ids(r).includes('search'), !hidden.includes('search'));
      assert.equal(ids(r).includes('FEshorts'), !hidden.includes('FEshorts'));
      assert.equal(stock(r).length, 8 - hidden.length);
      const endpoint = r.items[1].guideSectionRenderer.originalItems.find(item => id(item) === 'FEshorts').guideEntryRenderer.navigationEndpoint;
      assert.deepEqual(endpoint, shorts().guideEntryRenderer.navigationEndpoint);
      assert.equal(r.items[1].guideSectionRenderer.items.filter(item => item?.__ytarkGuideEntry).length, 1);
    });
  }
  it('restores on repeated hide/unhide and keeps order, endpoints and shortcuts without duplicates', () => {
    configWrite('sidebarContentsOrder', ['FEshorts', 'search', { browseId: 'UCone', title: 'Channel' }, { browseId: 'UCextra', title: 'Extra' }, 'search']);
    configWrite('disabledSidebarContents', ['FEshorts']);
    let r = parse();
    assert.equal(ids(r).filter(x => x === 'UCone').length, 1);
    assert.equal(ids(r).filter(x => x === 'UCextra').length, 1);
    configWrite('disabledSidebarContents', []);
    for (let i = 0; i < 4; i++) r = parse(r);
    assert.deepEqual(ids(r).slice(0, 2), ['FEshorts', 'search']);
    assert.equal(ids(r).filter(x => x === 'UCone').length, 1);
    assert.equal(ids(r).filter(x => x === 'UCextra').length, 1);
    assert.equal(r.items[1].guideSectionRenderer.originalItems.some(item => item?.__ytarkGuideEntry), false);
    assert.deepEqual(configRead('sidebarContentsOrder').slice(0, 2), ['FEshorts', 'search']);
  });
  it('processes the live guest guide independently and preserves footer/account commands', () => {
    configWrite('disabledSidebarContents', ['FEshorts']);
    const r = parse(captured);
    assert.ok(ids(r).includes('search'));
    assert.ok(!ids(r).includes('FEshorts'));
    assert.deepEqual(r.footer, captured.footer);
    assert.deepEqual(r.topbar, captured.topbar);
  });
  it('does not break JSON.parse for null, primitives, malformed guides or non-guide responses', () => {
    for (const value of [null, 1, false, 'text', {}, {items:null}, {items:[null, {guideSectionRenderer:{items:null}}]}]) assert.deepEqual(parse(value), value);
  });
  it('generates separate checkbox writes and reflects a real toggle and reload', async () => {
    env.windowStub._yttv.registry = { mappings: {}, get: () => ({ fetch: () => ({ subscribe: callback => callback(parse()) }) }) };
    showSetting('disabledSidebarContents');
    await tick();
    let rows = modalItems(lastModal(env.recorded, 'tt-sidebar-settings'));
    let row = rows.find(r => rowTitle(r) === 'Shorts');
    const command = rowCommands(row)[0];
    assert.equal(command.setClientSettingEndpoint.settingDatas[0].arrayValue, 'FEshorts');
    resolveCommand(command);
    showSetting('disabledSidebarContents', true);
    await tick();
    rows = modalItems(lastModal(env.recorded, 'tt-sidebar-settings'));
    assert.equal(rowSecondaryIcon(rows.find(r => rowTitle(r) === 'Shorts')), 'CHECK_BOX');
    assert.equal(rowSecondaryIcon(rows.find(r => rowTitle(r) === 'Search')), 'CHECK_BOX_OUTLINE_BLANK');
    assert.ok(ids(parse()).includes('search'));
    assert.ok(!ids(parse()).includes('FEshorts'));
    resolveCommand(command);
    assert.ok(ids(parse()).includes('FEshorts'));
  });
});

describe('schema 11 ambiguous Search migration', () => {
  it('clears only legacy search once and leaves the input, unrelated preferences and order intact', () => {
    const stored = { configSchemaVersion: 10, disabledSidebarContents: ['search', 'FEhistory', 'FEshorts'],
      sidebarContentsOrder: ['search', 'FEshorts', { browseId: 'UCone', title: 'One' }], launchToOnStartup: { browseEndpoint: { browseId: 'FEsubscriptions' } }, enableSponsorBlock: false };
    const snapshot = JSON.stringify(stored);
    const first = migrateConfig(stored).config;
    assert.equal(JSON.stringify(stored), snapshot);
    assert.deepEqual(first.disabledSidebarContents, ['FEhistory', 'FEshorts']);
    assert.deepEqual(first.sidebarContentsOrder, stored.sidebarContentsOrder);
    assert.deepEqual(first.launchToOnStartup, stored.launchToOnStartup);
    assert.equal(first.enableSponsorBlock, false);
    assert.equal(first.configSchemaVersion, CONFIG_SCHEMA_VERSION);
    first.disabledSidebarContents.push('search');
    const second = migrateConfig(first);
    assert.deepEqual(second.config.disabledSidebarContents, ['FEhistory', 'FEshorts', 'search']);
    assert.equal(second.changed, false);
  });
});
