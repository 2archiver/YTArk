// Settings cleanup for YTArk 2.5: the removed controls are gone everywhere
// (tree, search, commands, preferences), every retained behaviour has exactly
// one authoritative control, and About YTArk reports the installed version.
// (ui/settingsRegistry.js, ui/settings.js, ui/settingsSearch.js,
//  features/appVersion.js, config.js)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, messageText, rowTitle, rowSubtitle,
  findRow, press, header, tick,
} from './helpers/ytlr-harness.mjs';

const { recorded, windowStub } = setupEnvironment({ version: '2.3.0' });
await initEnglish();
const { configRead, configWrite, configKeys } = await import('../config.js');
const registry = await import('../ui/settingsRegistry.js');
const search = await import('../ui/settingsSearch.js');
const appVersion = await import('../features/appVersion.js');
const updater = await import('../features/updater.js');
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const resolveCommand = resolve.default;

const RETIRED_KEYS = ['userAgentProfile', 'enableFixedUI', 'tvActivePreset', 'tvLastPresetSnapshot',
  'tvQuickQuality', 'videoPreferredCodec'];
const REMOVED_IDS = ['quickControls', 'quickControls.presets', 'quickControls.undoPreset',
  'quickControls.quality', 'quickControls.userAgent', 'quickControls.resetUserAgent',
  'quickControls.hideShorts', 'quickControls.hidePreviews', 'quickControls.hideEndCards',
  'quickControls.hideRelated', 'quickControls.theme', 'quickControls.premiumLogo',
  'quickControls.guideEntry', 'quickControls.ytSettingsLayout', 'misc.fixUi'];
const REMOVED_ACTIONS = ['TV_APPLY_PRESET', 'TV_UNDO_PRESET', 'TV_SET_QUALITY', 'RESET_USER_AGENT_PROFILE'];

const tree = () => registry.buildSettingsTree();
const index = () => search.buildSearchIndex(tree());
const allIds = query => search.searchSettings(index(), query).map(result => result.entry.id);

/** Every searchable string of every node, lowercased. */
function nodeTexts() {
  const lines = [];
  registry.walkTree(tree(), (node) => {
    lines.push({
      id: node.id,
      text: [node.title, node.description, (node.keywords || []).join(' '),
        node.header && node.header.title, node.header && node.header.subtitle]
        .filter(Boolean).join(' ').toLowerCase(),
    });
  });
  return lines;
}

beforeEach(() => {
  recorded.length = 0;
  search.resetSearchState();
});

describe('removed controls', () => {
  it('are gone from the settings tree', () => {
    for (const id of REMOVED_IDS) {
      assert.equal(registry.findNode(tree(), id), null, `${id} is gone`);
    }
  });

  it('are gone from every title, description and search keyword', () => {
    for (const { id, text } of nodeTexts()) {
      for (const needle of ['preset', 'user-agent', 'user agent', 'fix ui', 'quick controls', 'spoof']) {
        assert.equal(text.includes(needle), false, `${id} still mentions "${needle}": ${text}`);
      }
    }
  });

  it('are gone from settings search, which stays in sync with the registry', () => {
    for (const query of ['preset', 'presets', 'undo preset', 'user agent', 'useragent', 'ua', 'spoof',
      'device profile', 'fix ui', 'fixui', 'animations', 'quick controls', 'quick quality']) {
      assert.deepEqual(allIds(query), [], `"${query}" finds nothing`);
    }
    // Search itself still works and still finds the retained settings.
    assert.ok(allIds('theme').length > 0);
    assert.ok(allIds('quality').includes('player.quality'));
    assert.ok(allIds('shorts').includes('privacy.hideShorts'));
  });

  it('do nothing when an old command reaches the resolver', () => {
    const before = { shorts: configRead('enableShorts'), quality: configRead('preferredVideoQuality') };
    for (const action of REMOVED_ACTIONS) {
      resolveCommand({ customAction: { action, parameters: 'cleanTV' } });
    }
    assert.deepEqual(recorded.filter(cmd => cmd.openPopupAction), [], 'no panel, toast or navigation');
    assert.equal(configRead('enableShorts'), before.shorts, 'no setting was changed');
    assert.equal(configRead('preferredVideoQuality'), before.quality);
    for (const key of RETIRED_KEYS) {
      assert.equal(configKeys().includes(key), false, `${key} is not a setting any more`);
      assert.equal(configRead(key), undefined, `${key} reads as nothing`);
    }
  });

  it('keep the legitimate per-action undo and the per-section resets', () => {
    // SponsorBlock's "Undo last manual skip" is a real per-action undo, not the
    // removed preset undo, and must survive.
    const undoSkip = registry.findNode(tree(), 'sponsorblock.undo');
    assert.ok(undoSkip, 'the SponsorBlock skip undo stays');
    assert.match(undoSkip.title, /Undo last manual skip/);
    // Per-section reset/default actions stay, and never list a retired key.
    for (const menuId of ['playback', 'appearance', 'privacy', 'navigation']) {
      const node = registry.findNode(tree(), menuId);
      assert.ok(Array.isArray(node.resetKeys) && node.resetKeys.length, `${menuId} can still be reset`);
      for (const key of node.resetKeys) {
        assert.equal(RETIRED_KEYS.includes(key), false, `${menuId} resets a retired key`);
        assert.ok(configKeys().includes(key), `${menuId} resets an unknown key ${key}`);
      }
    }
  });
});

