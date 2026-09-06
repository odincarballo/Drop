import { z } from 'zod';

import { config } from '@/config';
import { mediaAnalysisSchema } from '@/models/media';
import { createApiClient } from '@/services/api';
import { analyzeMedia } from '@/services/media';
import { createDownloadJob, deleteDownloadJob } from '@/services/jobs';
import { demoMedia } from './fixtures/media';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  getItemAsync: jest
    .fn()
    .mockResolvedValue('test-token-0123456789abcdef0123456789abcdef'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('media service sends exactly the URL and validates the result', async () => {
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(jsonResponse(demoMedia));
  const data = await analyzeMedia(
    'https://example.com/video.mp4',
    new AbortController().signal,
  );
  expect(data).toEqual(demoMedia);
  expect(fetchSpy).toHaveBeenCalledWith(
    `${config.apiBaseUrl}/analyze`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/video.mp4' }),
    }),
  );
});

test('job service creates and cancels a typed job', async () => {
  const pendingJob = {
    id: 'job-1',
    status: 'PENDING',
    progress: 0,
    bytesDownloaded: 0,
    totalBytes: 12,
    fileName: 'clip.mp4',
    fileSize: null,
    error: null,
    downloadUrl: null,
  };
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(jsonResponse(pendingJob))
    .mockResolvedValueOnce(
      jsonResponse({ ...pendingJob, status: 'CANCELLED', progress: null }),
    );
  await expect(
    createDownloadJob(
      {
        mediaId: 'direct-media',
        downloadType: 'VIDEO_AUDIO',
        formatId: 'format-original',
      },
      new AbortController().signal,
    ),
  ).resolves.toEqual(pendingJob);
  await expect(deleteDownloadJob('job-1')).resolves.toMatchObject({
    status: 'CANCELLED',
  });
  expect(fetchSpy).toHaveBeenNthCalledWith(
    1,
    `${config.apiBaseUrl}/jobs`,
    expect.objectContaining({ method: 'POST' }),
  );
  expect(fetchSpy).toHaveBeenNthCalledWith(
    2,
    `${config.apiBaseUrl}/jobs/job-1`,
    expect.objectContaining({ method: 'DELETE' }),
  );
});

test('job service sends typed YouTube audio conversion choices', async () => {
  const pendingJob = {
    id: 'job-youtube',
    status: 'PREPARING',
    phase: 'PREPARING',
    progress: 0,
    bytesDownloaded: 0,
    totalBytes: 3000000,
    fileName: 'Authorized video.mp3',
    fileSize: null,
    error: null,
    downloadUrl: null,
    message: 'Preparando descarga…',
  };
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(jsonResponse(pendingJob));
  await createDownloadJob({
    mediaId: 'youtube-demo',
    downloadType: 'AUDIO_ONLY',
    formatId: '140',
    audioOutputFormat: 'MP3',
    audioBitrate: 256000,
  });
  expect(fetchSpy).toHaveBeenCalledWith(
    `${config.apiBaseUrl}/jobs`,
    expect.objectContaining({
      body: JSON.stringify({
        mediaId: 'youtube-demo',
        downloadType: 'AUDIO_ONLY',
        formatId: '140',
        audioOutputFormat: 'MP3',
        audioBitrate: 256000,
      }),
    }),
  );
});

test('reusable API client supports GET, normalizes base URL and returns typed data', async () => {
  const fetcher = jest.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
  const client = createApiClient({
    baseUrl: 'http://localhost:8000/',
    timeoutMs: 500,
    fetcher,
  });
  expect(
    await client.request('/health', {
      schema: z.object({ status: z.literal('ok') }),
    }),
  ).toEqual({ status: 'ok' });
  expect(fetcher).toHaveBeenCalledWith(
    'http://localhost:8000/health',
    expect.objectContaining({ method: 'GET' }),
  );
});

