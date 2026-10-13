/** @jest-environment node */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RealSQLite } from './support/realSQLite';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/playback', () => ({
  beginPlaybackDeletion: jest.fn(async () => undefined),
  endPlaybackDeletion: jest.fn(async () => undefined),
}));

type CollectionsService = typeof import('@/services/collections');
type LibraryService = typeof import('@/services/library');

let directory: string;
let path: string;
let connections: RealSQLite[];
let media: Map<string, number>;
let idSequence: number;
let service: CollectionsService;
let library: LibraryService;
let db: Awaited<
  ReturnType<typeof import('@/services/libraryDatabase').openLibraryDatabase>
>;

const storage = {
  prepare: jest.fn(async () => ({
    databaseDirectoryURL: `file://${directory}/`,
  })),
  statMedia: jest.fn(async (relative: string) => {
    const sizeBytes = media.get(relative);
    return sizeBytes == null
      ? { exists: false }
      : { exists: true, uri: `file:///Drop/${relative}`, sizeBytes };
  }),
  statArtwork: jest.fn(async () => ({ exists: false })),
  listMedia: jest.fn(async () => [...media.keys()]),
  listArtwork: jest.fn(async () => []),
  removeMedia: jest.fn(async (relative: string) => {
    media.delete(relative);
  }),
  removeArtwork: jest.fn(async () => undefined),
  movePrepared: jest.fn(),
  saveArtwork: jest.fn(),
  normalizeCollectionName: jest.fn(async (raw: string) => {
    const name = raw.trim().replaceAll(/\s+/g, ' ');
    if (!name) return { error: 'empty' };
    if (name.toLocaleLowerCase('es') === 'sin colección')
      return { error: 'reserved' };
    return { name, normalizedName: name.toLocaleLowerCase('es') };
  }),
  newCollectionId: jest.fn(
    () => `00000000-0000-0000-0000-${String(++idSequence).padStart(12, '0')}`,
  ),
};

async function seedItem(
  id: string,
  lifecycle: 'ready' | 'pending' | 'deleting' = 'ready',
  downloadedAt = '2026-10-13T10:00:00.000Z',
): Promise<void> {
  const relative = `Media/${id}.mp4`;
  await db.runAsync(
    `INSERT INTO library_items
      (id, sourceKind, title, mediaType, relativeMediaPath, sizeBytes, downloadedAt, lifecycle)
     VALUES (?, 'direct', ?, 'video', ?, 100, ?, ?)`,
    id,
    id,
    relative,
    downloadedAt,
    lifecycle,
  );
  media.set(relative, 100);
}

async function memberships(itemId: string): Promise<
  {
    collectionId: string;
    addedAt: string;
  }[]
> {
  return db.getAllAsync(
    'SELECT collectionId, addedAt FROM collection_items WHERE itemId = ? ORDER BY collectionId',
    itemId,
  );
}

beforeEach(async () => {
  jest.resetModules();
  directory = mkdtempSync(join(tmpdir(), 'drop-collections-'));
  path = join(directory, 'library.sqlite');
  connections = [];
  media = new Map();
  idSequence = 0;
  jest.clearAllMocks();
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockReturnValue(storage);
  const sqlite = require('expo-sqlite') as { openDatabaseAsync: jest.Mock };
  sqlite.openDatabaseAsync.mockImplementation(async () => {
    const connection = new RealSQLite(path);
    connections.push(connection);
    return connection;
  });
  db = await (
    require('@/services/libraryDatabase') as typeof import('@/services/libraryDatabase')
  ).openLibraryDatabase();
  service = require('@/services/collections') as CollectionsService;
  library = require('@/services/library') as LibraryService;
});

afterEach(async () => {
  await Promise.all(connections.map((connection) => connection.closeAsync()));
  rmSync(directory, { recursive: true, force: true });
});

test('create, duplicate, reserved, list empty, rename and delete are real SQL operations', async () => {
  const first = await service.createCollection('  Cursos  Python ');
  expect(first.name).toBe('Cursos Python');
  expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(first.createdAt).toBe(first.updatedAt);
  expect(await service.listCollections()).toEqual([{ ...first, itemCount: 0 }]);
  await expect(service.createCollection('cursos python')).rejects.toThrow(
    'Ya existe una colección',
  );
  await expect(service.createCollection('Sin colección')).rejects.toThrow(
    'reservado',
  );
  const equivalent = await service.renameCollection(first.id, 'Cursos Python');
  expect(equivalent).toEqual(first);
  const renamed = await service.renameCollection(first.id, 'Cursos Swift');
  expect(renamed.id).toBe(first.id);
  expect(renamed.createdAt).toBe(first.createdAt);
  expect(await service.getCollection(first.id)).toEqual(renamed);
  await service.deleteCollection(first.id);
  await service.deleteCollection(first.id);
  expect(await service.getCollection(first.id)).toBeNull();
});

