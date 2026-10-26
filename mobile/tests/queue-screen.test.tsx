import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState, StyleSheet, type AppStateStatus } from 'react-native';

import QueueScreen from '@/app/queue';
import type { LibraryItem } from '@/models/library';
import type { QueueEntry } from '@/models/queue';
import { usePlayback } from '@/providers/PlaybackProvider';
import { getLibraryItem, observeLibrary } from '@/services/library';
import * as queue from '@/services/queue';
import { ThemeProvider, THEME_PREFERENCE_KEY } from '@/theme';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('@/providers/PlaybackProvider', () => ({ usePlayback: jest.fn() }));
jest.mock('@/services/library', () => ({
  getLibraryItem: jest.fn(),
  observeLibrary: jest.fn(),
}));
jest.mock('@/services/queue', () => ({
  listQueue: jest.fn(),
  observeQueue: jest.fn(),
  getQueuePlaybackSyncState: jest.fn(),
  observeQueuePlaybackSync: jest.fn(),
  moveQueueEntry: jest.fn(),
  removeQueueEntry: jest.fn(),
  clearQueue: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function media(id: string, title: string): LibraryItem {
  return {
    id,
    title,
    sourceKind: 'direct',
    mediaType: 'audio',
    relativeMediaPath: `Media/${id}.m4a`,
    relativeArtworkPath: null,
    sizeBytes: 100,
    artworkSizeBytes: 0,
    downloadedAt: '2026-10-26T00:00:00Z',
    playbackPositionSeconds: 0,
    completedAt: null,
    lifecycle: 'ready',
    uri: `file:///library/${id}.m4a`,
    artworkUri: null,
  };
}
function entry(id: string, itemId: string, position: number): QueueEntry {
  return { id, itemId, position, addedAt: '2026-10-26T00:00:00Z' };
}
let rows: QueueEntry[];
let metadata: Map<string, LibraryItem>;
let sync: queue.QueuePlaybackSyncState;
let queueListeners: Set<() => void>;
let libraryListeners: Set<() => void>;
let syncListeners: Set<() => void>;
let appListener: ((state: AppStateStatus) => void) | null;
let stopQueue: jest.Mock,
  stopLibrary: jest.Mock,
  stopSync: jest.Mock,
  stopApp: jest.Mock;

function emit(listeners: Set<() => void>) {
  for (const listener of listeners) listener();
}
async function loaded() {
  await waitFor(() =>
    expect(screen.queryByLabelText('Cargando cola')).toBeNull(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  rows = [entry('x', 'a', 0), entry('y', 'b', 1)];
  metadata = new Map([
    ['a', media('a', 'Canción A')],
    ['b', media('b', 'Canción B')],
  ]);
  sync = { status: 'applied', lastResult: 'applied' };
  queueListeners = new Set();
  libraryListeners = new Set();
  syncListeners = new Set();
  appListener = null;
  stopQueue = jest.fn();
  stopLibrary = jest.fn();
  stopSync = jest.fn();
  stopApp = jest.fn();
  jest.mocked(queue.listQueue).mockImplementation(async () => [...rows]);
  jest
    .mocked(queue.getQueuePlaybackSyncState)
    .mockImplementation(() => ({ ...sync }));
  jest.mocked(queue.observeQueue).mockImplementation((listener) => {
    queueListeners.add(listener);
    return () => {
      stopQueue();
      queueListeners.delete(listener);
    };
  });
  jest.mocked(queue.observeQueuePlaybackSync).mockImplementation((listener) => {
    syncListeners.add(listener);
    return () => {
      stopSync();
      syncListeners.delete(listener);
    };
  });
  jest.mocked(observeLibrary).mockImplementation((listener) => {
    libraryListeners.add(listener);
    return () => {
      stopLibrary();
      libraryListeners.delete(listener);
    };
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    appListener = listener;
    return { remove: stopApp };
  });
  jest
    .mocked(getLibraryItem)
    .mockImplementation(async (id) => metadata.get(id) ?? null);
  jest.mocked(queue.removeQueueEntry).mockImplementation(async (id) => {
    rows = rows
      .filter((row) => row.id !== id)
      .map((row, position) => ({ ...row, position }));
    emit(queueListeners);
  });
  jest.mocked(queue.moveQueueEntry).mockResolvedValue(undefined);
  jest.mocked(queue.clearQueue).mockImplementation(async () => {
    rows = [];
    emit(queueListeners);
  });
  jest.mocked(usePlayback).mockReturnValue({
    state: {
      libraryId: 'current',
      status: 'playing',
      position: 42,
      duration: 100,
      rate: 1.5,
      playable: true,
      completed: false,
      fullscreen: false,
      pipPresentation: 'inline',
      pipSupported: true,
      pipAvailable: true,
      errorCode: null,
    },
    item: media('current', 'Actual'),
    loadingItem: false,
    play: jest.fn(),
    pause: jest.fn(),
    togglePlayPause: jest.fn(),
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

test('CURRENT comes from PlaybackProvider and pending rows follow position', async () => {
  rows = [entry('x', 'a', 1), entry('y', 'b', 0)];
  await render(<QueueScreen />);
  await loaded();
  expect(
    screen.getByRole('header', { name: 'Reproduciendo ahora' }),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('queue-current')).getByText('Actual'),
  ).toBeTruthy();
  expect(screen.getByText('Reproduciendo')).toBeTruthy();
  expect(
    within(screen.getByTestId('queue-entry-y')).getByText('1'),
  ).toBeTruthy();
  expect(getLibraryItem).not.toHaveBeenCalledWith('current');
  expect(queue.listQueue).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Biblioteca' }),
  );
  expect(mockReplace).toHaveBeenCalledWith('/library');
});

test('duplicate occurrences have independent rows and only their entry ID is removed', async () => {
  rows = [entry('x', 'a', 0), entry('y', 'a', 1)];
  await render(<QueueScreen />);
  await loaded();
  expect(screen.getAllByText('Canción A')).toHaveLength(2);
  expect(getLibraryItem).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Quitar entrada 2: Canción A' }),
  );
  await waitFor(() => expect(screen.queryByTestId('queue-entry-y')).toBeNull());
  expect(queue.removeQueueEntry).toHaveBeenCalledWith('y');
  expect(screen.getByTestId('queue-entry-x')).toBeTruthy();
  expect(screen.getByText('Actual')).toBeTruthy();
});

test('explicit move controls use entry IDs and enforce boundaries', async () => {
  await render(<QueueScreen />);
  await loaded();
  expect(
    screen.getByRole('button', { name: 'Subir entrada 1: Canción A' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: 'Bajar entrada 2: Canción B' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Bajar entrada 1: Canción A' }),
  );
  await waitFor(() =>
    expect(queue.moveQueueEntry).toHaveBeenCalledWith('x', 1),
  );
  await act(async () => {
    rows = [entry('y', 'b', 0), entry('x', 'a', 1)];
    emit(queueListeners);
  });
  await loaded();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Subir entrada 2: Canción A' }),
  );
  await waitFor(() =>
    expect(queue.moveQueueEntry).toHaveBeenLastCalledWith('x', 0),
  );
});

test('clear requires confirmation and never removes CURRENT', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<QueueScreen />);
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: 'Vaciar cola' }));
  expect(queue.clearQueue).not.toHaveBeenCalled();
  alert.mock.calls[0]?.[2]
    ?.find((button) => button.text === 'Cancelar')
    ?.onPress?.();
  expect(queue.clearQueue).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Vaciar cola' }));
  await act(async () =>
    alert.mock.calls[1]?.[2]
      ?.find((button) => button.text === 'Vaciar')
      ?.onPress?.(),
  );
  await waitFor(() =>
    expect(screen.getByText(/La cola está vacía/)).toBeTruthy(),
  );
  expect(queue.clearQueue).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Actual')).toBeTruthy();
});

test('a saved pending ACK stays a discreet pending notice, not a save error or native success', async () => {
  let release!: () => void;
  jest.mocked(queue.removeQueueEntry).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await render(<QueueScreen />);
  await loaded();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Quitar entrada 1: Canción A' }),
  );
  await act(async () => {
    sync = { status: 'pending', lastResult: 'failed' };
    emit(syncListeners);
    release();
  });
  await waitFor(() =>
    expect(
      screen.getByText('Guardado en la cola. Actualizando reproducción…'),
    ).toBeTruthy(),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Cola guardada.')).toBeNull();
  await act(async () => {
    sync = { status: 'applied', lastResult: 'applied' };
    emit(syncListeners);
  });
  expect(screen.getByText('Cola guardada.')).toBeTruthy();
});

test('a persistence failure is distinct and does not expose a native path', async () => {
  jest
    .mocked(queue.moveQueueEntry)
    .mockRejectedValueOnce(new Error('file:///private/library.sqlite'));
  await render(<QueueScreen />);
  await loaded();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Bajar entrada 1: Canción A' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      /No se pudo guardar el cambio/,
    ),
  );
  expect(screen.queryByText(/file:\/\//)).toBeNull();
  expect(screen.getByTestId('queue-entry-x')).toBeTruthy();
});

test('native consumption and a CURRENT change update separately without reopening anything', async () => {
  const view = await render(<QueueScreen />);
  await loaded();
  await act(async () => {
    rows = [entry('y', 'b', 0)];
    emit(queueListeners);
  });
  await waitFor(() => expect(screen.queryByTestId('queue-entry-x')).toBeNull());
  const provider = jest.mocked(usePlayback).mock.results.at(-1)!.value;
  jest.mocked(usePlayback).mockReturnValue({
    ...provider,
    state: { ...provider.state!, libraryId: 'a', status: 'paused' },
    item: media('a', 'Canción A'),
  });
  await view.rerender(<QueueScreen />);
  expect(
    within(screen.getByTestId('queue-current')).getByText('Canción A'),
  ).toBeTruthy();
  expect(screen.getByText('En pausa')).toBeTruthy();
  expect(queue.listQueue).toHaveBeenCalledTimes(2);
});

test('Library Delete during reorder does not resurrect a removed occurrence', async () => {
  let release!: () => void;
  jest.mocked(queue.moveQueueEntry).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await render(<QueueScreen />);
  await loaded();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Bajar entrada 1: Canción A' }),
  );
  await act(async () => {
    rows = [entry('y', 'b', 0)];
    metadata.delete('a');
    emit(libraryListeners);
    emit(queueListeners);
  });
  await waitFor(() => expect(screen.queryByTestId('queue-entry-x')).toBeNull());
  await act(async () => release());
  expect(screen.queryByText('Canción A')).toBeNull();
  expect(screen.getByText('Canción B')).toBeTruthy();
});

