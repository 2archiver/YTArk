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
  sanitizeDiagnostic,
  validateReleasePayload,
  versionCodeForVersion,
} from '../features/updateState.js';

// The published release is ARMv7-only from 2.1.2 onwards, so the fixture is
// the ARMv7 asset: an arm64-v8a APK is not a selectable YTArk update any more.
const ARMV7_ASSET = 'YTArk-v2.1.2-armv7.apk';
const ARMV7_URL = `https://github.com/2archiver/YTArk/releases/download/v2.1.2/${ARMV7_ASSET}`;
const LEGACY_ARM64_ASSET = 'YTArk-v2.1.1-arm64.apk';
const LEGACY_ARM64_URL =
  `https://github.com/2archiver/YTArk/releases/download/v2.1.1/${LEGACY_ARM64_ASSET}`;

function releaseFixture(overrides = {}) {
  return {
    tag_name: 'v2.1.2',
    draft: false,
    prerelease: false,
    body: 'YTArk 2.1.2\n\n- Vector Premium wordmark\n\nAndroid versionCode: 2010200\n',
    assets: [
      {
        name: ARMV7_ASSET,
        size: 97195140,
        browser_download_url: ARMV7_URL,
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
  const context = { installedVersion: '2.1.1', architecture: 'armeabi-v7a' };

  test('accepts a matching published stable release for an ARMv7 device', () => {
    const { release, error } = validateReleasePayload(releaseFixture(), context);
    assert.equal(error, undefined);
    assert.equal(release.version, '2.1.2');
    assert.equal(release.display, '2.1.2');
    assert.equal(release.versionCode, 2010200);
    assert.equal(release.assetName, ARMV7_ASSET);
    assert.equal(release.abi, 'armeabi-v7a');
    assert.equal(release.newer, true);
    assert.equal(release.sha256Published, 'ab'.repeat(32));
    assert.match(release.notes, /Vector Premium wordmark/);
    assert.doesNotMatch(release.notes, /versionCode/i);
  });

  test('selects the ARMv7 asset by metadata instead of asset order', () => {
    const fixture = releaseFixture({
      assets: [
        {
          name: ARMV7_ASSET,
          size: 2,
          browser_download_url: ARMV7_URL,
          digest: `sha256:${'cd'.repeat(32)}`,
        },
        {
          name: 'userScript.js',
          size: 3,
          browser_download_url: 'https://github.com/2archiver/YTArk/releases/download/v2.1.2/userScript.js',
        },
      ],
    });
    const { release, error } = validateReleasePayload(fixture, context);
    assert.equal(error, undefined);
    assert.equal(release.assetName, ARMV7_ASSET);
    assert.equal(release.abi, 'armeabi-v7a');
  });

  test('requires a valid published digest when matching the ARMv7 asset', () => {
    const noDigest = validateReleasePayload(releaseFixture({
      assets: [{ name: ARMV7_ASSET, size: 1, browser_download_url: ARMV7_URL }],
    }), context);
    assert.match(noDigest.error, /no valid published SHA-256 digest/);
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
          name: ARMV7_ASSET,
          browser_download_url: 'https://evil.example.com/' + ARMV7_ASSET,
          size: 1,
        }],
      }),
      context,
    );
    assert.match(foreign.error, /does not match the official YTArk release metadata/);
  });

  test('refuses releases whose declared versionCode disagrees with the tag', () => {
    const bad = validateReleasePayload(
      releaseFixture({ body: 'YTArk 2.1.2\n\nAndroid versionCode: 2010000\n' }),
      context,
    );
    assert.match(bad.error, /do not confirm the expected Android versionCode/);
    const missing = validateReleasePayload(releaseFixture({ body: 'Notes only' }), context);
    assert.match(missing.error, /do not confirm the expected Android versionCode/);
  });

  test('treats a 64-bit-only report as unknown, not unsupported: no asset is selected', () => {
    const { release, error } = validateReleasePayload(releaseFixture(), {
      installedVersion: '2.1.1', architecture: 'arm64-v8a', abiVerdict: 'unknown',
    });
    assert.equal(error, undefined);
    assert.ok(release, 'the release metadata stays available for the manual route');
    assert.equal(release.assetName, undefined, 'no asset is selected without compatible evidence');
    assert.equal(release.abi, null);
    assert.equal(release.abiVerdict, 'unknown');
  });

  test('explicit incompatible verdict also skips asset selection', () => {
    const { release, error } = validateReleasePayload(releaseFixture(), {
      installedVersion: '2.1.1', architecture: '', abiVerdict: 'incompatible',
    });
    assert.equal(error, undefined);
    assert.ok(release);
    assert.equal(release.assetName, undefined);
    assert.equal(release.abiVerdict, 'incompatible');
  });

  test('a compatible verdict with unmappable architecture evidence is refused, never guessed', () => {
    for (const architecture of ['', 'arm64-v8a', 'x86', 'aarch64']) {
      const { error, release } = validateReleasePayload(releaseFixture(), {
        installedVersion: '2.1.1', architecture, abiVerdict: 'compatible',
      });
      assert.equal(release, undefined, `no release is offered for architecture ${JSON.stringify(architecture)}`);
      assert.match(error, /inconsistent architecture evidence/);
    }
  });

  test('never selects a legacy ARM64 asset, even when it is present', () => {
    const fixture = releaseFixture({
      assets: [
        { name: LEGACY_ARM64_ASSET, size: 1, browser_download_url: LEGACY_ARM64_URL },
      ],
    });
    const { error } = validateReleasePayload(fixture, context);
    assert.match(error, /assets named YTArk-v2\.1\.2-armv7\.apk/);
  });

  test('treats an x86 report without a verdict as unknown and malformed payloads as errors', () => {
    const x86 = validateReleasePayload(releaseFixture(), { installedVersion: '2.1.0', architecture: 'x86_64' });
    assert.equal(x86.error, undefined, 'architecture alone is missing information, not a verdict');
    assert.equal(x86.release.abiVerdict, 'unknown');
    assert.match(validateReleasePayload(null, context).error, /was not an object/);
    assert.match(validateReleasePayload({ message: 'Not Found' }, context).error, /no stable ytark release/i);
    assert.match(
      validateReleasePayload(
        releaseFixture({ assets: [{ ...releaseFixture().assets[0], digest: 'sha256:zz' }] }),
        context,
      ).error,
      /no valid published SHA-256 digest/,
    );
  });

  test('still reports the release when the installed build is already current', () => {
    const { release, error } = validateReleasePayload(releaseFixture({
      tag_name: 'v2.1.0',
      body: 'Android versionCode: 2010000',
      assets: [{
        name: 'YTArk-v2.1.0-armv7.apk',
        size: 97195140,
        browser_download_url: 'https://github.com/2archiver/YTArk/releases/download/v2.1.0/YTArk-v2.1.0-armv7.apk',
        digest: `sha256:${'ef'.repeat(32)}`,
      }],
    }), { installedVersion: '2.1.0', architecture: 'armeabi-v7a' });
    assert.equal(error, undefined);
    assert.equal(release.newer, false);
    assert.equal(release.versionCode, 2010000);
  });
});

