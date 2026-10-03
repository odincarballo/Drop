import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { CompletedFileActions } from '@/components/CompletedFileActions';
import type { DownloadState } from '@/hooks/useMediaDownload';
import { useTheme } from '@/theme';
import { formatSize } from '@/utils/format';

type Props = {
  state: DownloadState;
  onCancel: () => void;
  onShare: () => void;
  onReset: () => void;
};

export function DownloadStatusCard({
  state,
  onCancel,
  onShare,
  onReset,
}: Props) {
  const { colors } = useTheme();
  if (state.status === 'idle') return null;

  if (state.status === 'completed') {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.success, { color: colors.success }]}
        >
          ✓ Descarga completada
        </Text>
        {state.job.fileName && (
          <Text style={[styles.fileName, { color: colors.text }]}>
            {state.job.fileName}
          </Text>
        )}
        <Text style={[styles.detail, { color: colors.secondary }]}>
          {formatSize(state.localSize)}
        </Text>
        {state.actionError && (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: colors.error }]}
          >
            {state.actionError}
          </Text>
        )}
        <CompletedFileActions
          key={state.localUri}
          uri={state.localUri}
          libraryId={state.libraryId}
          onMoreOptions={onShare}
          onNewDownload={onReset}
        />
      </View>
    );
  }

  if (state.status === 'error' || state.status === 'cancelled') {
    const message =
      state.status === 'error' ? state.message : 'La descarga fue cancelada.';
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.errorBackground,
            borderColor: colors.border,
          },
        ]}
      >
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {message}
        </Text>
      </View>
    );
  }

  const isCreating = state.status === 'creating';
  const isTransferring = state.status === 'transferring';
  const downloaded = isCreating
    ? 0
    : state.status === 'saving'
      ? state.job.bytesDownloaded
      : isTransferring
        ? state.bytesDownloaded
        : state.job.bytesDownloaded;
  const total = isCreating
    ? null
    : state.status === 'saving'
      ? state.job.totalBytes
      : isTransferring
        ? state.totalBytes
        : state.job.totalBytes;
  const progress =
    state.status === 'downloading'
      ? state.job.progress
      : isCreating || total === null || total <= 0
        ? null
        : Math.min(downloaded / total, 1);
  const percentage = progress === null ? null : Math.round(progress * 100);
  const backendHeading =
    state.status === 'downloading'
      ? (state.job.message ??
        (state.job.status === 'PROCESSING'
          ? 'Procesando…'
          : state.job.status === 'PREPARING'
            ? 'Preparando descarga…'
            : 'Descargando…'))
      : null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.text }]}
      >
        {isCreating
          ? 'Preparando descarga…'
          : state.status === 'saving'
            ? 'Guardando en Biblioteca…'
            : isTransferring
              ? 'Guardando en el iPhone…'
              : (backendHeading ?? 'Descargando…')}
      </Text>
      {percentage !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.percentage, { color: colors.text }]}
        >
          {percentage} %
        </Text>
      )}
      <View style={[styles.track, { backgroundColor: colors.progressTrack }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: colors.accent,
              width: `${percentage ?? 0}%`,
            },
          ]}
        />
      </View>
      {!isCreating && state.status !== 'downloading' ? (
        <Text style={[styles.detail, { color: colors.secondary }]}>
          {formatSize(downloaded)}
          {total !== null ? ` / ${formatSize(total)}` : ''}
        </Text>
      ) : state.status === 'downloading' &&
        state.job.status === 'DOWNLOADING' ? (
        <Text style={[styles.detail, { color: colors.secondary }]}>
          {formatSize(downloaded)}
          {total !== null ? ` / ${formatSize(total)}` : ''}
        </Text>
      ) : null}
      {state.status !== 'saving' && (
        <ActionButton label="Cancelar" secondary onPress={onCancel} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 12 },
  heading: { fontSize: 18, fontWeight: '600' },
  success: { fontSize: 18, fontWeight: '700' },
  fileName: { fontSize: 16, fontWeight: '600' },
  percentage: { fontSize: 28, fontWeight: '700' },
  detail: { fontSize: 14, lineHeight: 21 },
  error: { fontSize: 14, lineHeight: 21 },
  track: { height: 8, overflow: 'hidden', borderRadius: 4 },
  fill: { height: '100%', borderRadius: 4 },
});
