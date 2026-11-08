import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  StyleSheet,
} from 'react-native';

import LibraryScreenContent from '@/app/library';
import { librarySortOptions, selectLibraryItems } from '@/utils/libraryQuery';
import { LibraryViewProvider } from '@/providers/LibraryViewProvider';

import {
  startLocalImport,
  retryLocalImport,
  cancelLocalImport,
  type LocalImportState,
} from '@/services/localImport';

function LibraryScreen() {
  return (
    <LibraryViewProvider>
      <LibraryScreenContent />
    </LibraryViewProvider>
  );
}
import { LibraryItemRow } from '@/components/LibraryItemRow';
import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
import { shareLocalFile } from '@/services/jobs';
import {
  deleteLibraryItem,
  listLibrary,
  observeLibrary,
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
let mockImportState: LocalImportState = { phase: 'idle', canRetry: false };
const mockImportListeners = new Set<() => void>();
function updateImport(state: LocalImportState) {
  mockImportState = state;
  for (const listener of mockImportListeners) listener();
}
jest.mock(
  '@/services/localImport',
  () => ({
    getLocalImportState: () => mockImportState,
    observeLocalImport: (listener: () => void) => {
      mockImportListeners.add(listener);
      return () => mockImportListeners.delete(listener);
    },
    startLocalImport: jest.fn(),
    retryLocalImport: jest.fn(),
    cancelLocalImport: jest.fn(),
  }),
  { virtual: true },
);
import {
  enqueueLast,
  enqueueNext,
  getQueuePlaybackSyncState,
  observeQueuePlaybackSync,
} from '@/services/queue';

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
  completeExistingLocalMetadata: jest.fn(),
  cancelExistingMetadataCompletion: jest.fn(),
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
jest.mock('@/services/queue', () => ({
  enqueueNext: jest.fn(),
  enqueueLast: jest.fn(),
  getQueuePlaybackSyncState: jest.fn(),
  observeQueuePlaybackSync: jest.fn(() => jest.fn()),
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
  availability: 'available' as const,
  mediaSizeOnDisk: 100_000_000,
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

beforeEach(async () => {
  mockImportState = { phase: 'idle', canRetry: false };
  mockImportListeners.clear();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest
    .mocked(getQueuePlaybackSyncState)
    .mockReturnValue({ status: 'applied', lastResult: 'applied' });
  const saved = { id: 'entry', itemId: item.id, position: 0, addedAt: 'now' };
  jest.mocked(enqueueNext).mockResolvedValue(saved);
  jest.mocked(enqueueLast).mockResolvedValue(saved);
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

test('Queue actions use the Queue API and leave CURRENT untouched; navigation opens Queue', async () => {
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Reproducir a continuación: Podcast largo',
    }),
  );
  await waitFor(() =>
    expect(screen.getByText('Añadido a la cola.')).toBeTruthy(),
  );
  expect(enqueueNext).toHaveBeenCalledWith(item.id);
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Añadir al final de la cola: Podcast largo',
    }),
  );
  await waitFor(() => expect(enqueueLast).toHaveBeenCalledWith(item.id));
  expect(playback.startInContext).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Ver cola' }));
  expect(mockPush).toHaveBeenCalledWith('/queue');
});

test('rapid Queue presses are single-submit but later intentional duplicates remain allowed', async () => {
  let release!: (entry: Awaited<ReturnType<typeof enqueueNext>>) => void;
  jest.mocked(enqueueNext).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  const button = screen.getByRole('button', {
    name: 'Reproducir a continuación: Podcast largo',
  });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(enqueueNext).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Actualizando cola…')).toBeTruthy();
  await act(async () =>
    release({ id: 'x', itemId: item.id, position: 0, addedAt: 'now' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Añadido a la cola.')).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Reproducir a continuación: Podcast largo',
    }),
  );
  await waitFor(() => expect(enqueueNext).toHaveBeenCalledTimes(2));
  expect(observeQueuePlaybackSync).toHaveBeenCalledTimes(1);
});

test('pending reconciliation is reported as saved, with no false save error or applied notice', async () => {
  let update!: () => void;
  jest.mocked(observeQueuePlaybackSync).mockImplementationOnce((listener) => {
    update = listener;
    return jest.fn();
  });
  jest
    .mocked(getQueuePlaybackSyncState)
    .mockReturnValue({ status: 'pending', lastResult: 'failed' });
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Reproducir a continuación: Podcast largo',
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByText('Guardado en la cola. Actualizando reproducción…'),
    ).toBeTruthy(),
  );
  expect(screen.queryByText('Añadido a la cola.')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => {
    jest
      .mocked(getQueuePlaybackSyncState)
      .mockReturnValue({ status: 'applied', lastResult: 'applied' });
    update();
  });
  expect(screen.getByText('Añadido a la cola.')).toBeTruthy();
});

