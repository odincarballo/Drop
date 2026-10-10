import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { requireOptionalNativeModule } from 'expo';

import { LocalYoutubeMainCard } from '@/components/LocalYoutubeMainCard';
import { LocalYoutubeDiagnosticsCard } from '@/components/LocalYoutubeDiagnosticsCard';
import { ActionButton } from '@/components/ActionButton';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import {
  localAudioDownloadEventSchema,
  localCombinedDownloadEventSchema,
  localHttpTransferDiagnosticsSchema,
  localVideoDownloadEventSchema,
  localYoutubeResultSchema,
} from '@/models/onDeviceYoutube';
import {
  analyzeYoutubeOnDevice,
  cancelLocalYoutube,
  localAudioError,
  localCombinedError,
  localVideoError,
} from '@/services/onDeviceYoutube';
import { shareLocalFile } from '@/services/jobs';
import { promoteToLibrary } from '@/services/library';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/fileExport', () => ({
  saveLocalFileToFiles: jest.fn(),
  withNamedLibraryFile: jest.fn((_item, operation) =>
    operation('file:///library/clip.mp4'),
  ),
}));
jest.mock('@/services/library', () => ({
  promoteToLibrary: jest.fn(),
  withLibraryLease: jest.fn((_id, operation) =>
    operation({ uri: 'file:///library/clip.mp4' }),
  ),
}));
jest.mock('@/services/jobs', () => ({
  shareLocalFile: jest.fn(),
  deleteLocalFile: jest.fn(),
}));
let audioListener: ((event: unknown) => void) | null = null;
let videoListener: ((event: unknown) => void) | null = null;
let combinedListener: ((event: unknown) => void) | null = null;
const native = {
  analyze: jest.fn(),
  startAudioDownload: jest.fn(),
  cancelAudioDownload: jest.fn(),
  startVideoDownload: jest.fn(),
  cancelVideoDownload: jest.fn(),
  startCombinedDownload: jest.fn(),
  cancelCombinedDownload: jest.fn(),
  cancel: jest.fn(),
  addListener: jest.fn((name: string, listener: (event: unknown) => void) => {
    if (name === 'onAudioDownloadState') audioListener = listener;
    if (name === 'onVideoDownloadState') videoListener = listener;
    if (name === 'onCombinedDownloadState') combinedListener = listener;
    return { remove: jest.fn() };
  }),
};
const metadata = {
  id: 'AWGPaFraPN4',
  analysisId: 'a'.repeat(32),
  preferredAudioFormatId: '140',
  preferredVideoFormatId: '134',
  title: 'Video autorizado',
  duration: 754,
  thumbnail: null,
  videoFormats: [
    {
      id: '134',
      container: 'mp4',
      codec: 'avc1',
      resolution: '360p',
      height: 360,
      width: 640,
      fps: 30,
      hasAudio: false,
      bitrateKbps: null,
      estimatedSize: null,
      protocol: 'https',
      directDownload: true,
    },
    {
      id: '136',
      container: 'mp4',
      codec: 'avc1.64001f',
      resolution: '720p',
      height: 720,
      width: 1280,
      fps: 30,
      hasAudio: false,
      bitrateKbps: 900,
      estimatedSize: 12_000_000,
      protocol: 'https',
      directDownload: true,
    },
    {
      id: '232',
      container: 'mp4',
      codec: 'avc1.4d401f',
      resolution: '720p',
      height: 720,
      width: 1280,
      fps: 30,
      hasAudio: false,
      bitrateKbps: null,
      estimatedSize: null,
      protocol: 'm3u8_native',
      directDownload: false,
    },
    {
      id: '247',
      container: 'webm',
      codec: 'vp9',
      resolution: '720p',
      height: 720,
      width: 1280,
      fps: 30,
      hasAudio: false,
      bitrateKbps: 700,
      estimatedSize: 10_000_000,
      protocol: 'https',
      directDownload: false,
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
      protocol: 'https',
      directDownload: true,
    },
  ],
  resolutions: [360, 720],
};
const result = {
  metadata,
  deviceRuntime: 'ios-device',
  engine: 'CPython / QuickJS-NG',
  jsChallengeCalls: 1,
  networkRequests: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(promoteToLibrary).mockImplementation(
    async (_uri) =>
      ({
        id: '00000000-0000-0000-0000-000000000001',
        uri: 'file:///library/clip.mp4',
        sizeBytes: 1_000_000,
      }) as never,
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  audioListener = null;
  videoListener = null;
  combinedListener = null;
  native.analyze.mockResolvedValue(JSON.stringify(result));
  native.startAudioDownload.mockReturnValue(
    'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
  );
  native.startVideoDownload.mockReturnValue(
    'A5371425-C825-4B4E-BAB1-C83E99D9ACF5',
  );
  native.startCombinedDownload.mockReturnValue(
    '7D628D93-DC67-4729-83AD-B8EF70877A87',
  );
  jest.mocked(shareLocalFile).mockResolvedValue();
});

