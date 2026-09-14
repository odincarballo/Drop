import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { requireOptionalNativeModule } from 'expo';

import { LocalYoutubeSpikeCard } from '@/components/LocalYoutubeSpikeCard';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import { localYoutubeResultSchema } from '@/models/onDeviceYoutube';
import {
  analyzeYoutubeOnDevice,
  cancelLocalYoutube,
  testEjsOnDevice,
} from '@/services/onDeviceYoutube';
import { shareLocalFile } from '@/services/jobs';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/jobs', () => ({ shareLocalFile: jest.fn() }));
let audioListener: ((event: unknown) => void) | null = null;
const native = {
  analyze: jest.fn(),
  testEjsFixture: jest.fn(),
  startAudioDownload: jest.fn(),
  cancelAudioDownload: jest.fn(),
  cancel: jest.fn(),
  addListener: jest.fn((_name: string, listener: (event: unknown) => void) => {
    audioListener = listener;
    return { remove: jest.fn() };
  }),
};
const metadata = {
  id: 'AWGPaFraPN4',
  analysisId: 'a'.repeat(32),
  preferredAudioFormatId: '140',
  title: 'Video autorizado',
  duration: 754,
  thumbnail: null,
  videoFormats: [
    {
      id: '137',
      container: 'mp4',
      codec: 'avc1',
      resolution: '1080p',
      height: 1080,
      width: 1920,
      fps: 30,
      hasAudio: false,
      bitrateKbps: null,
      estimatedSize: null,
      protocol: 'https',
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
    },
  ],
  resolutions: [1080],
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
  native.analyze.mockResolvedValue(JSON.stringify(result));
  native.startAudioDownload.mockReturnValue(
    'D2A73B11-8703-4FB1-8612-8AC3C477C42F',
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
    <LocalYoutubeSpikeCard
      spike={spike}
      disabled={spike.isBusy}
      onAnalyze={() => void spike.analyze('https://youtu.be/AWGPaFraPN4')}
    />
  );
}

test('local metadata card selects direct M4A without exposing a stream URL', async () => {
  await render(<TestCard />);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Analizar en este iPhone' }),
  );
  await screen.findByText('Video autorizado');
  expect(screen.getByText('Video autorizado')).toBeTruthy();
  expect(screen.getByText(/1080p · mp4 · avc1/)).toBeTruthy();
  expect(screen.getByText(/12:34/)).toBeTruthy();
  expect(screen.getByText(/Seleccionado: M4A · mp4a.40.2/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Descargar audio en este iPhone',
    }),
  );
  expect(native.startAudioDownload).toHaveBeenCalledWith('a'.repeat(32), '140');
  expect(JSON.stringify(native.startAudioDownload.mock.calls)).not.toContain(
    'googlevideo',
  );
});

test('native audio progress completes, shares, and cancellation delegates', async () => {
  await render(<TestCard />);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Analizar en este iPhone' }),
  );
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
  await fireEvent.press(
    screen.getByRole('button', { name: 'Analizar en este iPhone' }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    /Este contenido requiere iniciar sesión y no puede procesarse\./,
  );
});

test('pending local analysis prevents a second request and exposes cancellation', async () => {
  native.analyze.mockReturnValue(new Promise(() => {}));
  const view = await render(<TestCard />);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Analizar en este iPhone' }),
  );
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
