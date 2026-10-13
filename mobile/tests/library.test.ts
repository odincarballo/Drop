jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/libraryDatabase', () => ({
  openLibraryDatabase: jest.fn(),
}));

type Row = Record<string, unknown> & {
  id: string;
  lifecycle: string;
  relativeMediaPath: string;
};
const rows = new Map<string, Row>();
const cache = new Map<string, number>();
const media = new Map<string, number>();
const artwork = new Map<string, number>();
const playbackNative = {
  beginDelete: jest.fn(async () => ({ ready: true })),
  endDelete: jest.fn(async () => ({ ready: true })),
};
let nextId = 1;
let failMove = false;
let failReady = false;
let failArtwork = false;
let beforeReady: (() => void) | null = null;

const db = {
  execAsync: jest.fn(async () => undefined),
  getFirstAsync: jest.fn(async (sql: string, id?: string) => {
    if (sql.includes('user_version')) return { user_version: 1 };
    if (sql.includes('WHERE id =')) return rows.get(id ?? '') ?? null;
    return null;
  }),
  getAllAsync: jest.fn(async (sql: string) => {
    const all = [...rows.values()];
    if (sql.includes('relativeMediaPath FROM'))
      return all.map((row) => ({ relativeMediaPath: row.relativeMediaPath }));
    if (sql.includes('id FROM') && sql.includes('relativeArtworkPath'))
      return all
        .filter((row) => row.relativeArtworkPath && row.lifecycle === 'ready')
        .map((row) => ({ id: row.id }));
    if (sql.includes("WHERE lifecycle = 'ready'"))
      return all.filter((row) => row.lifecycle === 'ready');
    return all;
  }),
  runAsync: jest.fn(async (sql: string, ...values: unknown[]) => {
    if (sql.includes('INSERT INTO')) {
      const [
        id,
        sourceKind,
        sourceVideoId,
        title,
        mediaType,
        relativeMediaPath,
        sourceCacheRelativePath,
        durationSeconds,
        sizeBytes,
        resolution,
        height,
        fps,
        videoCodec,
        audioCodec,
        container,
        downloadedAt,
      ] = values;
      rows.set(String(id), {
        id: String(id),
        sourceKind,
        sourceVideoId,
        title,
        mediaType,
        relativeMediaPath: String(relativeMediaPath),
        relativeArtworkPath: null,
        sourceCacheRelativePath,
        durationSeconds,
        sizeBytes,
        artworkSizeBytes: 0,
        resolution,
        height,
        fps,
        videoCodec,
        audioCodec,
        container,
        downloadedAt,
        playbackPositionSeconds: 0,
        completedAt: null,
        lifecycle: 'pending',
      });
    } else if (sql.includes("SET lifecycle = 'ready'")) {
      if (failReady) throw new Error('database write failed');
      beforeReady?.();
      const row = rows.get(String(values[1]));
      if (row)
        Object.assign(row, {
          lifecycle: 'ready',
          sourceCacheRelativePath: null,
          sizeBytes: values[0],
        });
    } else if (sql.includes('SET relativeArtworkPath')) {
      const row = rows.get(String(values[2]));
      if (row && row.lifecycle === 'ready')
        Object.assign(row, {
          relativeArtworkPath: values[0],
          artworkSizeBytes: values[1],
        });
      return { changes: row?.lifecycle === 'ready' ? 1 : 0 };
    } else if (sql.includes('SET artworkSizeBytes')) {
      const row = rows.get(String(values[1]));
      if (row) row.artworkSizeBytes = values[0];
    } else if (sql.includes("SET lifecycle = 'deleting'")) {
      const row = rows.get(String(values[0]));
      if (row) row.lifecycle = 'deleting';
    } else if (sql.includes('DELETE FROM library_items'))
      rows.delete(String(values[0]));
    return { changes: 1 };
  }),
};

