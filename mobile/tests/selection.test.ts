import {
  availableDownloadTypes,
  initialSelection,
  isSelectionComplete,
  reduceSelection,
} from '@/models/selection';
import { demoMedia } from './fixtures/media';

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
  expect(audio).toEqual({ type: 'AUDIO_ONLY', audioIndex: null });
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
    isSelectionComplete({ type: 'AUDIO_ONLY', audioIndex: 99 }, demoMedia),
  ).toBe(false);
});

test('audio-only ignores video events', () => {
  const selection = { type: 'AUDIO_ONLY', audioIndex: 0 } as const;
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
  });
});
