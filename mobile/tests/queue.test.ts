/** @jest-environment node */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RealSQLite } from './support/realSQLite';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));
jest.mock('@/services/library', () => ({
  initializeLibrary: jest.fn(async () => undefined),
  observeLibrary: jest.fn(),
}));

let directory: string;
let path: string;
let connections: RealSQLite[];
let libraryChanged: (() => void) | null;
let sequence: number;
let nativeChanged: (() => void) | null;
let foregroundChanged: ((state: string) => void) | null;
let queueDidChange: jest.Mock;
let removeNative: jest.Mock;
let removeAppState: jest.Mock;

function modules() {
  return {
    database:
      require('@/services/libraryDatabase') as typeof import('@/services/libraryDatabase'),
    queue: require('@/services/queue') as typeof import('@/services/queue'),
  };
}

async function seed(): Promise<void> {
  const db = await modules().database.openLibraryDatabase();
  for (const [id, lifecycle] of [
    ['a', 'ready'],
    ['b', 'ready'],
    ['c', 'ready'],
    ['d', 'ready'],
    ['pending', 'pending'],
    ['deleting', 'deleting'],
  ] as const) {
    await db.runAsync(
      `INSERT INTO library_items
       (id, sourceKind, title, mediaType, relativeMediaPath, sizeBytes, downloadedAt, lifecycle)
       VALUES (?, 'direct', ?, 'audio', ?, 1, '2026-01-01T00:00:00.000Z', ?)`,
      id,
      id,
      `Media/${id}.m4a`,
      lifecycle,
    );
  }
}

async function itemIds(): Promise<string[]> {
  return (await modules().queue.listQueue()).map((entry) => entry.itemId);
}

async function assertCompact(): Promise<void> {
  const rows = await modules().queue.listQueue();
  expect(rows.map((row) => row.position)).toEqual(rows.map((_, i) => i));
  expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
}

beforeEach(() => {
  jest.resetModules();
  directory = mkdtempSync(join(tmpdir(), 'drop-queue-v3-'));
  path = join(directory, 'library.sqlite');
  connections = [];
  libraryChanged = null;
  sequence = 0;
  nativeChanged = null;
  foregroundChanged = null;
  queueDidChange = jest.fn(async () => ({ status: 'applied' }));
  removeNative = jest.fn(() => {
    nativeChanged = null;
  });
  removeAppState = jest.fn(() => {
    foregroundChanged = null;
  });
  require('react-native').AppState.addEventListener.mockImplementation(
    (_: string, listener: (state: string) => void) => {
      foregroundChanged = listener;
      return { remove: removeAppState };
    },
  );
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  const libraryNative = {
    prepare: async () => ({ databaseDirectoryURL: `file://${directory}/` }),
    newQueueEntryId: () => `entry-${++sequence}`,
  };
  expo.requireOptionalNativeModule.mockImplementation((name: string) =>
    name === 'DropPlayback'
      ? {
          queueDidChange,
          addListener: (_: string, listener: () => void) => {
            nativeChanged = listener;
            return { remove: removeNative };
          },
        }
      : libraryNative,
  );
  const sqlite = require('expo-sqlite') as { openDatabaseAsync: jest.Mock };
  sqlite.openDatabaseAsync.mockImplementation(async () => {
    const connection = new RealSQLite(path);
    connections.push(connection);
    return connection;
  });
  const library = require('@/services/library') as {
    observeLibrary: jest.Mock;
  };
  library.observeLibrary.mockImplementation((listener: () => void) => {
    libraryChanged = listener;
    return () => {
      libraryChanged = null;
    };
  });
});

afterEach(async () => {
  await Promise.all(connections.map((connection) => connection.closeAsync()));
  rmSync(directory, { recursive: true, force: true });
});

