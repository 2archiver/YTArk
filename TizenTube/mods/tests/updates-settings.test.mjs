// Fixture-driven tests for the YTArk Settings -> Updates surface.
// They prove the card is wired to a real check, that failures are reported as
// failures (never as "up to date"), that progress is only shown when the
// engine reports real bytes, and that commands only reach the native bridge
// when it is actually connected.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  FakeMutationObserver,
  createDocument,
  createLocalStorage,
  createWindowStub,
  installGlobals,
} from './helpers/fake-dom.mjs';

const localStorage = createLocalStorage();
const doc = createDocument();
const windowStub = createWindowStub({ localStorage, doc });
installGlobals({ doc, windowStub, localStorage });

const { createUpdateController } = await import('../features/updater.js');
const { parseNativeState } = await import('../features/updateState.js');

// YTArk publishes ARMv7-only releases from 2.1.2 onwards.
const ARMV7_ASSET = 'YTArk-v2.1.2-armv7.apk';
const ARMV7_URL = `https://github.com/2archiver/YTArk/releases/download/v2.1.2/${ARMV7_ASSET}`;
const LEGACY_ARM64_ASSET = 'YTArk-v2.1.1-arm64.apk';
const LEGACY_ARM64_URL =
  `https://github.com/2archiver/YTArk/releases/download/v2.1.1/${LEGACY_ARM64_ASSET}`;

function releasePayload(overrides = {}) {
  return {
    tag_name: 'v2.1.2',
    draft: false,
    prerelease: false,
    body: 'YTArk 2.1.2\n\n- Vector Premium wordmark\n\nAndroid versionCode: 2010200\n',
    assets: [{
      name: ARMV7_ASSET,
      size: 97195140,
      browser_download_url: ARMV7_URL,
      digest: `sha256:${'ab'.repeat(32)}`,
    }],
    ...overrides,
  };
}

function recordingUi() {
  const modals = [];
  const toasts = [];
  return {
    modals,
    toasts,
    showModal: (header, content, id, update) => modals.push({ header, content, id, update }),
    showToast: (title, subtitle) => toasts.push({ title, subtitle }),
    buttonItem: (title, icon, commands) => ({ title, icon, commands }),
    overlayPanelItemListRenderer: (items, selectedIndex) => ({ items, selectedIndex }),
    overlayMessageRenderer: (text) => ({ text }),
  };
}

function flatText(modal) {
  return JSON.stringify({ header: modal.header, content: modal.content });
}

function actionIds(modal) {
  return modal.content.items
    .filter(item => item.commands)
    .map(item => item.commands[0].customAction)
    .filter(custom => custom && custom.action === 'YTARK_UPDATE_COMMAND')
    .map(custom => custom.parameters);
}

function makeController(options = {}) {
  const ui = recordingUi();
  const commands = [];
  const bridge = options.bridge === undefined ? null : options.bridge;
  const controller = createUpdateController({
    ui,
    bridge,
    installedVersion: options.installedVersion || (() => '2.1.0'),
    architecture: options.architecture || (() => 'armeabi-v7a'),
    // `network: true` exercises the real default fetch path instead of a fixture.
    fetchRelease: options.network ? undefined : (options.fetchRelease || (async () => releasePayload())),
    checkTimeoutMs: options.checkTimeoutMs,
    now: options.now || (() => Date.now()),
  });
  return { controller, ui, commands };
}

function fakeBridge(state, log = []) {
  return {
    getState: () => JSON.stringify(state),
    command: (request) => {
      log.push(JSON.parse(request));
      return JSON.stringify({ ok: true });
    },
  };
}

beforeEach(() => {
  FakeMutationObserver.reset();
});

