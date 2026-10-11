/**
 * Structured app-architecture evidence for YTArk release matching.
 *
 * This module keeps four facts apart (the 2.4 fix for the "could not match
 * the release" regression):
 *
 *   1. The device's supported Android ABI list — native ground truth. The
 *      injected updater dex can read the complete list (Build.SUPPORTED_ABIS);
 *      the web surface can at best read the FIRST entry through the Cobalt
 *      bridge (`h5vcc.tizentube.GetArchitecture()`), and that entry may be
 *      delivered late, empty or not at all.
 *   2. The installed APK's ABI — the native updater reads it by scanning the
 *      APK's native libraries. The web surface cannot scan the APK, but it
 *      can identify which release packaging is running: every YTArk build
 *      from 2.1.2 on is verified ARMv7-only by the release pipeline, so a
 *      running build of such a version is trusted installed-build evidence
 *      that this device supports armeabi-v7a (Android refuses to install an
 *      APK whose native libraries no supported ABI matches). The app name,
 *      version string or file name alone are never sufficient: the running
 *      fact (this code only executes inside the app) is always part of the
 *      evidence.
 *   3. Runtime CPU labels of the app process (for example `armv7l` or
 *      `aarch64`). These are NOT Android ABIs: `armv7l` proves the process
 *      runs 32-bit ARM, `aarch64` proves it runs 64-bit ARM, and a 64-bit
 *      runtime label never establishes 32-bit app support.
 *   4. Bridge availability. Missing, delayed, empty or malformed values are
 *      missing information — they are reported as `unknown` with a recovery
 *      action, never as an unsupported device.
 *
 * Verdicts
 *   compatible   explicit evidence that armeabi-v7a is supported, or trusted
 *                installed-build evidence as above.
 *   incompatible explicit evidence of a non-ARM userspace (a device ABI list
 *                headed by x86 / x86_64 / riscv64 / mips).
 *   unknown      information is missing or inconclusive (bridge not ready,
 *                64-bit-only report, legacy or unreadable installed version).
 *                Unknown is not "unsupported": the release check, the notes
 *                and retrying detection all stay available.
 */

export const ABI_EVIDENCE_SCHEMA_VERSION = 1;
export const ARMV7_ABI = 'armeabi-v7a';
export const VERDICTS = Object.freeze({
  compatible: 'compatible',
  incompatible: 'incompatible',
  unknown: 'unknown',
});

/**
 * First YTArk release packaged and pipeline-verified as ARMv7-only. Builds
 * before it (2.1.1 and earlier) were dual-ABI or arm64 and therefore do not
 * confirm the device's ABI by running.
 */
export const ARMV7_ONLY_SINCE_VERSION = '2.1.2';
const ARMV7_ONLY_SINCE = [2, 1, 2];

const CLEAN_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(?:ytark|personal)\.[1-9]\d*)?$/;

/** Documented Android ABI spellings this device query may return. */
const ANDROID_ABIS = Object.freeze({
  'armeabi-v7a': { v7a: true },
  'armeabi': { arm32Legacy: true },
  'arm64-v8a': { arm64: true },
  'x86': { nonArm: true },
  'x86_64': { nonArm: true },
  'riscv64': { nonArm: true },
  'mips': { nonArm: true },
  'mipsel': { nonArm: true },
  'mips64': { nonArm: true },
  'mips64el': { nonArm: true },
});

/**
 * Runtime CPU labels (uname/process architecture). Deliberately separate from
 * the Android ABI set: `armv7l` is a runtime label, `armeabi-v7a` is the
 * Android ABI. Neither is inferred from the other.
 */
const RUNTIME_LABELS = Object.freeze({
  'armv7l': 'armv7',
  'armv7': 'armv7',
  'armv7-a': 'armv7',
  'armv7a': 'armv7',
  'aarch64': 'arm64',
  'arm64': 'arm64',
  'arm64e': 'arm64',
  'i386': 'x86',
  'i686': 'x86',
});

/**
 * Normalize one raw value from the architecture query.
 * @returns {{status: 'ok'|'missing'|'malformed', kind?: string, abi?: string,
 *           label?: string, v7a?: boolean, arm64?: boolean, arm32Legacy?: boolean,
 *           nonArm?: boolean}}
 */
export function normalizeAbiValue(raw) {
  if (typeof raw !== 'string') return { status: 'malformed' };
  const value = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!value) return { status: 'missing' };
  if (ANDROID_ABIS[value]) {
    return Object.assign({ status: 'ok', kind: 'androidAbi', abi: value }, ANDROID_ABIS[value]);
  }
  if (RUNTIME_LABELS[value]) {
    return { status: 'ok', kind: 'runtimeLabel', label: RUNTIME_LABELS[value] };
  }
  return { status: 'ok', kind: 'unrecognized' };
}

/** Classify the (possibly delayed/empty) bridge result. Never throws. */
export function classifyBridge(raw) {
  try {
    return normalizeAbiValue(raw);
  } catch (_) {
    return { status: 'malformed' };
  }
}

