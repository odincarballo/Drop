jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const id = '00000000-0000-0000-0000-000000000001';
const state = {
  libraryId: id,
  status: 'ready',
  position: 42,
  duration: 120,
  rate: 1,
  playable: true,
  completed: false,
  fullscreen: false,
  errorCode: null,
  uri: 'file:///private/secret.mp4',
};

let eventListener: ((value: unknown) => void) | null = null;
const remove = jest.fn();
const native = {
  open: jest.fn(async () => state),
  play: jest.fn(async () => ({ ...state, status: 'playing' })),
  pause: jest.fn(async () => ({ ...state, status: 'paused' })),
  seek: jest.fn(async () => state),
  skip: jest.fn(async () => state),
  setRate: jest.fn(async () => state),
  close: jest.fn(async () => ({ ...state, status: 'idle' })),
  getState: jest.fn(async () => state),
  enterFullscreen: jest.fn(async () => ({ ...state, fullscreen: true })),
  exitFullscreen: jest.fn(async () => state),
  beginDelete: jest.fn(async () => ({ ready: true })),
  endDelete: jest.fn(async () => ({ ready: true })),
  addListener: jest.fn((_event: string, listener: (value: unknown) => void) => {
    eventListener = listener;
    return { remove };
  }),
};

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  eventListener = null;
  (
    require('expo') as { requireOptionalNativeModule: jest.Mock }
  ).requireOptionalNativeModule.mockReturnValue(native);
});

test('open uses only a library ID and returns a whitelisted state', async () => {
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  const result = await playback.open(id);
  expect(native.open).toHaveBeenCalledWith(id);
  expect(result).toEqual({
    libraryId: id,
    status: 'ready',
    position: 42,
    duration: 120,
    rate: 1,
    playable: true,
    completed: false,
    fullscreen: false,
    errorCode: null,
  });
  expect(JSON.stringify(result)).not.toContain('file://');
});

test('arbitrary paths and URLs cannot cross the playback bridge', async () => {
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  await expect(playback.open('file:///private/secret.mp4')).rejects.toThrow();
  await expect(
    playback.open('https://example.com/video.mp4'),
  ).rejects.toThrow();
  expect(native.open).not.toHaveBeenCalled();
});

test('commands are serialized, including delete barrier', async () => {
  const calls: string[] = [];
  let release!: () => void;
  native.open.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => {
          calls.push('open');
          resolve(state);
        };
      }),
  );
  native.beginDelete.mockImplementationOnce(async () => {
    calls.push('delete');
    return { ready: true };
  });
  const service =
    require('@/services/playback') as typeof import('@/services/playback');
  const opened = service.playback.open(id);
  const deleting = service.beginPlaybackDeletion(id);
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toEqual([]);
  release();
  await Promise.all([opened, deleting]);
  expect(calls).toEqual(['open', 'delete']);
});

test('a rejected command does not block later commands', async () => {
  native.seek.mockRejectedValueOnce(new Error('invalid position'));
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  await expect(playback.seek(Number.NaN)).rejects.toThrow();
  expect((await playback.getState()).libraryId).toBe(id);
});

test('events whitelist data and unsubscribe removes listener', () => {
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  const listener = jest.fn();
  const unsubscribe = playback.subscribe(listener);
  eventListener?.(state);
  expect(listener).toHaveBeenCalledWith(
    expect.not.objectContaining({ uri: expect.anything() }),
  );
  eventListener?.({
    ...state,
    libraryId: 'file:///secret',
    errorCode: 'TOKEN=abc',
  });
  expect(listener.mock.calls[1][0].libraryId).toBeNull();
  expect(listener.mock.calls[1][0].errorCode).toBeNull();
  unsubscribe();
  expect(remove).toHaveBeenCalledTimes(1);
});
