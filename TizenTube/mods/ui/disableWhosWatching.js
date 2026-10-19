import { configChangeEmitter, configRead } from '../config.js';

const GUEST_ACTION = 'startup-screen-account-selector-with-guest';
const SIGNED_OUT_ACTION = 'startup-screen-signed-out-welcome-back';
const ZERO_ACCOUNT_WHO_ACTION = 'whos_watching_fullscreen_zero_accounts';
const ACCOUNT_FLOW_MIGRATION_KEY = 'ytark-account-selector-unthrottled-v2';
const SUPPRESSION_STATE_KEY = 'ytark-automatic-profile-picker-state-v1';
const SUPPRESSED_LAST_FIRED = 253402300799999; // 9999-12-31 UTC; no timer or recurring rewrite.
const LEGACY_SCHEDULED_ACTIONS = [GUEST_ACTION, SIGNED_OUT_ACTION, ZERO_ACCOUNT_WHO_ACTION];
const RECURRING_ACTIONS_KEY = 'yt.leanback.default::recurring_actions';

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSafeTimestamp(value) {
    return (typeof value === 'number' && Number.isFinite(value))
        || (typeof value === 'string' && value.length <= 32 && value.trim() !== '' && Number.isFinite(Number(value)));
}

function validSavedEntry(value) {
    return isRecord(value) && typeof value.hadLastFired === 'boolean'
        && (!value.hadLastFired || isSafeTimestamp(value.lastFired));
}

function validSuppressionState(value) {
    return isRecord(value) && value.schema === 1 && isRecord(value.actions);
}

/**
 * Restore only scheduler timestamps that older YTArk builds pushed into the
 * future. These are automatic account/profile prompts; account data and manual
 * sign-in/account-selector commands are never inspected or changed.
 */
export function restoreLegacyAccountActions(recurringActions, now = Date.now()) {
    const actions = recurringActions?.data?.data;
    if (!actions) return [];
    const restored = [];
    for (const name of LEGACY_SCHEDULED_ACTIONS) {
        const action = actions[name];
        if (action && Number.isFinite(Number(action.lastFired)) && Number(action.lastFired) > now) {
            action.lastFired = 0;
            restored.push(name);
        }
    }
    return restored;
}

/**
 * Pure, reversible policy for YouTube's three known automatic account screens.
 * `previous` records only their original lastFired values, never account data.
 */
export function applyAutomaticProfilePickerPolicy(recurringActions, enabled, previous = null) {
    const actions = recurringActions?.data?.data;
    if (!isRecord(actions)) return { changed: false, markerChanged: false, marker: previous };
    const hasPrevious = validSuppressionState(previous);
    const saved = {};
    let changed = false;
    let markerChanged = false;
    if (hasPrevious) {
        for (const name of LEGACY_SCHEDULED_ACTIONS) {
            if (validSavedEntry(previous.actions[name])) saved[name] = previous.actions[name];
            else if (Object.prototype.hasOwnProperty.call(previous.actions, name)) markerChanged = true;
        }
        if (Object.keys(previous.actions).some(name => !LEGACY_SCHEDULED_ACTIONS.includes(name))) markerChanged = true;
    }

    if (!enabled) {
        for (const name of LEGACY_SCHEDULED_ACTIONS) {
            const action = actions[name];
            if (!isRecord(action)) continue;
            const prior = saved[name];
            if (!validSavedEntry(prior)) {
                const hadLastFired = Object.prototype.hasOwnProperty.call(action, 'lastFired');
                if (hadLastFired && !isSafeTimestamp(action.lastFired)) continue;
                saved[name] = hadLastFired
                    ? { hadLastFired: true, lastFired: action.lastFired }
                    : { hadLastFired: false };
                markerChanged = true;
            }
            if (Number(action.lastFired) !== SUPPRESSED_LAST_FIRED) {
                action.lastFired = SUPPRESSED_LAST_FIRED;
                changed = true;
            }
        }
        const marker = Object.keys(saved).length ? { schema: 1, actions: saved } : null;
        return { changed, markerChanged, marker };
    }

    if (!hasPrevious) return { changed: false, markerChanged: false, marker: null };
    for (const name of LEGACY_SCHEDULED_ACTIONS) {
        const action = actions[name];
        const prior = saved[name];
        if (!isRecord(action) || !validSavedEntry(prior)
            || Number(action.lastFired) !== SUPPRESSED_LAST_FIRED) continue;
        if (prior.hadLastFired) action.lastFired = prior.lastFired;
        else delete action.lastFired;
        changed = true;
    }
    return { changed, markerChanged: true, marker: null };
}

function browserStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (_) { return null; }
}

function readJson(storage, key) {
    try {
        const raw = storage[key];
        return typeof raw === 'string' && raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

function migrateLegacyAccountActions(storage) {
    if (!storage || storage[ACCOUNT_FLOW_MIGRATION_KEY] === '1') return;
    try {
        const recurringActions = readJson(storage, RECURRING_ACTIONS_KEY);
        if (!recurringActions?.data?.data) return;
        restoreLegacyAccountActions(recurringActions);
        storage[RECURRING_ACTIONS_KEY] = JSON.stringify(recurringActions);
        storage[ACCOUNT_FLOW_MIGRATION_KEY] = '1';
    } catch (error) {
        console.warn('[YTArk] Could not restore YouTube TV account-action scheduling:', error);
    }
}

function syncAutomaticProfilePicker(enabled, storage = browserStorage()) {
    if (!storage) return;
    try {
        const recurringActions = readJson(storage, RECURRING_ACTIONS_KEY);
        if (!recurringActions?.data?.data) return;
        const prior = readJson(storage, SUPPRESSION_STATE_KEY);
        const result = applyAutomaticProfilePickerPolicy(recurringActions, enabled === true, prior);
        if (!result.changed && !result.markerChanged) return;
        if (!enabled && result.markerChanged && result.marker) {
            // Save restoration metadata first. If the following scheduler write
            // fails, the next Off/On transition still has the original values.
            storage[SUPPRESSION_STATE_KEY] = JSON.stringify(result.marker);
        }
        if (result.changed) storage[RECURRING_ACTIONS_KEY] = JSON.stringify(recurringActions);
        if (enabled && result.markerChanged) {
            if (typeof storage.removeItem === 'function') storage.removeItem(SUPPRESSION_STATE_KEY);
            else delete storage[SUPPRESSION_STATE_KEY];
        }
    } catch (error) {
        console.warn('[YTArk] Could not update automatic profile-picker scheduling:', error);
    }
}

const storage = browserStorage();
migrateLegacyAccountActions(storage);
configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail?.key === 'showAutomaticProfilePicker') {
        syncAutomaticProfilePicker(event.detail.value === true, storage);
    }
});
syncAutomaticProfilePicker(configRead('showAutomaticProfilePicker') === true, storage);
