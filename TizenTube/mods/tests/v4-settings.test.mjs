// YTArk 4.0 settings surface:
//   * the Navigation colours and Content colours controls are
//     gone, and stale stored colour values are ignored (task 2);
//   * the negative "Disable enlarged thumbnails" toggle is replaced
//     by one positive "Enable shrunken thumbnails" layout control
//     that applies a real, reversible shelf effect (task 5);
//   * the Who's-watching status text is one clear checkbox row
//     where checked = on (task 6).
// (config.js, ui/settingsRegistry.js, ui/theme.js,
//  ui/appearanceStyles.js, features/adblock.js.)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, rowTitle,
  rowSecondaryIcon, rowSubtitle, findRow,
} from './helpers/ytlr-harness.mjs';

const { windowStub, localStorage, recorded } = setupEnvironment();
await initEnglish();

// The thumbnail layout effect is applied inside the JSON.parse
// response hook that features/adblock.js installs at import time.
// The stub window needs its own JSON object for that patch to
// target. The harness already supplied a recording resolver in
// window._yttv, which the DeArrow boundary install skips because
// the stub window has no fetch.
windowStub.JSON = { parse: JSON.parse, stringify: JSON.stringify };
await import('../features/adblock.js');

const config = await import('../config.js');
const registry = await import('../ui/settingsRegistry.js');
const settings = await import('../ui/settings.js');
const styles = await import('../ui/appearanceStyles.js');
const resolver = await import('../resolveCommand.js');
resolver.patchResolveCommand();

const tree = () => registry.buildSettingsTree();
const nodeIds = () => {
  const ids = [];
  registry.walkTree(tree(), node => ids.push(node.id));
  return ids;
};

function shelfPayload() {
  return {
    contents: { sectionListRenderer: { contents: [
      { shelfRenderer: {
        tvhtml5Style: { effects: {} },
        content: { horizontalListRenderer: { items: [
          { tileRenderer: {
            contentId: 'dQw4w9WgXcQ',
            onSelectCommand: { watchEndpoint: { videoId: 'dQw4w9WgXcQ' } },
            metadata: { tileMetadataRenderer: { title: { simpleText: 'A title' } } },
            header: { tileHeaderRenderer: { thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }] } } },
          } },
        ] } },
      } },
    ] } },
  };
}

beforeEach(() => {
  config.configWrite('enableShrinkingThumbnails', false);
});

describe('retired colour settings', () => {
  it('have no control anywhere in the settings tree', () => {
    for (const id of ['appearance.colors', 'appearance.colours']) {
      assert.equal(registry.findNode(tree(), id), null, `${id} is gone`);
    }
    assert.equal(nodeIds().some(id => /color|colour/i.test(id)), false,
      'no colour row or panel remains');
    assert.equal(typeof styles.buildCustomColorCss, 'undefined',
      'the dead custom-colour CSS builder is removed');
    assert.equal(typeof styles.colorValue, 'undefined',
      'the dead colour sanitizer is removed');
  });

  it('ignore stale stored colour values: migration drops them and the theme stops reading them', async () => {
    // A 3.9 install stored these; a 4.0 launch must discard them
    // and fall back to the standard YouTube/YTArk chrome styling.
    localStorage['ytaf-configuration'] = JSON.stringify({
      configSchemaVersion: 8,
      focusContainerColor: '#0a1628',
      routeColor: '#0d1f3c',
      hidePlayerWatermark: true,
    });
    const migrated = await import(`../config.js?m=${Math.random()}`);
    assert.equal(migrated.configRead('focusContainerColor'), undefined);
    assert.equal(migrated.configRead('routeColor'), undefined);
    assert.equal(migrated.configRead('hidePlayerWatermark'), true, 'other appearance choices survive');
    assert.equal(Object.hasOwn(JSON.parse(localStorage['ytaf-configuration']), 'focusContainerColor'), false,
      'the stale colour is dropped from persisted storage');
  });
});

