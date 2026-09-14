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
  const ejsResult =
    spike.ejsState.status === 'result' ? spike.ejsState.result : null;
  const nativeDiagnostics = ejsResult?.diagnostics.native;
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
          spike.ejsState.status === 'loading'
            ? 'Probando EJS en el iPhone…'
            : 'Probar EJS en este iPhone'
        }
        onPress={() => void spike.testEjs()}
        disabled={disabled}
        loading={spike.ejsState.status === 'loading'}
        secondary
      />
      {spike.ejsState.status === 'error' && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {spike.ejsState.message}
        </Text>
      )}
      {spike.ejsState.status === 'result' &&
        (spike.ejsState.result.fixture ? (
          <View
            style={[styles.fixture, { borderColor: colors.border }]}
            accessibilityLabel="Resultado de la prueba EJS"
          >
            <Text style={[styles.title, { color: colors.text }]}>
              ✓ EJS real pasó
            </Text>
            <Text selectable style={{ color: colors.secondary }}>
              {[
                `Reto n: ${spike.ejsState.result.fixture.challengeInput} → ${spike.ejsState.result.fixture.actual}`,
                `Provider: ${spike.ejsState.result.fixture.provider} · EJS ${spike.ejsState.result.fixture.ejsVersion}`,
                `QuickJS: ${spike.ejsState.result.jsChallengeCalls} llamada(s) · ${spike.ejsState.result.elapsedSeconds} s`,
                `run_js total: ${spike.ejsState.result.nativeRunJsCalls} · programa EJS: ${formatSize(spike.ejsState.result.diagnostics.scriptLength ?? null)}`,
                `Salida: ${spike.ejsState.result.diagnostics.responseType ?? 'desconocida'} · ${formatSize(spike.ejsState.result.diagnostics.responseLength ?? null)} · parser: ${spike.ejsState.result.diagnostics.parserError ?? 'correcto'}`,
                `QuickJS terminó: ${spike.ejsState.result.diagnostics.quickJsCompletedNormally ? 'sí' : 'no'} · console.log: ${spike.ejsState.result.diagnostics.consoleLogCaptured ? 'correcto' : 'falló'}`,
                `Error QuickJS: ${nativeDiagnostics?.errorCode ?? 'ninguno'}${nativeDiagnostics?.exceptionName ? ` · ${nativeDiagnostics.exceptionName}` : ''}${nativeDiagnostics?.exceptionMessage ? `: ${nativeDiagnostics.exceptionMessage}` : ''}`,
                `Límites: memoria ${formatSize(nativeDiagnostics?.memoryLimitBytes ?? null)} · stack ${formatSize(nativeDiagnostics?.stackLimitBytes ?? null)} · timeout ${nativeDiagnostics?.timeoutSeconds ?? '?'} s · salida ${formatSize(nativeDiagnostics?.outputLimitBytes ?? null)}`,
                `Uso QuickJS: malloc ${formatSize(nativeDiagnostics?.quickJsMallocBytes ?? null)} · memoria ${formatSize(nativeDiagnostics?.quickJsMemoryUsedBytes ?? null)} · capturado ${formatSize(nativeDiagnostics?.capturedBytes ?? null)}`,
                `Subprocess: ${spike.ejsState.result.subprocessUsed ? 'sí' : 'no'} · intentos: ${spike.ejsState.result.processAttempts}`,
                `Filesystem JS: ${spike.ejsState.result.quickJsFilesystem ? 'sí' : 'no'} (${spike.ejsState.result.diagnostics.quickJsFilesystemAttempts}) · red JS: ${spike.ejsState.result.quickJsNetwork ? 'sí' : 'no'} (${spike.ejsState.result.diagnostics.quickJsNetworkAttempts})`,
                `RAM: ${formatSize(spike.ejsState.result.residentBytes ?? null)} · ${spike.ejsState.result.deviceRuntime ?? 'desconocido'}`,
                `Respuesta segura: ${spike.ejsState.result.diagnostics.responsePreview ?? 'no disponible'}`,
              ].join('\n')}
            </Text>
          </View>
        ) : (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            Prueba EJS fallida. Código: {spike.ejsState.result.error?.code}
            {spike.ejsState.result.exceptionType
              ? ` · ${spike.ejsState.result.exceptionType}`
              : ''}
            {`\nProvider: ${spike.ejsState.result.diagnostics.providerInvoked ? 'invocado' : 'no invocado'} · run_js: ${spike.ejsState.result.diagnostics.runJsInvoked ? 'invocado' : 'no invocado'} · llamadas EJS: ${spike.ejsState.result.jsChallengeCalls}`}
            {`\nQuickJS terminó: ${spike.ejsState.result.diagnostics.quickJsCompletedNormally ? 'sí' : 'no'} · programa: ${formatSize(spike.ejsState.result.diagnostics.scriptLength ?? null)} · respuesta: ${formatSize(spike.ejsState.result.diagnostics.responseLength ?? null)}`}
            {`\nError QuickJS: ${nativeDiagnostics?.errorCode ?? spike.ejsState.result.diagnostics.runtimeError ?? 'sin error'}${nativeDiagnostics?.exceptionName ? ` · ${nativeDiagnostics.exceptionName}` : ''}${nativeDiagnostics?.exceptionMessage ? `: ${nativeDiagnostics.exceptionMessage}` : ''}`}
            {`\nParser: ${spike.ejsState.result.diagnostics.parserError ?? 'sin respuesta para parsear'} · capturado: ${formatSize(nativeDiagnostics?.capturedBytes ?? null)} · console.log: ${nativeDiagnostics?.consoleCalls ?? 0}`}
            {`\nLímites: memoria ${formatSize(nativeDiagnostics?.memoryLimitBytes ?? null)} · stack ${formatSize(nativeDiagnostics?.stackLimitBytes ?? null)} · timeout ${nativeDiagnostics?.timeoutSeconds ?? '?'} s · salida ${formatSize(nativeDiagnostics?.outputLimitBytes ?? null)}`}
            {`\nQuickJS: malloc ${formatSize(nativeDiagnostics?.quickJsMallocBytes ?? null)} · memoria ${formatSize(nativeDiagnostics?.quickJsMemoryUsedBytes ?? null)} · interrumpido: ${nativeDiagnostics?.interrupted ? 'sí' : 'no'}`}
            {`\nTiempo: ${spike.ejsState.result.elapsedSeconds} s · RAM: ${formatSize(spike.ejsState.result.residentBytes ?? null)}`}
            {`\nFilesystem JS: ${spike.ejsState.result.diagnostics.quickJsFilesystemAttempts} · red JS: ${spike.ejsState.result.diagnostics.quickJsNetworkAttempts} · procesos: ${spike.ejsState.result.processAttempts}`}
            {nativeDiagnostics?.exceptionStack
              ? `\nStack JS: ${nativeDiagnostics.exceptionStack}`
              : ''}
            {`\nRespuesta segura: ${spike.ejsState.result.diagnostics.responsePreview ?? 'no disponible'}`}
          </Text>
        ))}
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
  fixture: { borderTopWidth: 1, paddingTop: 14, gap: 8 },
});