test('empty Queue, durable duplicate occurrences and enqueueNext order', async () => {
  await seed();
  const { queue } = modules();
  expect(await queue.listQueue()).toEqual([]);
  const first = await queue.enqueueLast('a');
  const duplicate = await queue.enqueueLast('a');
  await queue.enqueueNext('b');
  await queue.enqueueNext('c');
  expect(first.id).not.toBe(duplicate.id);
  expect(await itemIds()).toEqual(['c', 'b', 'a', 'a']);
  expect((await queue.listQueue()).map((row) => row.position)).toEqual([
    0, 1, 2, 3,
  ]);
  expect((await queue.listQueue()).every((row) => /Z$/.test(row.addedAt))).toBe(
    true,
  );
  await assertCompact();
});

test('remove affects only one occurrence, compacts and is idempotent', async () => {
  await seed();
  const { queue } = modules();
  const first = await queue.enqueueLast('a');
  await queue.enqueueLast('b');
  const third = await queue.enqueueLast('a');
  await queue.removeQueueEntry(first.id);
  expect(await itemIds()).toEqual(['b', 'a']);
  expect((await queue.listQueue())[1]?.id).toBe(third.id);
  await queue.removeQueueEntry(first.id);
  await assertCompact();
  const db = await modules().database.openLibraryDatabase();
  expect(
    await db.getFirstAsync(
      "SELECT COUNT(*) AS count FROM library_items WHERE id = 'a'",
    ),
  ).toEqual({ count: 1 });
});

test('move up, down and no-op preserves relative order and positions', async () => {
  await seed();
  const { queue } = modules();
  const a = await queue.enqueueLast('a');
  const b = await queue.enqueueLast('b');
  await queue.enqueueLast('c');
  const d = await queue.enqueueLast('d');
  await queue.moveQueueEntry(d.id, 1);
  expect(await itemIds()).toEqual(['a', 'd', 'b', 'c']);
  await queue.moveQueueEntry(a.id, 3);
  expect(await itemIds()).toEqual(['d', 'b', 'c', 'a']);
  await queue.moveQueueEntry(b.id, 1);
  expect(await itemIds()).toEqual(['d', 'b', 'c', 'a']);
  await expect(queue.moveQueueEntry(b.id, -1)).rejects.toThrow('posición');
  await expect(queue.moveQueueEntry(b.id, 4)).rejects.toThrow('posición');
  await expect(queue.moveQueueEntry('absent', 0)).rejects.toThrow('ya no está');
  await assertCompact();
});

test('ready only; failed writes roll back and do not expose SQLite details', async () => {
  await seed();
  const { queue } = modules();
  for (const id of ['absent', 'pending', 'deleting'])
    await expect(queue.enqueueLast(id)).rejects.toThrow(
      'ya no está disponible',
    );
  await queue.enqueueLast('a');
  expect(await itemIds()).toEqual(['a']);
  await assertCompact();
});

