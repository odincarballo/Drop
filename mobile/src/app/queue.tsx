import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useQueueView, type QueueRow } from '@/hooks/useQueueView';
import { usePlayback } from '@/providers/PlaybackProvider';
import { clearQueue, moveQueueEntry, removeQueueEntry } from '@/services/queue';
import type { PlaybackStatus } from '@/services/playback';
import { useTheme } from '@/theme';

const playbackLabels: Record<PlaybackStatus, string> = {
  idle: 'Sin reproducción activa',
  loading: 'Preparando reproducción',
  ready: 'Listo para reproducir',
  playing: 'Reproduciendo',
  paused: 'En pausa',
  interrupted: 'Interrumpido',
  ended: 'Terminado',
  failed: 'No disponible',
};

function QueueArtwork({ uri, title }: { uri: string | null; title: string }) {
  const { colors } = useTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return (
    <Image
      accessibilityLabel={`Portada de ${title}`}
      resizeMode="contain"
      source={
        uri && failedUri !== uri ? { uri } : require('../../assets/icon.png')
      }
      onError={() => setFailedUri(uri)}
      style={[styles.artwork, { backgroundColor: colors.subtle }]}
    />
  );
}

export default function QueueScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const view = useQueueView();
  const { state, item: currentItem, loadingItem } = usePlayback();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const confirmingClear = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(operation: () => Promise<void>) {
    if (!mounted.current || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSaved(false);
    setActionError(null);
    try {
      await operation();
      if (mounted.current) setSaved(true);
    } catch {
      if (mounted.current) {
        setActionError(
          'No se pudo guardar el cambio en la cola. Inténtalo de nuevo.',
        );
        view.reload();
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function confirmClear() {
    if (confirmingClear.current || inFlight.current || view.rows.length === 0)
      return;
    confirmingClear.current = true;
    Alert.alert(
      'Vaciar cola',
      'Se quitarán las entradas pendientes. La reproducción actual continuará.',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: () => {
            confirmingClear.current = false;
          },
        },
        {
          text: 'Vaciar',
          style: 'destructive',
          onPress: () => {
            confirmingClear.current = false;
            if (mounted.current) void run(clearQueue);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          confirmingClear.current = false;
        },
      },
    );
  }
  const disabled = busy || view.loading || !!view.error;
  const active = !!state?.libraryId && state.status !== 'idle';
  const metadata = currentItem?.id === state?.libraryId ? currentItem : null;

  function control(label: string, onPress: () => void, unavailable = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || unavailable, busy }}
        disabled={disabled || unavailable}
        onPress={onPress}
        style={[styles.action, { opacity: disabled || unavailable ? 0.45 : 1 }]}
      >
        <Text style={{ color: colors.text }}>{label.split(':')[0]}</Text>
      </Pressable>
    );
  }
  function renderRow({ item: row, index }: { item: QueueRow; index: number }) {
    const title =
      row.item?.title ??
      (row.metadataFailed
        ? 'Información no disponible'
        : 'Archivo no disponible');
    return (
      <View
        testID={`queue-entry-${row.entry.id}`}
        style={[styles.row, { borderBottomColor: colors.border }]}
      >
        <View style={styles.media}>
          <QueueArtwork uri={row.item?.artworkUri ?? null} title={title} />
          <View style={styles.body}>
            <Text style={{ color: colors.secondary }}>{index + 1}</Text>
            <Text
              numberOfLines={2}
              ellipsizeMode="tail"
              style={[styles.itemTitle, { color: colors.text }]}
            >
              {title}
            </Text>
            {row.metadataFailed && (
              <Text style={{ color: colors.secondary }}>
                No se pudo cargar la información. Puedes quitar esta entrada.
              </Text>
            )}
          </View>
        </View>
        <View style={styles.actions}>
          {control(
            `Subir entrada ${index + 1}: ${title}`,
            () => void run(() => moveQueueEntry(row.entry.id, index - 1)),
            index === 0,
          )}
          {control(
            `Bajar entrada ${index + 1}: ${title}`,
            () => void run(() => moveQueueEntry(row.entry.id, index + 1)),
            index === view.rows.length - 1,
          )}
          {control(
            `Quitar entrada ${index + 1}: ${title}`,
            () => void run(() => removeQueueEntry(row.entry.id)),
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView
      testID="queue-screen"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a Biblioteca"
          onPress={() => router.replace('/library' as Href)}
          style={styles.action}
        >
          <Text style={{ color: colors.text }}>‹ Biblioteca</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Cola
        </Text>
      </View>
      <FlatList
        data={view.rows}
        keyExtractor={(row) => row.entry.id}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <Text
              accessibilityRole="header"
              style={[styles.heading, { color: colors.text }]}
            >
              Reproduciendo ahora
            </Text>
            {active ? (
              <View
                testID="queue-current"
                style={[styles.current, { backgroundColor: colors.surface }]}
              >
                <QueueArtwork
                  uri={metadata?.artworkUri ?? null}
                  title={metadata?.title ?? 'Drop'}
                />
                <View style={styles.body}>
                  <Text
                    numberOfLines={2}
                    style={[styles.itemTitle, { color: colors.text }]}
                  >
                    {metadata?.title ??
                      (loadingItem
                        ? 'Cargando información…'
                        : 'Elemento no disponible')}
                  </Text>
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{ color: colors.secondary }}
                  >
                    {playbackLabels[state!.status]}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={{ color: colors.secondary }}>
                Sin reproducción activa.
              </Text>
            )}
            <View style={styles.section}>
              <Text
                accessibilityRole="header"
                style={[styles.heading, { color: colors.text }]}
              >
                A continuación
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Vaciar cola"
                accessibilityState={{
                  disabled: disabled || view.rows.length === 0,
                }}
                disabled={disabled || view.rows.length === 0}
                onPress={confirmClear}
                style={styles.action}
              >
                <Text
                  style={{
                    color:
                      disabled || !view.rows.length
                        ? colors.secondary
                        : colors.error,
                  }}
                >
                  Vaciar cola
                </Text>
              </Pressable>
            </View>
            <Text style={{ color: colors.secondary }}>
              Entradas manuales pendientes. Después continúa el contexto de
              reproducción.
            </Text>
            {view.sync.status === 'pending' && (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.notice, { color: colors.secondary }]}
              >
                Guardado en la cola. Actualizando reproducción…
              </Text>
            )}
            {saved && view.sync.status === 'applied' && (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.notice, { color: colors.secondary }]}
              >
                Cola guardada.
              </Text>
            )}
            {busy && (
              <Text style={[styles.notice, { color: colors.secondary }]}>
                Actualizando cola…
              </Text>
            )}
            {(view.error || actionError) && (
              <Text
                accessibilityRole="alert"
                style={[styles.notice, { color: colors.error }]}
              >
                {view.error ?? actionError}
              </Text>
            )}
            {(view.error || view.rows.some((row) => !row.item)) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reintentar cargar la cola"
                onPress={view.reload}
                style={styles.action}
              >
                <Text style={{ color: colors.text }}>Reintentar</Text>
              </Pressable>
            )}
            {view.loading && (
              <ActivityIndicator
                accessibilityLabel="Cargando cola"
                color={colors.accent}
              />
            )}
          </>
        }
        ListEmptyComponent={
          !view.loading && !view.error ? (
            <Text style={[styles.empty, { color: colors.secondary }]}>
              La cola está vacía. Añade audio o video desde Biblioteca o
              Colecciones.
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 22, paddingTop: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 20, fontWeight: '600' },
  list: { padding: 22, paddingBottom: 32 },
  section: { marginTop: 24, gap: 4 },
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 12,
    marginTop: 12,
  },
  media: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1, minWidth: 0, gap: 5 },
  artwork: { width: 54, height: 54, borderRadius: 8 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  row: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 6 },
  action: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  notice: { paddingVertical: 10 },
  empty: { paddingTop: 24, lineHeight: 22 },
});