describe('YTArk Updates card with the native engine connected', () => {
  it('renders the engine state, the real installed version and the available release', async () => {
    const log = [];
    const { controller, ui } = makeController({
      bridge: fakeBridge({
        contract: 1,
        state: 'available',
        installed: { version: '2.1.0', code: 2010000 },
        available: { version: '2.1.1', display: '2.1.1', abi: 'arm64-v8a', size: 168316114, notes: 'Fixes the wordmark' },
        lastSuccessAt: Date.parse('2026-10-11T02:00:00Z'),
      }, log),
    });
    controller.open();
    const modal = ui.modals.at(-1);
    assert.equal(modal.id, 'ytark-updates');
    assert.equal(modal.update, true, 'the modal updates in place instead of stacking');
    const text = flatText(modal);
    assert.match(text, /Installed version: 2\.1/);
    assert.match(text, /Available stable version: 2\.1\.1/);
    assert.match(text, /Android versionCode: 2010000/);
    assert.match(text, /Download size: 160\.5 MB/);
    assert.match(text, /Last successful check:/);
    assert.match(text, /Fixes the wordmark/);
    assert.deepEqual(actionIds(modal), ['check', 'download', 'skip', 'later', 'open']);

    controller.handleAction('download');
    assert.deepEqual(log, [{ contract: 1, command: 'download' }]);
    controller.handleAction('install');
    assert.deepEqual(log.at(-1), { contract: 1, command: 'install' });
    controller.handleAction('open');
    assert.deepEqual(log.at(-1), { contract: 1, command: 'open' });
    controller.dispose();
  });

  it('keeps a failed native read visible instead of showing a blank card', () => {
    const { controller, ui } = makeController({
      bridge: { getState: () => 'not json', command: () => '{"ok":true}' },
    });
    controller.open();
    const text = flatText(ui.modals.at(-1));
    assert.match(text, /native update engine did not report a readable state/i);
    assert.doesNotMatch(text, /latest published stable/i);
    controller.dispose();
  });

  it('reports the last successful check and progress without inventing numbers', () => {
    const { controller, ui } = makeController({
      bridge: fakeBridge({
        contract: 1,
        state: 'downloading',
        installed: { version: '2.1.0', code: 2010000 },
        available: { version: '2.1.1', display: '2.1.1', abi: 'arm64-v8a', size: 168316114 },
        lastSuccessAt: 1_700_000_000_000,
        download: { active: true, received: 41_943_040, total: 0 },
      }),
    });
    controller.open();
    const text = flatText(ui.modals.at(-1));
    assert.match(text, /Downloading YTArk update… 40\.0 MB/);
    assert.doesNotMatch(text, /%/);
    assert.match(text, /Progress: 40\.0 MB/);
    assert.deepEqual(actionIds(ui.modals.at(-1)), ['cancel']);
    controller.dispose();
  });

  it('polls the engine while busy and stops on dispose', async () => {
    const { controller } = makeController({
      bridge: fakeBridge({
        contract: 1,
        state: 'verifying',
        installed: { version: '2.1.0' },
        available: { version: '2.1.1', display: '2.1.1', abi: 'arm64-v8a', size: 1 },
      }),
    });
    controller.open();
    assert.notEqual(controller.state.pollTimer, null, 'a busy engine is polled');
    controller.dispose();
    assert.equal(controller.state.pollTimer, null, 'dispose releases the poll timer');
  });
});

