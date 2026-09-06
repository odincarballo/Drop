import { useColorScheme } from 'react-native';

const palette = {
  light: {
    background: '#F7F8FA',
    surface: '#FFFFFF',
    text: '#172127',
    secondary: '#53626B',
    border: '#DCE2E5',
    accent: '#16635C',
    onAccent: '#FFFFFF',
    subtle: '#EDF3F1',
    error: '#A62535',
    errorBackground: '#FFF0F1',
    success: '#176B50',
    progressTrack: '#DCE9E5',
  },
  dark: {
    background: '#101719',
    surface: '#1B2428',
    text: '#F1F5F4',
    secondary: '#ABB9BD',
    border: '#354449',
    accent: '#A0DBCD',
    onAccent: '#102F2A',
    subtle: '#22352F',
    error: '#FFB2B9',
    errorBackground: '#3D242B',
    success: '#8DDBC0',
    progressTrack: '#31423E',
  },
};

export function useTheme() {
  const isDark = useColorScheme() === 'dark';
  return { colors: palette[isDark ? 'dark' : 'light'], isDark };
}
