import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Appearance, useColorScheme } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_PREFERENCE_KEY = 'drop.appearance.v1';

const palette = {
  light: {
    background: '#FFFFFF',
    surface: '#F7F7F7',
    text: '#151515',
    secondary: '#656565',
    border: '#E5E5E5',
    accent: '#111111',
    onAccent: '#FFFFFF',
    subtle: '#F0F0F0',
    error: '#B4232F',
    errorBackground: '#FFF1F2',
    success: '#181818',
    progressTrack: '#E7E7E7',
  },
  dark: {
    background: '#0C0C0C',
    surface: '#1A1A1A',
    text: '#FAFAFA',
    secondary: '#AEAEAE',
    border: '#343434',
    accent: '#FAFAFA',
    onAccent: '#101010',
    subtle: '#262626',
    error: '#FF9FA7',
    errorBackground: '#352023',
    success: '#F5F5F5',
    progressTrack: '#3A3A3A',
  },
};

type ThemeValue = {
  colors: (typeof palette)['light'];
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
  ready: boolean;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setSelectedMode] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(THEME_PREFERENCE_KEY)
      .then((saved) => {
        if (!active) return;
        if (saved === 'light' || saved === 'dark') setSelectedMode(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (ready)
      Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode, ready]);

  async function setMode(next: ThemeMode) {
    if (next === 'system') await AsyncStorage.removeItem(THEME_PREFERENCE_KEY);
    else await AsyncStorage.setItem(THEME_PREFERENCE_KEY, next);
    setSelectedMode(next);
  }

  const isDark = (mode === 'system' ? systemScheme : mode) === 'dark';
  const value = useMemo(
    () => ({
      colors: palette[isDark ? 'dark' : 'light'],
      isDark,
      mode,
      setMode,
      ready,
    }),
    [isDark, mode, ready],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const provided = useContext(ThemeContext);
  const systemScheme = useColorScheme();
  if (provided) return provided;
  // Isolated component tests still get a usable system appearance.
  const isDark = systemScheme === 'dark';
  return {
    colors: palette[isDark ? 'dark' : 'light'],
    isDark,
    mode: 'system',
    setMode: async () => undefined,
    ready: true,
  };
}
