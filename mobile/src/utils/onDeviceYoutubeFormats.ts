import type { LocalYoutubeVideoFormat } from '@/models/onDeviceYoutube';

export const LOCAL_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

const TARGET_HEIGHTS = [360, 720] as const;
const HEIGHT_TOLERANCE = 16;

function isCompatible(format: LocalYoutubeVideoFormat) {
  return (
    format.container.toLowerCase() === 'mp4' &&
    format.directDownload &&
    !format.hasAudio &&
    format.height !== null &&
    /^(avc1|h264)/i.test(format.codec ?? '') &&
    (format.protocol === null || format.protocol.toLowerCase() === 'https') &&
    (format.estimatedSize === null ||
      format.estimatedSize <= LOCAL_VIDEO_MAX_BYTES)
  );
}

function compareCandidates(
  targetHeight: number,
  left: LocalYoutubeVideoFormat,
  right: LocalYoutubeVideoFormat,
) {
  const leftDistance = Math.abs((left.height ?? 0) - targetHeight);
  const rightDistance = Math.abs((right.height ?? 0) - targetHeight);
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;

  const leftKnownSize = left.estimatedSize !== null;
  const rightKnownSize = right.estimatedSize !== null;
  if (leftKnownSize !== rightKnownSize) return leftKnownSize ? -1 : 1;

  if (left.estimatedSize !== right.estimatedSize) {
    return (left.estimatedSize ?? Infinity) - (right.estimatedSize ?? Infinity);
  }

  return left.id.localeCompare(right.id);
}

export function selectLocalVideoOptions(
  formats: LocalYoutubeVideoFormat[],
): LocalYoutubeVideoFormat[] {
  const compatible = formats.filter(isCompatible);
  const selected = TARGET_HEIGHTS.map(
    (targetHeight) =>
      compatible
        .filter(
          (format) =>
            Math.abs((format.height ?? 0) - targetHeight) <= HEIGHT_TOLERANCE,
        )
        .sort((left, right) => compareCandidates(targetHeight, left, right))[0],
  ).filter((format): format is LocalYoutubeVideoFormat => Boolean(format));

  return selected.filter(
    (format, index) =>
      selected.findIndex((candidate) => candidate.id === format.id) === index,
  );
}
