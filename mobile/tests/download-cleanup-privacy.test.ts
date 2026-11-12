import { deleteLocalFile } from '@/services/jobs';

jest.mock('expo-file-system', () => ({
  File: jest.fn(() => ({
    exists: true,
    delete: () => {
      throw new Error(
        'file:///private/A1_PRIVATE?sig=A1_SECRET Authorization: Bearer A1_BEARER',
      );
    },
  })),
}));
jest.mock('expo-sharing', () => ({}));
jest.mock('@/services/api', () => ({}));
jest.mock('@/services/token', () => ({}));

test('download cleanup logs a closed diagnostic code without native details', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  deleteLocalFile('file:///private/A1_PRIVATE.mp4');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(
    '[Drop files] DOWNLOAD_TEMP_CLEANUP_FAILED',
  );
  expect(warn.mock.calls.flat().map(String).join(' ')).not.toMatch(
    /A1_PRIVATE|A1_SECRET|A1_BEARER/,
  );
});
