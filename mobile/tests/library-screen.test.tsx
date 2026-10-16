import {
  act,
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
import {
  countUncollectedItems,
  createCollection,
  deleteCollection,
  listCollections,
  observeCollections,
  renameCollection,
} from '@/services/collections';
import { playback } from '@/services/playback';

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockSection = 'downloads';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    setParams: mockSetParams,
  }),
  useLocalSearchParams: () => ({ section: mockSection }),
  useFocusEffect: (callback: () => void) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('@/services/collections', () => ({
  listCollections: jest.fn(),
  countUncollectedItems: jest.fn(),
  createCollection: jest.fn(),
  renameCollection: jest.fn(),
  deleteCollection: jest.fn(),
  listItemCollectionIds: jest.fn(async () => []),
  setItemCollections: jest.fn(),
  observeCollections: jest.fn(() => jest.fn()),
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
jest.mock('@/services/playback', () => ({
  playback: { startInContext: jest.fn() },
}));
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
  jest.mocked(playback.startInContext).mockResolvedValue({} as never);
  mockSection = 'downloads';
  jest.mocked(listLibrary).mockResolvedValue([item] as never);
  jest.mocked(listCollections).mockResolvedValue([]);
  jest.mocked(countUncollectedItems).mockResolvedValue(1);
  jest.mocked(createCollection).mockResolvedValue({
    id: 'c',
    name: 'Cursos',
    createdAt: 'now',
    updatedAt: 'now',
  });
  jest.mocked(renameCollection).mockResolvedValue({
    id: 'c',
    name: 'Renombrada',
    createdAt: 'now',
    updatedAt: 'now',
  });
  jest.mocked(deleteCollection).mockResolvedValue(undefined);
  jest.mocked(saveLocalFileToFiles).mockResolvedValue('saved');
  jest.mocked(shareLocalFile).mockResolvedValue(undefined);
  jest.mocked(deleteLibraryItem).mockResolvedValue(undefined);
});

test('Descargas is initial and switching preserves filters and opens Collections', async () => {
  const view = await render(<LibraryScreen />);
  expect(
    screen.getByRole('tab', { name: 'Descargas' }).props.accessibilityState
      .selected,
  ).toBe(true);
  expect(screen.getByRole('button', { name: 'Todos' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Colecciones' }));
  expect(mockSetParams).toHaveBeenCalledWith({ section: 'collections' });
  mockSection = 'collections';
  await view.rerender(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Sin colección')).toBeTruthy());
  expect(screen.getByText('1 elemento · Vista automática')).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Descargas' }));
  mockSection = 'downloads';
  await view.rerender(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
});

test('Collections include empty rows, create, rename and delete without deleting media', async () => {
  mockSection = 'collections';
  jest.mocked(listCollections).mockResolvedValue([
    {
      id: 'c',
      name: 'Cursos',
      createdAt: 'now',
      updatedAt: 'now',
      itemCount: 0,
    },
  ]);
  const prompt = jest
    .spyOn(Alert, 'prompt')
    .mockImplementation(() => undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Cursos')).toBeTruthy());
  expect(screen.getByText('0 elementos')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Crear colección' }),
  );
  const createButtons = prompt.mock.calls[0]?.[2];
  if (Array.isArray(createButtons))
    (createButtons[1]?.onPress as ((name: string) => void) | undefined)?.(
      'Nueva',
    );
  await waitFor(() => expect(createCollection).toHaveBeenCalledWith('Nueva'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Renombrar Cursos' }),
  );
  const renameButtons = prompt.mock.calls[1]?.[2];
  if (Array.isArray(renameButtons))
    (renameButtons[1]?.onPress as ((name: string) => void) | undefined)?.(
      'Renombrada',
    );
  await waitFor(() =>
    expect(renameCollection).toHaveBeenCalledWith('c', 'Renombrada'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Eliminar colección Cursos' }),
  );
  expect(alert.mock.calls[0]?.[1]).toContain('permanecerán');
  const deleteButtons = alert.mock.calls[0]?.[2];
  if (Array.isArray(deleteButtons)) deleteButtons[1]?.onPress?.();
  await waitFor(() => expect(deleteCollection).toHaveBeenCalledWith('c'));
  expect(deleteLibraryItem).not.toHaveBeenCalled();
  prompt.mockRestore();
  alert.mockRestore();
});

test('older Collections refresh cannot overwrite a newer observer result', async () => {
  mockSection = 'collections';
  let resolveOld!: (rows: Awaited<ReturnType<typeof listCollections>>) => void;
  let refresh!: () => void;
  jest
    .mocked(listCollections)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce([
      {
        id: 'new',
        name: 'Actual',
        itemCount: 0,
        createdAt: 'now',
        updatedAt: 'now',
      },
    ]);
  jest.mocked(observeCollections).mockImplementation((listener) => {
    refresh = listener;
    return jest.fn();
  });
  await render(<LibraryScreen />);
  await act(async () => refresh());
  await waitFor(() => expect(screen.getByText('Actual')).toBeTruthy());
  await act(async () =>
    resolveOld([
      {
        id: 'old',
        name: 'Obsoleta',
        itemCount: 0,
        createdAt: 'now',
        updatedAt: 'now',
      },
    ]),
  );
  expect(screen.queryByText('Obsoleta')).toBeNull();
  expect(screen.getByText('Actual')).toBeTruthy();
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

test('compatible audio and video open only by library ID', async () => {
  const video = {
    ...item,
    id: '00000000-0000-0000-0000-000000000002',
    title: 'Video local',
    mediaType: 'video',
    relativeMediaPath: 'Media/private.mp4',
  };
  jest.mocked(listLibrary).mockResolvedValue([item, video] as never);
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Video local')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir Podcast largo' }),
  );
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir Video local' }),
  );
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
  expect(playback.startInContext).toHaveBeenNthCalledWith(1, item.id, [
    item.id,
    video.id,
  ]);
  expect(playback.startInContext).toHaveBeenNthCalledWith(2, video.id, [
    item.id,
    video.id,
  ]);
  expect(mockPush).toHaveBeenNthCalledWith(1, `/player/${item.id}`);
  expect(mockPush).toHaveBeenNthCalledWith(2, `/player/${video.id}`);
  expect(JSON.stringify(mockPush.mock.calls)).not.toContain('file://');
});

test('Videos and Audio taps send only the currently visible filtered order', async () => {
  const videoA = {
    ...item,
    id: '00000000-0000-0000-0000-000000000002',
    title: 'Video A',
    mediaType: 'video',
    relativeMediaPath: 'Media/a.mp4',
  };
  const videoB = {
    ...videoA,
    id: '00000000-0000-0000-0000-000000000003',
    title: 'Video B',
  };
  jest.mocked(listLibrary).mockResolvedValue([videoA, item, videoB] as never);
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Video B')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Videos' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir Video A' }),
  );
  await waitFor(() => expect(playback.startInContext).toHaveBeenCalledTimes(1));
  expect(playback.startInContext).toHaveBeenCalledWith(videoA.id, [
    videoA.id,
    videoB.id,
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Audio' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir Podcast largo' }),
  );
  await waitFor(() => expect(playback.startInContext).toHaveBeenCalledTimes(2));
  expect(playback.startInContext).toHaveBeenLastCalledWith(item.id, [item.id]);
});

test('unsupported format retains export/share/delete but does not navigate', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest
    .mocked(listLibrary)
    .mockResolvedValue([
      { ...item, relativeMediaPath: 'Media/a.webm' },
    ] as never);
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir Podcast largo' }),
  );
  expect(mockPush).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Formato no compatible',
    expect.any(String),
  );
  expect(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Compartir' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Eliminar' })).toBeTruthy();
});