test('enqueue feedback removes its observer and ignores late callbacks after unmount', async () => {
  let update!: () => void;
  const stop = jest.fn();
  jest.mocked(observeQueuePlaybackSync).mockImplementationOnce((listener) => {
    update = listener;
    return stop;
  });
  const view = await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Reproducir a continuación: Podcast largo',
    }),
  );
  await waitFor(() =>
    expect(screen.getByText('Añadido a la cola.')).toBeTruthy(),
  );
  await view.unmount();
  const reads = jest.mocked(getQueuePlaybackSyncState).mock.calls.length;
  await act(async () => update());
  expect(stop).toHaveBeenCalledTimes(1);
  expect(getQueuePlaybackSyncState).toHaveBeenCalledTimes(reads);
});

test('unsupported or non-ready media never offers Queue actions', async () => {
  jest.mocked(listLibrary).mockResolvedValue([
    {
      ...item,
      id: 'unsupported',
      title: 'WebM',
      relativeMediaPath: 'Media/a.webm',
    },
    { ...item, id: 'deleting', title: 'Eliminando', lifecycle: 'deleting' },
  ] as never);
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('WebM')).toBeTruthy());
  expect(screen.queryByText('Reproducir a continuación')).toBeNull();
  expect(screen.queryByText('Añadir al final de la cola')).toBeNull();
});

test('Queue save failures are sanitized and keep the existing Library intact', async () => {
  jest
    .mocked(enqueueNext)
    .mockRejectedValueOnce(new Error('/private/library.sqlite'));
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Reproducir a continuación: Podcast largo',
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      /No se pudo guardar en la cola/,
    ),
  );
  expect(screen.getByText('Podcast largo')).toBeTruthy();
  expect(screen.queryByText('/private/library.sqlite')).toBeNull();
});

test('Library header is unique and keeps accessible Queue and Settings routes', async () => {
  await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  expect(screen.getAllByRole('header')).toHaveLength(1);
  expect(screen.getByRole('header', { name: 'Biblioteca' })).toBeTruthy();
  expect(screen.getAllByText('Biblioteca')).toHaveLength(1);
  expect(screen.queryByText('Drop')).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Descargas' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Ver cola' }));
  expect(mockPush).toHaveBeenLastCalledWith('/queue');
  await fireEvent.press(screen.getByRole('button', { name: 'Ajustes' }));
  expect(mockPush).toHaveBeenLastCalledWith('/settings');
  expect(playback.startInContext).not.toHaveBeenCalled();
});