test('metadata uses the native module without HTTP client, token or backend fallback', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  expect(
    await analyzeYoutubeOnDevice(' https://youtu.be/AWGPaFraPN4 '),
  ).toMatchObject(result);
  expect(native.analyze).toHaveBeenCalledWith('https://youtu.be/AWGPaFraPN4');
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

test('missing native module fails without falling back to Render', async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  await expect(
    analyzeYoutubeOnDevice('https://youtu.be/AWGPaFraPN4'),
  ).rejects.toThrow('no incluye');
});

test('empty URL is rejected before native work', async () => {
  await expect(analyzeYoutubeOnDevice(' ')).rejects.toThrow('Introduce');
  expect(native.analyze).not.toHaveBeenCalled();
});

test('invalid native response is rejected', async () => {
  native.analyze.mockResolvedValue('{}');
  await expect(
    analyzeYoutubeOnDevice('https://youtu.be/AWGPaFraPN4'),
  ).rejects.toThrow('inválida');
});

test('schema rejects ambiguous outcomes and unsafe thumbnails', () => {
  expect(
    localYoutubeResultSchema.safeParse({
      ...result,
      error: { code: 'LOGIN_REQUIRED' },
    }).success,
  ).toBe(false);
  expect(
    localYoutubeResultSchema.safeParse({
      metadata: { ...metadata, thumbnail: 'http://127.0.0.1/a' },
    }).success,
  ).toBe(false);
});

test('cancel delegates to the native engine', () => {
  cancelLocalYoutube();
  expect(native.cancel).toHaveBeenCalledTimes(1);
});

function TestCard() {
  const spike = useLocalYoutubeSpike();
  return (
    <>
      <ActionButton
        label={
          spike.state.status === 'loading'
            ? 'Analizando en el iPhone…'
            : 'Analizar'
        }
        onPress={() => void spike.analyze('https://youtu.be/AWGPaFraPN4')}
        disabled={spike.isBusy}
      />
      <LocalYoutubeMainCard
        spike={spike}
        disabled={spike.isBusy}
        onNewDownload={spike.reset}
      />
      <LocalYoutubeDiagnosticsCard spike={spike} />
    </>
  );
}

function TestAudioDiagnostics() {
  const spike = useLocalYoutubeSpike();
  return (
    <>
      <ActionButton
        label="Analizar"
        onPress={() => void spike.analyze('https://youtu.be/AWGPaFraPN4')}
      />
      <ActionButton label="Solo audio" onPress={spike.downloadAudio} />
      <LocalYoutubeDiagnosticsCard spike={spike} />
    </>
  );
}

