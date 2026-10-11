// Contract tests for the structured app-architecture evidence model
// (features/abiEvidence.js).
//
// The 2.4 regression: a delayed/empty device-ABI bridge result was reported
// as a categorical "unsupported device" error and blocked the update check.
// The model must keep four facts apart — the device's supported ABI list,
// the installed APK's ABI, runtime CPU labels, and bridge availability — and
// must only ever call a device incompatible on explicit non-ARM evidence.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ABI_EVIDENCE_SCHEMA_VERSION,
  ARMV7_ABI,
  ARMV7_ONLY_SINCE_VERSION,
  VERDICTS,
  classifyBridge,
  classifyInstalledVersion,
  compareVersions,
  deriveAbiEvidence,
  normalizeAbiValue,
} from '../features/abiEvidence.js';

describe('normalization', () => {
  it('recognises canonical Android ABI spellings', () => {
    assert.deepEqual(normalizeAbiValue('armeabi-v7a'),
      { status: 'ok', kind: 'androidAbi', abi: 'armeabi-v7a', v7a: true });
    assert.deepEqual(normalizeAbiValue('arm64-v8a'),
      { status: 'ok', kind: 'androidAbi', abi: 'arm64-v8a', arm64: true });
    assert.deepEqual(normalizeAbiValue('x86_64'),
      { status: 'ok', kind: 'androidAbi', abi: 'x86_64', nonArm: true });
  });

  it('is case- and whitespace-insensitive', () => {
    assert.equal(normalizeAbiValue('  ARMEABI-V7A  ').abi, 'armeabi-v7a');
    assert.equal(normalizeAbiValue('\narmeabi-v7a\n').status, 'ok');
  });

  it('treats empty, null, undefined and non-strings as missing information, not errors', () => {
    assert.equal(normalizeAbiValue('').status, 'missing');
    assert.equal(normalizeAbiValue('   ').status, 'missing');
    assert.equal(normalizeAbiValue(null).status, 'malformed');
    assert.equal(normalizeAbiValue(undefined).status, 'malformed');
    assert.equal(normalizeAbiValue(42).status, 'malformed');
  });

  it('never throws on hostile input', () => {
    for (const value of [NaN, Infinity, {}, [], () => {}]) {
      assert.doesNotThrow(() => classifyBridge(value));
    }
  });
});

describe('runtime labels are not Android ABIs', () => {
  it('separates armv7l (runtime label) from armeabi-v7a (Android ABI)', () => {
    const label = normalizeAbiValue('armv7l');
    assert.equal(label.kind, 'runtimeLabel');
    assert.equal(label.label, 'armv7');
    assert.equal(label.abi, undefined, 'a runtime label is never reported as an ABI');
  });

  it('maps 64-bit runtime labels to arm64, which never implies 32-bit support', () => {
    for (const value of ['aarch64', 'arm64', 'arm64e']) {
      assert.equal(normalizeAbiValue(value).label, 'arm64');
    }
  });

  it('classifies unknown spellings without guessing', () => {
    assert.equal(normalizeAbiValue('wasm64').kind, 'unrecognized');
  });
});

describe('installed-build classification', () => {
  it('marks the pipeline-verified ARMv7-only packaging boundary', () => {
    assert.equal(ARMV7_ONLY_SINCE_VERSION, '2.1.2');
    assert.equal(classifyInstalledVersion('2.1.2').status, 'verified-armv7');
    assert.equal(classifyInstalledVersion('2.3.0').status, 'verified-armv7');
    assert.equal(classifyInstalledVersion('2.10.0').status, 'verified-armv7');
  });

  it('does not trust pre-2.1.2 builds (dual-ABI or arm64) for device evidence', () => {
    assert.equal(classifyInstalledVersion('2.1.1').status, 'legacy');
    assert.equal(classifyInstalledVersion('2.0.4-ytark.17').status, 'legacy');
    assert.equal(classifyInstalledVersion('1.9.0').status, 'legacy');
  });

  it('reports unreadable versions as unknown, and never throws', () => {
    assert.equal(classifyInstalledVersion('').status, 'unknown');
    assert.equal(classifyInstalledVersion('unknown').status, 'unknown');
    assert.equal(classifyInstalledVersion(null).status, 'unknown');
    assert.equal(classifyInstalledVersion('2.1').status, 'unknown');
  });

  it('compares versions numerically, not lexicographically', () => {
    assert.ok(compareVersions('2.10.0', '2.9.9') > 0);
    assert.equal(compareVersions('2.1.2', '2.1.2'), 0);
    assert.ok(compareVersions('2.1.2', '2.2.0') < 0);
  });
});

