import * as SecureStore from 'expo-secure-store';

import {
  deleteApiToken,
  getApiToken,
  normalizeApiToken,
  saveApiToken,
} from '@/services/token';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const token = 'private-token-0123456789abcdef0123456789abcdef';

test('normalizes and validates tokens without exposing them publicly', () => {
  expect(normalizeApiToken(`  ${token}  `)).toBe(token);
  expect(() => normalizeApiToken('too-short')).toThrow('32 caracteres');
});

test('stores, reads and deletes the token with device-only keychain access', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(token);
  await saveApiToken(` ${token} `);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'mediadrop.api-token.v1',
    token,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  await expect(getApiToken()).resolves.toBe(token);
  await deleteApiToken();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    'mediadrop.api-token.v1',
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
});
