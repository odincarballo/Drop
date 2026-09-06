import type { z } from 'zod';

import { config } from '@/config';
import { ApiError, serverError } from './errors';
import { getApiToken } from './token';

type ApiClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
  getToken?: () => Promise<string | null>;
};
type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  schema: z.ZodType<T>;
};

export function createApiClient({
  baseUrl,
  timeoutMs,
  fetcher,
  getToken,
}: ApiClientOptions) {
  return {
    async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      options.signal?.addEventListener('abort', abort);
      if (options.signal?.aborted) controller.abort();
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const token = await getToken?.();
        if (controller.signal.aborted) throw new Error('Request aborted');
        const response = await (fetcher ?? fetch)(
          `${baseUrl.replace(/\/+$/, '')}${path}`,
          {
            method: options.method ?? 'GET',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body:
              options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
            signal: controller.signal,
          },
        );
        const payload: unknown = await response
          .json()
          .catch((error: unknown) => {
            if (controller.signal.aborted) throw error;
            return null;
          });
        if (!response.ok) throw serverError(response.status, payload);
        const result = options.schema.safeParse(payload);
        if (!result.success)
          throw new ApiError(
            'INVALID_RESPONSE',
            'No se pudo leer la información del recurso. Inténtalo de nuevo.',
          );
        return result.data;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (options.signal?.aborted)
          throw new ApiError('CANCELLED', 'Análisis cancelado.');
        if (timedOut)
          throw new ApiError(
            'TIMEOUT',
            'El servidor tardó demasiado. Inténtalo de nuevo.',
          );
        throw new ApiError(
          'NETWORK_ERROR',
          'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
        );
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
      }
    },
  };
}

export const apiClient = createApiClient({
  baseUrl: config.apiBaseUrl,
  timeoutMs: config.apiTimeoutMs,
  getToken: getApiToken,
});

export function apiUrl(path: string): string {
  return `${config.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
