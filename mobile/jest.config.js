module.exports = {
  preset: 'jest-expo/ios',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  clearMocks: true,
  restoreMocks: true,
  setupFiles: ['<rootDir>/tests/jest-setup.ts'],
};
