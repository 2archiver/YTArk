/**
 * YTArk Settings menus, rendered from the shared registry (settingsRegistry.js).
 *
 * Every menu is addressed by its stable registry id. Rows read the current
 * configuration at render time and change it through the same
 * setClientSettingEndpoint path that the rest of YTArk uses, then re-render in
 * place with focus kept on the row that was used.
 */

import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, overlayMessageRenderer } from './ytUI.js';
import { t } from 'i18next';
import resolveCommand from '../resolveCommand.js';
import {
  buildSettingsTree, findNode, parentOf, valueText, dependencyNote, toggleDisplayValue, selectedOption,
  defaultValueText, walkTree, ytarkDisplayVersion, ytarkUpdateSubtitle,
} from './settingsRegistry.js';
import { installedVersionInfo, onVersionResolved } from '../features/appVersion.js';
import { tx } from '../translations/text.js';

export { ytarkDisplayVersion, ytarkUpdateSubtitle };

const custom = (action, parameters) => ({ customAction: { action, parameters } });
const POPUP_BACK = { signalAction: { signal: 'POPUP_BACK' } };
/** Runs `action` after the modal closed (POPUP_BACK is always first). */
const deferred = (action, parameters) => custom('YTARK_DEFERRED', { action, parameters });

/**
 * The one panel currently waiting for asynchronous metadata: its id, or null.
 * Set only while a panel actually rendered a loading state, so a late version
 * result can never reopen a panel the user already closed.
 */
let awaitingPanelId = null;
let versionWatchInstalled = false;

function watchAwaitingPanel(panelId, awaiting) {
  awaitingPanelId = awaiting ? panelId : null;
  if (!awaiting || versionWatchInstalled) return;
  versionWatchInstalled = true;
  onVersionResolved(() => {
    const id = awaitingPanelId;
    if (!id) return;
    awaitingPanelId = null;
    try {
      showPanel(id, { update: true });
    } catch (error) {
      console.warn('[YTArk] The panel could not be refreshed with the resolved version:', error);
    }
  });
}

/** Labels for reset keys that have no row of their own. */
const KEY_LABELS = {
  videoSpeed: () => tx('ytark.reset.videoSpeed', 'Playback speed'),
};

export function menuCommand(menuId, options = {}) {
  const parameters = { menuId };
  if (options.focusId) parameters.focusId = options.focusId;
  if (options.update) parameters.update = true;
  if (options.returnTo) parameters.returnTo = options.returnTo;
  return custom('YTARK_MENU_SHOW', parameters);
}

export function settingCommand(key, valueField, value) {
  return {
    setClientSettingEndpoint: {
      settingDatas: [{ clientSettingEnum: { item: key }, [valueField]: value }],
    },
  };
}

export function subtitleFor(node) {
  if (node.unavailable) return node.unavailable;
  const parts = [];
  const value = valueText(node);
  if ((node.type === 'choice' || node.type === 'multi') && value) {
    parts.push(tx('ytark.value.current', 'Current: {{value}}', { value }));
  }
  if (node.description) parts.push(node.description);
  const dependency = dependencyNote(node);
  if (dependency) parts.push(dependency);
  return parts.join(' · ');
}

