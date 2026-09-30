import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { ChoiceChip } from '@/components/ChoiceChip';
import { CompletedFileActions } from '@/components/CompletedFileActions';
import { Thumbnail } from '@/components/Thumbnail';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import { localYoutubeError } from '@/services/onDeviceYoutube';
import { useTheme } from '@/theme';
import { formatDuration, formatSize } from '@/utils/format';
import {
  isAudioWithinLimit,
  isDirectAudio,
  localVideoQualityChoices,
} from '@/utils/onDeviceYoutubeFormats';

type Mode = 'VIDEO_AUDIO' | 'VIDEO_ONLY' | 'AUDIO_ONLY';
type Spike = ReturnType<typeof useLocalYoutubeSpike>;
const modes: { value: Mode; label: string }[] = [
  { value: 'VIDEO_AUDIO', label: 'Video + audio' },
  { value: 'VIDEO_ONLY', label: 'Solo video' },
  { value: 'AUDIO_ONLY', label: 'Solo audio' },
];

function transferProgress(
  bytes: number,
  total: number | null,
  progress: number | null,
) {
  const amount = `${formatSize(bytes)}${total === null ? '' : ` / ${formatSize(total)}`}`;
  return progress === null
    ? amount
    : `${amount} · ${Math.round(progress * 100)} %`;
}

function retryFeedback(category: 'connection' | 'timeout' | 'server' | null) {
  if (category === 'server') return 'El servidor no respondió. Reintentando…';
  if (category === 'timeout')
    return 'La descarga dejó de recibir datos. Reintentando…';
  return 'Problema de conexión. Reintentando…';
}

function downloadFeedback(spike: Spike, mode: Mode) {
  if (mode === 'VIDEO_AUDIO') {
    const state = spike.combinedState;
    if (state.status === 'preparing') return 'Preparando…';
    if (state.status === 'downloading-video')
      return state.retrying
        ? retryFeedback(state.retryCategory)
        : `Descargando video… ${transferProgress(state.bytesDownloaded, state.totalBytes, state.progress)}`;
    if (state.status === 'downloading-audio')
      return state.retrying
        ? retryFeedback(state.retryCategory)
        : `Descargando audio… ${transferProgress(state.bytesDownloaded, state.totalBytes, state.progress)}`;
    if (state.status === 'muxing')
      return `Combinando…${state.progress === null ? '' : ` ${Math.round(state.progress * 100)} %`}`;
    if (state.status === 'error') return state.message;
    if (state.status === 'cancelled') return 'Descarga cancelada.';
  } else {
    const state = mode === 'VIDEO_ONLY' ? spike.videoState : spike.audioState;
    if (state.status === 'preparing') return 'Preparando…';
    if (state.status === 'downloading')
      return state.retrying
        ? retryFeedback(state.retryCategory)
        : `Descargando ${mode === 'VIDEO_ONLY' ? 'video' : 'audio'}… ${transferProgress(state.bytesDownloaded, state.totalBytes, state.progress)}`;
    if (state.status === 'error') return state.message;
    if (state.status === 'cancelled') return 'Descarga cancelada.';
  }
  return null;
}

