import { fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { BackendAccessCard } from '@/components/BackendAccessCard';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const token = 'private-token-0123456789abcdef0123456789abcdef';

test('lets the user save the private token once without displaying it later', async () => {
  await render(<BackendAccessCard />);
  const input = await screen.findByLabelText('Token de acceso del backend');
  await fireEvent.changeText(input, token);
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar token' }));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'mediadrop.api-token.v1',
    token,
    expect.any(Object),
  );
  expect(await screen.findByText('Configurado ✓')).toBeTruthy();
  expect(screen.queryByDisplayValue(token)).toBeNull();
});
