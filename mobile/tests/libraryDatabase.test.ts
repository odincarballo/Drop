/** @jest-environment node */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RealSQLite } from './support/realSQLite';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const V1_SCHEMA = `
  CREATE TABLE library_items (
    id TEXT PRIMARY KEY NOT NULL,
    sourceKind TEXT NOT NULL CHECK(sourceKind IN ('youtube','direct')),
    sourceVideoId TEXT,
    title TEXT NOT NULL,
    mediaType TEXT NOT NULL CHECK(mediaType IN ('video','audio')),
    relativeMediaPath TEXT NOT NULL UNIQUE,
    relativeArtworkPath TEXT,
    sourceCacheRelativePath TEXT,
    durationSeconds REAL,
    sizeBytes INTEGER NOT NULL,
    artworkSizeBytes INTEGER NOT NULL DEFAULT 0,
    resolution TEXT,
    height INTEGER,
    fps REAL,
    videoCodec TEXT,
    audioCodec TEXT,
    container TEXT,
    downloadedAt TEXT NOT NULL,
    playbackPositionSeconds REAL NOT NULL DEFAULT 0,
    completedAt TEXT,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('pending','ready','deleting'))
  );
  CREATE INDEX library_items_recent ON library_items(lifecycle, downloadedAt DESC);
  PRAGMA user_version = 1;
`;

let directory: string;
let path: string;
let connections: RealSQLite[];
let injectFailure: boolean;
let injectQueueFailure: boolean;
let unavailableForeignKeys: boolean;

function raw(): DatabaseSync {
  return new DatabaseSync(path);
}

