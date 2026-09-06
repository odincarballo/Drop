export type AppEnvironment = 'development' | 'production';

export type PublicEnvironment = Readonly<{
  EXPO_PUBLIC_APP_ENV?: string;
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_API_TIMEOUT_MS?: string;
  EXPO_PUBLIC_JOB_POLL_INTERVAL_MS?: string;
}>;

function readPositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (
    octets.some(
      (part, index) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255 ||
        String(part) !== parts[index],
    )
  )
    return false;
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    isPrivateIpv4(normalized)
  );
}

function apiBaseUrl(
  env: PublicEnvironment,
  appEnvironment: AppEnvironment,
): string {
  const raw =
    env.EXPO_PUBLIC_API_URL ??
    // Compatibility with local phase 0.1 configuration only.
    env.EXPO_PUBLIC_API_BASE_URL ??
    (appEnvironment === 'development' ? 'http://localhost:8000' : undefined);
  if (!raw) throw new Error('EXPO_PUBLIC_API_URL is required for production');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid URL');
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'EXPO_PUBLIC_API_URL must not contain credentials, query or fragment',
    );
  if (url.pathname !== '/' && url.pathname !== '')
    throw new Error('EXPO_PUBLIC_API_URL must be the backend origin');
  if (appEnvironment === 'production') {
    if (url.protocol !== 'https:')
      throw new Error('Production backend must use HTTPS');
    if (isLocalHostname(url.hostname))
      throw new Error('Production backend must be publicly reachable');
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Development backend must use HTTP or HTTPS');
  }
  return url.origin;
}

export function createConfig(env: PublicEnvironment) {
  const appEnvironment =
    env.EXPO_PUBLIC_APP_ENV === 'production' ? 'production' : 'development';
  return {
    appEnvironment,
    apiBaseUrl: apiBaseUrl(env, appEnvironment),
    apiTimeoutMs: readPositive(env.EXPO_PUBLIC_API_TIMEOUT_MS, 15000),
    jobPollIntervalMs: readPositive(env.EXPO_PUBLIC_JOB_POLL_INTERVAL_MS, 750),
    maxUrlLength: 2048,
  } as const;
}

export const config = createConfig({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_API_TIMEOUT_MS: process.env.EXPO_PUBLIC_API_TIMEOUT_MS,
  EXPO_PUBLIC_JOB_POLL_INTERVAL_MS:
    process.env.EXPO_PUBLIC_JOB_POLL_INTERVAL_MS,
});
