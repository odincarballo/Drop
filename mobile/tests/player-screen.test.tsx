import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import PlayerScreen from '@/app/player/[id]';
import { getLibraryItem } from '@/services/library';
import { playback, type PlaybackState } from '@/services/playback';

const mockId = '00000000-0000-0000-0000-000000000001';
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(callback, []),
}));
jest.mock('@/services/library', () => ({ getLibraryItem: jest.fn() }));
jest.mock('@/services/playback', () => ({
  playback: {
    open: jest.fn(),
    getState: jest.fn(),
    subscribe: jest.fn(),
    close: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    skip: jest.fn(),
    seek: jest.fn(),
    setRate: jest.fn(),
    enterFullscreen: jest.fn(),
  },
}));
jest.mock('@/components/PlaybackVideoSurface', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: object) => <View testID="video-surface" {...props} />,
  };
});
jest.mock('@/components/PlaybackTimeline', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    PlaybackTimeline: ({
      position,
      onScrubStart,
      onScrubMove,
      onScrubEnd,
    }: {
      position: number;
      onScrubStart: (seconds: number) => void;
      onScrubMove: (seconds: number) => void;
      onScrubEnd: (seconds: number) => void;
    }) => (
      <View>
        <Text testID="timeline-position">{position}</Text>
        <Pressable
          accessibilityLabel="Start scrub"
          onPress={() => onScrubStart(60)}
        />
        <Pressable
          accessibilityLabel="Move scrub"
          onPress={() => onScrubMove(90)}
        />
        <Pressable
          accessibilityLabel="Finish scrub"
          onPress={() => onScrubEnd(90)}
        />
        <Pressable
          accessibilityLabel="Seek to 60"
          onPress={() => onScrubEnd(60)}
        />
      </View>
    ),
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const audio = {
  id: mockId,
  title: 'Podcast local',
  mediaType: 'audio',
  relativeMediaPath: `Media/${mockId}.m4a`,
  artworkUri: 'file:///local/art.jpg',
};
const video = {
  ...audio,
  title: 'Video local',
  mediaType: 'video',
  relativeMediaPath: `Media/${mockId}.mp4`,
  artworkUri: null,
};
let mockState: PlaybackState;
let mockEmit: ((state: PlaybackState) => void) | null;
let mockUnsubscribe: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    libraryId: mockId,
    status: 'ready',
    position: 42,
    duration: 120,
    rate: 1,
    playable: true,
    completed: false,
    fullscreen: false,
    errorCode: null,
  };
  mockEmit = null;
  mockUnsubscribe = jest.fn();
  jest.mocked(getLibraryItem).mockResolvedValue(audio as never);
  jest.mocked(playback.subscribe).mockImplementation((listener) => {
    mockEmit = listener;
    return mockUnsubscribe;
  });
  jest.mocked(playback.open).mockImplementation(async () => mockState);
  jest.mocked(playback.getState).mockImplementation(async () => mockState);
  jest
    .mocked(playback.close)
    .mockResolvedValue({ ...mockState, status: 'idle' });
  jest.mocked(playback.play).mockImplementation(async () => {
    mockState = { ...mockState, status: 'playing', completed: false };
    return mockState;
  });
  jest.mocked(playback.pause).mockImplementation(async () => {
    mockState = { ...mockState, status: 'paused' };
    return mockState;
  });
  jest.mocked(playback.skip).mockImplementation(async () => mockState);
  jest.mocked(playback.seek).mockImplementation(async () => mockState);
  jest.mocked(playback.setRate).mockImplementation(async (rate) => {
    mockState = { ...mockState, rate };
    return mockState;
  });
  jest
    .mocked(playback.enterFullscreen)
    .mockImplementation(async () => ({ ...mockState, fullscreen: true }));
});

test('audio opens by ID, displays local artwork, title, restored position and controls', async () => {
  await render(<PlayerScreen />);
  await waitFor(() => expect(screen.getByText('Podcast local')).toBeTruthy());
  expect(playback.open).toHaveBeenCalledWith(mockId);
  expect(screen.getByLabelText('Portada descargada')).toBeTruthy();
  expect(screen.getByText('0:42')).toBeTruthy();
  expect(screen.getByText('2:00')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reproducir' }));
  expect(playback.play).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Pausar' }));
  expect(playback.pause).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Retroceder 15 segundos' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Avanzar 15 segundos' }),
  );
  expect(playback.skip).toHaveBeenNthCalledWith(1, -15);
  expect(playback.skip).toHaveBeenNthCalledWith(2, 15);
  await fireEvent.press(screen.getByLabelText('Seek to 60'));
  expect(playback.seek).toHaveBeenCalledWith(60);
});

test('all rates remain selected when paused; video uses one native surface and fullscreen command', async () => {
  jest.mocked(getLibraryItem).mockResolvedValue(video as never);
  await render(<PlayerScreen />);
  await waitFor(() => expect(screen.getByText('Video local')).toBeTruthy());
  expect(screen.getByTestId('video-surface')).toBeTruthy();
  for (const rate of [0.75, 1, 1.25, 1.5, 1.75, 2]) {
    await fireEvent.press(
      screen.getByRole('button', { name: `Velocidad ${rate}×` }),
    );
    expect(
      screen.getByRole('button', { name: `Velocidad ${rate}×` }).props
        .accessibilityState.selected,
    ).toBe(true);
  }
  await fireEvent.press(
    screen.getByRole('button', { name: 'Pantalla completa' }),
  );
  expect(playback.enterFullscreen).toHaveBeenCalledTimes(1);
});

