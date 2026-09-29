import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { requireOptionalNativeModule } from 'expo';

import { LocalYoutubeSpikeCard } from '@/components/LocalYoutubeSpikeCard';
import { LocalYoutubeDiagnosticsCard } from '@/components/LocalYoutubeDiagnosticsCard';
import { ActionButton } from '@/components/ActionButton';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import {
  localHttpTransferDiagnosticsSchema,
  localYoutubeResultSchema,
} from '@/models/onDeviceYoutube';
import {
  analyzeYoutubeOnDevice,
  cancelLocalYoutube,
  testEjsOnDevice,
} from '@/services/onDeviceYoutube';
import { shareLocalFile } from '@/services/jobs';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/jobs', () => ({
  shareLocalFile: jest.fn(),
  deleteLocalFile: jest.fn(),
}));
let audioListener: ((event: unknown) => void) | null = null;
let videoListener: ((event: unknown) => void) | null = null;
let combinedListener: ((event: unknown) => void) | null = null;
const native = {
  analyze: jest.fn(),
  testEjsFixture: jest.fn(),
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
  native.testEjsFixture.mockResolvedValue(
    JSON.stringify({
      fixture: {
        status: 'passed',
        challengeType: 'n',
        challengeInput: 'IlLiA21ny7gqA2m4p37',
        expected: '9nRTxrbM1f0yHg',
        actual: '9nRTxrbM1f0yHg',
        playerId: '74edf1a3',
        playerSha256:
          'ed9a4ea0646332a6b6c973ebe5a915c62c43db89bb2bb1a31eba07d906ef8ff7',
        provider: 'MediaDropEmbedded',
        providerRegistered: true,
        scriptSource: 'yt-dlp-ejs bundled Python package',
        ejsVersion: '0.8.0',
      },
      elapsedSeconds: 0.5,
      jsChallengeCalls: 1,
      nativeRunJsCalls: 4,
      processAttempts: 0,
      subprocessUsed: false,
      quickJsFilesystem: false,
      quickJsNetwork: false,
      diagnostics: {
        providerInvoked: true,
        runJsInvoked: true,
        quickJsCompletedNormally: true,
        scriptLength: 6500000,
        responseType: 'str',
        responseLength: 3824404,
        responsePayloadType: 'result',
        responsePreview: '{"type":"result","responses":[{"type":"result"}]}',
        parserError: null,
        consoleLogCaptured: true,
        evaluationReturnIgnored: true,
        javascriptExceptionCaught: true,
        quickJsFilesystemAttempts: 0,
        quickJsNetworkAttempts: 0,
        native: {
          memoryLimitBytes: 201326592,
          stackLimitBytes: 2097152,
          timeoutSeconds: 25,
          outputLimitBytes: 8388608,
          capturedBytes: 3824404,
          consoleCalls: 1,
          interrupted: false,
          completedNormally: true,
          quickJsMallocBytes: 150000000,
          quickJsMemoryUsedBytes: 140000000,
        },
      },
      deviceRuntime: 'ios-device',
    }),
  );
});

test('EJS fixture uses the native engine without network fallback', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  const fixture = await testEjsOnDevice();
  expect(fixture.fixture?.actual).toBe('9nRTxrbM1f0yHg');
  expect(fixture.jsChallengeCalls).toBe(1);
  expect(native.testEjsFixture).toHaveBeenCalledTimes(1);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
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
      <LocalYoutubeSpikeCard spike={spike} disabled={spike.isBusy} />
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
});

test('local metadata card selects direct M4A without exposing a stream URL', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  expect(screen.getByText('Video autorizado')).toBeTruthy();
  expect(screen.getByText(/360p · mp4 · avc1/)).toBeTruthy();
  expect(screen.getByText(/12:34/)).toBeTruthy();
  expect(screen.getByText(/Seleccionado: M4A · mp4a.40.2/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Descargar audio en este iPhone',
    }),
  );
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
    await fireEvent.press(
      screen.getByRole('button', {
        name:
          mode === 'audio'
            ? 'Descargar audio en este iPhone'
            : 'Descargar video con audio en este iPhone',
      }),
    );
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
  expect(
    screen.getByText(/Seleccionado: 360p · MP4 · avc1 · ID 134/),
  ).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Descargar video sin audio en este iPhone',
    }),
  );
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
  expect(screen.getByText('Descargando video… 50 %')).toBeTruthy();
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
  expect(screen.getByText('✓ Descarga de video completada')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Compartir video' }),
  );
  await waitFor(() =>
    expect(shareLocalFile).toHaveBeenCalledWith(
      'file:///cache/Own%20video.mp4',
    ),
  );
});

