import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { SelectionOption } from '@/components/SelectionOption';
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

function downloadFeedback(spike: Spike, mode: Mode) {
  if (mode === 'VIDEO_AUDIO') {
    const state = spike.combinedState;
    if (state.status === 'preparing') return 'Preparando…';
    if (state.status === 'downloading-video')
      return `Descargando video… ${transferProgress(state.bytesDownloaded, state.totalBytes, state.progress)}`;
    if (state.status === 'downloading-audio')
      return `Descargando audio… ${transferProgress(state.bytesDownloaded, state.totalBytes, state.progress)}`;
    if (state.status === 'muxing')
      return `Combinando…${state.progress === null ? '' : ` ${Math.round(state.progress * 100)} %`}`;
    if (state.status === 'completed')
      return `✓ Video con audio completado · ${state.fileName} · ${formatSize(state.fileSize)}`;
    if (state.status === 'error') return state.message;
    if (state.status === 'cancelled') return 'Descarga cancelada.';
  } else {
    const state = mode === 'VIDEO_ONLY' ? spike.videoState : spike.audioState;
    if (state.status === 'preparing') return 'Preparando…';
    if (state.status === 'downloading')
      return `Descargando ${mode === 'VIDEO_ONLY' ? 'video' : 'audio'}… ${transferProgress(state.bytesDownloaded, state.totalBytes, state.progress)}`;
    if (state.status === 'completed')
      return `✓ ${mode === 'VIDEO_ONLY' ? 'Video' : 'Audio'} completado · ${state.fileName} · ${formatSize(state.fileSize)}`;
    if (state.status === 'error') return state.message;
    if (state.status === 'cancelled') return 'Descarga cancelada.';
  }
  return null;
}

export function LocalYoutubeMainCard({
  spike,
  disabled,
}: {
  spike: Spike;
  disabled: boolean;
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
  const mode =
    requestedMode ??
    (hasVideo && hasAudio && metadata?.duration
      ? 'VIDEO_AUDIO'
      : hasVideo
        ? 'VIDEO_ONLY'
        : 'AUDIO_ONLY');
  const modeAvailable = {
    VIDEO_AUDIO: hasVideo && hasAudio && Boolean(metadata?.duration),
    VIDEO_ONLY: hasVideo,
    AUDIO_ONLY: hasAudio,
  };
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

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
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
          <Thumbnail key={metadata.id} uri={metadata.thumbnail} />
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {metadata.title}
          </Text>
          <Text style={{ color: colors.secondary }}>
            {formatDuration(metadata.duration)} · YouTube · análisis en este
            iPhone
          </Text>
          <Text style={[styles.heading, { color: colors.text }]}>
            Calidad de video
          </Text>
          {qualities.length === 0 && (
            <Text style={{ color: colors.secondary }}>
              No hay video MP4/H.264 directo compatible en 360p o 720p.
            </Text>
          )}
          {qualities.map(({ format, withinLimit }) => (
            <SelectionOption
              key={format.id}
              label={format.resolution ?? `${format.height}p`}
              detail={
                withinLimit
                  ? `MP4 · H.264${format.estimatedSize === null ? ' · Tamaño no disponible' : ` · ~${formatSize(format.estimatedSize)}`}`
                  : 'Esta calidad supera el límite actual de video de 50 MiB.'
              }
              selected={format.id === spike.selectedVideoFormatId}
              onPress={() => spike.selectVideoFormat(format.id)}
              disabled={disabled || !withinLimit}
            />
          ))}
          <Text style={[styles.heading, { color: colors.text }]}>
            Modo de descarga
          </Text>
          {modes.map(({ value, label }) => (
            <SelectionOption
              key={value}
              label={label}
              selected={mode === value}
              onPress={() => setRequestedMode(value)}
              disabled={disabled || !modeAvailable[value]}
            />
          ))}
          {!hasAudio && (
            <Text style={{ color: colors.secondary }}>
              {audioOverLimit
                ? 'El audio supera el límite actual de 25 MiB.'
                : 'No hay audio M4A/AAC directo compatible.'}
            </Text>
          )}
          {!hasVideo && qualities.some((choice) => !choice.withinLimit) && (
            <Text style={{ color: colors.secondary }}>
              El video disponible supera el límite actual de 50 MiB.
            </Text>
          )}
          {mode === 'VIDEO_AUDIO' && !metadata.duration && (
            <Text style={{ color: colors.secondary }}>
              No se puede combinar sin una duración válida del video.
            </Text>
          )}
          <Text style={{ color: colors.secondary }}>
            {estimatedSize === null
              ? 'Tamaño no disponible'
              : `Tamaño estimado: ~${formatSize(estimatedSize)}`}
            {' · Límites por pista: video 50 MiB, audio 25 MiB'}
          </Text>
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
          {activeState.status === 'completed' && (
            <ActionButton label="Compartir" onPress={shareDownload} secondary />
          )}
          {actionError && (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {actionError}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 20, borderWidth: 1, gap: 12 },
  title: { fontSize: 21, lineHeight: 28, fontWeight: '600' },
  heading: { fontSize: 18, lineHeight: 25, fontWeight: '600', marginTop: 4 },
});
