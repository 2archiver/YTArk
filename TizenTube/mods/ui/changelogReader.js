/**
 * In-app Changelog / What's new reader.
 *
 * Reads the bundled history generated from CHANGELOG.md (works offline), shows
 * it newest first with an installed-version indicator, and renders each
 * version as plain text in a D-pad scrollable pane. No remote HTML is ever
 * loaded or executed: every string is reduced to plain text before display.
 * Official release pages are offered with the existing TV QR pattern.
 */

import { YTARK_CHANGELOG } from '../assets/changelog.generated.js';
import {
  showModal, buttonItem, overlayPanelItemListRenderer, overlayMessageRenderer,
  scrollPaneRenderer, QrCodeRenderer,
} from './ytUI.js';
import { qrCodeDataUrl } from '../features/releaseQr.js';
import { installedVersion, normalizeVersion, whatsNewState } from '../features/whatsNew.js';
import { tx } from '../translations/text.js';

const MAX_ITEM_LENGTH = 1200;
const MAX_MESSAGE_LENGTH = 900;
const RELEASES_LATEST = 'https://github.com/2archiver/YTArk/releases/latest';

export const CHANGELOG_MODAL_ID = 'ytark-changelog';
export const CHANGELOG_VERSION_MODAL_ID = 'ytark-changelog-version';
let changelogSettingsInputOwner = false;

/** Plain, bounded text: no control characters, no markup, no angle brackets. */
export function sanitizeText(value, limit = MAX_ITEM_LENGTH) {
  const text = String(value === undefined || value === null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function changelogEntries(changelog = YTARK_CHANGELOG) {
  const entries = changelog && Array.isArray(changelog.entries) ? changelog.entries : [];
  return entries.filter(entry => entry && typeof entry.version === 'string' && Array.isArray(entry.sections));
}

export function changelogNotes(changelog = YTARK_CHANGELOG) {
  const notes = changelog && Array.isArray(changelog.notes) ? changelog.notes : [];
  return notes.filter(note => note && typeof note.title === 'string' && Array.isArray(note.items));
}

export function formatDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return '';
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number);
  try {
    const date = new Date(Date.UTC(year, month - 1, day));
    const formatted = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    if (formatted && formatted !== 'Invalid Date') return formatted;
  } catch (_) {
    /* fall back to the ISO date */
  }
  return String(iso).slice(0, 10);
}

export function isInstalledEntry(entry, installed = installedVersion()) {
  return !!installed && normalizeVersion(entry && entry.version) === normalizeVersion(installed);
}

/** Short status for a version row: installed, published date or unpublished. */
export function entryStatus(entry, installed = installedVersion()) {
  const parts = [];
  if (isInstalledEntry(entry, installed)) parts.push(tx('ytark.changelog.installed', 'Installed'));
  if (entry.status === 'published') {
    parts.push(tx('ytark.changelog.published', 'Published {{date}}', { date: formatDate(entry.date) }));
  } else if (isInstalledEntry(entry, installed)) {
    parts.push(tx('ytark.changelog.thisBuild', 'this build'));
  } else {
    parts.push(tx('ytark.changelog.unreleased', 'Not yet published'));
  }
  return parts.join(' · ');
}

function chunkLines(heading, items) {
  const messages = [];
  let current = heading;
  for (const raw of items) {
    const item = sanitizeText(raw);
    if (!item) continue;
    const line = item.startsWith('– ') ? `   ${item}` : `• ${item}`;
    if (current.length + line.length + 1 > MAX_MESSAGE_LENGTH && current !== heading) {
      messages.push(current);
      current = `${heading} ${tx('ytark.changelog.continued', '(continued)')}`;
    }
    current += `\n${line}`;
  }
  if (current !== heading) messages.push(current);
  return messages;
}

/** Plain-text messages for one version, in reading order. */
export function versionMessages(entry, installed = installedVersion()) {
  const messages = [];
  const facts = sanitizeText(entry.facts || '');
  const status = entryStatus(entry, installed);
  messages.push([status, facts].filter(Boolean).join('\n'));
  if (entry.summary) messages.push(headlineFor(entry));
  for (const section of entry.sections) {
    const heading = sanitizeText(section.heading, 80);
    messages.push(...chunkLines(heading, section.items || []));
  }
  if (entry.releaseUrl) {
    messages.push(tx('ytark.changelog.releasePage', 'Release page: {{url}}', { url: sanitizeText(entry.releaseUrl, 200) }));
  }
  return messages.filter(Boolean);
}

export function releasePageFor(entry) {
  return entry && entry.status === 'published' && typeof entry.releaseUrl === 'string'
    && entry.releaseUrl.startsWith('https://github.com/2archiver/YTArk/releases/tag/')
    ? entry.releaseUrl : RELEASES_LATEST;
}

function findEntry(version) {
  const wanted = normalizeVersion(version);
  return changelogEntries().find(entry => entry.version === wanted) || null;
}

/**
 * The one-line, user-facing headline of a version: the bounded summary from
 * CHANGELOG.md, shown as "<display> — <summary>" (for example
 * "2.6 — Added Full Auto Updating"). Exactly one line, so the TV reader never
 * has to scroll sideways or overlap text.
 */
export function headlineFor(entry) {
  // One line, no trailing period: "2.6 — Added Full Auto Updating".
  const summary = sanitizeText(entry && entry.summary ? entry.summary : '', 220)
    .split('\n')[0].replace(/[.\s]+$/, '');
  return summary ? `${entry.display} — ${summary}` : `YTArk ${entry.display}`;
}

