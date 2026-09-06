import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as http from 'node:http';
import { Alert } from 'react-native';

import HomeScreen from '@/app/index';
import { config } from '@/config';

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

// Opt-in: this test uses the real API service + schema + backend, not a response fixture.
const liveTest = process.env.MEDIADROP_LIVE_TEST === '1' ? test : test.skip;

liveTest(
  'real screen → API client → running FastAPI → selections → notice',
  async () => {
    // Jest mocks React Native's native networking; use Node HTTP for this test only.
    // Restrict the bridge to a local development server, never arbitrary media URLs.
    const backend = new URL(config.apiBaseUrl);
    expect(['localhost', '127.0.0.1']).toContain(backend.hostname);
    expect(backend.protocol).toBe('http:');
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== backend.origin)
        throw new Error('Unexpected test destination');
      return new Promise((resolve, reject) => {
        const request = http.request(
          url,
          {
            method: init?.method ?? 'GET',
            headers: { 'Content-Type': 'application/json' },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () =>
              resolve(
                new Response(Buffer.concat(chunks).toString('utf8'), {
                  status: response.statusCode ?? 500,
                }),
              ),
            );
          },
        );
        request.on('error', reject);
        request.setTimeout(5000, () =>
          request.destroy(new Error('Test connection timeout')),
        );
        init?.signal?.addEventListener(
          'abort',
          () => request.destroy(new Error('Aborted')),
          { once: true },
        );
        request.end(typeof init?.body === 'string' ? init.body : undefined);
      });
    };
    const network = jest.spyOn(globalThis, 'fetch').mockImplementation(fetcher);
    jest
      .mocked(Clipboard.getStringAsync)
      .mockResolvedValue('https://example.com/video.mp4');
    const notice = jest.spyOn(Alert, 'alert');
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pegar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(
      () => expect(screen.getByText('MediaDrop Demo Video')).toBeTruthy(),
      { timeout: 5000 },
    );
    expect(screen.getByLabelText('Miniatura del recurso')).toBeTruthy();
    expect(screen.getByText(/2:34/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: /1080p/ }));
    await fireEvent.press(
      screen.getByRole('radio', { name: /AAC · 256 kbps/ }),
    );
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    expect(notice).toHaveBeenCalledWith(
      'MediaDrop',
      'Descarga disponible en la siguiente fase.',
    );
    expect(network).toHaveBeenCalledTimes(1);
  },
  10000,
);
