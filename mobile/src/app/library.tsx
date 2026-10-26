import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  type Href,
} from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollectionPicker } from '@/components/CollectionPicker';
import { LibraryItemRow } from '@/components/LibraryItemRow';
import { useLibraryItemActions } from '@/hooks/useLibraryItemActions';
import { useQueueEnqueue } from '@/hooks/useQueueEnqueue';
import type { CollectionSummary } from '@/models/collections';
import type { LibraryItem } from '@/models/library';
import {
  countUncollectedItems,
  createCollection,
  deleteCollection,
  listCollections,
  observeCollections,
  renameCollection,
} from '@/services/collections';
import { listLibrary, observeLibrary } from '@/services/library';
import { useTheme } from '@/theme';
import { collectionErrorMessage } from '@/utils/collectionErrors';
import { formatSize } from '@/utils/format';

type Filter = 'all' | 'video' | 'audio';
type Section = 'downloads' | 'collections';

function itemCount(count: number): string {
  return `${count} ${count === 1 ? 'elemento' : 'elementos'}`;
}

export default function LibraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const section: Section =
    params.section === 'collections' ? 'collections' : 'downloads';
  const { colors } = useTheme();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [uncollectedCount, setUncollectedCount] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerItemId, setPickerItemId] = useState<string | null>(null);
  const actions = useLibraryItemActions(setError);
  const queueActions = useQueueEnqueue();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let generation = 0;
      const refresh = () => {
        const current = ++generation;
        setLoading(true);
        if (section === 'downloads') {
          void listLibrary()
            .then((found) => {
              if (active && current === generation) setItems(found);
            })
            .catch(() => {
              if (active && current === generation)
                setError('No se pudo abrir la Biblioteca. Inténtalo de nuevo.');
            })
            .finally(() => {
              if (active && current === generation) setLoading(false);
            });
        } else {
          void Promise.all([listCollections(), countUncollectedItems()])
            .then(([found, count]) => {
              if (!active || current !== generation) return;
              setCollections(found);
              setUncollectedCount(count);
            })
            .catch(() => {
              if (active && current === generation)
                setError('No se pudieron cargar las colecciones.');
            })
            .finally(() => {
              if (active && current === generation) setLoading(false);
            });
        }
      };
      refresh();
      const unsubscribe =
        section === 'downloads'
          ? observeLibrary(refresh)
          : observeCollections(refresh);
      return () => {
        active = false;
        generation += 1;
        unsubscribe();
      };
    }, [section]),
  );

  function chooseSection(next: Section) {
    setError(null);
    router.setParams({ section: next });
  }

  function promptCreate() {
    Alert.prompt(
      'Nueva colección',
      'Escribe un nombre para la colección.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Crear',
          onPress: (name?: string) => {
            void createCollection(name ?? '').catch((failure) =>
              setError(collectionErrorMessage(failure)),
            );
          },
        },
      ],
      'plain-text',
    );
  }

  function promptRename(entry: CollectionSummary) {
    Alert.prompt(
      'Renombrar colección',
      undefined,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Guardar',
          onPress: (name?: string) => {
            void renameCollection(entry.id, name ?? '').catch((failure) =>
              setError(collectionErrorMessage(failure)),
            );
          },
        },
      ],
      'plain-text',
      entry.name,
    );
  }

  function confirmDeleteCollection(entry: CollectionSummary) {
    Alert.alert(
      `¿Eliminar la colección «${entry.name}»?`,
      'Las descargas permanecerán en tu Biblioteca.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void deleteCollection(entry.id).catch((failure) =>
              setError(collectionErrorMessage(failure)),
            );
          },
        },
      ],
    );
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
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ver cola"
              onPress={() => router.push('/queue' as Href)}
              style={styles.settings}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                Cola
              </Text>
            </Pressable>
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
        <View style={styles.sections}>
          {(
            [
              ['downloads', 'Descargas'],
              ['collections', 'Colecciones'],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: section === value }}
              onPress={() => chooseSection(value)}
              style={[
                styles.section,
                {
                  borderBottomColor:
                    section === value ? colors.accent : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color: section === value ? colors.text : colors.secondary,
                  fontWeight: '600',
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {section === 'downloads' ? (
          <>
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
          </>
        ) : (
          <View style={styles.collectionsHeader}>
            <Text style={{ color: colors.secondary }}>
              Organiza tus descargas
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Crear colección"
              onPress={promptCreate}
              style={styles.add}
            >
              <Text style={{ color: colors.text, fontSize: 26 }}>+</Text>
            </Pressable>
          </View>
        )}
      </View>
      {queueActions.message && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.error, { color: colors.secondary }]}
        >
          {queueActions.message}
        </Text>
      )}
      {queueActions.error && (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {queueActions.error}
        </Text>
      )}
      {error && (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {error}
        </Text>
      )}
      {loading && (
        <ActivityIndicator accessibilityLabel="Cargando Biblioteca" />
      )}
      {section === 'downloads' ? (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            loading ? null : (
              <Text style={{ color: colors.secondary }}>
                Todavía no hay descargas en esta sección.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <LibraryItemRow
              item={item}
              busy={actions.busyId === item.id}
              queueBusy={queueActions.busyId !== null}
              onQueueNext={queueActions.next}
              onQueueLast={queueActions.last}
              onOpen={(selected) => actions.open(selected, visible)}
              onSave={actions.save}
              onShare={actions.share}
              onDelete={actions.confirmDelete}
              onCollections={(selected) => setPickerItemId(selected.id)}
            />
          )}
        />
      ) : (
        <FlatList
          data={collections}
          keyExtractor={(entry) => entry.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sin colección"
              onPress={() => router.push('/collections/uncollected' as Href)}
              style={[
                styles.collectionRow,
                { borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.collectionName, { color: colors.text }]}>
                Sin colección
              </Text>
              <Text style={{ color: colors.secondary }}>
                {itemCount(uncollectedCount)} · Vista automática
              </Text>
            </Pressable>
          }
          ListEmptyComponent={
            loading ? null : (
              <Text style={{ color: colors.secondary, paddingTop: 20 }}>
                No hay colecciones todavía.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.collectionRow,
                { borderBottomColor: colors.border },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Abrir colección ${item.name}`}
                onPress={() => router.push(`/collections/${item.id}` as Href)}
                style={styles.collectionOpen}
              >
                <Text style={[styles.collectionName, { color: colors.text }]}>
                  {item.name}
                </Text>
                <Text style={{ color: colors.secondary }}>
                  {itemCount(item.itemCount)}
                </Text>
              </Pressable>
              <View style={styles.collectionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Renombrar ${item.name}`}
                  onPress={() => promptRename(item)}
                  style={styles.action}
                >
                  <Text style={{ color: colors.text }}>Renombrar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Eliminar colección ${item.name}`}
                  onPress={() => confirmDeleteCollection(item)}
                  style={styles.action}
                >
                  <Text style={{ color: colors.error }}>
                    Eliminar colección
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
      <CollectionPicker
        visible={pickerItemId !== null}
        itemId={pickerItemId}
        onClose={() => setPickerItemId(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 22, paddingTop: 18, gap: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  sections: { flexDirection: 'row', gap: 20, marginTop: 4 },
  section: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2 },
  filters: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  filter: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
  },
  collectionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  add: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: 22, paddingBottom: 24 },
  error: { paddingHorizontal: 22 },
  collectionRow: { borderBottomWidth: 1, paddingVertical: 16, minHeight: 74 },
  collectionOpen: { minHeight: 48, justifyContent: 'center' },
  collectionName: { fontSize: 17, fontWeight: '600' },
  collectionActions: { flexDirection: 'row', gap: 20 },
  action: { minHeight: 44, justifyContent: 'center' },
});