describe('one authoritative control per behaviour', () => {
  it('registers every retained setting exactly once', () => {
    const counts = {};
    registry.walkTree(tree(), (node) => {
      if (node.key) counts[node.key] = (counts[node.key] || 0) + 1;
      for (const option of node.options || []) {
        assert.ok(!option.id.startsWith('quickControls'), 'no retired option ids');
      }
    });
    const duplicates = Object.entries(counts).filter(([, count]) => count > 1);
    assert.deepEqual(duplicates, [], `duplicated controls: ${JSON.stringify(duplicates)}`);
  });

  it('keeps the settings the retired quick menu held, in the categories that describe them', () => {
    const expected = {
      'privacy.hideShorts': 'enableShorts',
      'privacy.hidePreviews': 'enablePreviews',
      'appearance.premiumLogo': 'enablePremiumLogo',
      'appearance.player.hideEndCards': 'enableHideEndScreenCards',
      'appearance.theme': 'uiTheme',
      'player.quality': 'preferredVideoQuality',
      'player.hideRelated': 'hideRelatedVideosPlayer',
      'nav.guideEntry': 'enableYtarkGuideEntry',
      'nav.ytSettingsLayout': null,
    };
    for (const [id, key] of Object.entries(expected)) {
      const node = registry.findNode(tree(), id) || registry.findNode(tree(), id.replace('nav.', ''));
      assert.ok(node, `${id} exists`);
      if (key) assert.equal(node.key, key, `${id} owns ${key}`);
    }
  });

  it('writes the same preference from its new home and shows the real state', async () => {
    configWrite('enableShorts', true);
    resolveCommand({ customAction: { action: 'YTARK_MENU_SHOW', parameters: { menuId: 'privacy' } } });
    const privacy = lastModal(recorded, 'ytark-privacy');
    const row = findRow(privacy, 'Hide Shorts');
    assert.ok(row, 'the relocated row is in Privacy');
    assert.match(rowSubtitle(row), /Removes Shorts shelves and tiles from feeds/);
    await press(resolveCommand, row);
    assert.equal(configRead('enableShorts'), false, 'the preference behind the label changed');
    configWrite('enableShorts', true);
  });
});

