/**
 * Layout customisation for the native YouTube TV Settings page.
 *
 * The page arrives as one InnerTube response whose `items` are
 * `settingCategoryCollectionRenderer` entries, each with a stable `categoryId`
 * (for example SETTING_CAT_TVHTML5_ABOUT) and rows such as
 * `settingBooleanRenderer` / `settingActionRenderer` /
 * `settingSingleOptionMenuRenderer` identified by `itemId` or by the client
 * setting they write. Everything here works on those identities only: no
 * English text matching and no numeric positions.
 *
 * What the layout can do
 *   - reorder categories and hide optional ones,
 *   - pin rows: the genuine row object (with its real endpoints, labels and
 *     accessibility data) is moved into a "Pinned" category near the top,
 *   - hide optional rows.
 * Protected entries can never be hidden: the YTArk category, anything
 * account/sign-in/sign-out related (by category id, row id or account
 * command), About and Help. Unknown new categories are appended visibly.
 * Hiding only removes a row from this page; the underlying setting keeps its
 * value and keeps working, and other entry points are not affected.
 */

export const YTARK_CATEGORY_ID = 'tizentube_category';
export const PINNED_CATEGORY_ID = 'ytark_pinned_category';
export const CATALOG_SCHEMA = 1;

const MAX_CATEGORIES = 40;
const MAX_ROWS = 40;
const MAX_TITLE = 80;

const PROTECTED_CATEGORY_PATTERN = /ACCOUNT|SIGN_?IN|SIGN_?OUT|IDENTITY|LINK_PHONE|ABOUT|HELP/i;
const PROTECTED_ROW_PATTERN = /ACCOUNT|SIGN_?IN|SIGN_?OUT|LOG_?IN|LOG_?OUT|IDENTITY|SWITCH_?USER/i;
const ACCOUNT_COMMAND_PATTERN = /^(signIn|signOut|selectActiveIdentity|switchAccount|accountSwitch|addAccount|requestAccountSelector|accountSelector|identitySwitch)[A-Za-z]*(Endpoint|Command)$/;
const EMAIL_LIKE = /\S+@\S+/;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function categoryOf(item) {
  return isPlainObject(item) && isPlainObject(item.settingCategoryCollectionRenderer)
    ? item.settingCategoryCollectionRenderer : null;
}

/** Structural identity of the native settings response. */
export function isSettingsResponse(response) {
  return isPlainObject(response) && Array.isArray(response.items) && response.items.some(categoryOf);
}

export function textOf(text) {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (Array.isArray(text.runs)) return text.runs.map(run => (run && typeof run.text === 'string' ? run.text : '')).join('');
  if (typeof text.simpleText === 'string') return text.simpleText;
  if (typeof text.content === 'string') return text.content;
  return '';
}

export function rendererOf(row) {
  if (!isPlainObject(row)) return null;
  const type = Object.keys(row).find(key => /Renderer$/.test(key) && isPlainObject(row[key]));
  return type ? { type, renderer: row[type] } : null;
}

function clientSettingOf(renderer) {
  for (const key of ['enableServiceEndpoint', 'serviceEndpoint', 'disableServiceEndpoint']) {
    const endpoint = renderer[key];
    const datas = endpoint && endpoint.setClientSettingEndpoint && endpoint.setClientSettingEndpoint.settingDatas;
    const item = Array.isArray(datas) && datas[0] && datas[0].clientSettingEnum && datas[0].clientSettingEnum.item;
    if (typeof item === 'string' && item) return item;
  }
  return '';
}

/** Stable row identity: `item:<itemId>` or `setting:<client setting enum>`. */
export function rowIdOf(row) {
  const found = rendererOf(row);
  if (!found) return null;
  const itemId = found.renderer.itemId;
  if (typeof itemId === 'string' && itemId && itemId.length <= 120) return `item:${itemId}`;
  const setting = clientSettingOf(found.renderer);
  return setting && setting.length <= 120 ? `setting:${setting}` : null;
}

