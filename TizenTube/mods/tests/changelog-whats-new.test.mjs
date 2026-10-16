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

const PUBLISHED_TAGS = [
  'v3.5.0', 'v3.4.0', 'v3.3.0', 'v3.2.0', 'v3.1.0', 'v3.0.0','v2.9.0', 'v2.8.0', 'v2.7.0', 'v2.6.0', 'v2.5.0', 'v2.4.0', 'v2.3.0', 'v2.2.0', 'v2.1.2', 'v2.1.1', 'v2.1.0', 'v2.0.4-ytark.17',
  'v2.0.4-ytark.16', 'v2.0.3-ytark.15', 'v2.0.2-personal.14'];

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
    assert.equal(entries[0].version, '3.5.1');
    assert.equal(entries[0].status, 'unreleased');
    assert.equal(entries[0].date, null, 'no invented date for unpublished work');
    const published = entries.filter(entry => entry.status === 'published');
    assert.deepEqual(published.map(entry => entry.tag), PUBLISHED_TAGS);
    for (const entry of published) {
      assert.match(entry.date, /^2026-10-(09|10|11|13|14|15)$/);
      assert.equal(entry.releaseUrl, `https://github.com/2archiver/YTArk/releases/tag/${entry.tag}`);
      assert.ok(entry.publishedAt.startsWith(entry.date));
      // Simplified history: a published version is one short, user-facing line
      // (the summary the row headline is built from), never a wall of text.
      assert.ok(entry.summary && entry.summary.length <= 90,
        `${entry.version} carries one short summary line`);
      assert.ok(!entry.summary.includes('\n'), 'the default summary remains one line even when full notes exist');
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
    const versionRows = titles.filter(title => /^\d+\.\d/.test(title));
    const find = version => YTARK_CHANGELOG.entries.find(entry => entry.version === version);
    assert.equal(versionRows.length, YTARK_CHANGELOG.entries.length);
    for (let i=0; i<versionRows.length; i++) {
      const entry = YTARK_CHANGELOG.entries[i];
      const expected = reader.headlineFor(entry) + (entry.version === '2.3.0' ? '  ·  Installed' : '');
      assert.equal(versionRows[i], expected);
    }
    assert.equal(versionRows[0], '3.5.1 — Honest install-authorization reporting and a faster startup path');
    assert.equal(rowTitle(modalItems(modal)[selectedIndex(modal)]), versionRows.find(title => title.endsWith('  ·  Installed')));
    assert.match(rowSubtitle(findRow(modal, item => rowTitle(item).startsWith('2.2 — '))), /Published .*2026 · v2\.2\.0/);
    assert.match(header(modal).subtitle, /installed 2\.3\.0/);
  });

  it('leads every version with one short, user-facing summary line', () => {
    const entries = YTARK_CHANGELOG.entries;
    const byVersion = Object.fromEntries(entries.map(entry => [entry.version, entry]));
    assert.equal(reader.headlineFor(byVersion['2.6.0']), '2.6 — Added Full Auto Updating',
      'the 2.6 changelog reads exactly "2.6 — Added Full Auto Updating"');
    for (const entry of entries) {
      assert.ok(entry.summary && entry.summary.length <= 90,
        `${entry.version} carries one short summary line (${String(entry.summary).length} chars)`);
      const headline = reader.headlineFor(entry);
      assert.ok(headline.startsWith(`${entry.display} — `), `${entry.version} headline is "<version> — <summary>"`);
      assert.doesNotMatch(headline, /[\n<>*`]/, `${entry.version} headline stays plain, single-line text`);
    }
  });

  it('shows the one-line summary first and keeps full notes for the current release', async () => {
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: {} } });
    await press(resolveCommand, findRow(lastModal(recorded, reader.CHANGELOG_MODAL_ID),
      item => rowTitle(item).startsWith('2.6 — ')));
    const detail = lastModal(recorded, reader.CHANGELOG_VERSION_MODAL_ID);
    const messages = modalItems(detail).map(messageText).filter(Boolean);
    assert.equal(messages[1], '2.6 — Added Full Auto Updating');
    assert.ok(messages.every(text => text.length <= 1300), 'every message is bounded for the TV reader');
    assert.ok(messages.length <= 4, 'an older version stays short on the TV');

    // The current, unreleased version is the one that carries the detailed
    // sections, because it is also the source of its own release notes.
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: { update: true } } });
    await press(resolveCommand, findRow(lastModal(recorded, reader.CHANGELOG_MODAL_ID),
      item => rowTitle(item).startsWith('3.5.1 — ')));
    const current = modalItems(lastModal(recorded, reader.CHANGELOG_VERSION_MODAL_ID))
      .map(messageText).join('\n');
    // The reader paginates long sections ("Added (continued)"), so assert the
    // content is present rather than which page a bullet happens to land on.
    assert.match(current, /Changed\b/);
    assert.match(current, /Android cannot keep the install authorization/);
    assert.match(current, /still need device testing/);
    assert.match(current, /Known limitations/);
  });

  it('renders a version as plain, scrollable text with its release page', async () => {
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: {} } });
    await press(resolveCommand, findRow(lastModal(recorded, reader.CHANGELOG_MODAL_ID),
      item => rowTitle(item).startsWith('2.2 — ')));
    const detail = lastModal(recorded, reader.CHANGELOG_VERSION_MODAL_ID);
    assert.ok(detail.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
      .actionPanel.overlayPanelRenderer.content.scrollPaneRenderer, 'D-pad scrollable pane');
    const text = modalItems(detail).map(messageText).join('\n');
    assert.match(text, /2\.2 — Maintenance and UX release on the same TizenTubeCobalt v2\.0\.2 ARMv7 base/);
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
    const root = lastModal(recorded, 'tt-settings');
    const rootTitles = modalItems(root).map(rowTitle);
    assert.equal(rootTitles[0], 'Playback', 'the removed search row is gone from the root');
    assert.equal(rootTitles.some(title => /What's new in YTArk/.test(title)), false,
      'no duplicate What\'s new row at the top of YTArk Settings');
    // The card (and its dismiss action) is inside YTArk Updates → changelog.
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: {} } });
    let changelog = lastModal(recorded, reader.CHANGELOG_MODAL_ID);
    const dismiss = findRow(changelog, item => /^Dismiss What's new/.test(rowTitle(item)));
    assert.ok(dismiss, 'the post-update card is offered inside the changelog');
    await press(resolveCommand, dismiss);
    assert.equal(configRead('whatsNewDismissedVersion'), '2.3.0');
    resolveCommand({ customAction: { action: 'YTARK_CHANGELOG_SHOW', parameters: { update: true } } });
    changelog = lastModal(recorded, reader.CHANGELOG_MODAL_ID);
    assert.equal(findRow(changelog, item => /^Dismiss What's new/.test(rowTitle(item))), null,
      'and disappears once dismissed');

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
