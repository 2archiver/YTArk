// The TV guide entry for YTArk Settings (ui/customGuideAction.js JSON.parse
// patch): placed last in the guide so scrolling cannot end on it by accident,
// still reachable when sidebar items are hidden, idempotent across repeated
// guide loads, and removable with the "YTArk entry in the guide" setting.
// Opening it needs an explicit activation (tests/guide-entry-activation.test.mjs).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnvironment, initEnglish } from './helpers/ytlr-harness.mjs';

setupEnvironment();
await initEnglish();
const { configWrite } = await import('../config.js');
await import('../ui/customGuideAction.js'); // side effect: patches JSON.parse

const guideFixture = () => JSON.stringify({
  items: [{
    guideSectionRenderer: {
      items: [
        { guideEntryRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } }, formattedTitle: { simpleText: 'Home' } } },
        { guideEntryRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'FEsubscriptions' } }, formattedTitle: { simpleText: 'Subscriptions' } } },
        { guideEntryRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'FEhistory' } }, formattedTitle: { simpleText: 'History' } } },
        { guideEntryRenderer: { navigationEndpoint: { searchEndpoint: {} }, formattedTitle: { simpleText: 'Search' } } },
      ],
    },
  }],
});

const parseGuide = () => JSON.parse(guideFixture());
const itemsOf = parsed => parsed.items[0].guideSectionRenderer.items;
const ytarkEntries = parsed => itemsOf(parsed).filter(item => item.__ytarkGuideEntry === true);
const titlesOf = parsed => itemsOf(parsed).map(item => item.guideEntryRenderer.formattedTitle.simpleText);

beforeEach(() => {
  configWrite('enableYtarkGuideEntry', true);
  configWrite('disabledSidebarContents', []);
  configWrite('disableChannelsOnSidebar', false);
  configWrite('sidebarContentsOrder', []);
});

describe('YTArk guide entry', () => {
  it('adds exactly one YTArk Settings entry last, below every YouTube entry', () => {
    const parsed = parseGuide();
    assert.equal(ytarkEntries(parsed).length, 1, 'exactly one entry');
    assert.deepEqual(titlesOf(parsed), ['Home', 'Subscriptions', 'History', 'Search', 'YTArk Settings']);
    const entry = ytarkEntries(parsed)[0].guideEntryRenderer;
    assert.equal(entry.formattedTitle.simpleText, 'YTArk Settings');
    assert.equal(entry.icon?.iconType, 'SETTINGS');
    // Its own action, resolved only after an explicit OK/Enter or click. The
    // frontend resolves this endpoint on focus too, and that is ignored, which
    // is what keeps scrolling past the entry from opening the panel.
    assert.deepEqual(entry.navigationEndpoint,
      { customAction: { action: 'YTARK_GUIDE_SETTINGS_OPEN', parameters: [] } });
  });

  it('stays idempotent when a patched guide is loaded again', () => {
    const first = parseGuide();
    assert.equal(ytarkEntries(first).length, 1);
    // A later load that starts from an already-patched (re-serialised) guide
    // must not accumulate a second entry.
    const second = JSON.stringify(first);
    const reloaded = JSON.parse(second);
    assert.equal(ytarkEntries(reloaded).length, 1, 'still exactly one entry');
    assert.deepEqual(titlesOf(reloaded), ['Home', 'Subscriptions', 'History', 'Search', 'YTArk Settings']);
  });

  it('is removed when the setting is off and never adds entries on top of stock items', () => {
    configWrite('enableYtarkGuideEntry', false);
    const parsed = parseGuide();
    assert.equal(ytarkEntries(parsed).length, 0);
    assert.deepEqual(titlesOf(parsed), ['Home', 'Subscriptions', 'History', 'Search']);
  });

  it('stays reachable when sidebar items are hidden', () => {
    configWrite('disabledSidebarContents', ['FEsubscriptions', 'FEhistory']);
    configWrite('disableChannelsOnSidebar', true);
    const parsed = parseGuide();
    assert.deepEqual(titlesOf(parsed), ['Home', 'Search', 'YTArk Settings']);
    const entry = ytarkEntries(parsed)[0].guideEntryRenderer;
    assert.deepEqual(entry.navigationEndpoint,
      { customAction: { action: 'YTARK_GUIDE_SETTINGS_OPEN', parameters: [] } });
  });

  it('is not part of originalItems, so the move/hide guide-entry UI never lists it', () => {
    const parsed = parseGuide();
    const section = parsed.items[0].guideSectionRenderer;
    assert.ok(Array.isArray(section.originalItems));
    assert.ok(!section.originalItems.some(item => item.__ytarkGuideEntry === true), 'originalItems stays stock-only');
    assert.ok(!section.originalItems.some(item => item.guideEntryRenderer?.formattedTitle?.simpleText === 'YTArk Settings'));
  });

  it('does not touch guides without a guide section', () => {
    assert.doesNotThrow(() => {
      JSON.parse(JSON.stringify({ items: [] }));
      JSON.parse(JSON.stringify({ items: [{ videoRenderer: {} }] }));
      JSON.parse(JSON.stringify({}));
    });
  });
});