const native = {
  prepare: jest.fn(async () => ({
    databaseDirectoryURL: 'file:///app/Library/Application%20Support/Drop/',
  })),
  inspectSource: jest.fn(async (uri: string) => {
    const relative = uri.replace('file:///cache/', '');
    const size = cache.get(relative);
    if (
      !uri.startsWith('file:///cache/') ||
      size === undefined ||
      relative.includes('..')
    )
      throw new Error('invalid source');
    return {
      id: `00000000-0000-0000-0000-${String(nextId++).padStart(12, '0')}`,
      cacheRelativePath: relative,
      extension: relative.split('.').at(-1),
      sizeBytes: size,
    };
  }),
  movePrepared: jest.fn(async (relative: string, id: string, ext: string) => {
    if (failMove) throw new Error('move failed');
    const size = cache.get(relative);
    if (size === undefined) throw new Error('source missing');
    cache.delete(relative);
    const path = `Media/${id}.${ext}`;
    media.set(path, size);
    return {
      relativeMediaPath: path,
      uri: `file:///library/${path}`,
      sizeBytes: size,
    };
  }),
  statMedia: jest.fn(async (relative: string) =>
    media.has(relative)
      ? {
          exists: true,
          uri: `file:///library/${relative}`,
          sizeBytes: media.get(relative),
        }
      : { exists: false },
  ),
  statArtwork: jest.fn(async (id: string) =>
    artwork.has(id)
      ? {
          exists: true,
          uri: `file:///library/Artwork/${id}.jpg`,
          sizeBytes: artwork.get(id),
        }
      : { exists: false },
  ),
  listMedia: jest.fn(async () => [...media.keys()]),
  listArtwork: jest.fn(async () => [...artwork.keys()]),
  removeMedia: jest.fn(async (relative: string) => {
    media.delete(relative);
  }),
  removeOwnedCache: jest.fn(async (relative: string) => {
    cache.delete(relative);
  }),
  removeArtwork: jest.fn(async (id: string) => {
    artwork.delete(id);
  }),
  saveArtwork: jest.fn(async (_url: string, id: string) => {
    if (failArtwork) throw new Error('invalid artwork');
    artwork.set(id, 1000);
    return { uri: `file:///library/Artwork/${id}.jpg`, sizeBytes: 1000 };
  }),
};

const meta = {
  sourceKind: 'youtube' as const,
  sourceVideoId: 'AWGPaFraPN4',
  title: '../../otro.mp4',
  mediaType: 'video' as const,
  durationSeconds: 121,
  thumbnailUrl: 'https://i.ytimg.com/vi/AWGPaFraPN4/default.jpg',
};

function service(): typeof import('@/services/library') {
  return require('@/services/library') as typeof import('@/services/library');
}

beforeEach(() => {
  jest.resetModules();
  rows.clear();
  cache.clear();
  media.clear();
  artwork.clear();
  nextId = 1;
  failMove = false;
  failReady = false;
  failArtwork = false;
  beforeReady = null;
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockImplementation((name: string) =>
    name === 'DropPlayback' ? playbackNative : native,
  );
  const database = require('@/services/libraryDatabase') as {
    openLibraryDatabase: jest.Mock;
  };
  database.openLibraryDatabase.mockResolvedValue(db);
  jest.clearAllMocks();
});

test('YouTube completion moves once, confirms ready, and keeps safe paths', async () => {
  cache.set('MediaDrop/job/video.mp4', 457_000_000);
  const library = service();
  const item = await library.promoteToLibrary(
    'file:///cache/MediaDrop/job/video.mp4',
    meta,
  );
  expect(item.lifecycle).toBe('ready');
  expect(item.relativeMediaPath).toMatch(/^Media\/00000000-.*\.mp4$/);
  expect(item.relativeMediaPath).not.toContain('otro');
  expect(cache.size).toBe(0);
  expect(media.size).toBe(1);
  expect((await library.listLibrary())[0]?.title).toBe('../../otro.mp4');
  expect(
    (
      require('@/services/libraryDatabase') as {
        openLibraryDatabase: jest.Mock;
      }
    ).openLibraryDatabase,
  ).toHaveBeenCalled();
  expect(await library.librarySpaceUsed()).toBe(457_001_000);
});

