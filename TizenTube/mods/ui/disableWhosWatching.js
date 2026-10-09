import { configChangeEmitter, configRead } from '../config.js';

const GUEST_ACTION = 'startup-screen-account-selector-with-guest';
const SIGNED_OUT_ACTION = 'startup-screen-signed-out-welcome-back';
const ZERO_ACCOUNT_WHO_ACTION = 'whos_watching_fullscreen_zero_accounts';
const ACCOUNT_FLOW_MIGRATION_KEY = 'ytark-account-flow-preserved-v1';
let interval;

/** Undo only a future suppression left by older YTArk builds. */
export function restoreGuestAccountSelector(recurringActions, now = Date.now()) {
    const actions = recurringActions?.data?.data;
    const guestAction = actions && actions[GUEST_ACTION];
    if (!guestAction || !Number.isFinite(Number(guestAction.lastFired))) return false;
    if (Number(guestAction.lastFired) <= now) return false;
    guestAction.lastFired = 0;
    return true;
}

/**
 * Older YTArk builds postponed the stock guest selector and signed-out welcome
 * screen when hiding "Who's watching". Restore those actions once per install,
 * then leave their future native scheduling entirely to YouTube.
 */
export function restoreLegacyAccountActions(recurringActions, now = Date.now()) {
    const actions = recurringActions?.data?.data;
    if (!actions) return [];
    const restored = [];
    for (const name of [GUEST_ACTION, SIGNED_OUT_ACTION]) {
        const action = actions[name];
        if (action && Number.isFinite(Number(action.lastFired)) && Number(action.lastFired) > now) {
            action.lastFired = 0;
            restored.push(name);
        }
    }
    return restored;
}

function migrateLegacyAccountActions(storage) {
    if (!storage || storage[ACCOUNT_FLOW_MIGRATION_KEY] === '1') return;
    try {
        const stored = storage['yt.leanback.default::recurring_actions'];
        if (!stored) return;
        const recurringActions = JSON.parse(stored);
        if (!recurringActions?.data?.data) return;
        restoreLegacyAccountActions(recurringActions);
        storage['yt.leanback.default::recurring_actions'] = JSON.stringify(recurringActions);
        storage[ACCOUNT_FLOW_MIGRATION_KEY] = '1';
    } catch (error) {
        console.warn('[YTArk] Could not restore YouTube TV account actions:', error);
    }
}

function disableWhosWatching(value) {
    let recurringActions;
    try {
        const stored = localStorage['yt.leanback.default::recurring_actions'];
        if (!stored) return;
        recurringActions = JSON.parse(stored);
    } catch (error) {
        console.warn('[YTArk] Could not read YouTube TV account-screen settings:', error);
        return;
    }

    if (!recurringActions?.data?.data) return;
    const zeroAccountAction = recurringActions.data.data[ZERO_ACCOUNT_WHO_ACTION];
    const shouldPermanentlyEnable = configRead('permanentlyEnableWhoIsWatchingMenu');
    const date = new Date();

    // This preference affects only the separate zero-account "Who's watching"
    // prompt. Do not postpone the stock guest selector or signed-out welcome.
    if (!value) {
        date.setDate(date.getDate() + 7);
        if (zeroAccountAction) {
            zeroAccountAction.lastFired = date.getTime();
            localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(recurringActions);
        }
        if (interval) clearInterval(interval);
        interval = null;
    } else if (zeroAccountAction) {
        if (!shouldPermanentlyEnable) {
            zeroAccountAction.lastFired = date.getTime();
            localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(recurringActions);
        } else {
            const setAction = () => {
                zeroAccountAction.lastFired = date.getTime();
                localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(recurringActions);
            };
            setAction();
            date.setDate(date.getDate() - 7);
            setAction();
            if (interval) clearInterval(interval);
            interval = setInterval(setAction, 60 * 1000);
        }
    }
}

migrateLegacyAccountActions(typeof localStorage !== 'undefined' ? localStorage : null);

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail || {};
    if (key === 'enableWhoIsWatchingMenu') disableWhosWatching(value);
});

disableWhosWatching(configRead('enableWhoIsWatchingMenu'));
