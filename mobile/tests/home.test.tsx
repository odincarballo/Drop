import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Clipboard from 'expo-clipboard';

import HomeScreen from '@/app/index';
import type { MediaAnalysis } from '@/models/media';
import { ApiError } from '@/services/errors';
import { analyzeMedia } from '@/services/media';
import {
  createDownloadJob,
  deleteDownloadJob,
  downloadJobFile,
  shareLocalFile,
} from '@/services/jobs';
import { demoMedia, youtubeMedia } from './fixtures/media';

jest.mock('@/services/media', () => ({ analyzeMedia: jest.fn() }));
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
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

beforeEach(() => {
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
  return {
    analyze: jest.fn().mockResolvedValue(JSON.stringify(localYoutubeMetadata)),
    testEjsFixture: jest.fn(),
    startAudioDownload: jest.fn(),
    cancelAudioDownload: jest.fn(),
    startVideoDownload: jest.fn(),
    cancelVideoDownload: jest.fn(),
    cancel: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

async function analyzeExample() {
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://example.com/video.mp4',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
}

test('YouTube uses the on-device engine and never calls Render', async () => {
  const native = localYoutubeNativeEngine();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await render(<HomeScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://www.youtube.com/watch?v=AWGPaFraPN4',
  );
  await fireEvent.press(
    screen.getAllByRole('button', { name: 'Analizar en este iPhone' })[0]!,
  );
  expect(await screen.findByText('YouTube local')).toBeTruthy();
  expect(native.analyze).toHaveBeenCalledWith(
    'https://www.youtube.com/watch?v=AWGPaFraPN4',
  );
  expect(analyzeMedia).not.toHaveBeenCalled();
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
    id: 'job-1',
    status: 'COMPLETED' as const,
    progress: 1,
    bytesDownloaded: 12,
    totalBytes: 12,
    fileName: 'clip.mp4',
    fileSize: 12,
    error: null,
    downloadUrl: '/jobs/job-1/file',
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
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Compartir' }));
  expect(shareLocalFile).toHaveBeenCalledWith('file:///cache/clip.mp4');
});

test('YouTube offers real resolution, automatic audio, M4A and MP3 output', async () => {
  const completedJob = {
    id: 'job-youtube',
    status: 'COMPLETED' as const,
    phase: 'FINALIZING' as const,
    progress: 1,
    bytesDownloaded: 23000000,
    totalBytes: 23000000,
    fileName: 'Authorized YouTube video.mp4',
    fileSize: 22500000,
    error: null,
    downloadUrl: '/jobs/job-youtube/file',
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
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Nueva descarga' }));
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
  expect(screen.getByText('Sin título')).toBeTruthy();
  expect(screen.getByText('Miniatura no disponible')).toBeTruthy();
  expect(screen.getByText(/Duración desconocida/)).toBeTruthy();
  expect(screen.getByText('Fuente: Fuente desconocida')).toBeTruthy();
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
