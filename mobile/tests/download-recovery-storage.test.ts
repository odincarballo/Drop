/** @jest-environment node */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
} from 'node:fs';
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
    user_version: 2,
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

jest.mock('@/services/downloadPartialStorage', () => ({
  appendPartialBytes: jest.fn(),
  verifyPartialBytes: jest.fn(),
  removePartialBytes: jest.fn(),
}));

const hash = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
const contents = Buffer.from('abcdef');
const remoteJobId = 'ab'.repeat(16);
const resource = {
  remoteJobId,
  totalBytes: contents.length,
  sha256: hash(contents),
  etag: `"sha256-${hash(contents)}"`,
};

async function withPartial() {
  const context = reopen();
  const { journal } = context;
  const attempt = await journal.rememberDownload(direct);
  await attempt.update('transferring', 0, remoteJobId);
  const owner = (await journal.readDownloadRecord())!;
  const bridge = jest.requireMock<
    typeof import('@/services/downloadPartialStorage')
  >('@/services/downloadPartialStorage');
  const file = join(directory, 'fixture.partial');
  jest
    .mocked(bridge.appendPartialBytes)
    .mockImplementation(async (_, n, _prefix, _total, bytes) => {
      appendFileSync(file, bytes);
      const data = readFileSync(file);
      expect(data.length).toBe(n + bytes.length);
      return { confirmedBytes: data.length, prefixSha256: hash(data) };
    });
  jest
    .mocked(bridge.verifyPartialBytes)
    .mockImplementation(async (_, n, prefix) => {
      const data = readFileSync(file);
      expect(data.length).toBeGreaterThanOrEqual(n);
      expect(hash(data.subarray(0, n))).toBe(prefix);
      truncateSync(file, n);
    });
  jest.mocked(bridge.removePartialBytes).mockImplementation(async () => {
    if (existsSync(file)) rmSync(file);
  });
  const checkpoint = (await journal.reserveDownloadPartial(owner, resource))!;
  return { ...context, attempt, owner, bridge, file, checkpoint };
}