test('an old list response cannot overwrite a newer native event result', async () => {
  let old!: (rows: QueueEntry[]) => void;
  jest.mocked(queue.listQueue).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        old = resolve;
      }),
  );
  await render(<QueueScreen />);
  await waitFor(() => expect(queue.listQueue).toHaveBeenCalledTimes(1));
  await act(async () => {
    rows = [entry('y', 'b', 0)];
    emit(queueListeners);
  });
  await waitFor(() => expect(screen.getByText('Canción B')).toBeTruthy());
  await act(async () => old([entry('x', 'a', 0)]));
  expect(screen.queryByText('Canción A')).toBeNull();
  expect(getLibraryItem).not.toHaveBeenCalledWith('a');
});

test('late metadata cannot overwrite a refreshed Queue', async () => {
  let old!: (item: LibraryItem | null) => void;
  rows = [entry('x', 'a', 0)];
  jest.mocked(getLibraryItem).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        old = resolve;
      }),
  );
  await render(<QueueScreen />);
  await waitFor(() => expect(getLibraryItem).toHaveBeenCalledWith('a'));
  await act(async () => {
    rows = [entry('y', 'b', 0)];
    emit(queueListeners);
  });
  await waitFor(() => expect(screen.getByText('Canción B')).toBeTruthy());
  await act(async () => old(media('a', 'Obsoleto')));
  expect(screen.queryByText('Obsoleto')).toBeNull();
});

