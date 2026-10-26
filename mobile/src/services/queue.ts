import { requireOptionalNativeModule } from 'expo';
import { AppState } from 'react-native';

import type { QueueEntry } from '@/models/queue';
import { initializeLibrary, observeLibrary } from '@/services/library';
import {
  openLibraryDatabase,
  withLibraryForeignKeyTransaction,
} from '@/services/libraryDatabase';
import {
  observeNativeQueueChanges,
  reconcilePlaybackQueue,
  type QueueReconciliationStatus,
} from '@/services/playback';

type Database = Awaited<ReturnType<typeof openLibraryDatabase>>;
type NativeQueueIds = { newQueueEntryId(): string };

async function queueTransaction<T>(
  action: (txn: Database) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withLibraryForeignKeyTransaction(action, 250);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        attempt >= 2 ||
        !/SQLITE_BUSY|database (?:table )?is locked/i.test(detail)
      )
        throw error;
      // Let an external Library transaction finish on the JS executor, then
      // retry the entire rolled-back Queue transaction.
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 25 * (attempt + 1)),
      );
    }
  }
}

const listeners = new Set<() => void>();
export type QueuePlaybackSyncState = {
  status: 'unknown' | 'applied' | 'pending';
  lastResult: QueueReconciliationStatus | null;
};
const syncListeners = new Set<() => void>();
let syncState: QueuePlaybackSyncState = { status: 'unknown', lastResult: null };
let syncRevision = 0;
let syncInFlight: { revision: number; promise: Promise<void> } | null = null;
let stopObservingLibrary: (() => void) | null = null;
let stopObservingNative: (() => void) | null = null;
let stopObservingApp: (() => void) | null = null;
let observedSignature: string | null = null;
let writeTail: Promise<void> = Promise.resolve();

/** Serialize all Queue reads/writes in this JS runtime. BEGIN IMMEDIATE plus
 * busy_timeout on each private FK-enabled connection serializes with Library
 * deletion and other SQLite writers, including across connection boundaries. */
function serial<T>(action: () => Promise<T>): Promise<T> {
  const operation = writeTail.then(action, action);
  writeTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

/** Serialize SQLite only. Each caller can await its ACK without holding the
 * persistence tail and preventing a newer committed priority from reaching Swift. */
async function serialWithAck<T>(
  action: () => Promise<{ value: T; ack: Promise<void> }>,
): Promise<T> {
  const { value, ack } = await serial(action);
  await ack;
  return value;
}

function queueId(): string {
  const native = requireOptionalNativeModule<NativeQueueIds>('DropLibrary');
  if (!native?.newQueueEntryId)
    throw new Error('Esta versión de Drop no incluye la cola.');
  return native.newQueueEntryId();
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      console.warn('[Drop queue] Observer failed');
    }
  }
}

function signature(rows: QueueEntry[]): string {
  return JSON.stringify(rows);
}

function publish(rows: QueueEntry[], changed: boolean): void {
  const next = signature(rows);
  const externalChange =
    observedSignature !== null && observedSignature !== next;
  observedSignature = next;
  if (changed || externalChange) notify();
}

/** Existing mutation return types remain unchanged. A resolved mutation means
 * SQLite committed; callers can separately observe "saved, playback pending". */
export function getQueuePlaybackSyncState(): QueuePlaybackSyncState {
  return { ...syncState };
}

function publishSync(next: QueuePlaybackSyncState): void {
  if (
    syncState.status === next.status &&
    syncState.lastResult === next.lastResult
  )
    return;
  syncState = next;
  for (const listener of syncListeners) {
    try {
      listener();
    } catch {
      console.warn('[Drop queue] Sync observer failed');
    }
  }
}

function synchronizePlayback(replaceExisting = false): Promise<void> {
  if (!replaceExisting && syncInFlight) return syncInFlight.promise;
  const revision = ++syncRevision;
  publishSync({ status: 'pending', lastResult: null });
  const promise = reconcilePlaybackQueue()
    .then((result) => {
      if (revision !== syncRevision) return;
      publishSync({
        status: result === 'applied' ? 'applied' : 'pending',
        lastResult: result,
      });
    })
    .finally(() => {
      if (syncInFlight?.revision === revision) syncInFlight = null;
    });
  syncInFlight = { revision, promise };
  return promise;
}

async function afterCommit(
  rows: QueueEntry[],
  changed: boolean,
): Promise<void> {
  publish(rows, changed);
  if (changed) await synchronizePlayback(true);
}

