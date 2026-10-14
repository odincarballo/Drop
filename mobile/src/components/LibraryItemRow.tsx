import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { LibraryItem } from '@/models/library';
import { useTheme } from '@/theme';
import { formatSize } from '@/utils/format';

type Props = {
  item: LibraryItem;
  busy: boolean;
  onOpen: (item: LibraryItem) => void;
  onSave: (item: LibraryItem) => void;
  onShare: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
  onCollections: (item: LibraryItem) => void;
  onRemoveFromCollection?: (item: LibraryItem) => void;
  collectionName?: string;
};

export function LibraryItemRow({
  item,
  busy,
  onOpen,
  onSave,
  onShare,
  onDelete,
  onCollections,
  onRemoveFromCollection,
  collectionName,
}: Props) {
  const { colors } = useTheme();
  const progress = item.completedAt
    ? 100
    : item.durationSeconds
      ? Math.min(
          100,
          (100 * item.playbackPositionSeconds) / item.durationSeconds,
        )
      : 0;
  return (
    <View style={[styles.item, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Reproducir ${item.title}`}
        onPress={() => onOpen(item)}
        style={styles.playableRow}
      >
        <View style={[styles.artwork, { backgroundColor: colors.subtle }]}>
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
                { backgroundColor: colors.accent, width: `${progress}%` },
              ]}
            />
          </View>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onSave(item)}
          style={styles.action}
        >
          <Text style={{ color: colors.text }}>Guardar en Archivos</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onShare(item)}
          style={styles.action}
        >
          <Text style={{ color: colors.text }}>Compartir</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Colecciones de ${item.title}`}
          disabled={busy}
          onPress={() => onCollections(item)}
          style={styles.action}
        >
          <Text style={{ color: colors.text }}>Colecciones</Text>
        </Pressable>
        {onRemoveFromCollection && collectionName && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Quitar ${item.title} de ${collectionName}`}
            disabled={busy}
            onPress={() => onRemoveFromCollection(item)}
            style={styles.action}
          >
            <Text style={{ color: colors.text }}>
              Quitar de «{collectionName}»
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onDelete(item)}
          style={styles.action}
        >
          <Text style={{ color: colors.error }}>Eliminar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: 16, borderBottomWidth: 1 },
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
  action: { minHeight: 44, justifyContent: 'center' },
});
