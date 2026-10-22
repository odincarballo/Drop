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
jest.mock('@/services/library', () => ({
  initializeLibrary: jest.fn(async () => undefined),
  observeLibrary: jest.fn(),
}));

let directory: string;
let path: string;
let connections: RealSQLite[];
let libraryChanged: (() => void) | null;
let sequence: number;

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
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockReturnValue({
    prepare: async () => ({ databaseDirectoryURL: `file://${directory}/` }),
    newQueueEntryId: () => `entry-${++sequence}`,
  });
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
