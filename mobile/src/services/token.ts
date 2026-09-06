import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'mediadrop.api-token.v1';
const TOKEN_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

export function normalizeApiToken(value: string): string {
  const token = value.trim();
  if (token.length < 32)
    throw new Error('El token debe tener al menos 32 caracteres.');
  if (token.length > 512) throw new Error('El token es demasiado largo.');
  return token;
}

export async function getApiToken(): Promise<string | null> {
  if (!(await SecureStore.isAvailableAsync())) return null;
  return SecureStore.getItemAsync(TOKEN_KEY, TOKEN_OPTIONS);
}

export async function saveApiToken(value: string): Promise<void> {
  if (!(await SecureStore.isAvailableAsync()))
    throw new Error('El almacenamiento seguro no está disponible.');
  await SecureStore.setItemAsync(
    TOKEN_KEY,
    normalizeApiToken(value),
    TOKEN_OPTIONS,
  );
}

export async function deleteApiToken(): Promise<void> {
  if (await SecureStore.isAvailableAsync())
    await SecureStore.deleteItemAsync(TOKEN_KEY, TOKEN_OPTIONS);
}
