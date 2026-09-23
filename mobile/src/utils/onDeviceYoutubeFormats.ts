import type {
  LocalYoutubeAudioFormat,
  LocalYoutubeVideoFormat,
} from '@/models/onDeviceYoutube';

export const LOCAL_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const LOCAL_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

const TARGET_HEIGHTS = [360, 720] as const;
const HEIGHT_TOLERANCE = 16;

function isDirectVideo(format: LocalYoutubeVideoFormat) {
  return (
    format.container.toLowerCase() === 'mp4' &&
    format.directDownload &&
    !format.hasAudio &&
    format.height !== null &&
    /^(avc1|h264)/i.test(format.codec ?? '') &&
    (format.protocol === null || format.protocol.toLowerCase() === 'https')
  );
}

export function isVideoWithinLimit(format: LocalYoutubeVideoFormat) {
  return (
    format.estimatedSize === null ||
    format.estimatedSize <= LOCAL_VIDEO_MAX_BYTES
  );
}

export function isDirectAudio(format: LocalYoutubeAudioFormat) {
  return (
    format.container.toLowerCase() === 'm4a' &&
    format.directDownload &&
    format.hasAudio &&
    /^(mp4a\.|aac)/i.test(format.codec ?? '') &&
    (format.protocol === null || format.protocol.toLowerCase() === 'https')
  );
}

export function isAudioWithinLimit(format: LocalYoutubeAudioFormat) {
  return (
    format.estimatedSize === null ||
    format.estimatedSize <= LOCAL_AUDIO_MAX_BYTES
  );
}

export type LocalVideoQualityChoice = {
  format: LocalYoutubeVideoFormat;
  withinLimit: boolean;
};

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
  return localVideoQualityChoices(formats)
    .filter((choice) => choice.withinLimit)
    .map((choice) => choice.format);
}

export function localVideoQualityChoices(
  formats: LocalYoutubeVideoFormat[],
): LocalVideoQualityChoice[] {
  const compatible = formats.filter(isDirectVideo);
  const selected = TARGET_HEIGHTS.map(
    (targetHeight) =>
      compatible
        .filter(
          (format) =>
            Math.abs((format.height ?? 0) - targetHeight) <= HEIGHT_TOLERANCE,
        )
        .sort((left, right) => {
          if (isVideoWithinLimit(left) !== isVideoWithinLimit(right))
            return isVideoWithinLimit(left) ? -1 : 1;
          return compareCandidates(targetHeight, left, right);
        })[0],
  ).filter((format): format is LocalYoutubeVideoFormat => Boolean(format));

  return selected
    .filter(
      (format, index) =>
        selected.findIndex((candidate) => candidate.id === format.id) === index,
    )
    .map((format) => ({ format, withinLimit: isVideoWithinLimit(format) }));
}
