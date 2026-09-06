import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { SelectionOption } from '@/components/SelectionOption';
import type {
  AudioOutputBitrate,
  AudioOutputFormat,
  DownloadType,
  MediaAnalysis,
} from '@/models/media';
import {
  availableDownloadTypes,
  estimatedSelectionSize,
  isSelectionComplete,
  type DownloadSelection,
  type SelectionEvent,
} from '@/models/selection';
import { useTheme } from '@/theme';
import { formatCodec, formatResolution, formatSize } from '@/utils/format';

const downloadTypes: { value: DownloadType; label: string }[] = [
  { value: 'VIDEO_AUDIO', label: 'Video + audio' },
  { value: 'VIDEO_ONLY', label: 'Solo video' },
  { value: 'AUDIO_ONLY', label: 'Solo audio' },
];
const audioOutputs: { value: AudioOutputFormat; label: string }[] = [
  { value: 'M4A', label: 'M4A' },
  { value: 'MP3', label: 'MP3' },
];
const mp3Bitrates: AudioOutputBitrate[] = [128000, 192000, 256000];

type Props = {
  media: MediaAnalysis;
  selection: DownloadSelection;
  onSelect: (event: SelectionEvent) => void;
  onDownload: () => void;
  disabled?: boolean;
};

export function DownloadOptions({
  media,
  selection,
  onSelect,
  onDownload,
  disabled,
}: Props) {
  const { colors } = useTheme();
  const ready = isSelectionComplete(selection, media);
  const availableTypes = availableDownloadTypes(media);
  const estimatedSize = estimatedSelectionSize(media, selection);
  const heading = [styles.heading, { color: colors.text }];
  const secondary = [styles.secondary, { color: colors.secondary }];

  return (
    <View style={styles.sections}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Tipo de descarga"
        style={styles.options}
      >
        <Text accessibilityRole="header" style={heading}>
          Tipo de descarga
        </Text>
        {downloadTypes
          .filter(({ value }) => availableTypes.includes(value))
          .map(({ value, label }) => (
            <SelectionOption
              key={value}
              label={label}
              selected={selection.type === value}
              onPress={() => onSelect({ kind: 'type', value })}
              disabled={disabled}
            />
          ))}
        {availableTypes.length === 0 && (
          <Text style={secondary}>No hay tipos de descarga disponibles.</Text>
        )}
      </View>
      {'videoIndex' in selection && (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Calidad de video"
          style={styles.options}
        >
          <Text accessibilityRole="header" style={heading}>
            Calidad de video
          </Text>
          {media.videoFormats.length === 0 && (
            <Text style={secondary}>No hay formatos de video disponibles.</Text>
          )}
          {media.videoFormats.map((format, index) => (
            <SelectionOption
              key={index}
              label={formatResolution(format.resolution)}
              detail={
                [
                  format.container?.toUpperCase(),
                  format.codec ? formatCodec(format.codec) : null,
                  format.fps ? `${Math.round(format.fps)} fps` : null,
                  format.estimatedSize === null
                    ? null
                    : `~${formatSize(format.estimatedSize)}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Detalles no disponibles'
              }
              selected={selection.videoIndex === index}
              onPress={() => onSelect({ kind: 'video', index })}
              disabled={disabled}
            />
          ))}
        </View>
      )}
      {selection.type === 'VIDEO_AUDIO' && media.source === 'youtube' && (
        <View style={styles.options}>
          <Text accessibilityRole="header" style={heading}>
            Audio
          </Text>
          <Text style={secondary}>Mejor pista compatible disponible</Text>
        </View>
      )}
      {selection.type === 'AUDIO_ONLY' && media.source === 'youtube' && (
        <>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Formato de audio de salida"
            style={styles.options}
          >
            <Text accessibilityRole="header" style={heading}>
              Formato
            </Text>
            {audioOutputs.map(({ value, label }) => (
              <SelectionOption
                key={value}
                label={label}
                selected={selection.audioOutputFormat === value}
                onPress={() => onSelect({ kind: 'audioOutput', value })}
                disabled={disabled}
              />
            ))}
            <Text style={secondary}>
              {selection.audioOutputFormat === 'M4A'
                ? 'Mejor calidad disponible; se conserva el stream cuando es compatible.'
                : 'MP3 requiere conversión y no mejora la calidad de la fuente.'}
            </Text>
          </View>
          {selection.audioOutputFormat === 'MP3' && (
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Bitrate de salida MP3"
              style={styles.options}
            >
              <Text accessibilityRole="header" style={heading}>
                Bitrate de salida
              </Text>
              {mp3Bitrates.map((value) => (
                <SelectionOption
                  key={value}
                  label={`${value / 1000} kbps`}
                  selected={selection.audioBitrate === value}
                  onPress={() => onSelect({ kind: 'audioBitrate', value })}
                  disabled={disabled}
                />
              ))}
            </View>
          )}
        </>
      )}
      {'audioIndex' in selection &&
        media.audioFormats.length > 0 &&
        media.source !== 'youtube' && (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Calidad de audio"
            style={styles.options}
          >
            <Text accessibilityRole="header" style={heading}>
              Calidad de audio
            </Text>
            {media.audioFormats.length === 0 && (
              <Text style={secondary}>
                No hay formatos de audio disponibles.
              </Text>
            )}
            {media.audioFormats.map((format, index) => (
              <SelectionOption
                key={index}
                label={[
                  formatCodec(format.codec),
                  format.bitrate == null
                    ? null
                    : `${format.bitrate / 1000} kbps`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                detail={
                  [
                    format.container?.toUpperCase(),
                    format.estimatedSize == null
                      ? null
                      : `~${formatSize(format.estimatedSize)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Detalles no disponibles'
                }
                selected={selection.audioIndex === index}
                onPress={() => onSelect({ kind: 'audio', index })}
                disabled={disabled}
              />
            ))}
          </View>
        )}
      {selection.type === 'VIDEO_ONLY' && (
        <Text style={secondary}>Este archivo no contendrá audio.</Text>
      )}
      <View style={styles.options}>
        {estimatedSize !== null && (
          <Text style={secondary}>
            Tamaño estimado: ~{formatSize(estimatedSize)}
          </Text>
        )}
        {!ready && (
          <Text style={secondary}>
            Selecciona las calidades necesarias para continuar.
          </Text>
        )}
        <ActionButton
          label="Descargar"
          disabled={!ready || disabled}
          onPress={onDownload}
        />
        <Text style={[styles.notice, { color: colors.secondary }]}>
          {media.source === 'direct'
            ? 'Archivo original · Sin conversión'
            : media.source === 'youtube'
              ? selection.type === 'VIDEO_AUDIO'
                ? 'Se combinarán los streams solo cuando sea necesario.'
                : selection.type === 'AUDIO_ONLY'
                  ? 'La calidad final no puede superar la fuente original.'
                  : 'Video original sin pista de audio.'
              : 'Los datos simulados no contienen un archivo real'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sections: { gap: 26 },
  options: { gap: 10 },
  heading: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  secondary: { fontSize: 14, lineHeight: 21 },
  notice: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