function seedV1(): void {
  const db = raw();
  try {
    db.exec(V1_SCHEMA);
    const insert = db.prepare(`INSERT INTO library_items (
      id, sourceKind, sourceVideoId, title, mediaType, relativeMediaPath,
      relativeArtworkPath, durationSeconds, sizeBytes, artworkSizeBytes,
      resolution, height, fps, videoCodec, audioCodec, container,
      downloadedAt, playbackPositionSeconds, completedAt, lifecycle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run(
      'video-a',
      'youtube',
      'AWGPaFraPN4',
      'Vídeo A',
      'video',
      'Media/video-a.mp4',
      'Artwork/video-a.jpg',
      7200,
      457000000,
      12000,
      '1080p',
      1080,
      30,
      'h264',
      'aac',
      'mp4',
      '2026-01-01T10:00:00.000Z',
      731.5,
      null,
      'ready',
    );
    insert.run(
      'audio-b',
      'direct',
      null,
      'Audio B',
      'audio',
      'Media/audio-b.m4a',
      null,
      9000,
      120000000,
      0,
      null,
      null,
      null,
      null,
      'aac',
      'm4a',
      '2026-02-01T10:00:00.000Z',
      9000,
      '2026-02-01T12:30:00.000Z',
      'ready',
    );
  } finally {
    db.close();
  }
}

function seedV2(): void {
  seedV1();
  const db = raw();
  try {
    db.exec(`
      CREATE TABLE collections (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
        normalizedName TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE collection_items (
        collectionId TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        addedAt TEXT NOT NULL, PRIMARY KEY (collectionId, itemId)
      );
      CREATE INDEX collection_items_by_item ON collection_items(itemId, collectionId);
      CREATE INDEX collection_items_recent ON collection_items(collectionId, addedAt DESC, itemId DESC);
      INSERT INTO collections VALUES ('c1', 'Courses', 'courses', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
      INSERT INTO collection_items VALUES ('c1', 'video-a', '2026-02-02T00:00:00.000Z');
      PRAGMA user_version = 2;
    `);
  } finally {
    db.close();
  }
}

function snapshot(): Record<string, unknown>[] {
  const db = raw();
  try {
    return db.prepare('SELECT * FROM library_items ORDER BY id').all();
  } finally {
    db.close();
  }
}

async function openProduction() {
  return (
    require('@/services/libraryDatabase') as typeof import('@/services/libraryDatabase')
  ).openLibraryDatabase();
}

function configureMocks(): void {
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockReturnValue({
    prepare: async () => ({ databaseDirectoryURL: `file://${directory}/` }),
  });
  const sqlite = require('expo-sqlite') as { openDatabaseAsync: jest.Mock };
  sqlite.openDatabaseAsync.mockImplementation(async () => {
    const connection = new RealSQLite(path);
    connection.failAfterCollectionsTable = injectFailure;
    connection.failAfterQueueTable = injectQueueFailure;
    connection.foreignKeysUnavailable = unavailableForeignKeys;
    connections.push(connection);
    return connection;
  });
}

beforeEach(() => {
  jest.resetModules();
  directory = mkdtempSync(join(tmpdir(), 'drop-schema-v3-'));
  path = join(directory, 'library.sqlite');
  connections = [];
  injectFailure = false;
  injectQueueFailure = false;
  unavailableForeignKeys = false;
  configureMocks();
});

afterEach(async () => {
  await Promise.all(connections.map((connection) => connection.closeAsync()));
  rmSync(directory, { recursive: true, force: true });
});

test('clean v0 becomes complete v3 with foreign keys and WAL', async () => {
  const db = await openProduction();
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 3,
  });
  expect(await db.getFirstAsync('PRAGMA foreign_keys')).toEqual({
    foreign_keys: 1,
  });
  expect(await db.getFirstAsync('PRAGMA journal_mode')).toEqual({
    journal_mode: 'wal',
  });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM library_items'),
  ).toEqual({ count: 0 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collections'),
  ).toEqual({ count: 0 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collection_items'),
  ).toEqual({ count: 0 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM playback_queue'),
  ).toEqual({ count: 0 });
});

test('Expo exclusive transaction has a new connection without parent foreign keys', async () => {
  const db = await openProduction();
  expect(await db.getFirstAsync('PRAGMA foreign_keys')).toEqual({
    foreign_keys: 1,
  });
  await db.withExclusiveTransactionAsync(async (txn) => {
    expect(await txn.getFirstAsync('PRAGMA foreign_keys')).toEqual({
      foreign_keys: 0,
    });
    await txn.execAsync('PRAGMA foreign_keys = ON');
    expect(await txn.getFirstAsync('PRAGMA foreign_keys')).toEqual({
      foreign_keys: 0,
    });
  });
});

test('foreign-key transaction fails closed if its own connection cannot enable FKs', async () => {
  const module =
    require('@/services/libraryDatabase') as typeof import('@/services/libraryDatabase');
  const db = await module.openLibraryDatabase();
  await db.execAsync(
    "INSERT INTO library_items (id, sourceKind, title, mediaType, relativeMediaPath, sizeBytes, downloadedAt, lifecycle) VALUES ('i', 'direct', 'i', 'video', 'Media/i.mp4', 100, 'now', 'ready')",
  );
  unavailableForeignKeys = true;
  await expect(
    module.withLibraryForeignKeyTransaction(async (txn) => {
      await txn.runAsync("DELETE FROM library_items WHERE id = 'i'");
    }),
  ).rejects.toThrow('integridad');
  expect(
    await db.getFirstAsync(
      "SELECT COUNT(*) AS count FROM library_items WHERE id = 'i'",
    ),
  ).toEqual({ count: 1 });
});

test('v1 migration preserves every library field and starts with no memberships or queue', async () => {
  seedV1();
  const before = snapshot();
  const db = await openProduction();
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 3,
  });
  expect(snapshot()).toEqual(before);
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collections'),
  ).toEqual({ count: 0 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collection_items'),
  ).toEqual({ count: 0 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM playback_queue'),
  ).toEqual({ count: 0 });
});

test('v2 to v3 preserves Library, progress, completion, Collections and memberships', async () => {
  seedV2();
  const before = snapshot();
  const legacy = raw();
  const collections = legacy.prepare('SELECT * FROM collections').all();
  const memberships = legacy.prepare('SELECT * FROM collection_items').all();
  legacy.close();
  const db = await openProduction();
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 3,
  });
  expect(snapshot()).toEqual(before);
  expect(await db.getAllAsync('SELECT * FROM collections')).toEqual(
    collections,
  );
  expect(await db.getAllAsync('SELECT * FROM collection_items')).toEqual(
    memberships,
  );
  expect(await db.getAllAsync('SELECT * FROM playback_queue')).toEqual([]);
});

test('v2 to v3 failure rolls back entirely and can retry', async () => {
  seedV2();
  const before = snapshot();
  injectQueueFailure = true;
  await expect(openProduction()).rejects.toThrow('injected migration failure');
  const check = raw();
  expect(check.prepare('PRAGMA user_version').get()).toEqual({
    user_version: 2,
  });
  expect(
    check
      .prepare("SELECT name FROM sqlite_master WHERE name = 'playback_queue'")
      .get(),
  ).toBeUndefined();
  expect(
    check.prepare('SELECT COUNT(*) AS count FROM collection_items').get(),
  ).toEqual({ count: 1 });
  check.close();
  expect(snapshot()).toEqual(before);
  injectQueueFailure = false;
  const db = await openProduction();
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 3,
  });
  expect(await db.getAllAsync('SELECT * FROM playback_queue')).toEqual([]);
  expect(snapshot()).toEqual(before);
});

