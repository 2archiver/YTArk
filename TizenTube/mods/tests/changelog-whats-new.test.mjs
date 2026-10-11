// Bundled changelog data, the in-app reader and post-update What's new
// (assets/changelog.generated.js, ui/changelogReader.js, features/whatsNew.js).
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, rowTitle, rowSubtitle, findRow, press, selectedIndex,
  messageText, header, tick,
} from './helpers/ytlr-harness.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const { recorded, windowStub } = setupEnvironment({
  storage: { 'ytaf-configuration': JSON.stringify({ enableAdBlock: true }) },
  version: '2.3.0',
});
await initEnglish();
const { configRead, configWrite, LEGACY_VERSION_MARKER } = await import('../config.js');
const { YTARK_CHANGELOG } = await import('../assets/changelog.generated.js');
const reader = await import('../ui/changelogReader.js');
const whatsNew = await import('../features/whatsNew.js');
const { numericVersionKey } = await import('../features/updateState.js');
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const resolveCommand = resolve.default;

const PUBLISHED_TAGS = ['v2.3.0', 'v2.2.0', 'v2.1.2', 'v2.1.1', 'v2.1.0', 'v2.0.4-ytark.17', 'v2.0.4-ytark.16',
  'v2.0.3-ytark.15', 'v2.0.2-personal.14'];

beforeEach(() => {
  recorded.length = 0;
});

