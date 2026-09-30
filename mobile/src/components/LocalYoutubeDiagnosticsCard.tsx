import { StyleSheet, Text, View } from 'react-native';

import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import type { LocalHttpTransferDiagnostics } from '@/models/onDeviceYoutube';
import { useTheme } from '@/theme';
import { formatDuration, formatSize } from '@/utils/format';

type Spike = ReturnType<typeof useLocalYoutubeSpike>;

function httpLines(value: LocalHttpTransferDiagnostics | null): string[] {
  if (!value) return [];
  return [
    `Primer Range solicitado: ${value.requestedRange ?? 'no disponible'}`,
    `Primer response: HTTP ${value.statusCode ?? 'desconocido'}`,
    `Primer Content-Range: ${value.contentRange ?? 'ausente'}`,
    `Primer Content-Length: ${value.contentLength ?? 'ausente'}`,
    `Host final: ${value.finalHost ?? 'no disponible'}`,
    ...(value.failurePhase
      ? [
          `Fallo: ${value.failurePhase} · ${value.failureCategory ?? 'other'}`,
          `Código transporte: ${value.failureTransportCode ?? 'no disponible'}`,
          `Status fallo: ${value.failureStatusCode ?? 'no disponible'}`,
          `Range fallo: ${value.failureRequestedRange ?? 'no disponible'}`,
          `Índice: ${value.failureRangeIndex ?? 'no disponible'} · intento: ${value.failureRangeAttempt ?? 'no disponible'}`,
          `Offset verificado: ${value.failureBytesPersisted ?? 'no disponible'} · retries globales: ${value.retriesUsed ?? 'no disponible'}`,
          `Presupuesto restante: ${value.recoverySecondsRemaining ?? 'no disponible'} s`,
          `Host fallo: ${value.failureHost ?? 'no disponible'}`,
          `Content-Range validado: ${value.failureContentRange ?? 'no disponible'}`,
          `Content-Length validado: ${value.failureContentLength ?? 'no disponible'}`,
        ]
      : []),
  ];
}

export function LocalYoutubeDiagnosticsCard({ spike }: { spike: Spike }) {
  const { colors } = useTheme();
  const result = spike.state.status === 'result' ? spike.state.result : null;
  const metadata = result?.metadata;
  const selectedVideo = metadata?.videoFormats.find(
    (format) => format.id === spike.selectedVideoFormatId,
  );
  const selectedAudio = metadata?.audioFormats.find(
    (format) => format.id === metadata.preferredAudioFormatId,
  );
  const videoHttp =
    spike.videoState.status === 'completed' ||
    spike.videoState.status === 'error'
      ? spike.videoState.httpDiagnostics
      : null;
  const audioHttp =
    spike.audioState.status === 'error'
      ? spike.audioState.httpDiagnostics
      : null;
  const combinedHttp =
    spike.combinedState.status === 'completed' ||
    spike.combinedState.status === 'error'
      ? spike.combinedState.videoHttpDiagnostics
      : null;

  const lines = [
    metadata && `ID: ${metadata.id}`,
    metadata?.duration != null &&
      `Duración: ${formatDuration(metadata.duration)}`,
    metadata &&
      `Resoluciones: ${metadata.resolutions.map((height) => `${height}p`).join(' · ') || 'desconocidas'}`,
    metadata && `Video (${metadata.videoFormats.length}):`,
    ...(metadata?.videoFormats.map(
      (format) =>
        `${format.resolution ?? 'Original'} · ${format.container} · ${format.codec ?? 'codec desconocido'} · ${format.hasAudio ? 'con audio' : 'sin audio'} · ID ${format.id} · protocolo ${format.protocol ?? 'no informado'} · directo ${format.directDownload ? 'sí' : 'no'}`,
    ) ?? []),
    metadata && `Audio (${metadata.audioFormats.length}):`,
    ...(metadata?.audioFormats.map(
      (format) =>
        `${format.container} · ${format.codec ?? 'codec desconocido'}${format.bitrateKbps ? ` · ${Math.round(format.bitrateKbps)} kbps` : ''} · ID ${format.id} · protocolo ${format.protocol ?? 'no informado'} · directo ${format.directDownload ? 'sí' : 'no'}`,
    ) ?? []),
    selectedVideo &&
      `Video seleccionado: ID ${selectedVideo.id} · ${selectedVideo.resolution ?? 'Original'} · ${selectedVideo.codec ?? 'codec desconocido'} · protocolo ${selectedVideo.protocol ?? 'no informado'}`,
    selectedAudio &&
      `Audio seleccionado: ID ${selectedAudio.id} · ${selectedAudio.codec ?? 'codec desconocido'}`,
    result?.engine,
    result && `Ejecución: ${result.deviceRuntime ?? 'desconocida'}`,
    result &&
      `${result.elapsedSeconds ?? '?'} s · ${result.networkRequests ?? 0} solicitudes locales · EJS: ${result.jsChallengeCalls ?? 0}`,
    result &&
      `RAM del proceso al terminar: ${formatSize(result.residentBytes ?? null)}`,
    result && `Hosts: ${result.requestHosts?.join(', ') ?? 'ninguno'}`,
    spike.videoState.status !== 'idle' &&
      `Video directo: ${spike.videoState.status}${spike.videoState.status === 'error' ? ` · ${spike.videoState.code}` : ''}`,
    spike.combinedState.status !== 'idle' &&
      `Video + audio: ${spike.combinedState.status}${spike.combinedState.status === 'error' ? ` · ${spike.combinedState.code}` : ''}`,
    spike.audioState.status !== 'idle' &&
      `Audio directo: ${spike.audioState.status}${spike.audioState.status === 'error' ? ` · ${spike.audioState.code}` : ''}`,
    audioHttp?.failureStatusCode != null && 'HTTP audio fallido:',
    audioHttp?.failureStatusCode != null &&
      `Status HTTP: ${audioHttp.failureStatusCode}`,
    audioHttp?.failureRequestedRange &&
      `Range solicitado: ${audioHttp.failureRequestedRange}`,
    audioHttp?.failureRangeIndex != null &&
      `Petición de rango: ${audioHttp.failureRangeIndex}`,
    audioHttp?.failureBytesPersisted != null &&
      `Bytes acumulados antes del fallo: ${audioHttp.failureBytesPersisted}`,
    audioHttp?.failureHost && `Host: ${audioHttp.failureHost}`,
    audioHttp?.failureContentRange &&
      `Content-Range: ${audioHttp.failureContentRange}`,
    audioHttp?.failureContentLength &&
      `Content-Length: ${audioHttp.failureContentLength}`,
    audioHttp && 'HTTP audio:',
    ...httpLines(audioHttp),
    combinedHttp && 'HTTP video + audio:',
    ...httpLines(combinedHttp),
    videoHttp && 'HTTP video directo:',
    ...httpLines(videoHttp),
  ].filter(
    (line): line is string => typeof line === 'string' && line.length > 0,
  );

  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <Text selectable style={[styles.text, { color: colors.secondary }]}>
        {lines.join('\n')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  text: { fontSize: 12, lineHeight: 19 },
});
