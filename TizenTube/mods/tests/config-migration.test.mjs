// Settings schema migration, malformed-value repair, reload persistence and
// storage-failure handling for TizenTube/mods/config.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { propertyStorage } from './helpers/ytlr-harness.mjs';

const CONFIG_KEY = 'ytaf-configuration';
let instance = 0;

/** Load a fresh config.js instance over the given storage (a "restart"). */
async function loadConfig(storage) {
  globalThis.window = { localStorage: storage, h5vcc: { tizentube: {} } };
  instance += 1;
  return import(`../config.js?instance=${instance}`);
}

function stored(storage) {
  return JSON.parse(storage[CONFIG_KEY]);
}

describe('fresh installation defaults', () => {
  it('uses both player cleanup options, no theme preference, and persists the schema marker at once', async () => {
    const storage = propertyStorage();
    const config = await loadConfig(storage);
    // 3.0 retired the theme choice entirely: the key is not a setting any
    // more, so a fresh install carries no value for it at all.
    assert.equal(config.configKeys().includes('uiTheme'), false, 'the theme key is gone');
    assert.equal(config.configRead('uiTheme'), undefined);
    assert.equal(config.configRead('hidePlayerWatermark'), true);
    assert.equal(config.configRead('removePlayerScrim'), true);
    assert.equal(config.configRead('fasterStartup'), false, 'the experimental faster start begins off');
    assert.equal(config.configRead('recordBrowserDiagnostics'), false, 'browser diagnostics are default-off on a fresh install');
    assert.equal(config.getConfigMeta().freshInstall, true);
    assert.equal(config.configRead('lastSeenVersion'), '');
    // Persisted immediately: on the next launch YouTube's own storage exists,
    // and the marker keeps this install from being mistaken for an upgrade.
    assert.equal(stored(storage).configSchemaVersion, config.CONFIG_SCHEMA_VERSION);

    storage['yt.leanback.default::recurring_actions'] = '{}';
    const restarted = await loadConfig(storage);
    assert.equal(restarted.configRead('hidePlayerWatermark'), true, 'the fresh-install defaults survive a restart');
    assert.equal(restarted.configRead('fasterStartup'), false);
    assert.equal(restarted.getConfigMeta().freshInstall, false);
    assert.equal(restarted.getConfigMeta().migratedFrom, null);
  });
});

describe('upgrade from YTArk 2.2 or earlier', () => {
  it('keeps the existing appearance, marks the migration once and preserves every stored choice', async () => {
    const storage = propertyStorage({
      [CONFIG_KEY]: JSON.stringify({
        enableAdBlock: false,
        enableSponsorBlock: true,
        focusContainerColor: '#0a1628',
        routeColor: '#0d1f3c',
        sidebarContentsOrder: ['FEwhat_to_watch', { browseId: 'UC123', title: 'Channel' }],
        preferredVideoQuality: '1080p',
        recordBrowserDiagnostics: true,
      }),
    });
    const config = await loadConfig(storage);
    assert.equal(config.configRead('hidePlayerWatermark'), false);
    assert.equal(config.configRead('removePlayerScrim'), false);
    assert.equal(config.configRead('lastSeenVersion'), config.LEGACY_VERSION_MARKER);
    assert.equal(config.getConfigMeta().migratedFrom, 1);
    assert.equal(config.configRead('enableAdBlock'), false, 'an explicit opt-out is preserved');
    assert.equal(config.configRead('focusContainerColor'), '#0a1628');
    assert.deepEqual(config.configRead('sidebarContentsOrder'), ['FEwhat_to_watch', { browseId: 'UC123', title: 'Channel' }]);
    assert.equal(config.configRead('preferredVideoQuality'), '1080p');
    assert.equal(config.configRead('recordBrowserDiagnostics'), true, 'an explicit diagnostics opt-in survives upgrade migration');
    assert.equal(stored(storage).configSchemaVersion, config.CONFIG_SCHEMA_VERSION);

    // The user opts in later; the explicit choice wins on every restart.
    config.configWrite('hidePlayerWatermark', true);
    const restarted = await loadConfig(storage);
    assert.equal(restarted.configRead('hidePlayerWatermark'), true);
    assert.equal(restarted.configRead('removePlayerScrim'), false);
    assert.equal(restarted.getConfigMeta().migratedFrom, null, 'the migration ran exactly once');
  });

  it('treats an install with YouTube TV history but no YTArk settings as an upgrade', async () => {
    const storage = propertyStorage({ 'yt.leanback.default::recurring_actions': '{"data":{}}' });
    const config = await loadConfig(storage);
    assert.equal(config.configRead('hidePlayerWatermark'), false, 'the kept-old-appearance default applies');
    assert.equal(config.getConfigMeta().freshInstall, false);
    assert.equal(storage['yt.leanback.default::recurring_actions'], '{"data":{}}', 'YouTube storage is only checked, never changed');
  });

  it('copies a stored legacy codec preference to the key the player reads', async () => {
    const storage = propertyStorage({ [CONFIG_KEY]: JSON.stringify({ videoPreferredCodec: 'vp9' }) });
    const config = await loadConfig(storage);
    assert.equal(config.configRead('preferredVideoCodec'), 'vp9');
  });
});

