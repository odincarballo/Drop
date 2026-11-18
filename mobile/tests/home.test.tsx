import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Clipboard from 'expo-clipboard';
import { fetch as partialFetch } from 'expo/fetch';
import { createHash } from 'node:crypto';

import HomeScreenView from '@/app/download';
import { MainNavigation } from '@/components/MainNavigation';
import {
  DownloadSessionProvider,
  useDownloadSession,
} from '@/providers/DownloadSessionProvider';
import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, type AppStateStatus } from 'react-native';
import type { MediaAnalysis } from '@/models/media';
import { ApiError } from '@/services/errors';
import {
  appendDownloadPartial,
  reserveDownloadPartial,
} from '@/services/downloadRecovery';
import {
  publishDownloadAsset,
  stagePartialDownloadAsset,
} from '@/services/library';
import { analyzeMedia } from '@/services/media';
import {
  createDownloadJob,
  deleteDownloadJob,
  deleteLocalFile,
  downloadJobFile,
  getDownloadJob,
  shareLocalFile,
} from '@/services/jobs';
import { demoMedia, youtubeMedia } from './fixtures/media';
import {
  allowDownloadWrites,
  readRawDownloadRecovery,
  rejectDownloadWrite,
  resetDownloadRecoveryFixture,
  seedDownloadRecovery,
} from './support/downloadRecoverySQLite';
import { RealSQLite } from './support/realSQLite';

function HomeScreen() {
  return (
    <DownloadSessionProvider>
      <HomeScreenView />
      <MainNavigation />
    </DownloadSessionProvider>
  );
}

jest.mock('@/services/media', () => ({ analyzeMedia: jest.fn() }));
jest.mock('@/services/fileExport', () => ({
  saveLocalFileToFiles: jest.fn(),
  withNamedLibraryFile: jest.fn((_item, operation) =>
    operation('file:///library/clip.mp4'),
  ),
}));
jest.mock('@/services/library', () => ({
  publishDownloadAsset: jest.fn(),
  stagePartialDownloadAsset: jest.fn(),
  stageDownloadAsset: jest.fn(
    async (_key: string, file: { sizeBytes: number }) => ({
      id: '00000000-0000-0000-0000-000000000001',
      ext: 'mp4',
      sha256: 'c'.repeat(64),
      sizeBytes: file.sizeBytes,
    }),
  ),
  withLibraryLease: jest.fn((_id, operation) =>
    operation({ uri: 'file:///library/clip.mp4' }),
  ),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
  usePathname: () => '/download',
}));
jest.mock('@/components/MiniPlayer', () => ({ MiniPlayer: () => null }));
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('@/services/jobs', () => ({
  createDownloadJob: jest.fn(),
  getDownloadJob: jest.fn(),
  deleteDownloadJob: jest.fn(),
  downloadJobFile: jest.fn(),
  shareLocalFile: jest.fn(),
  deleteLocalFile: jest.fn(),
}));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  getItemAsync: jest
    .fn()
    .mockResolvedValue('test-token-0123456789abcdef0123456789abcdef'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const appStateListeners = new Set<(state: AppStateStatus) => void>();

beforeEach(async () => {
  AppState.currentState = 'active';
  appStateListeners.clear();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, handler) => {
      const listener = handler as (state: AppStateStatus) => void;
      if (type === 'change') appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    });
  await resetDownloadRecoveryFixture();
  jest
    .mocked(publishDownloadAsset)
    .mockReset()
    .mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      uri: 'file:///library/clip.mp4',
      sizeBytes: 1_000_000,
    } as never);
  jest.mocked(requireOptionalNativeModule).mockReset().mockReturnValue(null);
  jest.mocked(analyzeMedia).mockReset().mockResolvedValue(demoMedia);
  jest
    .mocked(Clipboard.getStringAsync)
    .mockReset()
    .mockResolvedValue('https://example.com/video.mp4');
  jest.mocked(deleteDownloadJob).mockResolvedValue({
    id: 'job-1',
    status: 'CANCELLED',
    progress: null,
    bytesDownloaded: 0,
    totalBytes: null,
    fileName: null,
    fileSize: null,
    error: null,
    downloadUrl: null,
  });
});

const localYoutubeMetadata = {
  metadata: {
    id: 'AWGPaFraPN4',
    analysisId: 'a'.repeat(32),
    preferredAudioFormatId: '140',
    preferredVideoFormatId: '134',
    title: 'YouTube local',
    duration: 121,
    thumbnail: null,
    videoFormats: [
      {
        id: '134',
        container: 'mp4',
        codec: 'avc1.4d401e',
        resolution: '360p',
        height: 360,
        width: 640,
        fps: 30,
        hasAudio: false,
        bitrateKbps: null,
        estimatedSize: 586796,
        protocol: null,
        directDownload: true,
      },
    ],
    audioFormats: [
      {
        id: '140',
        container: 'm4a',
        codec: 'mp4a.40.2',
        resolution: null,
        height: null,
        width: null,
        fps: null,
        hasAudio: true,
        bitrateKbps: 129,
        estimatedSize: 2_000_000,
        protocol: null,
        directDownload: true,
      },
    ],
    resolutions: [360],
  },
  deviceRuntime: 'ios-device',
  engine: 'CPython / QuickJS-NG',
  jsChallengeCalls: 0,
  networkRequests: 3,
};

function localYoutubeNativeEngine() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    downloadForegroundGeneration: jest.fn(() => 7),
    analyze: jest.fn().mockResolvedValue(JSON.stringify(localYoutubeMetadata)),
    startAudioDownload: jest.fn(),
    cancelAudioDownload: jest.fn(),
    startVideoDownload: jest.fn(),
    cancelVideoDownload: jest.fn(),
    startCombinedDownload: jest.fn(),
    cancelCombinedDownload: jest.fn(),
    cancel: jest.fn(),
    addListener: jest.fn((name: string, listener: (event: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return { remove: jest.fn(() => listeners.get(name)!.delete(listener)) };
    }),
    emit: (name: string, event: unknown) =>
      listeners.get(name)?.forEach((listener) => listener(event)),
    listenerCount: () =>
      [...listeners.values()].reduce(
        (count, entries) => count + entries.size,
        0,
      ),
  };
}

async function analyzeExample() {
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://example.com/video.mp4',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
}

async function analyzeYoutube() {
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://www.youtube.com/watch?v=AWGPaFraPN4',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
}

test('YouTube uses the on-device engine and never calls Render', async () => {
  const native = localYoutubeNativeEngine();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByText('YouTube local')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Analizar' })).toHaveLength(1);
  expect(screen.getByRole('radio', { name: /360p/ })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Video + audio' })).toBeChecked();
  expect(screen.queryByText('YouTube · prueba local')).toBeNull();
  expect(native.analyze).toHaveBeenCalledWith(
    'https://www.youtube.com/watch?v=AWGPaFraPN4',
  );
  expect(analyzeMedia).not.toHaveBeenCalled();
});

test('technical details show diagnostics without laboratory controls', async () => {
  const native = localYoutubeNativeEngine();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByText('YouTube local')).toBeTruthy();
  expect(screen.getByText('Modo de descarga')).toBeTruthy();
  expect(screen.queryByText(/CPython \/ QuickJS-NG/)).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Detalles técnicos' }),
  );
  expect(screen.getByText(/CPython \/ QuickJS-NG/)).toBeTruthy();
  expect(screen.getByText(/ID: AWGPaFraPN4/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Probar EJS/ })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Probar puente EJS/QuickJS' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Descargar .* en este iPhone/ }),
  ).toBeNull();
  expect(screen.queryByText('Resolución de prueba')).toBeNull();
});

test('YouTube never falls back to Render when the native engine is absent', async () => {
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(
    await screen.findByText(/Actualiza Drop para analizar este enlace/),
  ).toBeTruthy();
  expect(analyzeMedia).not.toHaveBeenCalled();
  expect(createDownloadJob).not.toHaveBeenCalled();
});

