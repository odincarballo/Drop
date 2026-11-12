import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

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
