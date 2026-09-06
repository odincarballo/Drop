import type {
  AudioOutputBitrate,
  AudioOutputFormat,
  DownloadRequest,
  DownloadType,
  MediaAnalysis,
} from './media';

export type DownloadSelection =
  | {
      type: 'VIDEO_AUDIO';
      videoIndex: number | null;
      audioIndex: number | null;
    }
  | { type: 'VIDEO_ONLY'; videoIndex: number | null }
  | {
      type: 'AUDIO_ONLY';
      audioIndex: number | null;
      audioOutputFormat: AudioOutputFormat | null;
      audioBitrate: AudioOutputBitrate | null;
    };

export type SelectionEvent =
  | { kind: 'type'; value: DownloadType }
  | { kind: 'video'; index: number }
  | { kind: 'audio'; index: number }
  | { kind: 'audioOutput'; value: AudioOutputFormat }
  | { kind: 'audioBitrate'; value: AudioOutputBitrate };

export function availableDownloadTypes(media: MediaAnalysis): DownloadType[] {
  const hasVideo = media.videoFormats.length > 0;
  const hasAudio = media.audioFormats.length > 0;
  const hasCombinedVideo = media.videoFormats.some(
    (format) => format.hasAudio === true,
  );
  if (media.source === 'direct') {
    if (hasVideo) return ['VIDEO_AUDIO'];
    if (hasAudio) return ['AUDIO_ONLY'];
    return [];
  }
  return [
    ...(hasVideo && (hasAudio || hasCombinedVideo)
      ? (['VIDEO_AUDIO'] as const)
      : []),
    ...(hasVideo ? (['VIDEO_ONLY'] as const) : []),
    ...(hasAudio ? (['AUDIO_ONLY'] as const) : []),
  ];
}