function hasAccountCommand(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(entry => hasAccountCommand(entry, depth + 1));
  for (const key of Object.keys(value)) {
    if (ACCOUNT_COMMAND_PATTERN.test(key)) return true;
    if (hasAccountCommand(value[key], depth + 1)) return true;
  }
  return false;
}

export function isProtectedRow(row) {
  const found = rendererOf(row);
  if (!found) return false;
  if (/account/i.test(found.type)) return true;
  const id = rowIdOf(row) || '';
  if (PROTECTED_ROW_PATTERN.test(id)) return true;
  return hasAccountCommand(found.renderer);
}

export function isProtectedCategory(category) {
  if (!category) return false;
  const id = typeof category.categoryId === 'string' ? category.categoryId : '';
  if (id === YTARK_CATEGORY_ID) return true;
  if (PROTECTED_CATEGORY_PATTERN.test(id)) return true;
  return Array.isArray(category.items) && category.items.some(isProtectedRow);
}

function safeTitle(value, fallback) {
  const text = String(textOf(value) || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (EMAIL_LIKE.test(text)) return fallback;
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

function readableId(id) {
  return String(id || '').replace(/^SETTING_CAT_(TVHTML5_)?/, '').replace(/_/g, ' ').toLowerCase()
    .replace(/(^|\s)\S/g, match => match.toUpperCase()) || 'Section';
}

/**
 * Describe the detected page for the editor. Rows of protected categories are
 * not recorded at all, and titles that look like an account identity are
 * replaced, so the stored catalog never contains account data.
 */
export function extractCatalog(items, ytarkTitle = 'YTArk') {
  const categories = [];
  for (const item of Array.isArray(items) ? items : []) {
    const category = categoryOf(item);
    if (!category || typeof category.categoryId !== 'string' || !category.categoryId) continue;
    if (category.categoryId === PINNED_CATEGORY_ID) continue;
    if (categories.some(entry => entry.id === category.categoryId)) continue;
    const isOurs = category.categoryId === YTARK_CATEGORY_ID;
    const protectedCategory = isProtectedCategory(category);
    const rows = [];
    if (!protectedCategory && Array.isArray(category.items)) {
      for (const row of category.items) {
        const id = rowIdOf(row);
        if (!id || rows.some(entry => entry.id === id)) continue;
        const found = rendererOf(row);
        rows.push({
          id,
          title: safeTitle(found.renderer.title, id.replace(/^(item|setting):/, '')),
          protected: isProtectedRow(row),
        });
        if (rows.length >= MAX_ROWS) break;
      }
    }
    categories.push({
      id: category.categoryId,
      title: isOurs ? ytarkTitle : safeTitle(category.title, readableId(category.categoryId)),
      protected: protectedCategory,
      rows,
    });
    if (categories.length >= MAX_CATEGORIES) break;
  }
  return categories;
}

/** Merge a fresh detection into the stored catalog, keeping dormant entries. */
export function mergeCatalog(previous, detected, now = Date.now()) {
  const old = isPlainObject(previous) && Array.isArray(previous.categories) ? previous.categories : [];
  const merged = detected.map(entry => ({ ...entry, present: true }));
  for (const entry of old) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string') continue;
    if (merged.some(item => item.id === entry.id)) continue;
    merged.push({
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title : readableId(entry.id),
      protected: entry.protected === true,
      rows: Array.isArray(entry.rows) ? entry.rows.filter(row => isPlainObject(row) && typeof row.id === 'string') : [],
      present: false,
    });
    if (merged.length >= MAX_CATEGORIES) break;
  }
  return { schema: CATALOG_SCHEMA, updatedAt: now, categories: merged };
}

export function catalogEquals(a, b) {
  const strip = value => JSON.stringify(isPlainObject(value) && Array.isArray(value.categories) ? value.categories : []);
  return strip(a) === strip(b);
}

export function normalizeLayout(layout) {
  const source = isPlainObject(layout) ? layout : {};
  const list = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : []);
  return {
    order: list(source.order),
    hidden: list(source.hidden),
    pinned: list(source.pinned),
    hiddenRows: list(source.hiddenRows),
  };
}

