import { DatabaseSync } from 'node:sqlite';

type Param = string | number | null;

/** Expo SQLite boundary backed by a real, temporary SQLite database. */
export class RealSQLite {
  private readonly raw: DatabaseSync;
  readonly executed: string[] = [];
  readonly exclusiveConnections: RealSQLite[] = [];
  closed = false;
  failAfterCollectionsTable = false;
  foreignKeysUnavailable = false;

  constructor(private readonly path: string) {
    this.raw = new DatabaseSync(path);
    // Node's sqlite wrapper may enable FKs by default; Expo's iOS connection
    // does not. Model the device behavior before production code configures it.
    this.raw.exec('PRAGMA foreign_keys = OFF');
  }

  async execAsync(sql: string): Promise<void> {
    this.executed.push(sql);
    if (
      this.failAfterCollectionsTable &&
      sql.includes('CREATE TABLE collections')
    ) {
      for (const statement of sql.split(';').map((part) => part.trim())) {
        if (!statement) continue;
        this.raw.exec(statement);
        if (statement.startsWith('CREATE TABLE collections')) {
          this.failAfterCollectionsTable = false;
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