test('changing the URL immediately clears local metadata and prevents stale downloads', async () => {
  const native = localYoutubeNativeEngine();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByText('YouTube local')).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://example.com/video.mp4',
  );
  expect(screen.queryByText('YouTube local')).toBeNull();
  expect(screen.queryByRole('radio', { name: /360p/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Descargar' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(analyzeMedia).toHaveBeenCalledTimes(1);
  expect(native.startCombinedDownload).not.toHaveBeenCalled();
});

test('pasting a new URL also clears the previous YouTube selection', async () => {
  const native = localYoutubeNativeEngine();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByText('YouTube local')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Pegar' }));
  expect(
    screen.getByDisplayValue('https://example.com/video.mp4'),
  ).toBeTruthy();
  expect(screen.queryByText('YouTube local')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Descargar' })).toBeNull();
});

test('normal YouTube flow uses real 364p and direct 720p, never HLS', async () => {
  const native = localYoutubeNativeEngine();
  native.analyze.mockResolvedValue(
    JSON.stringify({
      ...localYoutubeMetadata,
      metadata: {
        ...localYoutubeMetadata.metadata,
        preferredVideoFormatId: 'direct-364',
        videoFormats: [
          {
            ...localYoutubeMetadata.metadata.videoFormats[0],
            id: 'direct-364',
            height: 364,
            resolution: '364p',
          },
          {
            ...localYoutubeMetadata.metadata.videoFormats[0],
            id: 'direct-720',
            height: 720,
            resolution: '720p',
          },
          {
            ...localYoutubeMetadata.metadata.videoFormats[0],
            id: 'hls-720',
            height: 720,
            resolution: '720p',
            protocol: 'm3u8_native',
            directDownload: false,
          },
        ],
      },
    }),
  );
  native.startCombinedDownload.mockReturnValue(
    '7D628D93-DC67-4729-83AD-B8EF70877A87',
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByRole('radio', { name: /364p/ })).toBeChecked();
  expect(screen.queryByRole('radio', { name: /360p/ })).toBeNull();
  expect(screen.getAllByRole('radio', { name: /720p/ })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('radio', { name: /720p/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startCombinedDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    'direct-720',
    '140',
    121,
    null,
    2_000_000,
    7,
  );
  expect(analyzeMedia).not.toHaveBeenCalled();
});

test.each(['Video + audio', 'Solo video'] as const)(
  'normal 1080p flow sends the selected direct stream to %s',
  async (mode) => {
    const native = localYoutubeNativeEngine();
    native.analyze.mockResolvedValue(
      JSON.stringify({
        ...localYoutubeMetadata,
        metadata: {
          ...localYoutubeMetadata.metadata,
          videoFormats: [
            ...localYoutubeMetadata.metadata.videoFormats,
            {
              ...localYoutubeMetadata.metadata.videoFormats[0],
              id: 'opaque-1080',
              height: 1080,
              width: 1920,
              resolution: '1080p',
              codec: 'avc1.640028',
              fps: 24,
              dynamicRange: 'SDR',
              exactSize: 35 * 1024 * 1024,
              estimatedSize: 35 * 1024 * 1024,
            },
          ],
          resolutions: [360, 1080],
        },
      }),
    );
    native.startCombinedDownload.mockReturnValue(
      '7D628D93-DC67-4729-83AD-B8EF70877A87',
    );
    native.startVideoDownload.mockReturnValue(
      'A5371425-C825-4B4E-BAB1-C83E99D9ACF5',
    );
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
    await render(<HomeScreen />);
    await analyzeYoutube();
    expect(await screen.findByRole('radio', { name: /1080p/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: /1080p/ }));
    if (mode === 'Solo video') {
      await fireEvent.press(screen.getByRole('radio', { name: mode }));
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    if (mode === 'Solo video') {
      expect(native.startVideoDownload).toHaveBeenCalledWith(
        'a'.repeat(32),
        'opaque-1080',
        7,
      );
    } else {
      expect(native.startCombinedDownload).toHaveBeenCalledWith(
        'a'.repeat(32),
        'opaque-1080',
        '140',
        121,
        null,
        2_000_000,
        7,
      );
      await act(() =>
        native.emit('onCombinedDownloadState', {
          jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
          status: 'RETRYING_VIDEO',
          retryCategory: 'connection',
          bytesDownloaded: 262144,
        }),
      );
      expect(
        screen.getByText('Problema de conexión. Reintentando…'),
      ).toBeTruthy();
    }
    expect(analyzeMedia).not.toHaveBeenCalled();
  },
);

test('oversized 1080p is visible but cannot be selected', async () => {
  const native = localYoutubeNativeEngine();
  native.analyze.mockResolvedValue(
    JSON.stringify({
      ...localYoutubeMetadata,
      metadata: {
        ...localYoutubeMetadata.metadata,
        videoFormats: [
          ...localYoutubeMetadata.metadata.videoFormats,
          {
            ...localYoutubeMetadata.metadata.videoFormats[0],
            id: 'large-1080',
            height: 1080,
            resolution: '1080p',
            codec: 'avc1.640028',
            dynamicRange: 'SDR',
            exactSize: 51 * 1024 * 1024,
            estimatedSize: 51 * 1024 * 1024,
          },
        ],
      },
    }),
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByRole('radio', { name: /1080p/ })).toBeDisabled();
  expect(screen.getByText('Supera el límite de 50 MiB')).toBeTruthy();
  expect(screen.getByRole('radio', { name: /360p/ })).toBeChecked();
});

test('normal YouTube modes dispatch video-only and audio-only to the local engine', async () => {
  const native = localYoutubeNativeEngine();
  native.startVideoDownload.mockReturnValue(
    'A5371425-C825-4B4E-BAB1-C83E99D9ACF5',
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  await screen.findByText('YouTube local');
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo video' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startVideoDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '134',
    7,
  );
  expect(createDownloadJob).not.toHaveBeenCalled();
});

test('normal YouTube progress, cancellation, audio-only and sharing stay on-device', async () => {
  const native = localYoutubeNativeEngine();
  const combinedJob = '7D628D93-DC67-4729-83AD-B8EF70877A87';
  const audioJob = 'D2A73B11-8703-4FB1-8612-8AC3C477C42F';
  native.startCombinedDownload.mockReturnValue(combinedJob);
  native.startAudioDownload.mockReturnValue(audioJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  jest.mocked(shareLocalFile).mockResolvedValue();
  await render(<HomeScreen />);
  await analyzeYoutube();
  await screen.findByText('YouTube local');
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await act(() =>
    native.emit('onCombinedDownloadState', {
      jobId: combinedJob,
      status: 'DOWNLOADING_VIDEO',
      bytesDownloaded: 500_000,
      totalBytes: 1_000_000,
      progress: 0.5,
    }),
  );
  expect(screen.getByText(/Descargando video… 500 KB \/ 1 MB/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar descarga' }),
  );
  expect(native.cancelCombinedDownload).toHaveBeenCalledTimes(1);
  await act(() =>
    native.emit('onCombinedDownloadState', {
      jobId: combinedJob,
      status: 'CANCELLED',
    }),
  );
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startAudioDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '140',
    121,
    7,
  );
  await act(() =>
    native.emit('onAudioDownloadState', {
      jobId: audioJob,
      status: 'COMPLETED',
      formatId: '140',
      container: 'm4a',
      codec: 'mp4a.40.2',
      fileName: 'audio.m4a',
      fileSize: 2_000_000,
      localUri: 'file:///cache/audio.m4a',
    }),
  );
  expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Más opciones' }));
  expect(shareLocalFile).toHaveBeenCalledWith('file:///library/clip.mp4');
  expect(createDownloadJob).not.toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://example.com/video.mp4',
  );
  expect(deleteLocalFile).not.toHaveBeenCalledWith('file:///library/clip.mp4');
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
});

test('unknown local stream sizes remain downloadable', async () => {
  const native = localYoutubeNativeEngine();
  native.analyze.mockResolvedValue(
    JSON.stringify({
      ...localYoutubeMetadata,
      metadata: {
        ...localYoutubeMetadata.metadata,
        videoFormats: [
          {
            ...localYoutubeMetadata.metadata.videoFormats[0],
            estimatedSize: null,
          },
        ],
        audioFormats: [
          {
            ...localYoutubeMetadata.metadata.audioFormats[0],
            estimatedSize: null,
          },
        ],
      },
    }),
  );
  native.startAudioDownload.mockReturnValue(
    'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByText('YouTube local')).toBeTruthy();
  expect(screen.getAllByText(/Tamaño no disponible/).length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startAudioDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '140',
    121,
    7,
  );
});

test('known oversized tracks are blocked, while unknown sizes are allowed', async () => {
  const native = localYoutubeNativeEngine();
  native.analyze.mockResolvedValue(
    JSON.stringify({
      ...localYoutubeMetadata,
      metadata: {
        ...localYoutubeMetadata.metadata,
        preferredAudioFormatId: null,
        videoFormats: [
          {
            ...localYoutubeMetadata.metadata.videoFormats[0],
            estimatedSize: 1024 * 1024 * 1024 + 1,
          },
        ],
        audioFormats: [
          {
            ...localYoutubeMetadata.metadata.audioFormats[0],
            estimatedSize: 250 * 1024 * 1024 + 1,
          },
        ],
      },
    }),
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  expect(await screen.findByRole('radio', { name: /360p/ })).toBeDisabled();
  expect(
    screen.getByText(/Esta calidad supera el límite actual de Drop/),
  ).toBeTruthy();
  expect(
    screen.getByText(/El audio supera el límite actual de Drop/),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
});

test('a direct URL still uses the authenticated Render API', async () => {
  const native = localYoutubeNativeEngine();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeExample();
  expect(analyzeMedia).toHaveBeenCalledWith(
    'https://example.com/video.mp4',
    expect.any(AbortSignal),
  );
  expect(native.analyze).not.toHaveBeenCalled();
});

test('paste → analyze → resource → qualities → mock remains non-downloadable', async () => {
  await render(<HomeScreen />);
  expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Pegar' }));
  expect(
    screen.getByDisplayValue('https://example.com/video.mp4'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(analyzeMedia).toHaveBeenCalledWith(
    'https://example.com/video.mp4',
    expect.any(AbortSignal),
  );
  expect(screen.getByText('MediaDrop Demo Video')).toBeTruthy();
  expect(screen.getByText(/2:34/)).toBeTruthy();
  expect(screen.getByText('Fuente: Mock Provider')).toBeTruthy();
  expect(screen.getByLabelText('Miniatura del recurso')).toHaveProp('source', {
    uri: demoMedia.thumbnail,
  });
  expect(screen.getByRole('radio', { name: 'Video + audio' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: /1080p/ }));
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: /AAC · 256 kbps/ }));
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Los datos simulados no contienen un archivo descargable.',
  );
  expect(analyzeMedia).toHaveBeenCalledTimes(1);
});

test('direct file downloads to iPhone storage and can be shared', async () => {
  const directMedia: MediaAnalysis = {
    id: 'direct-media',
    title: 'clip.mp4',
    thumbnail: null,
    duration: null,
    source: 'direct',
    estimatedSize: 12,
    videoFormats: [
      {
        id: 'format-original',
        resolution: 'Original',
        container: 'mp4',
        codec: null,
        hasAudio: null,
        estimatedSize: 12,
      },
    ],
    audioFormats: [],
  };
  const completedJob = {
    id: 'b'.repeat(32),
    status: 'COMPLETED' as const,
    progress: 1,
    bytesDownloaded: 12,
    totalBytes: 12,
    fileName: 'clip.mp4',
    fileSize: 12,
    error: null,
    downloadUrl: '/jobs/' + 'b'.repeat(32) + '/file',
  };
  jest.mocked(analyzeMedia).mockResolvedValue(directMedia);
  jest.mocked(createDownloadJob).mockResolvedValue(completedJob);
  jest
    .mocked(downloadJobFile)
    .mockImplementation(async (_job, _signal, progress) => {
      progress(12, 12);
      return { uri: 'file:///cache/clip.mp4', size: 12 };
    });
  jest.mocked(shareLocalFile).mockResolvedValue();

  await render(<HomeScreen />);
  await analyzeExample();
  expect(screen.getByRole('radio', { name: 'Video + audio' })).toBeChecked();
  expect(screen.queryByRole('radio', { name: 'Solo video' })).toBeNull();
  await fireEvent.press(screen.getByRole('radio', { name: /Original/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(await screen.findByText('✓ Descarga completada')).toBeTruthy();
  expect(createDownloadJob).toHaveBeenCalledWith(
    {
      mediaId: 'direct-media',
      downloadType: 'VIDEO_AUDIO',
      formatId: 'format-original',
    },
    expect.any(AbortSignal),
    expect.any(Function),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Más opciones' }));
  expect(shareLocalFile).toHaveBeenCalledWith('file:///library/clip.mp4');
});

test('a direct transfer finishing after cancellation cannot become a completed result', async () => {
  const directMedia: MediaAnalysis = {
    id: 'direct-media',
    title: 'clip.mp4',
    thumbnail: null,
    duration: null,
    source: 'direct',
    estimatedSize: 12,
    videoFormats: [
      {
        id: 'format-original',
        resolution: 'Original',
        container: 'mp4',
        codec: null,
        hasAudio: null,
        estimatedSize: 12,
      },
    ],
    audioFormats: [],
  };
  const completedJob = {
    id: 'b'.repeat(32),
    status: 'COMPLETED' as const,
    progress: 1,
    bytesDownloaded: 12,
    totalBytes: 12,
    fileName: 'clip.mp4',
    fileSize: 12,
    error: null,
    downloadUrl: '/jobs/' + 'b'.repeat(32) + '/file',
  };
  let finishTransfer!: (value: { uri: string; size: number }) => void;
  jest.mocked(analyzeMedia).mockResolvedValue(directMedia);
  jest.mocked(createDownloadJob).mockResolvedValue(completedJob);
  jest.mocked(downloadJobFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishTransfer = resolve;
      }),
  );

  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent.press(screen.getByRole('radio', { name: /Original/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await waitFor(() => expect(downloadJobFile).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  await act(() => {
    finishTransfer({ uri: 'file:///cache/late.mp4', size: 12 });
  });
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
  expect(deleteLocalFile).toHaveBeenCalledWith('file:///cache/late.mp4');
});

test('YouTube offers real resolution, automatic audio, M4A and MP3 output', async () => {
  const completedJob = {
    id: 'c'.repeat(32),
    status: 'COMPLETED' as const,
    phase: 'FINALIZING' as const,
    progress: 1,
    bytesDownloaded: 23000000,
    totalBytes: 23000000,
    fileName: 'Authorized YouTube video.mp4',
    fileSize: 22500000,
    error: null,
    downloadUrl: '/jobs/' + 'c'.repeat(32) + '/file',
    message: 'Descarga completada',
  };
  jest.mocked(analyzeMedia).mockResolvedValue(youtubeMedia);
  jest.mocked(createDownloadJob).mockResolvedValue(completedJob);
  jest.mocked(downloadJobFile).mockResolvedValue({
    uri: 'file:///cache/youtube.mp4',
    size: 22500000,
  });

  await render(<HomeScreen />);
  await analyzeExample();
  expect(screen.getByText('Fuente: YouTube')).toBeTruthy();
  expect(screen.getByRole('radio', { name: /720p/ })).toBeChecked();
  expect(screen.getByText('Mejor pista compatible disponible')).toBeTruthy();
  expect(screen.getByText('Tamaño estimado: ~23 MB')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(await screen.findByText('✓ Descarga completada')).toBeTruthy();
  expect(createDownloadJob).toHaveBeenLastCalledWith(
    {
      mediaId: 'youtube-demo',
      downloadType: 'VIDEO_AUDIO',
      formatId: '136',
      audioFormatId: '140',
    },
    expect.any(AbortSignal),
    expect.any(Function),
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Nueva descarga' }));
  await analyzeExample();
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  expect(screen.getByRole('radio', { name: 'M4A' })).toBeChecked();
  await fireEvent.press(screen.getByRole('radio', { name: 'MP3' }));
  expect(screen.getByRole('radio', { name: '192 kbps' })).toBeChecked();
  await fireEvent.press(screen.getByRole('radio', { name: '256 kbps' }));
  expect(screen.getByText('Bitrate de salida')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(createDownloadJob).toHaveBeenLastCalledWith(
    {
      mediaId: 'youtube-demo',
      downloadType: 'AUDIO_ONLY',
      formatId: '251',
      audioOutputFormat: 'MP3',
      audioBitrate: 256000,
    },
    expect.any(AbortSignal),
    expect.any(Function),
  );
});

test('each single-track mode requires only its own quality', async () => {
  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo video' }));
  expect(screen.queryByText('Calidad de audio')).toBeNull();
  await fireEvent.press(screen.getByRole('radio', { name: /360p/ }));
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  expect(screen.queryByText('Calidad de video')).toBeNull();
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: /AAC · 128 kbps/ }));
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
});

test('rejects an empty or invalid URL without a request', async () => {
  await render(<HomeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Pega o escribe una URL para analizar.',
  );
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'invalid',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    /Introduce una URL completa/,
  );
  expect(analyzeMedia).not.toHaveBeenCalled();
});

test('loading disables repeated analysis and paste', async () => {
  let resolveRequest: ((data: MediaAnalysis) => void) | undefined;
  jest.mocked(analyzeMedia).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );
  await render(<HomeScreen />);
  await analyzeExample();
  const button = screen.getByRole('button', { name: 'Analizando…' });
  expect(button).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Pegar' })).toBeDisabled();
  await fireEvent.press(button);
  expect(analyzeMedia).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveRequest?.(demoMedia);
  });
  expect(screen.getByRole('button', { name: 'Analizar' })).toBeEnabled();
});

test('new URL and analysis reset resource and selection', async () => {
  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent.press(screen.getByRole('radio', { name: /720p/ }));
  await fireEvent.press(screen.getByRole('radio', { name: /AAC · 128 kbps/ }));
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://example.com/other.mp4',
  );
  expect(screen.queryByRole('button', { name: 'Descargar' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
});

test('nullable fields and empty formats remain usable', async () => {
  jest.mocked(analyzeMedia).mockResolvedValue({
    ...demoMedia,
    title: null,
    thumbnail: null,
    source: null,
    duration: null,
    videoFormats: [],
    audioFormats: [],
  });
  await render(<HomeScreen />);
  await analyzeExample();
  expect(screen.queryByText('Sin título')).toBeNull();
  expect(screen.queryByText('Miniatura no disponible')).toBeNull();
  expect(screen.queryByText(/Duración desconocida/)).toBeNull();
  expect(screen.queryByText('Fuente: Fuente desconocida')).toBeNull();
  expect(
    screen.getByText('No hay formatos de video disponibles.'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
});

test('thumbnail errors show a fallback without removing selection', async () => {
  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent(screen.getByLabelText('Miniatura del recurso'), 'error');
  expect(screen.getByText('Miniatura no disponible')).toBeTruthy();
  expect(screen.getByRole('radio', { name: /720p/ })).toBeTruthy();
});

test('unsupported source message appears and the form can retry', async () => {
  jest
    .mocked(analyzeMedia)
    .mockRejectedValueOnce(
      new ApiError('UNSUPPORTED_URL', 'Esta fuente todavía no es compatible.'),
    );
  await render(<HomeScreen />);
  await analyzeExample();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Esta fuente todavía no es compatible.',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(screen.getByText('MediaDrop Demo Video')).toBeTruthy();
});

test('clipboard denial leaves manual input available', async () => {
  jest.mocked(Clipboard.getStringAsync).mockResolvedValue('');
  await render(<HomeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Pegar' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    /No se pudo leer texto\./,
  );
  await analyzeExample();
  expect(screen.getByText('MediaDrop Demo Video')).toBeTruthy();
});

// Real screen and hooks; only external I/O is mocked. The route is actually
// removed, not merely hidden, while its session owner remains mounted.
let session: ReturnType<typeof useDownloadSession>;
function SessionRoutes() {
  const currentSession = useDownloadSession();
  useEffect(() => {
    session = currentSession;
  }, [currentSession]);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    mockPush.mockImplementation(() => setVisible(false));
    return () => {
      mockPush.mockReset();
    };
  }, []);
  return visible ? (
    <HomeScreenView />
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Volver a Descargar"
      onPress={() => setVisible(true)}
    >
      <Text>Biblioteca temporal</Text>
    </Pressable>
  );
}
function NavigableSession() {
  return (
    <DownloadSessionProvider>
      <SessionRoutes />
      <MainNavigation />
    </DownloadSessionProvider>
  );
}
async function leaveDownload() {
  await fireEvent.press(screen.getByRole('tab', { name: 'Biblioteca' }));
  expect(screen.queryByLabelText('URL del recurso multimedia')).toBeNull();
}
async function returnToDownload() {
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Descargar' }),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const completedDirectJob = {
  id: 'ac'.repeat(16),
  status: 'COMPLETED' as const,
  progress: 1,
  bytesDownloaded: 12,
  totalBytes: 12,
  fileName: 'clip.mp4',
  fileSize: 12,
  error: null,
  downloadUrl: '/jobs/' + 'ac'.repeat(16) + '/file',
};
const navigationDirectMedia: MediaAnalysis = {
  ...demoMedia,
  source: 'direct',
  audioFormats: [],
  videoFormats: [
    { ...demoMedia.videoFormats[0]!, id: 'original', hasAudio: true },
  ],
};
const nativeJob = '7D628D93-DC67-4729-83AD-B8EF70877A87';
const completeNative = {
  jobId: nativeJob,
  status: 'COMPLETED',
  formatId: '140',
  container: 'm4a',
  codec: 'mp4a.40.2',
  fileName: 'fixture.mp4',
  fileSize: 1_000_000,
  localUri: 'file:///cache/fixture.mp4',
  durationSeconds: 121,
};

async function startNavigableAudio() {
  const native = localYoutubeNativeEngine();
  native.startAudioDownload.mockReturnValue(nativeJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  const view = await render(<NavigableSession />);
  await analyzeYoutube();
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  return { native, view };
}

test.each(['local', 'backend'] as const)(
  'active %s analysis survives route removal and returns its result',
  async (engine) => {
    const native = localYoutubeNativeEngine();
    const pending = deferred<string>();
    const backend = deferred<MediaAnalysis>();
    native.analyze.mockReturnValue(pending.promise);
    jest.mocked(analyzeMedia).mockReturnValue(backend.promise);
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
    const view = await render(<NavigableSession />);
    if (engine === 'local') await analyzeYoutube();
    else await analyzeExample();
    await leaveDownload();
    expect(native.cancel).not.toHaveBeenCalled();
    if (engine === 'backend')
      expect(jest.mocked(analyzeMedia).mock.calls[0]![1]?.aborted).toBe(false);
    await act(() => {
      pending.resolve(JSON.stringify(localYoutubeMetadata));
      backend.resolve(demoMedia);
    });
    await returnToDownload();
    expect(
      screen.getByText(
        engine === 'local' ? 'YouTube local' : 'MediaDrop Demo Video',
      ),
    ).toBeTruthy();
    expect(native.analyze).toHaveBeenCalledTimes(engine === 'local' ? 1 : 0);
    expect(analyzeMedia).toHaveBeenCalledTimes(engine === 'backend' ? 1 : 0);
    expect(native.addListener).toHaveBeenCalledTimes(3);
    await view.unmount();
    expect(native.listenerCount()).toBe(0);
  },
);

test.each([
  ['Solo audio', 'onAudioDownloadState', 'startAudioDownload', 'audioState'],
  ['Solo video', 'onVideoDownloadState', 'startVideoDownload', 'videoState'],
  [
    'Video + audio',
    'onCombinedDownloadState',
    'startCombinedDownload',
    'combinedState',
  ],
] as const)(
  '%s retains one job, selection, progress and one promotion across routes',
  async (label, event, start, state) => {
    const native = localYoutubeNativeEngine();
    native[start].mockReturnValue(nativeJob);
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
    const view = await render(<NavigableSession />);
    await analyzeYoutube();
    await fireEvent.press(screen.getByRole('radio', { name: label }));
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    await leaveDownload();
    await act(() =>
      native.emit(event, {
        jobId: nativeJob,
        status: state === 'combinedState' ? 'DOWNLOADING_VIDEO' : 'DOWNLOADING',
        formatId: state === 'audioState' ? '140' : '134',
        bytesDownloaded: 500_000,
        totalBytes: 1_000_000,
        progress: 0.5,
      }),
    );
    await returnToDownload();
    expect(screen.getByRole('radio', { name: label })).toBeChecked();
    expect(screen.getByText(/500 KB \/ 1 MB/)).toBeTruthy();
    expect(session.spike[state]).toMatchObject({
      jobId: nativeJob,
      progress: 0.5,
    });
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    expect(native[start]).toHaveBeenCalledTimes(1);
    await leaveDownload();
    const saved = deferred<Awaited<ReturnType<typeof publishDownloadAsset>>>();
    jest.mocked(publishDownloadAsset).mockReturnValueOnce(saved.promise);
    await act(() => {
      native.emit(event, {
        ...completeNative,
        container: state === 'audioState' ? 'm4a' : 'mp4',
        formatId: state === 'audioState' ? '140' : '134',
      });
      native.emit(event, {
        ...completeNative,
        container: state === 'audioState' ? 'm4a' : 'mp4',
        formatId: state === 'audioState' ? '140' : '134',
      });
    });
    expect(session.spike[state].status).toBe('saving');
    expect(publishDownloadAsset).toHaveBeenCalledTimes(1);
    await returnToDownload();
    expect(screen.getByText('Guardando en Biblioteca…')).toBeTruthy();
    await act(() =>
      saved.resolve({
        id: 'saved-once',
        uri: 'file:///library/saved.mp4',
        sizeBytes: 1_000_000,
      } as never),
    );
    expect(session.spike[state]).toMatchObject({
      status: 'completed',
      libraryId: 'saved-once',
    });
    await leaveDownload();
    await returnToDownload();
    expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
    expect(native.addListener).toHaveBeenCalledTimes(3);
    expect(native.cancelAudioDownload).not.toHaveBeenCalled();
    expect(native.cancelVideoDownload).not.toHaveBeenCalled();
    expect(native.cancelCombinedDownload).not.toHaveBeenCalled();
    await view.unmount();
    expect(native.listenerCount()).toBe(0);
  },
);

test('video selection survives navigation without resubscribing and supplies promotion metadata', async () => {
  const native = localYoutubeNativeEngine();
  native.analyze.mockResolvedValue(
    JSON.stringify({
      ...localYoutubeMetadata,
      metadata: {
        ...localYoutubeMetadata.metadata,
        videoFormats: [
          ...localYoutubeMetadata.metadata.videoFormats,
          {
            ...localYoutubeMetadata.metadata.videoFormats[0],
            id: '720',
            resolution: '720p',
            height: 720,
            width: 1280,
          },
        ],
      },
    }),
  );
  native.startCombinedDownload.mockReturnValue(nativeJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<NavigableSession />);
  await analyzeYoutube();
  await fireEvent.press(screen.getByRole('radio', { name: /720p/ }));
  await leaveDownload();
  await returnToDownload();
  expect(screen.getByRole('radio', { name: /720p/ })).toBeChecked();
  expect(native.addListener).toHaveBeenCalledTimes(3);
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await act(() => native.emit('onCombinedDownloadState', completeNative));
  expect(publishDownloadAsset).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ sizeBytes: completeNative.fileSize }),
    expect.objectContaining({ resolution: '720p' }),
  );
});

test('direct transfer keeps selection/progress while away and promotes exactly once', async () => {
  jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
  jest.mocked(createDownloadJob).mockResolvedValue(completedDirectJob);
  const transfer = deferred<{ uri: string; size: number }>();
  jest.mocked(downloadJobFile).mockReturnValue(transfer.promise);
  await render(<NavigableSession />);
  await analyzeExample();
  await fireEvent.press(screen.getByRole('radio', { name: /360p/ }));
  const selection =
    session.state.status === 'success' ? session.state.selection : null;
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await waitFor(() => expect(downloadJobFile).toHaveBeenCalledTimes(1));
  await leaveDownload();
  await act(() => jest.mocked(downloadJobFile).mock.calls[0]![2](6, 12));
  expect(jest.mocked(downloadJobFile).mock.calls[0]![1].aborted).toBe(false);
  await returnToDownload();
  expect(session.state).toMatchObject({ selection });
  expect(session.download.state).toMatchObject({
    status: 'transferring',
    bytesDownloaded: 6,
  });
  await leaveDownload();
  await act(() =>
    transfer.resolve({ uri: 'file:///cache/clip.mp4', size: 12 }),
  );
  await returnToDownload();
  expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
  expect(session.download.state).toMatchObject({
    libraryId: '00000000-0000-0000-0000-000000000001',
  });
  expect(createDownloadJob).toHaveBeenCalledTimes(1);
  expect(downloadJobFile).toHaveBeenCalledTimes(1);
  expect(publishDownloadAsset).toHaveBeenCalledTimes(1);
});

test('explicit cancellation after returning ignores late native completion', async () => {
  const { native } = await startNavigableAudio();
  await leaveDownload();
  await returnToDownload();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar descarga' }),
  );
  await act(() => native.emit('onAudioDownloadState', completeNative));
  expect(native.cancelAudioDownload).toHaveBeenCalledTimes(1);
  expect(session.spike.audioState.status).toBe('cancelled');
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('explicit analysis cancellation invalidates a response arriving after a new analysis', async () => {
  const native = localYoutubeNativeEngine();
  const old = deferred<string>();
  native.analyze.mockReturnValueOnce(old.promise);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<NavigableSession />);
  await analyzeYoutube();
  await leaveDownload();
  await returnToDownload();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar análisis' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await act(() =>
    old.resolve(
      JSON.stringify({
        ...localYoutubeMetadata,
        metadata: { ...localYoutubeMetadata.metadata, title: 'Stale response' },
      }),
    ),
  );
  expect(screen.getByText('YouTube local')).toBeTruthy();
  expect(screen.queryByText('Stale response')).toBeNull();
  expect(native.cancel).toHaveBeenCalledTimes(1);
});

test.each(['local', 'backend'] as const)(
  'URL replacement ignores late %s results',
  async (engine) => {
    const native = localYoutubeNativeEngine();
    const local = deferred<string>();
    const backend = deferred<MediaAnalysis>();
    native.analyze.mockReturnValueOnce(local.promise);
    if (engine === 'backend')
      jest.mocked(analyzeMedia).mockReturnValueOnce(backend.promise);
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
    await render(<NavigableSession />);
    if (engine === 'local') await analyzeYoutube();
    else await analyzeExample();
    await leaveDownload();
    await act(() => session.changeUrl('https://example.com/new.mp4'));
    await act(() => session.runAnalysis());
    await act(() => {
      local.resolve(JSON.stringify(localYoutubeMetadata));
      backend.resolve({ ...demoMedia, title: 'Stale response' });
    });
    await returnToDownload();
    expect(
      screen.getByLabelText('URL del recurso multimedia'),
    ).toHaveDisplayValue('https://example.com/new.mp4');
    expect(screen.getByText('MediaDrop Demo Video')).toBeTruthy();
    expect(screen.queryByText('Stale response')).toBeNull();
    expect(screen.queryByText('YouTube local')).toBeNull();
  },
);

test('an expired native session requests reanalysis after navigation without retry or promotion', async () => {
  const { native } = await startNavigableAudio();
  await leaveDownload();
  await act(() =>
    native.emit('onAudioDownloadState', {
      jobId: nativeJob,
      status: 'FAILED',
      errorCode: 'ANALYSIS_NOT_FOUND',
    }),
  );
  await returnToDownload();
  expect(screen.getByText(/El análisis local caducó/)).toBeTruthy();
  expect(native.startAudioDownload).toHaveBeenCalledTimes(1);
  expect(publishDownloadAsset).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(native.analyze).toHaveBeenCalledTimes(2);
});

test.each(['analysis', 'download'] as const)(
  'full session teardown cancels %s and releases its observers',
  async (operation) => {
    const native = localYoutubeNativeEngine();
    const pending = deferred<string>();
    if (operation === 'analysis')
      native.analyze.mockReturnValue(pending.promise);
    native.startAudioDownload.mockReturnValue(nativeJob);
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
    const view = await render(<NavigableSession />);
    await analyzeYoutube();
    if (operation === 'download') {
      await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    }
    await leaveDownload();
    expect(native.listenerCount()).toBe(3);
    await view.unmount();
    expect(native.listenerCount()).toBe(0);
    expect(
      operation === 'analysis' ? native.cancel : native.cancelAudioDownload,
    ).toHaveBeenCalledTimes(1);
    await act(() => {
      pending.resolve(JSON.stringify(localYoutubeMetadata));
      native.emit('onAudioDownloadState', completeNative);
    });
    expect(publishDownloadAsset).not.toHaveBeenCalled();
  },
);

test.each(['cancel', 'teardown'] as const)(
  'direct transfer %s aborts only on explicit cancellation or full teardown',
  async (action) => {
    jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
    jest.mocked(createDownloadJob).mockResolvedValue(completedDirectJob);
    const transfer = deferred<{ uri: string; size: number }>();
    jest.mocked(downloadJobFile).mockReturnValue(transfer.promise);
    const view = await render(<NavigableSession />);
    await analyzeExample();
    await fireEvent.press(screen.getByRole('radio', { name: /360p/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(downloadJobFile).toHaveBeenCalledTimes(1));
    const signal = jest.mocked(downloadJobFile).mock.calls[0]![1];
    await leaveDownload();
    expect(signal.aborted).toBe(false);
    if (action === 'cancel') {
      await returnToDownload();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    } else await view.unmount();
    expect(signal.aborted).toBe(true);
    if (action === 'cancel') {
      expect(deleteDownloadJob).toHaveBeenCalledWith(completedDirectJob.id);
    } else {
      expect(deleteDownloadJob).not.toHaveBeenCalled();
      await render(<HomeScreen />);
      expect(
        await screen.findByRole('button', { name: 'Continuar consulta' }),
      ).toBeTruthy();
      expect(createDownloadJob).toHaveBeenCalledTimes(1);
    }
    await act(() =>
      transfer.resolve({ uri: 'file:///cache/late-route.mp4', size: 12 }),
    );
    expect(deleteLocalFile).toHaveBeenCalledWith(
      'file:///cache/late-route.mp4',
    );
    expect(publishDownloadAsset).not.toHaveBeenCalled();
  },
);

test.each(['success', 'failure'] as const)(
  'late %s of cancelled job creation cannot replace the new transfer',
  async (outcome) => {
    jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
    const oldCreation = deferred<typeof completedDirectJob>();
    jest
      .mocked(createDownloadJob)
      .mockReturnValueOnce(oldCreation.promise)
      .mockResolvedValue({ ...completedDirectJob, id: 'd'.repeat(32) });
    const transfer = deferred<{ uri: string; size: number }>();
    jest.mocked(downloadJobFile).mockReturnValue(transfer.promise);
    await render(<NavigableSession />);
    await analyzeExample();
    await fireEvent.press(screen.getByRole('radio', { name: /360p/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    await leaveDownload();
    await returnToDownload();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(downloadJobFile).toHaveBeenCalledTimes(1));
    await act(() => {
      if (outcome === 'success') oldCreation.resolve(completedDirectJob);
      else oldCreation.reject(new Error('Late creation failure'));
    });
    expect(downloadJobFile).toHaveBeenCalledTimes(1);
    expect(session.download.state).toMatchObject({
      status: 'transferring',
      job: { id: 'd'.repeat(32) },
    });
    if (outcome === 'success')
      expect(deleteDownloadJob).toHaveBeenCalledWith(completedDirectJob.id);
    expect(deleteDownloadJob).not.toHaveBeenCalledWith('d'.repeat(32));
    await act(() =>
      transfer.resolve({ uri: 'file:///cache/new.mp4', size: 12 }),
    );
    expect(publishDownloadAsset).toHaveBeenCalledTimes(1);
  },
);

test('synchronous video and audio actions cannot start two native jobs', async () => {
  const native = localYoutubeNativeEngine();
  native.startVideoDownload.mockReturnValue(nativeJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<NavigableSession />);
  await analyzeYoutube();
  await act(() => {
    session.spike.downloadVideo();
    session.spike.downloadAudio();
  });
  expect(native.startVideoDownload).toHaveBeenCalledTimes(1);
  expect(native.startAudioDownload).not.toHaveBeenCalled();
});

const recoverableJobId = 'a'.repeat(32);
const persistedDownload = {
  version: 1,
  id: 'local-1',
  generation: 1,
  source: 'direct',
  selection: { mode: 'VIDEO_AUDIO' },
  status: 'pending',
  phase: 'transferring',
  bytes: 512,
  errorCode: null,
  remoteJobId: recoverableJobId,
};

async function prepareResumableFixture() {
  const first = new Uint8Array([1, 2, 3]);
  const last = new Uint8Array([4, 5, 6]);
  const hash = (bytes: Uint8Array) =>
    createHash('sha256').update(bytes).digest('hex');
  const fullHash = hash(new Uint8Array([...first, ...last]));
  const etag = `"sha256-${fullHash}"`;
  const verify = jest.fn().mockResolvedValue(undefined);
  const partial = {
    appendPartialDownload: jest
      .fn()
      .mockResolvedValueOnce({ confirmedBytes: 3, prefixSha256: hash(first) })
      .mockResolvedValueOnce({ confirmedBytes: 6, prefixSha256: fullHash }),
    verifyPartialDownload: verify,
    discardPartialDownload: jest.fn().mockResolvedValue(undefined),
  };
  jest
    .mocked(requireOptionalNativeModule)
    .mockImplementation((name) =>
      name === 'DropLibrary' ? (partial as never) : null,
    );
  await seedDownloadRecovery(JSON.stringify(persistedDownload));
  const reserved = (await reserveDownloadPartial(persistedDownload, {
    remoteJobId: recoverableJobId,
    totalBytes: 6,
    sha256: fullHash,
    etag,
  }))!;
  await appendDownloadPartial(reserved, first);
  jest.mocked(getDownloadJob).mockResolvedValue({
    ...completedDirectJob,
    id: recoverableJobId,
    fileSize: 6,
    fileSha256: fullHash,
    fileContentType: 'video/mp4',
    downloadUrl: `/jobs/${recoverableJobId}/file`,
  });
  const reader = {
    read: jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: last })
      .mockResolvedValueOnce({ done: true }),
    releaseLock: jest.fn(),
  };
  jest.mocked(partialFetch).mockResolvedValueOnce({
    status: 206,
    headers: new Map([
      ['etag', etag],
      ['content-range', 'bytes 3-5/6'],
      ['content-length', '3'],
      ['content-type', 'video/mp4'],
    ]),
    body: { getReader: () => reader },
  } as never);
  return { partial, hash, first, last, fullHash, etag, verify };
}

test('a verified checkpoint offers explicit resumption and commits the B handoff once', async () => {
  const { verify, hash, first, etag } = await prepareResumableFixture();
  await render(<HomeScreen />);
  const resume = await screen.findByRole('button', {
    name: 'Reanudar descarga',
  });
  expect(verify).toHaveBeenCalledWith('local-1.1', 3, hash(first));
  expect(getDownloadJob).not.toHaveBeenCalled();
  expect(partialFetch).not.toHaveBeenCalled();
  await fireEvent.press(resume);
  expect(
    await screen.findByText('Archivo guardado en Biblioteca.'),
  ).toBeTruthy();
  expect(partialFetch).toHaveBeenCalledTimes(1);
  expect(jest.mocked(partialFetch).mock.calls[0]?.[1]?.headers).toMatchObject({
    Range: 'bytes=3-5',
    'If-Range': etag,
  });
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(downloadJobFile).not.toHaveBeenCalled();
  expect(stagePartialDownloadAsset).toHaveBeenCalledTimes(1);
  expect(publishDownloadAsset).toHaveBeenCalledTimes(1);
});

test.each(['background', 'interrupt'] as const)(
  '%s during a resumed range retains its checkpoint and requires another explicit action',
  async (stop) => {
    const { partial } = await prepareResumableFixture();
    const started = deferred<void>();
    jest
      .mocked(partialFetch)
      .mockReset()
      .mockImplementationOnce(async (_url, options) => {
        started.resolve();
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('fixture aborted')),
            { once: true },
          );
        });
      });
    await render(<HomeScreen />);
    const button = await screen.findByRole('button', {
      name: 'Reanudar descarga',
    });
    await act(async () => {
      fireEvent.press(button);
      await started.promise;
    });
    if (stop === 'background') await act(() => changeAppState('background'));
    else
      await fireEvent.press(
        await screen.findByRole('button', { name: 'Interrumpir reanudación' }),
      );
    await screen.findByRole('button', { name: 'Reanudar descarga' });
    await act(() => changeAppState('active'));
    expect(partialFetch).toHaveBeenCalledTimes(1);
    expect(partial.appendPartialDownload).toHaveBeenCalledTimes(1);
    expect(publishDownloadAsset).not.toHaveBeenCalled();
    expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
      id: 'local-1',
      generation: 1,
    });
  },
);

test('expiration disables resume and keeps explicit retry and discard available', async () => {
  await prepareResumableFixture();
  jest
    .mocked(getDownloadJob)
    .mockRejectedValueOnce(new ApiError('JOB_NOT_FOUND', 'fixture expired'));
  await render(<HomeScreen />);
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Reanudar descarga' }),
  );
  await screen.findAllByText('El servidor ya no conserva esta descarga.');
  expect(
    screen.queryByRole('button', { name: 'Reanudar descarga' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Reintentar desde cero' }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();
  expect(partialFetch).not.toHaveBeenCalled();
  expect(createDownloadJob).not.toHaveBeenCalled();
});

test('reopening presents historical progress and queries an existing direct job only on request', async () => {
  await seedDownloadRecovery(JSON.stringify(persistedDownload));
  jest.mocked(getDownloadJob).mockResolvedValue({
    ...completedDirectJob,
    id: recoverableJobId,
  });
  await render(<HomeScreen />);
  expect(await screen.findByText('Descarga interrumpida')).toBeTruthy();
  expect(screen.getByText(/Progreso anterior/)).toBeTruthy();
  expect(getDownloadJob).not.toHaveBeenCalled();
  expect(createDownloadJob).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Continuar consulta' }),
  );
  expect(
    await screen.findByText('El servidor informa que el trabajo terminó.'),
  ).toBeTruthy();
  expect(getDownloadJob).toHaveBeenCalledWith(
    recoverableJobId,
    expect.any(AbortSignal),
  );
  expect(downloadJobFile).not.toHaveBeenCalled();
  expect(publishDownloadAsset).not.toHaveBeenCalled();
  expect(createDownloadJob).not.toHaveBeenCalled();
});

test('a vanished direct job offers a fresh link without creating a job', async () => {
  await seedDownloadRecovery(JSON.stringify(persistedDownload));
  jest
    .mocked(getDownloadJob)
    .mockRejectedValue(new ApiError('JOB_NOT_FOUND', 'private details'));
  await render(<HomeScreen />);
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Continuar consulta' }),
  );
  expect(
    await screen.findByText('El servidor ya no conserva esta descarga.'),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Continuar consulta' }),
  ).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reintentar desde cero' }),
  );
  expect(screen.getByLabelText('URL del recurso multimedia')).toBeTruthy();
  expect(createDownloadJob).not.toHaveBeenCalled();
});

test('a missing job ID shows uncertainty and restoration never submits a POST', async () => {
  await seedDownloadRecovery(
    JSON.stringify({
      ...persistedDownload,
      phase: 'creating',
      remoteJobId: null,
    }),
  );
  await render(<HomeScreen />);
  expect(
    await screen.findByText(
      'No se pudo confirmar si el servidor creó la descarga.',
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Continuar consulta' }),
  ).toBeNull();
  expect(createDownloadJob).not.toHaveBeenCalled();
});

test('an explicitly cancelled record cannot be resumed', async () => {
  await seedDownloadRecovery(
    JSON.stringify({
      ...persistedDownload,
      status: 'cancelled',
    }),
  );
  await render(<HomeScreen />);
  expect(await screen.findByText('Descarga cancelada')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Continuar consulta' }),
  ).toBeNull();
  expect(getDownloadJob).not.toHaveBeenCalled();
  expect(createDownloadJob).not.toHaveBeenCalled();
});

test.each([
  '{',
  JSON.stringify({ ...persistedDownload, generation: undefined }),
])(
  'an invalid recovery record leaves the download form available',
  async (record) => {
    await seedDownloadRecovery(record);
    await render(<HomeScreen />);
    expect(screen.getByRole('button', { name: 'Analizar' })).toBeEnabled();
    expect(screen.queryByText('Descarga interrumpida')).toBeNull();
    expect(getDownloadJob).not.toHaveBeenCalled();
    expect(createDownloadJob).not.toHaveBeenCalled();
  },
);

test('the journal excludes private input and a late POST cannot undo persisted cancellation', async () => {
  const reply = deferred<typeof completedDirectJob>();
  jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
  jest.mocked(createDownloadJob).mockReturnValue(reply.promise);
  await render(<HomeScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://example.com/secret-path.mp4?token=secret',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await fireEvent.press(await screen.findByRole('radio', { name: /360p/ }));
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Descargar' }),
  );
  await waitFor(() => expect(createDownloadJob).toHaveBeenCalledTimes(1));
  const raw = await readRawDownloadRecovery();
  expect(raw).not.toBeNull();
  expect(raw).not.toMatch(/https:|secret|Bearer|Authorization|file:\/\//i);
  expect(JSON.parse(raw!)).toMatchObject({
    phase: 'creating',
    remoteJobId: null,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    status: 'cancelled',
  });
  await act(() =>
    reply.resolve({ ...completedDirectJob, id: recoverableJobId }),
  );
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    status: 'cancelled',
    remoteJobId: null,
  });
  expect(downloadJobFile).not.toHaveBeenCalled();
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('YouTube recovery reanalyses the canonical video only on explicit retry', async () => {
  const native = localYoutubeNativeEngine();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await seedDownloadRecovery(
    JSON.stringify({
      ...persistedDownload,
      source: 'youtube',
      selection: {
        mode: 'VIDEO_ONLY',
        videoId: 'AWGPaFraPN4',
        videoFormatId: '134',
      },
      remoteJobId: null,
    }),
  );
  await render(<HomeScreen />);
  const retry = await screen.findByRole('button', {
    name: 'Reintentar desde cero',
  });
  expect(native.analyze).not.toHaveBeenCalled();
  await fireEvent.press(retry);
  expect(native.analyze).toHaveBeenCalledWith(
    'https://www.youtube.com/watch?v=AWGPaFraPN4',
  );
  expect(await screen.findByRole('button', { name: 'Descargar' })).toBeTruthy();
  expect(native.startVideoDownload).not.toHaveBeenCalled();
  expect(native.startAudioDownload).not.toHaveBeenCalled();
  expect(native.startCombinedDownload).not.toHaveBeenCalled();
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('a failed cancellation write keeps the direct attempt alive and retryable', async () => {
  const reply = deferred<typeof completedDirectJob>();
  jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
  jest.mocked(createDownloadJob).mockReturnValue(reply.promise);
  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent.press(await screen.findByRole('radio', { name: /360p/ }));
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Descargar' }),
  );
  await waitFor(() => expect(createDownloadJob).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(createDownloadJob).mock.calls[0]?.[1];
  await rejectDownloadWrite('UPDATE');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(
    await screen.findByText(
      'No se pudo registrar la cancelación. Inténtalo de nuevo.',
    ),
  ).toBeTruthy();
  expect(signal?.aborted).toBe(false);
  await allowDownloadWrites();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    status: 'cancelled',
  });
  await act(() => reply.resolve(completedDirectJob));
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('a download cannot submit a POST when its first durable write fails', async () => {
  jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent.press(await screen.findByRole('radio', { name: /360p/ }));
  await rejectDownloadWrite('INSERT');
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(
    await screen.findByText(
      'No se pudo guardar el estado de la descarga. Inténtalo de nuevo.',
    ),
  ).toBeTruthy();
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(downloadJobFile).not.toHaveBeenCalled();
});

test('an interrupted save directs the user to Library and cannot publish or restart a file', async () => {
  await seedDownloadRecovery(
    JSON.stringify({ ...persistedDownload, phase: 'saving' }),
  );
  await render(<HomeScreen />);
  expect(
    await screen.findByText(/El último paso fue guardar el archivo/),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Reintentar desde cero' }),
  ).toBeNull();
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(downloadJobFile).not.toHaveBeenCalled();
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('a pending paste blocks downloading the old analysis', async () => {
  const paste = deferred<string>();
  jest.mocked(Clipboard.getStringAsync).mockReturnValueOnce(paste.promise);
  jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
  jest.mocked(createDownloadJob).mockReturnValue(new Promise(() => undefined));
  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent.press(await screen.findByRole('radio', { name: /360p/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Pegar' }));
  const download = screen.getByRole('button', { name: 'Descargar' });
  await fireEvent.press(download);
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(download).toBeDisabled();
  await act(() => paste.resolve('https://example.com/next.mp4'));
});

test('a YouTube start error cannot display a private path or signed request', async () => {
  const secret =
    'file:///private/A1_PRIVATE https://example.test/?sig=A1_SECRET Bearer A1_BEARER';
  const native = localYoutubeNativeEngine();
  native.startAudioDownload.mockImplementation(() => {
    throw new Error(secret);
  });
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  await fireEvent.press(await screen.findByText('Solo audio'));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/A1_PRIVATE|A1_SECRET|A1_BEARER/)).toBeNull();
});

test('a superseded paste cannot replace an input while its new job is active', async () => {
  const paste = deferred<string>();
  const reply = deferred<typeof completedDirectJob>();
  jest.mocked(Clipboard.getStringAsync).mockReturnValueOnce(paste.promise);
  jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
  jest.mocked(createDownloadJob).mockReturnValue(reply.promise);
  await render(<NavigableSession />);
  await analyzeExample();
  await fireEvent.press(screen.getByRole('button', { name: 'Pegar' }));
  await act(() => session.changeUrl('https://example.com/current.mp4'));
  await act(() => session.runAnalysis());
  await fireEvent.press(await screen.findByRole('radio', { name: /360p/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await waitFor(() => expect(createDownloadJob).toHaveBeenCalledTimes(1));
  await act(() => paste.resolve('https://youtu.be/AWGPaFraPN4'));
  expect(
    screen.getByLabelText('URL del recurso multimedia'),
  ).toHaveDisplayValue('https://example.com/current.mp4');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  await act(() => reply.resolve(completedDirectJob));
  expect(downloadJobFile).not.toHaveBeenCalled();
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('simultaneous direct and native starts keep the winning controls and journal', async () => {
  const native = localYoutubeNativeEngine();
  native.startAudioDownload.mockReturnValue(nativeJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<NavigableSession />);
  await analyzeYoutube();
  await fireEvent.press(await screen.findByText('Solo audio'));
  await act(async () => {
    const current = session;
    await Promise.all([
      current.spike.downloadAudio(),
      current.download.start(navigationDirectMedia, {
        type: 'VIDEO_AUDIO',
        videoIndex: 0,
        audioIndex: null,
      }),
    ]);
  });
  expect(native.startAudioDownload).toHaveBeenCalledTimes(1);
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    source: 'youtube',
    status: 'pending',
  });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar descarga' }),
  );
  expect(native.cancelAudioDownload).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    source: 'youtube',
    status: 'cancelled',
  });
  await act(() => native.emit('onAudioDownloadState', completeNative));
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('recovery errors keep request and storage details out of the UI and record', async () => {
  const secret =
    'file:///private/A1_PRIVATE https://example.test/?sig=A1_SECRET Authorization: Bearer A1_BEARER';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.mocked(getDownloadJob).mockRejectedValueOnce(new Error(secret));
  await seedDownloadRecovery(JSON.stringify(persistedDownload));
  await render(<HomeScreen />);
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Continuar consulta' }),
  );
  expect(
    await screen.findByText(
      'No se pudo consultar o actualizar el estado. Inténtalo de nuevo.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/A1_PRIVATE|A1_SECRET|A1_BEARER/)).toBeNull();
  expect(await readRawDownloadRecovery()).not.toMatch(
    /A1_PRIVATE|A1_SECRET|A1_BEARER/,
  );
  expect(warn.mock.calls.flat().map(String).join(' ')).not.toMatch(
    /A1_PRIVATE|A1_SECRET|A1_BEARER/,
  );
});

test('native cancellation stays active on a rejected write and aborts only after a successful retry', async () => {
  const native = localYoutubeNativeEngine();
  native.startAudioDownload.mockReturnValue(nativeJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  await fireEvent.press(await screen.findByText('Solo audio'));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  const cancel = await screen.findByRole('button', {
    name: 'Cancelar descarga',
  });
  await rejectDownloadWrite('UPDATE');
  await fireEvent.press(cancel);
  expect(native.cancelAudioDownload).not.toHaveBeenCalled();
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    status: 'pending',
  });
  expect(screen.getByText(/No se pudo registrar la cancelación/)).toBeTruthy();
  await allowDownloadWrites();
  await fireEvent.press(cancel);
  expect(native.cancelAudioDownload).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    status: 'cancelled',
  });
  expect(screen.queryByText(/No se pudo registrar la cancelación/)).toBeNull();
});

function holdReservationCommit() {
  const reached = deferred<void>();
  const release = deferred<void>();
  const execAsync = RealSQLite.prototype.execAsync;
  jest
    .spyOn(RealSQLite.prototype, 'execAsync')
    .mockImplementation(async function (this: RealSQLite, sql) {
      if (sql === 'COMMIT') {
        reached.resolve();
        await release.promise;
      }
      await execAsync.call(this, sql);
    });
  return { reached: reached.promise, release: release.resolve };
}

function changeAppState(state: AppStateStatus) {
  AppState.currentState = state;
  appStateListeners.forEach((listener) => listener(state));
}

test.each(['youtube', 'direct'] as const)(
  '%s cannot start after Drop backgrounds during its SQLite reservation',
  async (source) => {
    const native = localYoutubeNativeEngine();
    native.startAudioDownload.mockReturnValue(nativeJob);
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
    jest.mocked(createDownloadJob).mockResolvedValue(completedDirectJob);
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    await render(<NavigableSession />);
    await analyzeYoutube();
    await fireEvent.press(await screen.findByText('Solo audio'));
    const commit = holdReservationCommit();
    try {
      await act(async () => {
        const start =
          source === 'youtube'
            ? session.spike.downloadAudio()
            : session.download.start(navigationDirectMedia, {
                type: 'VIDEO_AUDIO',
                videoIndex: 0,
                audioIndex: null,
              });
        await commit.reached;
        expect(native.startAudioDownload).not.toHaveBeenCalled();
        expect(createDownloadJob).not.toHaveBeenCalled();
        changeAppState('background');
        native.cancel();
        native.cancelAudioDownload();
        native.cancelCombinedDownload();
        commit.release();
        await start;
      });
      expect(native.startAudioDownload).not.toHaveBeenCalled();
      expect(createDownloadJob).not.toHaveBeenCalled();
      expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
        source,
        status: 'interrupted',
      });
      expect(screen.getByText('Descarga interrumpida')).toBeTruthy();
    } finally {
      commit.release();
      AppState.currentState = previous;
    }
  },
);

test('a foreground round trip invalidates the old reservation and requires an explicit retry', async () => {
  const native = localYoutubeNativeEngine();
  native.startAudioDownload.mockReturnValue(nativeJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  await render(<NavigableSession />);
  await analyzeYoutube();
  await fireEvent.press(await screen.findByText('Solo audio'));
  const commit = holdReservationCommit();
  try {
    await act(async () => {
      const start = session.spike.downloadAudio();
      await commit.reached;
      changeAppState('background');
      changeAppState('active');
      commit.release();
      await start;
    });
    expect(native.startAudioDownload).not.toHaveBeenCalled();
    const interrupted = await readRawDownloadRecovery();
    await act(() => native.emit('onAudioDownloadState', completeNative));
    expect(publishDownloadAsset).not.toHaveBeenCalled();
    expect(await readRawDownloadRecovery()).toBe(interrupted);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Reintentar desde cero' }),
    );
    const download = await screen.findByRole('button', { name: 'Descargar' });
    expect(native.startAudioDownload).not.toHaveBeenCalled();
    await fireEvent.press(download);
    expect(native.startAudioDownload).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
      source: 'youtube',
      status: 'pending',
    });
  } finally {
    commit.release();
    AppState.currentState = previous;
  }
});

test('a foreground rejection at the native boundary is persisted as an interruption', async () => {
  const native = localYoutubeNativeEngine();
  native.startAudioDownload.mockReturnValue('APP_NOT_ACTIVE');
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await analyzeYoutube();
  await fireEvent.press(await screen.findByText('Solo audio'));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(await screen.findByText('Descarga interrumpida')).toBeTruthy();
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    status: 'interrupted',
  });
  expect(screen.queryByText('Descarga cancelada')).toBeNull();
});

test('a native background cancellation invalidates subsequent callbacks without marking user cancellation', async () => {
  const { native } = await startNavigableAudio();
  await act(() => {
    changeAppState('background');
    native.emit('onAudioDownloadState', {
      jobId: nativeJob,
      status: 'CANCELLED',
    });
    native.emit('onAudioDownloadState', completeNative);
    changeAppState('active');
  });
  expect(await screen.findByText('Descarga interrumpida')).toBeTruthy();
  expect(screen.queryByText('Descarga cancelada')).toBeNull();
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    status: 'interrupted',
  });
  expect(publishDownloadAsset).not.toHaveBeenCalled();
  expect(native.startAudioDownload).toHaveBeenCalledTimes(1);
});

test('a rejected interruption write keeps the confirmed reservation and never starts YouTube', async () => {
  const native = localYoutubeNativeEngine();
  native.startAudioDownload.mockReturnValue(nativeJob);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  await render(<NavigableSession />);
  await analyzeYoutube();
  await fireEvent.press(await screen.findByText('Solo audio'));
  await rejectDownloadWrite('UPDATE');
  const commit = holdReservationCommit();
  try {
    await act(async () => {
      const start = session.spike.downloadAudio();
      await commit.reached;
      changeAppState('background');
      commit.release();
      await start;
      changeAppState('active');
    });
    expect(native.startAudioDownload).not.toHaveBeenCalled();
    expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
      status: 'pending',
      phase: 'creating',
    });
    expect(screen.queryByText('Descarga interrumpida')).toBeNull();
    expect(
      screen.getByText(/No se pudo registrar la interrupción/),
    ).toBeTruthy();
    expect(screen.queryByText(/fixture write rejection/)).toBeNull();
  } finally {
    commit.release();
    AppState.currentState = previous;
  }
});

