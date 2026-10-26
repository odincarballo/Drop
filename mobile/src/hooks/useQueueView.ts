import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import type { LibraryItem } from '@/models/library';
import type { QueueEntry } from '@/models/queue';
import { getLibraryItem, observeLibrary } from '@/services/library';
import {
  getQueuePlaybackSyncState,
  listQueue,
  observeQueue,
  observeQueuePlaybackSync,
} from '@/services/queue';

export type QueueRow = {
  entry: QueueEntry;
  item: LibraryItem | null;
  metadataFailed: boolean;
};
type Metadata = Pick<QueueRow, 'item' | 'metadataFailed'>;

/** A discardable view of SQLite rows. Revisions reject late list/metadata
 * responses; metadata is queried once per distinct Library ID per refresh. */
export function useQueueView() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState(getQueuePlaybackSyncState);
  const refreshRef = useRef<(invalidate?: boolean) => void>(() => undefined);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let revision = 0;
      let scheduled = false;
      const cache = new Map<string, Metadata>();
      const refresh = (invalidate = false) => {
        revision += 1; // Invalidate even before the coalesced read starts.
        if (invalidate) cache.clear();
        if (scheduled) return;
        scheduled = true;
        void Promise.resolve().then(async () => {
          scheduled = false;
          if (!active) return;
          const request = revision;
          setLoading(true);
          try {
            const entries = await listQueue();
            if (!active || request !== revision) return;
            const desiredIds = new Set(entries.map((entry) => entry.itemId));
            const ids = [...desiredIds];
            const missing = ids.filter((id) => !cache.has(id));
            const metadata = await Promise.allSettled(
              missing.map((id) => getLibraryItem(id)),
            );
            if (!active || request !== revision) return;
            for (const [index, result] of metadata.entries()) {
              const id = missing[index]!;
              cache.set(
                id,
                result.status === 'fulfilled'
                  ? {
                      item:
                        result.value?.id === id &&
                        result.value.lifecycle === 'ready'
                          ? result.value
                          : null,
                      metadataFailed: false,
                    }
                  : { item: null, metadataFailed: true },
              );
            }
            for (const id of cache.keys())
              if (!desiredIds.has(id)) cache.delete(id);
            setRows(
              [...entries]
                .sort((a, b) => a.position - b.position)
                .map((entry) => ({
                  entry,
                  ...cache.get(entry.itemId)!,
                })),
            );
            setError(null);
          } catch {
            if (active && request === revision)
              setError('No se pudo cargar la cola. Inténtalo de nuevo.');
          } finally {
            if (active && request === revision) setLoading(false);
          }
        });
      };
      refreshRef.current = refresh;
      const updateSync = () => {
        if (active) setSync(getQueuePlaybackSyncState());
      };
      const stopQueue = observeQueue(() => refresh());
      const stopSync = observeQueuePlaybackSync(updateSync);
      const stopLibrary = observeLibrary(() => refresh(true));
      const app = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          updateSync();
          refresh(true);
        }
      });
      updateSync();
      refresh();
      return () => {
        active = false;
        revision += 1;
        refreshRef.current = () => undefined;
        stopQueue();
        stopSync();
        stopLibrary();
        app.remove();
      };
    }, []),
  );

  const reload = useCallback(() => refreshRef.current(true), []);
  return { rows, loading, error, sync, reload };
}