test('Library header controls allow enlarged text and minimum touch targets', async () => {
  await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  const title = screen.getByRole('header', { name: 'Biblioteca' });
  expect(title.props.allowFontScaling).not.toBe(false);
  expect(title.props.numberOfLines).toBeUndefined();
  for (const control of [
    screen.getByRole('button', { name: 'Ver cola' }),
    screen.getByRole('button', { name: 'Ajustes' }),
    screen.getByRole('tab', { name: 'Archivos' }),
    screen.getByRole('tab', { name: 'Colecciones' }),
  ]) {
    const style = StyleSheet.flatten(control.props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeUndefined();
  }
});

test('Archivos is initial and switching preserves internal sections and opens Collections', async () => {
  const view = await render(<LibraryScreen />);
  expect(
    screen.getByRole('tab', { name: 'Archivos' }).props.accessibilityState
      .selected,
  ).toBe(true);
  expect(screen.getByRole('button', { name: 'Todos' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Colecciones' }));
  expect(mockSetParams).toHaveBeenCalledWith({ section: 'collections' });
  mockSection = 'collections';
  await view.rerender(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Sin colección')).toBeTruthy());
  expect(screen.getByText('1 elemento · Vista automática')).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Archivos' }));
  expect(mockSetParams).toHaveBeenLastCalledWith({ section: 'downloads' });
  mockSection = 'downloads';
  await view.rerender(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  expect(
    screen.getByRole('tab', { name: 'Archivos' }).props.accessibilityState
      .selected,
  ).toBe(true);
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
    video.id,
    item.id,
  ]);
  expect(playback.startInContext).toHaveBeenNthCalledWith(2, video.id, [
    video.id,
    item.id,
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
    videoB.id,
    videoA.id,
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

test('unavailable record is visible, blocks playback/export and allows explicit Delete', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest
    .mocked(listLibrary)
    .mockResolvedValue([
      { ...item, availability: 'missing', mediaSizeOnDisk: null, uri: null },
    ] as never);
  await render(<LibraryScreen />);
  const row = await screen.findByRole('button', {
    name: 'Podcast largo, archivo no disponible',
  });
  expect(row).toBeDisabled();
  expect(screen.getByText(/Se conservan sus datos/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Compartir' })).toBeDisabled();
  await fireEvent.press(row);
  await fireEvent.press(screen.getByText('Guardar en Archivos'));
  await fireEvent.press(screen.getByText('Compartir'));
  expect(playback.startInContext).not.toHaveBeenCalled();
  expect(withLibraryLease).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Eliminar'));
  const buttons = alert.mock.calls.at(-1)?.[2];
  if (Array.isArray(buttons)) buttons[1]?.onPress?.();
  await waitFor(() => expect(deleteLibraryItem).toHaveBeenCalledWith(item.id));
});

test('returning to Library rechecks a recovered medium and enables its actions', async () => {
  jest
    .mocked(listLibrary)
    .mockResolvedValue([
      { ...item, availability: 'missing', mediaSizeOnDisk: null, uri: null },
    ] as never);
  const first = await render(<LibraryScreen />);
  expect(
    await screen.findByRole('button', {
      name: 'Podcast largo, archivo no disponible',
    }),
  ).toBeDisabled();
  await first.unmount();
  jest.mocked(listLibrary).mockResolvedValue([item] as never);
  await render(<LibraryScreen />);
  expect(
    await screen.findByRole('button', { name: 'Reproducir Podcast largo' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  ).toBeEnabled();
  expect(playback.startInContext).not.toHaveBeenCalled();
});

async function openSortMenu() {
  const show = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation(() => undefined);
  await fireEvent.press(screen.getByRole('button', { name: /^Orden: / }));
  const call = show.mock.calls.at(-1)!;
  return { show, options: call[0], choose: call[1] };
}

async function chooseSort(label: string) {
  const menu = await openSortMenu();
  await act(() => menu.choose(menu.options.options.indexOf(label)));
}

test.each(['lista', 'cuadrícula'])(
  'compact sort exposes all existing options and preserves filtered results in %s',
  async (mode) => {
    const data = [
      {
        ...item,
        id: 'a',
        title: 'Podcast Z',
        durationSeconds: 30,
        downloadedAt: '2026-10-01',
      },
      {
        ...item,
        id: 'b',
        title: 'Podcast A',
        durationSeconds: 10,
        downloadedAt: '2026-10-02',
      },
      {
        ...item,
        id: 'c',
        title: 'Podcast M',
        durationSeconds: null,
        downloadedAt: '2026-10-03',
      },
    ];
    jest.mocked(listLibrary).mockResolvedValue(data as never);
    await render(<LibraryScreen />);
    await screen.findByText('Podcast Z');
    if (mode === 'cuadrícula')
      await fireEvent.press(
        screen.getByRole('button', { name: 'Vista de cuadrícula' }),
      );
    await fireEvent.changeText(
      screen.getByLabelText('Buscar en Biblioteca'),
      'Podcast',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Audio' }));
    const button = screen.getByRole('button', { name: 'Orden: Más recientes' });
    expect(button.props.accessibilityValue).toEqual({ text: 'Más recientes' });
    const label = screen.getByText('Orden: Más recientes');
    expect(label.props.allowFontScaling).not.toBe(false);
    expect(label.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      minHeight: 44,
      minWidth: 44,
      maxWidth: '100%',
    });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    let current = 'Más recientes';
    for (const [key, label] of librarySortOptions) {
      const menu = await openSortMenu();
      expect(menu.options.options).toEqual([
        ...librarySortOptions.map(([, name]) => name),
        'Cancelar',
      ]);
      expect(menu.options.cancelButtonIndex).toBe(6);
      expect(menu.options.message).toBe(`Seleccionado: ${current}`);
      await act(() => menu.choose(menu.options.options.indexOf(label)));
      expect(
        screen.getByRole('button', { name: `Orden: ${label}` }).props
          .accessibilityValue,
      ).toEqual({ text: label });
      expect(
        screen
          .getAllByRole('button', { name: /^(Reproducir )?Podcast [AMZ]$/ })
          .map((row) =>
            row.props.accessibilityLabel.replace(/^Reproducir /, ''),
          ),
      ).toEqual(
        selectLibraryItems(data as never, 'Podcast', 'audio', key).map(
          (entry) => entry.title,
        ),
      );
      current = label;
    }
    const before = screen
      .getAllByRole('button', { name: /^(Reproducir )?Podcast [AMZ]$/ })
      .map((row) => row.props.accessibilityLabel);
    const cancel = await openSortMenu();
    await act(() => cancel.choose(cancel.options.cancelButtonIndex!));
    expect(
      screen.getByRole('button', { name: `Orden: ${current}` }),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole('button', { name: /^(Reproducir )?Podcast [AMZ]$/ })
        .map((row) => row.props.accessibilityLabel),
    ).toEqual(before);
    expect(screen.getByLabelText('Buscar en Biblioteca').props.value).toBe(
      'Podcast',
    );
    expect(
      screen.getByRole('button', { name: 'Audio', selected: true }),
    ).toBeTruthy();
    expect(listLibrary).toHaveBeenCalledTimes(1);
    expect(playback.startInContext).not.toHaveBeenCalled();
  },
);

test('sort menu ignores rapid presses, repeated and obsolete callbacks', async () => {
  const view = await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  const first = await openSortMenu();
  await fireEvent.press(screen.getByRole('button', { name: /^Orden: / }));
  expect(first.show).toHaveBeenCalledTimes(1);
  await act(() => {
    first.choose(2);
    first.choose(3);
  });
  expect(
    screen.getByRole('button', { name: 'Orden: Título A–Z' }),
  ).toBeTruthy();
  const second = await openSortMenu();
  await act(() => first.choose(1));
  await fireEvent.press(screen.getByRole('button', { name: /^Orden: / }));
  expect(second.show).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole('tab', { name: 'Colecciones' }));
  mockSection = 'collections';
  await view.rerender(<LibraryScreen />);
  await screen.findByText('Sin colección');
  await act(() => second.choose(1));
  mockSection = 'downloads';
  await view.rerender(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  expect(
    screen.getByRole('button', { name: 'Orden: Título A–Z' }),
  ).toBeTruthy();
  const third = await openSortMenu();
  await view.unmount();
  await act(() => third.choose(1));
  expect(playback.startInContext).not.toHaveBeenCalled();
});

test('sort menu failure leaves selection intact and allows opening again', async () => {
  await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementationOnce(() => {
      throw new Error('native failure');
    });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Orden: Más recientes' }),
  );
  expect(
    screen.getByText(
      'No se pudo abrir el selector de orden. Inténtalo de nuevo.',
    ),
  ).toBeTruthy();
  const menu = await openSortMenu();
  await act(() => menu.choose(1));
  expect(
    screen.getByRole('button', { name: 'Orden: Más antiguos' }),
  ).toBeTruthy();
});

test('query/filter/sort combine locally and explicit playback uses the visible order only', async () => {
  const data = [
    { ...item, id: 'a', title: 'Árbol Podcast', durationSeconds: 30 },
    { ...item, id: 'b', title: 'ÁRBOL entrevista', durationSeconds: 10 },
    {
      ...item,
      id: 'v',
      title: 'Árbol video',
      mediaType: 'video',
      relativeMediaPath: 'Media/v.mp4',
    },
    {
      ...item,
      id: 'missing',
      title: 'Árbol ausente',
      availability: 'missing',
      uri: null,
    },
  ];
  jest.mocked(listLibrary).mockResolvedValue(data as never);
  await render(<LibraryScreen />);
  await screen.findByText('Árbol Podcast');
  await fireEvent.changeText(
    screen.getByLabelText('Buscar en Biblioteca'),
    '  ÁRBOL  ',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Audio' }));
  await chooseSort('Duración ascendente');
  expect(screen.queryByText('Árbol video')).toBeNull();
  expect(screen.getByText('Árbol ausente')).toBeTruthy();
  expect(
    screen.getByRole('button', {
      name: 'Árbol ausente, archivo no disponible',
    }),
  ).toBeDisabled();
  expect(playback.startInContext).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir ÁRBOL entrevista' }),
  );
  await waitFor(() =>
    expect(playback.startInContext).toHaveBeenCalledWith('b', ['b', 'a']),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Buscar en Biblioteca'),
    'Podcast',
  );
  await chooseSort('Título Z–A');
  expect(playback.startInContext).toHaveBeenCalledTimes(1);
  expect(listLibrary).toHaveBeenCalledTimes(1);
});

test('no matches and filter-empty are distinct, and clearing restores the loaded snapshot', async () => {
  await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  await fireEvent.changeText(
    screen.getByLabelText('Buscar en Biblioteca'),
    'inexistente',
  );
  expect(screen.getByText(/No hay coincidencias/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Limpiar búsqueda' }),
  );
  expect(screen.getByText('Podcast largo')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Videos' }));
  expect(screen.getByText('No hay archivos de este tipo.')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Limpiar búsqueda y filtros' }),
  );
  expect(screen.getByText('Podcast largo')).toBeTruthy();
  expect(listLibrary).toHaveBeenCalledTimes(1);
});

test('actual empty Library and read error are not presented as an unsuccessful search', async () => {
  jest.mocked(listLibrary).mockResolvedValue([]);
  const view = await render(<LibraryScreen />);
  await screen.findByText('Tu Biblioteca está vacía.');
  expect(screen.queryByText(/No hay coincidencias/)).toBeNull();
  await view.unmount();
  jest
    .mocked(listLibrary)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  await render(<LibraryScreen />);
  await screen.findByText(
    'No se pudo abrir la Biblioteca. Inténtalo de nuevo.',
  );
  expect(screen.queryByText('Tu Biblioteca está vacía.')).toBeNull();
});

test('view toggle preserves query, filter, sort and playback context without rereading Library', async () => {
  const other = {
    ...item,
    id: '00000000-0000-0000-0000-000000000002',
    title: 'Podcast breve',
  };
  jest.mocked(listLibrary).mockResolvedValue([item, other] as never);
  await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  expect(
    screen.getByRole('button', { name: 'Vista de lista', selected: true }),
  ).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('Buscar en Biblioteca'),
    'PÓDCAST',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Audio' }));
  await chooseSort('Título A–Z');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Vista de cuadrícula' }),
  );
  expect(
    screen.getByRole('button', { name: 'Vista de cuadrícula', selected: true }),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Vista de lista' }));
  expect(screen.getByLabelText('Buscar en Biblioteca').props.value).toBe(
    'PÓDCAST',
  );
  expect(
    screen.getByRole('button', { name: 'Audio', selected: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Orden: Título A–Z' }).props
      .accessibilityValue.text,
  ).toBe('Título A–Z');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Vista de cuadrícula' }),
  );
  expect(listLibrary).toHaveBeenCalledTimes(1);
  expect(playback.startInContext).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir Podcast breve' }),
  );
  expect(playback.startInContext).toHaveBeenCalledWith(other.id, [
    other.id,
    item.id,
  ]);
});

test.each(['audio', 'video'] as const)(
  'compact grid %s keeps cover, two-line title and one guarded action menu',
  async (mediaType) => {
    const fixture = {
      ...item,
      mediaType,
      relativeMediaPath: mediaType === 'video' ? 'Media/a.mp4' : 'Media/a.m4a',
      title:
        'Título muy largo para comprobar una tarjeta compacta sin desbordamiento',
      artworkUri: 'file:///wide-or-tall.jpg',
    };
    const handlers = {
      onOpen: jest.fn(),
      onSave: jest.fn(),
      onShare: jest.fn(),
      onDelete: jest.fn(),
      onCollections: jest.fn(),
      onQueueNext: jest.fn(),
      onQueueLast: jest.fn(),
    };
    const sheet = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => {});
    await render(
      <LibraryItemRow
        layout="grid"
        item={fixture}
        busy={false}
        queueBusy={false}
        {...handlers}
      />,
    );
    expect(screen.getByText(fixture.title).props.numberOfLines).toBe(2);
    expect(screen.getByLabelText('Portada del archivo').props.resizeMode).toBe(
      'contain',
    );
    expect(
      screen.queryByRole('button', { name: 'Guardar en Archivos' }),
    ).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    const menu = () =>
      screen.getByRole('button', { name: `Acciones de ${fixture.title}` });
    await fireEvent.press(menu());
    await fireEvent.press(menu());
    expect(sheet).toHaveBeenCalledTimes(1);
    const labels = [
      'Reproducir a continuación',
      'Añadir al final de la cola',
      'Guardar en Archivos',
      'Compartir',
      'Colecciones',
      'Eliminar',
    ];
    expect(sheet.mock.calls[0]![0].options).toEqual(['Cancelar', ...labels]);
    await act(() => sheet.mock.calls[0]![1](0));
    for (const [index, handler] of [
      handlers.onQueueNext,
      handlers.onQueueLast,
      handlers.onSave,
      handlers.onShare,
      handlers.onCollections,
      handlers.onDelete,
    ].entries()) {
      await fireEvent.press(menu());
      const callback = sheet.mock.calls.at(-1)![1];
      await act(() => {
        callback(index + 1);
        callback(index + 1);
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(fixture);
    }
    expect(handlers.onOpen).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: `Reproducir ${fixture.title}` }),
    );
    expect(handlers.onOpen).toHaveBeenCalledWith(fixture);
    sheet.mockRestore();
  },
);

test('compact grid progress and collection action stay accessible; stale menu callbacks are ignored', async () => {
  const sheet = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation(() => {});
  const actions = {
    onOpen: jest.fn(),
    onSave: jest.fn(),
    onShare: jest.fn(),
    onDelete: jest.fn(),
    onCollections: jest.fn(),
    onQueueNext: jest.fn(),
    onQueueLast: jest.fn(),
    onRemoveFromCollection: jest.fn(),
  };
  const fixture = { ...item, playbackPositionSeconds: 1800 };
  const view = await render(
    <LibraryItemRow
      layout="grid"
      item={fixture}
      busy={false}
      queueBusy={false}
      collectionName="Prueba"
      {...actions}
    />,
  );
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(50);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Acciones de Podcast largo' }),
  );
  expect(sheet.mock.calls[0]![0].options).toContain('Quitar de «Prueba»');
  await act(() => sheet.mock.calls[0]![1](6));
  expect(actions.onRemoveFromCollection).toHaveBeenCalledWith(fixture);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Acciones de Podcast largo' }),
  );
  const stale = sheet.mock.calls[1]![1];
  await view.rerender(
    <LibraryItemRow
      layout="grid"
      item={{ ...fixture, availability: 'missing', uri: null }}
      busy={false}
      queueBusy={false}
      {...actions}
    />,
  );
  await act(() => stale(3));
  expect(actions.onSave).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Acciones de Podcast largo' }),
  );
  const removed = sheet.mock.calls[2]![1];
  await view.unmount();
  await act(() => removed(4));
  expect(actions.onDelete).not.toHaveBeenCalled();
  sheet.mockRestore();
});

test('grid adapts to measured width and preserves missing file restrictions', async () => {
  jest
    .mocked(listLibrary)
    .mockResolvedValue([
      { ...item, availability: 'missing', uri: null },
    ] as never);
  await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Vista de cuadrícula' }),
  );
  await fireEvent(screen.getByTestId('library-downloads'), 'layout', {
    nativeEvent: { layout: { width: 390 } },
  });
  expect(screen.getByTestId(`library-card-${item.id}`).props.style.width).toBe(
    167,
  );
  await fireEvent(screen.getByTestId('library-downloads'), 'layout', {
    nativeEvent: { layout: { width: 300 } },
  });
  expect(screen.getByTestId(`library-card-${item.id}`).props.style.width).toBe(
    '100%',
  );
  expect(
    screen.getByRole('button', {
      name: 'Podcast largo, archivo no disponible',
    }),
  ).toBeDisabled();
  const sheet = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation(() => {});
  await fireEvent.press(
    screen.getByRole('button', { name: 'Acciones de Podcast largo' }),
  );
  const options = sheet.mock.calls[0]![0];
  expect(options.options).toEqual([
    'Cancelar',
    'Guardar en Archivos',
    'Compartir',
    'Colecciones',
    'Eliminar',
  ]);
  expect(options.disabledButtonIndices).toEqual([1, 2]);
  await act(() => sheet.mock.calls[0]![1](1));
  expect(withLibraryLease).not.toHaveBeenCalled();
  expect(playback.startInContext).not.toHaveBeenCalled();
  sheet.mockRestore();
});

test.each(['empty', 'error'])(
  'grid retains the existing %s state without extra reads',
  async (kind) => {
    if (kind === 'empty') jest.mocked(listLibrary).mockResolvedValue([]);
    else jest.mocked(listLibrary).mockRejectedValueOnce(new Error('offline'));
    await render(<LibraryScreen />);
    const message =
      kind === 'empty'
        ? 'Tu Biblioteca está vacía.'
        : 'No se pudo abrir la Biblioteca. Inténtalo de nuevo.';
    await screen.findByText(message);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Vista de cuadrícula' }),
    );
    expect(screen.getByText(message)).toBeTruthy();
    expect(listLibrary).toHaveBeenCalledTimes(1);
  },
);

test('grid keeps video artwork and existing Queue/export actions tied to its ID', async () => {
  const video = {
    ...item,
    mediaType: 'video',
    relativeMediaPath: 'Media/a.mp4',
    artworkUri: 'file:///artwork/a.jpg',
    resolution: '1080p',
  };
  jest.mocked(listLibrary).mockResolvedValue([video] as never);
  await render(<LibraryScreen />);
  await screen.findByText('Podcast largo');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Vista de cuadrícula' }),
  );
  expect(screen.getByLabelText('Portada del archivo').props.source.uri).toBe(
    video.artworkUri,
  );
  expect(screen.getByText(/Video · 1080p/)).toBeTruthy();
  const sheet = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation(() => {});
  await fireEvent.press(
    screen.getByRole('button', { name: 'Acciones de Podcast largo' }),
  );
  await act(() => sheet.mock.calls[0]![1](2));
  expect(enqueueLast).toHaveBeenCalledWith(video.id);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Acciones de Podcast largo' }),
  );
  await act(() => sheet.mock.calls[1]![1](3));
  expect(withLibraryLease).toHaveBeenCalledWith(video.id, expect.any(Function));
  expect(playback.startInContext).not.toHaveBeenCalled();
  sheet.mockRestore();
});

test.each(['downloads', 'collections'] as const)(
  'recovery clears the %s read error after an empty observer refresh',
  async (section) => {
    mockSection = section;
    const read = section === 'downloads' ? listLibrary : listCollections;
    const observe =
      section === 'downloads' ? observeLibrary : observeCollections;
    const message =
      section === 'downloads'
        ? 'No se pudo abrir la Biblioteca. Inténtalo de nuevo.'
        : 'No se pudieron cargar las colecciones.';
    const empty =
      section === 'downloads'
        ? 'Tu Biblioteca está vacía.'
        : 'No hay colecciones todavía.';
    let refresh!: () => void;
    jest.mocked(observe).mockImplementationOnce((listener) => {
      refresh = listener;
      return jest.fn();
    });
    jest
      .mocked(read)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce([]);
    await render(<LibraryScreen />);
    await screen.findByText(message);
    await act(async () => refresh());
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.getByText(empty)).toBeTruthy();
  },
);

test('recovery retries in place and preserves the active query and view', async () => {
  jest.mocked(listLibrary).mockRejectedValueOnce(new Error('read failed'));
  await render(<LibraryScreen />);
  await screen.findByText(
    'No se pudo abrir la Biblioteca. Inténtalo de nuevo.',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Buscar en Biblioteca'),
    'Podcast',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Audio' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Vista de cuadrícula' }),
  );
  await chooseSort('Título A–Z');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reintentar cargar Biblioteca' }),
  );
  await screen.findByText('Podcast largo');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('Buscar en Biblioteca').props.value).toBe(
    'Podcast',
  );
  expect(
    screen.getByRole('button', { name: 'Audio', selected: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Vista de cuadrícula', selected: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Orden: Título A–Z' }),
  ).toBeTruthy();
  expect(mockSetParams).not.toHaveBeenCalled();
  expect(listLibrary).toHaveBeenCalledTimes(2);
});