function safeError(error: unknown): never {
  if (
    error instanceof Error &&
    [
      'La descarga ya no está disponible.',
      'La entrada ya no está en la cola.',
      'La posición de la cola no es válida.',
      'La cola contiene posiciones inválidas.',
      'Esta versión de Drop no incluye la cola.',
    ].includes(error.message)
  )
    throw error;
  throw new Error('No se pudo actualizar la cola. Inténtalo de nuevo.');
}

async function rowsIn(txn: Database): Promise<QueueEntry[]> {
  const rows = await txn.getAllAsync<QueueEntry>(
    'SELECT id, itemId, position, addedAt FROM playback_queue ORDER BY position ASC, id ASC',
  );
  if (
    rows.some(
      (row, index) =>
        !Number.isSafeInteger(row.position) ||
        row.position < 0 ||
        (index > 0 && row.position === rows[index - 1]?.position),
    )
  )
    throw new Error('La cola contiene posiciones inválidas.');
  return rows;
}

/** SQLite UNIQUE constraints are immediate. Move every old position into a
 * disjoint positive range, then write the final compact order, all in one
 * transaction. No intermediate state is visible outside that transaction. */
async function assignPositions(
  txn: Database,
  previous: QueueEntry[],
  ordered: QueueEntry[],
): Promise<void> {
  const highest = previous.at(-1)?.position ?? -1;
  const base = highest + ordered.length + 1;
  if (!Number.isSafeInteger(base + ordered.length))
    throw new Error('La cola contiene posiciones inválidas.');
  for (const [index, row] of previous.entries()) {
    await txn.runAsync(
      'UPDATE playback_queue SET position = ? WHERE id = ?',
      base + index,
      row.id,
    );
  }
  for (const [index, row] of ordered.entries()) {
    await txn.runAsync(
      'UPDATE playback_queue SET position = ? WHERE id = ?',
      index,
      row.id,
    );
  }
}

async function compactIn(
  txn: Database,
): Promise<{ rows: QueueEntry[]; changed: boolean }> {
  const rows = await rowsIn(txn);
  if (rows.every((row, index) => row.position === index))
    return { rows, changed: false };
  await assignPositions(txn, rows, rows);
  return {
    rows: rows.map((row, position) => ({ ...row, position })),
    changed: true,
  };
}

async function normalizedSnapshot(): Promise<{
  rows: QueueEntry[];
  changed: boolean;
}> {
  await initializeLibrary();
  return queueTransaction(compactIn);
}

async function refreshQueue(
  source: 'library' | 'native' | 'foreground' | 'subscribe',
): Promise<void> {
  try {
    await serialWithAck(async () => {
      const { rows, changed } = await normalizedSnapshot();
      const next = signature(rows);
      const externalChange =
        observedSignature !== null && observedSignature !== next;
      publish(rows, changed);
      // A consume event already comes from native playback. Refresh SQLite,
      // without reflecting the same event back into an ACK/event loop.
      const needsSync =
        source !== 'native' &&
        (externalChange || changed || source !== 'library');
      return {
        value: undefined,
        ack: needsSync
          ? synchronizePlayback(externalChange || changed)
          : Promise.resolve(),
      };
    });
  } catch {
    // A later Library event or listQueue retries without leaking SQLite paths.
    console.warn('[Drop queue] Could not refresh');
  }
}

function startObserving(): void {
  if (!stopObservingLibrary) {
    stopObservingLibrary = observeLibrary(() => {
      void refreshQueue('library');
    });
    stopObservingNative = observeNativeQueueChanges(() => {
      void refreshQueue('native');
    });
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshQueue('foreground');
    });
    stopObservingApp = () => appSubscription.remove();
    void refreshQueue('subscribe');
  }
}

function stopObservingIfUnused(): void {
  if (listeners.size + syncListeners.size !== 0) return;
  stopObservingLibrary?.();
  stopObservingNative?.();
  stopObservingApp?.();
  stopObservingLibrary = null;
  stopObservingNative = null;
  stopObservingApp = null;
  observedSignature = null;
}

export function observeQueuePlaybackSync(listener: () => void): () => void {
  syncListeners.add(listener);
  startObserving();
  return () => {
    syncListeners.delete(listener);
    stopObservingIfUnused();
  };
}

export function observeQueue(listener: () => void): () => void {
  listeners.add(listener);
  startObserving();
  return () => {
    listeners.delete(listener);
    stopObservingIfUnused();
  };
}

