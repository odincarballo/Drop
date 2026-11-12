import { Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import type { useDownloadRecovery } from '@/hooks/useDownloadRecovery';
import type { DownloadRecord } from '@/services/downloadRecovery';
import { useTheme } from '@/theme';
import { formatSize } from '@/utils/format';

function description(record: DownloadRecord) {
  if (record.status === 'cancelled') return null;
  if (record.source === 'youtube' && record.phase === 'saving') return null;
  if (record.source === 'youtube')
    return 'Puedes volver a analizar el video y elegir el formato antes de descargar desde cero.';
  if (record.errorCode === 'REMOTE_EXPIRED')
    return 'El servidor ya no conserva esta descarga.';
  if (
    record.status === 'interrupted' &&
    record.phase === 'creating' &&
    !record.remoteJobId
  )
    return 'La descarga se interrumpió antes de enviar la solicitud.';
  if (!record.remoteJobId)
    return 'No se pudo confirmar si el servidor creó la descarga.';
  if (record.status === 'remote-ready')
    return 'El servidor informa que el trabajo terminó.';
  if (record.status === 'failed')
    return 'El intento anterior terminó con un error.';
  return 'Puedes consultar el estado en el servidor.';
}

export function DownloadRecoveryCard({
  recovery,
  onRetry,
}: {
  recovery: ReturnType<typeof useDownloadRecovery>;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const { record, loaded, message, working, load, query, dismiss } = recovery;
  if (!record)
    return !loaded && message ? (
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {message}
        </Text>
        <ActionButton
          label="Volver a leer"
          onPress={() => void load()}
          disabled={working}
        />
      </View>
    ) : null;

  const cancelled = record.status === 'cancelled';
  const detail = description(record);
  return (
    <View style={{ gap: 8 }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontWeight: '600' }}
      >
        {cancelled ? 'Descarga cancelada' : 'Descarga interrumpida'}
      </Text>
      {detail && <Text style={{ color: colors.secondary }}>{detail}</Text>}
      {!cancelled && record.phase === 'saving' && (
        <Text style={{ color: colors.secondary }}>
          El último paso fue guardar el archivo. Revisa Biblioteca antes de
          descargarlo de nuevo.
        </Text>
      )}
      {!cancelled && record.bytes > 0 && (
        <Text style={{ color: colors.secondary }}>
          Progreso anterior · {formatSize(record.bytes)}
        </Text>
      )}
      {record.status === 'remote-ready' && record.phase !== 'saving' && (
        <Text style={{ color: colors.secondary }}>
          Desde aquí puedes consultar el resultado. Para obtener el archivo,
          inicia una descarga nueva.
        </Text>
      )}
      {message && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.secondary }}
        >
          {message}
        </Text>
      )}
      {!cancelled &&
        record.remoteJobId &&
        record.errorCode !== 'REMOTE_EXPIRED' && (
          <ActionButton
            label="Continuar consulta"
            onPress={() => void query()}
            disabled={working}
          />
        )}
      {!cancelled && record.phase !== 'saving' && (
        <ActionButton
          label="Reintentar desde cero"
          onPress={onRetry}
          disabled={working}
        />
      )}
      <ActionButton
        label="Descartar"
        onPress={() => void dismiss()}
        secondary
        disabled={working}
      />
    </View>
  );
}
