import { requireOptionalNativeModule } from 'expo';

import type { LibraryItem } from '@/models/library';
import type { Collection, CollectionSummary } from '@/models/collections';
import {
  hydrateLibraryRows,
  initializeLibrary,
  observeLibrary,
  type LibraryRow,
} from '@/services/library';
import { openLibraryDatabase } from '@/services/libraryDatabase';

type NativeNameResult =
  | { name: string; normalizedName: string; error?: never }
  | { error: string; name?: never; normalizedName?: never };
type NativeNames = {
  normalizeCollectionName(raw: string): Promise<NativeNameResult>;
  newCollectionId(): string;
};
type CollectionRow = Collection & { normalizedName: string };

const listeners = new Set<() => void>();
let stopObservingLibrary: (() => void) | null = null;

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn('[Drop collections] Observer failed', error);
    }
  }
}

export function observeCollections(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopObservingLibrary) stopObservingLibrary = observeLibrary(notify);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopObservingLibrary?.();
      stopObservingLibrary = null;
    }
  };
}

function nativeNames(): NativeNames {
  const module = requireOptionalNativeModule<NativeNames>('DropLibrary');
  if (!module?.normalizeCollectionName || !module.newCollectionId)
    throw new Error('Esta versión de Drop no incluye Collections.');
  return module;
}

const nameErrors: Record<string, string> = {
  empty: 'Escribe un nombre para la colección.',
  tooLong: 'El nombre debe tener 80 caracteres visibles o menos.',
  controlCharacter: 'El nombre contiene caracteres de control no permitidos.',
  reserved: '«Sin colección» es un nombre reservado.',
};

async function preparedName(raw: string): Promise<{
  name: string;
  normalizedName: string;
}> {
  const result = await nativeNames().normalizeCollectionName(raw);
  if (result.error)
    throw new Error(nameErrors[result.error] ?? 'El nombre no es válido.');
  if (!result.name || !result.normalizedName)
    throw new Error('No se pudo validar el nombre de la colección.');
  return result;
}

function collection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rethrowDatabaseError(error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed:\s*collections\.normalizedName/i.test(detail))
    throw new Error('Ya existe una colección con ese nombre.');
  throw new Error('No se pudo actualizar Collections. Inténtalo de nuevo.');
}

export async function createCollection(rawName: string): Promise<Collection> {
  await initializeLibrary();
  const prepared = await preparedName(rawName);
  const id = nativeNames().newCollectionId();
  const now = new Date().toISOString();
  try {
    const db = await openLibraryDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        `INSERT INTO collections (id, name, normalizedName, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        prepared.name,
        prepared.normalizedName,
        now,
        now,
      );
    });
  } catch (error) {
    rethrowDatabaseError(error);
  }
  notify();
  return { id, name: prepared.name, createdAt: now, updatedAt: now };
}

export async function renameCollection(
  id: string,
  rawName: string,
): Promise<Collection> {
  await initializeLibrary();
  const prepared = await preparedName(rawName);
  let result: Collection | null = null;
  let changed = false;
  try {
    const db = await openLibraryDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      const previous = await txn.getFirstAsync<CollectionRow>(
        'SELECT * FROM collections WHERE id = ?',
        id,
      );
      if (!previous) throw new Error('collectionMissing');
      if (
        previous.name === prepared.name &&
        previous.normalizedName === prepared.normalizedName
      ) {
        result = collection(previous);
        return;
      }
      const updatedAt = new Date().toISOString();
      await txn.runAsync(
        'UPDATE collections SET name = ?, normalizedName = ?, updatedAt = ? WHERE id = ?',
        prepared.name,
        prepared.normalizedName,
        updatedAt,
        id,
      );
      result = {
        id,
        name: prepared.name,
        createdAt: previous.createdAt,
        updatedAt,
      };
      changed = true;
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'collectionMissing')
      throw new Error('La colección ya no existe.');
    rethrowDatabaseError(error);
  }
  if (changed) notify();
  return result!;
}

export async function deleteCollection(id: string): Promise<void> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  let changed = false;
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      const result = await txn.runAsync(
        'DELETE FROM collections WHERE id = ?',
        id,
      );
      changed = result.changes > 0;
    });
  } catch (error) {
    rethrowDatabaseError(error);
  }
  if (changed) notify();
}

export async function listCollections(): Promise<CollectionSummary[]> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  return db.getAllAsync<CollectionSummary>(
    `SELECT c.id, c.name, c.createdAt, c.updatedAt,
            COUNT(l.id) AS itemCount
     FROM collections c
     LEFT JOIN collection_items ci ON ci.collectionId = c.id
     LEFT JOIN library_items l ON l.id = ci.itemId AND l.lifecycle = 'ready'
     GROUP BY c.id
     ORDER BY c.createdAt DESC, c.id DESC`,
  );
}

export async function getCollection(id: string): Promise<Collection | null> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  const row = await db.getFirstAsync<CollectionRow>(
    'SELECT * FROM collections WHERE id = ?',
    id,
  );
  return row ? collection(row) : null;
}

export async function listItemCollectionIds(itemId: string): Promise<string[]> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  const rows = await db.getAllAsync<{ collectionId: string }>(
    'SELECT collectionId FROM collection_items WHERE itemId = ? ORDER BY collectionId',
    itemId,
  );
  return rows.map((row) => row.collectionId);
}

export async function countUncollectedItems(): Promise<number> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM library_items l
     WHERE l.lifecycle = 'ready'
       AND NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.itemId = l.id)`,
  );
  return row?.count ?? 0;
}

