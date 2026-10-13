// The shared settings registry, the YTArk Settings menus generated from it,
// and Search settings (ui/settingsRegistry.js, ui/settings.js,
// ui/settingsSearch.js, ui/textEntryOverlay.js).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { keyEvent } from './helpers/fake-dom.mjs';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, rowTitle, rowSubtitle, rowSecondaryIcon, rowCommands,
  findRow, press, selectedIndex, toasts, messageText, header, tick,
} from './helpers/ytlr-harness.mjs';

const { recorded, windowStub, doc } = setupEnvironment();
await initEnglish();
const { configRead, configWrite, configKeys, configDefault } = await import('../config.js');
const registry = await import('../ui/settingsRegistry.js');
const search = await import('../ui/settingsSearch.js');
const textEntry = await import('../ui/textEntryOverlay.js');
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const resolveCommand = resolve.default;

const index = () => search.buildSearchIndex(registry.buildSettingsTree());
const topIds = (query, count = 3) => search.searchSettings(index(), query).slice(0, count).map(result => result.entry.id);
const allIds = query => search.searchSettings(index(), query).map(result => result.entry.id);

beforeEach(() => {
  recorded.length = 0;
  search.resetSearchState();
  // No text panel leaks into the next test: opening Search now focuses the real
  // field straight away, so a test that does not close it would keep its
  // capture-phase key listener installed.
  const open = textEntry.activeTextEntry();
  if (open) open.close('replaced');
});

describe('shared registry', () => {
  it('has unique stable ids, real titles and only configuration keys that exist', () => {
    const tree = registry.buildSettingsTree();
    const seen = new Set();
    const keys = new Set(configKeys());
    registry.walkTree(tree, (node) => {
      assert.ok(!seen.has(node.id), `duplicate id ${node.id}`);
      seen.add(node.id);
      assert.ok(node.title && !/^settings\.options\./.test(node.title), `${node.id} has a localized title`);
      if (node.key) assert.ok(keys.has(node.key), `${node.id} uses unknown key ${node.key}`);
      for (const key of node.resetKeys || []) assert.ok(keys.has(key), `${node.id} resets unknown key ${key}`);
      for (const option of node.options || []) {
        assert.ok(!seen.has(option.id), `duplicate option id ${option.id}`);
        seen.add(option.id);
      }
    });
    assert.ok(search.buildSearchIndex(tree).length > 80, 'every nested setting is indexed');
  });

  it('keeps every setting the menus exposed before 2.3, plus the new ones', () => {
    const exposed = new Set(registry.registryKeys(registry.buildSettingsTree()));
    for (const key of [
      'enableAdBlock', 'enablePremiumLogo', 'enableShorts', 'enablePreviews', 'enableHideEndScreenCards',
      'hideRelatedVideosPlayer', 'preferredVideoQuality', 'enableSponsorBlock', 'sponsorBlockManualSkips',
      'enableSponsorBlockSponsor', 'enableSponsorBlockIntro', 'enableSponsorBlockOutro', 'enableSponsorBlockInteraction',
      'enableSponsorBlockSelfPromo', 'enableSponsorBlockPreview', 'enableSponsorBlockFiller', 'enableSponsorBlockMusicOfftopic',
      'enableSponsorBlockHighlight', 'enableSponsorBlockToasts', 'enableDeArrow', 'enableDeArrowThumbnails',
      'enableYouThereRenderer', 'enablePaidPromotionOverlay', 'enableWhoIsWatchingMenu', 'permanentlyEnableWhoIsWatchingMenu',
      'enableWhosWatchingMenuOnAppExit', 'enableHqThumbnails', 'enableLongPress', 'enableSigninReminder',
      'reloadHomeOnStartup', 'enableShowUserLanguage', 'enableShowOtherLanguages', 'enablePatchingVideoPlayer',
      'enablePreviousNextButtons', 'enableSuperThanksButton', 'enableAIAskButton', 'enableSpeedControlsButton',
      'enableMPButton', 'enableSwapMPWithPIP', 'speedSettingsIncrement', 'preferredVideoCodec', 'autoFrameRate',
      'autoFrameRatePauseVideoFor', 'enableHideWatchedVideos', 'hideWatchedVideosThreshold', 'hideWatchedVideosPages',
      'enableScreenDimming', 'dimmingTimeout', 'dimmingOpacity', 'launchToOnStartup', 'sortSubscriptionsByAlphabet',
      'disableChannelsOnSidebar', 'enableClock', 'isClock12HourFormat', 'clockShowSeconds', 'clockHideWhenVideoPlaying',
      'disableEnlargingThumbnails', 'enableShrinkingThumbnails', 'uiTheme', 'hidePlayerWatermark', 'removePlayerScrim',
    ]) {
      assert.ok(exposed.has(key), `${key} must stay reachable`);
    }
  });

  it('never indexes private or bookkeeping data', () => {
    const indexed = index();
    const keysInIndex = indexed.map(entry => entry.node.key).filter(Boolean);
    for (const key of ['lastSeenVersion', 'whatsNewVersion', 'whatsNewDismissedVersion', 'ytSettingsCatalog',
      'configSchemaVersion', 'dontCheckUpdateUntil', 'lastAnnouncementCheck',
      // Retired in 2.5 (settings schema 3): removed preferences are neither
      // stored nor reachable through search.
      'userAgentProfile', 'enableFixedUI', 'tvActivePreset', 'tvLastPresetSnapshot', 'tvQuickQuality',
      'videoPreferredCodec']) {
      assert.equal(keysInIndex.includes(key), false, key);
    }
    for (const query of ['token', 'password', 'cookie', 'email']) assert.deepEqual(allIds(query), [], query);
  });
});

