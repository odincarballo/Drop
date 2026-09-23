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
    `Primer Range efectivo: ${value.effectiveRange ?? 'ausente'}`,
    `Primer response: HTTP ${value.statusCode ?? 'desconocido'} · modo ${value.transferMode ?? 'sin determinar'}`,
    `Primer Content-Range: ${value.contentRange ?? 'ausente'}`,
    `Primer Content-Length: ${value.contentLength ?? 'ausente'} · Accept-Ranges: ${value.acceptRanges ?? 'ausente'}`,
    `Primer Content-Type: ${value.contentType ?? 'ausente'}`,
    `Redirects: ${value.redirectCount}${value.redirectHosts.length ? ` · ${value.redirectHosts.join(' · ')}` : ''}`,
    `Host final: ${value.finalHost ?? 'no disponible'}`,
    `Request: Accept-Encoding=${value.acceptEncoding ?? 'ausente'}`,
    `User-Agent=${value.userAgent ?? 'ausente'}`,
    `Accept=${value.accept ?? 'ausente'}`,
    `Referer=${value.refererOrigin ?? 'ausente'} · Origin=${value.origin ?? 'ausente'}`,
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