test('metadata failures preserve removable occurrences and support retry', async () => {
  jest.mocked(getLibraryItem).mockImplementationOnce(async () => {
    throw new Error('/private/path');
  });
  await render(<QueueScreen />);
  await loaded();
  expect(screen.getByText('Información no disponible')).toBeTruthy();
  expect(
    screen.getByRole('button', {
      name: 'Quitar entrada 1: Información no disponible',
    }),
  ).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reintentar cargar la cola' }),
  );
  await waitFor(() => expect(screen.getByText('Canción A')).toBeTruthy());
  expect(screen.queryByText('/private/path')).toBeNull();
});

test('foreground refreshes missed consumption and invalidates metadata; background does not query', async () => {
  await render(<QueueScreen />);
  await loaded();
  await act(async () => appListener?.('background'));
  expect(queue.listQueue).toHaveBeenCalledTimes(1);
  rows = [entry('y', 'b', 0)];
  metadata.set('b', media('b', 'Título actualizado'));
  await act(async () => appListener?.('active'));
  await waitFor(() =>
    expect(screen.getByText('Título actualizado')).toBeTruthy(),
  );
  expect(screen.queryByTestId('queue-entry-x')).toBeNull();
});

test('empty Queue and empty Library remain usable without CURRENT', async () => {
  rows = [];
  metadata.clear();
  const value = jest.mocked(usePlayback).mock.results.at(-1)?.value;
  jest.mocked(usePlayback).mockReturnValue({
    ...value,
    state: null,
    item: null,
    loadingItem: false,
  } as never);
  await render(<QueueScreen />);
  await loaded();
  expect(screen.getByText('Sin reproducción activa.')).toBeTruthy();
  expect(screen.getByText(/La cola está vacía/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Vaciar cola' }).props.accessibilityState
      .disabled,
  ).toBe(true);
});

test('list failure has a safe retry and does not report an empty Queue', async () => {
  jest.mocked(queue.listQueue).mockRejectedValueOnce(new Error('/private/db'));
  await render(<QueueScreen />);
  await loaded();
  expect(screen.getByRole('alert')).toHaveTextContent(
    /No se pudo cargar la cola/,
  );
  expect(screen.queryByText(/La cola está vacía/)).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reintentar cargar la cola' }),
  );
  await waitFor(() => expect(screen.getByText('Canción A')).toBeTruthy());
});