/** One row for a registry node inside its parent menu. */
export function rowForNode(node, ctx) {
  const subtitle = subtitleFor(node);
  const title = subtitle ? { title: node.title, subtitle } : { title: node.title };
  if (node.unavailable) {
    return buttonItem(title, { icon: node.icon || 'INFO', secondaryIcon: 'INFO' },
      [custom('YTARK_SETTING_UNAVAILABLE', { id: node.id })]);
  }
  switch (node.type) {
    case 'toggle': {
      const current = configRead(node.key) === true;
      return buttonItem(title, {
        icon: node.icon || 'CHEVRON_DOWN',
        secondaryIcon: toggleDisplayValue(node) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK',
      }, [settingCommand(node.key, 'boolValue', !current), ctx.refresh(node.id)]);
    }
    case 'action':
      return buttonItem(title, { icon: node.icon || 'CHEVRON_DOWN' }, node.command || []);
    case 'panel':
      return buttonItem(title, { icon: node.icon || 'INFO', secondaryIcon: 'CHEVRON_RIGHT' },
        [custom('YTARK_PANEL_SHOW', { id: node.id })]);
    case 'link':
      return buttonItem(title, { icon: node.icon || 'CHEVRON_DOWN', secondaryIcon: 'CHEVRON_RIGHT' },
        [menuCommand(node.target)]);
    default:
      return buttonItem(title, { icon: node.icon || 'CHEVRON_DOWN', secondaryIcon: 'CHEVRON_RIGHT' },
        [menuCommand(node.id)]);
  }
}

function optionRow(node, option, ctx, selected) {
  const title = option.description ? { title: option.title, subtitle: option.description } : { title: option.title };
  return buttonItem(title, {
    icon: option.icon || node.icon || 'CHEVRON_DOWN',
    secondaryIcon: selected ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED',
  }, [settingCommand(node.key, 'stringValue', option.value), ctx.refresh(option.id)]);
}

function multiRow(node, option, ctx) {
  const current = configRead(node.key);
  const checked = Array.isArray(current) && current.includes(option.value);
  return buttonItem({ title: option.title }, {
    icon: option.icon || 'CHEVRON_DOWN',
    secondaryIcon: checked ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK',
  }, [settingCommand(node.key, 'arrayValue', option.value), ctx.refresh(option.id)]);
}

function resetRow(node) {
  return buttonItem(
    {
      title: tx('ytark.reset.title', 'Reset {{section}}', { section: node.title }),
      subtitle: tx('ytark.reset.subtitle', 'Restore this section\'s settings to their defaults'),
    },
    { icon: 'UNDO' },
    [custom('YTARK_RESET_SECTION_CONFIRM', { menuId: node.id })],
  );
}

function backToSearchRow() {
  return buttonItem(
    { title: tx('ytark.search.backToResults', 'Back to search results') },
    { icon: 'SEARCH' },
    [POPUP_BACK, custom('YTARK_DEFERRED', { action: 'YTARK_SEARCH_SHOW', parameters: { update: true } })],
  );
}

/** Rows and their ids for a menu-like node, in display order. */
export function menuRows(node, options = {}) {
  const returnTo = options.returnTo || null;
  const ctx = {
    returnTo,
    refresh: focusId => menuCommand(node.id, { focusId, update: true, returnTo }),
  };
  const rows = [];
  const ids = [];
  if (node.type === 'choice') {
    const selected = selectedOption(node);
    for (const option of node.options || []) {
      rows.push(optionRow(node, option, ctx, option === selected));
      ids.push(option.id);
    }
  } else if (node.type === 'multi') {
    for (const option of node.options || []) {
      rows.push(multiRow(node, option, ctx));
      ids.push(option.id);
    }
  } else {
    for (const child of node.children || []) {
      rows.push(rowForNode(child, ctx));
      ids.push(child.id);
    }
  }
  if (Array.isArray(node.resetKeys) && node.resetKeys.length) {
    rows.push(resetRow(node));
    ids.push(`${node.id}.__reset`);
  }
  if (returnTo === 'search') {
    rows.push(backToSearchRow());
    ids.push('__backToSearch');
  }
  return { rows, ids };
}

/**
 * Open (or re-render in place) the menu with registry id `menuId`.
 * options: { focusId, focusIndex, update, returnTo }
 */