export function LocalYoutubeMainCard({
  spike,
  disabled,
  onNewDownload,
}: {
  spike: Spike;
  disabled: boolean;
  onNewDownload: () => void;
}) {
  const { colors } = useTheme();
  const [requestedMode, setRequestedMode] = useState<Mode | null>(null);
  const result = spike.state.status === 'result' ? spike.state.result : null;
  const metadata = result?.metadata;
  const qualities = metadata
    ? localVideoQualityChoices(metadata.videoFormats)
    : [];
  const selectedVideo = spike.videoOptions.find(
    (format) => format.id === spike.selectedVideoFormatId,
  );
  const selectedAudio = metadata?.audioFormats.find(
    (format) =>
      format.id === metadata.preferredAudioFormatId &&
      isDirectAudio(format) &&
      isAudioWithinLimit(format),
  );
  const audioOverLimit = metadata?.audioFormats.some(
    (format) => isDirectAudio(format) && !isAudioWithinLimit(format),
  );
  const hasVideo = Boolean(selectedVideo);
  const hasAudio = Boolean(selectedAudio);
  const modeAvailable = {
    VIDEO_AUDIO: hasVideo && hasAudio && Boolean(metadata?.duration),
    VIDEO_ONLY: hasVideo,
    AUDIO_ONLY: hasAudio && Boolean(metadata?.duration),
  };
  const mode: Mode =
    requestedMode && modeAvailable[requestedMode]
      ? requestedMode
      : modeAvailable.VIDEO_AUDIO
        ? 'VIDEO_AUDIO'
        : modeAvailable.VIDEO_ONLY
          ? 'VIDEO_ONLY'
          : 'AUDIO_ONLY';
  const estimatedSize =
    mode === 'AUDIO_ONLY'
      ? (selectedAudio?.estimatedSize ?? null)
      : mode === 'VIDEO_ONLY'
        ? (selectedVideo?.estimatedSize ?? null)
        : selectedVideo?.estimatedSize != null &&
            selectedAudio?.estimatedSize != null
          ? selectedVideo.estimatedSize + selectedAudio.estimatedSize
          : null;
  const activeState =
    mode === 'VIDEO_AUDIO'
      ? spike.combinedState
      : mode === 'VIDEO_ONLY'
        ? spike.videoState
        : spike.audioState;
  const isDownloading = [
    'preparing',
    'downloading',
    'downloading-video',
    'downloading-audio',
    'muxing',
  ].includes(activeState.status);
  const feedback = downloadFeedback(spike, mode);
  const actionError =
    activeState.status === 'completed' ? activeState.actionError : null;

  function startDownload() {
    if (!modeAvailable[mode]) return;
    if (mode === 'VIDEO_AUDIO') spike.downloadCombined();
    else if (mode === 'VIDEO_ONLY') spike.downloadVideo();
    else spike.downloadAudio();
  }

  function cancelDownload() {
    if (mode === 'VIDEO_AUDIO') spike.cancelCombined();
    else if (mode === 'VIDEO_ONLY') spike.cancelVideo();
    else spike.cancelAudio();
  }

  function shareDownload() {
    if (mode === 'VIDEO_AUDIO') void spike.shareCombined();
    else if (mode === 'VIDEO_ONLY') void spike.shareVideo();
    else void spike.shareAudio();
  }

  const completion = activeState.status === 'completed' ? activeState : null;
  const completionDetails = completion
    ? [
        formatSize(completion.fileSize),
        mode === 'AUDIO_ONLY' ? 'M4A' : 'MP4',
        'height' in completion && completion.height
          ? `${completion.height}p`
          : null,
        'durationSeconds' in completion &&
        Number.isFinite(completion.durationSeconds)
          ? formatDuration(completion.durationSeconds)
          : metadata?.duration
            ? formatDuration(metadata.duration)
            : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  if (spike.state.status === 'idle') return null;
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      {spike.state.status === 'loading' && (
        <>
          <Text style={{ color: colors.secondary }}>
            Analizando en este iPhone…
          </Text>
          <ActionButton
            label="Cancelar análisis"
            onPress={spike.cancel}
            secondary
          />
        </>
      )}
      {spike.state.status === 'error' && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {spike.state.message}
        </Text>
      )}
      {result?.error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {localYoutubeError(result.error.code)}
        </Text>
      )}
      {metadata && (
        <>
          {metadata.thumbnail && (
            <Thumbnail key={metadata.id} uri={metadata.thumbnail} />
          )}
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {metadata.title}
          </Text>
          {metadata.duration != null && (
            <Text style={{ color: colors.secondary }}>
              {formatDuration(metadata.duration)}
            </Text>
          )}
          {completion ? (
            <>
              <Text
                accessibilityRole="header"
                style={[styles.success, { color: colors.text }]}
              >
                ✓ Descarga completada
              </Text>
              <Text style={[styles.fileName, { color: colors.text }]}>
                {completion.fileName}
              </Text>
              {completionDetails && (
                <Text style={{ color: colors.secondary }}>
                  {completionDetails}
                </Text>
              )}
              {actionError && (
                <Text accessibilityRole="alert" style={{ color: colors.error }}>
                  {actionError}
                </Text>
              )}
              <CompletedFileActions
                key={completion.localUri}
                uri={completion.localUri}
                onMoreOptions={shareDownload}
                onNewDownload={onNewDownload}
              />
            </>
          ) : (
            <>
              {qualities.length > 0 && (
                <>
                  <Text style={[styles.heading, { color: colors.text }]}>
                    Calidad
                  </Text>
                  <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Calidad de video"
                    style={styles.chips}
                  >
                    {qualities.map(({ format, withinLimit }) => (
                      <ChoiceChip
                        key={format.id}
                        label={format.resolution ?? `${format.height}p`}
                        detail={
                          withinLimit
                            ? format.estimatedSize == null
                              ? undefined
                              : `~${formatSize(format.estimatedSize)}`
                            : 'Supera 50 MiB'
                        }
                        selected={format.id === spike.selectedVideoFormatId}
                        onPress={() => spike.selectVideoFormat(format.id)}
                        disabled={disabled || !withinLimit}
                      />
                    ))}
                  </View>
                </>
              )}
              <Text style={[styles.heading, { color: colors.text }]}>
                Modo de descarga
              </Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Modo de descarga"
                style={styles.chips}
              >
                {modes
                  .filter(({ value }) => modeAvailable[value])
                  .map(({ value, label }) => (
                    <ChoiceChip
                      key={value}
                      label={label}
                      selected={mode === value}
                      onPress={() => setRequestedMode(value)}
                      disabled={disabled}
                    />
                  ))}
              </View>
              {!hasAudio && (
                <Text style={{ color: colors.secondary }}>
                  {audioOverLimit
                    ? 'El audio supera el límite actual de 25 MiB.'
                    : 'No hay audio M4A/AAC directo compatible.'}
                </Text>
              )}
              {!hasVideo && qualities.some((choice) => !choice.withinLimit) && (
                <Text style={{ color: colors.secondary }}>
                  Esta calidad supera el límite actual de video de 50 MiB.
                </Text>
              )}
              {hasAudio && !metadata.duration && (
                <Text style={{ color: colors.secondary }}>
                  No se puede preparar audio sin una duración válida.
                </Text>
              )}
              <View style={styles.sizeRow}>
                <Text style={{ color: colors.secondary }}>
                  Tamaño aproximado
                </Text>
                <Text style={{ color: colors.text }}>
                  {estimatedSize == null
                    ? 'Tamaño no disponible'
                    : `~${formatSize(estimatedSize)}`}
                </Text>
              </View>
              <ActionButton
                label="Descargar"
                onPress={startDownload}
                disabled={disabled || !modeAvailable[mode]}
              />
              {feedback && (
                <Text
                  accessibilityRole={
                    activeState.status === 'error' ? 'alert' : undefined
                  }
                  style={{
                    color:
                      activeState.status === 'error'
                        ? colors.error
                        : colors.secondary,
                  }}
                >
                  {feedback}
                </Text>
              )}
              {isDownloading && (
                <ActionButton
                  label="Cancelar descarga"
                  onPress={cancelDownload}
                  secondary
                />
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, paddingTop: 20, gap: 12 },
  title: { fontSize: 21, lineHeight: 28, fontWeight: '600' },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '600', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sizeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  success: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  fileName: { fontSize: 15, fontWeight: '600' },
});
