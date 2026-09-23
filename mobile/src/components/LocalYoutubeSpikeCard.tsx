import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Thumbnail } from '@/components/Thumbnail';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import type { LocalHttpTransferDiagnostics } from '@/models/onDeviceYoutube';
import { localYoutubeError } from '@/services/onDeviceYoutube';
import { useTheme } from '@/theme';
import { formatDuration, formatSize } from '@/utils/format';

type Props = {
  spike: ReturnType<typeof useLocalYoutubeSpike>;
  disabled: boolean;
};

function HttpDiagnostics({
  value,
  color,
}: {
  value: LocalHttpTransferDiagnostics | null;
  color: string;
}) {
  if (!value) return null;
  return (
    <Text selectable style={[styles.diagnostics, { color }]}>
      {[
        `Primer Range solicitado: ${value.requestedRange ?? 'no disponible'}`,
        `Primer Range efectivo: ${value.effectiveRange ?? 'ausente'}`,
        `Primer response: HTTP ${value.statusCode ?? 'desconocido'} · modo ${value.transferMode ?? 'sin determinar'}`,
        `Primer Content-Range: ${value.contentRange ?? 'ausente'}`,
        `Primer Content-Length: ${value.contentLength ?? 'ausente'} · Accept-Ranges: ${value.acceptRanges ?? 'ausente'}`,
        `Primer Content-Type: ${value.contentType ?? 'ausente'}`,
        `Redirects del primer request: ${value.redirectCount}${value.redirectHosts.length ? ` · ${value.redirectHosts.join(' · ')}` : ''}`,
        `Host final del primer request: ${value.finalHost ?? 'no disponible'}`,
        `Request: Accept-Encoding=${value.acceptEncoding ?? 'ausente'}`,
        `User-Agent=${value.userAgent ?? 'ausente'}`,
        `Accept=${value.accept ?? 'ausente'}`,
        `Referer=${value.refererOrigin ?? 'ausente'} · Origin=${value.origin ?? 'ausente'}`,
      ].join('\n')}
    </Text>
  );
}