test('v3 queue has cascade FK, nonnegative positions and authoritative indexes', async () => {
  seedV2();
  await openProduction();
  const db = raw();
  db.exec('PRAGMA foreign_keys = ON');
  expect(db.prepare('PRAGMA foreign_key_list("playback_queue")').all()).toEqual(
    [
      expect.objectContaining({
        table: 'library_items',
        from: 'itemId',
        to: 'id',
        on_delete: 'CASCADE',
      }),
    ],
  );
  const indexes = db.prepare('PRAGMA index_list("playback_queue")').all();
  expect(indexes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'playback_queue_position', unique: 1 }),
      expect.objectContaining({ name: 'playback_queue_by_item', unique: 0 }),
    ]),
  );
  db.exec(
    "INSERT INTO playback_queue VALUES ('q1', 'video-a', 0, '2026-01-01T00:00:00.000Z')",
  );
  expect(() =>
    db.exec(
      "INSERT INTO playback_queue VALUES ('q2', 'audio-b', 0, '2026-01-01T00:00:00.000Z')",
    ),
  ).toThrow();
  expect(() =>
    db.exec(
      "INSERT INTO playback_queue VALUES ('q3', 'audio-b', -1, '2026-01-01T00:00:00.000Z')",
    ),
  ).toThrow();
  db.close();
});

test.each([
  'DROP TABLE playback_queue',
  'DROP INDEX playback_queue_position',
  'DROP INDEX playback_queue_by_item',
  `DROP INDEX playback_queue_position;
   CREATE INDEX playback_queue_position ON playback_queue(position)`,
  `DROP TABLE playback_queue;
   CREATE TABLE playback_queue (id TEXT PRIMARY KEY NOT NULL, itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE, position INTEGER NOT NULL, addedAt TEXT NOT NULL);
   CREATE UNIQUE INDEX playback_queue_position ON playback_queue(position);
   CREATE INDEX playback_queue_by_item ON playback_queue(itemId, position)`,
  `DROP TABLE playback_queue;
   CREATE TABLE playback_queue (id TEXT PRIMARY KEY NOT NULL, itemId TEXT NOT NULL REFERENCES library_items(id), position INTEGER NOT NULL CHECK(position >= 0), addedAt TEXT NOT NULL);
   CREATE UNIQUE INDEX playback_queue_position ON playback_queue(position);
   CREATE INDEX playback_queue_by_item ON playback_queue(itemId, position)`,
])(
  'malformed v3 Queue schema is rejected without repair: %s',
  async (mutation) => {
    await openProduction();
    await connections[0]?.closeAsync();
    const db = raw();
    db.exec(mutation);
    db.close();
    jest.resetModules();
    configureMocks();
    await expect(openProduction()).rejects.toThrow('inconsistente');
    expect(connections[1]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
  },
);

test('v3 reopen validates without rerunning DDL', async () => {
  await openProduction();
  await connections[0]?.closeAsync();
  jest.resetModules();
  configureMocks();
  const reopened = await openProduction();
  expect(await reopened.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 3,
  });
  expect(
    connections[1]?.executed.some((sql) => sql.includes('CREATE TABLE')),
  ).toBe(false);
});

test('LibraryItem deletion cascades membership but retains Collection', async () => {
  seedV1();
  const db = await openProduction();
  await db.execAsync(`INSERT INTO collections VALUES ('c1', 'Courses', 'courses', 'now', 'now');
    INSERT INTO collection_items VALUES ('c1', 'video-a', 'now');
    DELETE FROM library_items WHERE id = 'video-a';`);
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collection_items'),
  ).toEqual({ count: 0 });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collections'),
  ).toEqual({ count: 1 });
});

test('Collection deletion cascades membership but retains LibraryItem', async () => {
  seedV1();
  const db = await openProduction();
  await db.execAsync(`INSERT INTO collections VALUES ('c1', 'Courses', 'courses', 'now', 'now');
    INSERT INTO collection_items VALUES ('c1', 'video-a', 'now');
    DELETE FROM collections WHERE id = 'c1';`);
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM collection_items'),
  ).toEqual({ count: 0 });
  expect(
    await db.getFirstAsync(
      "SELECT COUNT(*) AS count FROM library_items WHERE id = 'video-a'",
    ),
  ).toEqual({ count: 1 });
});

test('future version is rejected before WAL or any schema write', async () => {
  const db = raw();
  db.exec('PRAGMA user_version = 4');
  db.close();
  await expect(openProduction()).rejects.toThrow(
    'versión de datos más reciente',
  );
  expect(connections[0]?.closed).toBe(true);
  expect(connections[0]?.executed).toEqual([]);
  const check = raw();
  expect(check.prepare('PRAGMA user_version').get()).toEqual({
    user_version: 4,
  });
  expect(check.prepare('PRAGMA journal_mode').get()).toEqual({
    journal_mode: 'delete',
  });
  check.close();
});

