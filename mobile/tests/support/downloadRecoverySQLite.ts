import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { readDownloadRecord } from '@/services/downloadRecovery';
import { RealSQLite } from './realSQLite';

// One isolated connection per UI test file. Production still runs its own
// schema initialization and uses real SQL statements and transactions.
let db: RealSQLite | undefined;

export async function resetDownloadRecoveryFixture() {
  db ??= new RealSQLite(':memory:');
  jest
    .mocked(openDatabaseAsync)
    .mockResolvedValue(db as unknown as SQLiteDatabase);
  await readDownloadRecord();
  await db.execAsync(
    'DROP TRIGGER IF EXISTS reject_download_write; DELETE FROM download_partial; DELETE FROM download_attempt;',
  );
}

export async function seedDownloadRecovery(payload: string) {
  let identity = { id: 'invalid', generation: 1 };
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed?.id === 'string')
      identity = { ...identity, id: parsed.id };
    if (Number.isSafeInteger(parsed?.generation))
      identity.generation = parsed.generation;
  } catch {
    // A corrupt payload is deliberately inserted without normalization.
  }
  await db!.runAsync(
    'INSERT INTO download_attempt (slot, id, generation, payload) VALUES (1, ?, ?, ?)',
    identity.id,
    identity.generation,
    payload,
  );
}

export async function readRawDownloadRecovery() {
  const row = await db!.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM download_attempt WHERE slot = 1',
  );
  return row?.payload ?? null;
}

export async function rejectDownloadWrite(operation: 'INSERT' | 'UPDATE') {
  await db!.execAsync(`
    CREATE TRIGGER reject_download_write BEFORE ${operation} ON download_attempt
    BEGIN SELECT RAISE(ABORT, 'fixture write rejection'); END;
  `);
}

export async function allowDownloadWrites() {
  await db!.execAsync('DROP TRIGGER reject_download_write');
}
