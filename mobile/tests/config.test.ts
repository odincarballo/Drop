import { createConfig } from '@/config';

test('development configuration accepts a local HTTP backend', () => {
  const config = createConfig({
    EXPO_PUBLIC_APP_ENV: 'development',
    EXPO_PUBLIC_API_URL: 'http://192.168.1.25:8000/',
  });
  expect(config.appEnvironment).toBe('development');
  expect(config.apiBaseUrl).toBe('http://192.168.1.25:8000');
});

test('production configuration accepts a public HTTPS origin', () => {
  const config = createConfig({
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_API_URL: 'https://mediadrop.example.com',
  });
  expect(config.appEnvironment).toBe('production');
  expect(config.apiBaseUrl).toBe('https://mediadrop.example.com');
});

test.each([
  'http://mediadrop.example.com',
  'https://localhost:8000',
  'https://127.0.0.1:8000',
  'https://10.0.0.1',
  'https://172.20.0.1',
  'https://192.168.1.1',
  'https://[::1]',
  'https://[fd00::1]',
])('production configuration rejects unsafe backend URL %s', (url) => {
  expect(() =>
    createConfig({
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_URL: url,
    }),
  ).toThrow();
});

test('production configuration requires an explicit backend URL', () => {
  expect(() => createConfig({ EXPO_PUBLIC_APP_ENV: 'production' })).toThrow(
    'EXPO_PUBLIC_API_URL is required for production',
  );
});