test('solo-audio HTTP failure exposes only bounded, sanitized range diagnostics', async () => {
  await render(<TestAudioDiagnostics />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText(/ID: AWGPaFraPN4/);
  await fireEvent.press(screen.getByRole('button', { name: 'Solo audio' }));
  await act(() => {
    audioListener?.({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'FAILED',
      errorCode: 'AUDIO_HTTP_ERROR',
      httpDiagnostics: {
        failureStatusCode: 503,
        failureRequestedRange: 'bytes=262144-524287',
        failureHost: 'rr1.googlevideo.com',
        failureContentRange: 'bytes */2000000',
        failureContentLength: '42',
        failureRangeIndex: 2,
        failureBytesPersisted: 262144,
      },
    });
  });
  const details = screen.getByText(/HTTP audio fallido:/);
  const diagnosticText = String(details.props.children);
  expect(diagnosticText).toContain('Status HTTP: 503');
  expect(diagnosticText).toContain('Range solicitado: bytes=262144-524287');
  expect(diagnosticText).toContain('Petición de rango: 2');
  expect(diagnosticText).toContain('Bytes acumulados antes del fallo: 262144');
  expect(diagnosticText).toContain('Host: rr1.googlevideo.com');
  expect(diagnosticText).toContain('Content-Range: bytes */2000000');
  expect(diagnosticText).toContain('Content-Length: 42');
  expect(diagnosticText).not.toContain('https://');
});

test('HTTP diagnostics reject signed URLs and arbitrary header strings', () => {
  expect(
    localHttpTransferDiagnosticsSchema.safeParse({
      failureHost: 'rr1.googlevideo.com?sig=secret',
    }).success,
  ).toBe(false);
  expect(
    localHttpTransferDiagnosticsSchema.safeParse({
      failureContentRange: 'bytes */2000000?token=secret',
    }).success,
  ).toBe(false);
  expect(
    localHttpTransferDiagnosticsSchema.safeParse({
      failureRequestedRange: 'bytes=0-99&authorization=secret',
    }).success,
  ).toBe(false);
  const parsed = localHttpTransferDiagnosticsSchema.parse({
    failureStatusCode: 403,
    failureHost: 'rr1.googlevideo.com',
    signedUrl: 'https://rr1.googlevideo.com/path?sig=secret',
  });
  expect(JSON.stringify(parsed)).not.toContain('secret');
  const refresh = localHttpTransferDiagnosticsSchema.parse({
    failureStatusCode: 403,
    forbiddenAudioRefreshStages: [
      'first_403',
      'budget_reserved',
      'identity_confirmed',
      'restarted_at_zero',
    ],
  });
  expect(refresh.forbiddenAudioRefreshStages).toHaveLength(4);
  expect(
    localHttpTransferDiagnosticsSchema.safeParse({
      forbiddenAudioRefreshStages: ['https://rr1.googlevideo.com/?sig=SECRET'],
    }).success,
  ).toBe(false);
  expect(
    localCombinedDownloadEventSchema.safeParse({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'COMPLETED',
      audioHttpDiagnostics: refresh,
    }).success,
  ).toBe(true);
});

test('bounded retries are parsed for all YouTube modes without exposing URLs', () => {
  const jobId = 'D2A73B11-8703-4FB1-8612-8AC3C477C42F';
  expect(
    localAudioDownloadEventSchema.safeParse({
      jobId,
      status: 'RETRYING',
      retryCategory: 'timeout',
      bytesDownloaded: 262144,
    }).success,
  ).toBe(true);
  expect(
    localVideoDownloadEventSchema.safeParse({
      jobId,
      status: 'RETRYING',
      retryCategory: 'server',
    }).success,
  ).toBe(true);
  expect(
    localCombinedDownloadEventSchema.safeParse({
      jobId,
      status: 'RETRYING_AUDIO',
      retryCategory: 'connection',
    }).success,
  ).toBe(true);
  expect(localAudioError('AUDIO_TIMEOUT_RETRIES_EXHAUSTED')).toContain(
    'dejó de recibir datos',
  );
  expect(localVideoError('VIDEO_SERVER_RETRIES_EXHAUSTED')).toContain(
    'servidor',
  );
  expect(localCombinedError('AUDIO_CONNECTION_RETRIES_EXHAUSTED')).toContain(
    'cambia de red',
  );
  expect(
    localHttpTransferDiagnosticsSchema.safeParse({
      failurePhase: 'audio',
      failureCategory: 'server',
      failureStatusCode: 503,
      failureRequestedRange: 'bytes=262144-524287',
      failureRangeIndex: 2,
      failureRangeAttempt: 3,
      retriesUsed: 4,
      recoverySecondsRemaining: 0,
      failureHost: 'rr1.googlevideo.com',
    }).success,
  ).toBe(true);
  expect(
    localHttpTransferDiagnosticsSchema.safeParse({
      failureHost: 'rr1.googlevideo.com?sig=SECRET',
    }).success,
  ).toBe(false);
});

test('local metadata card selects direct M4A without exposing a stream URL', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  expect(screen.getByText('Video autorizado')).toBeTruthy();
  expect(screen.getByText(/360p · mp4 · avc1/)).toBeTruthy();
  expect(screen.getAllByText(/12:34/).length).toBeGreaterThan(0);
  expect(
    screen.getByText(/Audio seleccionado: ID 140 · mp4a.40.2/),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startAudioDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '140',
    754,
  );
  expect(JSON.stringify(native.startAudioDownload.mock.calls)).not.toContain(
    'googlevideo',
  );
});

