// Generated from download-size-policy.json. Do not edit manually.
export const LOCAL_STANDARD_VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
export const LOCAL_1080_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const LOCAL_AUDIO_MAX_BYTES = 250 * 1024 * 1024;
export const LOCAL_QUALITY_TOLERANCE = 16;

export function localVideoMaximumBytes(height: number | null): number {
  return height !== null &&
    (Math.abs(height - 360) <= LOCAL_QUALITY_TOLERANCE ||
      Math.abs(height - 720) <= LOCAL_QUALITY_TOLERANCE)
    ? LOCAL_STANDARD_VIDEO_MAX_BYTES
    : LOCAL_1080_VIDEO_MAX_BYTES;
}