test('recovery ignores a pending retry failure after switching to Collections', async () => {
  let rejectRetry!: (error: Error) => void;
  jest
    .mocked(listLibrary)
    .mockRejectedValueOnce(new Error('first read failed'))
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        }),
    );
  const view = await render(<LibraryScreen />);
  await screen.findByText(
    'No se pudo abrir la Biblioteca. Inténtalo de nuevo.',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reintentar cargar Biblioteca' }),
  );
  await fireEvent.press(screen.getByRole('tab', { name: 'Colecciones' }));
  expect(mockSetParams).toHaveBeenCalledWith({ section: 'collections' });
  mockSection = 'collections';
  await view.rerender(<LibraryScreen />);
  await screen.findByText('No hay colecciones todavía.');
  await act(async () => rejectRetry(new Error('stale failure')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('No hay colecciones todavía.')).toBeTruthy();
});

test('the Files header offers accessible import with duplicate activation disabled', async () => {
  jest.mocked(startLocalImport).mockImplementation(async () => {
    updateImport({ phase: 'selecting', canRetry: false });
  });
  await render(<LibraryScreen />);
  const button = screen.getByRole('button', { name: 'Importar archivo' });
  await fireEvent.press(button);
  expect(
    screen.getByRole('button', { name: 'Importar archivo' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Importar archivo' }),
  );
  expect(startLocalImport).toHaveBeenCalledTimes(1);
  expect(playback.startInContext).not.toHaveBeenCalled();
});

test('import presents measured preparation, safe cancellation and saving as distinct states', async () => {
  await render(<LibraryScreen />);
  await act(async () => updateImport({ phase: 'preparing', canRetry: false }));
  expect(screen.getByText('Preparando archivo…')).toBeTruthy();
  expect(screen.queryByText(/\d+%/)).toBeNull();
  await act(async () =>
    updateImport({
      phase: 'copying',
      copiedBytes: 25,
      totalBytes: 100,
      canRetry: false,
    }),
  );
  expect(screen.getByText('Copiando archivo… 25%')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar importación' }),
  );
  expect(cancelLocalImport).toHaveBeenCalledTimes(1);
  await act(async () => updateImport({ phase: 'saving', canRetry: false }));
  expect(screen.getByText('Guardando en Biblioteca…')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Cancelar importación' }),
  ).toBeNull();
  await act(async () => updateImport({ phase: 'cancelled', canRetry: false }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Importar archivo' }).props
      .accessibilityState.disabled,
  ).toBe(false);
});

test('a completed hidden import preserves the selected filter, query and grid', async () => {
  await render(<LibraryScreen />);
  await waitFor(() =>
    expect(screen.getByLabelText('Buscar en Biblioteca')).toBeTruthy(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Buscar en Biblioteca'),
    'Podcast',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Videos' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Vista de cuadrícula' }),
  );
  await act(async () =>
    updateImport({
      phase: 'completed',
      item: { ...item, id: 'imported', title: 'Archivo local' } as never,
      canRetry: false,
    }),
  );
  expect(
    screen.getByText(/La búsqueda o los filtros actuales lo ocultan/),
  ).toBeTruthy();
  expect(screen.getByLabelText('Buscar en Biblioteca').props.value).toBe(
    'Podcast',
  );
  expect(
    screen.getByRole('button', { name: 'Videos' }).props.accessibilityState
      .selected,
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: 'Vista de cuadrícula' }).props
      .accessibilityState.selected,
  ).toBe(true);
});

