import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollectionPicker } from '@/components/CollectionPicker';
import { LibraryItemRow } from '@/components/LibraryItemRow';
import { useLibraryItemActions } from '@/hooks/useLibraryItemActions';
import type { Collection } from '@/models/collections';
import type { LibraryItem } from '@/models/library';
import {
  getCollection,
  listCollectionItems,
  listUncollectedItems,
  observeCollections,
  removeItemFromCollection,
} from '@/services/collections';
import { useTheme } from '@/theme';
import { collectionErrorMessage } from '@/utils/collectionErrors';

type Props =
  { kind: 'collection'; collectionId: string } | { kind: 'uncollected' };

export function CollectionItemsView(props: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerItemId, setPickerItemId] = useState<string | null>(null);
  const actions = useLibraryItemActions(setError);
  const collectionId = props.kind === 'collection' ? props.collectionId : null;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let generation = 0;
      const refresh = () => {
        const current = ++generation;
        setLoading(true);
        const request = collectionId
          ? Promise.all([
              getCollection(collectionId),
              listCollectionItems(collectionId),
            ])
          : Promise.all([Promise.resolve(null), listUncollectedItems()]);
        void request
          .then(([found, listed]) => {
            if (!active || current !== generation) return;
            setCollection(found);
            setItems(found || !collectionId ? listed : []);
            setError(null);
          })
          .catch(() => {
            if (active && current === generation)
              setError('No se pudieron cargar las descargas.');
          })
          .finally(() => {
            if (active && current === generation) setLoading(false);
          });
      };
      refresh();
      const unsubscribe = observeCollections(refresh);
      return () => {
        active = false;
        generation += 1;
        unsubscribe();
      };
    }, [collectionId]),
  );

  function backToCollections() {
    router.replace('/library?section=collections' as Href);
  }

  function remove(item: LibraryItem) {
    if (!collectionId) return;
    void removeItemFromCollection(collectionId, item.id).catch((failure) =>
      setError(collectionErrorMessage(failure)),
    );
  }

  const missing = !!collectionId && !collection && !loading && !error;
  const title = collectionId
    ? (collection?.name ?? 'Colección')
    : 'Sin colección';
  const empty = collectionId
    ? 'Esta colección está vacía.'
    : 'No hay descargas sin colección.';

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a Colecciones"
          onPress={backToCollections}
          style={styles.back}
        >
          <Text style={{ color: colors.text }}>‹ Colecciones</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {title}
        </Text>
        {!collectionId && (
          <Text style={{ color: colors.secondary }}>
            Descargas que no están en ninguna colección.
          </Text>
        )}
      </View>
      {error && (
        <Text
          accessibilityRole="alert"
          style={[styles.message, { color: colors.error }]}
        >
          {error}
        </Text>
      )}
      {loading && <ActivityIndicator accessibilityLabel="Cargando descargas" />}
      {missing ? (
        <Text
          accessibilityRole="alert"
          style={[styles.message, { color: colors.secondary }]}
        >
          La colección ya no existe.
        </Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            loading || error ? null : (
              <Text style={{ color: colors.secondary }}>{empty}</Text>
            )
          }
          renderItem={({ item }) => (
            <LibraryItemRow
              item={item}
              busy={actions.busyId === item.id}
              onOpen={(selected) => actions.open(selected, items)}
              onSave={actions.save}
              onShare={actions.share}
              onDelete={actions.confirmDelete}
              onCollections={(selected) => setPickerItemId(selected.id)}
              collectionName={collection?.name}
              onRemoveFromCollection={collectionId ? remove : undefined}
            />
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
  back: { minHeight: 44, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  message: { paddingHorizontal: 22, paddingTop: 18 },
  list: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24 },
});
