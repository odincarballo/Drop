import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '@/providers/PlaybackProvider';
import { useTheme } from '@/theme';

export function MiniPlayer() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { state, item, loadingItem, togglePlayPause } = usePlayback();
  const commandInFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  if (
    /^\/player(?:\/|$)/.test(pathname) ||
    !state?.libraryId ||
    state.status === 'idle' ||
    state.status === 'failed' ||
    !state.playable ||
    state.fullscreen ||
    state.pipPresentation === 'fullscreen' ||
    loadingItem ||
    item?.id !== state.libraryId
  )
    return null;

  const playing = state.status === 'playing';
  const libraryId = state.libraryId;

  async function toggle() {
    if (commandInFlight.current) return;
    commandInFlight.current = true;
    setBusy(true);
    try {
      await togglePlayPause();
    } catch {
      // Native playback state remains authoritative; no speculative UI change.
    } finally {
      commandInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <View
      testID="mini-player"
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir reproductor de ${item.title}`}
        onPress={() => router.push(`/player/${libraryId}` as Href)}
        style={styles.openButton}
      >
        <Image
          accessibilityLabel={
            item.artworkUri ? 'Portada descargada' : 'Portada de Drop'
          }
          source={
            item.artworkUri
              ? { uri: item.artworkUri }
              : require('../../assets/icon.png')
          }
          resizeMode="contain"
          style={[styles.artwork, { backgroundColor: colors.background }]}
        />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.title, { color: colors.text }]}
        >
          {item.title}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pausar' : 'Reproducir'}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void toggle()}
        style={styles.transportButton}
      >
        <SymbolView
          name={playing ? 'pause.fill' : 'play.fill'}
          type="monochrome"
          size={23}
          tintColor={colors.accent}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  openButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: 6,
    marginRight: 12,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  transportButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
