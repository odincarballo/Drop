import { requireOptionalNativeModule } from 'expo';

import { saveLocalFileToFiles } from '@/services/fileExport';
import { withLocalFileLease } from '@/services/jobs';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/jobs', () => ({
  withLocalFileLease: jest.fn(
    (_uri: string, operation: () => Promise<unknown>) => operation(),
  ),
}));

beforeEach(() => {
  jest.mocked(requireOptionalNativeModule).mockReset();
  jest.mocked(withLocalFileLease).mockClear();
});

test('keeps a lease until the native picker confirms export', async () => {
  let finish!: (value: { status: 'saved' }) => void;
  const saveToFiles = jest.fn(
    () =>
      new Promise<{ status: 'saved' }>((resolve) => {
        finish = resolve;
      }),
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ saveToFiles });
  const pending = saveLocalFileToFiles('file:///cache/audio.m4a');
  expect(saveToFiles).toHaveBeenCalledWith('file:///cache/audio.m4a');
  expect(withLocalFileLease).toHaveBeenCalledWith(
    'file:///cache/audio.m4a',
    expect.any(Function),
  );
  finish({ status: 'saved' });
  await expect(pending).resolves.toBe('saved');
});

test('reports picker cancellation without claiming a saved file', async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    saveToFiles: jest.fn().mockResolvedValue({ status: 'cancelled' }),
  });
  await expect(saveLocalFileToFiles('file:///cache/audio.m4a')).resolves.toBe(
    'cancelled',
  );
});

test('rejects absent exporter and unconfirmed native outcomes', async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  await expect(saveLocalFileToFiles('file:///cache/a.mp4')).rejects.toThrow(
    'Actualiza la app',
  );
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    saveToFiles: jest.fn().mockResolvedValue({ status: 'unknown' }),
  });
  await expect(saveLocalFileToFiles('file:///cache/a.mp4')).rejects.toThrow(
    'confirmar',
  );
});
