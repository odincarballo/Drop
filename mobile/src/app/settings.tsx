import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackendAccessCard } from '@/components/BackendAccessCard';
import { ChoiceChip } from '@/components/ChoiceChip';
import { type ThemeMode, useTheme } from '@/theme';

const appearanceOptions: { label: string; mode: ThemeMode }[] = [
  { label: 'Sistema', mode: 'system' },
  { label: 'Claro', mode: 'light' },
  { label: 'Oscuro', mode: 'dark' },
];

export default function SettingsScreen() {
  const { colors, mode, setMode } = useTheme();
  const [error, setError] = useState<string | null>(null);

  async function chooseMode(next: ThemeMode) {
    try {
      await setMode(next);
      setError(null);
    } catch {
      setError('No se pudo guardar la apariencia elegida.');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.page}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a Inicio"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Text style={[styles.backText, { color: colors.text }]}>
            ‹ Inicio
          </Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Ajustes
        </Text>
        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.text }]}>
            Apariencia
          </Text>
          <View style={styles.options}>
            {appearanceOptions.map((option) => (
              <ChoiceChip
                key={option.mode}
                label={option.label}
                selected={mode === option.mode}
                onPress={() => void chooseMode(option.mode)}
              />
            ))}
          </View>
          {error && (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </Text>
          )}
        </View>
        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.text }]}>Acceso</Text>
          <BackendAccessCard />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 22, gap: 28, paddingBottom: 40 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  backText: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  section: { gap: 14 },
  heading: { fontSize: 17, fontWeight: '700' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