describe('YTArk Updates card without a connected native engine', () => {
  it('performs a real read-only check and shows the manual install fallback', async () => {
    const { controller, ui } = makeController({});
    await controller.open();
    const modal = ui.modals.at(-1);
    const text = flatText(modal);
    assert.equal(modal.header.title, 'YTArk Updates');
    assert.match(text, /Latest stable: 2\.1\.2 \(armeabi-v7a\)/);
    assert.match(text, /Status: Update available/);
    assert.match(text, /Check here, then download the ARMv7 APK from the official page\./);
    assert.match(text, /Official page: https:\/\/github\.com\/2archiver\/YTArk\/releases\/tag\/v2\.1\.2/);
    assert.match(text, /Release notes/);
    assert.match(text, /Vector Premium wordmark/);
    assert.doesNotMatch(text, /Reload the app|reconnect|Open YTArk Updates screen/i,
      'no reconnect or native-screen promise in this build');
    // Only a real check and a real close are offered; no download or install.
    assert.deepEqual(actionIds(modal), ['check']);
    const closes = modal.content.items.filter(item => item.commands
      && item.commands[0].signalAction && item.commands[0].signalAction.signal === 'POPUP_BACK');
    assert.equal(closes.length, 1, 'a Close action dismisses the modal');

    // Without the native engine a download request must not pretend to start.
    await controller.handleAction('download');
    assert.match(ui.toasts.at(-1).subtitle, /native YTArk updater/);
    assert.deepEqual(actionIds(ui.modals.at(-1)), ['check'], 'still no download control');

    const qrItem = ui.modals.at(-1).content.items.find(item => item.qrCodeRenderer);
    assert.ok(qrItem, 'a QR code item is rendered in the fallback');
    assert.match(qrItem.qrCodeRenderer.qrCodeImage.thumbnails[0].url, /^data:image\//,
      'the QR code is a real image generated from the official page');
    controller.dispose();
  });

  it('points the open request at the official releases page, with no native-screen claim', async () => {
    const { controller, ui } = makeController({});
    await controller.open();
    await controller.handleAction('open');
    assert.equal(ui.toasts.at(-1).subtitle, 'Official page: https://github.com/2archiver/YTArk/releases/latest');
    controller.dispose();
  });

  it('suppresses an overlapping check while one is already running', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { controller } = makeController({
      fetchRelease: async () => { calls += 1; await gate; return releasePayload(); },
    });
    const first = controller.runFallbackCheck();
    const second = controller.runFallbackCheck();
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 1, 'only one release request is made');
    controller.dispose();
  });

  it('settles a hung release request at the deadline and reports it as a failed check', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => new Promise(() => {});
    try {
      const { controller, ui } = makeController({ checkTimeoutMs: 30, network: true });
      const started = Date.now();
      await controller.runFallbackCheck();
      assert.ok(Date.now() - started < 2000, 'the check gives up promptly');
      assert.equal(controller.state.model.state, 'check_error');
      assert.match(flatText(ui.modals.at(-1)), /timed out/);
      assert.doesNotMatch(flatText(ui.modals.at(-1)), /up to date/i);
      controller.dispose();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('refuses an oversized release body instead of parsing it', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => 'x'.repeat(600 * 1024),
    });
    try {
      const { controller, ui } = makeController({ network: true });
      await controller.runFallbackCheck();
      assert.equal(controller.state.model.state, 'check_error');
      assert.match(flatText(ui.modals.at(-1)), /larger than expected/);
      controller.dispose();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('reports a malformed release as a check error, never as up to date', async () => {
    const { controller, ui } = makeController({
      fetchRelease: async () => releasePayload({ body: 'Notes without a version code' }),
    });
    await controller.open();
    assert.equal(controller.state.model.state, 'check_error');
    const text = flatText(ui.modals.at(-1));
    assert.match(text, /do not confirm the expected Android versionCode/);
    assert.doesNotMatch(text, /latest published stable/i);
    assert.match(ui.toasts.at(-1).subtitle, /versionCode/);
    controller.dispose();
  });

  it('refuses drafts and prereleases', async () => {
    for (const override of [{ draft: true }, { prerelease: true }, { tag_name: 'v2.1.1-rc1' }]) {
      const { controller, ui } = makeController({ fetchRelease: async () => releasePayload(override) });
      await controller.open();
      assert.equal(controller.state.model.state, 'check_error');
      assert.match(flatText(ui.modals.at(-1)), /not a published stable release|not a clean stable version/);
      controller.dispose();
    }
  });

  it('selects the asset for the reported ABI and refuses unsupported ones', async () => {
    const { controller, ui } = makeController({
      architecture: () => 'armeabi-v7a',
      fetchRelease: async () => releasePayload({
        assets: [
          // A legacy ARM64 asset must never be selected, even when published.
          { name: LEGACY_ARM64_ASSET, size: 2, browser_download_url: LEGACY_ARM64_URL },
          { name: ARMV7_ASSET, size: 97_195_140, browser_download_url: ARMV7_URL },
        ],
      }),
    });
    await controller.open();
    assert.match(flatText(ui.modals.at(-1)), /2\.1\.2 \(armeabi-v7a\)/);
    controller.dispose();

    const unsupported = makeController({
      architecture: () => 'x86_64',
      fetchRelease: async () => releasePayload(),
    });
    await unsupported.controller.open();
    assert.equal(unsupported.controller.state.model.state, 'check_error');
    assert.match(flatText(unsupported.ui.modals.at(-1)), /instead of armeabi-v7a/);
    assert.match(flatText(unsupported.ui.modals.at(-1)), /ro\.product\.cpu\.abilist/);
    unsupported.controller.dispose();
  });

  it('reports network, rate-limit and timeout failures honestly and keeps the last success', async () => {
    const errors = [
      [new Error('Network unavailable'), /Network unavailable/],
      [Object.assign(new Error('GitHub is rate-limiting update checks. Try again after 60 seconds.'), { kind: 'rate-limited' }), /rate-limiting/],
      [Object.assign(new Error('aborted'), { name: 'AbortError' }), /timed out/],
    ];
    let call = 0;
    const { controller, ui } = makeController({
      fetchRelease: async () => {
        call += 1;
        if (call === 1) return releasePayload();
        throw errors[call - 2][0];
      },
    });
    await controller.open();
    const firstSuccess = controller.state.lastSuccessAt;
    assert.ok(firstSuccess > 0);
    for (const [, pattern] of errors) {
      await controller.handleAction('check');
      assert.equal(controller.state.model.state, 'check_error');
      assert.match(controller.state.model.error, pattern);
      assert.equal(controller.state.lastSuccessAt, firstSuccess, 'a failed check must not overwrite the last success');
      assert.doesNotMatch(flatText(ui.modals.at(-1)), /latest published stable/i);
    }
    await controller.handleAction('skip');
    controller.dispose();
  });

  it('never fetches anything except the official stable release endpoint', async () => {
    const urls = [];
    const globalFetch = async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => releasePayload(), headers: { get: () => null } };
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = globalFetch;
    try {
      const { controller } = makeController({
        fetchRelease: undefined,
      });
      // createUpdateController was given an explicit fetchRelease above only for
      // fixtures; build a second controller that exercises the real default.
      const real = createUpdateController({
        ui: recordingUi(),
        bridge: null,
        installedVersion: () => '2.1.0',
        architecture: () => 'arm64-v8a',
      });
      await real.open();
      assert.deepEqual(urls, ['https://api.github.com/repos/2archiver/YTArk/releases/latest']);
      real.dispose();
      controller.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('state model hand-off', () => {
  it('marks an already current install as current, not as an update', async () => {
    const { controller, ui } = makeController({
      installedVersion: () => '2.1.2',
      fetchRelease: async () => releasePayload(),
    });
    await controller.open();
    assert.equal(controller.state.model.state, 'current');
    assert.match(flatText(ui.modals.at(-1)), /Status: Up to date/);
    assert.deepEqual(actionIds(ui.modals.at(-1)), ['check']);
    controller.dispose();
  });

  it('shows the historical installed version in its clean display form', async () => {
    const { controller, ui } = makeController({
      installedVersion: () => '2.0.4-ytark.17',
      fetchRelease: async () => releasePayload(),
    });
    await controller.open();
    assert.match(flatText(ui.modals.at(-1)), /Installed: 2\.0\.4/);
    assert.equal(controller.state.fallback.newer, true);
    controller.dispose();
  });

  it('exposes the parsed engine snapshot for the settings surface', () => {
    const snapshot = parseNativeState(JSON.stringify({
      contract: 1,
      state: 'ready_to_install',
      installed: { version: '2.1.0' },
      available: { version: '2.1.1' },
      verified: true,
      lastSuccessAt: 1,
    }));
    assert.equal(snapshot.state, 'ready_to_install');
    assert.equal(snapshot.verified, true);
  });
});