describe('matching and ranking', () => {
  it('finds the new settings through their aliases', () => {
    for (const query of ['oled', 'black', 'theme', 'amoled']) assert.equal(topIds(query)[0], 'appearance.theme', query);
    for (const query of ['watermark', 'channel logo', 'corner logo']) assert.equal(topIds(query)[0], 'appearance.player.hideWatermark', query);
    // "branding" fits both the watermark and the Premium wordmark: both are offered.
    assert.ok(topIds('branding', 3).includes('appearance.player.hideWatermark'));
    assert.ok(topIds('branding', 3).includes('appearance.premiumLogo'));
    for (const query of ['scrim', 'darkening', 'player dimming']) assert.equal(topIds(query)[0], 'appearance.player.removeScrim', query);
    // "Overlay" is also in another setting's own label, which ranks first by design.
    assert.ok(topIds('overlay', 3).includes('appearance.player.removeScrim'));
    const dimming = allIds('dimming');
    assert.ok(dimming.includes('appearance.player.removeScrim') && dimming.includes('ui.screenDimming'),
      'both kinds of dimming are found and told apart');
  });

  it('finds existing and nested settings by name and alias', () => {
    assert.ok(topIds('updates').includes('updates'));
    assert.ok(allIds('version').includes('updates'));
    assert.ok(topIds('sponsor').some(id => id.startsWith('sponsorblock')));
    assert.ok(topIds('sponsorblock').includes('sponsorblock'));
    // Quality is registered once: the retired quick menu's duplicate row is gone.
    const quality = allIds('quality');
    assert.ok(quality.includes('player.quality'));
    assert.equal(quality.filter(id => id.endsWith('.quality') && id !== 'player.quality').length, 0,
      'no second quality row');
    assert.ok(topIds('resolution', 4).includes('player.quality'));
    assert.equal(topIds('12 hour')[0], 'ui.clock.twelveHour');
    assert.ok(topIds('highlight').includes('sponsorblock.segments.highlight'));
    assert.ok(topIds('who is watching').includes('misc.whosWatching'));
  });

  it('ranks label matches above description matches', () => {
    const results = allIds('sponsor');
    assert.ok(results.indexOf('sponsorblock') !== -1);
    assert.ok(results.indexOf('sponsorblock') < results.indexOf('privacy.adBlock'),
      'a label match outranks the description "Independent of SponsorBlock and the logo"');
  });

  it('normalizes case, whitespace and accents and requires every word', () => {
    const expected = topIds('oled');
    assert.deepEqual(topIds('  oLeD  '), expected);
    assert.deepEqual(topIds('ÓLÉD'), expected);
    assert.equal(topIds('player   dimming')[0], 'appearance.player.removeScrim');
    assert.deepEqual(allIds('oled zebra'), []);
  });

  it('handles empty, long and unmatched queries', () => {
    assert.deepEqual(search.searchSettings(index(), ''), []);
    assert.deepEqual(search.searchSettings(index(), '   '), []);
    assert.doesNotThrow(() => search.searchSettings(index(), 'theme '.repeat(60)));
    assert.equal(search.setSearchQuery('x'.repeat(300)).length, search.MAX_QUERY_LENGTH);
    assert.deepEqual(allIds('qwertyuiop'), []);
  });
});