export function isCustomized(layout) {
  const normalized = normalizeLayout(layout);
  return normalized.order.length > 0 || normalized.hidden.length > 0
    || normalized.pinned.length > 0 || normalized.hiddenRows.length > 0;
}

/** Category ids in display order for a set of present ids. */
export function orderIds(presentIds, layout) {
  const { order } = normalizeLayout(layout);
  const ranked = [];
  const rest = [];
  for (const id of presentIds) {
    if (order.includes(id)) ranked.push(id);
    else rest.push(id);
  }
  ranked.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const result = ranked.concat(rest);
  // YTArk stays at the top until the user moves it explicitly.
  if (!order.includes(YTARK_CATEGORY_ID) && result.includes(YTARK_CATEGORY_ID)) {
    result.splice(result.indexOf(YTARK_CATEGORY_ID), 1);
    result.unshift(YTARK_CATEGORY_ID);
  }
  return result;
}

/**
 * Apply the layout to a settings response in place. Idempotent: a response
 * that already carries the YTArk category was patched before and is left
 * alone, so revisiting the page never duplicates rows.
 *
 * @param {object} response
 * @param {object} layout
 * @param {{makeYtarkCategory: function(boolean): object, pinnedTitle?: string}} options
 */
export function applySettingsLayout(response, layout, options = {}) {
  if (!isSettingsResponse(response)) return { applied: false, reason: 'not-settings' };
  const items = response.items;
  if (items.some(item => {
    const category = categoryOf(item);
    return category && category.categoryId === YTARK_CATEGORY_ID;
  })) {
    return { applied: false, reason: 'already-patched' };
  }

  const normalized = normalizeLayout(layout);
  const customized = isCustomized(normalized);
  const others = items.filter(item => !categoryOf(item));
  const categories = items.filter(item => categoryOf(item));

  // Pins: move the genuine row objects, in the user's pin order.
  const pinnedRows = [];
  const pinnedOrigins = {};
  const emptied = new Set();
  for (const pinId of normalized.pinned) {
    for (const item of categories) {
      const category = categoryOf(item);
      // Rows of protected categories stay where YouTube put them.
      if (!Array.isArray(category.items) || isProtectedCategory(category)) continue;
      const index = category.items.findIndex(row => rowIdOf(row) === pinId);
      if (index === -1) continue;
      pinnedRows.push(category.items.splice(index, 1)[0]);
      pinnedOrigins[pinId] = category.categoryId;
      if (!category.items.length) emptied.add(category.categoryId);
      break;
    }
  }

  // Hidden rows (never protected ones).
  if (normalized.hiddenRows.length) {
    for (const item of categories) {
      const category = categoryOf(item);
      if (!Array.isArray(category.items) || isProtectedCategory(category)) continue;
      const before = category.items.length;
      category.items = category.items.filter(row => !(normalized.hiddenRows.includes(rowIdOf(row)) && !isProtectedRow(row)));
      if (before && !category.items.length) emptied.add(category.categoryId);
    }
  }

  const visible = categories.filter(item => {
    const category = categoryOf(item);
    if (emptied.has(category.categoryId) && !isProtectedCategory(category)) return false;
    if (normalized.hidden.includes(category.categoryId) && !isProtectedCategory(category)) return false;
    return true;
  });
  const hiddenCount = categories.length - visible.length;

  const ytarkCategory = typeof options.makeYtarkCategory === 'function'
    ? options.makeYtarkCategory(customized) : null;
  if (ytarkCategory) visible.unshift(ytarkCategory);

  const byId = new Map();
  const unkeyed = [];
  for (const item of visible) {
    const id = categoryOf(item).categoryId;
    if (typeof id === 'string' && id && !byId.has(id)) byId.set(id, item);
    else unkeyed.push(item);
  }
  const ordered = orderIds(Array.from(byId.keys()), normalized).map(id => byId.get(id));

  if (pinnedRows.length) {
    const pinned = {
      settingCategoryCollectionRenderer: {
        categoryId: PINNED_CATEGORY_ID,
        title: { runs: [{ text: options.pinnedTitle || 'Pinned' }] },
        items: pinnedRows,
        focused: false,
        trackingParams: 'null',
        ytarkPinnedOrigins: pinnedOrigins,
      },
    };
    const ytarkIndex = ordered.findIndex(item => categoryOf(item).categoryId === YTARK_CATEGORY_ID);
    ordered.splice(ytarkIndex === -1 ? 0 : ytarkIndex + 1, 0, pinned);
  }

  response.items = ordered.concat(unkeyed, others);
  return {
    applied: true,
    customized,
    pinned: pinnedRows.length,
    hidden: hiddenCount,
  };
}

