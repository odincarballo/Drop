import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ActionButton';
import { BackendAccessCard } from '@/components/BackendAccessCard';
import { DownloadOptions } from '@/components/DownloadOptions';
import { DownloadStatusCard } from '@/components/DownloadStatusCard';
import { MetadataCard } from '@/components/MetadataCard';
import { LocalYoutubeSpikeCard } from '@/components/LocalYoutubeSpikeCard';
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
  const { colors } = useTheme();
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
  } = useMediaAnalysis();
  const download = useMediaDownload();
  const spike = useLocalYoutubeSpike();
  const localYoutube = hasLocalYoutubeEngine() && isYoutubeUrl(url);
  const isBusy = isAnalyzing || download.isActive || spike.isBusy;

  function changeUrl(value: string) {
    download.reset();
    updateUrl(value);
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
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
            >
              MediaDrop
            </Text>
            <Text style={[styles.subtitle, { color: colors.secondary }]}>
              Descarga tus archivos multimedia
            </Text>
          </View>
          <BackendAccessCard />
          <View style={styles.composer}>
            <Text style={[styles.label, { color: colors.text }]}>
              Enlace del recurso
            </Text>
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
                  : localYoutube
                    ? 'Analizar en este iPhone'
                    : 'Analizar'
              }
              disabled={isBusy}
              loading={state.status === 'loading'}
              onPress={() => void runAnalysis()}
            />
            <Text style={[styles.notice, { color: colors.secondary }]}>
              Utiliza únicamente recursos autorizados.
            </Text>
          </View>
          {hasLocalYoutubeEngine() && (
            <LocalYoutubeSpikeCard
              spike={spike}
              disabled={isBusy}
              onAnalyze={() => {
                if (!isBusy) void spike.analyze(url);
              }}
            />
          )}
          <MetadataCard state={state} />
          {state.status === 'success' &&
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
          <DownloadStatusCard
            state={download.state}
            onCancel={() => void download.cancel()}
            onShare={() => void download.share()}
            onReset={download.reset}
          />
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
    paddingTop: 26,
    paddingBottom: 18,
    gap: 28,
  },
  header: { gap: 8 },
  title: { fontSize: 36, fontWeight: '700', letterSpacing: -1.2 },
  subtitle: { fontSize: 16, lineHeight: 23 },
  composer: { gap: 14 },
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
});
