// The installed-version path that About YTArk, the Updates card, What's new and
// the changelog all read (features/appVersion.js + assets/buildInfo.generated.js).
//
// The defect this locks down: `GetVersion()` is an asynchronous bridge call, so
// a synchronous read returned undefined (or a Promise object) and every surface
// reported "Version unknown".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnvironment, tick } from './helpers/ytlr-harness.mjs';

const { windowStub } = setupEnvironment({ version: '2.5.0' });
// Nothing here may reach the network: the version comes from the installed
// package or from this build's packaging metadata.
globalThis.fetch = () => { throw new Error('the installed version must not need the network'); };

const appVersion = await import('../features/appVersion.js');
const { YTARK_BUILD_INFO } = await import('../assets/buildInfo.generated.js');

const {
  readBridgeVersion, normalizePackageVersion, displayVersionOf, installedVersionInfo,
  installedPackageVersion, installedVersionLabel, buildDetails, buildInfo, youtubeFrontendVersion,
  startVersionResolution, onVersionResolved, resetVersionForTests, VERSION_SOURCES,
} = appVersion;

function bridgeReturning(value) {
  return { GetVersion: () => value };
}

describe('reading the installed package version through the bridge', () => {
  it('accepts the callback shape the pinned Cobalt base uses', async () => {
    const native = { GetVersion: callback => { callback('2.5.0'); } };
    assert.equal(await readBridgeVersion(native), '2.5.0');
  });

  it('accepts an asynchronous callback and a returned Promise', async () => {
    const delayed = {
      GetVersion: callback => { setTimeout(() => callback('2.4.0'), 5); },
    };
    assert.equal(await readBridgeVersion(delayed), '2.4.0');
    assert.equal(await readBridgeVersion({ GetVersion: () => Promise.resolve('2.1.2') }), '2.1.2');
    assert.equal(await readBridgeVersion({ GetVersion: () => Promise.reject(new Error('no')) }), '');
  });

  it('accepts a synchronous string, as some bindings answer', async () => {
    assert.equal(await readBridgeVersion(bridgeReturning('2.5.0')), '2.5.0');
    assert.equal(await readBridgeVersion(bridgeReturning('v2.5.0')), '2.5.0');
  });

  it('never mistakes a Cobalt base tag, the YouTube version or a stringified Promise for the package version', async () => {
    // A Promise-returning binding is answered asynchronously, not stringified.
    assert.equal(await readBridgeVersion(bridgeReturning(Promise.resolve('2.5.0'))), '2.5.0');
    // What a synchronous `String(getVersion())` read of that binding produced.
    assert.equal(normalizePackageVersion('[object Promise]'), '');
    assert.equal(normalizePackageVersion(String(Promise.resolve('2.5.0'))), '');
    // The Android base and the YouTube frontend are not the YTArk version.
    assert.equal(normalizePackageVersion('v2.0.2-personal.14'), '');
    assert.equal(normalizePackageVersion('v2.20250101.01.00'), '');
    assert.equal(normalizePackageVersion('2.5'), '');
    assert.equal(normalizePackageVersion(''), '');
    assert.equal(normalizePackageVersion(null), '');
    // Historical YTArk suffixes stay valid.
    assert.equal(normalizePackageVersion('2.1.2-ytark.3'), '2.1.2-ytark.3');
  });

  it('reports nothing when the bridge is missing, throws or stays silent', async () => {
    assert.equal(await readBridgeVersion(null), '');
    assert.equal(await readBridgeVersion({}), '');
    assert.equal(await readBridgeVersion({ GetVersion: () => { throw new Error('boom'); } }), '');
    assert.equal(await readBridgeVersion({ GetVersion: () => {} }, { timeoutMs: 20 }), '');
  });

  it('formats the display version with the patch-zero rule', () => {
    assert.equal(displayVersionOf('2.5.0'), '2.5');
    assert.equal(displayVersionOf('2.1.2'), '2.1.2');
    assert.equal(displayVersionOf('nonsense'), '');
  });
});

