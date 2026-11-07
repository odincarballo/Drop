/** @jest-environment node */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  RealSQLite,
  V1_SCHEMA,
  V2_COLLECTIONS_SCHEMA,
} from './support/realSQLite';
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/playback', () => ({
  beginPlaybackDeletion: jest.fn(async () => undefined),
  endPlaybackDeletion: jest.fn(async () => undefined),
}));
type Library = typeof import('@/services/library');
let directory: string,
  databasePath: string,
  connections: RealSQLite[],
  library: Library,
  db: RealSQLite,
  unreadable: string | null;
const A = '00000000-0000-0000-0000-000000000001',
  B = '00000000-0000-0000-0000-000000000002',
  C = '00000000-0000-0000-0000-000000000003',
  collection = '00000000-0000-0000-0000-000000000004';
const entries = [5, 6, 7].map(
  (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
);
const mediaPath = (id: string) => `Media/${id}.mp4`;
function put(relative: string, data: string | Buffer = Buffer.alloc(100)) {
  const f = join(directory, relative);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, data);
}
function stat(relative: string) {
  if (relative === unreadable)
    throw new Error('injected transient storage error');
  const f = join(directory, relative);
  return existsSync(f)
    ? { exists: true, uri: `file://${f}`, sizeBytes: statSync(f).size }
    : { exists: false };
}
const storage = {
  prepare: jest.fn(async () => ({
    databaseDirectoryURL: `file://${directory}/`,
  })),
  statMedia: jest.fn(async (relative: string) => stat(relative)),
  statPreparedSource: jest.fn(async (relative: string) =>
    stat(`Cache/${relative}`),
  ),
  // Native image decoding is tested separately; this adapter models its result.
  statArtwork: jest.fn(async (id: string) => {
    const rel = `Artwork/${id}.jpg`,
      s = stat(rel);
    return s.exists &&
      readFileSync(join(directory, rel)).toString().startsWith('VALID-JPEG')
      ? s
      : { exists: false };
  }),
  listMedia: jest.fn(async () =>
    readdirSync(join(directory, 'Media')).map((n) => `Media/${n}`),
  ),
  listArtwork: jest.fn(async () =>
    readdirSync(join(directory, 'Artwork')).map((n) => n.replace(/\.jpg$/, '')),
  ),
  removeMedia: jest.fn(async (rel: string) =>
    rmSync(join(directory, rel), { force: true }),
  ),
  removeArtwork: jest.fn(async (id: string) =>
    rmSync(join(directory, `Artwork/${id}.jpg`), { force: true }),
  ),
  movePrepared: jest.fn(async (rel: string, id: string) => {
    renameSync(join(directory, 'Cache', rel), join(directory, mediaPath(id)));
    return stat(mediaPath(id));
  }),
};
async function load() {
  require('expo').requireOptionalNativeModule.mockReturnValue(storage);
  require('expo-sqlite').openDatabaseAsync.mockImplementation(async () => {
    const c = new RealSQLite(databasePath);
    connections.push(c);
    return c;
  });
  db = await require('@/services/libraryDatabase').openLibraryDatabase();
  library = require('@/services/library') as Library;
}
async function rows() {
  return Promise.all(
    ['library_items', 'collections', 'collection_items', 'playback_queue'].map(
      (t) => db.getAllAsync(`SELECT * FROM ${t} ORDER BY rowid`),
    ),
  );
}
async function seed(
  id: string,
  lifecycle = 'ready',
  source: string | null = null,
) {
  await db.runAsync(
    `INSERT INTO library_items (id,sourceKind,title,mediaType,relativeMediaPath,relativeArtworkPath,artworkSizeBytes,sizeBytes,downloadedAt,lifecycle,sourceCacheRelativePath,playbackPositionSeconds,completedAt) VALUES (?,'direct','Synthetic item','video',?,?,10,100,'2026-01-01T00:00:00Z',?,?,37,'2026-01-02T00:00:00Z')`,
    id,
    mediaPath(id),
    `Artwork/${id}.jpg`,
    lifecycle,
    source,
  );
}
async function fixture(version = 4) {
  await seed(A);
  await seed(B);
  if (version >= 2) {
    await db.runAsync(
      "INSERT INTO collections VALUES (?,'Synthetic','synthetic','2026-01-01','2026-01-01')",
      collection,
    );
    for (const id of [A, B])
      await db.runAsync(
        'INSERT INTO collection_items VALUES (?,?,?)',
        collection,
        id,
        '2026-01-01',
      );
  }
  if (version >= 3) {
    for (let i = 0; i < entries.length; i++)
      await db.runAsync(
        'INSERT INTO playback_queue VALUES (?,?,?,?)',
        entries[i]!,
        i === 1 ? B : A,
        i,
        '2026-01-01',
      );
  }
  for (const id of [A, B]) {
    put(mediaPath(id));
    put(`Artwork/${id}.jpg`, 'VALID-JPEG');
  }
}
async function intact(before: unknown) {
  expect(await rows()).toEqual(before);
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  expect(await db.getFirstAsync('PRAGMA integrity_check')).toEqual({
    integrity_check: 'ok',
  });
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 4,
  });
}
beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'drop-availability-'));
  databasePath = join(directory, 'library.sqlite');
  for (const n of ['Media', 'Artwork', 'Cache']) mkdirSync(join(directory, n));
  connections = [];
  unreadable = null;
  await load();
});
afterEach(async () => {
  for (const c of connections) await c.closeAsync();
  rmSync(directory, { recursive: true, force: true });
});
test('missing ready media preserves relationships, duplicate occurrences and progress', async () => {
  await fixture();
  rmSync(join(directory, mediaPath(A)));
  const before = await rows();
  const found = await library.listLibrary();
  await intact(before);
  expect(found).toHaveLength(2);
  expect(found.find((x) => x.id === A)).toMatchObject({
    availability: 'missing',
    uri: null,
    lifecycle: 'ready',
    playbackPositionSeconds: 37,
  });
  expect(storage.removeArtwork).not.toHaveBeenCalled();
});
test.each([0, 25, 101])(
  'size mismatch %s is preserved until the expected size returns',
  async (size) => {
    await fixture();
    put(mediaPath(A), Buffer.alloc(size));
    const before = await rows();
    expect(await library.getLibraryItem(A)).toMatchObject({
      availability: 'invalid',
      uri: null,
      sizeBytes: 100,
    });
    await intact(before);
    expect(statSync(join(directory, mediaPath(A))).size).toBe(size);
    put(mediaPath(A));
    expect(await library.getLibraryItem(A)).toMatchObject({
      availability: 'available',
      sizeBytes: 100,
    });
    await intact(before);
  },
);
test('all media absent stays visible and counts agree with Collections and Sin colección', async () => {
  await fixture();
  await seed(C);
  rmSync(join(directory, mediaPath(A)));
  rmSync(join(directory, mediaPath(B)));
  const before = await rows();
  expect(await library.listLibrary()).toHaveLength(3);
  const c =
    require('@/services/collections') as typeof import('@/services/collections');
  expect((await c.listCollections())[0]?.itemCount).toBe(2);
  expect(await c.listCollectionItems(collection)).toHaveLength(2);
  expect(await c.countUncollectedItems()).toBe(1);
  expect(await c.listUncollectedItems()).toHaveLength(1);
  expect(await library.librarySpaceUsed()).toBe(20);
  await intact(before);
});
test('transient stat error preserves metadata and recovers on the next read', async () => {
  await fixture();
  unreadable = mediaPath(A);
  const before = await rows();
  expect(await library.getLibraryItem(A)).toMatchObject({
    availability: 'unreadable',
    uri: null,
  });
  await intact(before);
  unreadable = null;
  expect(await library.getLibraryItem(A)).toMatchObject({
    availability: 'available',
  });
  await intact(before);
});
test.each(['absent', 'invalid', 'truncated'])(
  'artwork %s keeps its reference and can recover',
  async (kind) => {
    await fixture();
    if (kind === 'absent') rmSync(join(directory, `Artwork/${A}.jpg`));
    else
      put(`Artwork/${A}.jpg`, kind === 'truncated' ? 'VALID' : 'not an image');
    const before = await rows();
    expect(await library.getLibraryItem(A)).toMatchObject({
      availability: 'available',
      artworkUri: null,
    });
    await intact(before);
    if (kind !== 'absent')
      expect(existsSync(join(directory, `Artwork/${A}.jpg`))).toBe(true);
    put(`Artwork/${A}.jpg`, 'VALID-JPEG');
    expect((await library.getLibraryItem(A))?.artworkUri).toBeTruthy();
    await intact(before);
  },
);
test('repeated reconciliation and JS restart preserve unavailable records', async () => {
  await fixture();
  rmSync(join(directory, mediaPath(A)));
  const before = await rows();
  await library.initializeLibrary();
  await library.initializeLibrary();
  jest.resetModules();
  await load();
  await library.initializeLibrary();
  await intact(before);
  put(mediaPath(A));
  expect(await library.getLibraryItem(A)).toMatchObject({
    availability: 'available',
  });
  await intact(before);
});
test('missing media cannot acquire an export lease', async () => {
  await fixture();
  rmSync(join(directory, mediaPath(A)));
  const action = jest.fn();
  await expect(library.withLibraryLease(A, action)).rejects.toThrow(
    'disponible',
  );
  expect(action).not.toHaveBeenCalled();
});
test('voluntary deletion cascades only its own memberships and occurrences', async () => {
  await fixture();
  rmSync(join(directory, mediaPath(A)));
  await library.initializeLibrary();
  await library.deleteLibraryItem(A);
  expect(
    await db.getFirstAsync('SELECT id FROM library_items WHERE id=?', A),
  ).toBeNull();
  expect(await db.getAllAsync('SELECT itemId FROM collection_items')).toEqual([
    { itemId: B },
  ]);
  expect(await db.getAllAsync('SELECT id,itemId FROM playback_queue')).toEqual([
    { id: entries[1], itemId: B },
  ]);
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS n FROM collections'),
  ).toEqual({ n: 1 });
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});
test('deleting tombstone finishes and recoverable pending source is promoted', async () => {
  await seed(A, 'deleting');
  put(mediaPath(A));
  put(`Artwork/${A}.jpg`, 'VALID-JPEG');
  const src = `MediaDrop/${B}/video.mp4`;
  await seed(B, 'pending', src);
  put(`Cache/${src}`);
  await library.initializeLibrary();
  expect(
    await db.getFirstAsync('SELECT id FROM library_items WHERE id=?', A),
  ).toBeNull();
  expect(await library.getLibraryItem(B)).toMatchObject({
    lifecycle: 'ready',
    availability: 'available',
  });
});
test('abandoned pending is cleaned only after source absence is known', async () => {
  const src = `MediaDrop/${A}/video.mp4`;
  await seed(A, 'pending', src);
  unreadable = `Cache/${src}`;
  await library.initializeLibrary();
  expect(
    await db.getFirstAsync('SELECT lifecycle FROM library_items WHERE id=?', A),
  ).toEqual({ lifecycle: 'pending' });
  unreadable = null;
  jest.resetModules();
  await load();
  await library.initializeLibrary();
  expect(
    await db.getFirstAsync('SELECT id FROM library_items WHERE id=?', A),
  ).toBeNull();
});

