// Synthetic-fixture tests for the YTArk update state contract.
// These exercise the pure decision logic: versionCode mapping, release
// validation (draft/prerelease/asset/ABI/identity), bridge payload parsing,
// command validation and the state -> action/status tables.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  actionsForState,
  buildCommand,
  cleanNotes,
  displayVersion,
  describeState,
  formatBytes,
  isNewerVersion,
  numericVersionKey,
  parseNativeState,
  validateReleasePayload,
  versionCodeForVersion,
} from '../features/updateState.js';

const ARM64_ASSET = 'YTArk-v2.1.1-arm64.apk';
const ARM64_URL = `https://github.com/2archiver/YTArk/releases/download/v2.1.1/${ARM64_ASSET}`;

function releaseFixture(overrides = {}) {
  return {
    tag_name: 'v2.1.1',
    draft: false,
    prerelease: false,
    body: 'YTArk 2.1.1\n\n- Premium wordmark fix\n\nAndroid versionCode: 2010100\n',
    assets: [
      {
        name: ARM64_ASSET,
        size: 168316114,
        browser_download_url: ARM64_URL,
        digest: `sha256:${'ab'.repeat(32)}`,
      },
    ],
    ...overrides,
  };
}

describe('versionCode mapping', () => {
  test('maps semantic versions to the Android versionCode scheme', () => {
    assert.equal(versionCodeForVersion('2.1.1'), 2010100);
    assert.equal(versionCodeForVersion('2.1.0'), 2010000);
    assert.equal(versionCodeForVersion('2.0.4'), 2000400);
    assert.equal(versionCodeForVersion('3.0.0'), 3000000);
  });

  test('refuses versions outside the supported mapping', () => {
    assert.equal(versionCodeForVersion('2.1'), null);
    assert.equal(versionCodeForVersion('2.1.1-ytark.18'), null);
    assert.equal(versionCodeForVersion('0.1.0'), null);
    assert.equal(versionCodeForVersion('2.100.0'), null);
    assert.equal(versionCodeForVersion(''), null);
    assert.equal(versionCodeForVersion(undefined), null);
  });

  test('renders display versions the way the app names releases', () => {
    assert.equal(displayVersion('2.1.0'), '2.1');
    assert.equal(displayVersion('2.1.1'), '2.1.1');
    assert.equal(displayVersion('2.0.4-ytark.17'), '2.0.4');
    assert.equal(displayVersion('2.0.2-personal.14'), '2.0.2');
    assert.equal(displayVersion('unknown'), 'unknown');
  });
});

describe('version ordering', () => {
  test('treats newer patch/minor/major releases as updates', () => {
    assert.equal(isNewerVersion('2.1.1', '2.1.0'), true);
    assert.equal(isNewerVersion('2.2.0', '2.1.9'), true);
    assert.equal(isNewerVersion('3.0.0', '2.9.9'), true);
  });

  test('never offers a downgrade, equal version or unparsable candidate', () => {
    assert.equal(isNewerVersion('2.1.0', '2.1.0'), false);
    assert.equal(isNewerVersion('2.0.4', '2.1.0'), false);
    assert.equal(isNewerVersion('nonsense', '2.1.0'), false);
  });

  test('orders the historical -ytark.N builds below their clean release', () => {
    assert.equal(isNewerVersion('2.1.0', '2.0.4-ytark.17'), true);
    assert.equal(isNewerVersion('2.0.4-ytark.17', '2.1.0'), false);
    assert.deepEqual(numericVersionKey('2.0.4-ytark.17'), [2, 0, 4, 0]);
    assert.deepEqual(numericVersionKey('2.0.4'), [2, 0, 4, 1]);
  });
});