test('observers clean up, and a new subscription reads consumption missed offscreen', async () => {
  const view = await render(<QueueScreen />);
  await loaded();
  await view.unmount();
  expect(stopQueue).toHaveBeenCalledTimes(1);
  expect(stopSync).toHaveBeenCalledTimes(1);
  expect(stopLibrary).toHaveBeenCalledTimes(1);
  expect(stopApp).toHaveBeenCalledTimes(1);
  expect(queueListeners.size + libraryListeners.size + syncListeners.size).toBe(
    0,
  );
  rows = [];
  await render(<QueueScreen />);
  await loaded();
  expect(screen.getByText(/La cola está vacía/)).toBeTruthy();
});

test('synchronous data signals coalesce while sync notices do not reload SQLite', async () => {
  await render(<QueueScreen />);
  await loaded();
  await act(async () => {
    sync = { status: 'pending', lastResult: null };
    emit(syncListeners);
  });
  expect(queue.listQueue).toHaveBeenCalledTimes(1);
  await act(async () => {
    emit(queueListeners);
    emit(libraryListeners);
    emit(queueListeners);
  });
  await loaded();
  expect(queue.listQueue).toHaveBeenCalledTimes(2);
  expect(getLibraryItem).toHaveBeenCalledTimes(4);
});

test('rapid removal presses submit once while awaiting the ACK', async () => {
  let release!: () => void;
  jest.mocked(queue.removeQueueEntry).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await render(<QueueScreen />);
  await loaded();
  const button = screen.getByRole('button', {
    name: 'Quitar entrada 1: Canción A',
  });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(queue.removeQueueEntry).toHaveBeenCalledTimes(1);
  await act(async () => release());
});

