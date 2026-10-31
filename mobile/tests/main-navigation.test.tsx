import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Keyboard, StyleSheet, type KeyboardEvent } from 'react-native';
import { ExpoRoot, router } from 'expo-router';
import { getMockContext } from 'expo-router/testing-library';

import RootLayout from '@/app/_layout';
import LandingScreen from '@/app/index';
import LibraryScreen from '@/app/library';
import DownloadScreen from '@/app/download';
import QueueScreen from '@/app/queue';
import CollectionScreen from '@/app/collections/[id]';
import UncollectedScreen from '@/app/collections/uncollected';
import PlayerScreen from '@/app/player/[id]';
import SettingsScreen from '@/app/settings';
import { usePlayback } from '@/providers/PlaybackProvider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEME_PREFERENCE_KEY } from '@/theme';
import { useDownloadSession } from '@/providers/DownloadSessionProvider';
import { analyzeMedia } from '@/services/media';
import { createDownloadJob, downloadJobFile } from '@/services/jobs';
import {
  initializeLibrary,
  promoteToLibrary,
  getLibraryItem,
} from '@/services/library';
import { playback, type PlaybackState } from '@/services/playback';
import type { LibraryItem } from '@/models/library';
import type { MediaAnalysis } from '@/models/media';
import { listQueue } from '@/services/queue';

const mockInsets = { top: 20, bottom: 34, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({
  ...require('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => mockInsets,
}));
jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: jest.fn(() => null),
}));
jest.mock('@/services/media', () => ({ analyzeMedia: jest.fn() }));
jest.mock('@/services/jobs', () => ({
  createDownloadJob: jest.fn(),
  downloadJobFile: jest.fn(),
  deleteDownloadJob: jest.fn(async () => undefined),
  shareLocalFile: jest.fn(),
  deleteLocalFile: jest.fn(),
}));
jest.mock('@/services/library', () => ({
  initializeLibrary: jest.fn(async () => undefined),
  listLibrary: jest.fn(async () => [mockItem]),
  getLibraryItem: jest.fn(async () => mockItem),
  observeLibrary: jest.fn(() => jest.fn()),
  promoteToLibrary: jest.fn(),
}));
jest.mock('@/services/collections', () => ({
  listCollections: jest.fn(async () => [
    { id: 'fixtures', name: 'Mi colección', itemCount: 1 },
  ]),
  countUncollectedItems: jest.fn(async () => 0),
  observeCollections: jest.fn(() => jest.fn()),
  getCollection: jest.fn(async () => ({
    id: 'fixtures',
    name: 'Mi colección',
  })),
  listCollectionItems: jest.fn(async () => [mockItem]),
  listUncollectedItems: jest.fn(async () => []),
}));
jest.mock('@/services/queue', () => ({
  listQueue: jest.fn(async () => [
    {
      id: 'occurrence',
      itemId: mockItem.id,
      position: 0,
      addedAt: '2026-10-31T12:00:00Z',
    },
  ]),
  observeQueue: jest.fn(() => jest.fn()),
  observeQueuePlaybackSync: jest.fn(() => jest.fn()),
  getQueuePlaybackSyncState: jest.fn(() => ({ status: 'applied' })),
}));
jest.mock('@/services/fileExport', () => ({
  cleanupAbandonedFilesAtStartup: jest.fn(),
  saveLocalFileToFiles: jest.fn(),
}));
jest.mock('@/services/token', () => ({
  getApiToken: jest.fn(async () => null),
}));
jest.mock('@/services/playback', () => ({
  playback: {
    getState: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    subscribeRestore: jest.fn(() => jest.fn()),
    leavePlayerScreen: jest.fn(async () => undefined),
    close: jest.fn(),
    open: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    startInContext: jest.fn(),
    completePiPRestore: jest.fn(),
  },
}));
jest.mock('@/components/PlaybackVideoSurface', () => ({
  __esModule: true,
  default: () => null,
}));

