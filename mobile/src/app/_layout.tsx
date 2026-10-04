import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Slot, usePathname, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { cleanupAbandonedFilesAtStartup } from '@/services/fileExport';
import { initializeLibrary } from '@/services/library';
import { playback } from '@/services/playback';
import { ThemeProvider, useTheme } from '@/theme';

function ThemedRoutes() {
  const router = useRouter();
  const pathname = usePathname();
  const { isDark, ready } = useTheme();
  const [libraryReady, setLibraryReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void initializeLibrary()
      .then(() => {
        // Reconcile pending promotions before the existing Caches sweep.
        cleanupAbandonedFilesAtStartup();
        if (active) setLibraryReady(true);
      })
      .catch((failure: unknown) => {
        console.warn('[Drop library] Startup failed', failure);
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(
    () =>
      playback.subscribeRestore((id) => {
        // The player route acknowledges only after its native surface mounts.
        if (pathname === `/player/${id}`) return;
        try {
          router.push(`/player/${id}` as Href);
        } catch {
          void playback.completePiPRestore(false).catch(() => undefined);
        }
      }),
    [pathname, router],
  );
  if (!ready) return null;
  if (error)
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text accessibilityRole="alert">
          No se pudo abrir la Biblioteca de Drop. Ningún archivo fue borrado.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(false);
            setAttempt((value) => value + 1);
          }}
        >
          <Text>Reintentar</Text>
        </Pressable>
      </View>
    );
  if (!libraryReady) return null;
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Slot />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedRoutes />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
