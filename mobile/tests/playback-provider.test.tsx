import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import type { LibraryItem } from '@/models/library';
import { PlaybackProvider, usePlayback } from '@/providers/PlaybackProvider';
import { getLibraryItem, observeLibrary } from '@/services/library';
import { playback, type PlaybackState } from '@/services/playback';

jest.mock('@/services/library', () => ({
  getLibraryItem: jest.fn(),
  observeLibrary: jest.fn(),
}));
jest.mock('@/services/playback', () => ({
  playback: {
    getState: jest.fn(),
    subscribe: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
  },
}));

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const C = '00000000-0000-0000-0000-000000000003';

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
const playing = (libraryId: string): PlaybackState => ({
  ...idle,
  libraryId,
  status: 'playing',
  position: 12,
  duration: 120,
  playable: true,
  pipPresentation: 'inline',
});
const item = (id: string): LibraryItem => ({
  id,
  sourceKind: 'youtube',
  title: `Título ${id.at(-1)}`,
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

let current: ReturnType<typeof usePlayback>;
let emit: ((state: PlaybackState) => void) | null;
let appChange: ((state: 'active' | 'background' | 'inactive') => void) | null;
let libraryChange: (() => void) | null;
let removePlayback: jest.Mock;
let removeApp: jest.Mock;
let removeLibrary: jest.Mock;

function Probe({ marker = 'original' }: { marker?: string }) {
  current = usePlayback();
  return (
    <Text testID="probe">{`${marker}:${current.state?.status ?? 'unloaded'}`}</Text>
  );
}

function mount() {
  return render(
    <PlaybackProvider>
      <Probe />
    </PlaybackProvider>,
  );
}

async function mountReady() {
  const view = mount();
  await waitFor(() => expect(playback.subscribe).toHaveBeenCalledTimes(1));
  return view;
}

async function send(next: PlaybackState) {
  await waitFor(() => expect(emit).not.toBeNull());
  await act(async () => {
    emit?.(next);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  current = undefined as unknown as ReturnType<typeof usePlayback>;
  emit = null;
  appChange = null;
  libraryChange = null;
  removePlayback = jest.fn();
  removeApp = jest.fn();
  removeLibrary = jest.fn();
  jest.mocked(playback.getState).mockResolvedValue(idle);
  jest.mocked(playback.subscribe).mockImplementation((listener) => {
    emit = listener;
    return removePlayback;
  });
  jest.mocked(getLibraryItem).mockImplementation(async (id) => item(id));
  jest.mocked(observeLibrary).mockImplementation((listener) => {
    libraryChange = listener;
    return removeLibrary;
  });
  jest.mocked(playback.play).mockResolvedValue(playing(A));
  jest.mocked(playback.pause).mockResolvedValue({
    ...playing(A),
    status: 'paused',
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    appChange = listener as typeof appChange;
    return { remove: removeApp } as never;
  });
});

test('obtains the initial native snapshot; initial idle has no metadata and never autoplays', async () => {
  await mountReady();
  await waitFor(() => expect(current.state).toEqual(idle));
  expect(current.item).toBeNull();
  expect(current.loadingItem).toBe(false);
  expect(getLibraryItem).not.toHaveBeenCalled();
  expect(playback.play).not.toHaveBeenCalled();
  expect(playback.subscribe).toHaveBeenCalledTimes(1);
});

test('resolves active Library metadata from the initial snapshot', async () => {
  jest.mocked(playback.getState).mockResolvedValue(playing(A));
  await mountReady();
  await waitFor(() => expect(current.item?.id).toBe(A));
  expect(current.item?.title).toBe('Título 1');
  expect(current.item?.artworkUri).toBe('file:///local/artwork');
  expect(current.item?.mediaType).toBe('audio');
  expect(current.loadingItem).toBe(false);
});

test('native auto-next A → B resolves B without PlayerScreen mounted', async () => {
  await mountReady();
  await send(playing(A));
  await waitFor(() => expect(current.item?.id).toBe(A));
  await send(playing(B));
  await waitFor(() => expect(current.item?.id).toBe(B));
  expect(getLibraryItem).toHaveBeenCalledWith(B);
});

test('A → B → C ignores a late B metadata response', async () => {
  let resolveB: (value: LibraryItem | null) => void = () => undefined;
  jest.mocked(getLibraryItem).mockImplementation((id) =>
    id === B
      ? new Promise((resolve) => {
          resolveB = resolve;
        })
      : Promise.resolve(item(id)),
  );
  await mountReady();
  await send(playing(A));
  await waitFor(() => expect(current.item?.id).toBe(A));
  await send(playing(B));
  expect(current.item).toBeNull();
  expect(current.loadingItem).toBe(true);
  await send(playing(C));
  await waitFor(() => expect(current.item?.id).toBe(C));
  await act(async () => resolveB(item(B)));
  expect(current.item?.id).toBe(C);
});

test('global native events update status, progress, duration, rate, completion, PiP and errors', async () => {
  await mountReady();
  const next = {
    ...playing(A),
    position: 56,
    duration: 180,
    rate: 1.5,
    completed: true,
    pipPresentation: 'pip' as const,
    errorCode: 'UNAVAILABLE',
  };
  await send(next);
  expect(current.state).toEqual(next);
  await send({ ...next, status: 'paused' });
  expect(current.state?.status).toBe('paused');
});

test('foreground adopts the latest native item; background does not reconcile', async () => {
  await mountReady();
  await waitFor(() => expect(current.state).toEqual(idle));
  jest.mocked(playback.getState).mockResolvedValue(playing(B));
  const reads = jest.mocked(playback.getState).mock.calls.length;
  await act(async () => appChange?.('background'));
  expect(playback.getState).toHaveBeenCalledTimes(reads);
  await act(async () => appChange?.('active'));
  await waitFor(() => expect(current.item?.id).toBe(B));
  expect(current.state?.libraryId).toBe(B);
  expect(playback.play).not.toHaveBeenCalled();
});

test('a pending snapshot cannot overwrite a newer native event', async () => {
  let resolveSnapshot: (value: PlaybackState) => void = () => undefined;
  jest.mocked(playback.getState).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
  );
  await mountReady();
  await send(playing(B));
  await act(async () => resolveSnapshot(playing(A)));
  expect(current.state?.libraryId).toBe(B);
});

test('idle clears the old item and a closed session cannot show stale artwork', async () => {
  await mountReady();
  await send(playing(A));
  await waitFor(() => expect(current.item?.id).toBe(A));
  await send(idle);
  expect(current.item).toBeNull();
  expect(current.loadingItem).toBe(false);
  await send({ ...idle, libraryId: A });
  expect(current.item).toBeNull();
});

test('missing Library item keeps native playback state without metadata', async () => {
  jest.mocked(getLibraryItem).mockResolvedValue(null);
  await mountReady();
  await send(playing(A));
  await waitFor(() => expect(current.loadingItem).toBe(false));
  expect(current.state?.libraryId).toBe(A);
  expect(current.item).toBeNull();
});

test('Library lookup failure is contained and never exposes a raw error', async () => {
  jest
    .mocked(getLibraryItem)
    .mockRejectedValue(new Error('file:///private/var/secret'));
  await mountReady();
  await send(playing(A));
  await waitFor(() => expect(current.loadingItem).toBe(false));
  expect(current.state?.libraryId).toBe(A);
  expect(current.item).toBeNull();
});

test('Library changes refresh local artwork for the same active item', async () => {
  await mountReady();
  await send(playing(A));
  await waitFor(() => expect(current.item?.id).toBe(A));
  jest.mocked(getLibraryItem).mockResolvedValue({
    ...item(A),
    artworkUri: 'file:///local/new-artwork',
  });
  await act(async () => libraryChange?.());
  await waitFor(() =>
    expect(current.item?.artworkUri).toBe('file:///local/new-artwork'),
  );
});

test('commands delegate to the existing playback service without another queue', async () => {
  await mountReady();
  await send(playing(A));
  await act(async () => {
    await current.pause();
  });
  expect(playback.pause).toHaveBeenCalledTimes(1);
  expect(current.state?.status).toBe('paused');
  await act(async () => {
    await current.togglePlayPause();
  });
  expect(playback.play).toHaveBeenCalledTimes(1);
  expect(current.state?.status).toBe('playing');
});

test('idle toggle is a no-op and rerender does not duplicate subscriptions', async () => {
  const view = await mountReady();
  await waitFor(() => expect(current.state).toEqual(idle));
  await act(async () => {
    expect(await current.togglePlayPause()).toBeNull();
  });
  await act(async () => {
    view.rerender(
      <PlaybackProvider>
        <Probe marker="rerendered" />
      </PlaybackProvider>,
    );
  });
  expect(screen.getByTestId('probe').props.children).toBe('rerendered:idle');
  expect(playback.subscribe).toHaveBeenCalledTimes(1);
  expect(playback.play).not.toHaveBeenCalled();
});

test('unmount removes playback, AppState, and Library subscriptions', async () => {
  const view = await mountReady();
  await send(playing(A));
  await waitFor(() => expect(current.item?.id).toBe(A));
  await act(async () => view.unmount());
  expect(removePlayback).toHaveBeenCalledTimes(1);
  expect(removeApp).toHaveBeenCalledTimes(1);
  expect(removeLibrary).toHaveBeenCalledTimes(1);
});