export function showSettingsMenu(menuId = 'root', options = {}) {
  const tree = buildSettingsTree();
  let node = menuId === 'root' ? tree : findNode(tree, menuId);
  if (!node) node = tree;
  if (node.unavailable) {
    resolveCommand(custom('YTARK_SETTING_UNAVAILABLE', { id: node.id }));
    return null;
  }
  if (node.type === 'panel') return showPanel(node.id, { update: !!options.update });
  if (node.type === 'link') return showSettingsMenu(node.target, options);
  if (node.type === 'toggle' || node.type === 'action') {
    const parent = parentOf(tree, node.id) || tree;
    return showSettingsMenu(parent.id, { ...options, focusId: node.id });
  }

  const { rows, ids } = menuRows(node, options);
  let selectedIndex = 0;
  if (options.focusId && ids.includes(options.focusId)) {
    selectedIndex = ids.indexOf(options.focusId);
  } else if (Number.isInteger(Number(options.focusIndex)) && Number(options.focusIndex) >= 0
      && Number(options.focusIndex) < rows.length) {
    selectedIndex = Number(options.focusIndex);
  } else if (node.type === 'choice') {
    const selected = selectedOption(node);
    if (selected) selectedIndex = node.options.indexOf(selected);
  }
  const header = node.header || { title: node.title, subtitle: node.description || '' };
  // A menu replaces whatever panel was waiting for asynchronous metadata.
  awaitingPanelId = null;
  const parent = node.id === 'root' ? null : parentOf(tree, node.id);
  const onDismiss = options.returnTo === 'search'
    ? [deferred('YTARK_SEARCH_SHOW', { update: true })]
    // Back from a submenu returns to its parent with focus on the row that was
    // used, instead of dropping focus back to the top of the list.
    : (parent ? [deferred('YTARK_MENU_SHOW', { menuId: parent.id, focusId: node.id, update: true })] : undefined);
  return showModal(header, overlayPanelItemListRenderer(rows, selectedIndex),
    node.menuId || `ytark-menu-${node.id}`, !!options.update, { onDismiss });
}

/**
 * Render an information panel. options: { update }.
 *
 * Panels that depend on metadata the platform answers asynchronously (About
 * YTArk's installed version) render a short loading state and are re-rendered
 * in place — same `uniqueId`, `updateAction` — as soon as the value arrives, so
 * no second panel is ever created. Back closes the panel and returns focus to
 * the row it was opened from.
 */
export function showPanel(id, options = {}) {
  const tree = buildSettingsTree();
  const node = findNode(tree, id);
  if (!node || typeof node.panel !== 'function') return null;
  const panel = node.panel();
  watchAwaitingPanel(node.id, node.versionAware === true && installedVersionInfo().loading);
  const parent = parentOf(tree, node.id);
  return showModal(
    { title: panel.title, subtitle: panel.subtitle },
    panel.content,
    `ytark-panel-${node.id}`,
    !!options.update,
    { onDismiss: parent ? [deferred('YTARK_MENU_SHOW', { menuId: parent.id, focusId: node.id, update: true })] : undefined },
  );
}

function ownerOf(node, key) {
  let owner = null;
  walkTree(node, (candidate) => {
    if (!owner && candidate.key === key) owner = candidate;
  });
  return owner;
}