describe('stable release validation', () => {
  const context = { installedVersion: '2.1.0', architecture: 'arm64-v8a' };

  test('accepts a matching published stable release for the device ABI', () => {
    const { release, error } = validateReleasePayload(releaseFixture(), context);
    assert.equal(error, undefined);
    assert.equal(release.version, '2.1.1');
    assert.equal(release.display, '2.1.1');
    assert.equal(release.versionCode, 2010100);
    assert.equal(release.assetName, ARM64_ASSET);
    assert.equal(release.abi, 'arm64-v8a');
    assert.equal(release.newer, true);
    assert.equal(release.sha256Published, 'ab'.repeat(32));
    assert.match(release.notes, /Premium wordmark fix/);
    assert.doesNotMatch(release.notes, /versionCode/i);
  });

  test('selects the armv7 asset on 32-bit devices and never mixes them up', () => {
    const fixture = releaseFixture({
      assets: [
        {
          name: ARM64_ASSET,
          size: 1,
          browser_download_url: ARM64_URL,
        },
        {
          name: 'YTArk-v2.1.1-armv7.apk',
          size: 2,
          browser_download_url: 'https://github.com/2archiver/YTArk/releases/download/v2.1.1/YTArk-v2.1.1-armv7.apk',
        },
      ],
    });
    const { release, error } = validateReleasePayload(fixture, {
      installedVersion: '2.1.0', architecture: 'armeabi-v7a',
    });
    assert.equal(error, undefined);
    assert.equal(release.assetName, 'YTArk-v2.1.1-armv7.apk');
    assert.equal(release.abi, 'armeabi-v7a');
  });

  test('refuses drafts, prereleases and non-stable tags', () => {
    assert.match(validateReleasePayload(releaseFixture({ draft: true }), context).error, /not a published stable release/);
    assert.match(validateReleasePayload(releaseFixture({ prerelease: true }), context).error, /not a published stable release/);
    assert.match(
      validateReleasePayload(releaseFixture({ tag_name: 'v2.1.1-rc1' }), context).error,
      /not a clean stable version/,
    );
  });

  test('refuses missing, duplicated and mismatched assets', () => {
    const missing = validateReleasePayload(releaseFixture({ assets: [] }), context);
    assert.match(missing.error, /0 assets named/);
    const duplicated = validateReleasePayload(
      releaseFixture({
        assets: [releaseFixture().assets[0], releaseFixture().assets[0]],
      }),
      context,
    );
    assert.match(duplicated.error, /2 assets named/);
    const foreign = validateReleasePayload(
      releaseFixture({
        assets: [{
          name: 'YTArk-v2.1.1-arm64.apk',
          browser_download_url: 'https://evil.example.com/YTArk-v2.1.1-arm64.apk',
          size: 1,
        }],
      }),
      context,
    );
    assert.match(foreign.error, /does not match the official YTArk release metadata/);
  });

  test('refuses releases whose declared versionCode disagrees with the tag', () => {
    const bad = validateReleasePayload(
      releaseFixture({ body: 'YTArk 2.1.1\n\nAndroid versionCode: 2010000\n' }),
      context,
    );
    assert.match(bad.error, /do not confirm the expected Android versionCode/);
    const missing = validateReleasePayload(releaseFixture({ body: 'Notes only' }), context);
    assert.match(missing.error, /do not confirm the expected Android versionCode/);
  });

  test('refuses unsupported ABIs and malformed payloads without throwing', () => {
    assert.match(
      validateReleasePayload(releaseFixture(), { installedVersion: '2.1.0', architecture: 'x86_64' }).error,
      /does not report a supported ARM ABI/,
    );
    assert.match(validateReleasePayload(null, context).error, /was not an object/);
    assert.match(validateReleasePayload({ message: 'Not Found' }, context).error, /no stable ytark release/i);
    assert.match(
      validateReleasePayload(
        releaseFixture({ assets: [{ ...releaseFixture().assets[0], digest: 'sha256:zz' }] }),
        context,
      ).error,
      /digest is malformed/,
    );
  });

  test('still reports the release when the installed build is already current', () => {
    const { release, error } = validateReleasePayload(releaseFixture({
      tag_name: 'v2.1.0',
      body: 'Android versionCode: 2010000',
      assets: [{
        name: 'YTArk-v2.1.0-arm64.apk',
        size: 168316114,
        browser_download_url: 'https://github.com/2archiver/YTArk/releases/download/v2.1.0/YTArk-v2.1.0-arm64.apk',
      }],
    }), context);
    assert.equal(error, undefined);
    assert.equal(release.newer, false);
    assert.equal(release.versionCode, 2010000);
  });
});

