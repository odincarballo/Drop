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
  pipPresentation: 'inline',
  pipSupported: true,
  pipAvailable: true,
  errorCode: null,
  uri: 'file:///private/secret.mp4',
};

let eventListener: ((value: unknown) => void) | null = null;
const remove = jest.fn();
const native = {
  queueDidChange: jest.fn(async () => ({ status: 'applied' })),
  open: jest.fn(async () => state),
  startInContext: jest.fn(async () => ({ ...state, status: 'loading' })),
  play: jest.fn(async () => ({ ...state, status: 'playing' })),
  pause: jest.fn(async () => ({ ...state, status: 'paused' })),
  seek: jest.fn(async () => state),
  skip: jest.fn(async () => state),
  setRate: jest.fn(async () => state),
  close: jest.fn(async () => ({ ...state, status: 'idle' })),
  getState: jest.fn(async () => state),
  enterFullscreen: jest.fn(async () => ({ ...state, fullscreen: true })),
  exitFullscreen: jest.fn(async () => state),
  startPiP: jest.fn(async () => ({ ...state, pipPresentation: 'pipStarting' })),
  leavePlayerScreen: jest.fn(async () => state),
  completePiPRestore: jest.fn(async () => state),
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
    pipPresentation: 'inline',
    pipSupported: true,
    pipAvailable: true,
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

test('context start sends only ordered IDs, then starts before route navigation', async () => {
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  const next = '00000000-0000-0000-0000-000000000002';
  const result = await playback.startInContext(id, [id, next]);
  expect(native.startInContext).toHaveBeenCalledWith(id, [id, next]);
  expect(result.status).toBe('loading');
  expect(JSON.stringify(result)).not.toContain('file://');
  await expect(playback.startInContext(id, [next])).rejects.toThrow();
  await expect(playback.startInContext(id, [id, id])).rejects.toThrow();
  await expect(
    playback.startInContext(id, [id, 'file:///private/secret.mp4']),
  ).rejects.toThrow();
});

test('context IDs are snapshotted before the serialized native call', async () => {
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  const next = '00000000-0000-0000-0000-000000000002';
  const ids = [id, next];
  const started = playback.startInContext(id, ids);
  ids.reverse();
  await started;
  expect(native.startInContext).toHaveBeenCalledWith(id, [id, next]);
});

test('context start is serialized with explicit close', async () => {
  const calls: string[] = [];
  let release!: () => void;
  native.startInContext.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => {
          calls.push('start');
          resolve(state);
        };
      }),
  );
  native.close.mockImplementationOnce(async () => {
    calls.push('close');
    return { ...state, status: 'idle' };
  });
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  const started = playback.startInContext(id, [id]);
  const closed = playback.close();
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toEqual([]);
  release();
  await Promise.all([started, closed]);
  expect(calls).toEqual(['start', 'close']);
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

test('PiP commands stay serialized and expose only sanitized presentation state', async () => {
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  const started = await playback.startPiP();
  expect(native.startPiP).toHaveBeenCalledTimes(1);
  expect(started.pipPresentation).toBe('pipStarting');
  expect(JSON.stringify(started)).not.toContain('file://');
  await playback.leavePlayerScreen(id);
  expect(native.leavePlayerScreen).toHaveBeenCalledWith(id);
  await expect(playback.leavePlayerScreen('file:///secret')).rejects.toThrow();
});

test('PiP restoration event accepts only library IDs and is removable', () => {
  const { playback } =
    require('@/services/playback') as typeof import('@/services/playback');
  const listener = jest.fn();
  const unsubscribe = playback.subscribeRestore(listener);
  eventListener?.({ libraryId: 'file:///secret' });
  expect(listener).not.toHaveBeenCalled();
  eventListener?.({ libraryId: id, uri: 'file:///secret' });
  expect(listener).toHaveBeenCalledWith(id);
  unsubscribe();
  expect(remove).toHaveBeenCalled();
});

test('Queue ACK is sanitized and never receives a JS Queue snapshot', async () => {
  const { reconcilePlaybackQueue } =
    require('@/services/playback') as typeof import('@/services/playback');
  expect(await reconcilePlaybackQueue()).toBe('applied');
  expect(native.queueDidChange).toHaveBeenCalledWith();
  native.queueDidChange.mockResolvedValueOnce({ status: 'superseded' });
  expect(await reconcilePlaybackQueue()).toBe('superseded');
  native.queueDidChange.mockResolvedValueOnce({ status: 'file:///private/db' });
  expect(await reconcilePlaybackQueue()).toBe('failed');
  native.queueDidChange.mockRejectedValueOnce(new Error('file:///private/db'));
  expect(await reconcilePlaybackQueue()).toBe('failed');
});

test('an in-flight Queue reconciliation cannot block Pause or Delete', async () => {
  let release!: (result: { status: string }) => void;
  native.queueDidChange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const service =
    require('@/services/playback') as typeof import('@/services/playback');
  const ack = service.reconcilePlaybackQueue();
  await service.playback.pause();
  await service.beginPlaybackDeletion(id);
  expect(native.pause).toHaveBeenCalledTimes(1);
  expect(native.beginDelete).toHaveBeenCalledTimes(1);
  release({ status: 'applied' });
  expect(await ack).toBe('applied');
});

test('a hung Queue ACK becomes pending recovery rather than blocking writes forever', async () => {
  jest.useFakeTimers();
  try {
    native.queueDidChange.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const service =
      require('@/services/playback') as typeof import('@/services/playback');
    const ack = service.reconcilePlaybackQueue();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(await ack).toBe('failed');
  } finally {
    jest.useRealTimers();
  }
});

test('Queue events carry no metadata into JS and remove their subscription', () => {
  const service =
    require('@/services/playback') as typeof import('@/services/playback');
  const listener = jest.fn();
  const stop = service.observeNativeQueueChanges(listener);
  eventListener?.({ uri: 'file:///private/db' });
  expect(listener).toHaveBeenCalledWith();
  expect(native.addListener).toHaveBeenCalledWith(
    'onQueueChanged',
    expect.any(Function),
  );
  stop();
  expect(remove).toHaveBeenCalledTimes(1);
});
