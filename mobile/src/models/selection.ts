import type { DownloadType, MediaAnalysis } from './media';

export type DownloadSelection =
  | {
      type: 'VIDEO_AUDIO';
      videoIndex: number | null;
      audioIndex: number | null;
    }
  | { type: 'VIDEO_ONLY'; videoIndex: number | null }
  | { type: 'AUDIO_ONLY'; audioIndex: number | null };

export type SelectionEvent =
  | { kind: 'type'; value: DownloadType }
  | { kind: 'video'; index: number }
  | { kind: 'audio'; index: number };

export function availableDownloadTypes(media: MediaAnalysis): DownloadType[] {
  const hasVideo = media.videoFormats.length > 0;
  const hasAudio = media.audioFormats.length > 0;
  if (media.source === 'direct') {
    if (hasVideo) return ['VIDEO_AUDIO'];
    if (hasAudio) return ['AUDIO_ONLY'];
    return [];
  }
  return [
    ...(hasVideo && hasAudio ? (['VIDEO_AUDIO'] as const) : []),
    ...(hasVideo ? (['VIDEO_ONLY'] as const) : []),
    ...(hasAudio ? (['AUDIO_ONLY'] as const) : []),
  ];
}

export function initialSelection(media?: MediaAnalysis): DownloadSelection {
  const initialType = media ? availableDownloadTypes(media)[0] : 'VIDEO_AUDIO';
  switch (initialType) {
    case 'AUDIO_ONLY':
      return { type: initialType, audioIndex: null };
    case 'VIDEO_ONLY':
      return { type: initialType, videoIndex: null };
    default:
      return { type: 'VIDEO_AUDIO', videoIndex: null, audioIndex: null };
  }
}

function isValidIndex(index: number | null, length: number): index is number {
  return (
    index !== null && Number.isInteger(index) && index >= 0 && index < length
  );
}

export function reduceSelection(
  selection: DownloadSelection,
  event: SelectionEvent,
  media: MediaAnalysis,
): DownloadSelection {
  if (event.kind === 'type') {
    if (!availableDownloadTypes(media).includes(event.value)) return selection;
    const videoIndex = 'videoIndex' in selection ? selection.videoIndex : null;
    const audioIndex = 'audioIndex' in selection ? selection.audioIndex : null;
    switch (event.value) {
      case 'VIDEO_AUDIO':
        return { type: event.value, videoIndex, audioIndex };
      case 'VIDEO_ONLY':
        return { type: event.value, videoIndex };
      case 'AUDIO_ONLY':
        return { type: event.value, audioIndex };
    }
  }
  if (
    event.kind === 'video' &&
    'videoIndex' in selection &&
    isValidIndex(event.index, media.videoFormats.length)
  ) {
    return { ...selection, videoIndex: event.index };
  }
  if (
    event.kind === 'audio' &&
    'audioIndex' in selection &&
    isValidIndex(event.index, media.audioFormats.length)
  ) {
    return { ...selection, audioIndex: event.index };
  }
  return selection;
}

export function isSelectionComplete(
  selection: DownloadSelection,
  media: MediaAnalysis,
): boolean {
  const videoReady =
    !('videoIndex' in selection) ||
    isValidIndex(selection.videoIndex, media.videoFormats.length);
  const audioReady =
    !('audioIndex' in selection) ||
    (selection.type === 'VIDEO_AUDIO' &&
    media.source === 'direct' &&
    media.audioFormats.length === 0
      ? true
      : isValidIndex(selection.audioIndex, media.audioFormats.length));
  return videoReady && audioReady;
}

export function selectedFormatId(
  selection: DownloadSelection,
  media: MediaAnalysis,
): string | null {
  if ('videoIndex' in selection && selection.videoIndex !== null) {
    return media.videoFormats[selection.videoIndex]?.id ?? null;
  }
  if ('audioIndex' in selection && selection.audioIndex !== null) {
    return media.audioFormats[selection.audioIndex]?.id ?? null;
  }
  return null;
}