test('API client sends a bearer token only in the Authorization header', async () => {
  const fetcher = jest.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
  const client = createApiClient({
    baseUrl: 'https://api.example.com',
    timeoutMs: 500,
    fetcher,
    getToken: async () => 'private-token-value',
  });
  await client.request('/health', {
    schema: z.object({ status: z.literal('ok') }),
  });
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.example.com/health',
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer private-token-value',
      }),
    }),
  );
  expect(fetcher).not.toHaveBeenCalledWith(
    expect.stringContaining('private-token-value'),
    expect.anything(),
  );
});

test.each([
  [
    400,
    'UNSUPPORTED_URL',
    'UNSUPPORTED_URL',
    'Esta fuente todavía no es compatible.',
  ],
  [
    500,
    'INTERNAL_ERROR',
    'SERVER_ERROR',
    'El servidor no pudo completar la solicitud. Inténtalo más tarde.',
  ],
  [
    504,
    'ANALYSIS_TIMEOUT',
    'ANALYSIS_TIMEOUT',
    'El análisis tardó demasiado. Inténtalo de nuevo.',
  ],
] as const)(
  'sanitizes HTTP %s error %s',
  async (status, backendCode, code, message) => {
    const fetcher = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: backendCode,
            message: 'Internal traceback /secret/file',
          },
        },
        status,
      ),
    );
    const client = createApiClient({
      baseUrl: config.apiBaseUrl,
      timeoutMs: 500,
      fetcher,
    });
    await expect(
      client.request('/analyze', { schema: mediaAnalysisSchema }),
    ).rejects.toMatchObject({ code, message });
  },
);

test.each([null, {}, { ...demoMedia, videoFormats: 'invalid' }])(
  'rejects malformed success response',
  async (payload) => {
    const fetcher = jest.fn().mockResolvedValue(jsonResponse(payload));
    const client = createApiClient({
      baseUrl: config.apiBaseUrl,
      timeoutMs: 500,
      fetcher,
    });
    await expect(
      client.request('/analyze', { schema: mediaAnalysisSchema }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  },
);

test('handles HTML instead of JSON', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValue(new Response('<html>error</html>'));
  const client = createApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: 500,
    fetcher,
  });
  await expect(
    client.request('/analyze', { schema: mediaAnalysisSchema }),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('handles backend unavailable without exposing exception text', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('internal secret'));
  const client = createApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: 500,
    fetcher,
  });
  await expect(
    client.request('/analyze', { schema: mediaAnalysisSchema }),
  ).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
    message:
      'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  });
});

test('timeout aborts the request', async () => {
  const fetcher: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('aborted')),
      );
    });
  const client = createApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: 5,
    fetcher,
  });
  await expect(
    client.request('/analyze', { schema: mediaAnalysisSchema }),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
});

test('timeout while reading the response body remains a timeout', async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    const response = jsonResponse(demoMedia);
    jest.spyOn(response, 'json').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    return response;
  };
  const client = createApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: 5,
    fetcher,
  });
  await expect(
    client.request('/analyze', { schema: mediaAnalysisSchema }),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
});

test('explicit caller cancellation is not reported as a timeout', async () => {
  const caller = new AbortController();
  const fetcher: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('aborted')),
      );
    });
  const client = createApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: 500,
    fetcher,
  });
  const request = client.request('/analyze', {
    schema: mediaAnalysisSchema,
    signal: caller.signal,
  });
  caller.abort();
  await expect(request).rejects.toMatchObject({ code: 'CANCELLED' });
});

test('nullable metadata and inline PNG are supported, other inline types are rejected', () => {
  expect(mediaAnalysisSchema.safeParse(demoMedia).success).toBe(true);
  expect(
    mediaAnalysisSchema.safeParse({
      ...demoMedia,
      source: null,
      title: null,
      duration: null,
      thumbnail: null,
    }).success,
  ).toBe(true);
  expect(
    mediaAnalysisSchema.safeParse({
      ...demoMedia,
      thumbnail: 'data:text/html;base64,YQ==',
    }).success,
  ).toBe(false);
});
