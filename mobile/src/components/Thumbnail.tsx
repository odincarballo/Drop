import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function Thumbnail({ uri }: { uri: string | null }) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const unavailable = !uri || status === 'error';
  return (
    <View style={[styles.frame, { backgroundColor: colors.subtle }]}>
      {unavailable ? (
        <Text style={[styles.placeholder, { color: colors.secondary }]}>
          Miniatura no disponible
        </Text>
      ) : (
        <>
          <Image
            source={{ uri }}
            accessibilityLabel="Miniatura del recurso"
            accessible
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
          />
          {status === 'loading' && (
            <ActivityIndicator
              accessibilityLabel="Cargando miniatura"
              color={colors.accent}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { fontSize: 14, padding: 16, textAlign: 'center' },
});
