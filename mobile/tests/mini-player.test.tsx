import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MiniPlayer } from '@/components/MiniPlayer';
import type { LibraryItem } from '@/models/library';
import { usePlayback } from '@/providers/PlaybackProvider';
import { playback, type PlaybackState } from '@/services/playback';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const mockPush = jest.fn();
let mockPathname = '/';
let mockInsets = { top: 0, right: 0, bottom: 34, left: 0 };
let mockColors = {
  background: '#FFFFFF',
  surface: '#F7F7F7',
  text: '#151515',
  secondary: '#656565',
  border: '#E5E5E5',
  accent: '#111111',
  onAccent: '#FFFFFF',
};

jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('expo-symbols', () => {
  const { Text } = require('react-native');
  return {
    SymbolView: ({ name }: { name: string }) => (
      <Text testID="transport-icon">{name}</Text>
    ),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));
jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: mockColors }),
}));
jest.mock('@/providers/PlaybackProvider', () => ({ usePlayback: jest.fn() }));
jest.mock('@/services/playback', () => ({
  playback: { subscribe: jest.fn() },
}));

const idle: PlaybackState = {
  libraryId: null,
  status: 'idle',
  position: 0,
  duration: null,
  rate: 1,
  playable: false,
  completed: false,
  fullscreen: false,
  pipPresentation: 'closed',
  pipSupported: false,
  pipAvailable: false,
  errorCode: null,
};
const playing = (id: string): PlaybackState => ({
  ...idle,
  libraryId: id,
  status: 'playing',
  playable: true,
  pipPresentation: 'inline',
});
const item = (id: string, title = 'Audio local'): LibraryItem => ({
  id,
  sourceKind: 'youtube',
  title,
  mediaType: 'audio',
  relativeMediaPath: `Media/${id}.m4a`,
  relativeArtworkPath: `Artwork/${id}.jpg`,
  sizeBytes: 100,
  artworkSizeBytes: 20,
  downloadedAt: '2026-10-21T00:00:00Z',
  playbackPositionSeconds: 0,
  completedAt: null,
  lifecycle: 'ready',
  uri: 'file:///local/media',
  artworkUri: 'file:///local/artwork',
});

const mockToggle = jest.fn<Promise<PlaybackState | null>, []>();
let mockValue: ReturnType<typeof usePlayback>;

function setPlayback(
  state: PlaybackState | null,
  activeItem: LibraryItem | null,
  loadingItem = false,
) {
  mockValue = {
    state,
    item: activeItem,
    loadingItem,
    play: jest.fn(),
    pause: jest.fn(),
    togglePlayPause: mockToggle,
  };
  jest.mocked(usePlayback).mockImplementation(() => mockValue);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/';
  mockInsets = { top: 0, right: 0, bottom: 34, left: 0 };
  mockColors = {
    background: '#FFFFFF',
    surface: '#F7F7F7',
    text: '#151515',
    secondary: '#656565',
    border: '#E5E5E5',
    accent: '#111111',
    onAccent: '#FFFFFF',
  };
  mockToggle.mockResolvedValue(playing(A));
  setPlayback(idle, null);
});

test('idle or no active Library item renders nothing', async () => {
  await render(<MiniPlayer />);
  expect(screen.queryByTestId('mini-player')).toBeNull();
});

test('playing on Home shows the current title and local artwork', async () => {
  setPlayback(playing(A), item(A));
  await render(<MiniPlayer />);
  await waitFor(() => expect(screen.getByTestId('mini-player')).toBeTruthy());
  expect(screen.getByText('Audio local')).toBeTruthy();
  expect(screen.getByLabelText('Portada descargada').props.source).toEqual({
    uri: 'file:///local/artwork',
  });
  expect(screen.getByTestId('transport-icon').props.children).toBe(
    'pause.fill',
  );
});

test('artwork without a local URI uses the Drop fallback with contain framing', async () => {
  setPlayback(playing(A), { ...item(A), artworkUri: null });
  await render(<MiniPlayer />);
  const artwork = screen.getByLabelText('Portada de Drop');
  expect(artwork.props.source).not.toEqual({ uri: 'file:///local/artwork' });
  expect(artwork.props.resizeMode).toBe('contain');
});

test('paused, ready and ended sessions show Play; playing shows Pause', async () => {
  setPlayback({ ...playing(A), status: 'paused' }, item(A));
  const view = await render(<MiniPlayer />);
  expect(screen.getByLabelText('Reproducir')).toBeTruthy();
  for (const status of ['ready', 'ended'] as const) {
    setPlayback({ ...playing(A), status }, item(A));
    await view.rerender(<MiniPlayer />);
    expect(screen.getByLabelText('Reproducir')).toBeTruthy();
  }
  setPlayback(playing(A), item(A));
  await view.rerender(<MiniPlayer />);
  expect(screen.getByLabelText('Pausar')).toBeTruthy();
});

test('transport delegates once to togglePlayPause and never navigates', async () => {
  setPlayback(playing(A), item(A));
  await render(<MiniPlayer />);
  await act(async () => fireEvent.press(screen.getByLabelText('Pausar')));
  expect(mockToggle).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});

