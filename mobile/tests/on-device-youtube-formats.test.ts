import type {
  LocalYoutubeAudioFormat,
  LocalYoutubeVideoFormat,
} from '@/models/onDeviceYoutube';
import {
  isAudioWithinLimit,
  isDirectAudio,
  localVideoQualityChoices,
  LOCAL_AUDIO_MAX_BYTES,
  LOCAL_VIDEO_MAX_BYTES,
  selectLocalVideoOptions,
} from '@/utils/onDeviceYoutubeFormats';

const video: LocalYoutubeVideoFormat = {
  id: 'dynamic-video',
  container: 'mp4',
  codec: 'avc1.4d401e',
  resolution: '364p',
  height: 364,
  width: 640,
  fps: 30,
  hasAudio: false,
  bitrateKbps: 900,
  estimatedSize: 1_000_000,
  protocol: 'https',
  directDownload: true,
};

const audio: LocalYoutubeAudioFormat = {
  id: 'dynamic-audio',
  container: 'm4a',
  codec: 'mp4a.40.2',
  resolution: null,
  height: null,
  width: null,
  fps: null,
  hasAudio: true,
  bitrateKbps: 128,
  estimatedSize: 2_000_000,
  protocol: 'https',
  directDownload: true,
};

test('keeps real 364p and dynamically selects direct 720p over HLS', () => {
  const direct720 = {
    ...video,
    id: 'dynamic-720',
    resolution: '720p',
    height: 720,
  };
  const hls720 = {
    ...direct720,
    id: 'manifest-format',
    protocol: 'm3u8_native',
    directDownload: false,
  };
  const choices = localVideoQualityChoices([hls720, direct720, video]);
  expect(choices.map(({ format }) => [format.id, format.resolution])).toEqual([
    ['dynamic-video', '364p'],
    ['dynamic-720', '720p'],
  ]);
  expect(
    selectLocalVideoOptions([hls720, direct720, video]).map((item) => item.id),
  ).toEqual(['dynamic-video', 'dynamic-720']);
});

test('known video above 50 MiB stays visible but cannot be selected', () => {
  const oversized = {
    ...video,
    estimatedSize: LOCAL_VIDEO_MAX_BYTES + 1,
  };
  expect(localVideoQualityChoices([oversized])).toEqual([
    { format: oversized, withinLimit: false },
  ]);
  expect(selectLocalVideoOptions([oversized])).toEqual([]);
});

test('unknown sizes remain eligible and audio limit is per track', () => {
  expect(
    selectLocalVideoOptions([{ ...video, estimatedSize: null }]),
  ).toHaveLength(1);
  expect(isDirectAudio({ ...audio, estimatedSize: null })).toBe(true);
  expect(isAudioWithinLimit({ ...audio, estimatedSize: null })).toBe(true);
  expect(
    isAudioWithinLimit({ ...audio, estimatedSize: LOCAL_AUDIO_MAX_BYTES + 1 }),
  ).toBe(false);
  expect(
    isDirectAudio({ ...audio, protocol: 'm3u8_native', directDownload: false }),
  ).toBe(false);
});
