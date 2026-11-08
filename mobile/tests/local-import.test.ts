jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/library', () => ({
  initializeLibrary: jest.fn(async () => undefined),
  importPreparedLocalFile: jest.fn(),
}));

type Service = typeof import('@/services/localImport');
let service: Service;
let progress: ((event: unknown) => void) | null;
const remove = jest.fn();
const prepared = {
  uri: 'file:///cache/DropImport/uuid/payload.mp3',
  title: 'Audio',
  mediaType: 'audio',
  durationSeconds: 3,
};
const item = {
  id: 'uuid',
  title: 'Audio',
  lifecycle: 'ready',
  availability: 'available',
  uri: 'file:///Drop/ImportedMedia/uuid.mp3',
};
const native = {
  pickLocalFile: jest.fn(async (_request: number) => ({
    status: 'prepared',
    ...prepared,
  })),
  cancelLocalFileImport: jest.fn(async (_request: number) => true),
  addListener: jest.fn((_name: string, listener: (event: unknown) => void) => {
    progress = listener;
    return { remove };
  }),
};
function library() {
  return jest.requireMock('@/services/library') as {
    initializeLibrary: jest.Mock;
    importPreparedLocalFile: jest.Mock;
  };
}
async function settling() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  progress = null;
  native.pickLocalFile.mockImplementation(async () => ({
    status: 'prepared',
    ...prepared,
  }));
  native.cancelLocalFileImport.mockResolvedValue(true);
  jest.requireMock('expo').requireOptionalNativeModule.mockReturnValue(native);
  service = jest.requireActual('@/services/localImport') as Service;
  library().initializeLibrary.mockResolvedValue(undefined);
  library().importPreparedLocalFile.mockResolvedValue(item);
});

