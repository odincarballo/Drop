import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CollectionSummary } from '@/models/collections';
import {
  createCollection,
  listCollections,
  listItemCollectionIds,
  setItemCollections,
} from '@/services/collections';
import { useTheme } from '@/theme';
import { collectionErrorMessage } from '@/utils/collectionErrors';

type Props = {
  visible: boolean;
  itemId: string | null;
  onClose: () => void;
};

export function CollectionPicker({ visible, itemId, onClose }: Props) {
  const { colors } = useTheme();
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadedItemId, setLoadedItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const creatingRef = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    if (!visible || !itemId) return;
    void Promise.resolve()
      .then(() => {
        if (generation.current !== current) return null;
        setLoading(true);
        setLoadedItemId(null);
        setError(null);
        setCreating(false);
        setNewName('');
        return Promise.all([listCollections(), listItemCollectionIds(itemId)]);
      })
      .then((result) => {
        if (!result) return;
        const [available, membership] = result;
        if (generation.current !== current) return;
        setCollections(available);
        setSelected(new Set(membership));
        setLoadedItemId(itemId);
      })
      .catch(() => {
        if (generation.current === current)
          setError('No se pudieron cargar las colecciones.');
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [visible, itemId]);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreatingBusy(true);
    setError(null);
    const current = generation.current;
    try {
      const created = await createCollection(newName);
      const available = await listCollections();
      if (generation.current !== current) return;
      setCollections(available);
      setSelected((previous) => new Set([...previous, created.id]));
      setCreating(false);
      setNewName('');
    } catch (failure) {
      if (generation.current === current)
        setError(collectionErrorMessage(failure));
    } finally {
      creatingRef.current = false;
      if (generation.current === current) setCreatingBusy(false);
    }
  }

  async function save() {
    if (
      !itemId ||
      loadedItemId !== itemId ||
      savingRef.current ||
      loading ||
      creating ||
      creatingBusy
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const current = generation.current;
    try {
      await setItemCollections(itemId, [...selected]);
      if (generation.current === current) onClose();
    } catch (failure) {
      if (generation.current === current)
        setError(collectionErrorMessage(failure));
    } finally {
      savingRef.current = false;
      if (generation.current === current) setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!savingRef.current) onClose();
      }}
    >
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <View style={styles.header}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            Añadir a colección
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancelar selección de colecciones"
            disabled={saving}
            onPress={onClose}
            style={styles.action}
          >
            <Text style={{ color: colors.secondary }}>Cancelar</Text>
          </Pressable>
        </View>
        {loading || (itemId !== null && loadedItemId !== itemId && !error) ? (
          <ActivityIndicator accessibilityLabel="Cargando colecciones" />
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {collections.length === 0 && (
              <Text style={{ color: colors.secondary }}>
                No hay colecciones todavía.
              </Text>
            )}
            {collections.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="checkbox"
                accessibilityLabel={entry.name}
                accessibilityState={{ checked: selected.has(entry.id) }}
                disabled={saving || creatingBusy}
                onPress={() => toggle(entry.id)}
                style={[styles.choice, { borderBottomColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontSize: 17 }}>
                  {selected.has(entry.id) ? '☑' : '☐'} {entry.name}
                </Text>
              </Pressable>
            ))}
            {creating ? (
              <View style={styles.newCollection}>
                <TextInput
                  accessibilityLabel="Nombre de la nueva colección"
                  placeholder="Nombre de la colección"
                  placeholderTextColor={colors.secondary}
                  value={newName}
                  onChangeText={setNewName}
                  editable={!creatingBusy}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={creatingBusy}
                  onPress={() => void create()}
                  style={styles.action}
                >
                  <Text style={{ color: colors.text }}>Crear colección</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={creatingBusy}
                  onPress={() => {
                    setCreating(false);
                    setNewName('');
                  }}
                  style={styles.action}
                >
                  <Text style={{ color: colors.secondary }}>
                    Cancelar creación
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Nueva colección"
                disabled={saving}
                onPress={() => setCreating(true)}
                style={styles.action}
              >
                <Text style={{ color: colors.text }}>+ Nueva colección</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
        {error && (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: colors.error }]}
          >
            {error}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Guardar selección de colecciones"
          accessibilityState={{
            disabled:
              loadedItemId !== itemId ||
              loading ||
              saving ||
              creating ||
              creatingBusy,
          }}
          disabled={
            loadedItemId !== itemId ||
            loading ||
            saving ||
            creating ||
            creatingBusy ||
            (!!error && collections.length === 0)
          }
          onPress={() => void save()}
          style={[styles.done, { backgroundColor: colors.accent }]}
        >
          <Text style={{ color: colors.onAccent, fontWeight: '600' }}>
            {saving ? 'Guardando…' : 'Listo'}
          </Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 22, gap: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 23, fontWeight: '700', flex: 1 },
  list: { paddingBottom: 24 },
  choice: { minHeight: 48, justifyContent: 'center', borderBottomWidth: 1 },
  newCollection: { gap: 8, marginTop: 10 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  action: { minHeight: 44, justifyContent: 'center' },
  error: { paddingVertical: 4 },
  done: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
});