// ---------------------------------------------------------------------------
// Editor model (pure)
// ---------------------------------------------------------------------------

/** Every catalogued category in its effective editor order. */
export function editorEntries(catalog, layout) {
  const normalized = normalizeLayout(layout);
  const categories = isPlainObject(catalog) && Array.isArray(catalog.categories) ? catalog.categories : [];
  const known = categories.filter(entry => isPlainObject(entry) && typeof entry.id === 'string');
  const ids = known.map(entry => entry.id);
  const orderedIds = orderIds(ids, normalized);
  return orderedIds.map((id, index) => {
    const entry = known.find(item => item.id === id);
    const protectedEntry = entry.protected === true || id === YTARK_CATEGORY_ID || PROTECTED_CATEGORY_PATTERN.test(id);
    return {
      id,
      title: entry.title || readableId(id),
      protected: protectedEntry,
      hidden: !protectedEntry && normalized.hidden.includes(id),
      present: entry.present !== false,
      position: index + 1,
      total: orderedIds.length,
      rows: (entry.rows || []).map(row => ({
        id: row.id,
        title: row.title || row.id,
        protected: row.protected === true,
        pinned: normalized.pinned.includes(row.id),
        hidden: row.protected !== true && normalized.hiddenRows.includes(row.id),
      })),
    };
  });
}

/** Return a new layout with `id` moved one step up (-1) or down (+1). */
export function moveCategory(catalog, layout, id, direction) {
  const normalized = normalizeLayout(layout);
  const ids = editorEntries(catalog, normalized).map(entry => entry.id);
  const index = ids.indexOf(id);
  const target = index + (direction < 0 ? -1 : 1);
  if (index === -1 || target < 0 || target >= ids.length) return { layout: normalized, moved: false, index };
  const next = ids.slice();
  next.splice(index, 1);
  next.splice(target, 0, id);
  return { layout: { ...normalized, order: next }, moved: true, index: target };
}

export function setCategoryHidden(catalog, layout, id, hidden) {
  const normalized = normalizeLayout(layout);
  const entry = editorEntries(catalog, normalized).find(item => item.id === id);
  if (!entry) return { layout: normalized, changed: false, reason: 'unknown' };
  if (entry.protected && hidden) return { layout: normalized, changed: false, reason: 'protected' };
  const set = normalized.hidden.filter(item => item !== id);
  if (hidden) set.push(id);
  return { layout: { ...normalized, hidden: set }, changed: true };
}

export function setRowPinned(layout, rowId, pinned) {
  const normalized = normalizeLayout(layout);
  const list = normalized.pinned.filter(item => item !== rowId);
  if (pinned) list.push(rowId);
  const hiddenRows = pinned ? normalized.hiddenRows.filter(item => item !== rowId) : normalized.hiddenRows;
  return { ...normalized, pinned: list.slice(-30), hiddenRows };
}

export function setRowHidden(layout, row, hidden) {
  const normalized = normalizeLayout(layout);
  if (hidden && row && row.protected) return { layout: normalized, changed: false, reason: 'protected' };
  const id = row && row.id;
  const list = normalized.hiddenRows.filter(item => item !== id);
  if (hidden) list.push(id);
  const pinned = hidden ? normalized.pinned.filter(item => item !== id) : normalized.pinned;
  return { layout: { ...normalized, hiddenRows: list, pinned }, changed: true };
}

export function defaultLayout() {
  return { order: [], hidden: [], pinned: [], hiddenRows: [] };
}
