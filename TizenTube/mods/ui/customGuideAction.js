import { guideEntryIdentity, guideOrderIdentity, guideSections, arrangeGuideSection } from './guideIdentity.js';
import { configChangeEmitter, configRead, configWrite } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";
import { GuideEntryRenderer } from "./ytUI.js";
import { GUIDE_SETTINGS_ACTION } from "./guideEntryActivation.js";
import { t } from "i18next";

const YTARK_GUIDE_ENTRY_MARKER = "__ytarkGuideEntry";

function ytarkGuideEntry() {
    // The entry carries its own action, not `TT_SETTINGS_SHOW`. The TV frontend
    // resolves a guide entry's navigation endpoint when the entry is *focused*,
    // which used to open YTArk Settings just by scrolling past it. This action
    // is honoured only after an explicit OK/Enter or click
    // (ui/guideEntryActivation.js), so focusing the row only highlights it.
    const entry = GuideEntryRenderer(
        t('settings.ttSettings.title'),
        { customAction: { action: GUIDE_SETTINGS_ACTION, parameters: [] } },
        'SETTINGS'
    );
    entry[YTARK_GUIDE_ENTRY_MARKER] = true;
    return entry;
}

/**
 * Quick access to YTArk Settings straight from the TV guide.
 *
 * The entry is added after the reordering and hiding passes so that hiding
 * sidebar items can never make the settings unreachable, and it is placed
 * last — below every YouTube navigation entry and below YouTube's own
 * Settings entry — so scrolling the sidebar cannot end on it by accident.
 * It stays reachable with the remote: focusing it highlights it and OK/Enter
 * opens exactly one YTArk Settings panel. Toggling the setting off removes it
 * on the next guide load. The entry carries a marker so repeated guide loads
 * stay idempotent and so the move/hide guide-entry UI (which works from
 * `originalItems`, captured before this pass) never offers to relocate it.
 */
function applyYtarkGuideEntry(r) {
    const section = guideSections(r)[0];
    if (!section || !Array.isArray(section.items)) return;
    for (let i = section.items.length - 1; i >= 0; i--) {
        if (section.items[i]?.[YTARK_GUIDE_ENTRY_MARKER]) section.items.splice(i, 1);
    }
    // A re-parsed (already patched) guide must not keep the entry in the stock
    // snapshot the move/hide UI works from either.
    if (Array.isArray(section.originalItems)) {
        for (let i = section.originalItems.length - 1; i >= 0; i--) {
            if (section.originalItems[i]?.[YTARK_GUIDE_ENTRY_MARKER]) section.originalItems.splice(i, 1);
        }
    }
    if (configRead('enableYtarkGuideEntry') === false) return;
    section.items.push(ytarkGuideEntry());
}

const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    const sections = guideSections(r);
    if (!sections.length) return r;
    const storedOrder = configRead('sidebarContentsOrder');
    const order = Array.isArray(storedOrder) ? storedOrder.slice() : [];
    const known = new Set(order.map(guideOrderIdentity).filter(Boolean));
    let orderChanged = false;
    for (const section of sections) {
        const source = Array.isArray(section.originalItems) ? section.originalItems : section.items;
        for (const item of source) {
            if (item?.__ytarkGuideEntry) continue;
            const id = guideEntryIdentity(item);
            if (id && !known.has(id)) {
                order.push(id);
                known.add(id);
                orderChanged = true;
            }
        }
    }
    const hidden = configRead('disabledSidebarContents');
    for (const section of sections) {
        arrangeGuideSection(section, order, Array.isArray(hidden) ? hidden : []);
    }
    // Stored channel shortcuts remain compatible. Never synthesize a guessed
    // Search/Shorts action or duplicate a channel returned by the server.
    const first = sections[0];
    const present = new Set(sections.flatMap(section => section.originalItems.map(guideEntryIdentity)));
    for (const value of order) {
        const id = guideOrderIdentity(value);
        if (!value || typeof value !== 'object' || !id?.startsWith('UC') || present.has(id)
            || typeof value.title !== 'string') continue;
        const entry = GuideEntryRenderer(value.title, { browseEndpoint: { browseId: id } }, 'PERSON');
        first.originalItems.push(entry);
        present.add(id);
    }
    arrangeGuideSection(first, order, Array.isArray(hidden) ? hidden : []);
    // Persist only after the response is complete; a synchronous reload cannot
    // observe a half-processed guide.
    if (orderChanged) configWrite('sidebarContentsOrder', order);

    // Last, so the entry is immune to the reordering and hiding passes above.
    applyYtarkGuideEntry(r);

    return r;
}

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail.key === 'disabledSidebarContents' ||
        e.detail.key === 'sidebarContentsOrder' || e.detail.key === 'enableYtarkGuideEntry') {
        const commandExecutor = getCommandExecutor();
        if (commandExecutor) {
            commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
        }
    }
});