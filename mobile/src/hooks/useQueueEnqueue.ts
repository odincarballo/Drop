import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { LibraryItem } from '@/models/library';
import {
  enqueueLast,
  enqueueNext,
  getQueuePlaybackSyncState,
  observeQueuePlaybackSync,
} from '@/services/queue';
import { isPlayableLibraryItem } from '@/utils/playbackContext';

/** A press lock, not deduplication: a later deliberate press creates a new
 * occurrence. Queue owns persistence; this hook never opens or plays an item. */
export function useQueueEnqueue() {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hasEnqueued, setHasEnqueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState(getQueuePlaybackSyncState);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!hasEnqueued) return;
      let active = true;
      const update = () => {
        if (active && mounted.current) setSync(getQueuePlaybackSyncState());
      };
      update();
      const stop = observeQueuePlaybackSync(update);
      return () => {
        active = false;
        stop();
      };
    }, [hasEnqueued]),
  );

  async function enqueue(item: LibraryItem, next: boolean) {
    if (!mounted.current || inFlight.current) return;
    if (item.lifecycle !== 'ready' || !isPlayableLibraryItem(item)) {
      setError('Este archivo no se puede añadir a la cola.');
      return;
    }
    inFlight.current = true;
    setBusyId(item.id);
    setSaved(false);
    setError(null);
    try {
      await (next ? enqueueNext(item.id) : enqueueLast(item.id));
      if (mounted.current) {
        setSync(getQueuePlaybackSyncState());
        setSaved(true);
        setHasEnqueued(true);
      }
    } catch {
      if (mounted.current)
        setError('No se pudo guardar en la cola. Inténtalo de nuevo.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusyId(null);
    }
  }

  const message = busyId
    ? 'Actualizando cola…'
    : saved
      ? sync.status === 'applied'
        ? 'Añadido a la cola.'
        : 'Guardado en la cola. Actualizando reproducción…'
      : null;
  return {
    busyId,
    message,
    error,
    next: (item: LibraryItem) => {
      void enqueue(item, true);
    },
    last: (item: LibraryItem) => {
      void enqueue(item, false);
    },
  };
}