describe('About YTArk', () => {
  it('reports the installed version and the build details, as separate fields', async () => {
    appVersion.resetVersionForTests();
    appVersion.startVersionResolution({ force: true, delays: [0] });
    await tick(20);
    resolveCommand({ customAction: { action: 'YTARK_PANEL_SHOW', parameters: { id: 'about' } } });
    const panel = lastModal(recorded, 'ytark-panel-about');
    assert.equal(header(panel).title, 'About YTArk');
    assert.equal(header(panel).subtitle, 'YTArk version 2.3');
    const lines = modalItems(panel).map(messageText).filter(Boolean);
    assert.equal(lines[0], 'YTArk version: 2.3', 'the installed package version, not "unknown"');
    assert.ok(lines.some(line => line.startsWith('Build details: versionName 2.6.0')), 'build details are separate');
    assert.ok(!lines.some(line => /Version unknown/i.test(line)), 'never "Version unknown"');
    // The YouTube frontend does not publish a client version in this harness,
    // so the field is omitted instead of guessed.
    assert.ok(!lines.some(line => line.startsWith('YouTube version:')));
    assert.ok(!findRow(panel, 'Read the installed version again'),
      'no re-read row once the platform answered');
  });

  it('shows the YouTube frontend version only when it is really published', async () => {
    windowStub.yt = { config_: { INNERTUBE_CONTEXT: { clientInformation: { clientVersion: 'v2.20250101.01.00' } } } };
    resolveCommand({ customAction: { action: 'YTARK_PANEL_SHOW', parameters: { id: 'about' } } });
    const lines = modalItems(lastModal(recorded, 'ytark-panel-about')).map(messageText).filter(Boolean);
    assert.ok(lines.includes('YouTube version: v2.20250101.01.00'));
    assert.ok(lines[0].startsWith('YTArk version:'), 'and stays separate from the YTArk version');
    delete windowStub.yt;
  });

  it('falls back to labelled build metadata, with a way to read again, when the platform does not answer', async () => {
    const bridge = windowStub.h5vcc;
    windowStub.h5vcc = null;
    appVersion.resetVersionForTests();
    appVersion.startVersionResolution({ force: true, delays: [0] });
    await tick(20);
    resolveCommand({ customAction: { action: 'YTARK_PANEL_SHOW', parameters: { id: 'about' } } });
    const panel = lastModal(recorded, 'ytark-panel-about');
    const lines = modalItems(panel).map(messageText).filter(Boolean);
    assert.equal(lines[0], 'YTArk version: 2.6 (build metadata)');
    assert.ok(lines.some(line => /packaging metadata/.test(line)), 'the source is stated');
    const reread = findRow(panel, 'Read the installed version again');
    assert.ok(reread, 'the user can ask the platform again');
    windowStub.h5vcc = bridge;
    await press(resolveCommand, reread);
    await tick(30);
    const refreshed = lastModal(recorded, 'ytark-panel-about');
    assert.equal(refreshed.openPopupAction.updateAction, true, 'refreshed in place, not stacked');
    assert.equal(refreshed.openPopupAction.shouldMatchUniqueId, true);
    const refreshedLines = modalItems(refreshed).map(messageText).filter(Boolean);
    assert.equal(refreshedLines[0], 'YTArk version: 2.3', 'the platform value wins as soon as it arrives');
    appVersion.resetVersionForTests();
    appVersion.startVersionResolution({ force: true, delays: [0] });
    await tick(20);
  });

  it('keeps the installed version apart from the latest available one', () => {
    assert.equal(updater.installedDisplayText({ version: '2.3.0', display: '2.3' }), '2.3');
    assert.equal(updater.installedDisplayText({ version: 'unknown', display: '' }), '2.3',
      'the resolved package version replaces an unknown one');
    assert.equal(updater.installedDisplayText(null), '2.3');
    // The package-only reader is what the evidence and the comparison use, so
    // build metadata can never fabricate an architecture verdict.
    assert.equal(typeof updater.nativeInstalledVersion(), 'string');
    assert.match(updater.nativeInstalledVersion(), /^\d+\.\d+\.\d+|^unknown$/);
  });
});

describe('YTArk and YouTube settings are told apart', () => {
  it('names the YTArk tree as YTArk\'s own and keeps the YouTube Settings page reachable', () => {
    const root = tree();
    assert.equal(root.title, 'YTArk Settings');
    assert.match(root.description, /YTArk's own/);
    assert.match(root.description, /YouTube TV app/);
    const layout = registry.findNode(tree(), 'ytSettingsLayout');
    assert.ok(layout, 'the YouTube Settings layout editor stays in Navigation');
    assert.equal(layout.title, 'Customize YouTube Settings');
    // Upstream account/privacy rows are not duplicated into the YTArk tree: no
    // YTArk node writes a YouTube-owned client setting.
    for (const { id } of nodeTexts()) {
      const node = registry.findNode(tree(), id);
      if (node && node.key) {
        assert.ok(configKeys().includes(node.key), `${id} writes a YTArk preference`);
      }
    }
  });

  it('groups the retained controls into the documented categories', () => {
    assert.deepEqual(tree().children.map(node => node.id),
      ['search', 'playback', 'appearance', 'privacy', 'navigation', 'updates', 'about', 'support']);
    for (const menuId of ['playback', 'appearance', 'privacy', 'navigation', 'updates']) {
      const node = registry.findNode(tree(), menuId);
      assert.ok(node.title && node.description, `${menuId} has a title and a description`);
      assert.ok((node.children || []).length > 0, `${menuId} is not an empty destination`);
    }
  });
});
