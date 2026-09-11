import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Thumbnail } from '@/components/Thumbnail';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import { localYoutubeError } from '@/services/onDeviceYoutube';
import { useTheme } from '@/theme';
import { formatDuration, formatSize } from '@/utils/format';

type Props = {
  spike: ReturnType<typeof useLocalYoutubeSpike>;
  onAnalyze: () => void;
  disabled: boolean;
};

export function LocalYoutubeSpikeCard({ spike, onAnalyze, disabled }: Props) {
  const { colors } = useTheme();
  const result = spike.state.status === 'result' ? spike.state.result : null;
  const metadata = result?.metadata;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        YouTube · prueba local
      </Text>
      <Text style={{ color: colors.secondary }}>
        Usa el enlace pegado arriba. Solo metadatos, sin Render ni descargas.
        Mantén MediaDrop abierta.
      </Text>
      <ActionButton
        label={
          spike.isBusy ? 'Analizando en el iPhone…' : 'Analizar en este iPhone'
        }
        onPress={onAnalyze}
        disabled={disabled}
        loading={spike.isBusy}
        secondary
      />
      {spike.isBusy && (
        <ActionButton
          label="Cancelar análisis local"
          onPress={spike.cancel}
          secondary
        />
      )}
      {spike.state.status === 'error' && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {spike.state.message}
        </Text>
      )}
      {result?.error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {localYoutubeError(result.error.code)}
          {`\nCódigo: ${result.error.code}`}
          {result.exceptionType ? ` · ${result.exceptionType}` : ''}
        </Text>
      )}
      {metadata && (
        <>
          <Thumbnail key={metadata.id} uri={metadata.thumbnail} />
          <Text style={[styles.title, { color: colors.text }]}>
            {metadata.title}
          </Text>
          <Text
            style={{ color: colors.secondary }}
          >{`ID: ${metadata.id} · ${formatDuration(metadata.duration)}\nFuente: YouTube · análisis local`}</Text>
          <Text style={{ color: colors.text }}>
            Resoluciones:{' '}
            {metadata.resolutions.map((height) => `${height}p`).join(' · ') ||
              'Desconocidas'}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Video ({metadata.videoFormats.length})
          </Text>
          {metadata.videoFormats.map((format, index) => (
            <Text
              key={`${format.id}-${index}`}
              style={{ color: colors.secondary }}
            >{`${format.resolution ?? 'Original'} · ${format.container} · ${format.codec ?? 'Codec desconocido'} · ${format.hasAudio ? 'con audio' : 'sin audio'} · ID ${format.id}`}</Text>
          ))}
          <Text style={[styles.title, { color: colors.text }]}>
            Audio ({metadata.audioFormats.length})
          </Text>
          {metadata.audioFormats.map((format, index) => (
            <Text
              key={`${format.id}-${index}`}
              style={{ color: colors.secondary }}
            >{`${format.container} · ${format.codec ?? 'Codec desconocido'}${format.bitrateKbps ? ` · ${Math.round(format.bitrateKbps)} kbps` : ''} · ID ${format.id}`}</Text>
          ))}
        </>
      )}
      {result && (
        <Text
          selectable
          style={[styles.diagnostics, { color: colors.secondary }]}
        >
          {[
            result.engine,
            `Ejecución: ${result.deviceRuntime ?? 'desconocida'}`,
            `${result.elapsedSeconds ?? '?'} s · ${result.networkRequests ?? 0} solicitudes locales · EJS: ${result.jsChallengeCalls ?? 0}`,
            `RAM del proceso al terminar: ${formatSize(result.residentBytes ?? null)}`,
            `Hosts: ${result.requestHosts?.join(', ') ?? 'ninguno'}`,
          ]
            .filter(Boolean)
            .join('\n')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 14 },
  title: { fontSize: 17, fontWeight: '600' },
  diagnostics: { fontSize: 12, lineHeight: 19 },
});
