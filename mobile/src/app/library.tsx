import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AccessibilityInfo,
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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

import { ActionButton } from '@/components/ActionButton';
import { CollectionPicker } from '@/components/CollectionPicker';
import { LibraryItemRow } from '@/components/LibraryItemRow';
import { useLibraryView } from '@/providers/LibraryViewProvider';
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
import {
  getLocalImportState,
  observeLocalImport,
  startLocalImport,
  retryLocalImport,
  cancelLocalImport,
} from '@/services/localImport';
import { useTheme } from '@/theme';
import { collectionErrorMessage } from '@/utils/collectionErrors';
import { formatSize } from '@/utils/format';

import {
  librarySortOptions,
  normalizeLibraryQuery,
  selectLibraryItems,
  type LibraryFilter,
  type LibrarySort,
} from '@/utils/libraryQuery';
type Section = 'downloads' | 'collections';

function itemCount(count: number): string {
  return `${count} ${count === 1 ? 'elemento' : 'elementos'}`;
}

export default function LibraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const section: Section =
    params.section === 'collections' ? 'collections' : 'downloads';
  const { colors, isDark } = useTheme();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [uncollectedCount, setUncollectedCount] = useState(0);
  const { viewMode, setViewMode } = useLibraryView();
  const [viewportWidth, setViewportWidth] = useState(0);
  const columns = viewMode === 'grid' && viewportWidth >= 356 ? 2 : 1;
  const cardWidth = columns === 2 ? (viewportWidth - 44 - 12) / 2 : undefined;
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const sortLabel = librarySortOptions.find(([value]) => value === sort)![1];
  const sortMenu = useRef({ active: false, open: false, generation: 0 });
  const [actionError, setError] = useState<string | null>(null);
  const [failedSection, setFailedSection] = useState<Section | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const readError =
    failedSection !== section
      ? null
      : section === 'downloads'
        ? 'No se pudo abrir la Biblioteca. Inténtalo de nuevo.'
        : 'No se pudieron cargar las colecciones.';
  const [loading, setLoading] = useState(true);
  const [pickerItemId, setPickerItemId] = useState<string | null>(null);
  const importState = useSyncExternalStore(
    observeLocalImport,
    getLocalImportState,
    getLocalImportState,
  );
  const importButton = useRef<View>(null);
  const importStatus = useRef<View>(null);
  const previousImportPhase = useRef(importState.phase);
  const actions = useLibraryItemActions(setError);
  const queueActions = useQueueEnqueue();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let generation = 0;
      const refresh = () => {
        if (!active) return;
        const current = ++generation;
        setLoading(true);
        if (section === 'downloads') {
          void listLibrary()
            .then((found) => {
              if (!active || current !== generation) return;
              setItems(found);
              setFailedSection(null);
            })
            .catch(() => {
              if (active && current === generation) setFailedSection(section);
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
              setFailedSection(null);
            })
            .catch(() => {
              if (active && current === generation) setFailedSection(section);
            })
            .finally(() => {
              if (active && current === generation) setLoading(false);
            });
        }
      };
      refreshRef.current = refresh;
      refresh();
      const unsubscribe =
        section === 'downloads'
          ? observeLibrary(refresh)
          : observeCollections(refresh);
      return () => {
        active = false;
        refreshRef.current = null;
        unsubscribe();
      };
    }, [section]),
  );

  useFocusEffect(
    useCallback(() => {
      const menu = sortMenu.current;
      menu.active = section === 'downloads';
      return () => {
        menu.active = false;
        menu.open = false;
        menu.generation += 1;
      };
    }, [section]),
  );

  function showSortMenu() {
    const menu = sortMenu.current;
    if (!menu.active || menu.open) return;
    menu.open = true;
    const generation = ++menu.generation;
    let handled = false;
    try {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Ordenar archivos',
          message: `Seleccionado: ${sortLabel}`,
          options: [
            ...librarySortOptions.map(([, label]) => label),
            'Cancelar',
          ],
          cancelButtonIndex: librarySortOptions.length,
          userInterfaceStyle: isDark ? 'dark' : 'light',
        },
        (index) => {
          if (handled || !menu.active || generation !== menu.generation) return;
          handled = true;
          menu.open = false;
          const option = librarySortOptions[index];
          if (option) setSort(option[0]);
        },
      );
    } catch {
      menu.open = false;
      setError('No se pudo abrir el selector de orden. Inténtalo de nuevo.');
    }
  }

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

  const visible = useMemo(
    () => selectLibraryItems(items, query, filter, sort),
    [items, query, filter, sort],
  );
  const importBusy = [
    'selecting',
    'preparing',
    'copying',
    'validating',
    'cancelling',
    'saving',
  ].includes(importState.phase);
  const importCanCancel = [
    'selecting',
    'preparing',
    'copying',
    'validating',
  ].includes(importState.phase);
  const importHidden =
    importState.item &&
    selectLibraryItems([importState.item], query, filter, sort).length === 0;
  let importMessage = '';
  switch (importState.phase) {
    case 'selecting':
      importMessage = 'Seleccionando archivo…';
      break;
    case 'preparing':
      importMessage = 'Preparando archivo…';
      break;
    case 'copying':
      importMessage = `Copiando archivo… ${Math.floor((importState.copiedBytes! / importState.totalBytes!) * 100)}%`;
      break;
    case 'validating':
      importMessage = 'Validando archivo…';
      break;
    case 'cancelling':
      importMessage = 'Cancelando importación…';
      break;
    case 'saving':
      importMessage = 'Guardando en Biblioteca…';
      break;
    case 'cancelled':
      importMessage = 'Importación cancelada.';
      break;
    case 'error':
      importMessage = importState.message ?? 'No se pudo importar el archivo.';
      break;
    case 'completed':
      importMessage =
        section === 'collections'
          ? 'Archivo importado en Biblioteca. Disponible en Archivos.'
          : importHidden
            ? 'Archivo importado. La búsqueda o los filtros actuales lo ocultan.'
            : 'Archivo importado en Biblioteca.';
  }
  // Progress is visual. VoiceOver announces phase changes and the final outcome once.
  useEffect(() => {
    const previous = previousImportPhase.current;
    if (previous === importState.phase) return;
    previousImportPhase.current = importState.phase;
    if (importMessage)
      AccessibilityInfo.announceForAccessibility(
        importState.phase === 'copying' ? 'Copiando archivo…' : importMessage,
      );
    const target =
      importState.phase === 'cancelled'
        ? (importButton.current ?? importStatus.current)
        : importStatus.current;
    if (
      target &&
      (previous === 'selecting' ||
        ['completed', 'error', 'cancelled'].includes(importState.phase))
    )
      AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
  }, [importState.phase, importMessage]);

  const used = items.reduce(
    (total, item) =>
      total + (item.mediaSizeOnDisk ?? 0) + item.artworkSizeBytes,
    0,
  );

  const queryControls = (
    <View style={{ gap: 8, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['list', 'Lista'],
            ['grid', 'Cuadrícula'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Vista de ${label.toLowerCase()}`}
            accessibilityState={{ selected: viewMode === value }}
            onPress={() => setViewMode(value)}
            style={[
              styles.filter,
              {
                minHeight: 44,
                justifyContent: 'center',
                borderColor: colors.border,
                backgroundColor:
                  viewMode === value ? colors.accent : colors.surface,
              },
            ]}
          >
            <Text
              style={{
                color: viewMode === value ? colors.onAccent : colors.text,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Buscar en Biblioteca"
        placeholder="Buscar título, formato, resolución o ID de origen"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={{
          color: colors.text,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 10,
          padding: 12,
          minHeight: 44,
        }}
        placeholderTextColor={colors.secondary}
      />
      {query.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Limpiar búsqueda"
          onPress={() => setQuery('')}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: colors.accent }}>Limpiar búsqueda</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Orden: ${sortLabel}`}
        accessibilityValue={{ text: sortLabel }}
        accessibilityHint="Abre los seis criterios de ordenamiento y Cancelar"
        onPress={showSortMenu}
        style={[
          styles.sortControl,
          { borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      >
        <Text style={{ color: colors.text }}>Orden: {sortLabel}</Text>
      </Pressable>
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
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            Biblioteca
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
        <View style={styles.sections}>
          {(
            [
              ['downloads', 'Archivos'],
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
          <View style={styles.importTools}>
            <Text style={{ color: colors.secondary }}>
              {formatSize(used)} utilizados
            </Text>
            <Pressable
              ref={importButton}
              accessibilityRole="button"
              accessibilityLabel="Importar archivo"
              accessibilityState={{ disabled: importBusy, busy: importBusy }}
              disabled={importBusy}
              onPress={() => {
                void startLocalImport();
              }}
              style={[
                styles.importButton,
                { borderColor: colors.border, opacity: importBusy ? 0.55 : 1 },
              ]}
            >
              <Text style={{ color: colors.accent, flexShrink: 1 }}>
                Importar archivo
              </Text>
            </Pressable>
          </View>
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
      {importMessage !== '' && (
        <View style={styles.importStatus}>
          <View
            ref={importStatus}
            accessible
            accessibilityLabel={importMessage}
            accessibilityRole={
              importState.phase === 'error' ? 'alert' : undefined
            }
          >
            <Text
              style={{
                color:
                  importState.phase === 'error'
                    ? colors.error
                    : colors.secondary,
              }}
            >
              {importMessage}
            </Text>
          </View>
          {importCanCancel && (
            <ActionButton
              label="Cancelar importación"
              secondary
              onPress={() => {
                void cancelLocalImport();
              }}
            />
          )}
          {importState.canRetry && (
            <ActionButton
              label="Reintentar importación"
              secondary
              onPress={() => {
                void retryLocalImport();
              }}
            />
          )}
          {importState.phase === 'completed' && (
            <Text style={{ color: colors.secondary }}>
              Conserva el original. Puedes guardar otra copia con Guardar en
              Archivos.
            </Text>
          )}
        </View>
      )}
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
      {actionError && (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {actionError}
        </Text>
      )}
      {readError && (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {readError}
          </Text>
          <ActionButton
            label={
              section === 'downloads'
                ? 'Reintentar cargar Biblioteca'
                : 'Reintentar cargar colecciones'
            }
            onPress={() => refreshRef.current?.()}
            disabled={loading}
            secondary
          />
        </View>
      )}
      {loading && (
        <ActivityIndicator accessibilityLabel="Cargando Biblioteca" />
      )}
      {section === 'downloads' ? (
        <FlatList
          key={`downloads-${viewMode}-${columns}`}
          testID="library-downloads"
          numColumns={columns}
          columnWrapperStyle={
            columns > 1 ? { gap: 12, alignItems: 'flex-start' } : undefined
          }
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
          ListHeaderComponent={queryControls}
          data={visible}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            loading || readError ? null : (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.secondary }}>
                  {items.length === 0
                    ? 'Tu Biblioteca está vacía.'
                    : normalizeLibraryQuery(query)
                      ? 'No hay coincidencias con esta búsqueda y los filtros actuales.'
                      : 'No hay archivos de este tipo.'}
                </Text>
                {items.length > 0 && (query.length > 0 || filter !== 'all') && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Limpiar búsqueda y filtros"
                    onPress={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                    style={{ minHeight: 44, justifyContent: 'center' }}
                  >
                    <Text style={{ color: colors.accent }}>
                      Limpiar búsqueda y filtros
                    </Text>
                  </Pressable>
                )}
              </View>
            )
          }
          renderItem={({ item }) => (
            <View
              testID={`library-card-${item.id}`}
              style={
                viewMode === 'grid'
                  ? { width: cardWidth ?? '100%', marginBottom: 12 }
                  : undefined
              }
            >
              <LibraryItemRow
                layout={viewMode}
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
            </View>
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
                {!loading && !readError && `${itemCount(uncollectedCount)} · `}
                Vista automática
              </Text>
            </Pressable>
          }
          ListEmptyComponent={
            loading || readError ? null : (
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
  importTools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  importButton: {
    minHeight: 44,
    minWidth: 44,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
  },
  importStatus: { paddingHorizontal: 22, paddingVertical: 8, gap: 8 },
  header: { paddingHorizontal: 22, paddingTop: 18, gap: 8 },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    maxWidth: '100%',
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 25, fontWeight: '700', flexShrink: 1, maxWidth: '100%' },
  settings: {
    minWidth: 48,
    minHeight: 48,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sections: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 4 },
  section: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: 2,
  },
  sortControl: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 10,
  },
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