test.each(['audio', 'combined'] as const)(
  'opaque audio-track identity reaches the native %s download',
  async (mode) => {
    const selectedTrack = `140@${'a'.repeat(24)}`;
    native.analyze.mockResolvedValue(
      JSON.stringify({
        ...result,
        metadata: {
          ...metadata,
          preferredAudioFormatId: selectedTrack,
          audioFormats: [
            { ...metadata.audioFormats[0], id: `140@${'b'.repeat(24)}` },
            { ...metadata.audioFormats[0], id: selectedTrack },
          ],
        },
      }),
    );
    await render(<TestCard />);
    await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
    await screen.findByText('Video autorizado');
    if (mode === 'audio') {
      await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    if (mode === 'audio') {
      expect(native.startAudioDownload).toHaveBeenCalledWith(
        'a'.repeat(32),
        selectedTrack,
        754,
      );
    } else {
      expect(native.startCombinedDownload).toHaveBeenCalledWith(
        'a'.repeat(32),
        '134',
        selectedTrack,
        754,
        null,
        2_000_000,
      );
    }
    expect(JSON.stringify(native.startAudioDownload.mock.calls)).not.toContain(
      'googlevideo',
    );
    expect(
      JSON.stringify(native.startCombinedDownload.mock.calls),
    ).not.toContain('googlevideo');
  },
);

test('native video-only progress completes, shares, and never exposes its URL', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  expect(screen.getByText(/Video seleccionado: ID 134 · 360p/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo video' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startVideoDownload).toHaveBeenCalledWith('a'.repeat(32), '134');
  expect(JSON.stringify(native.startVideoDownload.mock.calls)).not.toContain(
    'googlevideo',
  );
  await act(() => {
    videoListener?.({
      jobId: 'A5371425-C825-4B4E-BAB1-C83E99D9ACF5',
      status: 'DOWNLOADING',
      formatId: '134',
      container: 'mp4',
      codec: 'avc1',
      height: 360,
      bytesDownloaded: 2_500_000,
      totalBytes: 5_000_000,
      progress: 0.5,
    });
  });
  expect(screen.getByText(/Descargando video… .*50 %/)).toBeTruthy();
  await act(() => {
    videoListener?.({
      jobId: 'A5371425-C825-4B4E-BAB1-C83E99D9ACF5',
      status: 'COMPLETED',
      formatId: '134',
      container: 'mp4',
      codec: 'avc1',
      height: 360,
      fileName: 'Own video.mp4',
      fileSize: 5_000_000,
      localUri: 'file:///cache/Own%20video.mp4',
    });
  });
  expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Más opciones' }));
  await waitFor(() =>
    expect(shareLocalFile).toHaveBeenCalledWith('file:///library/clip.mp4'),
  );
});

test('native video-only cancellation delegates to URLSession owner', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo video' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await act(() => {
    videoListener?.({
      jobId: 'A5371425-C825-4B4E-BAB1-C83E99D9ACF5',
      status: 'DOWNLOADING',
      formatId: '134',
      container: 'mp4',
      codec: 'avc1',
      height: 360,
      bytesDownloaded: 100_000,
      totalBytes: 5_000_000,
      progress: 0.02,
    });
  });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar descarga' }),
  );
  expect(native.cancelVideoDownload).toHaveBeenCalledTimes(1);
  await act(() => {
    videoListener?.({
      jobId: 'A5371425-C825-4B4E-BAB1-C83E99D9ACF5',
      status: 'COMPLETED',
      fileName: 'late.mp4',
      fileSize: 100_000,
      localUri: 'file:///cache/late.mp4',
    });
  });
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
});

