import { requireOptionalNativeModule } from 'expo';

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'paused'
  | 'playing'
  | 'interrupted'
  | 'ended'
  | 'failed';

export type PlaybackState = {
  libraryId: string | null;
  status: PlaybackStatus;
  position: number;
  duration: number | null;
  rate: number;
  playable: boolean;
  completed: boolean;
  fullscreen: boolean;
  errorCode: string | null;
};

type NativePlayback = {
  open(id: string): Promise<unknown>;
  play(): Promise<unknown>;
  pause(): Promise<unknown>;
  seek(seconds: number): Promise<unknown>;
  skip(seconds: number): Promise<unknown>;
  setRate(rate: number): Promise<unknown>;
  close(): Promise<unknown>;
  getState(): Promise<unknown>;
  enterFullscreen(): Promise<unknown>;
  exitFullscreen(): Promise<unknown>;
  beginDelete(id: string): Promise<unknown>;
  endDelete(id: string): Promise<unknown>;
  addListener(
    event: 'onPlaybackState',
    listener: (value: unknown) => void,
  ): { remove(): void };
};

const statuses = new Set<PlaybackStatus>([
  'idle',
  'loading',
  'ready',
  'paused',
  'playing',
  'interrupted',
  'ended',
  'failed',
]);
const libraryIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeErrorCode = /^[A-Z_]{2,40}$/;
let commandTail: Promise<void> = Promise.resolve();

function native(): NativePlayback {
  const module = requireOptionalNativeModule<NativePlayback>('DropPlayback');
  if (!module)
    throw new Error('Esta versión de Drop no incluye el reproductor.');
  return module;
}

function safeState(value: unknown): PlaybackState {
  const source =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const status = source.status;
  return {
    libraryId:
      typeof source.libraryId === 'string' &&
      libraryIdPattern.test(source.libraryId)
        ? source.libraryId
        : null,
    status:
      typeof status === 'string' && statuses.has(status as PlaybackStatus)
        ? (status as PlaybackStatus)
        : 'failed',
    position:
      typeof source.position === 'number' && Number.isFinite(source.position)
        ? Math.max(0, source.position)
        : 0,
    duration:
      typeof source.duration === 'number' && Number.isFinite(source.duration)
        ? Math.max(0, source.duration)
        : null,
    rate:
      typeof source.rate === 'number' && Number.isFinite(source.rate)
        ? source.rate
        : 1,
    playable: source.playable === true,
    completed: source.completed === true,
    fullscreen: source.fullscreen === true,
    errorCode:
      typeof source.errorCode === 'string' &&
      safeErrorCode.test(source.errorCode)
        ? source.errorCode
        : null,
  };
}

function ordered<T>(
  operation: (module: NativePlayback) => Promise<T>,
): Promise<T> {
  const result = commandTail.then(() => operation(native()));
  commandTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export const playback = {
  open: (libraryId: string) => {
    if (!libraryIdPattern.test(libraryId))
      return Promise.reject(
        new Error('El elemento de Biblioteca no es válido.'),
      );
    return ordered(async (module) => safeState(await module.open(libraryId)));
  },
  play: () => ordered(async (module) => safeState(await module.play())),
  pause: () => ordered(async (module) => safeState(await module.pause())),
  seek: (seconds: number) =>
    ordered(async (module) => safeState(await module.seek(seconds))),
  skip: (seconds: number) =>
    ordered(async (module) => safeState(await module.skip(seconds))),
  setRate: (rate: number) =>
    ordered(async (module) => safeState(await module.setRate(rate))),
  close: () => ordered(async (module) => safeState(await module.close())),
  getState: () => ordered(async (module) => safeState(await module.getState())),
  enterFullscreen: () =>
    ordered(async (module) => safeState(await module.enterFullscreen())),
  exitFullscreen: () =>
    ordered(async (module) => safeState(await module.exitFullscreen())),
  subscribe: (listener: (state: PlaybackState) => void) => {
    const subscription = native().addListener('onPlaybackState', (value) => {
      listener(safeState(value));
    });
    return () => subscription.remove();
  },
};

export function beginPlaybackDeletion(id: string): Promise<void> {
  return ordered(async (module) => {
    await module.beginDelete(id);
  });
}

export function endPlaybackDeletion(id: string): Promise<void> {
  return ordered(async (module) => {
    await module.endDelete(id);
  });
}