describe('malformed saved settings', () => {
  it('repairs wrong types instead of breaking features', async () => {
    const storage = propertyStorage({
      [CONFIG_KEY]: JSON.stringify({
        configSchemaVersion: 2,
        // a stored theme choice: 3.0 retires the key outright, so the value
        // is dropped at migration instead of being repaired or kept
        uiTheme: 'purple',
        enableAdBlock: 'false',
        dimmingTimeout: '30',
        dimmingOpacity: 'very dark',
        sponsorBlockManualSkips: 'intro',
        launchToOnStartup: '{not json',
        ytSettingsLayout: { order: ['A', 4, 'A', null], hidden: 'B' },
        sidebarContentsOrder: ['FEhome', 12, { title: 'no id' }, { browseId: 'UC1' }],
        hidePlayerWatermark: 1,
      }),
    });
    const config = await loadConfig(storage);
    assert.equal(config.configRead('uiTheme'), undefined, 'the retired theme value is gone');
    assert.equal(config.configRead('enableAdBlock'), false);
    assert.equal(config.configRead('dimmingTimeout'), 30);
    assert.equal(config.configRead('dimmingOpacity'), 0.5);
    assert.deepEqual(config.configRead('sponsorBlockManualSkips'), ['intro', 'outro', 'filler']);
    assert.equal(config.configRead('launchToOnStartup'), null);
    assert.deepEqual(config.configRead('ytSettingsLayout'), { order: ['A'], hidden: [], pinned: [], hiddenRows: [] });
    assert.deepEqual(config.configRead('sidebarContentsOrder'), ['FEhome', { browseId: 'UC1' }]);
    assert.equal(config.configRead('hidePlayerWatermark'), true);
    assert.ok(config.getConfigMeta().repaired.includes('launchToOnStartup'));
  });

  it('survives a non-object or unparseable stored value', async () => {
    for (const raw of ['[1,2,3]', '{broken', '"text"']) {
      const storage = propertyStorage({ [CONFIG_KEY]: raw });
      const config = await loadConfig(storage);
      assert.equal(config.configRead('enableAdBlock'), true);
      // A corrupt value still proves the app ran before: keep the old look.
      assert.equal(config.configRead('hidePlayerWatermark'), false, raw);
    }
  });

  it('normalizes values with pure helpers that tests and tools can call directly', async () => {
    const config = await loadConfig(propertyStorage());
    assert.equal(config.normalizeValue('enableShorts', 'true'), true);
    assert.equal(config.normalizeValue('hideWatchedVideosThreshold', '70'), 70);
    assert.equal(config.normalizeValue('preferredVideoQuality', 1080), 'auto');
    assert.equal(config.normalizeValue('launchToOnStartup', '{"browseEndpoint":{"browseId":"FEtopics"}}'),
      '{"browseEndpoint":{"browseId":"FEtopics"}}');
    const migrated = config.migrateConfig(null, { hasLeanbackHistory: false });
    assert.equal(migrated.freshInstall, true);
    assert.equal(migrated.config.fasterStartup, false);
    const future = config.migrateConfig({ configSchemaVersion: 99, uiTheme: 'youtube' }, {});
    assert.equal(future.config.configSchemaVersion, 99, 'a newer schema marker is never downgraded');
    assert.equal(future.config.uiTheme, 'youtube', 'a newer schema is left untouched, key included');
  });
});

