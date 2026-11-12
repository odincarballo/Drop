/** @jest-environment node */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { RealSQLite } from './support/realSQLite';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/playback', () => ({}));

type Proof = { id: string; ext: 'mp4'; sizeBytes: number; sha256: string };
const id = '751a5e25-b8d4-410f-8f2e-58f891a2a3d6';
const bytes = Buffer.from('fixture: a validated, finished MP4');
const origin = {
  source: 'direct',
  selection: { mode: 'VIDEO_AUDIO' },
} as const;
const metadata = {
  sourceKind: 'direct',
  mediaType: 'video',
  title: 'Video original',
} as const;
const remoteId = 'a'.repeat(32);
let root: string;
let connections: RealSQLite[];
let library: typeof import('@/services/library');
let journal: typeof import('@/services/downloadRecovery');
const publication = () =>
  jest.requireActual<typeof import('@/services/downloadPublication')>(
    '@/services/downloadPublication',
  );
let libraryDb: RealSQLite;
let downloadDb: RealSQLite;
let native: ReturnType<typeof diskBridge>;

const digest = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');
const media = () => join(root, 'Media', id + '.mp4');
const cache = () => join(root, 'cache', 'mediadrop-' + remoteId + '-file.mp4');
const staging = (key: string) => join(root, 'DownloadStaging', key);

async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

