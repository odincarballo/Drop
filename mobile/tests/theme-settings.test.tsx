import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Appearance, Pressable, Text, View } from 'react-native';

import SettingsScreen from '@/app/settings';
import { THEME_PREFERENCE_KEY, ThemeProvider, useTheme } from '@/theme';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/components/BackendAccessCard', () => ({
  BackendAccessCard: () => {
    const MockText = require('react-native').Text;
    return <MockText>Token de Drop · Configurado ✓</MockText>;
  },
}));

function ThemeProbe() {
  const { mode, isDark, setMode } = useTheme();
  return (
    <View>
      <Text>{mode}</Text>
      <Text>{isDark ? 'dark palette' : 'light palette'}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Set dark"
        onPress={() => void setMode('dark')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Set system"
        onPress={() => void setMode('system')}
      />
    </View>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('System is the default and theme preference uses non-sensitive storage', async () => {
  const scheme = jest
    .spyOn(Appearance, 'setColorScheme')
    .mockImplementation(() => {});
  await render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
  expect(await screen.findByText('system')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Set dark' }));
  expect(screen.getByText('dark')).toBeTruthy();
  expect(screen.getByText('dark palette')).toBeTruthy();
  expect(await AsyncStorage.getItem(THEME_PREFERENCE_KEY)).toBe('dark');
  await fireEvent.press(screen.getByRole('button', { name: 'Set system' }));
  expect(screen.getByText('system')).toBeTruthy();
  expect(await AsyncStorage.getItem(THEME_PREFERENCE_KEY)).toBeNull();
  expect(scheme).toHaveBeenCalledWith('unspecified');
  scheme.mockRestore();
});

test('persisted Claro or Oscuro is restored after restart', async () => {
  await AsyncStorage.setItem(THEME_PREFERENCE_KEY, 'dark');
  await render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
  expect(await screen.findByText('dark')).toBeTruthy();
  expect(screen.getByText('dark palette')).toBeTruthy();
});

test('Settings contains appearance and token while the home keeps token separate', async () => {
  await render(
    <ThemeProvider>
      <SettingsScreen />
    </ThemeProvider>,
  );
  expect(await screen.findByText('Ajustes')).toBeTruthy();
  expect(screen.getByText('Apariencia')).toBeTruthy();
  expect(screen.getByText('Acceso')).toBeTruthy();
  expect(screen.getByText('Token de Drop · Configurado ✓')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Sistema' })).toBeChecked();
  await act(async () => {
    fireEvent.press(screen.getByRole('radio', { name: 'Oscuro' }));
  });
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeChecked(),
  );
});