describe('search screen', () => {
  it('shows the search field and suggestions for an empty query', () => {
    resolveCommand({ customAction: { action: 'YTARK_SEARCH_OPEN', parameters: {} } });
    const modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    const titles = modalItems(modal).map(rowTitle);
    assert.equal(titles[0], 'Search settings…');
    assert.ok(titles.includes('Try "Theme"'));
    assert.match(header(modal).subtitle, /searches stay on this TV/);
  });

  it('shows value, breadcrumb and description, and a clear no-results state', async () => {
    resolveCommand({ customAction: { action: 'YTARK_SEARCH_SET_QUERY', parameters: { query: 'watermark' } } });
    let modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    const row = findRow(modal, 'Hide channel watermark');
    assert.match(rowSubtitle(row), /^Appearance › Player · Current: (On|Off) · Hide the clickable channel logo over videos\.$/);
    assert.equal(selectedIndex(modal), modalItems(modal).indexOf(row), 'the first result is focused');

    resolveCommand({ customAction: { action: 'YTARK_SEARCH_SET_QUERY', parameters: { query: 'zzzz' } } });
    modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    assert.match(messageText(modalItems(modal).find(item => item.overlayMessageRenderer)), /No settings match "zzzz"/);
    await press(resolveCommand, findRow(modal, 'Clear search'));
    modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    assert.equal(search.searchState().query, '');
    assert.equal(rowTitle(modalItems(modal)[0]), 'Search settings…');
  });

  it('toggles a result through the normal config path and reflects it in search and in the menu', async () => {
    configWrite('hidePlayerWatermark', true);
    resolveCommand({ customAction: { action: 'YTARK_SEARCH_SET_QUERY', parameters: { query: 'watermark' } } });
    let modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    const row = findRow(modal, 'Hide channel watermark');
    assert.ok(rowCommands(row)[0].setClientSettingEndpoint, 'the same setClientSettingEndpoint path as the menus');
    await press(resolveCommand, row);
    assert.equal(configRead('hidePlayerWatermark'), false);
    modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    assert.equal(modal.openPopupAction.updateAction, true);
    assert.match(rowSubtitle(findRow(modal, 'Hide channel watermark')), /Current: Off/);
    assert.equal(search.searchState().query, 'watermark', 'the query is kept');

    resolveCommand({ customAction: { action: 'YTARK_MENU_SHOW', parameters: { menuId: 'appearance.player' } } });
    const menu = lastModal(recorded, 'ytark-appearance-player');
    assert.equal(rowSecondaryIcon(findRow(menu, 'Hide channel watermark')), 'CHECK_BOX_OUTLINE_BLANK');
  });

  it('opens the real choice control, writes through it and returns with query and focus kept', async () => {
    configWrite('uiTheme', 'oled');
    resolveCommand({ customAction: { action: 'YTARK_SEARCH_SET_QUERY', parameters: { query: 'oled' } } });
    let modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    await press(resolveCommand, findRow(modal, 'Theme'));
    const choice = lastModal(recorded, 'ytark-theme');
    assert.ok(choice, 'the same menu the category UI uses');
    await press(resolveCommand, findRow(choice, 'YouTube default'));
    assert.equal(configRead('uiTheme'), 'youtube');
    const updated = lastModal(recorded, 'ytark-theme');
    assert.equal(rowSecondaryIcon(findRow(updated, 'YouTube default')), 'RADIO_BUTTON_CHECKED');
    await press(resolveCommand, findRow(updated, 'Back to search results'));
    await tick(10);
    modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    assert.match(rowSubtitle(findRow(modal, 'Theme')), /Current: YouTube default/);
    assert.equal(modalItems(modal)[selectedIndex(modal)], findRow(modal, 'Theme'), 'focus returns to the result');
    assert.equal(search.searchState().query, 'oled');
    configWrite('uiTheme', 'oled');
  });

  it('notes dependencies and never shows unsupported features as working controls', async () => {
    configWrite('enableSponsorBlock', false);
    const intro = search.searchSettings(index(), 'skip intro').find(result => result.entry.id === 'sponsorblock.segments.intro');
    assert.match(search.describeResult(intro.entry), /Takes effect when "Enable SponsorBlock" is on/);
    configWrite('enableSponsorBlock', true);

    resolveCommand({ customAction: { action: 'YTARK_SEARCH_SET_QUERY', parameters: { query: 'frame rate' } } });
    const modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    const afr = findRow(modal, item => rowCommands(item || { compactLinkRenderer: { serviceEndpoint: { commandExecutorCommand: { commands: [] } } } })
      .some(command => command.customAction && command.customAction.parameters && command.customAction.parameters.id === 'player.afr'));
    assert.ok(afr, 'discoverable');
    assert.match(rowSubtitle(afr), /Not available on this device/);
    assert.equal(rowCommands(afr).some(command => command.setClientSettingEndpoint), false);
    const before = configRead('autoFrameRate');
    await press(resolveCommand, afr);
    assert.equal(configRead('autoFrameRate'), before);
    assert.match(toasts(recorded).at(-1).subtitle, /frame-rate bridge/);
  });

  it('opens a real, focused text field and asks only the platform APIs that exist', () => {
    // The pinned Cobalt base has no keyboard/IME method on its JavaScript
    // bridge: YTArk must not call one and must not pretend it did.
    assert.equal(typeof windowStub.h5vcc.tizentube.ShowKeyboard, 'undefined');
    assert.equal(typeof windowStub.h5vcc.tizentube.showSoftInput, 'undefined');
    const calls = [];
    windowStub.navigator = { virtualKeyboard: { show: () => calls.push('virtualKeyboard') } };
    try {
      resolveCommand({ customAction: { action: 'YTARK_SEARCH_OPEN', parameters: {} } });
      const panel = doc.querySelector('[data-ytark-text-entry="true"]');
      assert.ok(panel, 'opening Search mounts the text panel');
      const input = panel.querySelector('input');
      assert.equal(input.tagName.toLowerCase(), 'input', 'a real editable field, not a look-alike');
      assert.equal(input.getAttribute('type'), 'text');
      assert.equal(doc.activeElement, input, 'the field takes the caret as soon as it mounts');
      assert.deepEqual(calls, ['virtualKeyboard'], 'the standard VirtualKeyboard API is used when the engine has it');
      assert.equal(panel.getAttribute('data-ytark-keyboard'), 'virtualKeyboard');
      assert.equal(panel.querySelectorAll('[data-key]').length > 20, true, 'the remote key grid stays available');
    } finally {
      delete windowStub.navigator;
    }
  });

  it('re-asserts the caret if the frontend moves focus, and never fights the key grid', async () => {
    resolveCommand({ customAction: { action: 'YTARK_SEARCH_OPEN', parameters: {} } });
    const panel = doc.querySelector('[data-ytark-text-entry="true"]');
    const input = panel.querySelector('input');
    assert.equal(panel.getAttribute('data-ytark-keyboard'), 'on-screen', 'feature-detected, never assumed');
    assert.match(panel.querySelector('.ytark-entry__hint').textContent, /on-screen/i,
      'the panel says which keyboard it is using');
    // The frontend's own focus handling moves focus out right after mounting.
    doc.body.focus();
    await tick(120);
    assert.equal(doc.activeElement, input, 'the field takes the caret back while it is still the target');
    // A deliberate move onto the key grid is the user's choice and is not undone.
    windowStub.dispatchEvent(keyEvent('keydown', 40, input));
    await tick(400);
    assert.notEqual(doc.activeElement, input, 'moving down to the keys is respected');
  });

  it('types with the on-screen keyboard and Enter, and Back closes the panel without leaving search', async () => {
    const keydownBefore = (windowStub.listeners.get('keydown') || []).length;
    resolveCommand({ customAction: { action: 'YTARK_SEARCH_OPEN', parameters: {} } });
    resolveCommand({ customAction: { action: 'YTARK_SEARCH_EDIT', parameters: {} } });
    const panel = doc.querySelector('[data-ytark-text-entry="true"]');
    assert.ok(panel, 'the text panel opens');
    const input = panel.querySelector('input');
    assert.equal(doc.activeElement, input, 'the input is focused for the TV keyboard');

    const down = keyEvent('keydown', 40, input);
    windowStub.dispatchEvent(down);
    assert.ok(down.defaultPrevented && down.propagationStopped, 'the frontend does not also move its focus');
    const keyO = panel.querySelector('[data-key="o"]');
    windowStub.dispatchEvent(keyEvent('keydown', 13, doc.activeElement));
    assert.equal(input.value, 'a', 'OK on the first key types it');
    input.value = 'ole';
    keyO.focus();
    windowStub.dispatchEvent(keyEvent('keydown', 13, keyO));
    const typed = keyEvent('keydown', 68, keyO, { key: 'd' });
    windowStub.dispatchEvent(typed);
    assert.equal(input.value, 'oleod');
    input.value = 'oled';
    input.focus();
    windowStub.dispatchEvent(keyEvent('keydown', 13, input));
    assert.ok(doc.querySelector('[data-ytark-text-entry="true"]'), 'OK keeps the real input open');
    assert.equal(doc.querySelectorAll('.ytark-entry__key-row').length, 6, 'visual rows match the DPAD model');
    const done = doc.querySelector('[data-key="done"]');
    done.focus();
    windowStub.dispatchEvent(keyEvent('keydown', 13, done));
    assert.equal(doc.querySelector('[data-ytark-text-entry="true"]'), null, 'Done submits');
    assert.equal(search.searchState().query, 'oled');
    const modal = lastModal(recorded, search.SEARCH_MODAL_ID);
    assert.equal(modal.openPopupAction.updateAction, true);
    assert.ok(findRow(modal, 'Theme'));
    assert.equal((windowStub.listeners.get('keydown') || []).length, keydownBefore, 'key listeners are removed');

    resolveCommand({ customAction: { action: 'YTARK_SEARCH_EDIT', parameters: {} } });
    const back = keyEvent('keydown', 27, doc.querySelector('[data-ytark-text-entry="true"] input'));
    windowStub.dispatchEvent(back);
    assert.ok(back.defaultPrevented && back.propagationStopped, 'Back is consumed by the panel, not the app');
    assert.equal(doc.querySelector('[data-ytark-text-entry="true"]'), null);
    assert.equal(search.searchState().query, 'oled', 'Back keeps what was typed');
  });

  it('searches locally without any network request', () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => { calls += 1; return Promise.reject(new Error('offline')); };
    try {
      search.searchSettings(index(), 'sponsorblock quality theme');
      resolveCommand({ customAction: { action: 'YTARK_SEARCH_SET_QUERY', parameters: { query: 'theme' } } });
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calls, 0);
  });
});

