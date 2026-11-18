jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo/fetch', () => ({
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