/** What a section reset changes, as "title: default" lines. */
export function resetScope(menuId) {
  const tree = buildSettingsTree();
  const node = findNode(tree, menuId);
  if (!node || !Array.isArray(node.resetKeys)) return null;
  const lines = [];
  for (const key of node.resetKeys) {
    const owner = ownerOf(node, key);
    const label = owner ? owner.title : (KEY_LABELS[key] ? KEY_LABELS[key]() : null);
    if (!label) continue;
    const line = `${label}: ${defaultValueText(owner, key)}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return { node, keys: node.resetKeys.slice(), lines };
}

export function showResetConfirm(menuId) {
  const scope = resetScope(menuId);
  if (!scope) return null;
  const items = [
    overlayMessageRenderer(`${tx('ytark.reset.listIntro', 'These settings return to their defaults:')}\n${scope.lines.join('\n')}`),
    buttonItem({ title: tx('ytark.reset.confirm', 'Reset') }, { icon: 'UNDO' },
      [POPUP_BACK, custom('YTARK_RESET_SECTION', { menuId })]),
    buttonItem({ title: tx('ytark.reset.cancel', 'Cancel') }, { icon: 'CLOSE' }, [POPUP_BACK]),
  ];
  return showModal(
    {
      title: tx('ytark.reset.confirmTitle', 'Reset {{section}}?', { section: scope.node.title }),
      subtitle: tx('ytark.reset.confirmScope', 'Only these YTArk settings change. Your Google account, app data and other settings stay as they are.'),
    },
    overlayPanelItemListRenderer(items, 2),
    'ytark-reset-confirm',
    false,
  );
}

/** Legacy entry point: YTArk Settings root (also used by the red/green keys). */
export default function modernUI(update, parameters) {
  return showSettingsMenu('root', {
    update: !!update,
    focusIndex: Array.isArray(parameters) && parameters.length > 0 ? parameters[0] : undefined,
  });
}

/**
 * Legacy renderer kept for `OPTIONS_SHOW` commands issued by older builds or
 * cached frontend state. New menus use showSettingsMenu().
 */
export function optionShow(parameters, update) {
  if (update === 'customUI') {
    const option = parameters.options;
    showModal({ title: option.title, subtitle: option.subtitle }, option.content, 'tt-settings-support', false);
    return;
  }
  const buttons = [];
  const isArrayBasedOptions = parameters.arrayToEdit !== undefined;

  if (parameters.action) {
    return resolveCommand(parameters.action);
  }

  if (isArrayBasedOptions) {
    const value = configRead(parameters.arrayToEdit);
    for (const option of parameters.options) {
      buttons.push(buttonItem(
        { title: option.name, subtitle: option.subtitle },
        { icon: option.icon ? option.icon : 'CHEVRON_DOWN', secondaryIcon: value.includes(option.value) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK' },
        [
          settingCommand(parameters.arrayToEdit, 'arrayValue', option.value),
          custom('OPTIONS_SHOW', { ...parameters, selectedIndex: parameters.options.indexOf(option), update: true }),
        ],
      ));
    }
  } else {
    let index = 0;
    for (const option of parameters.options) {
      if (!option) continue;
      if (option.compactLinkRenderer) {
        buttons.push(option);
        index++;
        continue;
      }
      const isRadioChoice = option.key !== null && option.key !== undefined;
      const currentVal = option.value === null ? undefined : configRead(isRadioChoice ? option.key : option.value);
      const reopen = custom('OPTIONS_SHOW', {
        options: parameters.options,
        selectedIndex: index,
        update: parameters.options?.title ? 'customUI' : true,
        menuId: parameters.menuId,
        arrayToEdit: parameters.arrayToEdit,
        menuHeader: parameters.menuHeader,
        action: parameters.action,
      });
      let commands;
      if (option.value === null) {
        commands = [custom('OPTIONS_SHOW', {
          options: option.options,
          selectedIndex: 0,
          update: option.options?.title ? 'customUI' : false,
          menuId: option.menuId,
          arrayToEdit: option.arrayToEdit,
          menuHeader: option.menuHeader,
          action: option.action,
        })];
      } else if (isRadioChoice) {
        commands = [settingCommand(option.key, 'stringValue', option.value), reopen];
      } else {
        commands = [settingCommand(option.value, 'boolValue', !currentVal), reopen];
      }
      buttons.push(buttonItem(
        { title: option.name, subtitle: option.subtitle },
        {
          icon: option.icon ? option.icon : 'CHEVRON_DOWN',
          secondaryIcon: isRadioChoice ? (currentVal === option.value ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED')
            : option.value === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK',
        },
        commands,
      ));
      index++;
    }
  }

  showModal(parameters.menuHeader ? parameters.menuHeader : t('settings.ttSettings.title'),
    overlayPanelItemListRenderer(buttons, parameters.selectedIndex), parameters.menuId || 'tt-settings-options', update);
}