test('a recoverable import failure exposes retry without removing the existing Library', async () => {
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await act(async () =>
    updateImport({
      phase: 'error',
      message: 'No se pudo guardar el archivo.',
      canRetry: true,
    }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo guardar/);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reintentar importación' }),
  );
  expect(retryLocalImport).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Podcast largo')).toBeTruthy();
});

test('import announces phase changes without reading every percentage and restores accessible focus', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  const focus = jest
    .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
    .mockImplementation(() => undefined);
  await render(<LibraryScreen />);
  await waitFor(() => expect(screen.getByText('Podcast largo')).toBeTruthy());
  await act(async () => updateImport({ phase: 'selecting', canRetry: false }));
  await act(async () => updateImport({ phase: 'preparing', canRetry: false }));
  expect(focus).toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Cancelar importación' }),
  ).toBeTruthy();
  await act(async () =>
    updateImport({
      phase: 'copying',
      canRetry: false,
      copiedBytes: 10,
      totalBytes: 100,
    }),
  );
  const calls = announce.mock.calls.length;
  await act(async () =>
    updateImport({
      phase: 'copying',
      canRetry: false,
      copiedBytes: 30,
      totalBytes: 100,
    }),
  );
  expect(announce).toHaveBeenCalledTimes(calls);
  await act(async () =>
    updateImport({ phase: 'completed', canRetry: false, item: item as never }),
  );
  expect(announce).toHaveBeenLastCalledWith('Archivo importado en Biblioteca.');
  expect(focus.mock.calls.at(-1)?.[1]).toBe('focus');
});

