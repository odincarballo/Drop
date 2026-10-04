import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LibraryItem } from '@/models/library';
import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
import { shareLocalFile } from '@/services/jobs';
import {
  deleteLibraryItem,
  listLibrary,
  observeLibrary,
  withLibraryLease,
} from '@/services/library';
import { useTheme } from '@/theme';
import { formatSize } from '@/utils/format';

type Filter = 'all' | 'video' | 'audio';

export default function LibraryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listLibrary()
      .then(setItems)
      .catch(() =>
        setError('No se pudo abrir la Biblioteca. Inténtalo de nuevo.'),
      );
  }, []);
  useFocusEffect(
    useCallback(() => {
      refresh();
      return observeLibrary(refresh);
    }, [refresh]),
  );

  async function run(
    id: string,
    action: (item: LibraryItem) => Promise<unknown>,
  ) {
    if (busyId) return;
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
      setBusyId(null);
    }
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

  function openItem(item: LibraryItem) {
    const extension = item.relativeMediaPath.split('.').at(-1)?.toLowerCase();
    if (!(
      (item.mediaType === 'video' && extension === 'mp4') ||
      (item.mediaType === 'audio' && extension === 'm4a')
    )) {
      Alert.alert(
        'Formato no compatible',
        'Este archivo aún no se puede reproducir en Drop. Puedes guardarlo en Archivos o compartirlo.',
      );
      return;
    }
    router.push(`/player/${item.id}` as Href);
  }

  const visible = items.filter(
    (item) => filter === 'all' || item.mediaType === filter,
  );
  const used = items.reduce(
    (total, item) => total + item.sizeBytes + item.artworkSizeBytes,
    0,
  );

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            Drop
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajustes"
            onPress={() => router.push('/settings' as Href)}
            style={styles.settings}
          >
            <SymbolView
              name="gearshape"
              type="monochrome"
              size={24}
              tintColor={colors.text}
            />
          </Pressable>
        </View>
        <View style={styles.navigation}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: false }}
            onPress={() => router.replace('/' as Href)}
            style={styles.tab}
          >
            <Text style={{ color: colors.secondary, fontWeight: '600' }}>
              Descargar
            </Text>
          </Pressable>
          <Text
            accessibilityRole="tab"
            accessibilityState={{ selected: true }}
            style={{ color: colors.text, fontWeight: '600' }}
          >
            Biblioteca
          </Text>
        </View>
        <Text style={[styles.heading, { color: colors.text }]}>Biblioteca</Text>
        <Text style={{ color: colors.secondary }}>
          {formatSize(used)} utilizados
        </Text>
        <View style={styles.filters}>
          {(
            [
              ['all', 'Todos'],
              ['video', 'Videos'],
              ['audio', 'Audio'],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === value }}
              onPress={() => setFilter(value)}
              style={[
                styles.filter,
                {
                  borderColor: colors.border,
                  backgroundColor:
                    filter === value ? colors.accent : colors.surface,
                },
              ]}
            >
              <Text
                style={{
                  color: filter === value ? colors.onAccent : colors.text,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.error, paddingHorizontal: 22 }}
        >
          {error}
        </Text>
      )}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={{ color: colors.secondary }}>
            Todavía no hay descargas en esta sección.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.item, { borderBottomColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Reproducir ${item.title}`}
              onPress={() => openItem(item)}
              style={styles.playableRow}
            >
              <View
                style={[styles.artwork, { backgroundColor: colors.subtle }]}
              >
                {item.artworkUri ? (
                  <Image
                    source={{ uri: item.artworkUri }}
                    style={styles.image}
                    accessibilityLabel="Portada descargada"
                  />
                ) : (
                  <Image
                    source={require('../../assets/icon.png')}
                    style={styles.image}
                    accessibilityLabel="Portada de Drop"
                  />
                )}
              </View>
              <View style={styles.itemBody}>
                <Text
                  numberOfLines={2}
                  style={[styles.itemTitle, { color: colors.text }]}
                >
                  {item.title}
                </Text>
                <Text style={{ color: colors.secondary }}>
                  {item.mediaType === 'video' ? 'Video' : 'Audio'}
                  {item.resolution ? ` · ${item.resolution}` : ''} ·{' '}
                  {formatSize(item.sizeBytes)}
                </Text>
                <Text style={{ color: colors.secondary, fontSize: 12 }}>
                  {new Date(item.downloadedAt).toLocaleDateString()}
                </Text>
                <View
                  style={[
                    styles.progressTrack,
                    { backgroundColor: colors.progressTrack },
                  ]}
                >
                  <View
                    style={[
                      styles.progress,
                      {
                        backgroundColor: colors.accent,
                        width: `${
                          item.completedAt
                            ? 100
                            : item.durationSeconds
                              ? Math.min(
                                  100,
                                  (100 * item.playbackPositionSeconds) /
                                    item.durationSeconds,
                                )
                              : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
              </View>
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={busyId === item.id}
                onPress={() =>
                  void run(item.id, (file) =>
                    withNamedLibraryFile(file, saveLocalFileToFiles),
                  )
                }
                style={styles.action}
              >
                <Text style={{ color: colors.text }}>Guardar en Archivos</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busyId === item.id}
                onPress={() =>
                  void run(item.id, (file) =>
                    withNamedLibraryFile(file, shareLocalFile),
                  )
                }
                style={styles.action}
              >
                <Text style={{ color: colors.text }}>Compartir</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busyId === item.id}
                onPress={() => confirmDelete(item)}
                style={styles.action}
              >
                <Text style={{ color: colors.error }}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 22, paddingTop: 18, gap: 8 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 34, fontWeight: '700' },
  settings: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigation: { flexDirection: 'row', gap: 20, alignItems: 'center' },
  tab: { minHeight: 44, justifyContent: 'center' },
  heading: { fontSize: 25, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  filter: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
  },
  list: { paddingHorizontal: 22, paddingBottom: 24 },
  item: {
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  playableRow: { flexDirection: 'row', gap: 12, minHeight: 80 },
  artwork: { width: 76, height: 76, borderRadius: 10, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  itemBody: { flex: 1, gap: 5 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  progressTrack: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progress: { height: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 },
  action: { minHeight: 40, justifyContent: 'center' },
});