describe('bridge payloads', () => {
  const valid = {
    contract: 1,
    state: 'downloading',
    installed: { version: '2.1.0', display: '2.1', code: 2010000 },
    available: { version: '2.1.1', display: '2.1.1', abi: 'arm64-v8a', size: 168316114, notes: 'notes', tag: 'v2.1.1' },
    lastSuccessAt: 1_700_000_000_000,
    lastAttemptAt: 1_700_000_000_100,
    error: '',
    download: { active: true, phase: 'downloading', received: 10_485_760, total: 167_772_160 },
    verified: false,
    permissionRequired: false,
  };

  test('parses a well-formed native snapshot', () => {
    const model = parseNativeState(JSON.stringify(valid));
    assert.equal(model.state, 'downloading');
    assert.equal(model.installed.display, '2.1');
    assert.equal(model.download.received, 10_485_760);
    assert.equal(model.download.total, 167_772_160);
    assert.equal(model.available.size, 168316114);
  });

  test('rejects unknown contracts, unknown states and unusable payloads', () => {
    assert.equal(parseNativeState({ ...valid, contract: 2 }), null);
    assert.equal(parseNativeState({ ...valid, state: 'whatever' }), null);
    assert.equal(parseNativeState('{not json'), null);
    assert.equal(parseNativeState(null), null);
    assert.equal(parseNativeState({ ...valid, contract: '1' }), null, 'contract must be the numeric version');
  });

  test('normalises missing numbers to zero and never invents progress', () => {
    const model = parseNativeState({
      contract: 1,
      state: 'downloading',
      download: { active: true, received: -5, total: 'x' },
    });
    assert.equal(model.download.received, 0);
    assert.equal(model.download.total, 0);
    assert.equal(model.available, null);
    assert.equal(model.installed.version, 'unknown');
  });

  test('builds only validated, contract-tagged commands', () => {
    assert.deepEqual(JSON.parse(buildCommand('check')), { contract: 1, command: 'check' });
    assert.equal(buildCommand('installShellCommand'), null);
    assert.equal(buildCommand(''), null);
    const withPayload = JSON.parse(buildCommand('download', {
      tag: 'v2.1.1', url: 'https://evil.example.com/a.apk', path: '/data/x', command: 'rm',
    }));
    assert.deepEqual(withPayload, { contract: 1, command: 'download', tag: 'v2.1.1' });
    assert.equal(buildCommand('download', { tag: 'v../evil' }).includes('evil'), false);
  });
});

describe('state -> status and actions', () => {
  const model = (state, extra = {}) => parseNativeState({
    contract: 1, state, installed: { version: '2.1.0' }, ...extra,
  });

  test('a failed check is never reported as up to date', () => {
    const text = describeState({ state: 'check_error', error: 'Network unavailable.' });
    assert.match(text, /Network unavailable/);
    assert.doesNotMatch(text, /latest published stable/i);
    assert.ok(actionsForState(model('check_error')).some(a => a.id === 'check'));
  });

  test('unknown download totals stay indeterminate and real totals show a percentage', () => {
    const indeterminate = describeState({
      state: 'downloading', download: { received: 4_194_304, total: 0 },
    });
    assert.doesNotMatch(indeterminate, /%/);
    assert.match(indeterminate, /4\.0 MB/);
    const determinate = describeState({
      state: 'downloading', download: { received: 8_388_608, total: 16_777_216 },
    });
    assert.match(determinate, /50%/);
  });

  test('offers download, skip and later while an update is available', () => {
    const actions = actionsForState(model('available', {
      available: { version: '2.1.1', display: '2.1.1', abi: 'arm64-v8a', size: 1 },
    })).map(a => a.id);
    assert.deepEqual(actions, ['check', 'download', 'skip', 'later', 'open']);
  });

  test('hides check while busy and always offers one recovery path', () => {
    assert.deepEqual(actionsForState(model('downloading')).map(a => a.id), ['cancel']);
    assert.deepEqual(actionsForState(model('verifying')).map(a => a.id), []);
    assert.deepEqual(
      actionsForState(model('download_error', {
        available: { version: '2.1.1', display: '2.1.1', abi: 'arm64-v8a', size: 1 },
      })).map(a => a.id),
      ['check', 'download', 'open'],
    );
    assert.deepEqual(actionsForState(model('ready_to_install')).map(a => a.id), ['check', 'install', 'later', 'open']);
    assert.deepEqual(actionsForState(model('permission_required')).map(a => a.id), ['check', 'install', 'open']);
    assert.deepEqual(actionsForState(model('installation_cancelled')).map(a => a.id), ['check', 'install', 'later', 'open']);
    assert.deepEqual(actionsForState(model('install_error')).map(a => a.id), ['check', 'install', 'open']);
    assert.deepEqual(actionsForState(model('idle')).map(a => a.id), ['check', 'open']);
  });

  test('never offers the same action twice', () => {
    for (const state of ['idle', 'checking', 'current', 'available', 'ready_to_install', 'installed']) {
      const ids = actionsForState(model(state, state === 'available'
        ? { available: { version: '2.1.1', display: '2.1.1', abi: 'arm64-v8a', size: 1 } } : {})).map(a => a.id);
      assert.equal(new Set(ids).size, ids.length, `${state} duplicated an action`);
    }
  });

  test('formats sizes and strips markup from release notes', () => {
    assert.equal(formatBytes(0), '');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(168316114), '160.5 MB');
    assert.equal(cleanNotes('# YTArk 2.1.1\n\n**Fix** the wordmark\nAndroid versionCode: 2010100\n'), 'YTArk 2.1.1\n\nFix the wordmark');
  });
});
