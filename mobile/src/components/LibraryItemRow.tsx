import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isAvailableLibraryItem, type LibraryItem } from '@/models/library';
import { useTheme } from '@/theme';
import {
  useMetadataCompletion,
  MetadataCompletionStatus,
} from '@/hooks/useMetadataCompletion';
import { formatSize } from '@/utils/format';
import { isPlayableLibraryItem } from '@/utils/playbackContext';

type Props = {
  onCompleteMetadata?: (item: LibraryItem) => void;
  metadataBusy?: boolean;
  layout?: 'list' | 'grid';
  item: LibraryItem;
  busy: boolean;
  onOpen: (item: LibraryItem) => void;
  onSave: (item: LibraryItem) => void;
  onShare: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
  onCollections: (item: LibraryItem) => void;
  onQueueNext: (item: LibraryItem) => void;
  onQueueLast: (item: LibraryItem) => void;
  queueBusy: boolean;
  onRemoveFromCollection?: (item: LibraryItem) => void;
  collectionName?: string;
};

function CompactLibraryCard(props: Props & { progress: number }) {
  const { item, busy, queueBusy, progress } = props;
  const { colors } = useTheme();
  const available = isAvailableLibraryItem(item);
  const menuOpen = useRef(false);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [expanded, setExpanded] = useState(false);
  function showActions() {
    if (menuOpen.current || busy) return;
    menuOpen.current = true;
    setExpanded(true);
    const actions: {
      label: string;
      disabled: boolean;
      run: (item: LibraryItem) => void;
      requiresFile?: boolean;
      queueAction?: boolean;
    }[] = [
      ...(item.lifecycle === 'ready' && isPlayableLibraryItem(item)
        ? [
            {
              label: 'Reproducir a continuación',
              disabled: busy || queueBusy,
              run: props.onQueueNext,
              requiresFile: true,
              queueAction: true,
            },
            {
              label: 'Añadir al final de la cola',
              disabled: busy || queueBusy,
              run: props.onQueueLast,
              requiresFile: true,
              queueAction: true,
            },
          ]
        : []),
      {
        label: 'Guardar en Archivos',
        disabled: busy || !available,
        run: props.onSave,
        requiresFile: true,
      },
      {
        label: 'Compartir',
        disabled: busy || !available,
        run: props.onShare,
        requiresFile: true,
      },
      { label: 'Colecciones', disabled: busy, run: props.onCollections },
      ...(props.onRemoveFromCollection && props.collectionName
        ? [
            {
              label: `Quitar de «${props.collectionName}»`,
              disabled: busy,
              run: props.onRemoveFromCollection,
            },
          ]
        : []),
      ...(props.onCompleteMetadata
        ? [
            {
              label: 'Completar metadatos',
              disabled: busy || !!props.metadataBusy,
              run: props.onCompleteMetadata,
              requiresFile: true,
            },
          ]
        : []),
      { label: 'Eliminar', disabled: busy, run: props.onDelete },
    ];
    let handled = false;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: item.title,
        options: ['Cancelar', ...actions.map((action) => action.label)],
        cancelButtonIndex: 0,
        destructiveButtonIndex: actions.length,
        disabledButtonIndices: actions.flatMap((action, index) =>
          action.disabled ? [index + 1] : [],
        ),
      },
      (index) => {
        if (handled) return;
        handled = true;
        menuOpen.current = false;
        if (!mounted.current) return;
        setExpanded(false);
        const current = latest.current;
        const action = actions[index - 1];
        if (
          !action ||
          action.disabled ||
          current.busy ||
          current.item.id !== item.id
        )
          return;
        if (action.requiresFile && !isAvailableLibraryItem(current.item))
          return;
        if (
          action.queueAction &&
          (current.queueBusy || !isPlayableLibraryItem(current.item))
        )
          return;
        action.run(current.item);
      },
    );
  }
  return (
    <View style={[styles.gridCard, { borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          available
            ? `Reproducir ${item.title}`
            : `${item.title}, archivo no disponible`
        }
        disabled={!available || busy}
        accessibilityState={{ disabled: !available || busy }}
        onPress={() => props.onOpen(item)}
        style={styles.gridPlayable}
      >
        <View style={[styles.gridArtwork, { backgroundColor: colors.subtle }]}>
          <Image
            source={
              item.artworkUri
                ? { uri: item.artworkUri }
                : require('../../assets/icon.png')
            }
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel={
              item.artworkUri ? 'Portada del archivo' : 'Portada de Drop'
            }
          />
        </View>
        <Text
          numberOfLines={2}
          style={[styles.itemTitle, { color: colors.text }]}
        >
          {item.title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: colors.secondary, fontSize: 12 }}
        >
          {item.mediaType === 'video' ? 'Video' : 'Audio'}
          {item.resolution ? ` · ${item.resolution}` : ''} ·{' '}
          {formatSize(item.sizeBytes)}
        </Text>
        {!available && (
          <Text style={{ color: colors.secondary }}>Archivo no disponible</Text>
        )}
      </Pressable>
      {progress > 0 && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Progreso de ${item.title}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}
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
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Acciones de ${item.title}`}
        accessibilityHint="Abre las acciones del archivo"
        accessibilityState={{ disabled: busy, expanded }}
        disabled={busy}
        onPress={showActions}
        style={styles.gridMenu}
      >
        <Text style={{ color: colors.accent }}>Más ···</Text>
      </Pressable>
    </View>
  );
}

export function LibraryItemRow({
  layout = 'list',
  item,
  busy,
  onOpen,
  onSave,
  onShare,
  onDelete,
  onCollections,
  onQueueNext,
  onQueueLast,
  queueBusy,
  onRemoveFromCollection,
  collectionName,
}: Props) {
  const { colors } = useTheme();
  const metadata = useMetadataCompletion(item);
  const available = isAvailableLibraryItem(item);
  const progress = item.completedAt
    ? 100
    : item.durationSeconds
      ? Math.min(
          100,
          (100 * item.playbackPositionSeconds) / item.durationSeconds,
        )
      : 0;
  if (layout === 'grid') {
    return (
      <View>
        <CompactLibraryCard
          onCompleteMetadata={
            metadata.eligible
              ? () => {
                  void metadata.start();
                }
              : undefined
          }
          metadataBusy={metadata.active}
          {...{
            item,
            busy,
            onOpen,
            onSave,
            onShare,
            onDelete,
            onCollections,
            onQueueNext,
            onQueueLast,
            queueBusy,
            onRemoveFromCollection,
            collectionName,
            progress,
          }}
        />
        <MetadataCompletionStatus value={metadata} />
      </View>
    );
  }
  return (
    <View style={[styles.item, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          available
            ? `Reproducir ${item.title}`
            : `${item.title}, archivo no disponible`
        }
        accessibilityState={{ disabled: !available || busy }}
        disabled={!available || busy}
        onPress={() => onOpen(item)}
        style={styles.playableRow}
      >
        <View style={[styles.artwork, { backgroundColor: colors.subtle }]}>
          {item.artworkUri ? (
            <Image
              source={{ uri: item.artworkUri }}
              style={styles.image}
              accessibilityLabel="Portada del archivo"
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
          {!available && (
            <Text accessibilityRole="text" style={{ color: colors.secondary }}>
              Archivo no disponible. Se conservan sus datos; volverá a estar
              disponible si se recupera el archivo válido.
            </Text>
          )}
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
        {item.lifecycle === 'ready' && isPlayableLibraryItem(item) && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Reproducir a continuación: ${item.title}`}
              accessibilityState={{
                disabled: busy || queueBusy,
                busy: queueBusy,
              }}
              disabled={busy || queueBusy}
              onPress={() => onQueueNext(item)}
              style={styles.action}
            >
              <Text
                style={{
                  color: busy || queueBusy ? colors.secondary : colors.text,
                }}
              >
                Reproducir a continuación
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Añadir al final de la cola: ${item.title}`}
              accessibilityState={{
                disabled: busy || queueBusy,
                busy: queueBusy,
              }}
              disabled={busy || queueBusy}
              onPress={() => onQueueLast(item)}
              style={styles.action}
            >
              <Text
                style={{
                  color: busy || queueBusy ? colors.secondary : colors.text,
                }}
              >
                Añadir al final de la cola
              </Text>
            </Pressable>
          </>
        )}
        {metadata.eligible && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Completar metadatos de ${item.title}`}
            accessibilityState={{
              disabled: metadata.active,
              busy: metadata.active,
            }}
            disabled={metadata.active}
            onPress={() => {
              void metadata.start();
            }}
            style={styles.action}
          >
            <Text style={{ color: colors.text }}>Completar metadatos</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !available }}
          disabled={busy || !available}
          onPress={() => onSave(item)}
          style={styles.action}
        >
          <Text style={{ color: colors.text }}>Guardar en Archivos</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !available }}
          disabled={busy || !available}
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
      <MetadataCompletionStatus value={metadata} />
    </View>
  );
}

const styles = StyleSheet.create({
  gridCard: { padding: 8, borderWidth: 1, borderRadius: 12 },
  gridPlayable: { gap: 6, minHeight: 44 },
  gridArtwork: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
  },
  gridMenu: {
    minHeight: 44,
    minWidth: 44,
    alignSelf: 'flex-end',
    justifyContent: 'center',
    alignItems: 'center',
  },
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