function diskBridge() {
  const seals = new Map<string, { proof: Proof; identity: string }>();
  const leases = new Map<string, string>();
  let generation = 0;
  const identity = async (file: string, final = false) => {
    const entry = await lstat(file, { bigint: true });
    if (!entry.isFile() || entry.nlink !== 1n) throw new Error('not owned');
    const stable = [
      entry.dev,
      entry.ino,
      entry.birthtimeNs,
      entry.size,
      entry.mtimeNs,
    ];
    return (final ? [...stable, entry.ctimeNs] : stable).join(':');
  };
  const checkSeal = async (key: string, proof: Proof, file: string) => {
    const seal = seals.get(key);
    if (
      !seal ||
      proof.id !== seal.proof.id ||
      proof.ext !== seal.proof.ext ||
      proof.sha256 !== seal.proof.sha256 ||
      proof.sizeBytes !== seal.proof.sizeBytes ||
      (await identity(file)) !== seal.identity
    )
      throw new Error('invalid seal');
  };
  async function stagedFile(key: string) {
    if (!(await exists(staging(key)))) return null;
    const names = (await readdir(staging(key))).filter((name) =>
      /^[a-f0-9-]{36}-[a-f0-9]{64}\.mp4$/.test(name),
    );
    if (!names.length) return null;
    if (names.length !== 1) throw new Error('ambiguous stage');
    return join(staging(key), names[0]!);
  }
  async function find(key: string, expected: number) {
    const file = await stagedFile(key);
    if (!file) return null;
    const seal = seals.get(key);
    if (
      !seal ||
      seal.proof.sizeBytes !== expected ||
      file !== join(staging(key), id + '-' + seal.proof.sha256 + '.mp4')
    )
      throw new Error('invalid stage');
    await checkSeal(key, seal.proof, file);
    return seal.proof;
  }
  const quarantine = jest.fn(rename);

  return {
    prepare: async () => ({ databaseDirectoryURL: pathToFileURL(root).href }),
    cleanupImportStaging: async () => undefined,
    listMedia: async () =>
      (await readdir(join(root, 'Media'))).map((name) => 'Media/' + name),
    listArtwork: async () => [],
    statMedia: async (relative: string) => {
      const path = join(root, relative);
      return (await exists(path))
        ? {
            exists: true,
            uri: pathToFileURL(path).href,
            sizeBytes: (await stat(path)).size,
          }
        : { exists: false };
    },
    removeMedia: async (relative: string) => {
      if (relative === 'Media/' + id + '.mp4' && leases.size)
        throw new Error('leased');
      await rm(join(root, relative));
    },
    statPreparedSource: async () => {
      throw new Error('legacy reconciliation bypassed integrity');
    },
    stageCompletedDownload: jest.fn(
      async (
        key: string,
        uri: string,
        _source: string,
        owner: string,
        expected: number,
      ) => {
        const source = fileURLToPath(uri);
        const data = await readFile(source);
        if (
          owner !== remoteId ||
          source !== cache() ||
          data.length !== expected ||
          !data.equals(bytes)
        )
          throw new Error('invalid completed source');
        const sha256 = digest(data);
        await mkdir(staging(key), { recursive: true });
        const proof: Proof = { id, ext: 'mp4', sizeBytes: expected, sha256 };
        seals.set(key, { proof, identity: await identity(source) });
        await rename(source, join(staging(key), id + '-' + sha256 + '.mp4'));
        return proof;
      },
    ),
    findCompletedDownload: jest.fn(find),
    placeCompletedDownload: jest.fn(
      async (
        key: string,
        id: string,
        ext: 'mp4',
        sha256: string,
        sizeBytes: number,
        move: boolean,
      ) => {
        const proof: Proof = { id, ext, sha256, sizeBytes };
        const asset = await find(key, proof.sizeBytes);
        if (asset) {
          if (!move || (await exists(media())) || asset.sha256 !== proof.sha256)
            throw new Error('collision');
          await rename(
            join(staging(key), id + '-' + proof.sha256 + '.mp4'),
            media(),
          );
        }
        await checkSeal(key, proof, media());
        const data = await readFile(media());
        if (data.length !== proof.sizeBytes || digest(data) !== proof.sha256)
          throw new Error('invalid final');
        const token = String(++generation);
        leases.set(token, await identity(media(), true));
        return token;
      },
    ),
    verifyCompletedDownload: jest.fn(async (token: string) => {
      if (leases.get(token) !== (await identity(media(), true)))
        throw new Error('invalid lease');
    }),
    releaseCompletedDownload: jest.fn(async (token: string) => {
      leases.delete(token);
    }),
    quarantine,
    discardCompletedDownload: jest.fn(
      async (
        key: string,
        id: string,
        ext: 'mp4',
        sha256: string,
        sizeBytes: number,
      ) => {
        const proof: Proof = { id, ext, sha256, sizeBytes };
        const candidate = await stagedFile(key);
        const reserved = join(staging(key), '.discard');
        if (!(await exists(reserved))) {
          if (!candidate) return;
          if (candidate !== join(staging(key), id + '-' + sha256 + '.mp4'))
            throw new Error('wrong candidate');
          await checkSeal(key, proof, candidate);
          await quarantine(candidate, reserved);
          try {
            await checkSeal(key, proof, reserved);
          } catch (error) {
            if (!(await exists(candidate))) await rename(reserved, candidate);
            throw error;
          }
        } else {
          if (candidate) throw new Error('ambiguous discard');
          await checkSeal(key, proof, reserved);
        }
        await rm(reserved);
      },
    ),
  };
}

async function reopen() {
  for (const connection of connections) await connection.closeAsync();
  connections = [];
  jest.resetModules();
  jest.requireMock('expo').requireOptionalNativeModule.mockReturnValue(native);
  jest
    .requireMock('expo-sqlite')
    .openDatabaseAsync.mockImplementation(
      async (name: string, opts: { useNewConnection?: boolean }) => {
        const db = new RealSQLite(join(root, name));
        connections.push(db);
        if (name === 'library.sqlite' && !opts.useNewConnection) libraryDb = db;
        if (name === 'drop-downloads.sqlite') downloadDb = db;
        return db;
      },
    );
  library = jest.requireActual('@/services/library');
  journal = jest.requireActual('@/services/downloadRecovery');
  await library.initializeLibrary();
  await journal.readDownloadRecord();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drop-publish-test-'));
  connections = [];
  await mkdir(join(root, 'Media'));
  await mkdir(join(root, 'cache'));
  await writeFile(cache(), bytes);
  native = diskBridge();
  await reopen();
});