test('a verified publication is offered on reopen and saved only on request', async () => {
  await seedDownloadRecovery(
    JSON.stringify({
      ...persistedDownload,
      phase: 'saving',
      publication: {
        asset: {
          id: '00000000-0000-0000-0000-000000000001',
          ext: 'mp4',
          sizeBytes: persistedDownload.bytes,
          sha256: 'c'.repeat(64),
        },
      },
    }),
  );
  await render(<HomeScreen />);
  const save = await screen.findByRole('button', {
    name: 'Verificar y guardar archivo',
  });
  expect(publishDownloadAsset).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Continuar consulta' }),
  ).toBeNull();
  await fireEvent.press(save);
  expect(
    await screen.findByText('Archivo guardado en Biblioteca.'),
  ).toBeTruthy();
  expect(publishDownloadAsset).toHaveBeenCalledTimes(1);
  expect(await readRawDownloadRecovery()).toBeNull();
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(downloadJobFile).not.toHaveBeenCalled();
});

test('a pending discard only offers finishing cleanup on reopen', async () => {
  await seedDownloadRecovery(
    JSON.stringify({
      ...persistedDownload,
      phase: 'saving',
      publication: { discarding: true },
    }),
  );
  await render(<HomeScreen />);
  expect(await screen.findByText('Descarte pendiente')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Verificar y guardar archivo' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Continuar consulta' }),
  ).toBeNull();
  expect(deleteDownloadJob).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Finalizar descarte' }),
  );
  await waitFor(async () => expect(await readRawDownloadRecovery()).toBeNull());
  expect(createDownloadJob).not.toHaveBeenCalled();
  expect(downloadJobFile).not.toHaveBeenCalled();
  expect(publishDownloadAsset).not.toHaveBeenCalled();
});

test('a failed publication reservation keeps the completed remote job and local file', async () => {
  jest.mocked(analyzeMedia).mockResolvedValue(navigationDirectMedia);
  jest.mocked(createDownloadJob).mockResolvedValue(completedDirectJob);
  const transfer = deferred<{ uri: string; size: number }>();
  jest.mocked(downloadJobFile).mockReturnValue(transfer.promise);
  await render(<HomeScreen />);
  await analyzeExample();
  await fireEvent.press(await screen.findByRole('radio', { name: /360p/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await waitFor(() => expect(downloadJobFile).toHaveBeenCalledTimes(1));
  await rejectDownloadWrite('UPDATE');
  await act(() => transfer.resolve({ uri: 'file:///cache/new.mp4', size: 12 }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(deleteDownloadJob).not.toHaveBeenCalled();
  expect(deleteLocalFile).not.toHaveBeenCalled();
  expect(publishDownloadAsset).not.toHaveBeenCalled();
  expect(JSON.parse((await readRawDownloadRecovery())!)).toMatchObject({
    remoteJobId: completedDirectJob.id,
    phase: 'transferring',
  });
});