test('membership requires ready item and existing collection in the same transaction', async () => {
  await library.initializeLibrary();
  await seedItem('ready');
  await seedItem('pending', 'pending');
  await seedItem('deleting', 'deleting');
  const c = await service.createCollection('Cursos');
  await service.addItemToCollection(c.id, 'ready');
  expect(await memberships('ready')).toHaveLength(1);
  await expect(service.addItemToCollection(c.id, 'pending')).rejects.toThrow(
    'descarga',
  );
  await expect(service.addItemToCollection(c.id, 'deleting')).rejects.toThrow(
    'descarga',
  );
  await expect(service.addItemToCollection(c.id, 'missing')).rejects.toThrow(
    'descarga',
  );
  await expect(service.addItemToCollection('missing', 'ready')).rejects.toThrow(
    'colección',
  );
  expect(await memberships('pending')).toEqual([]);
  expect(await memberships('deleting')).toEqual([]);
});

test('duplicate add and repeated remove are idempotent without touching addedAt', async () => {
  await seedItem('i');
  const c = await service.createCollection('C');
  await service.addItemToCollection(c.id, 'i');
  const initial = await memberships('i');
  await service.addItemToCollection(c.id, 'i');
  expect(await memberships('i')).toEqual(initial);
  await service.removeItemFromCollection(c.id, 'i');
  await service.removeItemFromCollection(c.id, 'i');
  expect(await memberships('i')).toEqual([]);
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS n FROM library_items'),
  ).toEqual({ n: 1 });
});

test('rename preserves memberships, equivalent visual name and duplicate collision', async () => {
  await seedItem('i');
  const a = await service.createCollection('Cursos');
  const b = await service.createCollection('Otro');
  await service.addItemToCollection(a.id, 'i');
  const before = await memberships('i');
  const changed = await service.renameCollection(a.id, 'CURSOS');
  expect(changed.name).toBe('CURSOS');
  expect(changed.id).toBe(a.id);
  expect(changed.createdAt).toBe(a.createdAt);
  expect(await memberships('i')).toEqual(before);
  await expect(service.renameCollection(b.id, 'cursos')).rejects.toThrow(
    'Ya existe una colección',
  );
  expect(await service.getCollection(b.id)).toEqual(b);
});

test('setItemCollections preserves existing addedAt, deduplicates input and rolls back invalid ID', async () => {
  await seedItem('i');
  const a = await service.createCollection('A');
  const b = await service.createCollection('B');
  await service.addItemToCollection(a.id, 'i');
  const initial = await memberships('i');
  await expect(
    service.setItemCollections('i', [b.id, 'nonexistent']),
  ).rejects.toThrow('colección');
  expect(await memberships('i')).toEqual(initial);
  await service.setItemCollections('i', [a.id, a.id, b.id]);
  const updated = await memberships('i');
  expect(updated).toHaveLength(2);
  expect(updated.find((entry) => entry.collectionId === a.id)?.addedAt).toBe(
    initial[0]?.addedAt,
  );
  expect(
    updated.find((entry) => entry.collectionId === b.id)?.addedAt,
  ).toBeTruthy();
  await service.setItemCollections('i', [b.id]);
  expect((await memberships('i')).map((entry) => entry.collectionId)).toEqual([
    b.id,
  ]);
});

test('membership then Delete cascades; deleting first rejects membership', async () => {
  await seedItem('i');
  const c = await service.createCollection('C');
  await service.addItemToCollection(c.id, 'i');
  await library.deleteLibraryItem('i');
  expect(await memberships('i')).toEqual([]);
  expect(await service.getCollection(c.id)).not.toBeNull();
  await seedItem('j');
  await db.runAsync(
    "UPDATE library_items SET lifecycle = 'deleting' WHERE id = ?",
    'j',
  );
  await expect(service.addItemToCollection(c.id, 'j')).rejects.toThrow(
    'descarga',
  );
  await expect(service.setItemCollections('j', [c.id])).rejects.toThrow(
    'descarga',
  );
  expect(await memberships('j')).toEqual([]);
});

test('deleting Collection cascades memberships but preserves media and LibraryItem', async () => {
  await seedItem('i');
  const c = await service.createCollection('C');
  await service.addItemToCollection(c.id, 'i');
  await service.deleteCollection(c.id);
  expect(await memberships('i')).toEqual([]);
  expect(
    await db.getFirstAsync('SELECT COUNT(*) AS n FROM library_items'),
  ).toEqual({ n: 1 });
  expect(media.has('Media/i.mp4')).toBe(true);
});

