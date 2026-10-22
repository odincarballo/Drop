import { requireOptionalNativeModule } from 'expo';
import * as SQLite from 'expo-sqlite';

type SqlAccess = Pick<
  SQLite.SQLiteDatabase,
  'execAsync' | 'getAllAsync' | 'getFirstAsync'
>;
type SchemaObject = { name: string; type: string; sql: string | null };
type Column = {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value?: string | null;
};
type Index = { name: string; unique: number };
type IndexColumn = { name: string | null; desc: number; key: number };
type ForeignKey = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

const SCHEMA_VERSION = 3;
const DROP_OBJECTS = [
  'library_items',
  'library_items_recent',
  'collections',
  'collection_items',
  'collection_items_by_item',
  'collection_items_recent',
  'playback_queue',
  'playback_queue_position',
  'playback_queue_by_item',
] as const;

// The v1 definition is unchanged. A fresh installation creates it alongside
// v2/v3 in one transaction; an existing v1 installation never recreates it.
const LIBRARY_SCHEMA = `
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
  CREATE INDEX library_items_recent
    ON library_items(lifecycle, downloadedAt DESC);
`;

const COLLECTIONS_SCHEMA = `
  CREATE TABLE collections (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    normalizedName TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE collection_items (
    collectionId TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    addedAt TEXT NOT NULL,
    PRIMARY KEY (collectionId, itemId)
  );
  CREATE INDEX collection_items_by_item
    ON collection_items(itemId, collectionId);
  CREATE INDEX collection_items_recent
    ON collection_items(collectionId, addedAt DESC, itemId DESC);
`;

const QUEUE_SCHEMA = `
  CREATE TABLE playback_queue (
    id TEXT PRIMARY KEY NOT NULL,
    itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    addedAt TEXT NOT NULL
  );
  CREATE UNIQUE INDEX playback_queue_position ON playback_queue(position);
  CREATE INDEX playback_queue_by_item ON playback_queue(itemId, position);
`;

const LIBRARY_COLUMNS: Column[] = [
  { name: 'id', type: 'TEXT', notnull: 1, pk: 1 },
  { name: 'sourceKind', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'sourceVideoId', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'title', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'mediaType', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'relativeMediaPath', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'relativeArtworkPath', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'sourceCacheRelativePath', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'durationSeconds', type: 'REAL', notnull: 0, pk: 0 },
  { name: 'sizeBytes', type: 'INTEGER', notnull: 1, pk: 0 },
  {
    name: 'artworkSizeBytes',
    type: 'INTEGER',
    notnull: 1,
    pk: 0,
    dflt_value: '0',
  },
  { name: 'resolution', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'height', type: 'INTEGER', notnull: 0, pk: 0 },
  { name: 'fps', type: 'REAL', notnull: 0, pk: 0 },
  { name: 'videoCodec', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'audioCodec', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'container', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'downloadedAt', type: 'TEXT', notnull: 1, pk: 0 },
  {
    name: 'playbackPositionSeconds',
    type: 'REAL',
    notnull: 1,
    pk: 0,
    dflt_value: '0',
  },
  { name: 'completedAt', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'lifecycle', type: 'TEXT', notnull: 1, pk: 0 },
];
const COLLECTION_COLUMNS: Column[] = [
  { name: 'id', type: 'TEXT', notnull: 1, pk: 1 },
  { name: 'name', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'normalizedName', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'createdAt', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'updatedAt', type: 'TEXT', notnull: 1, pk: 0 },
];
const MEMBERSHIP_COLUMNS: Column[] = [
  { name: 'collectionId', type: 'TEXT', notnull: 1, pk: 1 },
  { name: 'itemId', type: 'TEXT', notnull: 1, pk: 2 },
  { name: 'addedAt', type: 'TEXT', notnull: 1, pk: 0 },
];
const QUEUE_COLUMNS: Column[] = [
  { name: 'id', type: 'TEXT', notnull: 1, pk: 1 },
  { name: 'itemId', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'position', type: 'INTEGER', notnull: 1, pk: 0 },
  { name: 'addedAt', type: 'TEXT', notnull: 1, pk: 0 },
];

let opening: Promise<SQLite.SQLiteDatabase> | null = null;
let preparedDirectoryURL: string | null = null;