test('v1 migration preserves the complete publication receipt and v1 rollback is possible offline', async () => {
  const { db, journal } = reopen();
  const owner = {
    id: 'legacy-attempt',
    generation: 3,
    version: 1,
    source: 'direct',
    selection: { mode: 'VIDEO_AUDIO' },
    status: 'pending',
    phase: 'saving',
    bytes: contents.length,
    errorCode: null,
    remoteJobId,
    publication: {
      asset: {
        id: '10000000-0000-0000-0000-000000000001',
        ext: 'mp4',
        sizeBytes: contents.length,
        sha256: resource.sha256,
      },
      discarding: true,
    },
  };
  const payload = JSON.stringify(owner, null, 2);
  await db.execAsync(`
    CREATE TABLE download_attempt (
      slot INTEGER PRIMARY KEY CHECK (slot = 1),
      id TEXT NOT NULL, generation INTEGER NOT NULL CHECK (generation > 0),
      payload TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  await db.runAsync(
    'INSERT INTO download_attempt VALUES (1, ?, ?, ?)',
    owner.id,
    owner.generation,
    payload,
  );
  const execute = db.execAsync.bind(db);
  let rejectCommit = true;
  jest.spyOn(db, 'execAsync').mockImplementation(async (sql) => {
    if (sql === 'COMMIT' && rejectCommit) throw new Error('migration cut');
    return execute(sql);
  });
  await expect(journal.readDownloadRecord()).rejects.toThrow('migration cut');
  rejectCommit = false;
  const reopened = reopen();
  expect(await reopened.db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 1,
  });
  expect(await reopened.db.getFirstAsync('PRAGMA integrity_check')).toEqual({
    integrity_check: 'ok',
  });
  expect(
    await reopened.db.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE name = 'download_partial'",
    ),
  ).toBeNull();
  expect(await reopened.journal.readDownloadRecord()).toEqual(owner);
  expect(await reopened.db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 2,
  });
  expect(
    await reopened.db.getFirstAsync('SELECT payload FROM download_attempt'),
  ).toEqual({ payload });
  await reopened.db.execAsync(`
    BEGIN IMMEDIATE;
    DROP TRIGGER discard_partial_on_attempt_update;
    DROP TRIGGER discard_partial_on_attempt_delete;
    DROP TABLE download_partial;
    PRAGMA user_version = 1;
    COMMIT;
  `);
  expect(await reopened.db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 1,
  });
  expect(
    await reopened.db.getFirstAsync('SELECT payload FROM download_attempt'),
  ).toEqual({ payload });
});

test('a rejected SQLite COMMIT leaves only the previous checkpoint recoverable on reopening', async () => {
  const { db, journal, owner, checkpoint, file } = await withPartial();
  const first = (await journal.appendDownloadPartial(
    checkpoint,
    contents.subarray(0, 3),
  ))!;
  expect(first).toMatchObject({
    confirmedBytes: 3,
    prefixSha256: hash(contents.subarray(0, 3)),
  });
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE fixture_child (parent INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER cut AFTER UPDATE OF confirmedBytes ON download_partial
    BEGIN INSERT INTO fixture_child VALUES (99); END;
  `);
  await expect(
    journal.appendDownloadPartial(first, contents.subarray(3)),
  ).rejects.toThrow(/FOREIGN KEY/);
  expect(readFileSync(file)).toEqual(contents);
  const { db: next, journal: restarted } = reopen();
  const bridge = jest.requireMock<
    typeof import('@/services/downloadPartialStorage')
  >('@/services/downloadPartialStorage');
  jest
    .mocked(bridge.verifyPartialBytes)
    .mockImplementation(async (_, offset, sha) => {
      const prefix = readFileSync(file).subarray(0, offset);
      expect(hash(prefix)).toBe(sha);
      truncateSync(file, offset);
    });
  expect(
    await next.getFirstAsync('SELECT confirmedBytes FROM download_partial'),
  ).toEqual({ confirmedBytes: 3 });
  await expect(restarted.recoverDownloadPartial(owner)).resolves.toEqual(first);
  expect(readFileSync(file)).toEqual(contents.subarray(0, 3));
});

