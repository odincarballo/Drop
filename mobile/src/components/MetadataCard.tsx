import { StyleSheet, Text, View } from 'react-native';

import { Thumbnail } from '@/components/Thumbnail';
import type { AnalysisState } from '@/models/analysis';
import { useTheme } from '@/theme';
import { formatDuration, formatSize } from '@/utils/format';

export function MetadataCard({ state }: { state: AnalysisState }) {
  const { colors } = useTheme();
  const analysis = state.status === 'success' ? state.data : null;
  if (!analysis) return null;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <>
        {analysis.thumbnail && (
          <Thumbnail key={analysis.thumbnail} uri={analysis.thumbnail} />
        )}
        {analysis.title?.trim() && (
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {analysis.title.trim()}
          </Text>
        )}
        {(analysis.duration != null || analysis.estimatedSize != null) && (
          <Text style={[styles.body, { color: colors.secondary }]}>
            {[
              analysis.duration != null
                ? formatDuration(analysis.duration)
                : null,
              analysis.estimatedSize != null
                ? `~${formatSize(analysis.estimatedSize)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}
        {analysis.source?.trim() && (
          <Text style={[styles.body, { color: colors.secondary }]}>
            Fuente:{' '}
            {analysis.source === 'mock'
              ? 'Mock Provider'
              : analysis.source === 'direct'
                ? 'Archivo directo'
                : analysis.source === 'youtube'
                  ? 'YouTube'
                  : analysis.source.trim()}
          </Text>
        )}
      </>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingTop: 18, borderTopWidth: 1, gap: 10 },
  title: { fontSize: 21, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21 },
});