test('rapid transport taps cannot submit duplicate commands', async () => {
  let finish: (value: PlaybackState) => void = () => undefined;
  mockToggle.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  setPlayback(playing(A), item(A));
  await render(<MiniPlayer />);
  const control = screen.getByLabelText('Pausar');
  await act(async () => {
    const first = fireEvent.press(control);
    const second = fireEvent.press(control);
    finish(playing(A));
    await Promise.all([first, second]);
  });
  expect(mockToggle).toHaveBeenCalledTimes(1);
});

test('a failed transport command does not crash or navigate', async () => {
  mockToggle.mockRejectedValue(new Error('native failure'));
  setPlayback(playing(A), item(A));
  await render(<MiniPlayer />);
  await fireEvent.press(screen.getByLabelText('Pausar'));
  expect(screen.getByTestId('mini-player')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

test('the main button opens the active player, separately from transport', async () => {
  setPlayback(playing(A), item(A));
  await render(<MiniPlayer />);
  await fireEvent.press(
    screen.getByLabelText('Abrir reproductor de Audio local'),
  );
  expect(mockPush).toHaveBeenCalledWith(`/player/${A}`);
  expect(mockToggle).not.toHaveBeenCalled();
});

test('auto-next updates title and navigation target from A to B', async () => {
  setPlayback(playing(A), item(A, 'Tema A'));
  const view = await render(<MiniPlayer />);
  setPlayback(playing(B), item(B, 'Tema B'));
  await view.rerender(<MiniPlayer />);
  expect(screen.queryByText('Tema A')).toBeNull();
  expect(screen.getByText('Tema B')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Abrir reproductor de Tema B'));
  expect(mockPush).toHaveBeenCalledWith(`/player/${B}`);
});

test('loading B metadata never exposes A title or artwork', async () => {
  setPlayback(playing(A), item(A, 'Tema A'));
  const view = await render(<MiniPlayer />);
  setPlayback(playing(B), item(A, 'Tema A'), true);
  await view.rerender(<MiniPlayer />);
  expect(screen.queryByTestId('mini-player')).toBeNull();
  expect(screen.queryByText('Tema A')).toBeNull();
});

test('native idle immediately removes a previously visible mini-player', async () => {
  setPlayback(playing(A), item(A));
  const view = await render(<MiniPlayer />);
  setPlayback(idle, null);
  await view.rerender(<MiniPlayer />);
  expect(screen.queryByTestId('mini-player')).toBeNull();
});

test('player route and fullscreen hide the mini-player', async () => {
  setPlayback(playing(A), item(A));
  mockPathname = `/player/${A}`;
  const view = await render(<MiniPlayer />);
  expect(screen.queryByTestId('mini-player')).toBeNull();
  mockPathname = '/library';
  setPlayback({ ...playing(A), fullscreen: true }, item(A));
  await view.rerender(<MiniPlayer />);
  expect(screen.queryByTestId('mini-player')).toBeNull();
});

test.each(['/', '/library', '/collections/example', '/settings'])(
  'non-player route %s shows the mini-player',
  async (path) => {
    mockPathname = path;
    setPlayback(playing(A), item(A));
    await render(<MiniPlayer />);
    expect(screen.getByTestId('mini-player')).toBeTruthy();
  },
);

test('PiP on Library remains visible without trying to restore PiP', async () => {
  mockPathname = '/library';
  setPlayback({ ...playing(A), pipPresentation: 'pip' }, item(A));
  await render(<MiniPlayer />);
  expect(screen.getByTestId('mini-player')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

test('theme colors and bottom safe-area inset shape the container', async () => {
  setPlayback(playing(A), item(A));
  const view = await render(<MiniPlayer />);
  let style = StyleSheet.flatten(screen.getByTestId('mini-player').props.style);
  expect(style.backgroundColor).toBe('#F7F7F7');
  expect(style.borderTopColor).toBe('#E5E5E5');
  expect(style.paddingBottom).toBe(34);
  mockColors = {
    ...mockColors,
    background: '#0C0C0C',
    surface: '#1A1A1A',
    text: '#FAFAFA',
    border: '#343434',
    accent: '#FAFAFA',
  };
  mockInsets = { ...mockInsets, bottom: 0 };
  await view.rerender(<MiniPlayer />);
  style = StyleSheet.flatten(screen.getByTestId('mini-player').props.style);
  expect(style.backgroundColor).toBe('#1A1A1A');
  expect(style.paddingBottom).toBe(8);
});

test('accessibility labels are distinct and long titles truncate to one line', async () => {
  const title = 'Título extremadamente largo de una descarga guardada en Drop';
  setPlayback(playing(A), item(A, title));
  await render(<MiniPlayer />);
  expect(
    screen.getByLabelText(`Abrir reproductor de ${title}`).props
      .accessibilityRole,
  ).toBe('button');
  expect(screen.getByLabelText('Pausar').props.accessibilityRole).toBe(
    'button',
  );
  const titleNode = screen.getByText(title);
  expect(titleNode.props.numberOfLines).toBe(1);
  expect(titleNode.props.ellipsizeMode).toBe('tail');
});

test('mini-player consumes provider state without direct playback subscription', async () => {
  setPlayback(playing(A), item(A));
  await render(<MiniPlayer />);
  expect(usePlayback).toHaveBeenCalled();
  expect(playback.subscribe).not.toHaveBeenCalled();
});