test('listCollections counts ready only, item queries preserve order and validate media', async () => {
  await library.initializeLibrary();
  await seedItem('old', 'ready', '2026-10-12T10:00:00.000Z');
  await seedItem('new', 'ready', '2026-10-13T10:00:00.000Z');
  await seedItem('pending', 'pending');
  const c = await service.createCollection('C');
  await service.addItemToCollection(c.id, 'old');
  await service.addItemToCollection(c.id, 'new');
  await db.runAsync(
    "UPDATE collection_items SET addedAt = '2026-10-12T10:00:00.000Z' WHERE itemId = 'old'",
  );
  await db.runAsync(
    "UPDATE collection_items SET addedAt = '2026-10-13T10:00:00.000Z' WHERE itemId = 'new'",
  );
  await db.runAsync(
    "INSERT INTO collection_items VALUES (?, 'pending', '2026-10-13T10:00:00.000Z')",
    c.id,
  );
  expect((await service.listCollections())[0]?.itemCount).toBe(2);
  expect(
    (await service.listCollectionItems(c.id)).map((item) => item.id),
  ).toEqual(['new', 'old']);
  media.delete('Media/new.mp4');
  expect(
    (await service.listCollectionItems(c.id)).map((item) => item.id),
  ).toEqual(['old']);
  expect(await library.librarySpaceUsed()).toBe(100);
});

test('Sin colección is virtual and changes with the last membership', async () => {
  await seedItem('old', 'ready', '2026-10-12T10:00:00.000Z');
  await seedItem('new', 'ready', '2026-10-13T10:00:00.000Z');
  const a = await service.createCollection('A');
  const b = await service.createCollection('B');
  expect((await service.listUncollectedItems()).map((item) => item.id)).toEqual(
    ['new', 'old'],
  );
  await service.addItemToCollection(a.id, 'new');
  await service.addItemToCollection(b.id, 'new');
  expect((await service.listUncollectedItems()).map((item) => item.id)).toEqual(
    ['old'],
  );
  await service.removeItemFromCollection(a.id, 'new');
  expect((await service.listUncollectedItems()).map((item) => item.id)).toEqual(
    ['old'],
  );
  await service.removeItemFromCollection(b.id, 'new');
  expect((await service.listUncollectedItems()).map((item) => item.id)).toEqual(
    ['new', 'old'],
  );
  expect(
    await db.getFirstAsync(
      "SELECT COUNT(*) AS n FROM collections WHERE name = 'Sin colección'",
    ),
  ).toEqual({ n: 0 });
});

test('observers fire after commit and a throwing listener cannot turn success into failure', async () => {
  let observed = 0;
  const stop = service.observeCollections(() => {
    observed += 1;
    throw new Error('listener error');
  });
  const warning = jest
    .spyOn(console, 'warn')
    .mockImplementation(() => undefined);
  const c = await service.createCollection('C');
  expect(observed).toBeGreaterThan(0);
  expect(await service.getCollection(c.id)).toEqual(c);
  stop();
  warning.mockRestore();
});

test('rollback emits no Collections notification and Library Delete does notify', async () => {
  await seedItem('i');
  const c = await service.createCollection('C');
  const notifications = jest.fn();
  const stop = service.observeCollections(notifications);
  await expect(
    service.setItemCollections('i', [c.id, 'missing']),
  ).rejects.toThrow();
  expect(notifications).not.toHaveBeenCalled();
  await library.deleteLibraryItem('i');
  expect(notifications).toHaveBeenCalled();
  stop();
});

test('Collections mutations never invoke physical-media operations', async () => {
  await seedItem('i');
  await library.initializeLibrary();
  jest.clearAllMocks();
  const c = await service.createCollection('C');
  await service.renameCollection(c.id, 'D');
  await service.addItemToCollection(c.id, 'i');
  await service.setItemCollections('i', [c.id]);
  await service.removeItemFromCollection(c.id, 'i');
  await service.deleteCollection(c.id);
  expect(storage.removeMedia).not.toHaveBeenCalled();
  expect(storage.removeArtwork).not.toHaveBeenCalled();
  expect(storage.movePrepared).not.toHaveBeenCalled();
  expect(storage.saveArtwork).not.toHaveBeenCalled();
});

test('startup reconciliation removes missing ready item and cascades membership', async () => {
  await seedItem('i');
  const c = await service.createCollection('C');
  await service.addItemToCollection(c.id, 'i');
  media.delete('Media/i.mp4');
  jest.resetModules();
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockReturnValue(storage);
  const sqlite = require('expo-sqlite') as { openDatabaseAsync: jest.Mock };
  sqlite.openDatabaseAsync.mockImplementation(async () => {
    const connection = new RealSQLite(path);
    connections.push(connection);
    return connection;
  });
  service = require('@/services/collections') as CollectionsService;
  await service.listCollections();
  expect(await memberships('i')).toEqual([]);
  expect((await service.listCollections())[0]?.itemCount).toBe(0);
});