/** Version picker: newest first, installed version marked and focused. */
export function showChangelog({ update = false, focusVersion = '', settingsInputOwner = false } = {}) {
  changelogSettingsInputOwner = settingsInputOwner === true;
  const installed = installedVersion();
  const entries = changelogEntries();
  const rows = [];
  let selectedIndex = 0;
  const state = whatsNewState(installed);
  if (state.show) {
    rows.push(buttonItem(
      {
        title: tx('ytark.whatsNew.dismiss', 'Dismiss What\'s new for {{version}}', { version: state.entry.display }),
        subtitle: tx('ytark.whatsNew.dismissSubtitle', 'Hides the What\'s new card in YTArk Settings for this version'),
      },
      { icon: 'CLOSE' },
      [{ customAction: { action: 'YTARK_WHATS_NEW_DISMISS', parameters: { refresh: 'changelog', settingsInputOwner: changelogSettingsInputOwner } } }],
    ));
  }
  entries.forEach((entry, index) => {
    const installedRow = isInstalledEntry(entry, installed);
    // One short, user-facing line per version: "<version> — <summary>". The
    // detail pane holds the rest (and the release page link), so a version row
    // never repeats its own notes as a second paragraph.
    rows.push(buttonItem(
      {
        title: `${headlineFor(entry)}${installedRow ? `  ·  ${tx('ytark.changelog.installed', 'Installed')}` : ''}`,
        subtitle: [entryStatus(entry, installed), entry.tag].filter(Boolean).join(' · '),
      },
      { icon: installedRow ? 'CHECK_CIRCLE_THICK' : 'INFO', secondaryIcon: 'CHEVRON_RIGHT' },
      [{ customAction: { action: 'YTARK_CHANGELOG_VERSION', parameters: { version: entry.version } } }],
    ));
    if ((focusVersion && entry.version === normalizeVersion(focusVersion)) || (!focusVersion && installedRow)) {
      selectedIndex = rows.length - 1;
    }
    if (!focusVersion && !installed && index === 0) selectedIndex = rows.length - 1;
  });
  changelogNotes().forEach((note, index) => {
    rows.push(buttonItem(
      { title: sanitizeText(note.title, 80), subtitle: sanitizeText(note.items[0] || '', 140) },
      { icon: 'BOOKMARK_BORDER', secondaryIcon: 'CHEVRON_RIGHT' },
      [{ customAction: { action: 'YTARK_CHANGELOG_NOTE', parameters: { index } } }],
    ));
  });
  const qrTarget = findEntry(installed) || entries.find(entry => entry.status === 'published');
  rows.push(buttonItem(
    {
      title: tx('ytark.changelog.qrTitle', 'Official release page (QR code)'),
      subtitle: releasePageFor(qrTarget),
    },
    { icon: 'OPEN_IN_NEW' },
    [{ customAction: { action: 'YTARK_CHANGELOG_QR', parameters: { version: qrTarget ? qrTarget.version : '' } } }],
  ));
  return showModal(
    {
      title: tx('ytark.changelog.title', 'Changelog'),
      subtitle: installed
        ? tx('ytark.changelog.subtitleInstalled', 'Every published YTArk version, newest first · installed {{version}}', { version: installed })
        : tx('ytark.changelog.subtitle', 'Every published YTArk version, newest first'),
    },
    overlayPanelItemListRenderer(rows, selectedIndex),
    CHANGELOG_MODAL_ID,
    update,
    { settingsInputOwner: changelogSettingsInputOwner },
  );
}

/** One version as plain text in a scroll pane (D-pad up/down scrolls). */
export function showChangelogVersion(version, { update = false } = {}) {
  const entry = findEntry(version);
  if (!entry) return showChangelog({ update: true, settingsInputOwner: changelogSettingsInputOwner });
  const installed = installedVersion();
  return showModal(
    {
      title: sanitizeText(entry.title && entry.title !== 'YTArk' ? entry.title : `YTArk ${entry.display}`, 80),
      subtitle: `${entry.version} · ${entryStatus(entry, installed)}`,
    },
    scrollPaneRenderer(versionMessages(entry, installed).map(text => overlayMessageRenderer(text))),
    CHANGELOG_VERSION_MODAL_ID,
    update,
    { settingsInputOwner: changelogSettingsInputOwner },
  );
}

export function showChangelogNote(index) {
  const note = changelogNotes()[Number(index)];
  if (!note) return null;
  const items = note.items.map(item => `• ${sanitizeText(item)}`);
  return showModal(
    { title: sanitizeText(note.title, 80), subtitle: tx('ytark.changelog.title', 'Changelog') },
    scrollPaneRenderer(items.map(text => overlayMessageRenderer(text))),
    'ytark-changelog-note',
    false,
    { settingsInputOwner: changelogSettingsInputOwner },
  );
}

export function showReleaseQr(version) {
  const entry = findEntry(version);
  const url = releasePageFor(entry);
  const qr = qrCodeDataUrl(url);
  const items = [overlayMessageRenderer(tx(
    'ytark.changelog.qrMessage',
    'Scan the QR code to open the official release page on your phone: {{url}}',
    { url },
  ))];
  if (qr) items.push(QrCodeRenderer(qr));
  return showModal(
    { title: tx('ytark.changelog.qrTitle', 'Official release page (QR code)'), subtitle: url },
    overlayPanelItemListRenderer(items),
    'ytark-changelog-qr',
    false,
    { settingsInputOwner: changelogSettingsInputOwner },
  );
}
