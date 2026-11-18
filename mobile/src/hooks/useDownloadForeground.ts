import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { DownloadStartInterrupted } from '@/services/errors';

export async function inDownloadForeground<T>(
  signal: AbortSignal,
  isStillForeground: () => boolean,
  action: (signal: AbortSignal) => Promise<T>,
) {
  const local = new AbortController();
  const abort = () => local.abort();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') abort();
  });
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted || !isStillForeground())
      throw new DownloadStartInterrupted();
    return await action(local.signal);
  } finally {
    subscription.remove();
    signal.removeEventListener('abort', abort);
  }
}

export function useDownloadForeground() {
  const generation = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') generation.current += 1;
    });
    return () => subscription.remove();
  }, []);

  return useCallback(
    () => (AppState.currentState === 'active' ? generation.current : null),
    [],
  );
}