describe('bundled changelog data', () => {
  it('is exactly what tools/build_changelog.py derives from CHANGELOG.md', () => {
    const output = execFileSync('python3', ['tools/build_changelog.py', 'json'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    assert.deepEqual(JSON.parse(output), JSON.parse(JSON.stringify(YTARK_CHANGELOG)));
  });

  it('lists every published release newest first and keeps unpublished work separate', () => {
    const entries = YTARK_CHANGELOG.entries;
    const keys = entries.map(entry => numericVersionKey(entry.version));
    const sorted = [...keys].sort((a, b) => {
      for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
      return 0;
    });
    assert.deepEqual(keys, sorted, 'newest first');
    assert.equal(entries[0].version, '2.4.0');
    assert.equal(entries[0].status, 'unreleased');
    assert.equal(entries[0].date, null, 'no invented date for unpublished work');
    const published = entries.filter(entry => entry.status === 'published');
    assert.deepEqual(published.map(entry => entry.tag), PUBLISHED_TAGS);
    for (const entry of published) {
      assert.match(entry.date, /^2026-10-(09|10|11)$/);
      assert.equal(entry.releaseUrl, `https://github.com/2archiver/YTArk/releases/tag/${entry.tag}`);
      assert.ok(entry.publishedAt.startsWith(entry.date));
      assert.ok(entry.sections.length > 0);
    }
    const drafts = YTARK_CHANGELOG.notes.find(note => /draft/i.test(note.title));
    assert.ok(drafts.items.some(item => item.includes('v2.2.0-probeJ') && /never published/.test(item)));
    assert.equal(entries.some(entry => /probe/.test(entry.version)), false, 'drafts are not versions');
    assert.doesNotMatch(JSON.stringify(YTARK_CHANGELOG), /[<>]|personal\s+tube\s+tv/i);
  });
});

describe('in-app reader', () => {
  it('shows the history newest first with the installed version marked and focused', () => {
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: {} } });
    const modal = lastModal(recorded, reader.CHANGELOG_MODAL_ID);
    const titles = modalItems(modal).map(rowTitle);
    const versionRows = titles.filter(title => title.startsWith('YTArk 2.'));
    assert.equal(versionRows[0], 'YTArk 2.4');
    assert.equal(versionRows[1], 'YTArk 2.3  ·  Installed');
    assert.equal(versionRows.at(-1), 'YTArk 2.0.2-personal.14');
    assert.equal(versionRows.length, YTARK_CHANGELOG.entries.length);
    assert.equal(rowTitle(modalItems(modal)[selectedIndex(modal)]), 'YTArk 2.3  ·  Installed');
    assert.match(rowSubtitle(findRow(modal, 'YTArk 2.2')), /Published .*2026 · v2\.2\.0/);
    assert.match(header(modal).subtitle, /installed 2\.3\.0/);
  });

  it('renders a version as plain, scrollable text with its release page', async () => {
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: {} } });
    await press(resolveCommand, findRow(lastModal(recorded, reader.CHANGELOG_MODAL_ID), 'YTArk 2.2'));
    const detail = lastModal(recorded, reader.CHANGELOG_VERSION_MODAL_ID);
    assert.ok(detail.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
      .actionPanel.overlayPanelRenderer.content.scrollPaneRenderer, 'D-pad scrollable pane');
    const text = modalItems(detail).map(messageText).join('\n');
    assert.match(text, /Changed\n• SponsorBlock segment lookups have a real deadline/);
    assert.match(text, /Release page: https:\/\/github\.com\/2archiver\/YTArk\/releases\/tag\/v2\.2\.0/);
    assert.doesNotMatch(text, /\*\*|`|<|>/);
    assert.equal(header(detail).title, 'YTArk 2.2');
  });

  it('never passes markup or control characters through', () => {
    assert.equal(reader.sanitizeText('<script>alert(1)</script>Safe\u0007 text'), 'alert(1)Safe text');
    const hostile = {
      version: '9.9.9', display: '9.9', status: 'published', date: '2026-01-01', tag: 'v9.9.9',
      facts: '<img src=x onerror=alert(1)>', summary: 'ok', releaseUrl: 'javascript:alert(1)',
      sections: [{ heading: 'Added', items: ['<b>bold</b> item', 'x'.repeat(5000)] }],
    };
    const text = reader.versionMessages(hostile, '2.3.0').join('\n');
    assert.doesNotMatch(text, /<|>/);
    assert.ok(text.length < 4000, 'long text is bounded and split');
    assert.equal(reader.releasePageFor(hostile), 'https://github.com/2archiver/YTArk/releases/latest',
      'only official release URLs are offered');
  });

  it('offers the official release page with the TV QR pattern', async () => {
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_QR', parameters: { version: '2.2.0' } } });
    const modal = lastModal(recorded, 'ytark-changelog-qr');
    assert.equal(header(modal).subtitle, 'https://github.com/2archiver/YTArk/releases/tag/v2.2.0');
    assert.ok(modalItems(modal).some(item => item.qrCodeRenderer
      && /^data:image\//.test(item.qrCodeRenderer.qrCodeImage.thumbnails[0].url)));
  });
});

describe('post-update What\'s new', () => {
  it('decides once per installed version and never for fresh installs or downgrades', () => {
    const decide = state => whatsNew.evaluateWhatsNew({ pending: '', dismissed: '', ...state });
    assert.deepEqual(decide({ installed: '2.3.0', lastSeen: '' }).updates, { lastSeenVersion: '2.3.0' });
    assert.equal(decide({ installed: '2.3.0', lastSeen: '' }).show, false, 'fresh install: no card');
    const upgrade = decide({ installed: '2.3.0', lastSeen: LEGACY_VERSION_MARKER });
    assert.equal(upgrade.show, true);
    assert.equal(upgrade.announce, true);
    assert.equal(decide({ installed: '2.3.0', lastSeen: '2.2.0' }).announce, true);
    const relaunch = decide({ installed: '2.3.0', lastSeen: '2.3.0', pending: '2.3.0' });
    assert.equal(relaunch.announce, false, 'no repeat announcement on relaunch');
    assert.equal(relaunch.show, true, 'the card stays until dismissed');
    assert.equal(decide({ installed: '2.3.0', lastSeen: '2.3.0', pending: '2.3.0', dismissed: '2.3.0' }).show, false);
    assert.equal(decide({ installed: '2.2.0', lastSeen: '2.3.0' }).show, false, 'downgrade');
    assert.equal(decide({ installed: 'unknown', lastSeen: LEGACY_VERSION_MARKER }).show, false);
    assert.equal(decide({ installed: '9.0.0', lastSeen: LEGACY_VERSION_MARKER }).show, false, 'no entry, no card');
  });

  it('shows a dismissible card after an upgrade and announces it once, outside playback', async () => {
    assert.equal(configRead('lastSeenVersion'), LEGACY_VERSION_MARKER, 'migrated from 2.2');
    mock.timers.enable({ apis: ['setTimeout'] });
    const announced = [];
    try {
      windowStub.location.hash = '#/watch?v=abc';
      const result = whatsNew.initWhatsNew({ announce: version => announced.push(version) });
      assert.equal(result.show, true);
      assert.equal(whatsNew.initWhatsNew({ announce: version => announced.push(version) }), null, 'once per session');
      mock.timers.tick(9000);
      assert.deepEqual(announced, [], 'never during playback');
      windowStub.location.hash = '#/';
      windowStub.dispatch('hashchange');
      assert.deepEqual(announced, ['2.3.0']);
    } finally {
      mock.timers.reset();
    }
    assert.equal(configRead('whatsNewVersion'), '2.3.0');
    assert.equal(configRead('lastSeenVersion'), '2.3.0');

    resolveCommand({ customAction: { action: 'TT_SETTINGS_SHOW', parameters: [] } });
    let root = lastModal(recorded, 'tt-settings');
    assert.deepEqual(modalItems(root).slice(0, 3).map(rowTitle),
      ['Search settings', 'What\'s new in YTArk 2.3', 'Dismiss What\'s new']);
    await press(resolveCommand, findRow(root, 'What\'s new in YTArk 2.3'));
    assert.equal(header(lastModal(recorded, reader.CHANGELOG_VERSION_MODAL_ID)).title, 'YTArk 2.3');
    await press(resolveCommand, findRow(root, 'Dismiss What\'s new'));
    assert.equal(configRead('whatsNewDismissedVersion'), '2.3.0');
    root = lastModal(recorded, 'tt-settings');
    assert.equal(modalItems(root).map(rowTitle).includes('What\'s new in YTArk 2.3'), false);

    // A later launch of the same version neither announces nor shows the card.
    whatsNew.resetWhatsNewForTests();
    const again = whatsNew.initWhatsNew({ announce: version => announced.push(version) });
    assert.equal(again.show, false);
    assert.deepEqual(announced, ['2.3.0']);
    configWrite('whatsNewDismissedVersion', '');
  });

  it('is reachable from the Updates card without changing its update actions', async () => {
    const { createUpdateController } = await import('../features/updater.js');
    const modals = [];
    const ui = {
      showModal: (head, content, id, update) => modals.push({ head, content, id, update }),
      showToast: () => {},
      buttonItem: (title, icon, commands) => ({ title, icon, commands }),
      overlayPanelItemListRenderer: (items, selected) => ({ items, selected }),
      overlayMessageRenderer: text => ({ text }),
    };
    const controller = createUpdateController({
      ui, bridge: null, installedVersion: () => '2.3.0', architecture: () => 'armeabi-v7a',
      fetchRelease: async () => ({ tag_name: 'v2.2.0', draft: false, prerelease: false, body: 'versionCode 2020000', assets: [] }),
    });
    await controller.open();
    const items = modals.at(-1).content.items;
    assert.ok(items.some(item => item.commands && item.commands[0].customAction
      && item.commands[0].customAction.action === 'YTARK_CHANGELOG_SHOW'));
    controller.dispose();
    await tick();
  });
});
