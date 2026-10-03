import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';

import LibraryScreen from '@/app/library';
import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
import { shareLocalFile } from '@/services/jobs';
import {
  deleteLibraryItem,
  listLibrary,
  withLibraryLease,
} from '@/services/library';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (callback: () => void) =>
    require('react').useEffect(callback, []),
}));
jest.mock('@/services/library', () => ({
  listLibrary: jest.fn(),
  deleteLibraryItem: jest.fn(),
  observeLibrary: jest.fn(() => jest.fn()),
  withLibraryLease: jest.fn((_id, action) =>
    action({ uri: 'file:///library/a.mp4' }),
  ),
}));
jest.mock('@/services/fileExport', () => ({
  saveLocalFileToFiles: jest.fn(),
  withNamedLibraryFile: jest.fn((_item, operation) =>
    operation('file:///cache/DropExport/Podcast%20largo.m4a'),
  ),
}));
jest.mock('@/services/jobs', () => ({ shareLocalFile: jest.fn() }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const item = {
  id: '00000000-0000-0000-0000-000000000001',
  title: 'Podcast largo',
  sourceKind: 'youtube',
  sourceVideoId: 'AWGPaFraPN4',
  mediaType: 'audio',
  relativeMediaPath: 'Media/a.m4a',
  relativeArtworkPath: null,
  sizeBytes: 100_000_000,
  artworkSizeBytes: 0,
  durationSeconds: 3600,
  resolution: null,
  height: null,
  fps: null,
  videoCodec: null,
  audioCodec: 'mp4a.40.2',
  container: 'm4a',
  downloadedAt: '2026-10-02T12:00:00.000Z',
  playbackPositionSeconds: 0,
  completedAt: null,
  lifecycle: 'ready',
  uri: 'file:///library/a.m4a',
  artworkUri: null,
  thumbnailUrl: null,
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listLibrary).mockResolvedValue([item] as never);
  jest.mocked(saveLocalFileToFiles).mockResolvedValue('saved');
  jest.mocked(shareLocalFile).mockResolvedValue(undefined);
  jest.mocked(deleteLibraryItem).mockResolvedValue(undefined);
});

test('library lists offline item, real space, and filters', async () => {
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  expect(screen.getByText('100 MB utilizados')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Videos' }));
  expect(screen.queryByText('Podcast largo')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Audio' }));
  expect(screen.getByText('Podcast largo')).toBeTruthy();
});

test('export and sharing acquire the Library lease', async () => {
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  );
  await waitFor(() =>
    expect(saveLocalFileToFiles).toHaveBeenCalledWith(
      'file:///cache/DropExport/Podcast%20largo.m4a',
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Compartir' }));
  await waitFor(() =>
    expect(shareLocalFile).toHaveBeenCalledWith(
      'file:///cache/DropExport/Podcast%20largo.m4a',
    ),
  );
  expect(withLibraryLease).toHaveBeenCalledTimes(2);
  expect(withNamedLibraryFile).toHaveBeenCalledTimes(2);
});

test('deletion asks for confirmation before removing an item', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Eliminar' }));
  expect(deleteLibraryItem).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0]?.[2];
  const confirm = Array.isArray(buttons)
    ? buttons.find((button) => button.text === 'Eliminar')
    : null;
  confirm?.onPress?.();
  await waitFor(() => expect(deleteLibraryItem).toHaveBeenCalledWith(item.id));
  alert.mockRestore();
});
