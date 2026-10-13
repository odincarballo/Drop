import { DatabaseSync } from 'node:sqlite';

type Param = string | number | null;

/** Expo SQLite boundary backed by a real, temporary SQLite database. */
export class RealSQLite {
  private readonly raw: DatabaseSync;
  readonly executed: string[] = [];
  closed = false;
  failAfterCollectionsTable = false;
  foreignKeysUnavailable = false;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
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
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = await action(this);
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    if (!this.closed) this.raw.close();
    this.closed = true;
  }
}