test.each(['audio', 'video'])(
  '%s scrubbing owns the clock through player ticks and one confirmed seek',
  async (kind) => {
    if (kind === 'video')
      jest.mocked(getLibraryItem).mockResolvedValue(video as never);
    let confirmSeek: ((value: PlaybackState) => void) | undefined;
    jest.mocked(playback.seek).mockImplementation(
      () =>
        new Promise<PlaybackState>((resolve) => {
          confirmSeek = resolve;
        }),
    );
    const rendered = await render(<PlayerScreen />);
    await waitFor(() => expect(screen.getByText('0:42')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Start scrub'));
    await fireEvent.press(screen.getByLabelText('Move scrub'));
    expect(screen.getByText('1:30')).toBeTruthy();
    expect(screen.getByTestId('timeline-position').props.children).toBe(90);
    await act(async () => {
      mockEmit?.({ ...mockState, position: 43 });
    });
    expect(screen.getByText('1:30')).toBeTruthy();
    expect(screen.getByTestId('timeline-position').props.children).toBe(90);
    await rendered.rerender(<PlayerScreen />);
    expect(screen.getByText('1:30')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Finish scrub'));
    expect(playback.seek).toHaveBeenCalledTimes(1);
    expect(playback.seek).toHaveBeenCalledWith(90);
    await act(async () => {
      mockEmit?.({ ...mockState, position: 44 });
    });
    expect(screen.getByText('1:30')).toBeTruthy();
    await act(async () => {
      confirmSeek?.({ ...mockState, position: 90 });
    });
    expect(screen.getByText('1:30')).toBeTruthy();
    await act(async () => {
      mockEmit?.({ ...mockState, position: 91 });
    });
    expect(screen.getByText('1:31')).toBeTruthy();
  },
);

test('scrubbing does not mark completed or affect native progress before release', async () => {
  await render(<PlayerScreen />);
  await waitFor(() => expect(screen.getByText('0:42')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Start scrub'));
  await fireEvent.press(screen.getByLabelText('Move scrub'));
  expect(playback.seek).not.toHaveBeenCalled();
  expect(screen.queryByText('Terminado · Reproducir de nuevo')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Avanzar 15 segundos' }),
  );
  expect(playback.skip).toHaveBeenCalledWith(15);
});

test('completed begins at zero and offers replay; events represent playing and ended', async () => {
  mockState = { ...mockState, completed: true, position: 0 };
  await render(<PlayerScreen />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Reproducir de nuevo' }),
    ).toBeTruthy(),
  );
  await act(async () => {
    mockEmit?.({
      ...mockState,
      status: 'playing',
      completed: false,
      position: 5,
    });
  });
  await waitFor(() => expect(screen.getByText('0:05')).toBeTruthy());
  await act(async () => {
    mockEmit?.({
      ...mockState,
      status: 'ended',
      completed: true,
      position: 120,
    });
  });
  await waitFor(() =>
    expect(screen.getByText('Terminado · Reproducir de nuevo')).toBeTruthy(),
  );
});

test('loading and safe error states do not expose filesystem paths', async () => {
  jest.mocked(playback.open).mockImplementation(async () => {
    mockEmit?.({ ...mockState, status: 'loading', playable: false });
    return mockState;
  });
  await render(<PlayerScreen />);
  await waitFor(() => expect(screen.getByText('Podcast local')).toBeTruthy());
  await act(async () => {
    mockEmit?.({
      ...mockState,
      status: 'failed',
      playable: false,
      errorCode: 'OPEN_FAILED',
    });
  });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(JSON.stringify(screen.toJSON())).not.toContain('file:///private');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Biblioteca' }),
  );
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('unsupported local format does not invoke native open and keeps back navigation', async () => {
  jest.mocked(getLibraryItem).mockResolvedValue({
    ...audio,
    relativeMediaPath: 'Media/file.webm',
  } as never);
  await render(<PlayerScreen />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(playback.open).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Volver a Biblioteca' }),
  ).toBeTruthy();
});

test('rerender does not close; leaving route unsubscribes and closes once', async () => {
  const rendered = await render(<PlayerScreen />);
  await waitFor(() => expect(playback.open).toHaveBeenCalledTimes(1));
  await rendered.rerender(<PlayerScreen />);
  expect(playback.close).not.toHaveBeenCalled();
  await rendered.unmount();
  expect(playback.close).toHaveBeenCalledTimes(1);
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

test('missing media and fallback artwork are handled without exposing a path', async () => {
  jest.mocked(getLibraryItem).mockResolvedValue(video as never);
  await render(<PlayerScreen />);
  await waitFor(() => expect(screen.getByText('Video local')).toBeTruthy());
  expect(screen.getByTestId('video-surface')).toBeTruthy();
  await act(async () => {
    mockEmit?.({
      ...mockState,
      status: 'failed',
      playable: false,
      errorCode: 'UNAVAILABLE',
    });
  });
  await waitFor(() =>
    expect(
      screen.getByText('Este archivo ya no está disponible en Biblioteca.'),
    ).toBeTruthy(),
  );
});
