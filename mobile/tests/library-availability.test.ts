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
  isPlayableLibraryItem,
  playbackContextFromVisibleItems,
} from '@/utils/playbackContext';
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
  cleanupImportStaging: jest.fn(async (_protectedPaths: string[]) => undefined),
  listMedia: jest.fn(async () =>
    ['Media', 'ImportedMedia'].flatMap((folder) =>
      readdirSync(join(directory, folder)).map((n) => `${folder}/${n}`),
    ),
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
  localImportIdentity: jest.fn(async (uri: string) => importIdentity(uri)),
  inspectSource: jest.fn(async (uri: string) => {
    const source = importIdentity(uri);
    const prepared = stat(`Cache/${source.cacheRelativePath}`);
    if (!prepared.exists || !prepared.sizeBytes)
      throw new Error('invalid staged source');
    return {
      ...source,
      extension: source.relativeMediaPath.split('.').at(-1),
      sizeBytes: prepared.sizeBytes,
    };
  }),
  confirmImported: jest.fn(
    async (
      _relative: string,
      _id: string,
      _size: number,
      mediaType: string,
    ) => ({
      mediaType,
      durationSeconds: 2.5,
    }),
  ),
  removeOwnedCache: jest.fn(async (relative: string) =>
    rmSync(join(directory, 'Cache', relative), { force: true }),
  ),
  movePrepared: jest.fn(
    async (rel: string, id: string, ext = 'mp4', kind = 'direct') => {
      const relative =
        kind === 'local' ? `ImportedMedia/${id}.${ext}` : mediaPath(id);
      renameSync(join(directory, 'Cache', rel), join(directory, relative));
      return { ...stat(relative), relativeMediaPath: relative };
    },
  ),
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
  for (const n of ['Media', 'ImportedMedia', 'Artwork', 'Cache'])
    mkdirSync(join(directory, n));
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

test('deleting an import preserves existing downloads and their relationships', async () => {
  await fixture();
  const before = await rows();
  const relative = `ImportedMedia/${C}.mp3`;
  await seed(C);
  await db.runAsync(
    "UPDATE library_items SET sourceKind = 'local', mediaType = 'audio', relativeMediaPath = ? WHERE id = ?",
    relative,
    C,
  );
  put(relative);
  expect(await library.getLibraryItem(C)).toMatchObject({
    availability: 'available',
    relativeMediaPath: relative,
  });
  await library.deleteLibraryItem(C);
  expect(storage.removeMedia).toHaveBeenCalledWith(relative);
  for (const id of [A, B])
    expect(statSync(join(directory, mediaPath(id))).size).toBe(100);
  await intact(before);
});

// The native media decoder is covered by the Swift fixtures. This adapter exercises
// orchestration, actual SQLite transactions and files without provider or device data.
function importIdentity(uri: string) {
  const prefix = `file://${directory}/Cache/`;
  if (!uri.startsWith(prefix)) throw new Error('invalid import location');
  const relative = uri.slice(prefix.length);
  const match = /^DropImport\/([0-9a-f-]{36})\/payload\.(mp3|m4a|mp4)$/.exec(
    relative,
  );
  if (!match) throw new Error('invalid import identity');
  return {
    id: match[1]!,
    cacheRelativePath: relative,
    relativeMediaPath: `ImportedMedia/${match[1]}.${match[2]}`,
  };
}
function localPreparation(id = C, ext = 'mp3') {
  const relative = `DropImport/${id}/payload.${ext}`;
  put(`Cache/${relative}`);
  return {
    uri: `file://${directory}/Cache/${relative}`,
    title: '  中文\u0000 Podcast  ',
    mediaType: ext === 'mp4' ? ('video' as const) : ('audio' as const),
  };
}

describe('prepared local imports', () => {
  test.each(['mp3', 'm4a', 'mp4'])(
    '%s is available with verified metadata and the existing playback context',
    async (ext) => {
      await fixture();
      await library.initializeLibrary();
      const before = await rows();
      const prepared = localPreparation(C, ext);
      const notify = jest.fn();
      const unsubscribe = library.observeLibrary(notify);
      const imported = await library.importPreparedLocalFile(prepared);
      unsubscribe();
      expect(imported).toMatchObject({
        id: C,
        sourceKind: 'local',
        title: '中文 Podcast',
        mediaType: prepared.mediaType,
        durationSeconds: 2.5,
        lifecycle: 'ready',
        availability: 'available',
        sourceVideoId: null,
        relativeArtworkPath: null,
        videoCodec: null,
        audioCodec: null,
        playbackPositionSeconds: 0,
        completedAt: null,
      });
      expect(Date.parse(imported.downloadedAt)).toBeGreaterThan(0);
      expect(isPlayableLibraryItem(imported)).toBe(true);
      expect(playbackContextFromVisibleItems([imported]).orderedIds).toEqual([
        C,
      ]);
      expect(notify).toHaveBeenCalledTimes(1);
      expect((await library.listLibrary()).map((item) => item.id)).toContain(C);
      expect(await library.getLibraryItem(C)).toEqual(imported);
      expect(await library.withLibraryLease(C, async (file) => file.uri)).toBe(
        imported.uri,
      );
      const after = await rows();
      expect(
        after[0]?.filter((row) => (row as { id: string }).id !== C),
      ).toEqual(before[0]);
      expect(after.slice(1)).toEqual(before.slice(1));
      await library.deleteLibraryItem(C);
      await intact(before);
      for (const id of [A, B])
        expect(statSync(join(directory, mediaPath(id))).size).toBe(100);
    },
  );

  test('double activation and a repeated completed callback produce one row and one notification', async () => {
    await library.initializeLibrary();
    const prepared = localPreparation();
    const notify = jest.fn();
    const unsubscribe = library.observeLibrary(notify);
    const [a, b] = await Promise.all([
      library.importPreparedLocalFile(prepared),
      library.importPreparedLocalFile({ ...prepared }),
    ]);
    expect(a.id).toBe(b.id);
    expect(
      await library.importPreparedLocalFile({
        ...prepared,
        title: 'late callback',
      }),
    ).toEqual(a);
    expect(storage.movePrepared).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await library.listLibrary()).toHaveLength(1);
    unsubscribe();
  });

  test('two deliberate preparations of the same content keep separate UUIDs', async () => {
    const first = localPreparation();
    const a = await library.importPreparedLocalFile(first);
    const second = localPreparation('00000000-0000-0000-0000-000000000009');
    const b = await library.importPreparedLocalFile(second);
    expect(a.title).toBe(b.title);
    expect(a.id).not.toBe(b.id);
    expect(await library.listLibrary()).toHaveLength(2);
  });

  test('a different import is rejected while the accepted operation is still active', async () => {
    await library.initializeLibrary();
    const first = localPreparation();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    storage.confirmImported.mockImplementationOnce(async () => {
      started();
      await gate;
      return { mediaType: 'audio', durationSeconds: 2.5 };
    });
    const accepted = library.importPreparedLocalFile(first);
    await waiting;
    const next = localPreparation('00000000-0000-0000-0000-000000000009');
    try {
      await expect(library.importPreparedLocalFile(next)).rejects.toThrow(
        'en curso',
      );
    } finally {
      release();
    }
    expect((await accepted).id).toBe(C);
    expect((await library.importPreparedLocalFile(next)).id).not.toBe(C);
  });

  test('startup cleanup protects the prepared file being accepted', async () => {
    const prepared = localPreparation();
    storage.cleanupImportStaging.mockImplementationOnce(
      async (protectedPaths: string[]) => {
        expect(protectedPaths).toContain(`DropImport/${C}/payload.mp3`);
      },
    );
    expect((await library.importPreparedLocalFile(prepared)).id).toBe(C);
  });

  test('a failed move can be retried in the same session with the same UUID', async () => {
    const prepared = localPreparation();
    storage.movePrepared.mockRejectedValueOnce(new Error('move interrupted'));
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow(
      'move interrupted',
    );
    expect(
      await db.getFirstAsync(
        'SELECT lifecycle FROM library_items WHERE id = ?',
        C,
      ),
    ).toEqual({ lifecycle: 'pending' });
    expect((await library.importPreparedLocalFile(prepared)).id).toBe(C);
    expect(await library.listLibrary()).toHaveLength(1);
  });

  test('a failed SQLite confirmation recovers the moved file without a second move', async () => {
    await library.initializeLibrary();
    const prepared = localPreparation();
    await db.execAsync(
      "CREATE TEMP TRIGGER fail_import_ready BEFORE UPDATE OF lifecycle ON library_items WHEN NEW.lifecycle = 'ready' BEGIN SELECT RAISE(ABORT, 'confirmation interrupted'); END",
    );
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow(
      'confirmation interrupted',
    );
    expect(existsSync(join(directory, `ImportedMedia/${C}.mp3`))).toBe(true);
    await db.execAsync('DROP TRIGGER fail_import_ready');
    expect(
      (await library.importPreparedLocalFile(prepared)).durationSeconds,
    ).toBe(2.5);
    expect(storage.movePrepared).toHaveBeenCalledTimes(1);
    expect(await library.listLibrary()).toHaveLength(1);
  });

  test('an INSERT failure cleans only an unregistered staging copy', async () => {
    await fixture();
    await library.initializeLibrary();
    const before = await rows();
    const prepared = localPreparation();
    await db.execAsync(
      "CREATE TEMP TRIGGER fail_import_insert BEFORE INSERT ON library_items BEGIN SELECT RAISE(ABORT, 'insert interrupted'); END",
    );
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow(
      'insert interrupted',
    );
    expect(storage.removeOwnedCache).toHaveBeenCalledWith(
      `DropImport/${C}/payload.mp3`,
    );
    await intact(before);
  });

  test('an INSERT with an uncertain acknowledgement preserves pending and can be retried', async () => {
    await library.initializeLibrary();
    const prepared = localPreparation();
    const run = db.runAsync.bind(db);
    jest
      .spyOn(db, 'runAsync')
      .mockImplementationOnce(async (sql, ...params) => {
        await run(sql, ...params);
        throw new Error('insert acknowledgement lost');
      });
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow(
      'acknowledgement lost',
    );
    expect(storage.removeOwnedCache).not.toHaveBeenCalled();
    expect((await library.importPreparedLocalFile(prepared)).id).toBe(C);
    expect(storage.movePrepared).toHaveBeenCalledTimes(1);
  });

  test('transient media errors preserve ready and allow retry without recreating the import', async () => {
    const prepared = localPreparation();
    await library.importPreparedLocalFile(prepared);
    const before = await rows();
    unreadable = `ImportedMedia/${C}.mp3`;
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow();
    await intact(before);
    unreadable = null;
    expect((await library.importPreparedLocalFile(prepared)).id).toBe(C);
    expect(storage.movePrepared).toHaveBeenCalledTimes(1);
  });

  test('reopening preserves the import and a stale callback cannot resurrect an explicitly deleted row', async () => {
    const prepared = localPreparation();
    const item = await library.importPreparedLocalFile(prepared);
    jest.resetModules();
    await load();
    expect(await library.getLibraryItem(C)).toEqual(item);
    expect((await library.importPreparedLocalFile(prepared)).id).toBe(C);
    await library.deleteLibraryItem(C);
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow();
    expect(await library.listLibrary()).toEqual([]);
  });

  test('a conflicting existing identity and an external path are rejected without touching data', async () => {
    await fixture();
    const before = await rows();
    const prepared = localPreparation(A);
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow();
    await expect(
      library.importPreparedLocalFile({
        ...prepared,
        uri: 'file:///outside/payload.mp3',
      }),
    ).rejects.toThrow();
    await intact(before);
    expect(storage.movePrepared).not.toHaveBeenCalled();
  });

  test('an invalid native duration never publishes ready', async () => {
    const prepared = localPreparation();
    storage.confirmImported.mockResolvedValueOnce({
      mediaType: 'audio',
      durationSeconds: 0,
    });
    await expect(library.importPreparedLocalFile(prepared)).rejects.toThrow();
    expect(await library.listLibrary()).toEqual([]);
    expect(
      await db.getFirstAsync(
        'SELECT lifecycle FROM library_items WHERE id = ?',
        C,
      ),
    ).toEqual({ lifecycle: 'pending' });
  });
});

test('local promotion stores the authoritative duration returned by native confirmation', async () => {
  const prepared = localPreparation();
  const item = await library.promoteToLibrary(prepared.uri, {
    sourceKind: 'local',
    title: 'Audio',
    mediaType: 'audio',
    durationSeconds: 999,
  });
  expect(item.durationSeconds).toBe(2.5);
});