export function LocalYoutubeSpikeCard({ spike, disabled }: Props) {
  const { colors } = useTheme();
  const result = spike.state.status === 'result' ? spike.state.result : null;
  const metadata = result?.metadata;
  const selectedAudio = metadata?.audioFormats.find(
    (format) => format.id === metadata.preferredAudioFormatId,
  );
  const selectedVideo = metadata?.videoFormats.find(
    (format) => format.id === spike.selectedVideoFormatId,
  );
  const audio = spike.audioState;
  const video = spike.videoState;
  const combined = spike.combinedState;
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
        Usa el enlace pegado arriba. El análisis y las descargas de prueba
        ocurren en este iPhone, sin Render. Mantén MediaDrop abierta.
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
      {spike.state.status === 'loading' && (
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
          <View style={[styles.audioSpike, { borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>
              Video + audio
            </Text>
            <Text style={{ color: colors.text }}>Resolución de prueba</Text>
            {spike.videoOptions.map((format) => {
              const selected = format.id === spike.selectedVideoFormatId;
              return (
                <ActionButton
                  key={format.id}
                  label={`${format.resolution ?? `${format.height}p`} · MP4 · AVC${selected ? ' · seleccionada' : ''}`}
                  onPress={() => spike.selectVideoFormat(format.id)}
                  disabled={disabled || selected}
                  secondary
                />
              );
            })}
            {!spike.videoOptions.some(
              (format) => Math.abs((format.height ?? 0) - 720) <= 16,
            ) && (
              <Text style={{ color: colors.secondary }}>
                720p no está disponible o supera el límite actual de 50 MiB.
              </Text>
            )}
            <Text style={{ color: colors.secondary }}>
              {selectedVideo
                ? `Video: ${selectedVideo.resolution ?? 'Original'} · MP4 · ${selectedVideo.codec ?? 'AVC'} · ID ${selectedVideo.id} · protocolo ${selectedVideo.protocol ?? 'no informado'}`
                : 'Video: no disponible'}
            </Text>
            <Text style={{ color: colors.secondary }}>
              {selectedAudio
                ? `Audio: M4A · ${selectedAudio.codec ?? 'AAC'} · ID ${selectedAudio.id}`
                : 'Audio: no disponible'}
            </Text>
            {combined.status === 'idle' && (
              <ActionButton
                label="Descargar video con audio en este iPhone"
                onPress={spike.downloadCombined}
                disabled={
                  disabled ||
                  !selectedVideo ||
                  !selectedAudio ||
                  !metadata.duration
                }
                secondary
              />
            )}
            {combined.status === 'preparing' && (
              <>
                <Text style={{ color: colors.text }}>Preparando pistas…</Text>
                <ActionButton
                  label="Cancelar video con audio"
                  onPress={spike.cancelCombined}
                  secondary
                />
              </>
            )}
            {(combined.status === 'downloading-video' ||
              combined.status === 'downloading-audio') && (
              <>
                <Text style={{ color: colors.text }}>
                  {combined.status === 'downloading-video'
                    ? 'Descargando video…'
                    : 'Descargando audio…'}{' '}
                  {combined.progress === null
                    ? ''
                    : `${Math.round(combined.progress * 100)} %`}
                </Text>
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={
                    combined.progress === null
                      ? undefined
                      : { min: 0, max: 100, now: combined.progress * 100 }
                  }
                  style={[
                    styles.progressTrack,
                    { backgroundColor: colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.accent,
                        width: `${Math.max(2, (combined.progress ?? 0) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={{ color: colors.secondary }}>
                  {`${formatSize(combined.bytesDownloaded)}${combined.totalBytes ? ` / ${formatSize(combined.totalBytes)}` : ''}`}
                </Text>
                <ActionButton
                  label="Cancelar video con audio"
                  onPress={spike.cancelCombined}
                  secondary
                />
              </>
            )}
            {combined.status === 'muxing' && (
              <>
                <Text style={{ color: colors.text }}>
                  {combined.progress === null
                    ? 'Combinando video y audio…'
                    : `Combinando video y audio… ${Math.round(combined.progress * 100)} %`}
                </Text>
                <ActionButton
                  label="Cancelar combinación"
                  onPress={spike.cancelCombined}
                  secondary
                />
              </>
            )}
            {combined.status === 'completed' && (
              <>
                <Text style={[styles.title, { color: colors.accent }]}>
                  ✓ Video con audio completado
                </Text>
                <Text style={{ color: colors.secondary }}>
                  {`${combined.fileName}\n${formatSize(combined.fileSize)} · MP4${combined.height ? ` · ${combined.height}p` : ''}\n${formatDuration(combined.durationSeconds)} · ${combined.videoCodec ?? 'H.264'} + ${combined.audioCodec ?? 'AAC'}`}
                </Text>
                <ActionButton
                  label="Compartir video"
                  onPress={() => void spike.shareCombined()}
                  secondary
                />
                <HttpDiagnostics
                  value={combined.videoHttpDiagnostics}
                  color={colors.secondary}
                />
                {combined.actionError && (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: colors.error }}
                  >
                    {combined.actionError}
                  </Text>
                )}
              </>
            )}
            {combined.status === 'cancelled' && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.secondary }}
              >
                Video con audio cancelado.
              </Text>
            )}
            {combined.status === 'error' && (
              <>
                <Text accessibilityRole="alert" style={{ color: colors.error }}>
                  {`${combined.message}\nCódigo: ${combined.code}`}
                </Text>
                <HttpDiagnostics
                  value={combined.videoHttpDiagnostics}
                  color={colors.secondary}
                />
              </>
            )}
          </View>
          <View style={[styles.audioSpike, { borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>
              Audio directo
            </Text>
            {selectedAudio ? (
              <Text style={{ color: colors.secondary }}>
                {`Seleccionado: M4A · ${selectedAudio.codec ?? 'AAC'}${selectedAudio.bitrateKbps ? ` · ${Math.round(selectedAudio.bitrateKbps)} kbps` : ''} · ID ${selectedAudio.id}`}
              </Text>
            ) : (
              <Text style={{ color: colors.secondary }}>
                No hay un audio M4A/AAC directo compatible para esta prueba.
              </Text>
            )}
            {audio.status === 'idle' && (
              <ActionButton
                label="Descargar audio en este iPhone"
                onPress={spike.downloadAudio}
                disabled={disabled || !selectedAudio}
                secondary
              />
            )}
            {audio.status === 'preparing' && (
              <>
                <Text style={{ color: colors.text }}>
                  Preparando enlace seguro…
                </Text>
                <ActionButton
                  label="Cancelar descarga de audio"
                  onPress={spike.cancelAudio}
                  secondary
                />
              </>
            )}
            {audio.status === 'downloading' && (
              <>
                <Text style={{ color: colors.text }}>
                  {audio.progress === null
                    ? 'Descargando…'
                    : `Descargando… ${Math.round(audio.progress * 100)} %`}
                </Text>
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={
                    audio.progress === null
                      ? undefined
                      : { min: 0, max: 100, now: audio.progress * 100 }
                  }
                  style={[
                    styles.progressTrack,
                    { backgroundColor: colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.accent,
                        width: `${Math.max(2, (audio.progress ?? 0) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={{ color: colors.secondary }}>
                  {`${formatSize(audio.bytesDownloaded)}${audio.totalBytes ? ` / ${formatSize(audio.totalBytes)}` : ''}`}
                </Text>
                <ActionButton
                  label="Cancelar descarga de audio"
                  onPress={spike.cancelAudio}
                  secondary
                />
              </>
            )}
            {audio.status === 'completed' && (
              <>
                <Text style={[styles.title, { color: colors.accent }]}>
                  ✓ Descarga completada
                </Text>
                <Text style={{ color: colors.secondary }}>
                  {`${audio.fileName}\n${formatSize(audio.fileSize)} · M4A${audio.codec ? ` · ${audio.codec}` : ''}`}
                </Text>
                <ActionButton
                  label="Compartir audio"
                  onPress={() => void spike.shareAudio()}
                  secondary
                />
                {audio.actionError && (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: colors.error }}
                  >
                    {audio.actionError}
                  </Text>
                )}
              </>
            )}
            {audio.status === 'cancelled' && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.secondary }}
              >
                Descarga cancelada.
              </Text>
            )}
            {audio.status === 'error' && (
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {`${audio.message}\nCódigo: ${audio.code}`}
              </Text>
            )}
          </View>
          <View style={[styles.audioSpike, { borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>
              Video directo
            </Text>
            {selectedVideo ? (
              <Text style={{ color: colors.secondary }}>
                {`Seleccionado: ${selectedVideo.resolution ?? 'Original'} · MP4 · ${selectedVideo.codec ?? 'Codec desconocido'} · ID ${selectedVideo.id}`}
              </Text>
            ) : (
              <Text style={{ color: colors.secondary }}>
                No hay un video-only MP4 directo compatible para esta prueba.
              </Text>
            )}
            <Text style={{ color: colors.secondary }}>
              Este archivo no contendrá audio.
            </Text>
            {video.status === 'idle' && (
              <ActionButton
                label="Descargar video sin audio en este iPhone"
                onPress={spike.downloadVideo}
                disabled={disabled || !selectedVideo}
                secondary
              />
            )}
            {video.status === 'preparing' && (
              <>
                <Text style={{ color: colors.text }}>
                  Preparando enlace seguro…
                </Text>
                <ActionButton
                  label="Cancelar descarga de video"
                  onPress={spike.cancelVideo}
                  secondary
                />
              </>
            )}
            {video.status === 'downloading' && (
              <>
                <Text style={{ color: colors.text }}>
                  {video.progress === null
                    ? 'Descargando video…'
                    : `Descargando video… ${Math.round(video.progress * 100)} %`}
                </Text>
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={
                    video.progress === null
                      ? undefined
                      : { min: 0, max: 100, now: video.progress * 100 }
                  }
                  style={[
                    styles.progressTrack,
                    { backgroundColor: colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.accent,
                        width: `${Math.max(2, (video.progress ?? 0) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={{ color: colors.secondary }}>
                  {`${formatSize(video.bytesDownloaded)}${video.totalBytes ? ` / ${formatSize(video.totalBytes)}` : ''}`}
                </Text>
                <ActionButton
                  label="Cancelar descarga de video"
                  onPress={spike.cancelVideo}
                  secondary
                />
              </>
            )}
            {video.status === 'completed' && (
              <>
                <Text style={[styles.title, { color: colors.accent }]}>
                  ✓ Descarga de video completada
                </Text>
                <Text style={{ color: colors.secondary }}>
                  {`${video.fileName}\n${formatSize(video.fileSize)} · MP4${video.height ? ` · ${video.height}p` : ''}${video.codec ? ` · ${video.codec}` : ''}`}
                </Text>
                <ActionButton
                  label="Compartir video"
                  onPress={() => void spike.shareVideo()}
                  secondary
                />
                <HttpDiagnostics
                  value={video.httpDiagnostics}
                  color={colors.secondary}
                />
                {video.actionError && (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: colors.error }}
                  >
                    {video.actionError}
                  </Text>
                )}
              </>
            )}
            {video.status === 'cancelled' && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.secondary }}
              >
                Descarga de video cancelada.
              </Text>
            )}
            {video.status === 'error' && (
              <>
                <Text accessibilityRole="alert" style={{ color: colors.error }}>
                  {`${video.message}\nCódigo: ${video.code}`}
                </Text>
                <HttpDiagnostics
                  value={video.httpDiagnostics}
                  color={colors.secondary}
                />
              </>
            )}
          </View>
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
  audioSpike: { borderTopWidth: 1, paddingTop: 14, gap: 12 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
});
