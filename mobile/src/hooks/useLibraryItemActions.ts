import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import type { LibraryItem } from '@/models/library';
import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
import { shareLocalFile } from '@/services/jobs';
import { deleteLibraryItem, withLibraryLease } from '@/services/library';
import { playback } from '@/services/playback';
import {
  isPlayableLibraryItem,
  playbackContextFromVisibleItems,
} from '@/utils/playbackContext';

export function useLibraryItemActions(
  setError: (message: string | null) => void,
) {
  const router = useRouter();
  const busy = useRef<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function open(item: LibraryItem, visibleItems: readonly LibraryItem[]) {
    if (!isPlayableLibraryItem(item)) {
      Alert.alert(
        'Formato no compatible',
        'Este archivo aún no se puede reproducir en Drop. Puedes guardarlo en Archivos o compartirlo.',
      );
      return;
    }
    if (busy.current) return;
    busy.current = item.id;
    setBusyId(item.id);
    setError(null);
    const context = playbackContextFromVisibleItems(visibleItems);
    void playback
      .startInContext(item.id, context.orderedIds)
      .then(() => router.push(`/player/${item.id}` as Href))
      .catch(() => setError('No se pudo iniciar la reproducción.'))
      .finally(() => {
        busy.current = null;
        setBusyId(null);
      });
  }

  async function run(
    id: string,
    action: (item: LibraryItem) => Promise<unknown>,
  ) {
    if (busy.current) return;
    busy.current = id;
    setBusyId(id);
    setError(null);
    try {
      await withLibraryLease(id, action);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'No se pudo completar la acción.',
      );
    } finally {
      busy.current = null;
      setBusyId(null);
    }
  }

  function save(item: LibraryItem) {
    void run(item.id, (file) =>
      withNamedLibraryFile(file, saveLocalFileToFiles),
    );
  }

  function share(item: LibraryItem) {
    void run(item.id, (file) => withNamedLibraryFile(file, shareLocalFile));
  }

  function confirmDelete(item: LibraryItem) {
    Alert.alert(
      'Eliminar descarga',
      `¿Eliminar «${item.title}» de Biblioteca?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void deleteLibraryItem(item.id).catch(() =>
              setError(
                'No se pudo eliminar el archivo. Drop lo intentará al reiniciar.',
              ),
            );
          },
        },
      ],
    );
  }

  return { busyId, open, save, share, confirmDelete };
}
