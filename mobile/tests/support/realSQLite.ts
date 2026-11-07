import { DatabaseSync } from 'node:sqlite';

type Param = string | number | null;

export const V1_SCHEMA = `
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

export const V2_COLLECTIONS_SCHEMA = `
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
`;

/** Expo SQLite boundary backed by a real, temporary SQLite database. */
export class RealSQLite {
  private readonly raw: DatabaseSync;
  readonly executed: string[] = [];
  readonly exclusiveConnections: RealSQLite[] = [];
  closed = false;
  failAfterCollectionsTable = false;
  failAfterQueueTable = false;
  failAfterLibraryDrop = false;
  foreignKeysUnavailable = false;

  constructor(private readonly path: string) {
    this.raw = new DatabaseSync(path);
    // Node's sqlite wrapper may enable FKs by default; Expo's iOS connection
    // does not. Model the device behavior before production code configures it.
    this.raw.exec('PRAGMA foreign_keys = OFF');
  }

  async execAsync(sql: string): Promise<void> {
    this.executed.push(sql);
    if (this.failAfterLibraryDrop && sql.includes('DROP TABLE library_items')) {
      for (const statement of sql.split(';').map((part) => part.trim())) {
        if (!statement) continue;
        this.raw.exec(statement);
        if (statement === 'DROP TABLE library_items')
          throw new Error('injected migration failure');
      }
      return;
    }
    if (
      (this.failAfterCollectionsTable &&
        sql.includes('CREATE TABLE collections')) ||
      (this.failAfterQueueTable && sql.includes('CREATE TABLE playback_queue'))
    ) {
      for (const statement of sql.split(';').map((part) => part.trim())) {
        if (!statement) continue;
        this.raw.exec(statement);
        if (
          (this.failAfterCollectionsTable &&
            statement.startsWith('CREATE TABLE collections')) ||
          (this.failAfterQueueTable &&
            statement.startsWith('CREATE TABLE playback_queue'))
        ) {
          this.failAfterCollectionsTable = false;
          this.failAfterQueueTable = false;
          throw new Error('injected migration failure');
        }
      }
      return;
    }
    this.raw.exec(sql);
  }

  async runAsync(
    sql: string,
    ...params: Param[]
  ): Promise<{ changes: number }> {
    const result = this.raw.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  async getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null> {
    if (this.foreignKeysUnavailable && sql === 'PRAGMA foreign_keys')
      return { foreign_keys: 0 } as T;
    return (this.raw.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  async withExclusiveTransactionAsync<T>(
    action: (transaction: RealSQLite) => Promise<T>,
  ): Promise<T> {
    // Expo SQLite 57 creates a fresh connection and executes BEGIN before the
    // callback. Connection-local PRAGMAs on the parent are not inherited.
    const transaction = new RealSQLite(this.path);
    transaction.failAfterCollectionsTable = this.failAfterCollectionsTable;
    transaction.failAfterQueueTable = this.failAfterQueueTable;
    transaction.failAfterLibraryDrop = this.failAfterLibraryDrop;
    transaction.foreignKeysUnavailable = this.foreignKeysUnavailable;
    this.exclusiveConnections.push(transaction);
    await transaction.execAsync('BEGIN');
    try {
      const result = await action(transaction);
      await transaction.execAsync('COMMIT');
      return result;
    } catch (error) {
      await transaction.execAsync('ROLLBACK');
      throw error;
    } finally {
      await transaction.closeAsync();
    }
  }

  async closeAsync(): Promise<void> {
    if (!this.closed) this.raw.close();
    this.closed = true;
  }
}