test('direct media promotes without a second media copy and survives service restart', async () => {
  cache.set('mediadrop-0123456789abcdef0123456789abcdef-clip.mp3', 20_000_000);
  let library = service();
  await library.promoteToLibrary(
    'file:///cache/mediadrop-0123456789abcdef0123456789abcdef-clip.mp3',
    { sourceKind: 'direct', title: 'Podcast', mediaType: 'audio' },
  );
  jest.resetModules();
  (
    require('expo') as { requireOptionalNativeModule: jest.Mock }
  ).requireOptionalNativeModule.mockImplementation((name: string) =>
    name === 'DropPlayback' ? playbackNative : native,
  );
  (
    require('@/services/libraryDatabase') as { openLibraryDatabase: jest.Mock }
  ).openLibraryDatabase.mockResolvedValue(db);
  library = service();
  expect((await library.listLibrary())[0]?.sizeBytes).toBe(20_000_000);
  expect(native.movePrepared).toHaveBeenCalledTimes(1);
});

test('move failure cleans its source and never publishes ready', async () => {
  cache.set('MediaDrop/job/video.mp4', 1);
  failMove = true;
  const library = service();
  await expect(
    library.promoteToLibrary('file:///cache/MediaDrop/job/video.mp4', meta),
  ).rejects.toThrow('move failed');
  expect(await library.listLibrary()).toEqual([]);
  expect(rows.size).toBe(0);
  expect(cache.size).toBe(0);
});

test('restart finalizes a move interrupted before ready', async () => {
  cache.set('MediaDrop/job/video.mp4', 10);
  failReady = true;
  let library = service();
  await expect(
    library.promoteToLibrary('file:///cache/MediaDrop/job/video.mp4', meta),
  ).rejects.toThrow('database write failed');
  expect([...rows.values()][0]?.lifecycle).toBe('pending');
  failReady = false;
  jest.resetModules();
  (
    require('expo') as { requireOptionalNativeModule: jest.Mock }
  ).requireOptionalNativeModule.mockImplementation((name: string) =>
    name === 'DropPlayback' ? playbackNative : native,
  );
  (
    require('@/services/libraryDatabase') as { openLibraryDatabase: jest.Mock }
  ).openLibraryDatabase.mockResolvedValue(db);
  library = service();
  expect((await library.listLibrary())[0]?.lifecycle).toBe('ready');
});

test('a moved file with a changed size is never published', async () => {
  cache.set('MediaDrop/job/video.mp4', 10);
  native.movePrepared.mockImplementationOnce(
    async (relative: string, id: string, ext: string) => {
      cache.delete(relative);
      const path = `Media/${id}.${ext}`;
      media.set(path, 9);
      return {
        relativeMediaPath: path,
        uri: `file:///library/${path}`,
        sizeBytes: 9,
      };
    },
  );
  const library = service();
  await expect(
    library.promoteToLibrary('file:///cache/MediaDrop/job/video.mp4', meta),
  ).rejects.toThrow('cambió');
  expect(await library.listLibrary()).toEqual([]);
  expect(media.size).toBe(0);
});

test('restart clears missing pending/ready and orphan media, but retains valid ready', async () => {
  rows.set('00000000-0000-0000-0000-000000000001', {
    id: '00000000-0000-0000-0000-000000000001',
    lifecycle: 'pending',
    relativeMediaPath: 'Media/00000000-0000-0000-0000-000000000001.mp4',
    sourceCacheRelativePath: 'MediaDrop/missing/video.mp4',
  });
  rows.set('00000000-0000-0000-0000-000000000002', {
    id: '00000000-0000-0000-0000-000000000002',
    lifecycle: 'ready',
    relativeMediaPath: 'Media/00000000-0000-0000-0000-000000000002.mp4',
  });
  media.set('Media/00000000-0000-0000-0000-000000000003.mp4', 100);
  const library = service();
  expect(await library.listLibrary()).toEqual([]);
  expect(rows.size).toBe(0);
  expect(media.size).toBe(0);
});