function invalidSchema(): never {
  throw new Error(
    'El esquema de la Biblioteca es inconsistente. No se modificaron sus datos.',
  );
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function objects(db: SqlAccess): Promise<Map<string, SchemaObject>> {
  const rows = await db.getAllAsync<SchemaObject>(
    `SELECT name, type, sql FROM sqlite_master WHERE name IN (${DROP_OBJECTS.map(
      (name) => `'${name}'`,
    ).join(',')})`,
  );
  return new Map(rows.map((row) => [row.name, row]));
}

function expectObjects(
  found: Map<string, SchemaObject>,
  version: number,
): void {
  const expected = new Map<string, string>();
  if (version >= 1) {
    expected.set('library_items', 'table');
    expected.set('library_items_recent', 'index');
  }
  if (version >= 2) {
    expected.set('collections', 'table');
    expected.set('collection_items', 'table');
    expected.set('collection_items_by_item', 'index');
    expected.set('collection_items_recent', 'index');
  }
  if (version >= 3) {
    expected.set('playback_queue', 'table');
    expected.set('playback_queue_position', 'index');
    expected.set('playback_queue_by_item', 'index');
  }
  if (
    found.size !== expected.size ||
    [...expected].some(([name, type]) => found.get(name)?.type !== type)
  )
    invalidSchema();
}

async function expectColumns(
  db: SqlAccess,
  table: string,
  expected: Column[],
): Promise<void> {
  const found = await db.getAllAsync<Column>(
    `PRAGMA table_info(${identifier(table)})`,
  );
  if (
    found.length !== expected.length ||
    expected.some((column, index) => {
      const actual = found[index];
      return (
        !actual ||
        actual.name !== column.name ||
        actual.type.toUpperCase() !== column.type ||
        actual.notnull !== column.notnull ||
        actual.pk !== column.pk ||
        (column.dflt_value !== undefined &&
          actual.dflt_value !== column.dflt_value)
      );
    })
  )
    invalidSchema();
}

async function indexColumns(
  db: SqlAccess,
  index: string,
): Promise<[string | null, number][]> {
  const rows = await db.getAllAsync<IndexColumn>(
    `PRAGMA index_xinfo(${identifier(index)})`,
  );
  return rows.filter((row) => row.key === 1).map((row) => [row.name, row.desc]);
}

async function expectIndex(
  db: SqlAccess,
  table: string,
  name: string,
  columns: [string, number][],
  unique = false,
): Promise<void> {
  const indexes = await db.getAllAsync<Index>(
    `PRAGMA index_list(${identifier(table)})`,
  );
  if (
    !indexes.some(
      (index) => index.name === name && index.unique === Number(unique),
    )
  )
    invalidSchema();
  const actual = await indexColumns(db, name);
  if (
    actual.length !== columns.length ||
    columns.some(([column, desc], position) => {
      const entry = actual[position];
      return !entry || entry[0] !== column || entry[1] !== desc;
    })
  )
    invalidSchema();
}

async function expectUnique(
  db: SqlAccess,
  table: string,
  column: string,
): Promise<void> {
  const indexes = await db.getAllAsync<Index>(
    `PRAGMA index_list(${identifier(table)})`,
  );
  for (const index of indexes.filter((entry) => entry.unique === 1)) {
    const keys = await indexColumns(db, index.name);
    if (keys.length === 1 && keys[0]?.[0] === column) return;
  }
  invalidSchema();
}

async function validateStructure(
  db: SqlAccess,
  version: number,
): Promise<void> {
  const found = await objects(db);
  expectObjects(found, version);
  if (version >= 1) {
    await expectColumns(db, 'library_items', LIBRARY_COLUMNS);
    await expectIndex(db, 'library_items', 'library_items_recent', [
      ['lifecycle', 0],
      ['downloadedAt', 1],
    ]);
    await expectUnique(db, 'library_items', 'relativeMediaPath');
    const definition = found
      .get('library_items')
      ?.sql?.toLowerCase()
      .replaceAll(/\s+/g, '');
    if (
      !definition?.includes("check(sourcekindin('youtube','direct'))") ||
      !definition.includes("check(mediatypein('video','audio'))") ||
      !definition.includes("check(lifecyclein('pending','ready','deleting'))")
    )
      invalidSchema();
  }
  if (version >= 2) {
    await expectColumns(db, 'collections', COLLECTION_COLUMNS);
    await expectColumns(db, 'collection_items', MEMBERSHIP_COLUMNS);
    await expectUnique(db, 'collections', 'normalizedName');
    await expectIndex(db, 'collection_items', 'collection_items_by_item', [
      ['itemId', 0],
      ['collectionId', 0],
    ]);
    await expectIndex(db, 'collection_items', 'collection_items_recent', [
      ['collectionId', 0],
      ['addedAt', 1],
      ['itemId', 1],
    ]);
    const keys = await db.getAllAsync<ForeignKey>(
      'PRAGMA foreign_key_list("collection_items")',
    );
    if (
      keys.length !== 2 ||
      !keys.some(
        (key) =>
          key.from === 'collectionId' &&
          key.table === 'collections' &&
          key.to === 'id' &&
          key.on_delete.toUpperCase() === 'CASCADE',
      ) ||
      !keys.some(
        (key) =>
          key.from === 'itemId' &&
          key.table === 'library_items' &&
          key.to === 'id' &&
          key.on_delete.toUpperCase() === 'CASCADE',
      )
    )
      invalidSchema();
  }
  if (version >= 3) {
    await expectColumns(db, 'playback_queue', QUEUE_COLUMNS);
    await expectIndex(
      db,
      'playback_queue',
      'playback_queue_position',
      [['position', 0]],
      true,
    );
    await expectIndex(db, 'playback_queue', 'playback_queue_by_item', [
      ['itemId', 0],
      ['position', 0],
    ]);
    const keys = await db.getAllAsync<ForeignKey>(
      'PRAGMA foreign_key_list("playback_queue")',
    );
    const definition = found
      .get('playback_queue')
      ?.sql?.toLowerCase()
      .replaceAll(/\s+/g, '');
    if (
      keys.length !== 1 ||
      keys[0]?.from !== 'itemId' ||
      keys[0].table !== 'library_items' ||
      keys[0].to !== 'id' ||
      keys[0].on_delete.toUpperCase() !== 'CASCADE' ||
      !definition?.includes('check(position>=0)')
    )
      invalidSchema();
  }
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const storage = requireOptionalNativeModule<{
    prepare(): Promise<{ databaseDirectoryURL: string }>;
  }>('DropLibrary');
  if (!storage)
    throw new Error('Esta versión de Drop no incluye la Biblioteca nativa.');
  const { databaseDirectoryURL } = await storage.prepare();
  const db = await SQLite.openDatabaseAsync(
    'library.sqlite',
    {},
    databaseDirectoryURL,
  );
  try {
    // Inspect version before any persistent PRAGMA or schema write. In particular,
    // never switch a future database to WAL while rejecting it.
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const version = row?.user_version;
    if (version === undefined || !Number.isInteger(version) || version < 0)
      invalidSchema();
    if (version > SCHEMA_VERSION)
      throw new Error('La Biblioteca usa una versión de datos más reciente.');

    await db.execAsync('PRAGMA foreign_keys = ON');
    const foreignKeys = await db.getFirstAsync<{ foreign_keys: number }>(
      'PRAGMA foreign_keys',
    );
    if (foreignKeys?.foreign_keys !== 1)
      throw new Error('No se pudo activar la integridad de la Biblioteca.');

    await validateStructure(db, version);
    await db.execAsync('PRAGMA journal_mode = WAL');
    if (version === SCHEMA_VERSION) {
      preparedDirectoryURL = databaseDirectoryURL;
      return db;
    }
    await db.withExclusiveTransactionAsync(async (txn) => {
      await validateStructure(txn, version);
      if (version < 1) await txn.execAsync(LIBRARY_SCHEMA);
      if (version < 2) await txn.execAsync(COLLECTIONS_SCHEMA);
      if (version < 3) await txn.execAsync(QUEUE_SCHEMA);
      await validateStructure(txn, SCHEMA_VERSION);
      await txn.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    const upgraded = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    if (upgraded?.user_version !== SCHEMA_VERSION) invalidSchema();
    preparedDirectoryURL = databaseDirectoryURL;
    return db;
  } catch (error) {
    preparedDirectoryURL = null;
    try {
      await db.closeAsync();
    } catch {
      // Preserve the original error; a later open still creates a new handle.
    }
    throw error;
  }
}

export function openLibraryDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = open().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

/** Expo's exclusive transaction opens another SQLite connection and begins
 * before its callback, so it cannot inherit or enable the main connection's
 * foreign_keys setting. Configure a private connection before BEGIN instead.
 */
export async function withLibraryForeignKeyTransaction<T>(
  action: (txn: SQLite.SQLiteDatabase) => Promise<T>,
  busyTimeoutMs = 5000,
): Promise<T> {
  if (
    !Number.isSafeInteger(busyTimeoutMs) ||
    busyTimeoutMs < 0 ||
    busyTimeoutMs > 60000
  )
    throw new Error('Tiempo de espera SQLite no válido.');
  await openLibraryDatabase();
  if (!preparedDirectoryURL)
    throw new Error('No se pudo preparar la integridad de la Biblioteca.');
  const txn = await SQLite.openDatabaseAsync(
    'library.sqlite',
    { useNewConnection: true },
    preparedDirectoryURL,
  );
  let inTransaction = false;
  try {
    await txn.execAsync('PRAGMA foreign_keys = ON');
    const setting = await txn.getFirstAsync<{ foreign_keys: number }>(
      'PRAGMA foreign_keys',
    );
    if (setting?.foreign_keys !== 1)
      throw new Error('No se pudo activar la integridad de la Biblioteca.');
    // BEGIN IMMEDIATE serializes Queue writes with Library Delete on their
    // separate connections. A short wait avoids treating ordinary contention
    // as a lost user action.
    await txn.execAsync(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    await txn.execAsync('BEGIN IMMEDIATE');
    inTransaction = true;
    const result = await action(txn);
    await txn.execAsync('COMMIT');
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        await txn.execAsync('ROLLBACK');
      } catch {
        // Preserve the original failure; never report a failed write as valid.
      }
    }
    throw error;
  } finally {
    await txn.closeAsync();
  }
}