afterEach(async () => {
  for (const connection of connections) await connection.closeAsync();
  rmSync(root, { recursive: true });
});

const getRows = () =>
  libraryDb.getAllAsync<{ id: string; lifecycle: string; title: string }>(
    'SELECT * FROM library_items',
  );
const source = () => ({
  uri: pathToFileURL(cache()).href,
  owner: remoteId,
  sizeBytes: bytes.length,
});

async function attempt() {
  const active = await journal.rememberDownload(origin);
  await active.update('transferring', 0, remoteId);
  return active;
}

async function save() {
  return publication().saveTransferredDownload(
    await attempt(),
    source(),
    metadata,
  );
}

async function recover() {
  const record = (await journal.readDownloadRecord())!;
  return publication().recoverTransferredDownload(record);
}

test.each(['proof', 'pending', 'move', 'ready'] as const)(
  'recovers a single item after interruption at %s',
  async (cut) => {
    if (cut === 'proof')
      await downloadDb.execAsync(
        "CREATE TRIGGER cut BEFORE UPDATE ON download_attempt WHEN json_extract(NEW.payload, '$.publication.asset') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'cut'); END",
      );
    if (cut === 'pending')
      await libraryDb.execAsync(
        "CREATE TRIGGER cut BEFORE INSERT ON library_items BEGIN SELECT RAISE(ABORT, 'cut'); END",
      );
    if (cut === 'move')
      native.placeCompletedDownload.mockRejectedValueOnce(new Error('ENOSPC'));
    if (cut === 'ready')
      await libraryDb.execAsync(
        "CREATE TRIGGER cut BEFORE UPDATE ON library_items WHEN NEW.lifecycle = 'ready' BEGIN SELECT RAISE(ABORT, 'cut'); END",
      );
    expect(await save()).toMatchObject({ record: { phase: 'saving' } });
    expect(await exists(media())).toBe(cut === 'ready');
    expect((await getRows()).length).toBe(
      cut === 'move' || cut === 'ready' ? 1 : 0,
    );
    if (cut === 'proof') await downloadDb.execAsync('DROP TRIGGER cut');
    if (cut === 'pending' || cut === 'ready')
      await libraryDb.execAsync('DROP TRIGGER cut');
    await reopen();
    expect(await library.listLibrary()).toEqual([]);
    const record = (await journal.readDownloadRecord())!;
    await Promise.all([recover(), recover()]);
    expect(await getRows()).toEqual([
      expect.objectContaining({ id, lifecycle: 'ready' }),
    ]);
    expect(await readFile(media())).toEqual(bytes);
    expect(await publication().recoverTransferredDownload(record)).toBeNull();
    await reopen();
    expect(await library.listLibrary()).toHaveLength(1);
    expect(await journal.readDownloadRecord()).toBeNull();
    expect(await libraryDb.getFirstAsync('PRAGMA user_version')).toEqual({
      user_version: 5,
    });
    expect(await libraryDb.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  },
);

test('a crash after ready recognizes the same item without overwriting it', async () => {
  await downloadDb.execAsync(
    "CREATE TRIGGER cut BEFORE DELETE ON download_attempt BEGIN SELECT RAISE(ABORT, 'cut'); END",
  );
  await save();
  expect(await getRows()).toEqual([
    expect.objectContaining({ id, title: metadata.title, lifecycle: 'ready' }),
  ]);
  await downloadDb.execAsync('DROP TRIGGER cut');
  await reopen();
  await recover();
  expect(await getRows()).toEqual([
    expect.objectContaining({ id, title: metadata.title, lifecycle: 'ready' }),
  ]);
  expect(await journal.readDownloadRecord()).toBeNull();
});

test.each(['partial', 'same-size corruption'] as const)(
  'never publishes a %s file',
  async (kind) => {
    native.placeCompletedDownload.mockRejectedValueOnce(new Error('cut'));
    const result = await save();
    expect(result).toHaveProperty('record');
    const key = native.stageCompletedDownload.mock.calls[0]![0];
    const staged = join(staging(key), (await readdir(staging(key)))[0]!);
    await writeFile(
      staged,
      kind === 'partial' ? bytes.subarray(0, 3) : Buffer.alloc(bytes.length, 1),
    );
    await reopen();
    await expect(recover()).rejects.toThrow();
    expect(await library.listLibrary()).toEqual([]);
    expect(await exists(media())).toBe(false);
  },
);

test('discard touches only staging owned by the attempt and does not remove a colliding file', async () => {
  native.placeCompletedDownload.mockRejectedValueOnce(new Error('cut'));
  await save();
  const key = native.stageCompletedDownload.mock.calls[0]![0];
  const foreign = join(staging(key), 'foreign.mp4');
  await writeFile(foreign, 'keep');
  await writeFile(media(), 'collision');
  const record = (await journal.readDownloadRecord())!;
  await expect(recover()).rejects.toThrow();
  expect(await publication().discardTransferredDownload(record)).toBeTruthy();
  expect(await readFile(foreign, 'utf8')).toBe('keep');
  expect(await readFile(media(), 'utf8')).toBe('collision');
  expect(await readdir(staging(key))).toEqual(['foreign.mp4']);
  expect(await library.listLibrary()).toEqual([]);
  expect(await journal.readDownloadRecord()).toBeNull();
});

test('cancellation wins before publication and is refused while an owned file is being incorporated', async () => {
  const abandoned = await attempt();
  expect(await abandoned.cancel()).toBeTruthy();
  expect(
    await publication().saveTransferredDownload(abandoned, source(), metadata),
  ).toBeNull();
  expect(native.stageCompletedDownload).not.toHaveBeenCalled();
  const active = await attempt();
  const place = native.placeCompletedDownload.getMockImplementation()!;
  native.placeCompletedDownload.mockImplementationOnce(async (...args) => {
    expect(await active.cancel()).toBeNull();
    return place(...args);
  });
  expect(
    await publication().saveTransferredDownload(active, source(), metadata),
  ).toMatchObject({ item: { id } });
  expect(await getRows()).toHaveLength(1);
});

test('startup cannot promote a pending download with unverified same-size bytes', async () => {
  await libraryDb.runAsync(
    `INSERT INTO library_items (id, sourceKind, title, mediaType, relativeMediaPath,
       sourceCacheRelativePath, sizeBytes, downloadedAt, lifecycle)
     VALUES (?, 'direct', 'fixture', 'video', ?, ?, ?, '2026-11-12T00:00:00Z', 'pending')`,
    id,
    'Media/' + id + '.mp4',
    'DownloadStaging/fixture.1',
    bytes.length,
  );
  await writeFile(media(), Buffer.alloc(bytes.length, 1));
  await reopen();
  expect(await library.listLibrary()).toEqual([]);
  expect((await getRows())[0]?.lifecycle).toBe('pending');
});

test('an unsealed source is left alone if staging runs out of space', async () => {
  native.stageCompletedDownload.mockRejectedValueOnce(new Error('ENOSPC'));
  expect(await save()).toMatchObject({
    record: { phase: 'saving', publication: {} },
  });
  await reopen();
  await expect(recover()).rejects.toThrow();
  expect(await getRows()).toEqual([]);
  expect(await readFile(cache())).toEqual(bytes);
});

test('a published and then deleted item cannot be recreated by a stale receipt', async () => {
  await downloadDb.execAsync(
    "CREATE TRIGGER cut BEFORE DELETE ON download_attempt BEGIN SELECT RAISE(ABORT, 'cut'); END",
  );
  await save();
  expect(await library.listLibrary()).toHaveLength(1);
  await libraryDb.runAsync('DELETE FROM library_items WHERE id = ?', id);
  await rm(media());
  await downloadDb.execAsync('DROP TRIGGER cut');
  await reopen();
  await expect(recover()).rejects.toThrow();
  expect(await getRows()).toEqual([]);
  expect(await exists(media())).toBe(false);
});

test('discard before the final rename removes the owned temporary and its unexposed row', async () => {
  native.placeCompletedDownload.mockRejectedValueOnce(new Error('cut'));
  await save();
  const key = native.stageCompletedDownload.mock.calls[0]![0];
  const other = staging('other.1');
  await mkdir(other, { recursive: true });
  await writeFile(join(other, 'fixture.mp4'), bytes);
  const record = (await journal.readDownloadRecord())!;
  expect(await publication().discardTransferredDownload(record)).toBeTruthy();
  expect(await readdir(staging(key))).toEqual([]);
  expect(await readFile(join(other, 'fixture.mp4'))).toEqual(bytes);
  expect(await getRows()).toEqual([]);
  expect(await journal.readDownloadRecord()).toBeNull();
});

test('final hash boundary rejects same-size mutation before ready', async () => {
  const place = native.placeCompletedDownload.getMockImplementation()!;
  native.placeCompletedDownload.mockImplementationOnce(async (...args) => {
    const token = await place(...args);
    expect(digest(await readFile(media()))).toBe(digest(bytes));
    await writeFile(media(), Buffer.alloc(bytes.length, 1));
    return token;
  });
  const result = await save();
  expect(digest(await readFile(media()))).not.toBe(digest(bytes));
  expect({
    lifecycle: (await getRows())[0]?.lifecycle,
    receiptRetained: Boolean(await journal.readDownloadRecord()),
    reportedSaved: Boolean(result?.item),
  }).toEqual({
    lifecycle: 'pending',
    receiptRetained: true,
    reportedSaved: false,
  });
});

test.each(['UPDATE', 'COMMIT'])(
  'failed durable discard at %s preserves the only verified staged file',
  async (cut) => {
    native.placeCompletedDownload.mockRejectedValueOnce(
      new Error('cut before move'),
    );
    await save();
    const key = native.stageCompletedDownload.mock.calls[0]![0];
    const file = join(staging(key), (await readdir(staging(key)))[0]!);
    const record = (await journal.readDownloadRecord())!;
    expect(await readFile(file)).toEqual(bytes);
    if (cut === 'UPDATE') {
      await downloadDb.execAsync(
        "CREATE TRIGGER cut_discard BEFORE UPDATE ON download_attempt WHEN json_extract(NEW.payload, '$.publication.discarding') = 1 BEGIN SELECT RAISE(ABORT, 'discard commit rejected'); END",
      );
    } else {
      await downloadDb.execAsync(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE fixture_child (
          parent INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TRIGGER cut_discard AFTER UPDATE ON download_attempt
        WHEN json_extract(NEW.payload, '$.publication.discarding') = 1
        BEGIN INSERT INTO fixture_child VALUES (999); END;
      `);
    }
    await expect(
      publication().discardTransferredDownload(record),
    ).rejects.toThrow(
      cut === 'UPDATE' ? 'discard commit rejected' : 'FOREIGN KEY',
    );
    expect(await journal.readDownloadRecord()).toEqual(record);
    expect(native.discardCompletedDownload).not.toHaveBeenCalled();
    expect({
      stagePresent: await exists(file),
      libraryState: (await getRows())[0]?.lifecycle ?? null,
    }).toEqual({ stagePresent: true, libraryState: 'pending' });
  },
);

test('discard checks the sealed identity before removing a stage-shaped foreign file', async () => {
  native.placeCompletedDownload.mockRejectedValueOnce(
    new Error('cut before move'),
  );
  await save();
  const key = native.stageCompletedDownload.mock.calls[0]![0];
  const original = join(staging(key), (await readdir(staging(key)))[0]!);
  const record = (await journal.readDownloadRecord())!;
  expect(record.publication?.asset?.id).toBe(id);
  await rm(original);
  const foreign = join(
    staging(key),
    '35a0d0dc-310f-47b2-a43e-c5b266ca7bb9-' + digest(bytes) + '.mp4',
  );
  await writeFile(foreign, bytes);
  await expect(
    publication().discardTransferredDownload(record),
  ).rejects.toThrow();
  expect(await readFile(foreign)).toEqual(bytes);
  expect(await journal.readDownloadRecord()).toMatchObject({
    publication: { discarding: true },
  });
});

test('an equal-size, equal-hash replacement of the final inode cannot commit ready', async () => {
  const place = native.placeCompletedDownload.getMockImplementation()!;
  native.placeCompletedDownload.mockImplementationOnce(async (...args) => {
    const token = await place(...args);
    const copy = join(root, 'replacement.mp4');
    await writeFile(copy, bytes);
    await rename(copy, media());
    return token;
  });
  expect(await save()).toHaveProperty('record.publication.asset');
  expect(await getRows()).toEqual([
    expect.objectContaining({ lifecycle: 'pending' }),
  ]);
  expect(native.releaseCompletedDownload).toHaveBeenCalledTimes(1);
  await reopen();
  await expect(recover()).rejects.toThrow();
});

test('a concurrent Drop media deletion cannot mutate the file during SQLite publication', async () => {
  const verify = native.verifyCompletedDownload.getMockImplementation()!;
  native.verifyCompletedDownload.mockImplementationOnce(async (token) => {
    await expect(native.removeMedia('Media/' + id + '.mp4')).rejects.toThrow(
      'leased',
    );
    await verify(token);
  });
  expect(await save()).toMatchObject({ item: { id } });
  expect(await readFile(media())).toEqual(bytes);
  expect(await getRows()).toEqual([
    expect.objectContaining({ lifecycle: 'ready' }),
  ]);
  expect(native.releaseCompletedDownload).toHaveBeenCalledTimes(1);
});

test.each(['intent', 'quarantine', 'sqlite'] as const)(
  'resumes discard after interruption at %s without publishing',
  async (cut) => {
    native.placeCompletedDownload.mockRejectedValueOnce(
      new Error('cut before move'),
    );
    await save();
    const record = (await journal.readDownloadRecord())!;
    const key = native.stageCompletedDownload.mock.calls[0]![0];
    if (cut === 'intent')
      native.discardCompletedDownload.mockRejectedValueOnce(
        new Error('closed after intent'),
      );
    if (cut === 'quarantine')
      native.quarantine.mockImplementationOnce(async (...args) => {
        await rename(...args);
        throw new Error('closed after quarantine');
      });
    if (cut === 'sqlite')
      await libraryDb.execAsync(
        "CREATE TRIGGER cut BEFORE DELETE ON library_items BEGIN SELECT RAISE(ABORT, 'cut'); END",
      );

    await expect(
      publication().discardTransferredDownload(record),
    ).rejects.toThrow();
    expect(await journal.readDownloadRecord()).toMatchObject({
      publication: { discarding: true },
    });
    if (cut === 'sqlite') await libraryDb.execAsync('DROP TRIGGER cut');
    await reopen();
    await expect(recover()).resolves.toBeNull();
    expect(await library.listLibrary()).toEqual([]);
    expect(await publication().discardTransferredDownload(record)).toBeTruthy();
    await reopen();
    expect(await publication().discardTransferredDownload(record)).toBeNull();
    expect(await journal.readDownloadRecord()).toBeNull();
    expect(await getRows()).toEqual([]);
    expect(await readdir(staging(key))).toEqual([]);
  },
);

test('a failure acknowledging discard leaves a tombstone, not a resumable download', async () => {
  native.placeCompletedDownload.mockRejectedValueOnce(
    new Error('cut before move'),
  );
  await save();
  const record = (await journal.readDownloadRecord())!;
  await downloadDb.execAsync(
    "CREATE TRIGGER cut BEFORE DELETE ON download_attempt BEGIN SELECT RAISE(ABORT, 'cut'); END",
  );
  await expect(
    publication().discardTransferredDownload(record),
  ).rejects.toThrow();
  expect(await getRows()).toEqual([]);
  await downloadDb.execAsync('DROP TRIGGER cut');
  await reopen();
  await expect(recover()).resolves.toBeNull();
  await expect(
    publication().discardTransferredDownload(record),
  ).resolves.toBeTruthy();
});

test.each(['same-name inode', 'symlink', 'during quarantine'] as const)(
  'preserves an unowned replacement: %s',
  async (kind) => {
    native.placeCompletedDownload.mockRejectedValueOnce(
      new Error('cut before move'),
    );
    await save();
    const record = (await journal.readDownloadRecord())!;
    const key = native.stageCompletedDownload.mock.calls[0]![0];
    const file = join(staging(key), (await readdir(staging(key)))[0]!);
    const foreign = join(root, 'foreign.mp4');
    await writeFile(foreign, bytes);
    if (kind === 'during quarantine')
      native.quarantine.mockImplementationOnce(async (source, destination) => {
        await rename(foreign, source);
        await rename(source, destination);
      });
    else if (kind === 'symlink') {
      await rm(file);
      await symlink(foreign, file);
    } else {
      await rename(foreign, file);
    }
    await expect(
      publication().discardTransferredDownload(record),
    ).rejects.toThrow();
    expect(await readFile(file)).toEqual(bytes);
    expect(await getRows()).toEqual([
      expect.objectContaining({ lifecycle: 'pending' }),
    ]);
    expect(await journal.readDownloadRecord()).toMatchObject({
      publication: { discarding: true },
    });
  },
);

test('discard keeps the committed file if the publication acknowledgement failed', async () => {
  await downloadDb.execAsync(
    "CREATE TRIGGER cut BEFORE DELETE ON download_attempt BEGIN SELECT RAISE(ABORT, 'cut'); END",
  );
  await save();
  const record = (await journal.readDownloadRecord())!;
  await downloadDb.execAsync('DROP TRIGGER cut');
  await publication().discardTransferredDownload(record);
  expect(native.discardCompletedDownload).not.toHaveBeenCalled();
  expect(await readFile(media())).toEqual(bytes);
  expect(await getRows()).toEqual([
    expect.objectContaining({ lifecycle: 'ready' }),
  ]);
  expect(await journal.readDownloadRecord()).toBeNull();
});

test('a filename with a hash cannot authorize discard without a native seal', async () => {
  native.stageCompletedDownload.mockRejectedValueOnce(
    new Error('closed before seal'),
  );
  await save();
  const record = (await journal.readDownloadRecord())!;
  const key = native.stageCompletedDownload.mock.calls[0]![0];
  const file = join(staging(key), id + '-' + digest(bytes) + '.mp4');
  await mkdir(staging(key), { recursive: true });
  await writeFile(file, bytes);
  await expect(
    publication().discardTransferredDownload(record),
  ).rejects.toThrow('invalid stage');
  expect(native.discardCompletedDownload).not.toHaveBeenCalled();
  expect(await readFile(file)).toEqual(bytes);
  expect(await journal.readDownloadRecord()).toEqual(record);
});

test('a discard from an older generation cannot clean the current attempt', async () => {
  native.placeCompletedDownload.mockRejectedValueOnce(
    new Error('cut before move'),
  );
  await save();
  const record = (await journal.readDownloadRecord())!;
  const key = native.stageCompletedDownload.mock.calls[0]![0];
  const file = join(staging(key), (await readdir(staging(key)))[0]!);
  const stale = { ...record, generation: record.generation + 1 };
  await expect(
    publication().discardTransferredDownload(stale),
  ).resolves.toBeNull();
  expect(native.discardCompletedDownload).not.toHaveBeenCalled();
  expect(await readFile(file)).toEqual(bytes);
  expect(await journal.readDownloadRecord()).toEqual(record);
});