describe('browser diagnostics migration', () => {
  it('adds a missing opt-in as false and never overrides an explicit choice', async () => {
    const missing = await loadConfig(propertyStorage({ [CONFIG_KEY]: JSON.stringify({ configSchemaVersion: 5, enableAdBlock: false }) }));
    assert.equal(missing.configRead('recordBrowserDiagnostics'), false);
    assert.equal(missing.configRead('enableAdBlock'), false);
    assert.equal(missing.configRead('configSchemaVersion'), 6);

    const optedIn = await loadConfig(propertyStorage({ [CONFIG_KEY]: JSON.stringify({ configSchemaVersion: 5, recordBrowserDiagnostics: true }) }));
    assert.equal(optedIn.configRead('recordBrowserDiagnostics'), true);
    const optedOut = await loadConfig(propertyStorage({ [CONFIG_KEY]: JSON.stringify({ configSchemaVersion: 5, recordBrowserDiagnostics: false }) }));
    assert.equal(optedOut.configRead('recordBrowserDiagnostics'), false);
  });
});

describe('upgrade from YTArk 2.4: removed preferences are retired, nothing else moves', () => {
  it('drops the retired keys, keeps every retained choice and reports what it retired', async () => {
    const storage = propertyStorage({
      [CONFIG_KEY]: JSON.stringify({
        configSchemaVersion: 2,
        // what a 2.4 install could have chosen
        userAgentProfile: 'androidTv32',
        enableFixedUI: true,
        tvActivePreset: 'cleanTV',
        tvLastPresetSnapshot: JSON.stringify({ presetKey: 'cleanTV', snapshot: { enableShorts: true } }),
        tvQuickQuality: '1080',
        videoPreferredCodec: 'vp9',
        // and what those choices had already applied
        enableShorts: false,
        enablePreviews: false,
        enableHideEndScreenCards: true,
        hideRelatedVideosPlayer: true,
        preferredVideoQuality: '1080p',
        focusContainerColor: '#0a1628',
        routeColor: '#0d1f3c',
        uiTheme: 'oled',
        enableAdBlock: false,
        enablePremiumLogo: true,
      }),
    });
    const config = await loadConfig(storage);
    const meta = config.getConfigMeta();
    assert.equal(meta.migratedFrom, 2);
    assert.deepEqual(meta.retired.slice().sort(), [
      'enableFixedUI', 'tvActivePreset', 'tvLastPresetSnapshot', 'tvQuickQuality',
      'uiTheme', 'userAgentProfile', 'videoPreferredCodec',
    ]);
    // The removed user-agent override is reported once, so the retirement
    // migration in features/userAgentRetirement.js can restore the platform UA.
    assert.equal(meta.retiredValues.userAgentProfile, 'androidTv32');
    assert.equal(meta.retiredValues.uiTheme, 'oled', 'the retired theme value is reported once');

    const persisted = stored(storage);
    for (const key of ['userAgentProfile', 'enableFixedUI', 'tvActivePreset', 'tvLastPresetSnapshot',
      'tvQuickQuality', 'videoPreferredCodec', 'uiTheme']) {
      assert.equal(Object.prototype.hasOwnProperty.call(persisted, key), false, `${key} is gone from storage`);
    }
    assert.equal(persisted.configSchemaVersion, config.CONFIG_SCHEMA_VERSION);

    // An applied preset is not rolled back: the individual settings stay as
    // the user left them, and so does every unrelated preference.
    assert.equal(config.configRead('enableShorts'), false, 'no rollback of an applied configuration');
    assert.equal(config.configRead('enablePreviews'), false);
    assert.equal(config.configRead('enableHideEndScreenCards'), true);
    assert.equal(config.configRead('hideRelatedVideosPlayer'), true);
    assert.equal(config.configRead('preferredVideoQuality'), '1080p');
    assert.equal(config.configRead('focusContainerColor'), '#0a1628');
    assert.equal(config.configRead('routeColor'), '#0d1f3c');
    assert.equal(config.configRead('uiTheme'), undefined, 'the OLED choice is retired with its value');
    assert.equal(config.configRead('enableAdBlock'), false);
    assert.equal(config.configRead('enablePremiumLogo'), true);
    // The legacy codec value survives under the key the player reads.
    assert.equal(config.configRead('preferredVideoCodec'), 'vp9');

    const restarted = await loadConfig(storage);
    assert.equal(restarted.getConfigMeta().migratedFrom, null, 'the migration ran exactly once');
    assert.deepEqual(restarted.getConfigMeta().retired, []);
    assert.equal(restarted.configRead('enableShorts'), false);
  });

  it('retires nothing on a fresh install and never resurrects a removed key', async () => {
    const storage = propertyStorage();
    const config = await loadConfig(storage);
    assert.deepEqual(config.getConfigMeta().retired, []);
    for (const key of ['userAgentProfile', 'enableFixedUI', 'tvActivePreset', 'tvLastPresetSnapshot',
      'tvQuickQuality', 'videoPreferredCodec', 'uiTheme']) {
      assert.equal(config.configKeys().includes(key), false, `${key} is not a setting any more`);
      assert.equal(Object.prototype.hasOwnProperty.call(stored(storage), key), false, key);
    }
  });
});

