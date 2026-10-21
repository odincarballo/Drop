import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import type { LibraryItem } from '@/models/library';
import { getLibraryItem, observeLibrary } from '@/services/library';
import { playback, type PlaybackState } from '@/services/playback';

type ItemResolution = {
  libraryId: string;
  item: LibraryItem | null;
  settled: boolean;
};

type PlaybackContextValue = {
  state: PlaybackState | null;
  item: LibraryItem | null;
  loadingItem: boolean;
  play: () => Promise<PlaybackState>;
  pause: () => Promise<PlaybackState>;
  togglePlayPause: () => Promise<PlaybackState | null>;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

/** A single root-level view of native playback; it does not own the player. */
export function PlaybackProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<PlaybackState | null>(null);
  const [resolution, setResolution] = useState<ItemResolution | null>(null);
  const latestState = useRef<PlaybackState | null>(null);
  const revision = useRef(0);

  const adopt = useCallback((next: PlaybackState) => {
    revision.current += 1;
    if (
      next.status === 'idle' ||
      !next.libraryId ||
      next.libraryId !== latestState.current?.libraryId
    )
      setResolution(null);
    latestState.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    let active = true;
    let request = 0;
    const reconcile = () => {
      const currentRequest = ++request;
      const startingRevision = revision.current;
      void playback
        .getState()
        .then((snapshot) => {
          if (
            active &&
            currentRequest === request &&
            startingRevision === revision.current
          )
            adopt(snapshot);
        })
        .catch(() => undefined);
    };
    const unsubscribe = playback.subscribe((next) => {
      if (active) adopt(next);
    });
    const appSubscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') reconcile();
    });
    reconcile();
    return () => {
      active = false;
      request += 1;
      unsubscribe();
      appSubscription.remove();
    };
  }, [adopt]);

  const libraryId =
    state?.status === 'idle' ? null : (state?.libraryId ?? null);
  useEffect(() => {
    if (!libraryId) return;
    let active = true;
    let request = 0;
    const refresh = () => {
      const currentRequest = ++request;
      void getLibraryItem(libraryId)
        .then((item) => {
          if (active && currentRequest === request)
            setResolution({ libraryId, item, settled: true });
        })
        .catch(() => {
          // Keep the native state even if its Library metadata is unavailable.
          if (active && currentRequest === request)
            setResolution({ libraryId, item: null, settled: true });
        });
    };
    refresh();
    const unsubscribe = observeLibrary(refresh);
    return () => {
      active = false;
      request += 1;
      unsubscribe();
    };
  }, [libraryId]);

  const invoke = useCallback(
    async (command: () => Promise<PlaybackState>) => {
      const startingRevision = revision.current;
      const result = await command();
      // Native events may already have delivered a newer state.
      if (revision.current === startingRevision) adopt(result);
      return result;
    },
    [adopt],
  );
  const play = useCallback(() => invoke(playback.play), [invoke]);
  const pause = useCallback(() => invoke(playback.pause), [invoke]);
  const togglePlayPause = useCallback(() => {
    const current = latestState.current;
    if (!current?.libraryId || current.status === 'idle' || !current.playable)
      return Promise.resolve(null);
    return current.status === 'playing' ? pause() : play();
  }, [pause, play]);

  const item =
    libraryId && resolution?.libraryId === libraryId ? resolution.item : null;
  const loadingItem =
    libraryId !== null &&
    (resolution?.libraryId !== libraryId || !resolution.settled);
  const value = useMemo(
    () => ({ state, item, loadingItem, play, pause, togglePlayPause }),
    [state, item, loadingItem, play, pause, togglePlayPause],
  );
  return (
    <PlaybackContext.Provider value={value}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback(): PlaybackContextValue {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('usePlayback requiere PlaybackProvider.');
  return value;
}
