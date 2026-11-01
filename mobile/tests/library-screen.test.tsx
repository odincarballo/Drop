import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

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

beforeEach(() => {
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

test.each(['lista', 'cuadrícula'])(
  'sort controls wrap without horizontal scrolling and keep selection accessible in %s',
  async (mode) => {
    await render(<LibraryScreen />);
    await screen.findByText('Podcast largo');
    if (mode === 'cuadrícula') {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Vista de cuadrícula' }),
      );
    }
    await fireEvent.changeText(
      screen.getByLabelText('Buscar en Biblioteca'),
      'Podcast',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Audio' }));
    const group = screen.getByLabelText('Orden de Biblioteca');
    expect(group.props.horizontal).not.toBe(true);
    expect(StyleSheet.flatten(group.props.style)).toMatchObject({
      flexDirection: 'row',
      flexWrap: 'wrap',
    });
    const labels = [
      'Más recientes',
      'Más antiguos',
      'Título A–Z',
      'Título Z–A',
      'Duración ascendente',
      'Duración descendente',
    ];
    expect(screen.getAllByRole('radio')).toHaveLength(labels.length);
    expect(
      screen.getByRole('radio', { name: labels[0] }).props.accessibilityState
        .checked,
    ).toBe(true);
    for (const label of labels) {
      const control = screen.getByRole('radio', { name: label });
      expect(StyleSheet.flatten(control.props.style)).toMatchObject({
        minHeight: 44,
        maxWidth: '100%',
      });
      await fireEvent.press(control);
      for (const candidate of labels) {
        expect(
          screen.getByRole('radio', { name: candidate }).props
            .accessibilityState.checked,
        ).toBe(candidate === label);
      }
    }
    expect(screen.getByLabelText('Buscar en Biblioteca').props.value).toBe(
      'Podcast',
    );
    expect(
      screen.getByRole('button', { name: 'Audio', selected: true }),
    ).toBeTruthy();
    expect(screen.getByText('Podcast largo')).toBeTruthy();
    expect(listLibrary).toHaveBeenCalledTimes(1);
    expect(playback.startInContext).not.toHaveBeenCalled();
  },
);

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
  await fireEvent.press(
    screen.getByRole('radio', { name: 'Duración ascendente' }),
  );
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
  await fireEvent.press(screen.getByRole('radio', { name: 'Título Z–A' }));
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
  await fireEvent.press(screen.getByRole('radio', { name: 'Título A–Z' }));
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
    screen.getByRole('radio', { name: 'Título A–Z' }).props.accessibilityState
      .checked,
  ).toBe(true);
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
  expect(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Compartir' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Eliminar' })).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Colecciones de Podcast largo' }),
  ).toBeEnabled();
  expect(playback.startInContext).not.toHaveBeenCalled();
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
  expect(screen.getByLabelText('Portada descargada').props.source.uri).toBe(
    video.artworkUri,
  );
  expect(screen.getByText(/Video · 1080p/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Añadir al final de la cola: Podcast largo',
    }),
  );
  expect(enqueueLast).toHaveBeenCalledWith(video.id);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  );
  expect(withLibraryLease).toHaveBeenCalledWith(video.id, expect.any(Function));
  expect(playback.startInContext).not.toHaveBeenCalled();
});
