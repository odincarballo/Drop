/** @jest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  RealSQLite,
  V1_SCHEMA,
  V2_COLLECTIONS_SCHEMA,
} from './support/realSQLite';
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/playback', () => ({
  beginPlaybackDeletion: jest.fn(),
  endPlaybackDeletion: jest.fn(),
}));
let directory: string, path: string, connections: RealSQLite[], fail: boolean;
const fields = ['artist', 'album', 'genre', 'year'];
function seed(v = 4) {
  const d = new DatabaseSync(path);
  d.exec(
    v === 4
      ? V1_SCHEMA.replace("'youtube','direct'", "'youtube','direct','local'")
      : V1_SCHEMA,
  );
  d.exec(
    `INSERT INTO library_items(id,sourceKind,title,mediaType,relativeMediaPath,relativeArtworkPath,sizeBytes,artworkSizeBytes,downloadedAt,playbackPositionSeconds,completedAt,lifecycle) VALUES('a','${v === 4 ? 'local' : 'direct'}','Título intacto','audio','${v === 4 ? 'ImportedMedia' : 'Media'}/a.m4a','Artwork/a.jpg',100,20,'date',42.5,'done','ready');`,
  );
  if (v >= 2)
    d.exec(
      `${V2_COLLECTIONS_SCHEMA} INSERT INTO collections VALUES('c','Colección','colección','before','after'); INSERT INTO collection_items VALUES('c','a','member');`,
    );
  if (v >= 3)
    d.exec(
      `CREATE TABLE playback_queue(id TEXT PRIMARY KEY NOT NULL,itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position>=0),addedAt TEXT NOT NULL); CREATE UNIQUE INDEX playback_queue_position ON playback_queue(position);CREATE INDEX playback_queue_by_item ON playback_queue(itemId,position);INSERT INTO playback_queue VALUES('q1','a',0,'first'),('q2','a',3,'second');`,
    );
  d.exec(`PRAGMA user_version=${v}`);
  d.close();
}
function snapshot() {
  const d = new DatabaseSync(path);
  const v = d.prepare('PRAGMA user_version').get()!.user_version as number;
  const out: Record<string, unknown[]> = {};
  for (const t of [
    'library_items',
    ...(v >= 2 ? ['collections', 'collection_items'] : []),
    ...(v >= 3 ? ['playback_queue'] : []),
  ])
    out[t] = d
      .prepare(`SELECT * FROM ${t} ORDER BY rowid`)
      .all()
      .map((x) =>
        Object.fromEntries(
          Object.entries(x).filter(([k]) => !fields.includes(k)),
        ),
      );
  d.close();
  return out;
}
function service() {
  return jest.requireActual(
    '@/services/library',
  ) as typeof import('@/services/library');
}
function open() {
  return (
    jest.requireActual(
      '@/services/libraryDatabase',
    ) as typeof import('@/services/libraryDatabase')
  ).openLibraryDatabase();
}
beforeEach(() => {
  jest.resetModules();
  directory = mkdtempSync(join(tmpdir(), 'drop-v5-'));
  path = join(directory, 'library.sqlite');
  connections = [];
  fail = false;
  jest.requireMock('expo').requireOptionalNativeModule.mockReturnValue({
    prepare: async () => ({ databaseDirectoryURL: `file://${directory}/` }),
  });
  jest
    .requireMock('expo-sqlite')
    .openDatabaseAsync.mockImplementation(async () => {
      const d = new RealSQLite(path);
      connections.push(d);
      const exec = d.execAsync.bind(d);
      d.execAsync = async (sql: string) => {
        await exec(sql);
        if (fail && /ADD COLUMN genre/.test(sql))
          throw Error('injected additive failure');
      };
      return d;
    });
});
afterEach(async () => {
  await Promise.all(connections.map((c) => c.closeAsync()));
  rmSync(directory, { recursive: true, force: true });
});
test('new database v5 has four nullable columns', async () => {
  const d = await open();
  expect(await d.getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 5,
  });
  const cols = await d.getAllAsync<{
    name: string;
    type: string;
    notnull: number;
  }>('PRAGMA table_info(library_items)');
  expect(cols.slice(-4).map((c) => [c.name, c.type, c.notnull])).toEqual([
    ['artist', 'TEXT', 0],
    ['album', 'TEXT', 0],
    ['genre', 'TEXT', 0],
    ['year', 'INTEGER', 0],
  ]);
});
test.each([1, 2, 3, 4])(
  'v%s preserves all legacy rows, relationships and NULL metadata',
  async (v) => {
    seed(v);
    const before = snapshot();
    const d = await open();
    expect(await d.getFirstAsync('PRAGMA user_version')).toEqual({
      user_version: 5,
    });
    for (const [t, rows] of Object.entries(before))
      expect(snapshot()[t]).toEqual(rows);
    expect(
      await d.getFirstAsync(
        'SELECT artist,album,genre,year FROM library_items',
      ),
    ).toEqual({ artist: null, album: null, genre: null, year: null });
    expect(await d.getFirstAsync('PRAGMA integrity_check')).toEqual({
      integrity_check: 'ok',
    });
    expect(await d.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
    if (v === 4)
      expect(connections.flatMap((c) => c.executed).join(' ')).not.toMatch(
        /DROP TABLE|library_items_v4/,
      );
  },
);
test('Unicode write/read preserves title artwork source progress and relations', async () => {
  seed();
  const before = snapshot();
  await open();
  expect(
    await service().updateLocalDescriptiveMetadata('a', {
      artist: ' Música 東京 ',
      album: 'Álbum',
      genre: 'Jazz',
      year: 2024,
    }),
  ).toBe(true);
  expect(
    await (
      await open()
    ).getFirstAsync('SELECT artist,album,genre,year FROM library_items'),
  ).toEqual({
    artist: 'Música 東京',
    album: 'Álbum',
    genre: 'Jazz',
    year: 2024,
  });
  expect(snapshot()).toEqual(before);
});
test('partial update does not replace valid fields or clear them with NULL', async () => {
  seed();
  await open();
  const notify = jest.fn();
  const unsubscribe = service().observeLibrary(notify);
  await service().updateLocalDescriptiveMetadata('a', { artist: 'Original' });
  notify.mockClear();
  expect(
    await service().updateLocalDescriptiveMetadata('a', {
      artist: 'Replacement',
      album: 'Album',
      year: null,
    }),
  ).toBe(true);
  expect(
    await service().updateLocalDescriptiveMetadata('a', {
      artist: null,
      album: null,
    }),
  ).toBe(false);
  expect(
    await (
      await open()
    ).getFirstAsync('SELECT artist,album,genre,year FROM library_items'),
  ).toEqual({ artist: 'Original', album: 'Album', genre: null, year: null });
  expect(notify).toHaveBeenCalledTimes(1);
  unsubscribe();
});
test('empty values are absence and leave existing fields untouched', async () => {
  seed();
  await open();
  const before = snapshot();
  expect(
    await service().updateLocalDescriptiveMetadata('a', {
      artist: ' \n\u0000 ',
      album: undefined,
      genre: null,
    }),
  ).toBe(false);
  expect(snapshot()).toEqual(before);
});
test.each([0, 10000, 2024.5, NaN, Infinity, '2024'])(
  'invalid year atomically rejected: %s',
  async (year) => {
    seed();
    await open();
    await expect(
      service().updateLocalDescriptiveMetadata('a', {
        artist: 'Must not write',
        year: year as number,
      }),
    ).rejects.toThrow();
    expect(
      await (
        await open()
      ).getFirstAsync('SELECT artist,year FROM library_items'),
    ).toEqual({ artist: null, year: null });
  },
);
test('invalid type and unknown key rejected', async () => {
  seed();
  await open();
  await expect(
    service().updateLocalDescriptiveMetadata('a', {
      artist: 42 as unknown as string,
    }),
  ).rejects.toThrow();
  await expect(
    service().updateLocalDescriptiveMetadata('a', { title: 'No' } as never),
  ).rejects.toThrow();
  expect(
    (
      await (
        await open()
      ).getFirstAsync<{ title: string }>('SELECT title FROM library_items')
    )?.title,
  ).toBe('Título intacto');
});
test('missing deleting and nonlocal records cannot be modified or recreated', async () => {
  seed();
  const d = await open();
  expect(
    await service().updateLocalDescriptiveMetadata('missing', { artist: 'No' }),
  ).toBe(false);
  await d.execAsync("UPDATE library_items SET lifecycle='deleting'");
  expect(
    await service().updateLocalDescriptiveMetadata('a', { artist: 'No' }),
  ).toBe(false);
  await d.execAsync(
    "UPDATE library_items SET lifecycle='ready',sourceKind='direct'",
  );
  expect(
    await service().updateLocalDescriptiveMetadata('a', { artist: 'No' }),
  ).toBe(false);
  expect(await d.getFirstAsync('SELECT artist FROM library_items')).toEqual({
    artist: null,
  });
});
test('failure after third ALTER rolls back schema version and data then retries', async () => {
  seed();
  const before = snapshot();
  fail = true;
  await expect(open()).rejects.toThrow('injected additive failure');
  const d = new DatabaseSync(path);
  expect(d.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
  expect(
    d
      .prepare('PRAGMA table_info(library_items)')
      .all()
      .some((c) => c.name === 'artist'),
  ).toBe(false);
  d.close();
  expect(snapshot()).toEqual(before);
  fail = false;
  expect(await (await open()).getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 5,
  });
  expect(snapshot()).toEqual(before);
});
test('process death during uncommitted ALTER recovers and migrates on reopen', async () => {
  seed();
  const before = snapshot();
  const p = spawnSync(process.execPath, [
    '-e',
    "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE;ALTER TABLE library_items ADD COLUMN artist TEXT');process.kill(process.pid,'SIGKILL');",
    path,
  ]);
  expect(p.signal).toBe('SIGKILL');
  expect(snapshot()).toEqual(before);
  expect(await (await open()).getFirstAsync('PRAGMA user_version')).toEqual({
    user_version: 5,
  });
  expect(snapshot()).toEqual(before);
});
test('reopen keeps saved metadata and identifiers', async () => {
  seed();
  await service().updateLocalDescriptiveMetadata('a', {
    artist: 'Saved',
    year: 2020,
  });
  await Promise.all(connections.map((c) => c.closeAsync()));
  const create = jest
    .requireMock('expo-sqlite')
    .openDatabaseAsync.getMockImplementation();
  jest.resetModules();
  jest.requireMock('expo').requireOptionalNativeModule.mockReturnValue({
    prepare: async () => ({ databaseDirectoryURL: `file://${directory}/` }),
  });
  jest.requireMock('expo-sqlite').openDatabaseAsync.mockImplementation(create);
  expect(
    await (
      await open()
    ).getFirstAsync('SELECT artist,year FROM library_items WHERE id=?', 'a'),
  ).toEqual({ artist: 'Saved', year: 2020 });
});
test('future version rejected without schema writes', async () => {
  seed();
  const d = new DatabaseSync(path);
  d.exec('PRAGMA user_version=6');
  d.close();
  const before = snapshot();
  await expect(open()).rejects.toThrow('más reciente');
  expect(snapshot()).toEqual(before);
  expect(
    connections
      .flatMap((c) => c.executed)
      .some((s) => /ALTER|DROP|journal_mode = WAL/.test(s)),
  ).toBe(false);
});