export function initialSelection(media?: MediaAnalysis): DownloadSelection {
  const initialType = media ? availableDownloadTypes(media)[0] : 'VIDEO_AUDIO';
  const videoIndex =
    media?.source === 'youtube' ? preferredVideoIndex(media) : null;
  const audioIndex =
    media?.source === 'youtube' ? preferredAudioIndex(media) : null;
  switch (initialType) {
    case 'AUDIO_ONLY':
      return {
        type: initialType,
        audioIndex,
        audioOutputFormat: media?.source === 'youtube' ? 'M4A' : null,
        audioBitrate: null,
      };
    case 'VIDEO_ONLY':
      return { type: initialType, videoIndex };
    default:
      return { type: 'VIDEO_AUDIO', videoIndex, audioIndex };
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
        return {
          type: event.value,
          audioIndex:
            audioIndex ??
            (media.source === 'youtube' ? preferredAudioIndex(media) : null),
          audioOutputFormat: media.source === 'youtube' ? 'M4A' : null,
          audioBitrate: null,
        };
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
  if (event.kind === 'audioOutput' && selection.type === 'AUDIO_ONLY') {
    return {
      ...selection,
      audioIndex: preferredAudioIndex(media, event.value),
      audioOutputFormat: event.value,
      audioBitrate:
        event.value === 'MP3' ? (selection.audioBitrate ?? 192000) : null,
    };
  }
  if (
    event.kind === 'audioBitrate' &&
    selection.type === 'AUDIO_ONLY' &&
    selection.audioOutputFormat === 'MP3'
  ) {
    return { ...selection, audioBitrate: event.value };
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
    media.source === 'youtube' &&
    selection.videoIndex !== null &&
    media.videoFormats[selection.videoIndex]?.hasAudio === true
      ? true
      : false) ||
    (selection.type === 'VIDEO_AUDIO' &&
    media.source === 'direct' &&
    media.audioFormats.length === 0
      ? true
      : isValidIndex(selection.audioIndex, media.audioFormats.length));
  const outputReady =
    selection.type !== 'AUDIO_ONLY' ||
    media.source !== 'youtube' ||
    (selection.audioOutputFormat !== null &&
      (selection.audioOutputFormat !== 'MP3' ||
        selection.audioBitrate !== null));
  return videoReady && audioReady && outputReady;
}

export function selectedFormatId(
  selection: DownloadSelection,
  media: MediaAnalysis,
): string | null {
  if ('videoIndex' in selection && selection.videoIndex !== null) {
    const format = media.videoFormats[selection.videoIndex];
    return format?.formatId ?? format?.id ?? null;
  }
  if ('audioIndex' in selection && selection.audioIndex !== null) {
    const format = media.audioFormats[selection.audioIndex];
    return format?.formatId ?? format?.id ?? null;
  }
  return null;
}

export function selectedDownloadRequest(
  media: MediaAnalysis,
  selection: DownloadSelection,
): DownloadRequest | null {
  const formatId = selectedFormatId(selection, media);
  if (!formatId || !isSelectionComplete(selection, media)) return null;
  const request: DownloadRequest = {
    mediaId: media.id,
    downloadType: selection.type,
    formatId,
  };
  if (selection.type === 'VIDEO_AUDIO' && selection.audioIndex !== null) {
    const audio = media.audioFormats[selection.audioIndex];
    request.audioFormatId = audio?.formatId ?? audio?.id;
  }
  if (selection.type === 'AUDIO_ONLY' && media.source === 'youtube') {
    if (selection.audioOutputFormat)
      request.audioOutputFormat = selection.audioOutputFormat;
    if (selection.audioBitrate) request.audioBitrate = selection.audioBitrate;
  }
  return request;
}

export function preferredVideoIndex(media: MediaAnalysis): number | null {
  const candidates = media.videoFormats
    .map((format, index) => ({
      index,
      height:
        format.height ??
        (format.resolution
          ? Number(/(?:^|x)(\d+)(?:p)?$/i.exec(format.resolution)?.[1])
          : Number.NaN),
    }))
    .filter(
      ({ height }) => Number.isFinite(height) && height > 0 && height <= 1080,
    );
  if (candidates.length === 0) return media.source === 'direct' ? 0 : null;
  const exact = candidates.find(({ height }) => height === 720);
  if (exact) return exact.index;
  const lower = candidates
    .filter(({ height }) => height < 720)
    .sort((a, b) => b.height - a.height)[0];
  if (lower) return lower.index;
  return candidates.sort((a, b) => a.height - b.height)[0]?.index ?? null;
}

export function preferredAudioIndex(
  media: MediaAnalysis,
  output: AudioOutputFormat = 'M4A',
): number | null {
  if (media.audioFormats.length === 0) return null;
  return (
    media.audioFormats
      .map((format, index) => ({ format, index }))
      .sort(
        (a, b) =>
          (output === 'M4A'
            ? Number(b.format.container?.toLowerCase() === 'm4a') -
              Number(a.format.container?.toLowerCase() === 'm4a')
            : 0) || (b.format.bitrate ?? 0) - (a.format.bitrate ?? 0),
      )[0]?.index ?? null
  );
}

export function estimatedSelectionSize(
  media: MediaAnalysis,
  selection: DownloadSelection,
): number | null {
  if (!isSelectionComplete(selection, media)) return null;
  if (selection.type === 'VIDEO_ONLY') {
    return (
      media.videoFormats[selection.videoIndex ?? -1]?.estimatedSize ?? null
    );
  }
  if (selection.type === 'AUDIO_ONLY') {
    if (
      media.source === 'youtube' &&
      selection.audioOutputFormat === 'MP3' &&
      selection.audioBitrate !== null &&
      media.duration !== null
    ) {
      return Math.round((media.duration * selection.audioBitrate) / 8);
    }
    return (
      media.audioFormats[selection.audioIndex ?? -1]?.estimatedSize ?? null
    );
  }
  const video = media.videoFormats[selection.videoIndex ?? -1];
  if (!video) return null;
  if (media.source !== 'youtube' || video.hasAudio === true) {
    return video.estimatedSize;
  }
  const audio = media.audioFormats[selection.audioIndex ?? -1];
  return video.estimatedSize !== null && audio?.estimatedSize != null
    ? video.estimatedSize + audio.estimatedSize
    : null;
}
