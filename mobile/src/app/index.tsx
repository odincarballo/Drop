import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ActionButton';
import { DownloadOptions } from '@/components/DownloadOptions';
import { DownloadStatusCard } from '@/components/DownloadStatusCard';
import { MetadataCard } from '@/components/MetadataCard';
import { LocalYoutubeDiagnosticsCard } from '@/components/LocalYoutubeDiagnosticsCard';
import { LocalYoutubeMainCard } from '@/components/LocalYoutubeMainCard';
import { config } from '@/config';
import { useMediaAnalysis } from '@/hooks/useMediaAnalysis';
import { useMediaDownload } from '@/hooks/useMediaDownload';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import {
  hasLocalYoutubeEngine,
  isYoutubeUrl,
} from '@/services/onDeviceYoutube';
import { useTheme } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const spike = useLocalYoutubeSpike();
  const {
    url,
    state,
    isBusy: isAnalyzing,
    isPasting,
    updateUrl,
    pasteUrl,
    analyze,
    resetAnalysis,
    select,
  } = useMediaAnalysis(() => {
    spike.reset();
    setShowTechnicalDetails(false);
  });
  const download = useMediaDownload();
  const localYoutube = isYoutubeUrl(url);
  const isBusy = isAnalyzing || download.isActive || spike.isBusy;

  function changeUrl(value: string) {
    download.reset();
    updateUrl(value);
  }

  function newDownload() {
    changeUrl('');
    setShowTechnicalDetails(false);
  }

  async function runAnalysis() {
    if (download.isActive || spike.isBusy) return;
    download.reset();
    if (localYoutube) {
      resetAnalysis();
      await spike.analyze(url);
    } else {
      await analyze();
    }
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={false}
        >
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: colors.text }]}
              >
                Drop
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ajustes"
                onPress={() => router.push('/settings' as Href)}
                style={styles.settingsButton}
              >
                <SymbolView
                  name="gearshape"
                  type="monochrome"
                  size={24}
                  tintColor={colors.text}
                />
              </Pressable>
            </View>
            <Text style={[styles.subtitle, { color: colors.secondary }]}>
              Descarga archivos multimedia
            </Text>
          </View>
          <View style={styles.composer}>
            <Text style={[styles.label, { color: colors.text }]}>Enlace</Text>
            <View style={styles.inputRow}>
              <TextInput
                accessibilityLabel="URL del recurso multimedia"
                accessibilityHint="Introduce una dirección completa HTTP o HTTPS"
                placeholder="https://example.com/video.mp4"
                placeholderTextColor={colors.secondary}
                selectionColor={colors.accent}
                value={url}
                onChangeText={changeUrl}
                editable={!isBusy}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                textContentType="URL"
                maxLength={config.maxUrlLength}
                onSubmitEditing={() => void runAnalysis()}
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              />
              <ActionButton
                label="Pegar"
                secondary
                disabled={isBusy}
                loading={isPasting}
                onPress={() => void pasteUrl()}
              />
            </View>
            {state.status === 'error' && (
              <View
                style={[
                  styles.error,
                  { backgroundColor: colors.errorBackground },
                ]}
              >
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={[styles.errorText, { color: colors.error }]}
                >
                  {state.message}
                </Text>
              </View>
            )}
            <ActionButton
              label={
                state.status === 'loading' || spike.state.status === 'loading'
                  ? 'Analizando…'
                  : 'Analizar'
              }
              disabled={isBusy}
              loading={state.status === 'loading'}
              onPress={() => void runAnalysis()}
            />
            <Text style={[styles.notice, { color: colors.secondary }]}>
              Utiliza únicamente contenido que tengas permiso para descargar.
            </Text>
          </View>
          {localYoutube && spike.state.status !== 'idle' && (
            <LocalYoutubeMainCard
              spike={spike}
              disabled={isBusy}
              onNewDownload={newDownload}
            />
          )}
          {localYoutube &&
            hasLocalYoutubeEngine() &&
            spike.state.status !== 'idle' && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    showTechnicalDetails
                      ? 'Ocultar detalles técnicos'
                      : 'Detalles técnicos'
                  }
                  onPress={() => setShowTechnicalDetails((value) => !value)}
                  style={styles.technicalToggle}
                >
                  <Text style={{ color: colors.secondary }}>
                    {showTechnicalDetails
                      ? 'Detalles técnicos ⌄'
                      : 'Detalles técnicos ›'}
                  </Text>
                </Pressable>
                {showTechnicalDetails && (
                  <LocalYoutubeDiagnosticsCard spike={spike} />
                )}
              </>
            )}
          {!localYoutube && state.status === 'success' && (
            <MetadataCard state={state} />
          )}
          {!localYoutube &&
            state.status === 'success' &&
            download.state.status !== 'completed' &&
            !download.isActive && (
              <DownloadOptions
                media={state.data}
                selection={state.selection}
                onSelect={select}
                disabled={download.isActive || spike.isBusy}
                onDownload={() =>
                  void download.start(state.data, state.selection)
                }
              />
            )}
          {!localYoutube && (
            <DownloadStatusCard
              state={download.state}
              onCancel={() => void download.cancel()}
              onShare={() => void download.share()}
              onReset={newDownload}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  page: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 30,
    gap: 22,
  },
  header: { gap: 3 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingsButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -1.2 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  composer: { gap: 12 },
  label: { fontSize: 15, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    flex: 1,
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
  },
  error: { padding: 14, borderRadius: 14 },
  errorText: { fontSize: 14, lineHeight: 21 },
  notice: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  technicalToggle: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