test('orphan cleanup does not remove artwork owned by an unavailable record without a reference', async () => {
  await fixture();
  await db.runAsync(
    'UPDATE library_items SET relativeArtworkPath = NULL WHERE id = ?',
    A,
  );
  rmSync(join(directory, mediaPath(A)));
  put(`Artwork/${A}.jpg`, 'truncated');
  put(mediaPath(C));
  put(`Artwork/${C}.jpg`, 'orphan image');
  const before = await rows();
  await library.initializeLibrary();
  await intact(before);
  expect(existsSync(join(directory, `Artwork/${A}.jpg`))).toBe(true);
  expect(existsSync(join(directory, mediaPath(C)))).toBe(false);
  expect(existsSync(join(directory, `Artwork/${C}.jpg`))).toBe(false);
});

test('explicit Delete removes a retained truncated medium and invalid artwork', async () => {
  await fixture();
  put(mediaPath(A), Buffer.alloc(25));
  put(`Artwork/${A}.jpg`, 'broken');
  await library.initializeLibrary();
  await library.deleteLibraryItem(A);
  expect(existsSync(join(directory, mediaPath(A)))).toBe(false);
  expect(existsSync(join(directory, `Artwork/${A}.jpg`))).toBe(false);
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

test.each([1, 2])(
  'a synthetic schema v%s migrates without purging absent confirmed media',
  async (version) => {
    databasePath = join(directory, 'legacy.sqlite');
    db = new RealSQLite(databasePath);
    try {
      await db.execAsync(V1_SCHEMA);
      if (version === 2)
        await db.execAsync(`${V2_COLLECTIONS_SCHEMA} PRAGMA user_version = 2;`);
      await fixture(version);
    } finally {
      await db.closeAsync();
    }
    const legacy = new RealSQLite(databasePath);
    connections.push(legacy);
    const originalItems = await legacy.getAllAsync(
      'SELECT * FROM library_items ORDER BY id',
    );
    const originalMemberships =
      version === 2
        ? await legacy.getAllAsync(
            'SELECT * FROM collection_items ORDER BY itemId',
          )
        : [];
    await legacy.closeAsync();
    rmSync(join(directory, mediaPath(A)));
    rmSync(join(directory, mediaPath(B)));
    jest.resetModules();
    await load();
    expect(await library.listLibrary()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: A,
          availability: 'missing',
          playbackPositionSeconds: 37,
        }),
        expect.objectContaining({
          id: B,
          availability: 'missing',
          playbackPositionSeconds: 37,
        }),
      ]),
    );
    expect(
      await db.getAllAsync('SELECT * FROM library_items ORDER BY id'),
    ).toEqual(originalItems);
    expect(
      await db.getAllAsync('SELECT * FROM collection_items ORDER BY itemId'),
    ).toEqual(version === 2 ? originalMemberships : []);
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({
      user_version: 4,
    });
    expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  },
);

test('pending with unknown expected size is not silently accepted or rewritten', async () => {
  await seed(A, 'pending');
  await db.runAsync('UPDATE library_items SET sizeBytes = 0 WHERE id = ?', A);
  put(mediaPath(A));
  const before = await rows();
  await library.initializeLibrary();
  await intact(before);
  expect(statSync(join(directory, mediaPath(A))).size).toBe(100);
  expect(storage.removeMedia).not.toHaveBeenCalled();
});
