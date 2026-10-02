import type {
  LocalYoutubeAudioFormat,
  LocalYoutubeVideoFormat,
} from '@/models/onDeviceYoutube';
import {
  isAudioWithinLimit,
  isDirectAudio,
  localVideoQualityChoices,
  phaseOne1080UnavailabilityReason,
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

const direct1080: LocalYoutubeVideoFormat = {
  ...video,
  id: 'dynamic-1080',
  resolution: '1080p',
  height: 1080,
  width: 1920,
  codec: 'avc1.640028',
  dynamicRange: 'SDR',
  exactSize: 35 * 1024 * 1024,
  estimatedSize: 35 * 1024 * 1024,
  fps: 24,
};

test.each([24, 30])('1080p direct H.264 SDR at %i fps is eligible', (fps) => {
  const candidate = { ...direct1080, fps };
  expect(selectLocalVideoOptions([candidate])).toEqual([candidate]);
});

test.each([null, undefined, 'unknown', 'UNKNOWN'])(
  '1080p direct H.264 with dynamic range %s remains eligible without claiming SDR',
  (dynamicRange) => {
    const candidate = { ...direct1080, dynamicRange };
    expect(selectLocalVideoOptions([candidate])).toEqual([candidate]);
    expect(phaseOne1080UnavailabilityReason(candidate)).toBeNull();
    expect(candidate.dynamicRange).not.toBe('SDR');
  },
);

test('1080p keeps real height, coexists with 720p, and never uses format IDs as policy', () => {
  const near1080 = {
    ...direct1080,
    id: 'opaque-video',
    height: 1084,
    resolution: '1084p',
  };
  const direct720 = {
    ...video,
    id: 'opaque-720',
    height: 720,
    resolution: '720p',
  };
  expect(
    localVideoQualityChoices([direct720, near1080]).map(
      ({ format }) => format.resolution,
    ),
  ).toEqual(['720p', '1084p']);
  expect(selectLocalVideoOptions([direct720, near1080])).toEqual([
    direct720,
    near1080,
  ]);
});

test('1080p known over limit is visible but disabled; unknown exact size is not eligible', () => {
  const oversized = {
    ...direct1080,
    exactSize: LOCAL_VIDEO_MAX_BYTES + 1,
    estimatedSize: LOCAL_VIDEO_MAX_BYTES + 1,
  };
  const unknown = { ...direct1080, exactSize: null, estimatedSize: 10_000_000 };
  expect(localVideoQualityChoices([oversized])[0]).toEqual({
    format: oversized,
    withinLimit: false,
  });
  expect(phaseOne1080UnavailabilityReason(oversized)).toContain('50 MiB');
  expect(selectLocalVideoOptions([unknown])).toEqual([]);
  expect(phaseOne1080UnavailabilityReason(unknown)).toContain('Tamaño exacto');
});

test.each([
  { dynamicRange: 'HDR10' },
  { dynamicRange: 'HLG' },
  { dynamicRange: 'DV' },
  { fps: null },
  { fps: 50 },
  { fps: 60 },
  { container: 'webm', codec: 'vp9' },
  { codec: 'av01.0.08M.08' },
  { protocol: 'm3u8_native', directDownload: false },
])('incompatible 1080p is hidden while 720p stays available: %o', (change) => {
  const direct720 = {
    ...video,
    id: 'dynamic-720',
    height: 720,
    resolution: '720p',
  };
  expect(
    selectLocalVideoOptions([direct720, { ...direct1080, ...change }]),
  ).toEqual([direct720]);
});