test('the final checkpoint and B handoff roll back together when COMMIT fails', async () => {
  const { db, journal, owner, checkpoint, file } = await withPartial();
  const first = (await journal.appendDownloadPartial(
    checkpoint,
    contents.subarray(0, 3),
  ))!;
  const asset = {
    id: '751a5e25-b8d4-410f-8f2e-58f891a2a3d6',
    ext: 'mp4',
    sizeBytes: contents.length,
    sha256: resource.sha256,
  } as const;
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE fixture_child (parent INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER cut_handoff AFTER UPDATE ON download_attempt
    BEGIN INSERT INTO fixture_child VALUES (99); END;
  `);
  await expect(
    journal.appendDownloadPartial(first, contents.subarray(3), asset),
  ).rejects.toThrow(/FOREIGN KEY/);
  expect(await journal.readPartialPublication(owner)).toBeNull();
  expect(await journal.readDownloadRecord()).toMatchObject({
    phase: 'transferring',
  });
  expect(readFileSync(file)).toEqual(contents);
  const { journal: restarted, db: reopened } = reopen();
  const bridge = jest.requireMock<
    typeof import('@/services/downloadPartialStorage')
  >('@/services/downloadPartialStorage');
  jest
    .mocked(bridge.verifyPartialBytes)
    .mockImplementation(async (_, offset, sha) => {
      expect(hash(readFileSync(file).subarray(0, offset))).toBe(sha);
      truncateSync(file, offset);
    });
  expect(await restarted.recoverDownloadPartial(owner)).toEqual(first);
  expect(readFileSync(file)).toEqual(contents.subarray(0, 3));
  await reopened.execAsync('DROP TRIGGER cut_handoff');
  jest
    .mocked(bridge.appendPartialBytes)
    .mockImplementation(async (_, offset, _prefix, _total, data) => {
      expect(offset).toBe(3);
      appendFileSync(file, data);
      return { confirmedBytes: contents.length, prefixSha256: resource.sha256 };
    });
  await restarted.appendDownloadPartial(first, contents.subarray(3), asset);
  expect(await restarted.readPartialPublication(owner)).toEqual(asset);
  expect(await reopened.getFirstAsync('PRAGMA integrity_check')).toEqual({
    integrity_check: 'ok',
  });
  expect(await reopened.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

test('a checkpoint is compare-and-swap and cancellation invalidates outstanding bytes', async () => {
  const { db, journal, owner, attempt, checkpoint, bridge, file } =
    await withPartial();
  const results = await Promise.all([
    journal.appendDownloadPartial(checkpoint, contents.subarray(0, 3)),
    journal.appendDownloadPartial(checkpoint, contents.subarray(0, 3)),
  ]);
  expect(results[0]).toMatchObject({ confirmedBytes: 3 });
  expect(results[1]).toBeNull();
  expect(bridge.appendPartialBytes).toHaveBeenCalledTimes(1);
  await attempt.cancel();
  await expect(
    journal.appendDownloadPartial(results[0]!, contents.subarray(3)),
  ).resolves.toBeNull();
  await expect(journal.recoverDownloadPartial(owner)).resolves.toBeNull();
  expect(await db.getFirstAsync('SELECT state FROM download_partial')).toEqual({
    state: 'discarding',
  });
  expect(existsSync(file)).toBe(true);
  await expect(journal.finishDownloadPartialCleanup()).resolves.toBe(true);
  await expect(journal.finishDownloadPartialCleanup()).resolves.toBe(false);
  expect(existsSync(file)).toBe(false);
  expect(await journal.readDownloadRecord()).toMatchObject({
    status: 'cancelled',
  });
});

test('discard is durable before native cleanup and a cleaned generation cannot be recreated', async () => {
  const { db, journal, owner, checkpoint, bridge, file } = await withPartial();
  const confirmed = (await journal.appendDownloadPartial(
    checkpoint,
    contents.subarray(0, 3),
  ))!;
  const remove = jest.mocked(bridge.removePartialBytes);
  remove.mockRejectedValueOnce(new Error('disk error'));
  await expect(journal.discardDownloadPartial(owner)).rejects.toThrow(
    'disk error',
  );
  expect(existsSync(file)).toBe(true);
  expect(await db.getFirstAsync('SELECT state FROM download_partial')).toEqual({
    state: 'discarding',
  });
  await expect(
    journal.appendDownloadPartial(confirmed, contents.subarray(3)),
  ).resolves.toBeNull();
  await expect(journal.discardDownloadPartial(owner)).resolves.toBe(true);
  expect(existsSync(file)).toBe(false);
  await expect(
    journal.reserveDownloadPartial(owner, resource),
  ).resolves.toBeNull();
});

test('a disk failure or an incorrect full hash cannot advance the checkpoint', async () => {
  const { db, journal, checkpoint, bridge } = await withPartial();
  jest
    .mocked(bridge.appendPartialBytes)
    .mockRejectedValueOnce(new Error('ENOSPC'));
  await expect(
    journal.appendDownloadPartial(checkpoint, contents),
  ).rejects.toThrow('ENOSPC');
  jest.mocked(bridge.appendPartialBytes).mockResolvedValueOnce({
    confirmedBytes: contents.length,
    prefixSha256: '00'.repeat(32),
  });
  await expect(
    journal.appendDownloadPartial(checkpoint, contents),
  ).rejects.toThrow();
  expect(
    await db.getFirstAsync('SELECT confirmedBytes FROM download_partial'),
  ).toEqual({ confirmedBytes: 0 });
});

test('SIGKILL after synced bytes and before SQLite COMMIT restores the previous offset', async () => {
  const { journal, owner, checkpoint, file } = await withPartial();
  const committed = (await journal.appendDownloadPartial(
    checkpoint,
    contents.subarray(0, 3),
  ))!;
  const killed = spawnSync(
    process.execPath,
    [
      '-e',
      `const fs = require('node:fs');
     const { DatabaseSync } = require('node:sqlite');
     const db = new DatabaseSync(process.argv[1]);
     db.exec('BEGIN IMMEDIATE');
     const fd = fs.openSync(process.argv[2], 'a');
     fs.writeSync(fd, 'def');
     fs.fsyncSync(fd);
     fs.closeSync(fd);
     db.prepare('UPDATE download_partial SET confirmedBytes = 6, prefixSha256 = ?').run(process.argv[3]);
     process.kill(process.pid, 'SIGKILL');`,
      join(directory, 'drop-downloads.sqlite'),
      file,
      resource.sha256,
    ],
    { timeout: 5_000 },
  );
  expect(killed.signal).toBe('SIGKILL');
  expect(readFileSync(file)).toEqual(contents);
  const { journal: restarted } = reopen();
  const bridge = jest.requireMock<
    typeof import('@/services/downloadPartialStorage')
  >('@/services/downloadPartialStorage');
  jest
    .mocked(bridge.verifyPartialBytes)
    .mockImplementation(async (_, offset, sha) => {
      expect(hash(readFileSync(file).subarray(0, offset))).toBe(sha);
      truncateSync(file, offset);
    });
  await expect(restarted.recoverDownloadPartial(owner)).resolves.toEqual(
    committed,
  );
  expect(readFileSync(file)).toEqual(contents.subarray(0, 3));
});

test('a SQLite statement that updates no checkpoint cannot acknowledge written bytes', async () => {
  const { db, journal, checkpoint, file } = await withPartial();
  await db.execAsync(`
    CREATE TRIGGER ignore_checkpoint BEFORE UPDATE OF confirmedBytes ON download_partial
    BEGIN SELECT RAISE(IGNORE); END;
  `);
  await expect(
    journal.appendDownloadPartial(checkpoint, contents.subarray(0, 3)),
  ).rejects.toThrow();
  expect(readFileSync(file)).toEqual(contents.subarray(0, 3));
  expect(
    await db.getFirstAsync('SELECT confirmedBytes FROM download_partial'),
  ).toEqual({ confirmedBytes: 0 });
});

test('cleanup can finalize after SQLite rejects the receipt following unlink', async () => {
  const { db, journal, owner, checkpoint, file } = await withPartial();
  await journal.appendDownloadPartial(checkpoint, contents.subarray(0, 3));
  await db.execAsync(`
    CREATE TRIGGER reject_cleanup BEFORE UPDATE OF state ON download_partial
    WHEN NEW.state = 'discarded' BEGIN SELECT RAISE(ABORT, 'cut after unlink'); END;
  `);
  await expect(journal.discardDownloadPartial(owner)).rejects.toThrow(
    'cut after unlink',
  );
  expect(existsSync(file)).toBe(false);
  expect(await db.getFirstAsync('SELECT state FROM download_partial')).toEqual({
    state: 'discarding',
  });
  await db.execAsync('DROP TRIGGER reject_cleanup');
  await expect(journal.finishDownloadPartialCleanup()).resolves.toBe(true);
  await expect(
    journal.reserveDownloadPartial(owner, resource),
  ).resolves.toBeNull();
});

test('publication and partial cleanup preserve the A+B receipt and confine removal to the partial', async () => {
  const { journal, attempt, owner, checkpoint, file } = await withPartial();
  const full = await journal.appendDownloadPartial(checkpoint, contents);
  expect(full).toMatchObject({
    confirmedBytes: contents.length,
    prefixSha256: resource.sha256,
  });
  await attempt.beginPublication(contents.length, remoteJobId);
  const asset = {
    id: '10000000-0000-0000-0000-000000000001',
    ext: 'mp4',
    sizeBytes: contents.length,
    sha256: resource.sha256,
  } as const;
  const publication = await journal.recordCompletedAsset(owner, asset);
  expect(publication).toMatchObject({ publication: { asset } });
  await expect(journal.recoverDownloadPartial(owner)).resolves.toBeNull();
  await expect(journal.finishDownloadPartialCleanup()).resolves.toBe(true);
  expect(existsSync(file)).toBe(false);
  await expect(journal.readDownloadRecord()).resolves.toEqual(publication);
});