test('local completion is explicit, accessible and requires a title decision', async () => {
  jest.mocked(listLibrary).mockResolvedValue([
    {
      ...item,
      sourceKind: 'local',
      relativeMediaPath: 'ImportedMedia/a.m4a',
    },
  ]);
  const api = jest.requireMock('@/services/library');
  let decided: Promise<string> | undefined;
  api.completeExistingLocalMetadata.mockImplementation(
    async (
      _id: string,
      decide: (a: string, b: string) => Promise<string>,
      report: (s: string) => void,
    ) => {
      report('analyzing');
      report('found');
      decided = decide('Old', 'New');
      return (await decided) !== 'cancel';
    },
  );
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<LibraryScreen />);
  expect(api.completeExistingLocalMetadata).not.toHaveBeenCalled();
  await fireEvent.press(
    await screen.findByRole('button', {
      name: 'Completar metadatos de Podcast largo',
    }),
  );
  expect(alert).toHaveBeenCalledWith(
    'Metadatos encontrados',
    expect.any(String),
    expect.any(Array),
    expect.any(Object),
  );
  const buttons = alert.mock.calls.at(-1)![2]!;
  await act(async () => {
    buttons.find((b) => b.text === 'Conservar título')!.onPress!();
  });
  await waitFor(() =>
    expect(screen.getByText('Información completada')).toBeTruthy(),
  );
});

test('cancel title dialog reports cancellation and consumes duplicate callbacks once', async () => {
  jest.mocked(listLibrary).mockResolvedValue([
    {
      ...item,
      sourceKind: 'local',
      relativeMediaPath: 'ImportedMedia/a.m4a',
    },
  ]);
  const api = jest.requireMock('@/services/library');
  api.completeExistingLocalMetadata.mockImplementation(
    async (
      _id: string,
      decide: (a: string, b: string) => Promise<string>,
      report: (s: string) => void,
    ) => {
      report('found');
      return (await decide('Old', 'New')) !== 'cancel';
    },
  );
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<LibraryScreen />);
  await fireEvent.press(
    await screen.findByRole('button', {
      name: 'Completar metadatos de Podcast largo',
    }),
  );
  const buttons = alert.mock.calls.at(-1)![2]!;
  await act(async () => {
    buttons[0]!.onPress!();
    buttons[2]!.onPress!();
  });
  await waitFor(() =>
    expect(screen.getByText('Operación cancelada')).toBeTruthy(),
  );
  expect(screen.queryByText('Información completada')).toBeNull();
  expect(api.completeExistingLocalMetadata).toHaveBeenCalledTimes(1);
});
