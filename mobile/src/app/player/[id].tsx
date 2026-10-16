import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaybackTimeline } from '@/components/PlaybackTimeline';
import PlaybackVideoSurface from '@/components/PlaybackVideoSurface';
import type { LibraryItem } from '@/models/library';
import { getLibraryItem } from '@/services/library';
import { playback, type PlaybackState } from '@/services/playback';
import { useTheme } from '@/theme';

const rates = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

function clock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—:—';
  const total = Math.floor(Math.max(0, seconds));
  const minutes = Math.floor(total / 60);
  const remaining = String(total % 60).padStart(2, '0');
  if (total >= 3600)
    return `${Math.floor(total / 3600)}:${String(minutes % 60).padStart(2, '0')}:${remaining}`;
  return `${minutes}:${remaining}`;
}

function playable(item: LibraryItem): boolean {
  const extension = item.relativeMediaPath.split('.').at(-1)?.toLowerCase();
  return (
    (item.mediaType === 'video' && extension === 'mp4') ||
    (item.mediaType === 'audio' && extension === 'm4a')
  );
}

function message(code: string | null): string {
  switch (code) {
    case 'UNAVAILABLE':
      return 'Este archivo ya no está disponible en Biblioteca.';
    case 'UNSUPPORTED_FORMAT':
      return 'Este formato aún no se puede reproducir en Drop.';
    case 'INVALID_MEDIA':
      return 'El archivo no se puede reproducir.';
    case 'PROGRESS_SAVE_FAILED':
      return 'No se pudo guardar el progreso de reproducción.';
    case 'AUDIO_SESSION_FAILED':
      return 'No se pudo activar el audio del dispositivo.';
    default:
      return 'No se pudo cargar el archivo para reproducirlo.';
  }
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { colors } = useTheme();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [state, setState] = useState<PlaybackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const isScrubbing = useRef(false);
  const seekGeneration = useRef(0);
  const restoreAcknowledged = useRef(false);

  useEffect(() => {
    if (state?.pipPresentation !== 'restoringUI') {
      restoreAcknowledged.current = false;
      return;
    }
    if (item?.id !== id || restoreAcknowledged.current) return;
    // Effects run after the route's native video surface is committed.
    restoreAcknowledged.current = true;
    void playback.completePiPRestore(true).catch(() => undefined);
  }, [id, item?.id, state?.pipPresentation]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const unsubscribe = playback.subscribe((next) => {
        if (active && (next.libraryId === id || next.status === 'idle')) {
          setState((previous) =>
            isScrubbing.current && previous?.libraryId === next.libraryId
              ? { ...next, position: previous.position }
              : next,
          );
        }
      });
      const appSubscription = AppState.addEventListener('change', (next) => {
        if (next !== 'active') return;
        // Backgrounding does not blur this route or close the native player.
        // Adopt the native state when React becomes active again.
        void playback
          .getState()
          .then((latest) => {
            if (active && (latest.libraryId === id || latest.status === 'idle'))
              setState(latest);
          })
          .catch(() => undefined);
      });
      isScrubbing.current = false;
      setScrubPosition(null);
      setItem(null);
      setState(null);
      setError(null);
      void (async () => {
        try {
          const found = await getLibraryItem(id);
          if (!active) return;
          if (!found) {
            setError('Este archivo ya no está disponible en Biblioteca.');
            return;
          }
          setItem(found);
          if (!playable(found)) {
            setError(
              'Este formato aún no se puede reproducir en Drop. Puedes exportarlo desde Biblioteca.',
            );
            return;
          }
          const current = await playback.getState();
          if (
            current.libraryId !== id ||
            ['idle', 'failed'].includes(current.status)
          ) {
            await playback.open(id);
          }
          const latest = await playback.getState();
          if (active) setState(latest);
        } catch {
          if (active)
            setError('No se pudo cargar el archivo para reproducirlo.');
        }
      })();
      return () => {
        active = false;
        seekGeneration.current += 1;
        isScrubbing.current = false;
        unsubscribe();
        appSubscription.remove();
        // Ordered after an in-flight open. Leaving detaches this route and
        // flushes progress; the native session survives navigation.
        void playback.leavePlayerScreen(id).catch(() => undefined);
      };
    }, [id]),
  );

  async function command(operation: () => Promise<PlaybackState>) {
    try {
      const next = await operation();
      if (next.libraryId === id || next.status === 'idle') setState(next);
      setError(null);
    } catch {
      setError('No se pudo completar el control de reproducción.');
    }
  }

  async function finishScrubbing(seconds: number) {
    const generation = ++seekGeneration.current;
    isScrubbing.current = true;
    setScrubPosition(seconds);
    try {
      const next = await playback.seek(seconds);
      if (generation !== seekGeneration.current) return;
      if (next.libraryId === id) setState(next);
      setError(null);
    } catch {
      if (generation === seekGeneration.current)
        setError('No se pudo completar el control de reproducción.');
    } finally {
      if (generation === seekGeneration.current) {
        isScrubbing.current = false;
        setScrubPosition(null);
      }
    }
  }

  const failed =
    error ?? (state?.status === 'failed' ? message(state.errorCode) : null);
  const ready = state?.playable === true && !failed;
  const displayedPosition = scrubPosition ?? state?.position ?? 0;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a Biblioteca"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Text style={{ color: colors.text }}>‹ Biblioteca</Text>
        </Pressable>
        {item?.mediaType === 'video' &&
        playable(item) &&
        !['pipStarting', 'pip', 'pipStopping'].includes(
          state?.pipPresentation ?? '',
        ) ? (
          <View style={styles.videoBox}>
            <PlaybackVideoSurface style={styles.video} />
          </View>
        ) : item?.mediaType === 'video' &&
          ['pipStarting', 'pip', 'pipStopping'].includes(
            state?.pipPresentation ?? '',
          ) ? (
          <View style={[styles.videoBox, styles.pipPlaceholder]}>
            <Text style={{ color: colors.secondary }}>
              Video en Picture in Picture
            </Text>
          </View>
        ) : (
          <View style={[styles.artworkBox, { backgroundColor: colors.subtle }]}>
            <Image
              source={
                item?.artworkUri
                  ? { uri: item.artworkUri }
                  : require('../../../assets/icon.png')
              }
              accessibilityLabel={
                item?.artworkUri ? 'Portada descargada' : 'Portada de Drop'
              }
              style={styles.artwork}
            />
          </View>
        )}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {item?.title ?? 'Reproductor de Drop'}
        </Text>
        {!item && !failed ? (
          <Text style={{ color: colors.secondary }}>Cargando…</Text>
        ) : null}
        {failed ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {failed}
          </Text>
        ) : null}
        {state?.status === 'loading' ? (
          <Text style={{ color: colors.secondary }}>
            Preparando reproducción…
          </Text>
        ) : null}
        {state?.status === 'ended' ? (
          <Text style={{ color: colors.secondary }}>
            Terminado · Reproducir de nuevo
          </Text>
        ) : null}
        {ready ? (
          <>
            <PlaybackTimeline
              position={displayedPosition}
              duration={state.duration}
              trackColor={colors.progressTrack}
              fillColor={colors.accent}
              onScrubStart={(seconds) => {
                isScrubbing.current = true;
                setScrubPosition(seconds);
              }}
              onScrubMove={setScrubPosition}
              onScrubEnd={(seconds) => void finishScrubbing(seconds)}
              onScrubCancel={() => {
                isScrubbing.current = false;
                setScrubPosition(null);
              }}
            />
            <View style={styles.times}>
              <Text style={{ color: colors.secondary }}>
                {clock(displayedPosition)}
              </Text>
              <Text style={{ color: colors.secondary }}>
                {clock(state.duration)}
              </Text>
            </View>
            <View style={styles.controls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retroceder 15 segundos"
                onPress={() => void command(() => playback.skip(-15))}
                style={styles.control}
              >
                <Text style={[styles.controlText, { color: colors.text }]}>
                  −15
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  state.status === 'playing'
                    ? 'Pausar'
                    : state.completed
                      ? 'Reproducir de nuevo'
                      : 'Reproducir'
                }
                onPress={() =>
                  void command(() =>
                    state.status === 'playing'
                      ? playback.pause()
                      : playback.play(),
                  )
                }
                style={[
                  styles.primaryControl,
                  { backgroundColor: colors.accent },
                ]}
              >
                <Text style={[styles.controlText, { color: colors.onAccent }]}>
                  {state.status === 'playing' ? 'Pausa' : 'Play'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Avanzar 15 segundos"
                onPress={() => void command(() => playback.skip(15))}
                style={styles.control}
              >
                <Text style={[styles.controlText, { color: colors.text }]}>
                  +15
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.rateHeading, { color: colors.secondary }]}>
              Velocidad
            </Text>
            <View style={styles.rates}>
              {rates.map((rate) => (
                <Pressable
                  key={rate}
                  accessibilityRole="button"
                  accessibilityLabel={`Velocidad ${rate}×`}
                  accessibilityState={{ selected: state.rate === rate }}
                  onPress={() => void command(() => playback.setRate(rate))}
                  style={[
                    styles.rate,
                    {
                      borderColor: colors.border,
                      backgroundColor:
                        state.rate === rate ? colors.accent : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        state.rate === rate ? colors.onAccent : colors.text,
                    }}
                  >
                    {rate}×
                  </Text>
                </Pressable>
              ))}
            </View>
            {item?.mediaType === 'video' ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pantalla completa"
                  onPress={() => void command(() => playback.enterFullscreen())}
                  style={[styles.fullscreen, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.text }}>Pantalla completa</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Picture in Picture"
                  accessibilityState={{ disabled: !state.pipAvailable }}
                  disabled={!state.pipAvailable}
                  onPress={() => void command(() => playback.startPiP())}
                  style={[styles.fullscreen, { borderColor: colors.border }]}
                >
                  <Text
                    style={{
                      color: state.pipAvailable
                        ? colors.text
                        : colors.secondary,
                    }}
                  >
                    Picture in Picture
                  </Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, padding: 22, gap: 14 },
  back: { minHeight: 44, justifyContent: 'center' },
  videoBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  video: { width: '100%', height: '100%' },
  pipPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  artworkBox: {
    width: '85%',
    maxWidth: 340,
    aspectRatio: 1,
    alignSelf: 'center',
    borderRadius: 16,
    overflow: 'hidden',
  },
  artwork: { width: '100%', height: '100%' },
  title: { fontSize: 23, fontWeight: '700' },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  control: {
    minWidth: 70,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryControl: {
    minWidth: 92,
    minHeight: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: { fontSize: 19, fontWeight: '700' },
  rateHeading: { marginTop: 10, fontSize: 13 },
  rates: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  rate: {
    minHeight: 40,
    minWidth: 50,
    paddingHorizontal: 9,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreen: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
});
