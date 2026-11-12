/** @jest-environment node */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLiteDatabase } from 'expo-sqlite';

import { RealSQLite } from './support/realSQLite';

let directory: string;
let connections: RealSQLite[];

function reopen() {
  jest.resetModules();
  const db = new RealSQLite(join(directory, 'drop-downloads.sqlite'));
  connections.push(db);
  const sqlite = jest.requireMock<typeof import('expo-sqlite')>('expo-sqlite');
  jest
    .mocked(sqlite.openDatabaseAsync)
    .mockResolvedValue(db as unknown as SQLiteDatabase);
  const journal = jest.requireActual<
    typeof import('@/services/downloadRecovery')
  >('@/services/downloadRecovery');
  return { db, journal, openDatabaseAsync: sqlite.openDatabaseAsync };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'drop-download-recovery-'));
  connections = [];
});

afterEach(async () => {
  for (const db of connections) await db.closeAsync();
  rmSync(directory, { recursive: true });
});

const direct = {
  source: 'direct',
  selection: { mode: 'VIDEO_AUDIO' },
} as const;
const youtube = {
  source: 'youtube',
  selection: { mode: 'AUDIO_ONLY', videoId: 'AWGPaFraPN4' },
} as const;

test('a real rejected cancellation is invisible to readers and can be retried', async () => {
  const { db, journal, openDatabaseAsync } = reopen();
  const attempt = await journal.rememberDownload(direct);
  const initial = await journal.readDownloadRecord();
  expect(openDatabaseAsync).toHaveBeenCalledWith('drop-downloads.sqlite', {
    useNewConnection: true,
  });
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 1,
  });

  // A real deferred constraint failure occurs at COMMIT, after UPDATE succeeded.
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE fixture_child (parent INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER reject_cancel AFTER UPDATE ON download_attempt
    BEGIN INSERT INTO fixture_child VALUES (999); END;
  `);
  const cancellation = attempt.cancel();
  const reading = journal.readDownloadRecord();
  await expect(cancellation).rejects.toThrow(/FOREIGN KEY/);
  await expect(reading).resolves.toEqual(initial);
  const restarted = reopen();
  expect(await restarted.journal.readDownloadRecord()).toEqual(initial);
  await db.execAsync('DROP TRIGGER reject_cancel');
  await expect(attempt.cancel()).resolves.toMatchObject({
    status: 'cancelled',
  });
  expect(await restarted.journal.readDownloadRecord()).toMatchObject({
    id: initial!.id,
    generation: initial!.generation + 1,
    status: 'cancelled',
  });
});

test('concurrent requests from both engines can reserve only one slot', async () => {
  const { journal, db } = reopen();
  const results = await Promise.allSettled([
    journal.rememberDownload(direct),
    journal.rememberDownload(youtube),
  ]);
  expect(results.map((result) => result.status)).toEqual([
    'fulfilled',
    'rejected',
  ]);
  expect(results[1]).toMatchObject({ reason: { code: 'DOWNLOAD_ACTIVE' } });
  expect(await journal.readDownloadRecord()).toMatchObject({
    source: 'direct',
    status: 'pending',
  });
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS count FROM download_attempt'),
  ).toEqual({ count: 1 });
});

test('obsolete transitions cannot replace a newer reservation', async () => {
  const { journal } = reopen();
  const old = await journal.rememberDownload(direct);
  await expect(old.ownsReservation()).resolves.toBe(true);
  const beforeCancel = (await journal.readDownloadRecord())!;
  await old.cancel();
  await expect(old.update('transferring', 21)).resolves.toBe(false);
  await expect(
    journal.updateRecoveredDownload(beforeCancel, { status: 'remote-ready' }),
  ).resolves.toBeNull();
  const next = await journal.rememberDownload(youtube);
  const reserved = await journal.readDownloadRecord();
  await expect(old.ownsReservation()).resolves.toBe(false);
  await expect(next.ownsReservation()).resolves.toBe(true);
  await old.finish();
  await expect(old.cancel()).resolves.toBeNull();
  await expect(old.update('saving')).resolves.toBe(false);
  expect(await journal.readDownloadRecord()).toEqual(reserved);
  await expect(next.update('downloading', 21)).resolves.toBe(true);
});

test.each(['{', JSON.stringify({ version: 1, source: 'direct' })])(
  'an incomplete or corrupt row does not block a new explicit start',
  async (payload) => {
    const { journal, db } = reopen();
    await journal.readDownloadRecord();
    await db.runAsync(
      'INSERT INTO download_attempt VALUES (1, ?, ?, ?)',
      'old',
      1,
      payload,
    );
    await expect(journal.readDownloadRecord()).resolves.toBeNull();
    await journal.rememberDownload(direct);
    expect(await journal.readDownloadRecord()).toMatchObject({
      source: 'direct',
      status: 'pending',
    });
  },
);