test('v0 with unexpected Drop table fails closed', async () => {
  const db = raw();
  db.exec('CREATE TABLE library_items (id TEXT)');
  db.close();
  await expect(openProduction()).rejects.toThrow('inconsistente');
  expect(connections[0]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
});

test('v1 with partial v2 object fails closed', async () => {
  seedV1();
  const db = raw();
  db.exec('CREATE TABLE collections (id TEXT)');
  db.close();
  const before = snapshot();
  await expect(openProduction()).rejects.toThrow('inconsistente');
  expect(snapshot()).toEqual(before);
  expect(connections[0]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
});

test('v1 without its required Library index fails closed', async () => {
  seedV1();
  const db = raw();
  db.exec('DROP INDEX library_items_recent');
  db.close();
  const before = snapshot();
  await expect(openProduction()).rejects.toThrow('inconsistente');
  expect(snapshot()).toEqual(before);
  expect(connections[0]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
});

test('v3 missing collections is rejected without repair', async () => {
  await openProduction();
  await connections[0]?.closeAsync();
  const db = raw();
  db.exec('DROP TABLE collections');
  db.close();
  jest.resetModules();
  configureMocks();
  await expect(openProduction()).rejects.toThrow('inconsistente');
  expect(connections[1]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
});

test('v3 missing required index is rejected without repair', async () => {
  await openProduction();
  await connections[0]?.closeAsync();
  const db = raw();
  db.exec('DROP INDEX collection_items_recent');
  db.close();
  jest.resetModules();
  configureMocks();
  await expect(openProduction()).rejects.toThrow('inconsistente');
  expect(connections[1]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
});

test('v3 wrong collection foreign key is rejected without repair', async () => {
  await openProduction();
  await connections[0]?.closeAsync();
  const db = raw();
  db.exec(`DROP TABLE collection_items;
    CREATE TABLE collection_items (
      collectionId TEXT NOT NULL REFERENCES collections(id),
      itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (collectionId, itemId)
    );
    CREATE INDEX collection_items_by_item ON collection_items(itemId, collectionId);
    CREATE INDEX collection_items_recent ON collection_items(collectionId, addedAt DESC, itemId DESC);`);
  db.close();
  jest.resetModules();
  configureMocks();
  await expect(openProduction()).rejects.toThrow('inconsistente');
  expect(connections[1]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
});

test('failure after first v2 DDL rolls back and a new connection retries', async () => {
  seedV1();
  const before = snapshot();
  injectFailure = true;
  await expect(openProduction()).rejects.toThrow('injected migration failure');
  expect(connections[0]?.closed).toBe(true);
  const check = raw();
  expect(check.prepare('PRAGMA user_version').get()).toEqual({
    user_version: 1,
  });
  expect(
    check
      .prepare("SELECT name FROM sqlite_master WHERE name = 'collections'")
      .get(),
  ).toBeUndefined();
  expect(
    check
      .prepare("SELECT name FROM sqlite_master WHERE name = 'collection_items'")
      .get(),
  ).toBeUndefined();
  expect(
    check
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = 'collection_items_recent'",
      )
      .get(),
  ).toBeUndefined();
  check.close();
  expect(snapshot()).toEqual(before);
  injectFailure = false;
  const db = await openProduction();
  expect(connections).toHaveLength(2);
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 3,
  });
  expect(snapshot()).toEqual(before);
});

test('failed clean creation leaves no v1, v2 or v3 objects and can retry', async () => {
  injectFailure = true;
  await expect(openProduction()).rejects.toThrow('injected migration failure');
  expect(connections[0]?.closed).toBe(true);
  const check = raw();
  expect(check.prepare('PRAGMA user_version').get()).toEqual({
    user_version: 0,
  });
  expect(
    check
      .prepare("SELECT name FROM sqlite_master WHERE name = 'library_items'")
      .get(),
  ).toBeUndefined();
  expect(
    check
      .prepare("SELECT name FROM sqlite_master WHERE name = 'collections'")
      .get(),
  ).toBeUndefined();
  check.close();
  injectFailure = false;
  const db = await openProduction();
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 3,
  });
});

test('concurrent callers share the one prepared Expo connection', async () => {
  const [first, second] = await Promise.all([
    openProduction(),
    openProduction(),
  ]);
  expect(first).toBe(second);
  expect(connections).toHaveLength(1);
});

test('foreign key activation failure closes and leaves v1 untouched', async () => {
  seedV1();
  const before = snapshot();
  unavailableForeignKeys = true;
  await expect(openProduction()).rejects.toThrow('integridad');
  expect(connections[0]?.closed).toBe(true);
  expect(connections[0]?.executed).toEqual(['PRAGMA foreign_keys = ON']);
  expect(snapshot()).toEqual(before);
});
