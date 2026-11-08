import { requireOptionalNativeModule } from 'expo';

import type { AvailableLibraryItem } from '@/models/library';
import {
  initializeLibrary,
  importPreparedLocalFile,
  type PreparedLocalFile,
} from '@/services/library';

export type LocalImportState = {
  phase:
    | 'idle'
    | 'selecting'
    | 'preparing'
    | 'copying'
    | 'validating'
    | 'cancelling'
    | 'saving'
    | 'completed'
    | 'cancelled'
    | 'error';
  canRetry: boolean;
  copiedBytes?: number;
  totalBytes?: number;
  message?: string;
  item?: AvailableLibraryItem;
};
type PreparedSelection = PreparedLocalFile & { durationSeconds: number };
type SelectionResult =
  | ({ status: 'prepared' } & PreparedSelection)
  | { status: 'cancelled' }
  | { status: 'failed'; code: string };
type NativeImport = {
  pickLocalFile(requestId: number): Promise<SelectionResult>;
  cancelLocalFileImport(requestId: number): Promise<boolean>;
  addListener(
    name: 'onLocalImportProgress',
    listener: (event: unknown) => void,
  ): { remove(): void };
};

let state: LocalImportState = { phase: 'idle', canRetry: false };
const listeners = new Set<() => void>();
let active: Promise<void> | null = null;
let prepared: PreparedSelection | null = null;
let nextRequest = Date.now();
let currentRequest: number | null = null;
let cancelBeforePicker = false;

export function getLocalImportState(): LocalImportState {
  return state;
}
export function observeLocalImport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function update(value: LocalImportState) {
  state = value;
  for (const listener of listeners) listener();
}
function native(): NativeImport {
  const module = requireOptionalNativeModule<NativeImport>('DropLibrary');
  if (!module) throw new Error('Native import unavailable');
  return module;
}
function errorMessage(code: string): string {
  switch (code) {
    case 'INVALID_FILE':
      return 'El archivo no es compatible o está incompleto. Elige un MP3, M4A con AAC o MP4 con video.';
    case 'SCOPE_DENIED':
      return 'Archivos no concedió acceso al archivo. Vuelve a seleccionarlo.';
    case 'INSUFFICIENT_SPACE':
      return 'No hay espacio suficiente para importar el archivo.';
    case 'READ_FAILED':
      return 'No se pudo leer el archivo. Comprueba que su proveedor esté disponible e inténtalo de nuevo.';
    case 'IMPORT_BUSY':
      return 'Ya hay una importación en curso. Espera a que termine.';
    default:
      return 'No se pudo abrir Archivos. Inténtalo de nuevo.';
  }
}
function receiveProgress(event: unknown, requestId: number) {
  if (!event || typeof event !== 'object' || currentRequest !== requestId)
    return;
  const value = event as Record<string, unknown>;
  if (value.requestId !== requestId) return;
  if (value.phase === 'cancelling') {
    update({ phase: 'cancelling', canRetry: false });
    return;
  }
  if (state.phase === 'cancelling') return;
  if (value.phase === 'preparing') {
    if (state.phase === 'selecting')
      update({ phase: 'preparing', canRetry: false });
    return;
  }
  if (value.phase !== 'copying' && value.phase !== 'validating') return;
  const copied = value.copiedBytes,
    total = value.totalBytes;
  if (
    typeof copied !== 'number' ||
    typeof total !== 'number' ||
    !Number.isSafeInteger(copied) ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    copied < 0 ||
    copied > total ||
    copied < (state.copiedBytes ?? 0)
  )
    return;
  update({
    phase: value.phase,
    copiedBytes: copied,
    totalBytes: total,
    canRetry: false,
  });
}
function run(
  work: () => Promise<void>,
  phase: 'selecting' | 'saving',
): Promise<void> {
  const promise = Promise.resolve()
    .then(work)
    .catch(() => {
      update({
        phase: 'error',
        canRetry: prepared !== null,
        message: prepared
          ? 'No se pudo guardar el archivo. Reintenta la importación o selecciona el archivo de nuevo.'
          : 'No se pudo preparar la importación. Inténtalo de nuevo.',
      });
    })
    .finally(() => {
      active = null;
    });
  active = promise;
  update({ phase, canRetry: false });
  return promise;
}
async function save(value: PreparedSelection): Promise<void> {
  update({ phase: 'saving', canRetry: false });
  const item = await importPreparedLocalFile(value);
  update({ phase: 'completed', item, canRetry: false });
  prepared = null;
}

export function startLocalImport(): Promise<void> {
  if (active) return active;
  prepared = null;
  cancelBeforePicker = false;
  return run(async () => {
    await initializeLibrary();
    if (cancelBeforePicker) {
      update({ phase: 'cancelled', canRetry: false });
      return;
    }
    const module = native();
    const requestId = ++nextRequest;
    currentRequest = requestId;
    let result: SelectionResult;
    let subscription: { remove(): void } | undefined;
    try {
      subscription = module.addListener('onLocalImportProgress', (event) =>
        receiveProgress(event, requestId),
      );
      result = await module.pickLocalFile(requestId);
    } finally {
      currentRequest = null;
      subscription?.remove();
    }
    if (result.status === 'cancelled') {
      update({ phase: 'cancelled', canRetry: false });
      return;
    }
    if (result.status === 'failed') {
      update({
        phase: 'error',
        message: errorMessage(result.code),
        canRetry: false,
      });
      return;
    }
    if (
      result.status !== 'prepared' ||
      typeof result.uri !== 'string' ||
      typeof result.title !== 'string' ||
      !['audio', 'video'].includes(result.mediaType) ||
      !Number.isFinite(result.durationSeconds) ||
      result.durationSeconds <= 0
    ) {
      update({
        phase: 'error',
        message: errorMessage('INVALID_FILE'),
        canRetry: false,
      });
      return;
    }
    prepared = {
      uri: result.uri,
      title: result.title,
      mediaType: result.mediaType,
      durationSeconds: result.durationSeconds,
      artist: result.artist,
      album: result.album,
      genre: result.genre,
      year: result.year,
    };
    await save(prepared);
  }, 'selecting');
}

export function retryLocalImport(): Promise<void> {
  if (active) return active;
  const value = prepared;
  if (!value) return Promise.resolve();
  return run(() => save(value), 'saving');
}

export async function cancelLocalImport(): Promise<boolean> {
  if (
    !active ||
    !['selecting', 'preparing', 'copying', 'validating'].includes(state.phase)
  )
    return false;
  const request = currentRequest;
  if (request === null) {
    cancelBeforePicker = true;
    update({ phase: 'cancelling', canRetry: false });
    return true;
  }
  try {
    const accepted = await native().cancelLocalFileImport(request);
    if (accepted && currentRequest === request)
      update({ phase: 'cancelling', canRetry: false });
    return accepted;
  } catch {
    return false;
  }
}