test('missing metadata preserves the pending entry and allows retry/removal', async () => {
  metadata.delete('a');
  await render(<QueueScreen />);
  await loaded();
  expect(screen.getByText('Archivo no disponible')).toBeTruthy();
  expect(
    screen.getByRole('button', {
      name: 'Quitar entrada 1: Archivo no disponible',
    }),
  ).toBeTruthy();
  metadata.set('a', media('a', 'Disponible otra vez'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reintentar cargar la cola' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Disponible otra vez')).toBeTruthy(),
  );
});

test('late metadata and AppState callbacks after unmount do not load or update the view', async () => {
  let finish!: (item: LibraryItem | null) => void;
  rows = [entry('x', 'a', 0)];
  jest.mocked(getLibraryItem).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = await render(<QueueScreen />);
  await waitFor(() => expect(getLibraryItem).toHaveBeenCalledWith('a'));
  const callback = appListener;
  await view.unmount();
  await act(async () => {
    finish(media('a', 'Tardío'));
    callback?.('active');
    emit(queueListeners);
  });
  expect(queue.listQueue).toHaveBeenCalledTimes(1);
  expect(queueListeners.size + syncListeners.size + libraryListeners.size).toBe(
    0,
  );
});

test('artwork falls back safely and a new URI can load without an effect reset', async () => {
  metadata.set('a', {
    ...media('a', 'Canción A'),
    artworkUri: 'file:///art/one.jpg',
  });
  await render(<QueueScreen />);
  await loaded();
  const artwork = screen.getByLabelText('Portada de Canción A');
  expect(artwork.props.source).toEqual({ uri: 'file:///art/one.jpg' });
  await fireEvent(artwork, 'error');
  expect(
    screen.getByLabelText('Portada de Canción A').props.source,
  ).not.toEqual({ uri: 'file:///art/one.jpg' });
  await act(async () => {
    metadata.set('a', {
      ...media('a', 'Canción A'),
      artworkUri: 'file:///art/two.jpg',
    });
    emit(libraryListeners);
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Portada de Canción A').props.source).toEqual({
      uri: 'file:///art/two.jpg',
    }),
  );
});

test('long titles keep full accessible labels and controls keep touch targets', async () => {
  const title = 'Título largo '.repeat(20);
  metadata.set('a', media('a', title));
  await render(<QueueScreen />);
  await loaded();
  const row = screen.getByTestId('queue-entry-x');
  expect(within(row).getByText(title).props.numberOfLines).toBe(2);
  const button = screen.getByRole('button', {
    name: `Quitar entrada 1: ${title}`,
  });
  expect(
    StyleSheet.flatten(button.props.style).minHeight,
  ).toBeGreaterThanOrEqual(44);
  expect(
    StyleSheet.flatten(button.props.style).minWidth,
  ).toBeGreaterThanOrEqual(44);
});

test.each(['light', 'dark'] as const)(
  'Queue uses the %s theme',
  async (mode) => {
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, mode);
    await render(
      <ThemeProvider>
        <QueueScreen />
      </ThemeProvider>,
    );
    await loaded();
    await waitFor(() =>
      expect(
        StyleSheet.flatten(screen.getByTestId('queue-screen').props.style)
          .backgroundColor,
      ).toBe(mode === 'dark' ? '#0C0C0C' : '#FFFFFF'),
    );
  },
);