/** Compare two dotted versions numerically; negative/positive/zero. */
export function compareVersions(left, right) {
  const a = CLEAN_VERSION.exec(String(left || ''));
  const b = CLEAN_VERSION.exec(String(right || ''));
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    const diff = Number(a[index + 1]) - Number(b[index + 1]);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Classify the installed app version. `verified-armv7` means the running
 * build belongs to the pipeline-verified ARMv7-only packaging (>= 2.1.2);
 * `legacy` means it predates that packaging and therefore does not confirm
 * the device's ABI by running.
 */
export function classifyInstalledVersion(raw) {
  const value = String(raw === null || raw === undefined ? '' : raw).trim();
  const match = CLEAN_VERSION.exec(value);
  if (!match) return { status: 'unknown', version: value || 'unknown' };
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  const comparison = compareVersions(version, ARMV7_ONLY_SINCE_VERSION);
  if (comparison === null) return { status: 'unknown', version };
  return { status: comparison >= 0 ? 'verified-armv7' : 'legacy', version };
}

/**
 * Derive the structured evidence from the raw bridge value and the installed
 * version. Pure and total: it never throws and always returns a complete
 * structure with `schemaVersion`, `verdict`, `reason` and diagnostics.
 *
 * @param {{bridgeRaw?: string|null, bridgeError?: string,
 *          installedVersionRaw?: string}} input
 */
export function deriveAbiEvidence(input = {}) {
  const bridgeRaw = input.bridgeRaw;
  const bridge = input.bridgeError
    ? { status: 'error', detail: String(input.bridgeError).slice(0, 200) }
    : classifyBridge(bridgeRaw);
  const installed = classifyInstalledVersion(input.installedVersionRaw);
  const details = [];

  let verdict = VERDICTS.unknown;
  let reason = 'no-evidence';

  if (bridge.status === 'ok' && bridge.kind === 'androidAbi' && bridge.v7a) {
    verdict = VERDICTS.compatible;
    reason = 'explicit-abi';
    details.push(`The device reports ${bridge.abi} as its first supported Android ABI.`);
  } else if (bridge.status === 'ok' && bridge.kind === 'androidAbi' && bridge.nonArm) {
    verdict = VERDICTS.incompatible;
    reason = 'non-arm-abi';
    details.push(`The device reports ${bridge.abi} as its first supported Android ABI (a non-ARM userspace).`);
    if (installed.status === 'verified-armv7') {
      details.push('The explicit device list takes precedence over any other signal.');
    }
  } else if (bridge.status === 'ok' && bridge.kind === 'runtimeLabel' && bridge.label === 'armv7') {
    verdict = VERDICTS.compatible;
    reason = 'runtime-armv7';
    details.push('The app process runs as 32-bit ARM (runtime label, not a device ABI list).');
  } else if (installed.status === 'verified-armv7') {
    verdict = VERDICTS.compatible;
    reason = 'installed-build-evidence';
    details.push(bridge.status === 'ok'
      ? `The device architecture query returned "${String(bridgeRaw).trim()}", which does not confirm ${ARMV7_ABI} by itself.`
      : `The device architecture query was ${bridge.status === 'error' ? 'failing' : bridge.status === 'malformed' ? 'malformed' : 'empty or unavailable'}.`);
    details.push(`The running build (version ${installed.version}) is a pipeline-verified ARMv7-only APK; it only runs on devices that support ${ARMV7_ABI}.`);
  } else if (bridge.status === 'ok' && bridge.kind === 'androidAbi' && bridge.arm64) {
    verdict = VERDICTS.unknown;
    reason = 'arm64-first-abi';
    details.push('The device reports arm64-v8a as its first supported ABI; a 64-bit CPU does not by itself confirm 32-bit app support.');
  } else if (bridge.status === 'ok' && bridge.kind === 'runtimeLabel' && bridge.label === 'arm64') {
    verdict = VERDICTS.unknown;
    reason = 'arm64-runtime';
    details.push('The app process runs as 64-bit ARM; that does not establish 32-bit app support.');
  } else if (bridge.status === 'ok' && bridge.kind === 'runtimeLabel' && bridge.label === 'x86') {
    verdict = VERDICTS.incompatible;
    reason = 'non-arm-abi';
    details.push('The app process runs as 32-bit x86, a non-ARM userspace.');
  } else if (bridge.status === 'ok' && bridge.kind === 'androidAbi' && bridge.arm32Legacy) {
    verdict = VERDICTS.unknown;
    reason = 'legacy-arm-abi';
    details.push(`The device reports ${bridge.abi}, a legacy 32-bit ARM ABI; ${ARMV7_ABI} is not confirmed by this value.`);
  } else {
    verdict = VERDICTS.unknown;
    if (bridge.status === 'error') {
      reason = 'bridge-error';
      details.push('The device architecture query failed.');
    } else if (bridge.status === 'malformed') {
      reason = 'malformed-abi';
      details.push('The device architecture query returned an unrecognized value.');
    } else {
      reason = 'bridge-unavailable';
      details.push('The device architecture query returned no value (the bridge may not be ready yet).');
    }
    if (installed.status === 'legacy') {
      details.push(`The installed version (${installed.version}) predates YTArk's ARMv7-only packaging, so its running does not confirm the device's ABI.`);
    } else if (installed.status === 'unknown') {
      details.push('The installed version could not be read, so the running build does not confirm the device\'s ABI.');
    }
  }

  return {
    schemaVersion: ABI_EVIDENCE_SCHEMA_VERSION,
    verdict,
    reason,
    architecture: verdict === VERDICTS.compatible ? ARMV7_ABI : null,
    bridge,
    installedBuild: installed,
    details,
  };
}
