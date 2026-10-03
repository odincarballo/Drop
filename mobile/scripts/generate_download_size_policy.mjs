import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prettier from 'prettier';

const root = resolve(import.meta.dirname, '../modules/on-device-youtube');
const policy = JSON.parse(
  readFileSync(resolve(root, 'download-size-policy.json'), 'utf8'),
);
const keys = [
  'standardVideoMiB',
  'phaseOne1080VideoMiB',
  'audioMiB',
  'qualityTolerance',
  'reserveFloorMiB',
  'reservePercent',
  'outputFloorMiB',
  'outputOverheadPercent',
  'approximateMarginPercent',
];
for (const key of keys) {
  if (!Number.isSafeInteger(policy[key]) || policy[key] <= 0) {
    throw new Error(`Invalid download size policy: ${key}`);
  }
}
if (
  policy.phaseOne1080VideoMiB > policy.standardVideoMiB ||
  policy.reservePercent >= 100 ||
  policy.outputOverheadPercent >= 100
) {
  throw new Error('Invalid download size policy relationship');
}

const swift = `// Generated from download-size-policy.json. Do not edit manually.
import Foundation

enum MDDownloadSizePolicy {
  static let standardVideoBytes: Int64 = ${policy.standardVideoMiB} * 1024 * 1024
  static let phaseOne1080VideoBytes: Int64 = ${policy.phaseOne1080VideoMiB} * 1024 * 1024
  static let audioBytes: Int64 = ${policy.audioMiB} * 1024 * 1024
  static let qualityTolerance = ${policy.qualityTolerance}
  static let reserveFloorBytes: Int64 = ${policy.reserveFloorMiB} * 1024 * 1024
  static let reservePercent: Int64 = ${policy.reservePercent}
  static let outputFloorBytes: Int64 = ${policy.outputFloorMiB} * 1024 * 1024
  static let outputOverheadPercent: Int64 = ${policy.outputOverheadPercent}
  static let approximateMarginPercent: Int64 = ${policy.approximateMarginPercent}

  static func videoMaximumBytes(height: Int?) -> Int64 {
    guard let height,
          abs(height - 360) <= qualityTolerance || abs(height - 720) <= qualityTolerance
    else { return phaseOne1080VideoBytes }
    return standardVideoBytes
  }
}
`;
const python = `# Generated from download-size-policy.json. Do not edit manually.\nSTANDARD_VIDEO_MAX_BYTES = ${policy.standardVideoMiB} * 1024 * 1024\nPHASE_ONE_1080_MAX_BYTES = ${policy.phaseOne1080VideoMiB} * 1024 * 1024\nMAX_AUDIO_BYTES = ${policy.audioMiB} * 1024 * 1024\nQUALITY_TOLERANCE = ${policy.qualityTolerance}\n\ndef video_max_bytes(height):\n    if height is not None and (abs(height - 360) <= QUALITY_TOLERANCE or abs(height - 720) <= QUALITY_TOLERANCE):\n        return STANDARD_VIDEO_MAX_BYTES\n    return PHASE_ONE_1080_MAX_BYTES\n`;
const typescript = `// Generated from download-size-policy.json. Do not edit manually.\nexport const LOCAL_STANDARD_VIDEO_MAX_BYTES = ${policy.standardVideoMiB} * 1024 * 1024;\nexport const LOCAL_1080_VIDEO_MAX_BYTES = ${policy.phaseOne1080VideoMiB} * 1024 * 1024;\nexport const LOCAL_AUDIO_MAX_BYTES = ${policy.audioMiB} * 1024 * 1024;\nexport const LOCAL_QUALITY_TOLERANCE = ${policy.qualityTolerance};\n\nexport function localVideoMaximumBytes(height: number | null): number {\n  return height !== null &&\n    (Math.abs(height - 360) <= LOCAL_QUALITY_TOLERANCE ||\n      Math.abs(height - 720) <= LOCAL_QUALITY_TOLERANCE)\n    ? LOCAL_STANDARD_VIDEO_MAX_BYTES\n    : LOCAL_1080_VIDEO_MAX_BYTES;\n}\n`;
const files = [
  [resolve(root, 'ios/MDDownloadSizePolicy.swift'), swift],
  [resolve(root, 'python/download_size_policy.py'), python],
  [
    resolve(import.meta.dirname, '../src/utils/downloadSizePolicy.ts'),
    await prettier.format(typescript, {
      parser: 'typescript',
      singleQuote: true,
    }),
  ],
];
for (const [path, contents] of files) {
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== contents)
      throw new Error(`Stale policy: ${path}`);
  } else {
    writeFileSync(path, contents);
  }
}
