import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
import { withLibraryLease } from '@/services/library';
import { useTheme } from '@/theme';

type ExportState = 'idle' | 'saving' | 'saved' | 'cancelled' | 'error';

export function CompletedFileActions({
  uri,
  libraryId,
  onMoreOptions,
  onNewDownload,
}: {
  uri: string;
  libraryId?: string;
  onMoreOptions: () => void;
  onNewDownload: () => void;
}) {
  const { colors } = useTheme();
  const [state, setState] = useState<ExportState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [uri]);

  async function save() {
    if (state === 'saving') return;
    setState('saving');
    setMessage(null);
    try {
      const result = libraryId
        ? await withLibraryLease(libraryId, (item) =>
            withNamedLibraryFile(item, saveLocalFileToFiles),
          )
        : await saveLocalFileToFiles(uri);
      if (!mounted.current) return;
      setState(result);
      setMessage(
        result === 'saved'
          ? 'Guardado en Archivos.'
          : 'No se guardó el archivo.',
      );
    } catch (error) {
      if (!mounted.current) return;
      setState('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar el archivo en Archivos.',
      );
    }
  }

  return (
    <View style={styles.actions}>
      <ActionButton
        label={
          state === 'saving' ? 'Abriendo Archivos…' : 'Guardar en Archivos'
        }
        onPress={() => void save()}
        disabled={state === 'saving'}
        loading={state === 'saving'}
      />
      {message && (
        <Text
          accessibilityRole={state === 'error' ? 'alert' : undefined}
          style={{ color: state === 'error' ? colors.error : colors.secondary }}
        >
          {message}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Más opciones"
        onPress={onMoreOptions}
        style={styles.link}
      >
        <Text style={[styles.linkText, { color: colors.text }]}>
          Más opciones
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nueva descarga"
        onPress={onNewDownload}
        style={styles.link}
      >
        <Text style={[styles.linkText, { color: colors.secondary }]}>
          Nueva descarga
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginTop: 8 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 15, fontWeight: '600' },
});