describe('writes, resets and storage failure', () => {
  it('keeps working in memory when storage fails and reports it once per session', async () => {
    const storage = propertyStorage();
    const config = await loadConfig(storage);
    const failures = [];
    config.configChangeEmitter.addEventListener('configPersistError', event => failures.push(event.detail));
    Object.defineProperty(storage, CONFIG_KEY, {
      configurable: true,
      get() { return '{}'; },
      set() { throw new Error('QuotaExceededError'); },
    });
    assert.doesNotThrow(() => config.configWrite('enableClock', true));
    assert.doesNotThrow(() => config.configWrite('enableClock', false));
    config.configWriteMany({ enableSigninReminder: true, removePlayerScrim: false });
    assert.equal(config.configRead('enableSigninReminder'), true);
    assert.equal(config.lastPersistSucceeded(), false);
    assert.equal(failures.length, 1, 'one notice per session, no toast spam');
  });

  it('writes several keys with one storage write and notifies each key', async () => {
    const storage = propertyStorage();
    const config = await loadConfig(storage);
    let writes = 0;
    let value = storage[CONFIG_KEY];
    Object.defineProperty(storage, CONFIG_KEY, {
      configurable: true,
      get() { return value; },
      set(next) { writes += 1; value = next; },
    });
    const keys = [];
    const listener = event => keys.push(event.detail.key);
    config.configChangeEmitter.addEventListener('configChange', listener);
    config.configWriteMany({ enableSigninReminder: true, hidePlayerWatermark: false, removePlayerScrim: false });
    config.configChangeEmitter.removeEventListener('configChange', listener);
    assert.equal(writes, 1);
    assert.deepEqual(keys, ['enableSigninReminder', 'hidePlayerWatermark', 'removePlayerScrim']);
  });

  it('resets only the requested YTArk keys and never other storage', async () => {
    const storage = propertyStorage({
      [CONFIG_KEY]: JSON.stringify({ configSchemaVersion: 2, enableSponsorBlock: false, enableAdBlock: false }),
      'yt.leanback.default::recurring_actions': 'kept',
      'yt.leanback.default::identity': 'account-data-kept',
    });
    const config = await loadConfig(storage);
    const reset = config.resetConfigKeys(['enableSponsorBlock', 'notARealKey']);
    assert.deepEqual(reset, ['enableSponsorBlock']);
    assert.equal(config.configRead('enableSponsorBlock'), true);
    assert.equal(config.configRead('enableAdBlock'), false, 'unrelated YTArk settings stay');
    assert.equal(storage['yt.leanback.default::identity'], 'account-data-kept');
    assert.equal(storage['yt.leanback.default::recurring_actions'], 'kept');
  });

  it('never shares default arrays with live settings', async () => {
    const config = await loadConfig(propertyStorage());
    const live = config.configRead('sponsorBlockManualSkips');
    live.push('sponsor');
    assert.deepEqual(config.configDefault('sponsorBlockManualSkips'), ['intro', 'outro', 'filler']);
  });
});