const mockItem: LibraryItem & { uri: string } = {
  id: '00000000-0000-0000-0000-000000000001',
  sourceKind: 'youtube',
  title: 'Audio actual',
  mediaType: 'audio',
  relativeMediaPath: 'Media/current.m4a',
  relativeArtworkPath: null,
  sizeBytes: 12,
  availability: 'available',
  mediaSizeOnDisk: 12,
  artworkSizeBytes: 0,
  downloadedAt: '2026-10-31T12:00:00Z',
  playbackPositionSeconds: 37,
  completedAt: null,
  lifecycle: 'ready',
  uri: 'file:///library/current.m4a',
  artworkUri: null,
  durationSeconds: 200,
};
const mockPlaying: PlaybackState = {
  libraryId: mockItem.id,
  status: 'playing',
  position: 37,
  duration: 200,
  rate: 1,
  playable: true,
  completed: false,
  fullscreen: false,
  pipPresentation: 'inline',
  pipSupported: false,
  pipAvailable: false,
  errorCode: null,
};
const downloadMedia: MediaAnalysis = {
  id: 'direct-media',
  title: 'Archivo nuevo',
  source: 'direct',
  thumbnail: null,
  duration: 200,
  estimatedSize: 12,
  audioFormats: [],
  videoFormats: [
    {
      id: 'original',
      resolution: 'Original',
      container: 'mp4',
      codec: null,
      hasAudio: true,
      estimatedSize: 12,
    },
  ],
};
let playbackSnapshot: ReturnType<typeof usePlayback>;
function LibraryRoute() {
  playbackSnapshot = usePlayback();
  return <LibraryScreen />;
}
function LandingRoute() {
  playbackSnapshot = usePlayback();
  return <LandingScreen />;
}
let session: ReturnType<typeof useDownloadSession>;
function DownloadRoute() {
  playbackSnapshot = usePlayback();
  session = useDownloadSession();
  return <DownloadScreen />;
}
const context = getMockContext({
  _layout: RootLayout,
  index: LandingRoute,
  library: LibraryRoute,
  download: DownloadRoute,
  queue: QueueScreen,
  'collections/[id]': CollectionScreen,
  'collections/uncollected': UncollectedScreen,
  'player/[id]': PlayerScreen,
  settings: SettingsScreen,
});
async function openApp(path = '/') {
  const view = await render(
    <ExpoRoot context={context} location={new URL(path, 'http://localhost')} />,
  );
  await screen.findByRole('tab', { name: 'Biblioteca' });
  return view;
}
async function tab(label: 'Biblioteca' | 'Descargar') {
  await fireEvent.press(screen.getByRole('tab', { name: label }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(analyzeMedia).mockReset().mockResolvedValue(downloadMedia);
  jest.mocked(playback.getState).mockResolvedValue(mockPlaying);
  jest.mocked(playback.startInContext).mockResolvedValue(mockPlaying);
  jest.mocked(playback.open).mockResolvedValue(mockPlaying);
  jest.mocked(promoteToLibrary).mockResolvedValue(mockItem);
});

test('Library opens directly, primary sections replace history and keep a single player/provider', async () => {
  await openApp();
  expect(
    screen.getByRole('tab', { name: 'Biblioteca' }).props.accessibilityState
      .selected,
  ).toBe(true);
  expect(screen.getAllByTestId('mini-player')).toHaveLength(1);
  for (let count = 0; count < 4; count++) {
    await tab('Descargar');
    expect(
      screen.getByRole('tab', { name: 'Descargar' }).props.accessibilityState
        .selected,
    ).toBe(true);
    expect(screen.getByLabelText('URL del recurso multimedia')).toBeTruthy();
    await tab('Biblioteca');
    expect(
      screen.getByRole('tab', { name: 'Biblioteca' }).props.accessibilityState
        .selected,
    ).toBe(true);
    expect(screen.getAllByTestId('mini-player')).toHaveLength(1);
    expect(router.canGoBack()).toBe(false);
  }
  expect(initializeLibrary).toHaveBeenCalledTimes(1);
  expect(playback.subscribe).toHaveBeenCalledTimes(1);
  expect(playback.getState).toHaveBeenCalledTimes(1);
  expect(playback.close).not.toHaveBeenCalled();
  expect(playback.pause).not.toHaveBeenCalled();
  expect(playback.open).not.toHaveBeenCalled();
});

test.each(['/', '/library', '/download'])(
  'direct route %s resolves with the correct section',
  async (path) => {
    await openApp(path);
    const selected = path === '/download' ? 'Descargar' : 'Biblioteca';
    expect(
      screen.getByRole('tab', { name: selected }).props.accessibilityState
        .selected,
    ).toBe(true);
    expect(router.canGoBack()).toBe(false);
    expect(screen.queryByLabelText('URL del recurso multimedia') !== null).toBe(
      path === '/download',
    );
  },
);

async function analyzeDirect() {
  await fireEvent.changeText(
    screen.getByLabelText('URL del recurso multimedia'),
    'https://example.com/clip.mp4',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));
}