describe('verdict: compatible', () => {
  it('explicit armeabi-v7a in the device list (including mixed 64/32 lists)', () => {
    // The web surface reads the FIRST entry of SUPPORTED_ABIS; on a mixed
    // device that is arm64-v8a, while the full list also contains
    // armeabi-v7a. The native updater (full list) is authoritative there;
    // an explicit armeabi-v7a first entry is unambiguous either way.
    const evidence = deriveAbiEvidence({
      bridgeRaw: 'armeabi-v7a',
      installedVersionRaw: '2.3.0',
    });
    assert.equal(evidence.verdict, VERDICTS.compatible);
    assert.equal(evidence.reason, 'explicit-abi');
    assert.equal(evidence.architecture, ARMV7_ABI);
  });

  it('trusted installed-build evidence: verified ARMv7-only build running, bridge empty', () => {
    const evidence = deriveAbiEvidence({
      bridgeRaw: '',
      installedVersionRaw: '2.3.0',
    });
    assert.equal(evidence.verdict, VERDICTS.compatible);
    assert.equal(evidence.reason, 'installed-build-evidence');
    assert.equal(evidence.architecture, ARMV7_ABI);
    assert.match(evidence.details.join(' '), /pipeline-verified ARMv7-only APK/);
  });

  it('trusted installed-build evidence: 64-bit-first device running a verified ARMv7-only build', () => {
    // A 64/32 mixed TV reports arm64-v8a first, yet it runs the ARMv7-only
    // APK — the running fact proves the userspace supports 32-bit apps.
    const evidence = deriveAbiEvidence({
      bridgeRaw: 'arm64-v8a',
      installedVersionRaw: '2.1.2',
    });
    assert.equal(evidence.verdict, VERDICTS.compatible);
    assert.equal(evidence.reason, 'installed-build-evidence');
  });

  it('a 32-bit ARM runtime label is running-architecture evidence', () => {
    const evidence = deriveAbiEvidence({
      bridgeRaw: 'armv7l',
      installedVersionRaw: 'unknown',
    });
    assert.equal(evidence.verdict, VERDICTS.compatible);
    assert.equal(evidence.reason, 'runtime-armv7');
  });
});

describe('verdict: incompatible (explicit evidence only)', () => {
  it('an explicit non-ARM device ABI is incompatible', () => {
    for (const abi of ['x86', 'x86_64', 'riscv64', 'mips64']) {
      const evidence = deriveAbiEvidence({ bridgeRaw: abi, installedVersionRaw: '2.3.0' });
      assert.equal(evidence.verdict, VERDICTS.incompatible, abi);
      assert.equal(evidence.architecture, null);
    }
  });

  it('never calls a 64-bit ARM device incompatible', () => {
    const evidence = deriveAbiEvidence({ bridgeRaw: 'arm64-v8a', installedVersionRaw: '2.0.4' });
    assert.equal(evidence.verdict, VERDICTS.unknown,
      'a 64-bit CPU description is not a compatibility verdict');
  });
});

describe('verdict: unknown (missing information is recoverable)', () => {
  it('delayed or empty bridge plus an unreadable installed version', () => {
    const evidence = deriveAbiEvidence({ bridgeRaw: '', installedVersionRaw: '' });
    assert.equal(evidence.verdict, VERDICTS.unknown);
    assert.equal(evidence.reason, 'bridge-unavailable');
    assert.equal(evidence.architecture, null);
  });

  it('a failing bridge query is unknown, with the error contained', () => {
    const evidence = deriveAbiEvidence({
      bridgeError: 'SecurityError: access denied',
      installedVersionRaw: '2.1.1',
    });
    assert.equal(evidence.verdict, VERDICTS.unknown);
    assert.equal(evidence.reason, 'bridge-error');
    assert.match(evidence.details.join(' '), /predates/);
  });

  it('a malformed bridge value is unknown', () => {
    const evidence = deriveAbiEvidence({ bridgeRaw: 12345, installedVersionRaw: '2.3.0' });
    assert.equal(evidence.verdict, VERDICTS.compatible,
      'a verified ARMv7-only build running still provides the evidence');
    const evidence2 = deriveAbiEvidence({ bridgeRaw: 12345, installedVersionRaw: '2.0.0' });
    assert.equal(evidence2.verdict, VERDICTS.unknown);
    assert.equal(evidence2.reason, 'malformed-abi');
  });

  it('a 64-bit runtime label without installed-build evidence is unknown', () => {
    const evidence = deriveAbiEvidence({ bridgeRaw: 'aarch64', installedVersionRaw: 'unknown' });
    assert.equal(evidence.verdict, VERDICTS.unknown);
    assert.equal(evidence.reason, 'arm64-runtime');
  });

  it('a legacy armeabi-only report is unknown, not v7a-compatible', () => {
    const evidence = deriveAbiEvidence({ bridgeRaw: 'armeabi', installedVersionRaw: '2.0.0' });
    assert.equal(evidence.verdict, VERDICTS.unknown);
    assert.equal(evidence.reason, 'legacy-arm-abi');
  });
});

describe('structured contract', () => {
  it('always returns the full structure (schema version, verdict, evidence)', () => {
    const cases = [
      { bridgeRaw: 'armeabi-v7a', installedVersionRaw: '2.3.0' },
      { bridgeRaw: '', installedVersionRaw: '' },
      { bridgeRaw: 'x86_64', installedVersionRaw: '2.3.0' },
      { bridgeRaw: null, installedVersionRaw: null },
    ];
    for (const input of cases) {
      const evidence = deriveAbiEvidence(input);
      assert.equal(evidence.schemaVersion, ABI_EVIDENCE_SCHEMA_VERSION);
      assert.ok(VERDICTS[evidence.verdict], `verdict is a known value: ${evidence.verdict}`);
      assert.equal(typeof evidence.reason, 'string');
      assert.ok(Array.isArray(evidence.details) && evidence.details.length > 0);
      assert.equal(typeof evidence.bridge, 'object');
      assert.equal(typeof evidence.installedBuild, 'object');
      // No tokens, no account data, no URL details — safe for diagnostics.
      assert.doesNotMatch(evidence.details.join(' '), /token|cookie|session|https?:\/\//i);
    }
  });

  it('is total: deriveAbiEvidence never throws', () => {
    assert.doesNotThrow(() => deriveAbiEvidence());
    assert.doesNotThrow(() => deriveAbiEvidence({}));
    assert.doesNotThrow(() => deriveAbiEvidence({ bridgeRaw: {}, installedVersionRaw: {} }));
  });
});