describe('the version About YTArk reports', () => {
  it('resolves the installed package version and tells listeners once', async () => {
    resetVersionForTests();
    const seen = [];
    const unsubscribe = onVersionResolved(info => seen.push(info));
    startVersionResolution({ force: true, delays: [0] });
    await tick(20);
    const info = installedVersionInfo();
    assert.equal(info.version, '2.5.0');
    assert.equal(info.display, '2.5');
    assert.equal(info.source, VERSION_SOURCES.package);
    assert.equal(info.loading, false);
    assert.equal(installedPackageVersion(), '2.5.0');
    assert.equal(installedVersionLabel(), '2.5');
    assert.equal(seen.length, 1, 'one notification');
    assert.equal(seen[0].version, '2.5.0');
    unsubscribe();
  });

  it('retries a bridge that binds late, within a bounded schedule', async () => {
    resetVersionForTests();
    let calls = 0;
    windowStub.h5vcc.tizentube.GetVersion = (callback) => {
      calls += 1;
      if (calls < 3) return undefined; // not ready yet
      callback('2.5.0');
      return undefined;
    };
    startVersionResolution({ force: true, delays: [0, 5, 10, 20], readTimeoutMs: 15 });
    await tick(120);
    assert.equal(installedVersionInfo().source, VERSION_SOURCES.package);
    assert.equal(installedVersionInfo().version, '2.5.0');
    assert.equal(calls, 3);
    windowStub.h5vcc.tizentube.GetVersion = () => '2.5.0';
  });

  it('falls back to this build\'s packaging metadata, labelled, when the platform never answers', async () => {
    resetVersionForTests();
    const original = windowStub.h5vcc;
    windowStub.h5vcc = null;
    startVersionResolution({ force: true, delays: [0, 0] });
    await tick(30);
    const info = installedVersionInfo();
    assert.equal(info.source, VERSION_SOURCES.bundle);
    assert.equal(info.version, YTARK_BUILD_INFO.versionName);
    assert.equal(info.display, YTARK_BUILD_INFO.displayVersion);
    assert.equal(info.loading, false, 'a release build never shows a permanent loading state');
    assert.equal(installedVersionLabel(), `${YTARK_BUILD_INFO.displayVersion} (build metadata)`);
    // Bundle metadata must never be passed off as package metadata: the
    // architecture evidence and the update comparison stay conservative.
    assert.equal(installedPackageVersion(), '');
    windowStub.h5vcc = original;
    resetVersionForTests();
    startVersionResolution({ force: true, delays: [0] });
    await tick(20);
  });

  it('embeds the packaging metadata generated from release/version.properties', () => {
    const info = buildInfo();
    assert.equal(info.versionName, YTARK_BUILD_INFO.versionName);
    assert.match(info.versionName, /^\d+\.\d+\.\d+$/);
    assert.match(String(info.versionCode), /^\d+$/);
    assert.match(info.scriptTag, /^s\d+$/);
    assert.match(info.baseTag, /^v\d+\.\d+\.\d+/);
    assert.equal(info.appId, 'io.github.twoarchiver.ytark');
    const details = buildDetails();
    for (const needle of [`versionName ${info.versionName}`, `versionCode ${info.versionCode}`,
      `userscript ${info.scriptTag}`, info.baseTag]) {
      assert.ok(details.includes(needle), `build details mention ${needle}`);
    }
    // No hardcoded label: the display version follows the packaged one.
    assert.equal(displayVersionOf(info.versionName), info.displayVersion);
  });
});

describe('the YouTube frontend version, kept separate from the YTArk version', () => {
  it('is reported only when the running frontend publishes a recognizable one', () => {
    assert.equal(youtubeFrontendVersion(), '');
    windowStub.yt = { config_: { INNERTUBE_CONTEXT: { clientInformation: { clientVersion: 'v2.20250101.01.00' } } } };
    assert.equal(youtubeFrontendVersion(), 'v2.20250101.01.00');
    windowStub.yt = { config_: { INNERTUBE_CONTEXT: { client: { clientVersion: '2.20261013.01.00' } } } };
    assert.equal(youtubeFrontendVersion(), '2.20261013.01.00');
    windowStub.yt = { config_: { INNERTUBE_CLIENT_VERSION: '2.20250101' } };
    assert.equal(youtubeFrontendVersion(), '2.20250101');
    windowStub.yt = { config_: { INNERTUBE_CLIENT_VERSION: 'not-a-version' } };
    assert.equal(youtubeFrontendVersion(), '', 'an odd value is not reported');
    windowStub.yt = { config_: { INNERTUBE_CLIENT_VERSION: '2.5.0' } };
    assert.equal(youtubeFrontendVersion(), '', 'a YTArk-shaped string is not a frontend version');
    delete windowStub.yt;
  });
});