test('analysis continues through real router replacements and returns the same result', async () => {
  const pending = deferred<MediaAnalysis>();
  jest.mocked(analyzeMedia).mockReturnValueOnce(pending.promise);
  await openApp('/download');
  await analyzeDirect();
  const signal = jest.mocked(analyzeMedia).mock.calls[0]![1]!;
  await tab('Biblioteca');
  expect(signal.aborted).toBe(false);
  await act(() => pending.resolve(downloadMedia));
  await tab('Descargar');
  expect(screen.getByText('Archivo nuevo')).toBeTruthy();
  expect(
    screen.getByLabelText('URL del recurso multimedia'),
  ).toHaveDisplayValue('https://example.com/clip.mp4');
  expect(analyzeMedia).toHaveBeenCalledTimes(1);
  expect(initializeLibrary).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  'active download retains selection/progress and opens safely (missing=%s)',
  async (missing) => {
    const transfer = deferred<{ uri: string; size: number }>();
    jest.mocked(createDownloadJob).mockResolvedValue({
      id: 'active-job',
      status: 'COMPLETED',
      progress: 1,
      bytesDownloaded: 12,
      totalBytes: 12,
      fileName: 'clip.mp4',
      fileSize: 12,
      error: null,
      downloadUrl: '/jobs/active-job/file',
    });
    jest.mocked(downloadJobFile).mockReturnValue(transfer.promise);
    await openApp('/download');
    await analyzeDirect();
    await fireEvent.press(screen.getByRole('radio', { name: /Original/ }));
    const selection =
      session.state.status === 'success' ? session.state.selection : null;
    await fireEvent.press(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(downloadJobFile).toHaveBeenCalledTimes(1));
    await tab('Biblioteca');
    await act(() => jest.mocked(downloadJobFile).mock.calls[0]![2](6, 12));
    expect(jest.mocked(downloadJobFile).mock.calls[0]![1].aborted).toBe(false);
    await tab('Descargar');
    expect(session.state).toMatchObject({ selection });
    expect(session.download.state).toMatchObject({
      status: 'transferring',
      bytesDownloaded: 6,
    });
    await tab('Biblioteca');
    await act(() =>
      transfer.resolve({ uri: 'file:///cache/new.mp4', size: 12 }),
    );
    await tab('Descargar');
    expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
    expect(createDownloadJob).toHaveBeenCalledTimes(1);
    expect(promoteToLibrary).toHaveBeenCalledTimes(1);
    expect(session.download.state).toMatchObject({ libraryId: mockItem.id });
    if (missing)
      jest.mocked(getLibraryItem).mockResolvedValueOnce({
        ...mockItem,
        availability: 'missing',
        uri: null,
      });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Abrir archivo' }),
    );
    if (missing) {
      await screen.findByText(
        'Este archivo ya no está disponible o no se puede reproducir.',
      );
      expect(playback.open).not.toHaveBeenCalled();
      expect(playback.startInContext).not.toHaveBeenCalled();
      return;
    }
    expect(playback.startInContext).toHaveBeenCalledWith(mockItem.id, [
      mockItem.id,
    ]);
    await screen.findByRole('button', { name: 'Volver a Biblioteca' });
    expect(screen.queryByTestId('mini-player')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Volver a Biblioteca' }),
    );
    await screen.findByTestId('main-navigation');
    await tab('Biblioteca');
    await fireEvent.changeText(
      screen.getByLabelText('Buscar en Biblioteca'),
      'ÁUDIO actual',
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Título A–Z' }));
    expect(
      screen.getByRole('button', { name: 'Reproducir Audio actual' }),
    ).toBeTruthy();
    expect(screen.getAllByTestId('mini-player')).toHaveLength(1);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Reproducir Audio actual' }),
    );
    expect(playback.startInContext).toHaveBeenCalledWith(mockItem.id, [
      mockItem.id,
    ]);
    expect(playback.subscribe).toHaveBeenCalledTimes(3); // root and two explicit Player visits
    expect(playback.close).not.toHaveBeenCalled();
  },
);

test('opening and leaving the full player preserves CURRENT and uses leavePlayerScreen', async () => {
  await openApp();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Abrir reproductor de Audio actual' }),
  );
  await screen.findByRole('button', { name: 'Volver a Biblioteca' });
  expect(screen.queryByTestId('mini-player')).toBeNull();
  expect(screen.queryByTestId('main-navigation')).toBeNull();
  expect(playback.open).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Biblioteca' }),
  );
  await screen.findByTestId('mini-player');
  expect(playback.leavePlayerScreen).toHaveBeenCalledWith(mockItem.id);
  expect(playback.close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Pausar' })).toBeTruthy();
  expect(playback.getState).toHaveReturned();
  expect(playbackSnapshot.state).toMatchObject({
    libraryId: mockItem.id,
    status: 'playing',
    position: 37,
  });
  expect(playback.subscribe).toHaveBeenCalledTimes(2); // root provider + the player route, then released
});