export async function listCollectionItems(
  collectionId: string,
): Promise<LibraryItem[]> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  const rows = await db.getAllAsync<LibraryRow>(
    `SELECT l.* FROM collection_items ci
     JOIN library_items l ON l.id = ci.itemId
     WHERE ci.collectionId = ? AND l.lifecycle = 'ready'
     ORDER BY ci.addedAt DESC, ci.itemId DESC`,
    collectionId,
  );
  return hydrateLibraryRows(rows);
}

export async function listUncollectedItems(): Promise<LibraryItem[]> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  const rows = await db.getAllAsync<LibraryRow>(
    `SELECT l.* FROM library_items l
     WHERE l.lifecycle = 'ready'
       AND NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.itemId = l.id)
     ORDER BY l.downloadedAt DESC, l.id DESC`,
  );
  return hydrateLibraryRows(rows);
}

async function requireReadyItem(
  txn: Awaited<ReturnType<typeof openLibraryDatabase>>,
  itemId: string,
): Promise<void> {
  const row = await txn.getFirstAsync<{ lifecycle: string }>(
    'SELECT lifecycle FROM library_items WHERE id = ?',
    itemId,
  );
  if (row?.lifecycle !== 'ready')
    throw new Error('La descarga ya no está disponible.');
}

async function requireCollection(
  txn: Awaited<ReturnType<typeof openLibraryDatabase>>,
  collectionId: string,
): Promise<void> {
  const row = await txn.getFirstAsync<{ id: string }>(
    'SELECT id FROM collections WHERE id = ?',
    collectionId,
  );
  if (!row) throw new Error('La colección ya no existe.');
}

function rethrowMembershipError(error: unknown): never {
  if (
    error instanceof Error &&
    [
      'La descarga ya no está disponible.',
      'La colección ya no existe.',
    ].includes(error.message)
  )
    throw error;
  rethrowDatabaseError(error);
}

export async function addItemToCollection(
  collectionId: string,
  itemId: string,
): Promise<void> {
  // Startup reconciliation removes physically missing rows. A file may still
  // disappear later; the next reconciliation will delete its row and cascade.
  await initializeLibrary();
  const db = await openLibraryDatabase();
  let changed = false;
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await requireReadyItem(txn, itemId);
      await requireCollection(txn, collectionId);
      const result = await txn.runAsync(
        `INSERT OR IGNORE INTO collection_items (collectionId, itemId, addedAt)
         VALUES (?, ?, ?)`,
        collectionId,
        itemId,
        new Date().toISOString(),
      );
      changed = result.changes > 0;
    });
  } catch (error) {
    rethrowMembershipError(error);
  }
  if (changed) notify();
}

export async function removeItemFromCollection(
  collectionId: string,
  itemId: string,
): Promise<void> {
  await initializeLibrary();
  const db = await openLibraryDatabase();
  let changed = false;
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      const result = await txn.runAsync(
        'DELETE FROM collection_items WHERE collectionId = ? AND itemId = ?',
        collectionId,
        itemId,
      );
      changed = result.changes > 0;
    });
  } catch (error) {
    rethrowMembershipError(error);
  }
  if (changed) notify();
}

export async function setItemCollections(
  itemId: string,
  collectionIds: string[],
): Promise<void> {
  await initializeLibrary();
  const requested = new Set(collectionIds);
  const db = await openLibraryDatabase();
  let changed = false;
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await requireReadyItem(txn, itemId);
      for (const id of requested) await requireCollection(txn, id);
      const existing = await txn.getAllAsync<{ collectionId: string }>(
        'SELECT collectionId FROM collection_items WHERE itemId = ?',
        itemId,
      );
      const old = new Set(existing.map((row) => row.collectionId));
      for (const id of old) {
        if (!requested.has(id)) {
          await txn.runAsync(
            'DELETE FROM collection_items WHERE collectionId = ? AND itemId = ?',
            id,
            itemId,
          );
          changed = true;
        }
      }
      const addedAt = new Date().toISOString();
      for (const id of requested) {
        if (!old.has(id)) {
          await txn.runAsync(
            'INSERT INTO collection_items (collectionId, itemId, addedAt) VALUES (?, ?, ?)',
            id,
            itemId,
            addedAt,
          );
          changed = true;
        }
      }
    });
  } catch (error) {
    rethrowMembershipError(error);
  }
  if (changed) notify();
}