export function listQueue(): Promise<QueueEntry[]> {
  return serialWithAck(async () => {
    try {
      const { rows, changed } = await normalizedSnapshot();
      const externalChange =
        observedSignature !== null && observedSignature !== signature(rows);
      const initialRead = observedSignature === null;
      publish(rows, changed);
      const needsSync =
        initialRead ||
        changed ||
        externalChange ||
        syncState.status !== 'applied';
      return {
        value: rows,
        ack: needsSync
          ? synchronizePlayback(changed || externalChange)
          : Promise.resolve(),
      };
    } catch (error) {
      safeError(error);
    }
  });
}

async function requireReadyItem(txn: Database, itemId: string): Promise<void> {
  const row = await txn.getFirstAsync<{ lifecycle: string }>(
    'SELECT lifecycle FROM library_items WHERE id = ?',
    itemId,
  );
  if (row?.lifecycle !== 'ready')
    throw new Error('La descarga ya no está disponible.');
}

async function enqueue(itemId: string, next: boolean): Promise<QueueEntry> {
  return serialWithAck(async () => {
    await initializeLibrary();
    const entry: QueueEntry = {
      id: queueId(),
      itemId,
      position: 0,
      addedAt: new Date().toISOString(),
    };
    let result: QueueEntry[] = [];
    try {
      await queueTransaction(async (txn) => {
        const { rows } = await compactIn(txn);
        await requireReadyItem(txn, itemId);
        entry.position = rows.length;
        await txn.runAsync(
          'INSERT INTO playback_queue (id, itemId, position, addedAt) VALUES (?, ?, ?, ?)',
          entry.id,
          entry.itemId,
          entry.position,
          entry.addedAt,
        );
        if (next) {
          await assignPositions(txn, [...rows, entry], [entry, ...rows]);
          result = [entry, ...rows].map((row, position) => ({
            ...row,
            position,
          }));
          entry.position = 0;
        } else {
          result = [...rows, entry];
        }
      });
    } catch (error) {
      safeError(error);
    }
    return { value: entry, ack: afterCommit(result, true) };
  });
}

export function enqueueNext(itemId: string): Promise<QueueEntry> {
  return enqueue(itemId, true);
}

export function enqueueLast(itemId: string): Promise<QueueEntry> {
  return enqueue(itemId, false);
}

export function removeQueueEntry(entryId: string): Promise<void> {
  return serialWithAck(async () => {
    await initializeLibrary();
    let changed = false;
    let result: QueueEntry[] = [];
    try {
      await queueTransaction(async (txn) => {
        const compacted = await compactIn(txn);
        changed = compacted.changed;
        const before = compacted.rows;
        const entry = before.find((row) => row.id === entryId);
        if (!entry) {
          result = before;
          return;
        }
        await txn.runAsync('DELETE FROM playback_queue WHERE id = ?', entryId);
        const remaining = before.filter((row) => row.id !== entryId);
        await assignPositions(txn, remaining, remaining);
        result = remaining.map((row, position) => ({ ...row, position }));
        changed = true;
      });
    } catch (error) {
      safeError(error);
    }
    return { value: undefined, ack: afterCommit(result, changed) };
  });
}

export function clearQueue(): Promise<void> {
  return serialWithAck(async () => {
    await initializeLibrary();
    let changed = false;
    try {
      await queueTransaction(async (txn) => {
        const outcome = await txn.runAsync('DELETE FROM playback_queue');
        changed = outcome.changes > 0;
      });
    } catch (error) {
      safeError(error);
    }
    return { value: undefined, ack: afterCommit([], changed) };
  });
}

export function moveQueueEntry(
  entryId: string,
  targetPosition: number,
): Promise<void> {
  return serialWithAck(async () => {
    await initializeLibrary();
    let changed = false;
    let result: QueueEntry[] = [];
    try {
      await queueTransaction(async (txn) => {
        const compacted = await compactIn(txn);
        changed = compacted.changed;
        const before = compacted.rows;
        const from = before.findIndex((row) => row.id === entryId);
        if (from < 0) throw new Error('La entrada ya no está en la cola.');
        if (
          !Number.isInteger(targetPosition) ||
          targetPosition < 0 ||
          targetPosition >= before.length
        )
          throw new Error('La posición de la cola no es válida.');
        if (from === targetPosition) {
          result = before;
          return;
        }
        const ordered = [...before];
        const [entry] = ordered.splice(from, 1);
        if (!entry) throw new Error('La entrada ya no está en la cola.');
        ordered.splice(targetPosition, 0, entry);
        await assignPositions(txn, before, ordered);
        result = ordered.map((row, position) => ({ ...row, position }));
        changed = true;
      });
    } catch (error) {
      safeError(error);
    }
    return { value: undefined, ack: afterCommit(result, changed) };
  });
}