describe('YTArk Settings menus', () => {
  it('puts Search first and shows Hide Shorts/Hide Previews with their real state', () => {
    configWrite('enableShorts', true);
    configWrite('enablePreviews', false);
    resolveCommand({ customAction: { action: 'TT_SETTINGS_SHOW', parameters: [] } });
    const root = lastModal(recorded, 'tt-settings');
    const titles = modalItems(root).map(rowTitle);
    assert.equal(titles[0], 'Search settings');
    for (const title of ['Playback', 'Appearance', 'Privacy', 'Navigation', 'YTArk Updates', 'About YTArk']) {
      assert.ok(titles.includes(title), title);
    }
    assert.ok(!titles.includes('YTArk Quick Controls'), 'the retired quick menu is gone from the root');
    assert.ok(!titles.includes('Changelog'), 'no duplicate root changelog row');
    assert.ok(!titles.includes('Customize YouTube Settings'), 'layout setting moved into Navigation');
    // The content-filtering rows the quick menu held live in Privacy now.
    resolveCommand({ customAction: { action: 'YTARK_MENU_SHOW', parameters: { menuId: 'privacy' } } });
    const privacy = lastModal(recorded, 'ytark-privacy');
    assert.equal(rowSecondaryIcon(findRow(privacy, 'Hide Shorts')), 'CHECK_BOX_OUTLINE_BLANK', 'Shorts are shown, so not hidden');
    assert.equal(rowSecondaryIcon(findRow(privacy, 'Hide video previews')), 'CHECK_BOX', 'previews are off, so hidden');
  });

  it('resets one section after a confirmation that lists the defaults', async () => {
    configWrite('uiTheme', 'youtube');
    configWrite('removePlayerScrim', false);
    configWrite('enableAdBlock', false);
    resolveCommand({ customAction: { action: 'YTARK_MENU_SHOW', parameters: { menuId: 'appearance' } } });
    const menu = lastModal(recorded, 'ytark-appearance');
    await press(resolveCommand, findRow(menu, 'Reset Appearance'));
    const confirm = lastModal(recorded, 'ytark-reset-confirm');
    const scope = messageText(modalItems(confirm)[0]);
    assert.match(scope, /Theme: OLED Black/);
    assert.match(scope, /Hide channel watermark: On/);
    assert.match(scope, /Remove player dimming: On/);
    await press(resolveCommand, findRow(confirm, 'Reset'));
    await tick(10);
    assert.equal(configRead('uiTheme'), configDefault('uiTheme'));
    assert.equal(configRead('removePlayerScrim'), true);
    assert.equal(configRead('enableAdBlock'), false, 'other sections are untouched');
    assert.equal(toasts(recorded).filter(toast => /defaults restored/.test(toast.subtitle)).length, 1);
  });
});