test('combined download reports both transfers, muxes, completes, and shares', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startCombinedDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '134',
    '140',
    754,
    null,
    2_000_000,
  );
  expect(JSON.stringify(native.startCombinedDownload.mock.calls)).not.toContain(
    'googlevideo',
  );
  await act(() => {
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: 'DOWNLOADING_VIDEO',
      bytesDownloaded: 293_398,
      totalBytes: 586_796,
      progress: 0.5,
    });
  });
  expect(screen.getByText(/Descargando video… .*50 %/)).toBeTruthy();
  await act(() => {
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: 'DOWNLOADING_AUDIO',
      bytesDownloaded: 1_000_000,
      totalBytes: 2_000_000,
      progress: 0.5,
    });
  });
  expect(screen.getByText(/Descargando audio… .*50 %/)).toBeTruthy();
  await act(() => {
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: 'MUXING',
      progress: 0.75,
    });
  });
  expect(screen.getByText('Combinando… 75 %')).toBeTruthy();
  await act(() => {
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: 'COMPLETED',
      fileName: 'Own video.mp4',
      fileSize: 2_500_000,
      localUri: 'file:///cache/Own%20video.mp4',
      durationSeconds: 754,
      height: 360,
      videoCodec: 'avc1',
      audioCodec: 'mp4a.40.2',
      videoHttpDiagnostics: {
        requestedRange: 'bytes=0-262143',
        statusCode: 206,
        contentRange: 'bytes 0-262143/586796',
        contentLength: '262144',
        finalHost: 'rr1.googlevideo.com',
      },
    });
  });
  expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
  expect(
    screen.getByText(/Primer Range solicitado: bytes=0-262143/),
  ).toBeTruthy();
  expect(screen.getByText(/Primer response: HTTP 206/)).toBeTruthy();
  expect(
    screen.getByText(/Primer Content-Range: bytes 0-262143\/586796/),
  ).toBeTruthy();
  expect(screen.getByText(/Host final: rr1\.googlevideo\.com/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Más opciones' }));
  await waitFor(() =>
    expect(shareLocalFile).toHaveBeenCalledWith('file:///library/clip.mp4'),
  );
});

test('720p selection is dynamic and remains opaque to React Native', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  expect(screen.getByRole('radio', { name: '360p' })).toBeChecked();
  expect(screen.queryByRole('radio', { name: /WebM/ })).toBeNull();
  expect(screen.queryByText(/seleccionada.*ID 232/)).toBeNull();

  await fireEvent.press(screen.getByRole('radio', { name: '720p' }));
  expect(screen.getByRole('radio', { name: '720p' })).toBeChecked();
  expect(screen.getByText(/Video seleccionado: ID 136 · 720p/)).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(native.startCombinedDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '136',
    '140',
    754,
    null,
    2_000_000,
  );
  expect(JSON.stringify(native.startCombinedDownload.mock.calls)).not.toContain(
    'googlevideo',
  );
});

test.each([
  ['DOWNLOADING_VIDEO', 'VIDEO_HTTP_ERROR'],
  ['DOWNLOADING_AUDIO', 'AUDIO_HTTP_ERROR'],
] as const)('combined %s failure remains specific', async (phase, code) => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await act(() => {
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: phase,
      bytesDownloaded: 1,
      totalBytes: 2,
      progress: 0.5,
    });
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: 'FAILED',
      errorCode: code,
    });
  });
  expect(screen.getByRole('alert')).toHaveTextContent(localCombinedError(code));
});

