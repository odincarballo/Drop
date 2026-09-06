import {
  availableDownloadTypes,
  estimatedSelectionSize,
  initialSelection,
  isSelectionComplete,
  reduceSelection,
  selectedDownloadRequest,
} from '@/models/selection';
import { demoMedia, youtubeMedia } from './fixtures/media';

test('initial mode is video + audio with no quality silently chosen', () => {
  const selection = initialSelection();
  expect(selection).toEqual({
    type: 'VIDEO_AUDIO',
    videoIndex: null,
    audioIndex: null,
  });
  expect(isSelectionComplete(selection, demoMedia)).toBe(false);
});

test('requires both formats and accepts index zero', () => {
  let selection = reduceSelection(
    initialSelection(),
    { kind: 'video', index: 0 },
    demoMedia,
  );
  expect(isSelectionComplete(selection, demoMedia)).toBe(false);
  selection = reduceSelection(
    selection,
    { kind: 'audio', index: 0 },
    demoMedia,
  );
  expect(isSelectionComplete(selection, demoMedia)).toBe(true);
});

test('mode changes discard inapplicable fields and preserve applicable selection', () => {
  const both = { type: 'VIDEO_AUDIO', videoIndex: 2, audioIndex: 1 } as const;
  const video = reduceSelection(
    both,
    { kind: 'type', value: 'VIDEO_ONLY' },
    demoMedia,
  );
  expect(video).toEqual({ type: 'VIDEO_ONLY', videoIndex: 2 });
  expect(isSelectionComplete(video, demoMedia)).toBe(true);
  const audio = reduceSelection(
    video,
    { kind: 'type', value: 'AUDIO_ONLY' },
    demoMedia,
  );
  expect(audio).toEqual({
    type: 'AUDIO_ONLY',
    audioIndex: null,
    audioOutputFormat: null,
    audioBitrate: null,
  });
  expect(isSelectionComplete(audio, demoMedia)).toBe(false);
  expect(
    isSelectionComplete(
      reduceSelection(audio, { kind: 'audio', index: 1 }, demoMedia),
      demoMedia,
    ),
  ).toBe(true);
});

test.each([-1, 3, 0.5, NaN])('ignores invalid video index %s', (index) => {
  expect(
    reduceSelection(initialSelection(), { kind: 'video', index }, demoMedia),
  ).toEqual(initialSelection());
});

test('empty lists and out-of-range selections cannot enable downloading', () => {
  const selected = {
    type: 'VIDEO_AUDIO',
    videoIndex: 0,
    audioIndex: 0,
  } as const;
  expect(
    isSelectionComplete(selected, { ...demoMedia, audioFormats: [] }),
  ).toBe(false);
  expect(
    isSelectionComplete(selected, { ...demoMedia, videoFormats: [] }),
  ).toBe(false);
  expect(
    isSelectionComplete(
      {
        type: 'AUDIO_ONLY',
        audioIndex: 99,
        audioOutputFormat: null,
        audioBitrate: null,
      },
      demoMedia,
    ),
  ).toBe(false);
});

test('audio-only ignores video events', () => {
  const selection = {
    type: 'AUDIO_ONLY',
    audioIndex: 0,
    audioOutputFormat: null,
    audioBitrate: null,
  } as const;
  expect(
    reduceSelection(selection, { kind: 'video', index: 1 }, demoMedia),
  ).toEqual(selection);
});

test('direct video exposes only its intact format and direct audio starts audio-only', () => {
  const directVideo = { ...demoMedia, source: 'direct', audioFormats: [] };
  expect(availableDownloadTypes(directVideo)).toEqual(['VIDEO_AUDIO']);
  const selectedVideo = reduceSelection(
    initialSelection(directVideo),
    { kind: 'video', index: 0 },
    directVideo,
  );
  expect(isSelectionComplete(selectedVideo, directVideo)).toBe(true);

  const directAudio = {
    ...demoMedia,
    source: 'direct',
    videoFormats: [],
  };
  expect(initialSelection(directAudio)).toEqual({
    type: 'AUDIO_ONLY',
    audioIndex: null,
    audioOutputFormat: null,
    audioBitrate: null,
  });
});

test('YouTube selects real 720p and best compatible audio by default', () => {
  const selection = initialSelection(youtubeMedia);
  expect(selection).toEqual({
    type: 'VIDEO_AUDIO',
    videoIndex: 1,
    audioIndex: 0,
  });
  expect(availableDownloadTypes(youtubeMedia)).toEqual([
    'VIDEO_AUDIO',
    'VIDEO_ONLY',
    'AUDIO_ONLY',
  ]);
  expect(isSelectionComplete(selection, youtubeMedia)).toBe(true);
  expect(selectedDownloadRequest(youtubeMedia, selection)).toEqual({
    mediaId: 'youtube-demo',
    downloadType: 'VIDEO_AUDIO',
    formatId: '136',
    audioFormatId: '140',
  });
  expect(estimatedSelectionSize(youtubeMedia, selection)).toBe(23000000);
});

test('YouTube progressive video does not require a separate audio stream', () => {
  const media = { ...youtubeMedia, audioFormats: [] };
  const selection = {
    type: 'VIDEO_AUDIO',
    videoIndex: 0,
    audioIndex: null,
  } as const;
  expect(availableDownloadTypes(media)).toContain('VIDEO_AUDIO');
  expect(isSelectionComplete(selection, media)).toBe(true);
  expect(estimatedSelectionSize(media, selection)).toBe(8000000);
});

test('YouTube video-only request keeps the selected real format id', () => {
  const selection = reduceSelection(
    initialSelection(youtubeMedia),
    { kind: 'type', value: 'VIDEO_ONLY' },
    youtubeMedia,
  );
  expect(selectedDownloadRequest(youtubeMedia, selection)).toEqual({
    mediaId: 'youtube-demo',
    downloadType: 'VIDEO_ONLY',
    formatId: '136',
  });
  expect(estimatedSelectionSize(youtubeMedia, selection)).toBe(20000000);
});

test('YouTube M4A and MP3 keep explicit, typed output choices', () => {
  const audio = reduceSelection(
    initialSelection(youtubeMedia),
    { kind: 'type', value: 'AUDIO_ONLY' },
    youtubeMedia,
  );
  expect(selectedDownloadRequest(youtubeMedia, audio)).toEqual({
    mediaId: 'youtube-demo',
    downloadType: 'AUDIO_ONLY',
    formatId: '140',
    audioOutputFormat: 'M4A',
  });

  const mp3 = reduceSelection(
    audio,
    { kind: 'audioOutput', value: 'MP3' },
    youtubeMedia,
  );
  expect(selectedDownloadRequest(youtubeMedia, mp3)).toEqual({
    mediaId: 'youtube-demo',
    downloadType: 'AUDIO_ONLY',
    formatId: '251',
    audioOutputFormat: 'MP3',
    audioBitrate: 192000,
  });
  expect(estimatedSelectionSize(youtubeMedia, mp3)).toBe(3696000);
  const mp3At256 = reduceSelection(
    mp3,
    { kind: 'audioBitrate', value: 256000 },
    youtubeMedia,
  );
  expect(selectedDownloadRequest(youtubeMedia, mp3At256)).toMatchObject({
    audioBitrate: 256000,
  });
});

test('YouTube never selects 4K automatically when no 720p-or-lower option exists', () => {
  const only4k = {
    ...youtubeMedia,
    videoFormats: youtubeMedia.videoFormats.slice(3, 4),
  };
  expect(initialSelection(only4k)).toEqual({
    type: 'VIDEO_AUDIO',
    videoIndex: null,
    audioIndex: 0,
  });
});
