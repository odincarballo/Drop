/** @jest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealSQLite } from './support/realSQLite';
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/playback', () => ({
  beginPlaybackDeletion: jest.fn(),
  endPlaybackDeletion: jest.fn(),
}));
const id = '00000000-0000-0000-0000-000000000001';
const prepared = {
  uri: `file:///cache/DropImport/${id}/payload.mp3`,
  title: 'Canción 東京',
  mediaType: 'audio' as const,
  artist: 'Artista',
  album: 'Álbum',
  genre: 'Jazz',
  year: 2024,
};
let directory: string,
  connections: RealSQLite[],
  media: boolean,
  art: boolean,
  failSQL: boolean;
let service: typeof import('@/services/library');
const native = {
  inspectExistingMetadata: jest.fn(),
  cancelExistingMetadata: jest.fn(),
  publishExistingArtwork: jest.fn(),
  finishExistingArtwork: jest.fn(),
  discardExistingMetadata: jest.fn(),
  prepare: jest.fn(),
  localImportIdentity: jest.fn(),
  inspectSource: jest.fn(),
  movePrepared: jest.fn(),
  confirmImported: jest.fn(),
  cleanupImportStaging: jest.fn(),
  listMedia: jest.fn(),
  listArtwork: jest.fn(),
  statMedia: jest.fn(),
  statArtwork: jest.fn(),
  statPreparedSource: jest.fn(),
  removeMedia: jest.fn(),
  removeArtwork: jest.fn(),
  removeOwnedCache: jest.fn(),
  publishLocalArtwork: jest.fn(),
  finishLocalArtwork: jest.fn(),
  discardLocalArtwork: jest.fn(),
};
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'drop-enriched-'));
  connections = [];
  media = false;
  art = false;
  failSQL = false;
  native.prepare.mockResolvedValue({
    databaseDirectoryURL: `file://${directory}/`,
  });
  native.localImportIdentity.mockResolvedValue({
    id,
    cacheRelativePath: `DropImport/${id}/payload.mp3`,
    relativeMediaPath: `ImportedMedia/${id}.mp3`,
  });
  native.inspectSource.mockResolvedValue({
    id,
    cacheRelativePath: `DropImport/${id}/payload.mp3`,
    relativeMediaPath: `ImportedMedia/${id}.mp3`,
    extension: 'mp3',
    sizeBytes: 123,
  });
  native.movePrepared.mockImplementation(async () => {
    media = true;
    return {
      relativeMediaPath: `ImportedMedia/${id}.mp3`,
      uri: 'file:///media',
      sizeBytes: 123,
    };
  });
  native.confirmImported.mockResolvedValue({
    mediaType: 'audio',
    durationSeconds: 10,
  });
  native.listMedia.mockResolvedValue([]);
  native.listArtwork.mockResolvedValue([]);
  native.cleanupImportStaging.mockResolvedValue(undefined);
  native.statMedia.mockImplementation(async () => ({
    exists: media,
    uri: 'file:///media',
    sizeBytes: 123,
  }));
  native.statArtwork.mockImplementation(async () => ({
    exists: art,
    uri: 'file:///art',
    sizeBytes: 20,
  }));
  native.publishLocalArtwork.mockImplementation(async () => {
    art = true;
    return {
      relativePath: `Artwork/${id}.jpg`,
      sizeBytes: 20,
      token: 'operation',
    };
  });
  native.finishLocalArtwork.mockImplementation(
    async (_id: string, _token: string, keep: boolean) => {
      if (!keep) art = false;
    },
  );
  native.removeMedia.mockImplementation(async () => {
    media = false;
  });
  native.removeArtwork.mockImplementation(async () => {
    art = false;
  });
  jest.requireMock('expo').requireOptionalNativeModule.mockReturnValue(native);
  jest
    .requireMock('expo-sqlite')
    .openDatabaseAsync.mockImplementation(async () => {
      const d = new RealSQLite(join(directory, 'library.sqlite'));
      connections.push(d);
      const run = d.runAsync.bind(d);
      d.runAsync = async (sql, ...params) => {
        if (failSQL && /SET relativeArtworkPath/.test(sql))
          throw Error('injected artwork SQL');
        return run(sql, ...params);
      };
      return d;
    });
  service = jest.requireActual('@/services/library');
});
function database() {
  return connections.find((connection) => !connection.closed)!;
}
afterEach(async () => {
  await Promise.all(connections.map((c) => c.closeAsync()));
  rmSync(directory, { recursive: true, force: true });
});
test('new import persists available descriptive metadata and native image in real SQLite', async () => {
  const item = await service.importPreparedLocalFile(prepared);
  expect(item).toMatchObject({
    id,
    title: prepared.title,
    artist: prepared.artist,
    album: prepared.album,
    genre: 'Jazz',
    year: 2024,
    relativeArtworkPath: `Artwork/${id}.jpg`,
    durationSeconds: 10,
    sourceKind: 'local',
    availability: 'available',
  });
  expect(native.finishLocalArtwork).toHaveBeenCalledWith(id, 'operation', true);
  expect(await database().getFirstAsync('PRAGMA integrity_check')).toEqual({
    integrity_check: 'ok',
  });
  expect(await database().getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  const reopened = new RealSQLite(join(directory, 'library.sqlite'));
  connections.push(reopened);
  expect(
    await reopened.getFirstAsync(
      'SELECT artist,year,relativeArtworkPath FROM library_items WHERE id=?',
      id,
    ),
  ).toMatchObject({
    artist: 'Artista',
    year: 2024,
    relativeArtworkPath: `Artwork/${id}.jpg`,
  });
});
test('missing optional fields and artwork retain playable filename fallback', async () => {
  native.publishLocalArtwork.mockResolvedValue(null);
  const item = await service.importPreparedLocalFile({
    uri: prepared.uri,
    title: 'original filename',
    mediaType: 'audio',
  });
  expect(item).toMatchObject({
    title: 'original filename',
    artist: null,
    album: null,
    genre: null,
    year: null,
    relativeArtworkPath: null,
    availability: 'available',
  });
});
test('bad optional values are omitted without failing the medium', async () => {
  const item = await service.importPreparedLocalFile({
    ...prepared,
    year: 10000,
    artist: ' ',
    album: 42 as unknown as string,
  });
  expect(item).toMatchObject({
    artist: null,
    album: null,
    year: null,
    genre: 'Jazz',
    availability: 'available',
  });
});
test('JPEG publication failure is optional and never removes medium', async () => {
  native.publishLocalArtwork.mockRejectedValue(Error('JPEG failure'));
  expect(await service.importPreparedLocalFile(prepared)).toMatchObject({
    artist: 'Artista',
    relativeArtworkPath: null,
    availability: 'available',
  });
  expect(native.removeMedia).not.toHaveBeenCalled();
});
test('SQL failure compensates owned JPEG only and leaves playable metadata', async () => {
  failSQL = true;
  expect(await service.importPreparedLocalFile(prepared)).toMatchObject({
    artist: 'Artista',
    relativeArtworkPath: null,
    availability: 'available',
  });
  expect(native.finishLocalArtwork).toHaveBeenCalledWith(
    id,
    'operation',
    false,
  );
  expect(art).toBe(false);
  expect(media).toBe(true);
});
test('unowned preexisting image is never compensated on SQL failure', async () => {
  failSQL = true;
  art = true;
  native.publishLocalArtwork.mockResolvedValue({
    relativePath: `Artwork/${id}.jpg`,
    sizeBytes: 20,
  });
  expect(await service.importPreparedLocalFile(prepared)).toMatchObject({
    relativeArtworkPath: null,
    availability: 'available',
  });
  expect(native.finishLocalArtwork).not.toHaveBeenCalled();
  expect(art).toBe(true);
});
test('idempotent concurrent and later retry never overwrite existing metadata or image', async () => {
  const [first, duplicate] = await Promise.all([
    service.importPreparedLocalFile(prepared),
    service.importPreparedLocalFile(prepared),
  ]);
  expect(duplicate.id).toBe(first.id);
  await database().runAsync(
    'UPDATE library_items SET playbackPositionSeconds=7,completedAt=? WHERE id=?',
    'done',
    id,
  );
  const retried = await service.importPreparedLocalFile({
    ...prepared,
    title: 'Overwrite',
    artist: 'Overwrite',
  });
  expect(retried).toMatchObject({
    title: prepared.title,
    artist: 'Artista',
    playbackPositionSeconds: 7,
    completedAt: 'done',
  });
  expect(native.publishLocalArtwork).toHaveBeenCalledTimes(1);
  expect(native.movePrepared).toHaveBeenCalledTimes(1);
});
test('concurrent deletion during publication cannot recreate row or attach late artwork', async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const wait = new Promise<void>((r) => {
    release = r;
  });
  native.publishLocalArtwork.mockImplementation(async () => {
    entered();
    await wait;
    art = true;
    return {
      relativePath: `Artwork/${id}.jpg`,
      sizeBytes: 20,
      token: 'operation',
    };
  });
  const importing = service.importPreparedLocalFile(prepared);
  await started;
  await service.deleteLibraryItem(id);
  release();
  await expect(importing).rejects.toThrow();
  expect(
    await database().getFirstAsync(
      'SELECT id FROM library_items WHERE id=?',
      id,
    ),
  ).toBeNull();
  expect(art).toBe(false);
  expect(media).toBe(false);
});
test('mismatched artwork path is not attached and cannot remove other files', async () => {
  native.publishLocalArtwork.mockResolvedValue({
    relativePath: 'Artwork/another.jpg',
    sizeBytes: 20,
    token: 'operation',
  });
  expect(await service.importPreparedLocalFile(prepared)).toMatchObject({
    relativeArtworkPath: null,
    availability: 'available',
  });
  expect(native.removeArtwork).not.toHaveBeenCalled();
});
test('missing native image after publication never produces dangling SQL reference', async () => {
  native.statArtwork.mockResolvedValue({ exists: false });
  expect(await service.importPreparedLocalFile(prepared)).toMatchObject({
    relativeArtworkPath: null,
    availability: 'available',
  });
  expect(native.finishLocalArtwork).toHaveBeenCalledWith(
    id,
    'operation',
    false,
  );
});

test('new enrichment preserves unrelated identifiers, collection, queue occurrences and progress', async () => {
  await service.initializeLibrary();
  const d = database();
  await d.runAsync(
    `INSERT INTO library_items(id,sourceKind,title,mediaType,relativeMediaPath,durationSeconds,sizeBytes,downloadedAt,playbackPositionSeconds,completedAt,lifecycle,artist) VALUES('existing','local','Original','audio','ImportedMedia/existing.m4a',10,123,'before',4,'complete','ready','Existing artist')`,
  );
  await d.runAsync(
    "INSERT INTO collections VALUES('collection','Colección','colección','before','before')",
  );
  await d.runAsync(
    "INSERT INTO collection_items VALUES('collection','existing','before')",
  );
  await d.runAsync(
    "INSERT INTO playback_queue VALUES('q1','existing',0,'before'),('q2','existing',1,'before')",
  );
  const before = await d.getFirstAsync(
    'SELECT * FROM library_items WHERE id=?',
    'existing',
  );
  const collections = await d.getAllAsync('SELECT * FROM collection_items');
  const queue = await d.getAllAsync(
    'SELECT * FROM playback_queue ORDER BY position',
  );
  const item = await service.importPreparedLocalFile(prepared);
  expect(
    await d.getFirstAsync('SELECT * FROM library_items WHERE id=?', 'existing'),
  ).toEqual(before);
  expect(await d.getAllAsync('SELECT * FROM collection_items')).toEqual(
    collections,
  );
  expect(
    await d.getAllAsync('SELECT * FROM playback_queue ORDER BY position'),
  ).toEqual(queue);
  expect(
    await service.withLibraryLease(item.id, async (playable) => playable.uri),
  ).toBe('file:///media');
  expect(await d.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

// The limit counts Unicode code points, not complete grapheme clusters.
test.each([
  ['239 ASCII plus emoji', 'a'.repeat(239) + '😀'],
  ['emoji exactly at boundary', '😀'.repeat(240)],
  ['emoji after boundary', 'a'.repeat(240) + '😀'],
  ['mixed Unicode', 'A😀é東京'.repeat(70)],
  ['CJK', '東京漢'.repeat(100)],
  ['short title', 'Música 😀 東京'],
  ['over limit', 'Title'.repeat(60)],
  ['combining code points', 'e\u0301'.repeat(121)],
])('Unicode roundtrip: %s', async (_label, text) => {
  const expected = Array.from(text).slice(0, 240).join('');
  const item = await service.importPreparedLocalFile({
    ...prepared,
    title: text,
    artist: text,
    album: text,
    genre: text,
  });
  expect(item).toMatchObject({
    title: expected,
    artist: expected,
    album: expected,
    genre: expected,
  });
  const reopened = new RealSQLite(join(directory, 'library.sqlite'));
  connections.push(reopened);
  const row = await reopened.getFirstAsync<Record<string, string>>(
    'SELECT title,artist,album,genre FROM library_items WHERE id=?',
    id,
  );
  for (const value of Object.values(row!)) {
    expect(value).toBe(expected);
    expect(value).not.toContain('\uFFFD');
    expect(value).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
    expect(Array.from(value).length).toBeLessThanOrEqual(240);
  }
});
test('Unicode correction preserves normalization and empty-title fallback', async () => {
  const item = await service.importPreparedLocalFile({
    ...prepared,
    title: ' \n\t ',
    artist: ' \n ',
    album: '  Álbum\t 東京  ',
    genre: '\u0000Jazz\n',
  });
  expect(item).toMatchObject({
    title: 'Archivo de Drop',
    artist: null,
    album: 'Álbum 東京',
    genre: 'Jazz',
  });
});

describe('explicit existing metadata completion', () => {
  beforeEach(async () => {
    native.publishLocalArtwork.mockResolvedValue(null);
    await service.importPreparedLocalFile({
      uri: prepared.uri,
      title: 'Existing name',
      mediaType: 'audio',
    });
    native.inspectExistingMetadata.mockResolvedValue({
      title: 'Embedded name',
      artist: 'Artista',
      album: 'Álbum',
      genre: 'Jazz',
      year: 2024,
    });
    native.publishExistingArtwork.mockResolvedValue(null);
    native.cancelExistingMetadata.mockResolvedValue(undefined);
  });
  test.each([false, true])(
    'title replacement requires exact explicit choice %s',
    async (replace) => {
      const decide = jest.fn(async () =>
        replace ? ('replace' as const) : ('keep' as const),
      );
      expect(await service.completeExistingLocalMetadata(id, decide)).toBe(
        true,
      );
      expect(decide).toHaveBeenCalledWith('Existing name', 'Embedded name');
      expect(await service.getLibraryItem(id)).toMatchObject({
        title: replace ? 'Embedded name' : 'Existing name',
        artist: 'Artista',
        year: 2024,
      });
    },
  );
  test('cancel all at proposal writes nothing', async () => {
    expect(
      await service.completeExistingLocalMetadata(id, async () => 'cancel'),
    ).toBe(false);
    expect(await service.getLibraryItem(id)).toMatchObject({
      title: 'Existing name',
      artist: null,
    });
    expect(native.publishExistingArtwork).not.toHaveBeenCalled();
  });
  test('same title needs no confirmation; valid fields stay unchanged', async () => {
    await database().runAsync(
      'UPDATE library_items SET artist=?,year=? WHERE id=?',
      'Original',
      1999,
      id,
    );
    native.inspectExistingMetadata.mockResolvedValue({
      title: 'Existing name',
      artist: 'Overwrite',
      year: 2024,
      album: 'New',
    });
    const decide = jest.fn();
    await service.completeExistingLocalMetadata(id, decide);
    expect(decide).not.toHaveBeenCalled();
    expect(await service.getLibraryItem(id)).toMatchObject({
      artist: 'Original',
      year: 1999,
      album: 'New',
    });
  });
  test('no additions is not a success change', async () => {
    native.inspectExistingMetadata.mockResolvedValue({});
    expect(
      await service.completeExistingLocalMetadata(id, async () => 'keep'),
    ).toBe(false);
  });
  test('cancel during analysis rejects late data and duplicate requests', async () => {
    let reply!: (x: unknown) => void;
    native.inspectExistingMetadata.mockImplementation(
      () =>
        new Promise((r) => {
          reply = r;
        }),
    );
    const operation = service.completeExistingLocalMetadata(
      id,
      async () => 'keep',
    );
    for (let i = 0; i < 50 && !reply; i++) await Promise.resolve();
    await expect(
      service.completeExistingLocalMetadata(id, async () => 'keep'),
    ).rejects.toThrow();
    expect(service.cancelExistingMetadataCompletion(id)).toBe(true);
    reply({ artist: 'Late' });
    expect(await operation).toBe(false);
    expect(await service.getLibraryItem(id)).toMatchObject({ artist: null });
  });
  test('deletion during analysis never recreates row', async () => {
    native.inspectExistingMetadata.mockImplementation(async () => {
      await service.deleteLibraryItem(id);
      return { artist: 'Late' };
    });
    await expect(
      service.completeExistingLocalMetadata(id, async () => 'keep'),
    ).rejects.toThrow();
    expect(await service.getLibraryItem(id)).toBeNull();
  });
  test('missing medium blocks analysis', async () => {
    media = false;
    await expect(
      service.completeExistingLocalMetadata(id, async () => 'keep'),
    ).rejects.toThrow();
    expect(native.inspectExistingMetadata).not.toHaveBeenCalled();
  });
  test('valid previous artwork preserved', async () => {
    art = true;
    await database().runAsync(
      'UPDATE library_items SET relativeArtworkPath=?,artworkSizeBytes=20 WHERE id=?',
      `Artwork/${id}.jpg`,
      id,
    );
    await service.completeExistingLocalMetadata(id, async () => 'keep');
    expect(native.publishExistingArtwork).not.toHaveBeenCalled();
    expect(art).toBe(true);
  });
  test('SQL failure after new JPEG compensates own publication', async () => {
    failSQL = true;
    native.publishExistingArtwork.mockImplementation(async () => {
      art = true;
      return {
        relativePath: `Artwork/${id}.jpg`,
        sizeBytes: 20,
        token: 'owned',
      };
    });
    await expect(
      service.completeExistingLocalMetadata(id, async () => 'keep'),
    ).rejects.toThrow();
    expect(native.finishExistingArtwork).toHaveBeenCalledWith(
      expect.any(Number),
      id,
      'owned',
      false,
    );
    expect(await service.getLibraryItem(id)).toMatchObject({
      artist: null,
      title: 'Existing name',
      relativeArtworkPath: null,
    });
  });
  test('JPEG failure preserves useful descriptive update; retry is idempotent', async () => {
    native.publishExistingArtwork.mockRejectedValue(Error('JPEG'));
    expect(
      await service.completeExistingLocalMetadata(id, async () => 'keep'),
    ).toBe(true);
    expect(
      await service.completeExistingLocalMetadata(id, async () => 'keep'),
    ).toBe(false);
  });
});

test('D preserves unrelated fields and relationships, completes Unicode, and survives reopen', async () => {
  native.publishLocalArtwork.mockResolvedValue(null);
  await service.importPreparedLocalFile({
    uri: prepared.uri,
    title: 'Original',
    mediaType: 'audio',
  });
  const db = database();
  await db.runAsync(
    'UPDATE library_items SET playbackPositionSeconds=7,completedAt=? WHERE id=?',
    'done',
    id,
  );
  await db.runAsync(
    "INSERT INTO collections VALUES('c','Collection','collection','date','date')",
  );
  await db.runAsync("INSERT INTO collection_items VALUES('c',?,'date')", id);
  await db.runAsync(
    "INSERT INTO playback_queue VALUES('q1',?,0,'date'),('q2',?,1,'date')",
    id,
    id,
  );
  const before = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM library_items WHERE id=?',
    id,
  );
  const queue = await db.getAllAsync('SELECT * FROM playback_queue'),
    collections = await db.getAllAsync('SELECT * FROM collection_items');
  const text = 'a'.repeat(239) + '😀';
  native.inspectExistingMetadata.mockResolvedValue({
    title: 'Replacement',
    artist: text,
    year: 10000,
    genre: 42,
  });
  native.publishExistingArtwork.mockResolvedValue(null);
  expect(
    await service.completeExistingLocalMetadata(id, async () => 'keep'),
  ).toBe(true);
  const after = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM library_items WHERE id=?',
    id,
  );
  expect(after).toEqual({ ...before, artist: text });
  expect(await db.getAllAsync('SELECT * FROM playback_queue')).toEqual(queue);
  expect(await db.getAllAsync('SELECT * FROM collection_items')).toEqual(
    collections,
  );
  const reopened = new RealSQLite(join(directory, 'library.sqlite'));
  connections.push(reopened);
  expect(
    await reopened.getFirstAsync(
      'SELECT artist FROM library_items WHERE id=?',
      id,
    ),
  ).toEqual({ artist: text });
  expect(await db.getFirstAsync('PRAGMA integrity_check')).toEqual({
    integrity_check: 'ok',
  });
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

test('D cancellation at title proposal rejects a late replacement', async () => {
  native.publishLocalArtwork.mockResolvedValue(null);
  await service.importPreparedLocalFile({
    uri: prepared.uri,
    title: 'Keep',
    mediaType: 'audio',
  });
  native.inspectExistingMetadata.mockResolvedValue({
    title: 'Replace',
    artist: 'Late',
  });
  native.cancelExistingMetadata.mockResolvedValue(undefined);
  let entered!: () => void, reply!: (value: 'replace') => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const pending = service.completeExistingLocalMetadata(id, () => {
    entered();
    return new Promise((r) => {
      reply = r;
    });
  });
  await ready;
  expect(service.cancelExistingMetadataCompletion(id)).toBe(true);
  expect(await pending).toBe(false);
  reply('replace');
  await Promise.resolve();
  expect(await service.getLibraryItem(id)).toMatchObject({
    title: 'Keep',
    artist: null,
  });
  expect(native.publishExistingArtwork).not.toHaveBeenCalled();
});
test('D deadline fallback produces no write or false success', async () => {
  native.publishLocalArtwork.mockResolvedValue(null);
  await service.importPreparedLocalFile({
    uri: prepared.uri,
    title: 'Keep',
    mediaType: 'audio',
  });
  native.inspectExistingMetadata.mockResolvedValue({});
  native.publishExistingArtwork.mockResolvedValue(null);
  expect(
    await service.completeExistingLocalMetadata(id, async () => 'keep'),
  ).toBe(false);
  expect(await service.getLibraryItem(id)).toMatchObject({
    title: 'Keep',
    artist: null,
  });
});
test('D missing published JPEG is not associated and compensates ownership', async () => {
  native.publishLocalArtwork.mockResolvedValue(null);
  await service.importPreparedLocalFile({
    uri: prepared.uri,
    title: 'Keep',
    mediaType: 'audio',
  });
  native.inspectExistingMetadata.mockResolvedValue({ artist: 'Proposed' });
  native.publishExistingArtwork.mockResolvedValue({
    relativePath: `Artwork/${id}.jpg`,
    sizeBytes: 20,
    token: 'owned',
  });
  native.statArtwork.mockResolvedValue({ exists: false });
  await expect(
    service.completeExistingLocalMetadata(id, async () => 'keep'),
  ).rejects.toThrow();
  expect(native.finishExistingArtwork).toHaveBeenCalledWith(
    expect.any(Number),
    id,
    'owned',
    false,
  );
  expect(await service.getLibraryItem(id)).toMatchObject({
    title: 'Keep',
    artist: null,
    relativeArtworkPath: null,
  });
});