test.each(['DOWNLOADING_VIDEO', 'DOWNLOADING_AUDIO', 'MUXING'] as const)(
  'combined cancellation works during %s',
  async (phase) => {
    await render(<TestCard />);
    await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
    await screen.findByText('Video autorizado');
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    await act(() => {
      combinedListener?.({
        jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
        status: phase,
        progress: 0.25,
      });
    });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Cancelar descarga' }),
    );
    expect(native.cancelCombinedDownload).toHaveBeenCalledTimes(1);
    await act(() => {
      combinedListener?.({
        jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
        status: 'COMPLETED',
        fileName: 'late.mp4',
        fileSize: 100_000,
        localUri: 'file:///cache/late.mp4',
        durationSeconds: 754,
      });
    });
    expect(screen.queryByText('✓ Descarga completada')).toBeNull();
  },
);

test('late audio completion after cancellation is ignored, then a retry can share', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  expect(audioListener).not.toBeNull();
  await act(() => {
    audioListener?.({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'DOWNLOADING',
      formatId: '140',
      container: 'm4a',
      codec: 'mp4a.40.2',
      bytesDownloaded: 1_000_000,
      totalBytes: 2_000_000,
      progress: 0.5,
    });
  });
  expect(screen.getByText(/Descargando audio… .*50 %/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar descarga' }),
  );
  expect(native.cancelAudioDownload).toHaveBeenCalledTimes(1);

  await act(() => {
    audioListener?.({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'COMPLETED',
      formatId: '140',
      container: 'm4a',
      codec: 'mp4a.40.2',
      bytesDownloaded: 2_000_000,
      totalBytes: 2_000_000,
      progress: 1,
      fileName: 'Own audio.m4a',
      fileSize: 2_000_000,
      localUri: 'file:///cache/Own%20audio.m4a',
    });
  });
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await act(() => {
    audioListener?.({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'COMPLETED',
      formatId: '140',
      container: 'm4a',
      codec: 'mp4a.40.2',
      fileName: 'Own audio.m4a',
      fileSize: 2_000_000,
      localUri: 'file:///cache/Own%20audio.m4a',
    });
  });
  expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Más opciones' }));
  await waitFor(() =>
    expect(shareLocalFile).toHaveBeenCalledWith('file:///library/clip.mp4'),
  );
});

test('downloaded audio is not published when passthrough normalization fails', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(screen.getByRole('radio', { name: 'Solo audio' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
  await act(() => {
    audioListener?.({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'DOWNLOADING',
      bytesDownloaded: 2_000_000,
      totalBytes: 2_000_000,
      progress: 1,
    });
  });
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Más opciones' })).toBeNull();
  await act(() => {
    audioListener?.({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'FAILED',
      errorCode: 'AUDIO_NORMALIZATION_EXPORT_FAILED',
    });
  });
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Más opciones' })).toBeNull();
  expect(screen.getByText(/No se pudo preparar el archivo M4A/)).toBeTruthy();
});

test('invalid local audio events are ignored', async () => {
  await render(<TestCard />);
  await act(() => {
    audioListener?.({
      jobId: 'not-a-job',
      status: 'COMPLETED',
      localUri: 'https://signed.googlevideo.com/file',
    });
  });
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
});

test('local LOGIN_REQUIRED stays specific, with no login suggestion', async () => {
  native.analyze.mockResolvedValue(
    JSON.stringify({ error: { code: 'LOGIN_REQUIRED' } }),
  );
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    /Este contenido requiere iniciar sesión y no puede procesarse\./,
  );
});

test('pending local analysis prevents a second request and exposes cancellation', async () => {
  native.analyze.mockReturnValue(new Promise(() => {}));
  const view = await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  expect(
    screen.getByRole('button', { name: 'Analizando en el iPhone…' }),
  ).toBeDisabled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar análisis' }),
  );
  expect(native.analyze).toHaveBeenCalledTimes(1);
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await view.unmount();
});
