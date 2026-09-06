import { StyleSheet, Text, View } from 'react-native';

import { Thumbnail } from '@/components/Thumbnail';
import type { AnalysisState } from '@/models/analysis';
import { useTheme } from '@/theme';
import { formatDuration, formatSize } from '@/utils/format';

export function MetadataCard({ state }: { state: AnalysisState }) {
  const { colors } = useTheme();
  const analysis = state.status === 'success' ? state.data : null;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {analysis ? (
        <>
          <Thumbnail
            key={analysis.thumbnail ?? 'none'}
            uri={analysis.thumbnail}
          />
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {analysis.title?.trim() || 'Sin título'}
          </Text>
          <Text style={[styles.body, { color: colors.secondary }]}>
            {formatDuration(analysis.duration)}
            {analysis.estimatedSize !== null
              ? ` · ~${formatSize(analysis.estimatedSize)}`
              : ''}
          </Text>
          <Text style={[styles.body, { color: colors.secondary }]}>
            Fuente:{' '}
            {analysis.source === 'mock'
              ? 'Mock Provider'
              : analysis.source === 'direct'
                ? 'Archivo directo'
                : analysis.source?.trim() || 'Fuente desconocida'}
          </Text>
        </>
      ) : (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.body, { color: colors.secondary }]}
        >
          {state.status === 'loading'
            ? 'Analizando…'
            : 'El recurso y sus formatos aparecerán aquí.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 20, borderWidth: 1, gap: 12 },
  title: { fontSize: 21, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21 },
});