test('Queue and Collections remain secondary routes with the existing data', async () => {
  await openApp();
  await fireEvent.press(screen.getByRole('button', { name: 'Ver cola' }));
  await waitFor(() => expect(listQueue).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('main-navigation')).toBeNull();
  expect(screen.getAllByTestId('mini-player')).toHaveLength(1);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Biblioteca' }),
  );
  await screen.findByRole('tab', { name: 'Colecciones' });
  await fireEvent.press(screen.getByRole('tab', { name: 'Colecciones' }));
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Abrir colección Mi colección' }),
  );
  expect(
    await screen.findByRole('header', { name: 'Mi colección' }),
  ).toBeTruthy();
  expect(screen.queryByTestId('main-navigation')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Colecciones' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Abrir colección Mi colección' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('tab', { name: 'Colecciones' }).props.accessibilityState
      .selected,
  ).toBe(true);
  expect(playback.close).not.toHaveBeenCalled();
});

test('footer orders one MiniPlayer above navigation and owns the bottom safe area', async () => {
  await openApp('/download');
  await screen.findByTestId('mini-player');
  const footer = screen.getByTestId('app-footer');
  expect(
    footer.children.map((child) =>
      typeof child === 'string' ? child : child.props.testID,
    ),
  ).toEqual(['mini-player', 'main-navigation']);
  expect(
    StyleSheet.flatten(screen.getByTestId('main-navigation').props.style)
      .paddingBottom,
  ).toBe(34);
  expect(
    StyleSheet.flatten(screen.getByTestId('mini-player').props.style)
      .paddingBottom,
  ).toBe(8);
});

test('keyboard hides the footer, restores it on dismiss and releases subscriptions', async () => {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>();
  const realAddListener = Keyboard.addListener.bind(Keyboard);
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(listener);
    const subscription = realAddListener(name, listener);
    const remove = subscription.remove.bind(subscription);
    subscription.remove = () => {
      listeners.get(name)!.delete(listener);
      remove();
    };
    return subscription;
  });
  const view = await openApp('/download');
  const event: KeyboardEvent = {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { screenX: 0, screenY: 300, width: 320, height: 300 },
    startCoordinates: { screenX: 0, screenY: 600, width: 320, height: 0 },
    isEventFromThisApp: true,
  };
  await act(() =>
    listeners.get('keyboardWillShow')?.forEach((callback) => callback(event)),
  );
  expect(screen.queryByTestId('main-navigation')).toBeNull();
  expect(screen.queryByTestId('mini-player')).toBeNull();
  expect(screen.getByLabelText('URL del recurso multimedia')).toBeTruthy();
  await act(() =>
    listeners.get('keyboardWillHide')?.forEach((callback) => callback(event)),
  );
  expect(screen.getByTestId('main-navigation')).toBeTruthy();
  expect(screen.getAllByTestId('mini-player')).toHaveLength(1);
  await view.unmount();
  expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(
    true,
  );
});

test.each(['light', 'dark', 'system'] as const)(
  'shared navigation respects %s appearance',
  async (mode) => {
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, mode);
    jest
      .spyOn(require('react-native'), 'useColorScheme')
      .mockReturnValue('dark');
    await openApp();
    expect(
      StyleSheet.flatten(screen.getByTestId('app-footer').props.style)
        .backgroundColor,
    ).toBe(mode === 'light' ? '#F7F7F7' : '#1A1A1A');
    await tab('Descargar');
    expect(
      StyleSheet.flatten(screen.getByTestId('app-footer').props.style)
        .backgroundColor,
    ).toBe(mode === 'light' ? '#F7F7F7' : '#1A1A1A');
  },
);

test('Settings remains secondary and back returns to the previous main section', async () => {
  await openApp('/download');
  await fireEvent.press(screen.getByRole('button', { name: 'Ajustes' }));
  expect(await screen.findByRole('header', { name: 'Ajustes' })).toBeTruthy();
  expect(screen.queryByTestId('main-navigation')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Inicio' }),
  );
  expect(
    screen.getByRole('tab', { name: 'Descargar' }).props.accessibilityState
      .selected,
  ).toBe(true);
  expect(playback.close).not.toHaveBeenCalled();
});

test('selecting the current Library tab preserves its Collections section', async () => {
  await openApp('/library');
  await fireEvent.press(screen.getByRole('tab', { name: 'Colecciones' }));
  await screen.findByRole('button', { name: 'Abrir colección Mi colección' });
  await tab('Biblioteca');
  expect(
    screen.getByRole('tab', { name: 'Colecciones' }).props.accessibilityState
      .selected,
  ).toBe(true);
  expect(router.canGoBack()).toBe(false);
});
