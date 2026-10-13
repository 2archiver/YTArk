/**
 * Search settings: searches every YTArk setting in the shared registry.
 *
 * Matching is local (nothing is sent anywhere), case- and accent-insensitive
 * and whitespace-normalised. Every query word must match somewhere; matches in
 * the setting's own label rank above aliases, the category path, option names
 * and finally the description. Results show the current value, the category
 * breadcrumb and a short description, and open the real control through the
 * same configuration path as the category menus.
 */

import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, overlayMessageRenderer } from './ytUI.js';
import {
  buildSettingsTree, walkTree, findNode, valueText, dependencyNote, toggleDisplayValue,
} from './settingsRegistry.js';
import { settingCommand, showSettingsMenu, showPanel } from './settings.js';
import resolveCommand from '../resolveCommand.js';
import { openTextEntry } from './textEntryOverlay.js';
import { tx } from '../translations/text.js';

export const SEARCH_MODAL_ID = 'ytark-settings-search';
export const MAX_QUERY_LENGTH = 80;
const MAX_TOKENS = 8;
const MAX_RESULTS = 40;
const SEPARATORS = /[\s\-_.,;:!?'"’‘“”()[\]{}/\\|·•›»«+*&#=~^%$@<>]+/g;
const SEARCHABLE_TYPES = ['toggle', 'choice', 'multi', 'menu', 'action', 'panel'];

const custom = (action, parameters) => ({ customAction: { action, parameters } });

export const SUGGESTIONS = Object.freeze([
  ['theme', 'ytark.search.suggest.theme', 'Theme'],
  ['dimming', 'ytark.search.suggest.dimming', 'Player dimming'],
  ['watermark', 'ytark.search.suggest.watermark', 'Watermark'],
  ['sponsorblock', 'ytark.search.suggest.sponsorblock', 'SponsorBlock'],
  ['quality', 'ytark.search.suggest.quality', 'Quality'],
  ['updates', 'ytark.search.suggest.updates', 'Updates'],
  ['sidebar', 'ytark.search.suggest.sidebar', 'Sidebar'],
  ['subtitles', 'ytark.search.suggest.subtitles', 'Subtitles'],
  ['clock', 'ytark.search.suggest.clock', 'Clock'],
]);

// ---------------------------------------------------------------------------
// Pure search engine
// ---------------------------------------------------------------------------

export function normalizeSearchText(value) {
  let text = String(value === undefined || value === null ? '' : value);
  if (typeof text.normalize === 'function') {
    try {
      text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {
      /* engines without normalize support keep the raw text */
    }
  }
  return text.toLowerCase().replace(SEPARATORS, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenize(query) {
  const normalized = normalizeSearchText(String(query || '').slice(0, MAX_QUERY_LENGTH));
  return normalized ? normalized.split(' ').filter(Boolean).slice(0, MAX_TOKENS) : [];
}

function words(text) {
  return text ? text.split(' ') : [];
}

/** Flatten the registry into searchable entries (private data is never indexed). */
export function buildSearchIndex(tree = buildSettingsTree()) {
  const entries = [];
  let order = 0;
  walkTree(tree, (node, path) => {
    if (node.id === 'root' || node.search === false || !SEARCHABLE_TYPES.includes(node.type)) return;
    const breadcrumbTitles = path.map(item => item.title).filter(Boolean);
    const optionTitles = (node.options || []).map(option => option.title).filter(Boolean);
    entries.push({
      id: node.id,
      node,
      depth: path.length,
      order: order++,
      breadcrumb: breadcrumbTitles.join(' › '),
      fields: {
        title: normalizeSearchText(node.title),
        keywords: (node.keywords || []).map(normalizeSearchText).filter(Boolean),
        path: normalizeSearchText(breadcrumbTitles.join(' ')),
        options: normalizeSearchText(optionTitles.join(' ')),
        description: normalizeSearchText(node.description || ''),
      },
    });
  });
  return entries;
}

function tokenScore(fields, token) {
  let score = 0;
  const titleWords = words(fields.title);
  if (titleWords.includes(token)) score = Math.max(score, 100);
  else if (fields.title.startsWith(token)) score = Math.max(score, 90);
  else if (titleWords.some(word => word.startsWith(token))) score = Math.max(score, 80);
  else if (token.length >= 3 && fields.title.includes(token)) score = Math.max(score, 60);

  for (const keyword of fields.keywords) {
    if (keyword === token) score = Math.max(score, 70);
    else if (words(keyword).some(word => word === token)) score = Math.max(score, 65);
    else if (words(keyword).some(word => word.startsWith(token))) score = Math.max(score, 55);
    else if (token.length >= 3 && keyword.includes(token)) score = Math.max(score, 40);
  }
  if (words(fields.options).some(word => word === token)) score = Math.max(score, 50);
  else if (words(fields.options).some(word => word.startsWith(token))) score = Math.max(score, 45);
  if (words(fields.path).some(word => word.startsWith(token))) score = Math.max(score, 30);
  if (words(fields.description).some(word => word.startsWith(token))) score = Math.max(score, 25);
  else if (token.length >= 3 && fields.description.includes(token)) score = Math.max(score, 15);
  return score;
}

/**
 * Rank entries for a query. Returns [] for an empty query.
 * @returns {{entry: object, score: number}[]}
 */
export function searchSettings(index, query, { limit = MAX_RESULTS } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const phrase = tokens.join(' ');
  const results = [];
  for (const entry of index) {
    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const score = tokenScore(entry.fields, token);
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (!matchedAll) continue;
    if (tokens.length > 1) {
      if (entry.fields.title === phrase) total += 100;
      else if (entry.fields.title.includes(phrase)) total += 50;
      else if (entry.fields.keywords.some(keyword => keyword === phrase || keyword.includes(phrase))) total += 30;
    } else if (entry.fields.title === phrase) {
      total += 20;
    }
    results.push({ entry, score: total });
  }
  results.sort((a, b) => b.score - a.score || a.entry.depth - b.entry.depth || a.entry.order - b.entry.order);
  return results.slice(0, limit);
}

/** One-line description of a result: breadcrumb · current value · note. */
export function describeResult(entry) {
  const node = entry.node;
  const parts = [];
  parts.push(entry.breadcrumb || tx('ytark.search.topLevel', 'YTArk Settings'));
  if (node.unavailable) {
    parts.push(node.unavailable);
    return parts.join(' · ');
  }
  const value = valueText(node);
  if (value) parts.push(tx('ytark.value.current', 'Current: {{value}}', { value }));
  const dependency = dependencyNote(node);
  if (dependency) parts.push(dependency);
  else if (node.description) parts.push(node.description.length > 110 ? `${node.description.slice(0, 109)}…` : node.description);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Search screen
// ---------------------------------------------------------------------------

const state = { query: '', focusId: null };

export function searchState() {
  return { ...state };
}

export function resetSearchState() {
  state.query = '';
  state.focusId = null;
}

export function setSearchQuery(query) {
  state.query = String(query || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  state.focusId = null;
  return state.query;
}

function displayQuery(query) {
  return query.length > 40 ? `${query.slice(0, 39)}…` : query;
}

function resultRow(entry) {
  const node = entry.node;
  const subtitle = describeResult(entry);
  if (node.unavailable) {
    return buttonItem({ title: node.title, subtitle }, { icon: node.icon || 'INFO', secondaryIcon: 'INFO' },
      [custom('YTARK_SETTING_UNAVAILABLE', { id: node.id })]);
  }
  if (node.type === 'toggle') {
    const current = configRead(node.key) === true;
    return buttonItem({ title: node.title, subtitle }, {
      icon: node.icon || 'SETTINGS',
      secondaryIcon: toggleDisplayValue(node) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK',
    }, [
      settingCommand(node.key, 'boolValue', !current),
      custom('YTARK_SEARCH_SHOW', { update: true, focusId: node.id }),
    ]);
  }
  return buttonItem({ title: node.title, subtitle }, {
    icon: node.icon || 'SETTINGS',
    secondaryIcon: node.type === 'action' ? undefined : 'CHEVRON_RIGHT',
  }, [custom('YTARK_SEARCH_OPEN_RESULT', { id: node.id })]);
}

function suggestionRows() {
  return SUGGESTIONS.map(([query, key, label]) => ({
    id: `__suggest.${query}`,
    row: buttonItem(
      { title: tx('ytark.search.suggestion', 'Try "{{term}}"', { term: tx(key, label) }) },
      { icon: 'SEARCH' },
      [custom('YTARK_SEARCH_SET_QUERY', { query })],
    ),
  }));
}

/** Build the rows of the search screen for the current state. */
export function buildSearchRows(index = buildSearchIndex()) {
  const query = state.query;
  const rows = [];
  rows.push({
    id: '__field',
    row: buttonItem(
      {
        title: query
          ? tx('ytark.search.fieldWithQuery', 'Search: "{{query}}"', { query: displayQuery(query) })
          : tx('ytark.search.fieldEmpty', 'Search settings…'),
        subtitle: query
          ? tx('ytark.search.fieldEdit', 'Select to change the search')
          : tx('ytark.search.fieldHint', 'Select to type with the remote, or pick a suggestion below'),
      },
      { icon: 'SEARCH' },
      [custom('YTARK_SEARCH_EDIT', {})],
    ),
  });
  if (!query) {
    rows.push(...suggestionRows());
    return { rows, results: [] };
  }
  rows.push({
    id: '__clear',
    row: buttonItem({ title: tx('ytark.search.clear', 'Clear search') }, { icon: 'CLOSE' },
      [custom('YTARK_SEARCH_CLEAR', {})]),
  });
  const results = searchSettings(index, query);
  if (!results.length) {
    rows.push({
      id: '__empty',
      row: overlayMessageRenderer(tx('ytark.search.noResults', 'No settings match "{{query}}". Try another word or a suggestion.', { query: displayQuery(query) })),
    });
    rows.push(...suggestionRows());
    return { rows, results };
  }
  for (const result of results) rows.push({ id: result.entry.id, row: resultRow(result.entry) });
  return { rows, results };
}

export function showSettingsSearch({ update = false, focusId } = {}) {
  if (focusId) state.focusId = focusId;
  const { rows, results } = buildSearchRows();
  const ids = rows.map(item => item.id);
  let selectedIndex = 0;
  if (state.focusId && ids.includes(state.focusId)) selectedIndex = ids.indexOf(state.focusId);
  else if (state.query && results.length) selectedIndex = ids.indexOf(results[0].entry.id);
  const subtitle = state.query
    ? tx('ytark.search.resultCount', '{{count}} matching settings · searches stay on this TV', { count: results.length })
    : tx('ytark.search.subtitle', 'Every YTArk setting · searches stay on this TV');
  return showModal(
    { title: tx('ytark.search.entry', 'Search settings'), subtitle },
    overlayPanelItemListRenderer(rows.map(item => item.row), Math.max(0, selectedIndex)),
    SEARCH_MODAL_ID,
    update,
  );
}

/** Open the result's real control: a submenu, a panel or the real action. */
export function openSearchResult(id) {
  const tree = buildSettingsTree();
  const node = findNode(tree, id);
  if (!node) return false;
  state.focusId = id;
  if (node.unavailable) {
    resolveCommand(custom('YTARK_SETTING_UNAVAILABLE', { id }));
    return true;
  }
  switch (node.type) {
    case 'menu':
    case 'choice':
    case 'multi':
      showSettingsMenu(id, { returnTo: 'search' });
      return true;
    case 'panel':
      showPanel(id);
      return true;
    case 'action':
      for (const command of node.command || []) resolveCommand(command);
      return true;
    default:
      showSettingsMenu(id, { returnTo: 'search' });
      return true;
  }
}

export function liveStatus(text, index = buildSearchIndex()) {
  const query = String(text || '').trim();
  if (!query) return tx('ytark.search.typeToSearch', 'Type to search every YTArk setting');
  const results = searchSettings(index, query);
  if (!results.length) return tx('ytark.search.liveNone', 'No matching settings yet');
  const titles = results.slice(0, 3).map(result => result.entry.node.title).join(', ');
  return tx('ytark.search.liveCount', '{{count}} matching: {{titles}}', { count: results.length, titles });
}

/** Open the text panel; closing it (Done or Back) applies the text. */
export function editSearchQuery() {
  const index = buildSearchIndex();
  return openTextEntry({
    title: tx('ytark.search.entry', 'Search settings'),
    value: state.query,
    maxLength: MAX_QUERY_LENGTH,
    onChange: text => liveStatus(text, index),
    onClose: (text) => {
      setSearchQuery(text);
      showSettingsSearch({ update: true });
    },
  });
}