describe('architecture verdict messages', () => {
  test('unknown verdict never says the device is unsupported', async () => {
    const { unknownArchitectureMessage, incompatibleArchitectureMessage } =
      await import('../features/updateState.js');
    const unknown = unknownArchitectureMessage({
      details: ['The device architecture query returned no value (the bridge may not be ready yet).'],
    });
    assert.match(unknown, /Could not confirm this device.s app architecture/);
    assert.doesNotMatch(unknown, /cannot be installed|not supported device/i);
    assert.match(unknown, /retrying detection still work/);
    const incompatible = incompatibleArchitectureMessage({ bridge: { abi: 'x86_64' } });
    assert.match(incompatible, /x86_64/);
    assert.match(incompatible, /ARMv7 \(armeabi-v7a\) builds only/);
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

describe('official manual-install release page', () => {
  test('links to the exact tag only for a clean vX.Y.Z release tag', async () => {
    const { officialReleasePageUrl, LATEST_RELEASE_PAGE } = await import('../features/updateState.js');
    assert.equal(officialReleasePageUrl('v2.1.2'), 'https://github.com/2archiver/YTArk/releases/tag/v2.1.2');
    for (const bad of ['', undefined, 'v2.1', '2.1.2', 'v2.1.2/../x', 'v2.1.2?x=1']) {
      assert.equal(officialReleasePageUrl(bad), LATEST_RELEASE_PAGE, `rejects ${String(bad)}`);
    }
  });
});

describe('diagnostic sanitization', () => {
  test('redacts URLs, secrets and headers with one [redacted] convention', () => {
    assert.equal(sanitizeDiagnostic('https://secret.example/token=abc'), '[redacted]');
    assert.equal(sanitizeDiagnostic('see https://secret.example/token=abc now'), 'see [redacted] now');
    assert.equal(sanitizeDiagnostic('HTTPS://SECRET.EXAMPLE/TOKEN=ABC'), '[redacted]');
    assert.equal(sanitizeDiagnostic('token=abc123'), 'token=[redacted]');
    assert.equal(sanitizeDiagnostic('Authorization: Bearer abcdef123456'), 'Authorization=[redacted]');
    assert.equal(sanitizeDiagnostic('header Bearer abcdef123456 sent'), 'header authorization=[redacted] sent');
    assert.equal(sanitizeDiagnostic('https://host/x?a=1&token=abc&sig=zzz'), '[redacted]');
    assert.equal(sanitizeDiagnostic('10.0.0.1'), '[ip]');
  });

  test('handles blank input, multiline text, truncation and repeated runs', () => {
    assert.equal(sanitizeDiagnostic(null), '');
    assert.equal(sanitizeDiagnostic(''), '');
    assert.equal(sanitizeDiagnostic('   '), '');
    const multi = sanitizeDiagnostic('line1\nAuthorization: Bearer abcdef123456\nline3');
    assert.ok(!multi.includes('abcdef123456') && !multi.includes('\n'), multi);
    const cut = sanitizeDiagnostic(`${'filler text '.repeat(60)}token=tailsecret`);
    assert.equal(cut.length, 240);
    assert.ok(cut.endsWith('...'), cut);
    assert.ok(!cut.includes('tailsecret'), cut);
    const once = sanitizeDiagnostic('try https://x.example/y token=z \n10.0.0.1');
    assert.equal(sanitizeDiagnostic(once), once);
  });
});
