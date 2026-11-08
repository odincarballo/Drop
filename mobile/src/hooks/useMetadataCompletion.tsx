import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { LibraryItem } from '@/models/library';
import { isAvailableLibraryItem } from '@/models/library';
import {
  cancelExistingMetadataCompletion,
  completeExistingLocalMetadata,
} from '@/services/library';
import { useTheme } from '@/theme';

export function useMetadataCompletion(item: LibraryItem) {
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('idle');
  const mounted = useRef(true),
    running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (running.current) cancelExistingMetadataCompletion(item.id);
    };
  }, [item.id]);
  const eligible =
    item.sourceKind === 'local' &&
    item.lifecycle === 'ready' &&
    isAvailableLibraryItem(item) &&
    /\.(mp3|m4a|mp4)$/.test(item.relativeMediaPath);
  async function start() {
    if (!eligible || running.current) return;
    running.current = true;
    const update = (state: string, message: string) => {
      if (mounted.current) {
        setPhase(state);
        setStatus(message);
      }
    };
    try {
      const changed = await completeExistingLocalMetadata(
        item.id,
        (current, proposed) =>
          new Promise((resolve) => {
            let handled = false;
            const answer = (choice: 'keep' | 'replace' | 'cancel') => {
              if (!handled) {
                handled = true;
                if (choice === 'cancel') cancelled.current = true;
                resolve(choice);
              }
            };
            Alert.alert(
              'Metadatos encontrados',
              `Título actual: ${current}\nTítulo encontrado: ${proposed}`,
              [
                {
                  text: 'Cancelar operación',
                  style: 'cancel',
                  onPress: () => answer('cancel'),
                },
                { text: 'Conservar título', onPress: () => answer('keep') },
                {
                  text: 'Usar título encontrado',
                  onPress: () => answer('replace'),
                },
              ],
              { cancelable: true, onDismiss: () => answer('cancel') },
            );
          }),
        (next) =>
          update(
            next,
            next === 'analyzing'
              ? 'Analizando…'
              : next === 'found'
                ? 'Metadatos encontrados'
                : 'Guardando información…',
          ),
      );
      update(
        'idle',
        cancelled.current
          ? 'Operación cancelada'
          : changed
            ? 'Información completada'
            : 'No se realizaron cambios. No se encontraron metadatos adicionales o se conservó la información actual.',
      );
    } catch {
      update('idle', 'No se pudo completar. Inténtalo de nuevo.');
    } finally {
      running.current = false;
      cancelled.current = false;
    }
  }
  const cancelled = useRef(false);
  function cancel() {
    if (cancelExistingMetadataCompletion(item.id)) {
      cancelled.current = true;
      if (mounted.current) setStatus('Operación cancelada');
    }
  }
  return {
    eligible,
    start,
    cancel,
    status,
    active: phase !== 'idle',
    canCancel: phase === 'analyzing' || phase === 'found',
  };
}
export function MetadataCompletionStatus({
  value,
}: {
  value: ReturnType<typeof useMetadataCompletion>;
}) {
  const { colors } = useTheme();
  if (!value.status) return null;
  return (
    <View>
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.secondary }}
      >
        {value.status}
      </Text>
      {value.canCancel && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancelar análisis de metadatos"
          onPress={value.cancel}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: colors.accent }}>Cancelar análisis</Text>
        </Pressable>
      )}
    </View>
  );
}
