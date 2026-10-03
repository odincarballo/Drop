import { requireOptionalNativeModule } from 'expo';

import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
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

const libraryItem = {
  title: 'Este video lo borraré en 48 horas',
  mediaType: 'video',
  relativeMediaPath: 'Media/ad02362e-bd7c-498a-8f00-aaaaaaaaaaaa.mp4',
  uri: 'file:///Library/Application%20Support/Drop/Media/ad02362e-bd7c-498a-8f00-aaaaaaaaaaaa.mp4',
} as Parameters<typeof withNamedLibraryFile>[0];
const namedUri =
  'file:///Caches/DropExport/new/Este%20video%20lo%20borrar%C3%A9%20en%2048%20horas.mp4';

test.each(['saved', 'cancelled'] as const)(
  'named %s export retains the original until completion and cleans the alias',
  async (outcome) => {
    const createNamedExport = jest.fn().mockResolvedValue({ uri: namedUri });
    const removeNamedExport = jest.fn().mockResolvedValue(undefined);
    jest.mocked(requireOptionalNativeModule).mockReturnValue({
      createNamedExport,
      removeNamedExport,
    });
    let finish!: (value: typeof outcome) => void;
    const operation = jest.fn(
      () =>
        new Promise<typeof outcome>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = withNamedLibraryFile(libraryItem, operation);
    await Promise.resolve();
    await Promise.resolve();
    expect(createNamedExport).toHaveBeenCalledWith(
      libraryItem.uri,
      'Este video lo borraré en 48 horas.mp4',
    );
    expect(operation).toHaveBeenCalledWith(namedUri);
    expect(removeNamedExport).not.toHaveBeenCalled();
    expect(libraryItem.uri).toContain(
      'ad02362e-bd7c-498a-8f00-aaaaaaaaaaaa.mp4',
    );
    finish(outcome);
    await expect(pending).resolves.toBe(outcome);
    expect(removeNamedExport).toHaveBeenCalledWith(namedUri);
  },
);

test('named share failure also removes its temporary hard link', async () => {
  const removeNamedExport = jest.fn().mockResolvedValue(undefined);
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    createNamedExport: jest.fn().mockResolvedValue({ uri: namedUri }),
    removeNamedExport,
  });
  await expect(
    withNamedLibraryFile(libraryItem, async () => {
      throw new Error('Share cancelled');
    }),
  ).rejects.toThrow('Share cancelled');
  expect(removeNamedExport).toHaveBeenCalledWith(namedUri);
});