test('native video-only cancellation delegates to URLSession owner', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Descargar video sin audio en este iPhone',
    }),
  );
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
    screen.getByRole('button', { name: 'Cancelar descarga de video' }),
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
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Descargar video con audio en este iPhone',
    }),
  );
  expect(native.startCombinedDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '134',
    '140',
    754,
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
  expect(screen.getByText(/Descargando video… 50 %/)).toBeTruthy();
  await act(() => {
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: 'DOWNLOADING_AUDIO',
      bytesDownloaded: 1_000_000,
      totalBytes: 2_000_000,
      progress: 0.5,
    });
  });
  expect(screen.getByText(/Descargando audio… 50 %/)).toBeTruthy();
  await act(() => {
    combinedListener?.({
      jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
      status: 'MUXING',
      progress: 0.75,
    });
  });
  expect(screen.getByText('Combinando video y audio… 75 %')).toBeTruthy();
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
  expect(screen.getByText('✓ Video con audio completado')).toBeTruthy();
  expect(
    screen.getByText(/Primer Range solicitado: bytes=0-262143/),
  ).toBeTruthy();
  expect(screen.getByText(/Primer response: HTTP 206/)).toBeTruthy();
  expect(
    screen.getByText(/Primer Content-Range: bytes 0-262143\/586796/),
  ).toBeTruthy();
  expect(
    screen.getByText(/Host final del primer request: rr1\.googlevideo\.com/),
  ).toBeTruthy();
  await fireEvent.press(
    screen.getAllByRole('button', { name: 'Compartir video' })[0]!,
  );
  await waitFor(() =>
    expect(shareLocalFile).toHaveBeenCalledWith(
      'file:///cache/Own%20video.mp4',
    ),
  );
});

test('720p selection is dynamic and remains opaque to React Native', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  expect(
    screen.getByRole('button', {
      name: '360p · MP4 · AVC · seleccionada',
    }),
  ).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: /720p · WebM · VP9/ }),
  ).toBeNull();
  expect(screen.queryByText(/seleccionada.*ID 232/)).toBeNull();

  await fireEvent.press(
    screen.getByRole('button', { name: '720p · MP4 · AVC' }),
  );
  expect(
    screen.getByRole('button', {
      name: '720p · MP4 · AVC · seleccionada',
    }),
  ).toBeDisabled();
  expect(screen.getByText(/Video: 720p · MP4 · avc1\.64001f/)).toBeTruthy();
  expect(screen.getByText(/ID 136 · protocolo https/)).toBeTruthy();

  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Descargar video con audio en este iPhone',
    }),
  );
  expect(native.startCombinedDownload).toHaveBeenCalledWith(
    'a'.repeat(32),
    '136',
    '140',
    754,
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
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Descargar video con audio en este iPhone',
    }),
  );
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
  expect(screen.getByText(new RegExp(`Código: ${code}`))).toBeTruthy();
});

test.each(['DOWNLOADING_VIDEO', 'DOWNLOADING_AUDIO', 'MUXING'] as const)(
  'combined cancellation works during %s',
  async (phase) => {
    await render(<TestCard />);
    await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
    await screen.findByText('Video autorizado');
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Descargar video con audio en este iPhone',
      }),
    );
    await act(() => {
      combinedListener?.({
        jobId: '7D628D93-DC67-4729-83AD-B8EF70877A87',
        status: phase,
        progress: 0.25,
      });
    });
    await fireEvent.press(
      screen.getByRole('button', {
        name:
          phase === 'MUXING'
            ? 'Cancelar combinación'
            : 'Cancelar video con audio',
      }),
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
    expect(screen.queryByText('✓ Video con audio completado')).toBeNull();
  },
);

test('late audio completion after cancellation is ignored, then a retry can share', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Descargar audio en este iPhone' }),
  );
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
  expect(screen.getByText('Descargando… 50 %')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar descarga de audio' }),
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
  await fireEvent.press(
    screen.getByRole('button', { name: 'Descargar audio en este iPhone' }),
  );
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
  await fireEvent.press(
    screen.getByRole('button', { name: 'Compartir audio' }),
  );
  await waitFor(() =>
    expect(shareLocalFile).toHaveBeenCalledWith(
      'file:///cache/Own%20audio.m4a',
    ),
  );
});

test('downloaded audio is not published when passthrough normalization fails', async () => {
  await render(<TestCard />);
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
  await screen.findByText('Video autorizado');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Descargar audio en este iPhone' }),
  );
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
  expect(screen.queryByRole('button', { name: 'Compartir audio' })).toBeNull();
  await act(() => {
    audioListener?.({
      jobId: 'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
      status: 'FAILED',
      errorCode: 'AUDIO_NORMALIZATION_EXPORT_FAILED',
    });
  });
  expect(screen.queryByText('✓ Descarga completada')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Compartir audio' })).toBeNull();
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

test('physical EJS action displays the validated provider result', async () => {
  await render(<TestCard />);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Probar EJS en este iPhone' }),
  );
  expect(screen.getByText('✓ EJS real pasó')).toBeTruthy();
  expect(screen.getByText(/MediaDropEmbedded · EJS 0.8.0/)).toBeTruthy();
  expect(screen.getByText(/Subprocess: no · intentos: 0/)).toBeTruthy();
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
    screen.getByRole('button', { name: 'Cancelar análisis local' }),
  );
  expect(native.analyze).toHaveBeenCalledTimes(1);
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await view.unmount();
});