test.each(['mp3', 'm4a', 'mp4'])(
  'a selected %s uses the prepared import contract and confirms ready before success',
  async (ext) => {
    const selection = {
      ...prepared,
      uri: prepared.uri.replace('mp3', ext),
      mediaType: ext === 'mp4' ? 'video' : 'audio',
    };
    native.pickLocalFile.mockResolvedValueOnce({
      status: 'prepared',
      ...selection,
    });
    const states: string[] = [];
    const stop = service.observeLocalImport(() =>
      states.push(service.getLocalImportState().phase),
    );
    await service.startLocalImport();
    expect(library().initializeLibrary).toHaveBeenCalledTimes(1);
    expect(library().importPreparedLocalFile).toHaveBeenCalledWith(selection);
    expect(states).toContain('selecting');
    expect(states).toContain('saving');
    expect(service.getLocalImportState()).toMatchObject({
      phase: 'completed',
      item,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    stop();
  },
);

test('a picker is not opened until initial reconciliation finishes', async () => {
  let ready!: () => void;
  library().initializeLibrary.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const importing = service.startLocalImport();
  await settling();
  expect(native.pickLocalFile).not.toHaveBeenCalled();
  ready();
  await importing;
  expect(native.pickLocalFile).toHaveBeenCalledTimes(1);
});

test('double activation opens one picker and starts one promotion', async () => {
  await Promise.all([service.startLocalImport(), service.startLocalImport()]);
  expect(native.pickLocalFile).toHaveBeenCalledTimes(1);
  expect(library().importPreparedLocalFile).toHaveBeenCalledTimes(1);
});

test('cancelling selection produces no error and no promotion', async () => {
  native.pickLocalFile.mockResolvedValueOnce({ status: 'cancelled' } as never);
  await service.startLocalImport();
  expect(service.getLocalImportState()).toMatchObject({
    phase: 'cancelled',
    canRetry: false,
  });
  expect(library().importPreparedLocalFile).not.toHaveBeenCalled();
});

test.each([
  'INVALID_FILE',
  'SCOPE_DENIED',
  'READ_FAILED',
  'INSUFFICIENT_SPACE',
  'PICKER_UNAVAILABLE',
])('native failure %s is readable and allows a new operation', async (code) => {
  native.pickLocalFile.mockResolvedValueOnce({
    status: 'failed',
    code,
  } as never);
  await service.startLocalImport();
  const failed = service.getLocalImportState();
  expect(failed.phase).toBe('error');
  expect(failed.message).toBeTruthy();
  expect(failed.canRetry).toBe(false);
  expect(library().importPreparedLocalFile).not.toHaveBeenCalled();
  await service.startLocalImport();
  expect(service.getLocalImportState().phase).toBe('completed');
});

test('a saving failure retries the same preparation without another picker or copy', async () => {
  library().importPreparedLocalFile.mockRejectedValueOnce(
    new Error('SQLite /private/personal/path'),
  );
  await service.startLocalImport();
  expect(service.getLocalImportState()).toMatchObject({
    phase: 'error',
    canRetry: true,
  });
  expect(service.getLocalImportState().message).not.toContain('/private');
  await service.retryLocalImport();
  expect(native.pickLocalFile).toHaveBeenCalledTimes(1);
  expect(library().importPreparedLocalFile).toHaveBeenNthCalledWith(
    2,
    prepared,
  );
  expect(service.getLocalImportState().phase).toBe('completed');
});

test('copy cancellation waits for native completion and does not promote', async () => {
  let finish!: (result: unknown) => void;
  native.pickLocalFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const importing = service.startLocalImport();
  await settling();
  const requestId = native.pickLocalFile.mock.calls[0]![0];
  progress!({ requestId, phase: 'preparing' });
  expect(await service.cancelLocalImport()).toBe(true);
  expect(service.getLocalImportState().phase).toBe('cancelling');
  expect(library().importPreparedLocalFile).not.toHaveBeenCalled();
  finish({ status: 'cancelled' });
  await importing;
  expect(service.getLocalImportState().phase).toBe('cancelled');
});

test('saving cannot promise cancellation', async () => {
  let finish!: (result: unknown) => void;
  library().importPreparedLocalFile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const importing = service.startLocalImport();
  await settling();
  expect(service.getLocalImportState().phase).toBe('saving');
  expect(await service.cancelLocalImport()).toBe(false);
  expect(native.cancelLocalFileImport).not.toHaveBeenCalled();
  finish(item);
  await importing;
});

test('only current monotonic measured progress is accepted and stale events are ignored', async () => {
  let finish!: (result: unknown) => void;
  native.pickLocalFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const importing = service.startLocalImport();
  await settling();
  const requestId = native.pickLocalFile.mock.calls[0]![0];
  progress!({ requestId, phase: 'preparing' });
  expect(service.getLocalImportState().totalBytes).toBeUndefined();
  progress!({ requestId, phase: 'copying', copiedBytes: 50, totalBytes: 100 });
  progress!({ requestId, phase: 'copying', copiedBytes: 10, totalBytes: 100 });
  progress!({
    requestId: requestId - 1,
    phase: 'copying',
    copiedBytes: 90,
    totalBytes: 100,
  });
  expect(service.getLocalImportState().copiedBytes).toBe(50);
  finish({ status: 'prepared', ...prepared });
  await importing;
  progress!({ requestId, phase: 'preparing' });
  expect(service.getLocalImportState().phase).toBe('completed');
});

test('a reconciliation or unexpected provider error is sanitized and does not leave a permanent lock', async () => {
  library().initializeLibrary.mockRejectedValueOnce(
    new Error('private SQLite name'),
  );
  await service.startLocalImport();
  expect(service.getLocalImportState().phase).toBe('error');
  expect(native.pickLocalFile).not.toHaveBeenCalled();
  await service.startLocalImport();
  expect(service.getLocalImportState().phase).toBe('completed');
});

test('forwards native descriptive fields without transferring image bytes', async () => {
  native.pickLocalFile.mockResolvedValue({
    status: 'prepared',
    ...prepared,
    artist: 'Artista',
    album: 'Álbum',
    genre: 'Jazz',
    year: 2024,
  } as Awaited<ReturnType<typeof native.pickLocalFile>>);
  await service.startLocalImport();
  expect(library().importPreparedLocalFile).toHaveBeenCalledWith(
    expect.objectContaining({
      artist: 'Artista',
      album: 'Álbum',
      genre: 'Jazz',
      year: 2024,
    }),
  );
});