test('deletion respects export lease and cleans media, artwork, metadata and space', async () => {
  cache.set('MediaDrop/job/video.mp4', 30);
  const library = service();
  const item = await library.promoteToLibrary(
    'file:///cache/MediaDrop/job/video.mp4',
    meta,
  );
  artwork.set(item.id, 10);
  let release!: () => void;
  const active = library.withLibraryLease(
    item.id,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  await library.deleteLibraryItem(item.id);
  expect(await library.listLibrary()).toEqual([]);
  expect(media.size).toBe(1);
  release();
  await active;
  expect(media.size).toBe(0);
  expect(artwork.size).toBe(0);
  expect(rows.size).toBe(0);
  expect(await library.librarySpaceUsed()).toBe(0);
});

test('artwork failure never invalidates media', async () => {
  cache.set('MediaDrop/job/video.mp4', 10);
  failArtwork = true;
  const library = service();
  const item = await library.promoteToLibrary(
    'file:///cache/MediaDrop/job/video.mp4',
    meta,
  );
  await new Promise((resolve) => setImmediate(resolve));
  expect(item.lifecycle).toBe('ready');
  expect((await library.listLibrary())[0]?.artworkUri).toBeNull();
});

test('rejects a partial/traversal source and does not create a record', async () => {
  const library = service();
  await expect(
    library.promoteToLibrary('file:///cache/../secret.mp4', meta),
  ).rejects.toThrow();
  await expect(
    library.promoteToLibrary('file:///cache/MediaDrop/job/video.part', meta),
  ).rejects.toThrow();
  expect(rows.size).toBe(0);
});

test('deleting interrupted on restart is completed', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const path = `Media/${id}.mp4`;
  rows.set(id, { id, lifecycle: 'deleting', relativeMediaPath: path });
  media.set(path, 10);
  artwork.set(id, 1);
  const library = service();
  await library.initializeLibrary();
  expect(rows.size).toBe(0);
  expect(media.size).toBe(0);
  expect(artwork.size).toBe(0);
});

test('Delete closes native player before physically removing media', async () => {
  cache.set('MediaDrop/job/video.mp4', 10);
  const library = service();
  const item = await library.promoteToLibrary(
    'file:///cache/MediaDrop/job/video.mp4',
    meta,
  );
  await library.deleteLibraryItem(item.id);
  expect(playbackNative.beginDelete).toHaveBeenCalledWith(item.id);
  expect(playbackNative.endDelete).toHaveBeenCalledWith(item.id);
  expect(native.removeMedia).toHaveBeenCalled();
  expect(playbackNative.beginDelete.mock.invocationCallOrder[0]!).toBeLessThan(
    native.removeMedia.mock.invocationCallOrder[0]!,
  );
  expect(media.size).toBe(0);
});

test('failed native deletion barrier does not mark ready media deleting', async () => {
  cache.set('MediaDrop/job/video.mp4', 10);
  const library = service();
  const item = await library.promoteToLibrary(
    'file:///cache/MediaDrop/job/video.mp4',
    meta,
  );
  playbackNative.beginDelete.mockRejectedValueOnce(new Error('player busy'));
  await expect(library.deleteLibraryItem(item.id)).rejects.toThrow(
    'player busy',
  );
  expect(rows.get(item.id)?.lifecycle).toBe('ready');
  expect(media.size).toBe(1);
});

test('concurrent Delete requests share one coordinated operation', async () => {
  cache.set('MediaDrop/job/video.mp4', 10);
  const library = service();
  const item = await library.promoteToLibrary(
    'file:///cache/MediaDrop/job/video.mp4',
    meta,
  );
  const first = library.deleteLibraryItem(item.id);
  const second = library.deleteLibraryItem(item.id);
  expect(second).toBe(first);
  await Promise.all([first, second]);
  expect(native.removeMedia).toHaveBeenCalledTimes(1);
});