describe('shrunken thumbnails layout control', () => {
  it('is one positive row; the negative enlarge toggle is gone', () => {
    const ids = nodeIds();
    assert.equal(ids.includes('ui.enableShrinkingThumbnails'), true, 'the positive control remains');
    assert.equal(ids.includes('ui.disableEnlargingThumbnails'), false, 'the negative toggle is gone');
    const node = registry.findNode(tree(), 'ui.enableShrinkingThumbnails');
    assert.equal(node.key, 'enableShrinkingThumbnails');
    assert.equal(node.statusOnly, undefined, 'a real checkbox row');
    assert.match(String(node.description), /smaller and consistently sized/i);
  });

  it('applies the smaller, consistently sized shelf effect when on', () => {
    config.configWrite('enableShrinkingThumbnails', true);
    const parsed = JSON.parse(JSON.stringify(shelfPayload()));
    const effects = parsed.contents.sectionListRenderer.contents[0].shelfRenderer.tvhtml5Style.effects;
    assert.equal(effects.shrink, true, 'thumbnails are shrunken');
    assert.equal(effects.enlarge, false, 'they do not enlarge on focus');
  });

  it('restores standard YouTube sizing when off', () => {
    config.configWrite('enableShrinkingThumbnails', false);
    const parsed = JSON.parse(JSON.stringify(shelfPayload()));
    const effects = parsed.contents.sectionListRenderer.contents[0].shelfRenderer.tvhtml5Style.effects;
    assert.equal(effects.shrink, undefined, 'no shrink flag');
    assert.equal(effects.enlarge, undefined, 'no enlarge override: standard sizing');
  });

  it('migrates the old toggle\'s effective visual choice once, preserving explicit true and false', async () => {
    const migrateWith = stored => {
      localStorage['ytaf-configuration'] = JSON.stringify(stored);
      // A fresh module instance re-reads storage on import.
      return import(`../config.js?m=${Math.random()}`);
    };

    // Old "disable enlarged thumbnails" on -> the positive control on.
    let c = await migrateWith({ configSchemaVersion: 8, disableEnlargingThumbnails: true });
    assert.equal(c.configRead('enableShrinkingThumbnails'), true, 'an old opt-in carries over');
    assert.equal(c.configRead('disableEnlargingThumbnails'), undefined);

    // Old toggle explicitly off -> the positive control stays off.
    c = await migrateWith({ configSchemaVersion: 8, disableEnlargingThumbnails: false });
    assert.equal(c.configRead('enableShrinkingThumbnails'), false, 'an explicit old off stays off');

    // An explicit new-setting choice is never overridden by the old key.
    c = await migrateWith({ configSchemaVersion: 8, disableEnlargingThumbnails: true, enableShrinkingThumbnails: false });
    assert.equal(c.configRead('enableShrinkingThumbnails'), false, 'an explicit new choice wins');

    // Neither key present -> fresh-install default (standard sizing).
    c = await migrateWith({ configSchemaVersion: 8 });
    assert.equal(c.configRead('enableShrinkingThumbnails'), false);
  });
});

describe("who's watching checkbox row", () => {
  it('is a real checkbox row keyed on the preserved preference', () => {
    const node = registry.findNode(tree(), 'nav.profilePicker');
    assert.equal(node.key, 'showAutomaticProfilePicker', 'the preference key is preserved');
    assert.equal(node.statusOnly, undefined, 'no longer a status-only text row');
    assert.equal(node.type, 'toggle');

    // Unchecked (off) shows an outlined checkbox, not On/Off text.
    config.configWrite('showAutomaticProfilePicker', false);
    settings.showSettingsMenu('navigation');
    let panel = lastModal(recorded, 'ytark-navigation');
    let row = findRow(panel, node.title);
    assert.equal(rowSecondaryIcon(row), 'CHECK_BOX_OUTLINE_BLANK');
    assert.doesNotMatch(rowSubtitle(row), /\bOff\b/, 'the state is the checkbox, not On/Off text');

    // Checked (on) shows a filled checkbox.
    config.configWrite('showAutomaticProfilePicker', true);
    settings.showSettingsMenu('navigation', { update: true });
    panel = lastModal(recorded, 'ytark-navigation');
    row = findRow(panel, node.title);
    assert.equal(rowSecondaryIcon(row), 'CHECK_BOX');
    config.configWrite('showAutomaticProfilePicker', false);
  });
});