test('clear changes only Queue, not Library, Collections or progress', async () => {
  await seed();
  const { queue, database } = modules();
  const db = await database.openLibraryDatabase();
  await db.execAsync(`INSERT INTO collections VALUES ('col', 'Collection', 'collection', 'now', 'now');
    UPDATE library_items SET playbackPositionSeconds = 123 WHERE id = 'a';`);
  await queue.enqueueLast('a');
  await queue.enqueueLast('b');
  await queue.clearQueue();
  expect(await queue.listQueue()).toEqual([]);
  expect(
    await db.getFirstAsync(
      "SELECT playbackPositionSeconds FROM library_items WHERE id = 'a'",
    ),
  ).toEqual({ playbackPositionSeconds: 123 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collections'),
  ).toEqual({ count: 1 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM library_items'),
  ).toEqual({ count: 6 });
});

test('Queue mutations never change Media or Artwork bytes', async () => {
  await seed();
  const media = join(directory, 'Media', 'a.m4a');
  const artwork = join(directory, 'Artwork', 'a.jpg');
  mkdirSync(join(directory, 'Media'));
  mkdirSync(join(directory, 'Artwork'));
  writeFileSync(media, Buffer.from([1, 2, 3]));
  writeFileSync(artwork, Buffer.from([4, 5, 6]));
  const { queue } = modules();
  const first = await queue.enqueueNext('a');
  await queue.enqueueLast('a');
  await queue.removeQueueEntry(first.id);
  await queue.clearQueue();
  expect(readFileSync(media)).toEqual(Buffer.from([1, 2, 3]));
  expect(readFileSync(artwork)).toEqual(Buffer.from([4, 5, 6]));
});

test('Library cascade removes every duplicate, preserves others and compacts', async () => {
  await seed();
  const { queue, database } = modules();
  await queue.enqueueLast('a');
  await queue.enqueueLast('b');
  await queue.enqueueLast('a');
  await queue.enqueueLast('c');
  const db = await database.openLibraryDatabase();
  await db.runAsync("DELETE FROM library_items WHERE id = 'a'");
  expect(await itemIds()).toEqual(['b', 'c']);
  await assertCompact();
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

test('Collection deletion does not affect Queue; Queue mutation does not affect Collection', async () => {
  await seed();
  const { queue, database } = modules();
  const db = await database.openLibraryDatabase();
  await db.execAsync(`INSERT INTO collections VALUES ('col', 'Collection', 'collection', 'now', 'now');
    INSERT INTO collection_items VALUES ('col', 'a', 'now');`);
  await queue.enqueueLast('a');
  await queue.moveQueueEntry((await queue.listQueue())[0]!.id, 0);
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collection_items'),
  ).toEqual({ count: 1 });
  await db.runAsync("DELETE FROM collections WHERE id = 'col'");
  expect(await itemIds()).toEqual(['a']);
});

test('Queue survives a fresh service/database connection with exact IDs and order', async () => {
  await seed();
  const before = await modules().queue.enqueueLast('a');
  await modules().queue.enqueueLast('b');
  await modules().queue.enqueueLast('a');
  const snapshot = await modules().queue.listQueue();
  await Promise.all(connections.map((connection) => connection.closeAsync()));
  jest.resetModules();
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockReturnValue({
    prepare: async () => ({ databaseDirectoryURL: `file://${directory}/` }),
    newQueueEntryId: () => `entry-${++sequence}`,
    queueDidChange,
  });
  const sqlite = require('expo-sqlite') as { openDatabaseAsync: jest.Mock };
  sqlite.openDatabaseAsync.mockImplementation(async () => {
    const connection = new RealSQLite(path);
    connections.push(connection);
    return connection;
  });
  const reopened = await modules().queue.listQueue();
  expect(reopened).toEqual(snapshot);
  expect(reopened[0]?.id).toBe(before.id);
  expect(modules().queue.getQueuePlaybackSyncState().status).toBe('applied');
});

test('observers receive committed changes and external Delete, not rollback/no-op', async () => {
  await seed();
  const { queue, database } = modules();
  const first = jest.fn();
  const second = jest.fn();
  const unsubscribe = queue.observeQueue(first);
  queue.observeQueue(second);
  await queue.listQueue();
  await expect(queue.enqueueLast('missing')).rejects.toThrow();
  expect(first).not.toHaveBeenCalled();
  const entry = await queue.enqueueLast('a');
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  await queue.moveQueueEntry(entry.id, 0);
  await queue.removeQueueEntry('absent');
  expect(first).toHaveBeenCalledTimes(1);
  const db = await database.openLibraryDatabase();
  await db.runAsync("DELETE FROM library_items WHERE id = 'a'");
  libraryChanged?.();
  await queue.listQueue();
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledTimes(2);
  unsubscribe();
  await queue.enqueueLast('b');
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledTimes(3);
});

test('concurrent Queue writes remain complete, unique and compact', async () => {
  await seed();
  const { queue } = modules();
  await Promise.all([
    queue.enqueueNext('a'),
    queue.enqueueLast('b'),
    queue.enqueueNext('c'),
    queue.enqueueLast('a'),
  ]);
  expect(await itemIds()).toEqual(['c', 'a', 'b', 'a']);
  await assertCompact();
});

test('concurrent enqueue and Library Delete cannot leave an orphan', async () => {
  await seed();
  const { queue, database } = modules();
  const results = await Promise.allSettled([
    queue.enqueueLast('a'),
    database.withLibraryForeignKeyTransaction(async (txn) => {
      await txn.runAsync("DELETE FROM library_items WHERE id = 'a'");
    }),
  ]);
  expect(results[1]?.status).toBe('fulfilled');
  if (results[0]?.status === 'rejected')
    expect(results[0].reason).toEqual(
      new Error('La descarga ya no está disponible.'),
    );
  expect(await queue.listQueue()).toEqual([]);
  await assertCompact();
  const db = await database.openLibraryDatabase();
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

test('external cascade gaps are repaired transactionally before public read', async () => {
  await seed();
  const { queue, database } = modules();
  await queue.enqueueLast('a');
  await queue.enqueueLast('b');
  await queue.enqueueLast('c');
  const db = await database.openLibraryDatabase();
  await db.runAsync("DELETE FROM library_items WHERE id = 'b'");
  const raw = new DatabaseSync(path);
  expect(
    raw.prepare('SELECT position FROM playback_queue ORDER BY position').all(),
  ).toEqual([{ position: 0 }, { position: 2 }]);
  raw.close();
  expect(await itemIds()).toEqual(['a', 'c']);
  await assertCompact();
});

test('native ACK observes committed rows on a separate SQLite connection, never a snapshot argument', async () => {
  await seed();
  const seen: string[][] = [];
  queueDidChange.mockImplementation(async (...args: unknown[]) => {
    expect(args).toEqual([]);
    const raw = new DatabaseSync(path);
    seen.push(
      raw
        .prepare('SELECT itemId FROM playback_queue ORDER BY position')
        .all()
        .map((r) => String(r.itemId)),
    );
    raw.close();
    return { status: 'applied' };
  });
  const { queue } = modules();
  const a = await queue.enqueueLast('a');
  const b = await queue.enqueueNext('b');
  await queue.moveQueueEntry(a.id, 0);
  await queue.removeQueueEntry(b.id);
  await queue.clearQueue();
  expect(seen).toEqual([['a'], ['b', 'a'], ['a', 'b'], ['a'], []]);
  expect(queue.getQueuePlaybackSyncState()).toEqual({
    status: 'applied',
    lastResult: 'applied',
  });
});

test('a failed bridge preserves the committed entry and exposes pending sync; list retries', async () => {
  await seed();
  const { queue } = modules();
  queueDidChange.mockRejectedValueOnce(
    new Error('file:///private/native.sqlite'),
  );
  const saved = await queue.enqueueLast('a');
  expect(saved.itemId).toBe('a');
  expect(queue.getQueuePlaybackSyncState()).toEqual({
    status: 'pending',
    lastResult: 'failed',
  });
  expect(JSON.stringify(queue.getQueuePlaybackSyncState())).not.toContain(
    'file://',
  );
  expect(await queue.listQueue()).toEqual([saved]);
  expect(queueDidChange).toHaveBeenCalledTimes(2);
  expect(queue.getQueuePlaybackSyncState().status).toBe('applied');
});

test('superseded ACK means saved but not yet applied, not a failed SQLite mutation', async () => {
  await seed();
  const { queue } = modules();
  queueDidChange.mockResolvedValueOnce({ status: 'superseded' });
  const saved = await queue.enqueueNext('a');
  expect(queue.getQueuePlaybackSyncState()).toEqual({
    status: 'pending',
    lastResult: 'superseded',
  });
  expect((await queue.listQueue())[0]?.id).toBe(saved.id);
  expect(queue.getQueuePlaybackSyncState().status).toBe('applied');
});

test('rollback and true no-ops do not send native notices or Queue events', async () => {
  await seed();
  const { queue } = modules();
  await queue.clearQueue();
  await queue.removeQueueEntry('absent');
  expect(queueDidChange).not.toHaveBeenCalled();
  const a = await queue.enqueueLast('a');
  queueDidChange.mockClear();
  await queue.moveQueueEntry(a.id, 0);
  expect(queueDidChange).not.toHaveBeenCalled();
  const realRun = RealSQLite.prototype.runAsync;
  jest
    .spyOn(RealSQLite.prototype, 'runAsync')
    .mockImplementation(async function (this: RealSQLite, sql, ...params) {
      if (sql.startsWith('INSERT INTO playback_queue'))
        throw new Error('injected rollback');
      return realRun.call(this, sql, ...params);
    });
  await expect(queue.enqueueLast('b')).rejects.toThrow('No se pudo actualizar');
  expect(queueDidChange).not.toHaveBeenCalled();
  expect(await queue.listQueue()).toEqual([a]);
});

test('duplicate native consume events refresh SQLite once without an ACK echo', async () => {
  await seed();
  const { queue, database } = modules();
  const a = await queue.enqueueLast('a');
  const b = await queue.enqueueLast('b');
  const listener = jest.fn();
  const unsubscribe = queue.observeQueue(listener);
  await queue.listQueue();
  listener.mockClear();
  queueDidChange.mockClear();
  await database.withLibraryForeignKeyTransaction(async (txn) => {
    await txn.runAsync('DELETE FROM playback_queue WHERE id = ?', a.id);
    await txn.runAsync(
      'UPDATE playback_queue SET position = 0 WHERE id = ?',
      b.id,
    );
  });
  nativeChanged?.();
  nativeChanged?.();
  expect((await queue.listQueue()).map((r) => r.id)).toEqual([b.id]);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(queueDidChange).not.toHaveBeenCalled();
  unsubscribe();
  expect(removeNative).toHaveBeenCalledTimes(1);
  expect(removeAppState).toHaveBeenCalledTimes(1);
});

test('Library Delete triggers a post-commit ACK only if the Queue snapshot changed', async () => {
  await seed();
  const { queue, database } = modules();
  await queue.enqueueLast('a');
  const stop = queue.observeQueue(jest.fn());
  await queue.listQueue();
  queueDidChange.mockClear();
  libraryChanged?.();
  await queue.listQueue();
  expect(queueDidChange).not.toHaveBeenCalled();
  await database.withLibraryForeignKeyTransaction(async (txn) => {
    await txn.runAsync("DELETE FROM library_items WHERE id = 'a'");
  });
  libraryChanged?.();
  expect(await queue.listQueue()).toEqual([]);
  expect(queueDidChange).toHaveBeenCalledTimes(1);
  stop();
});

test('foreground and resubscribe recover missed native consumption without JS history', async () => {
  await seed();
  const { queue, database } = modules();
  await queue.enqueueLast('a');
  let stop = queue.observeQueue(jest.fn());
  await queue.listQueue();
  stop();
  await database.withLibraryForeignKeyTransaction(async (txn) => {
    await txn.runAsync('DELETE FROM playback_queue');
  });
  // There was no JS subscriber when native committed.
  expect(nativeChanged).toBeNull();
  const listener = jest.fn();
  stop = queue.observeQueue(listener);
  expect(await queue.listQueue()).toEqual([]);
  queueDidChange.mockClear();
  foregroundChanged?.('background');
  await queue.listQueue();
  expect(queueDidChange).not.toHaveBeenCalled();
  foregroundChanged?.('active');
  await queue.listQueue();
  expect(queueDidChange).toHaveBeenCalledTimes(1);
  expect(queue.getQueuePlaybackSyncState().status).toBe('applied');
  stop();
});

test('rapid writes keep their durable order and each receives its own ACK', async () => {
  await seed();
  const { queue } = modules();
  await Promise.all([
    queue.enqueueNext('a'),
    queue.enqueueLast('b'),
    queue.enqueueNext('c'),
  ]);
  expect(await itemIds()).toEqual(['c', 'a', 'b']);
  expect(queueDidChange).toHaveBeenCalledTimes(3);
});

test('a newer mutation commits and applies while an older ACK is still pending', async () => {
  await seed();
  const { queue } = modules();
  let release!: (value: { status: string }) => void;
  queueDidChange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = queue.enqueueLast('a');
  for (let n = 0; n < 100 && queueDidChange.mock.calls.length < 1; n += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
  expect(queueDidChange).toHaveBeenCalledTimes(1);
  const second = queue.enqueueNext('b');
  for (let n = 0; n < 100 && queueDidChange.mock.calls.length < 2; n += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
  const raw = new DatabaseSync(path);
  const beforeOldACK = raw
    .prepare('SELECT itemId FROM playback_queue ORDER BY position')
    .all()
    .map((row) => row.itemId);
  raw.close();
  const stateBeforeOldACK = queue.getQueuePlaybackSyncState();
  release({ status: 'failed' });
  await Promise.all([first, second]);
  expect(beforeOldACK).toEqual(['b', 'a']);
  expect(stateBeforeOldACK.status).toBe('applied');
  expect(queue.getQueuePlaybackSyncState().status).toBe('applied');
});

test('a delayed old applied ACK cannot erase a newer pending failure', async () => {
  await seed();
  const { queue } = modules();
  let release!: (value: { status: string }) => void;
  queueDidChange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  queueDidChange.mockResolvedValueOnce({ status: 'failed' });
  const first = queue.enqueueLast('a');
  for (let n = 0; n < 100 && queueDidChange.mock.calls.length < 1; n += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
  await queue.enqueueLast('b');
  release({ status: 'applied' });
  await first;
  expect(queue.getQueuePlaybackSyncState()).toEqual({
    status: 'pending',
    lastResult: 'failed',
  });
});

test('reads reuse an in-flight ACK instead of invalidating the same preparation', async () => {
  await seed();
  const { queue } = modules();
  let release!: (value: { status: string }) => void;
  queueDidChange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const saved = queue.enqueueLast('a');
  for (let n = 0; n < 100 && queueDidChange.mock.calls.length < 1; n += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
  const read = queue.listQueue();
  for (let n = 0; n < 10; n += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
  const calls = queueDidChange.mock.calls.length;
  release({ status: 'applied' });
  expect(await read).toEqual([await saved]);
  expect(calls).toBe(1);
});

test('an ACK timeout preserves SQLite and leaves playback sync pending', async () => {
  await seed();
  const { queue } = modules();
  jest.useFakeTimers();
  try {
    queueDidChange.mockImplementationOnce(() => new Promise(() => undefined));
    const operation = queue.enqueueLast('a');
    for (let n = 0; n < 100 && queueDidChange.mock.calls.length < 1; n += 1)
      await Promise.resolve();
    expect(queueDidChange).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5_000);
    const saved = await operation;
    expect(queue.getQueuePlaybackSyncState()).toEqual({
      status: 'pending',
      lastResult: 'failed',
    });
    const raw = new DatabaseSync(path);
    expect(raw.prepare('SELECT id FROM playback_queue').all()).toEqual([
      { id: saved.id },
    ]);
    raw.close();
  } finally {
    jest.useRealTimers();
  }
});

test('sync observers expose pending separately and cannot mutate the service state', async () => {
  await seed();
  const { queue } = modules();
  const states: string[] = [];
  const stop = queue.observeQueuePlaybackSync(() =>
    states.push(queue.getQueuePlaybackSyncState().status),
  );
  await queue.listQueue();
  queueDidChange.mockResolvedValueOnce({ status: 'failed' });
  await queue.enqueueLast('a');
  expect(states).toContain('pending');
  expect(queue.getQueuePlaybackSyncState().status).toBe('pending');
  const copied = queue.getQueuePlaybackSyncState();
  copied.status = 'applied';
  expect(queue.getQueuePlaybackSyncState().status).toBe('pending');
  await queue.listQueue();
  expect(queue.getQueuePlaybackSyncState().status).toBe('applied');
  stop();
});
