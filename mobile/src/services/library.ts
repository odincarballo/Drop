import { requireOptionalNativeModule } from 'expo';
import * as SQLite from 'expo-sqlite';

import type { LibraryItem, LibraryMetadata } from '@/models/library';

type NativeStat = { exists: boolean; uri?: string; sizeBytes?: number };
type NativeLibrary = {
  prepare(): Promise<{ databaseDirectoryURL: string }>;
  inspectSource(uri: string): Promise<{
    id: string;
    cacheRelativePath: string;
    extension: string;
    sizeBytes: number;
  }>;
  movePrepared(
    relative: string,
    id: string,
    ext: string,
  ): Promise<{
    relativeMediaPath: string;
    uri: string;
    sizeBytes: number;
  }>;
  statMedia(relative: string): Promise<NativeStat>;
  statArtwork(id: string): Promise<NativeStat>;
  listMedia(): Promise<string[]>;
  listArtwork(): Promise<string[]>;
  removeMedia(relative: string): Promise<void>;
  removeOwnedCache(relative: string): Promise<void>;
  removeArtwork(id: string): Promise<void>;
  saveArtwork(
    url: string,
    id: string,
  ): Promise<{ uri: string; sizeBytes: number }>;
};

type Row = Omit<LibraryItem, 'uri' | 'artworkUri' | 'thumbnailUrl'> & {
  sourceCacheRelativePath: string | null;
};

const SCHEMA_VERSION = 1;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;
let startup: Promise<void> | null = null;
const leases = new Map<string, number>();
const pendingDeletion = new Set<string>();
const listeners = new Set<() => void>();

function native(): NativeLibrary {
  const module = requireOptionalNativeModule<NativeLibrary>('DropLibrary');
  if (!module)
    throw new Error('Esta versión de Drop no incluye la Biblioteca nativa.');
  return module;
}

function changed() {
  for (const listener of listeners) listener();
}

export function observeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = (async () => {
      const { databaseDirectoryURL } = await native().prepare();
      const db = await SQLite.openDatabaseAsync(
        'library.sqlite',
        {},
        databaseDirectoryURL,
      );
      await db.execAsync(
        'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;',
      );
      const version = await db.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version',
      );
      if ((version?.user_version ?? 0) > SCHEMA_VERSION)
        throw new Error('La Biblioteca usa una versión de datos más reciente.');
      if ((version?.user_version ?? 0) === 0) {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS library_items (
            id TEXT PRIMARY KEY NOT NULL,
            sourceKind TEXT NOT NULL CHECK(sourceKind IN ('youtube','direct')),
            sourceVideoId TEXT,
            title TEXT NOT NULL,
            mediaType TEXT NOT NULL CHECK(mediaType IN ('video','audio')),
            relativeMediaPath TEXT NOT NULL UNIQUE,
            relativeArtworkPath TEXT,
            sourceCacheRelativePath TEXT,
            durationSeconds REAL,
            sizeBytes INTEGER NOT NULL,
            artworkSizeBytes INTEGER NOT NULL DEFAULT 0,
            resolution TEXT,
            height INTEGER,
            fps REAL,
            videoCodec TEXT,
            audioCodec TEXT,
            container TEXT,
            downloadedAt TEXT NOT NULL,
            playbackPositionSeconds REAL NOT NULL DEFAULT 0,
            completedAt TEXT,
            lifecycle TEXT NOT NULL CHECK(lifecycle IN ('pending','ready','deleting'))
          );
          CREATE INDEX IF NOT EXISTS library_items_recent
            ON library_items(lifecycle, downloadedAt DESC);
          PRAGMA user_version = 1;
        `);
      }
      return db;
    })().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

function mediaRelative(id: string, ext: string) {
  return `Media/${id}.${ext}`;
}

function validatedMetadata(meta: LibraryMetadata): LibraryMetadata {
  const title = meta.title.trim().slice(0, 240) || 'Archivo de Drop';
  const finite = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    ...meta,
    title,
    sourceVideoId:
      meta.sourceKind === 'youtube' &&
      /^[A-Za-z0-9_-]{11}$/.test(meta.sourceVideoId ?? '')
        ? meta.sourceVideoId
        : null,
    durationSeconds: finite(meta.durationSeconds),
    height: finite(meta.height),
    fps: finite(meta.fps),
    resolution: meta.resolution?.slice(0, 40) ?? null,
    videoCodec: meta.videoCodec?.slice(0, 100) ?? null,
    audioCodec: meta.audioCodec?.slice(0, 100) ?? null,
    container: meta.container?.slice(0, 20) ?? null,
  };
}

async function rowFor(id: string): Promise<Row | null> {
  return (
    (await (
      await database()
    ).getFirstAsync<Row>('SELECT * FROM library_items WHERE id = ?', id)) ??
    null
  );
}

async function finishDeletion(row: Row): Promise<void> {
  if ((leases.get(row.id) ?? 0) > 0) {
    pendingDeletion.add(row.id);
    return;
  }
  const storage = native();
  await storage.removeMedia(row.relativeMediaPath);
  await storage.removeArtwork(row.id);
  await (
    await database()
  ).runAsync('DELETE FROM library_items WHERE id = ?', row.id);
  pendingDeletion.delete(row.id);
  changed();
}

async function reconcile(): Promise<void> {
  const db = await database();
  const storage = native();
  const rows = await db.getAllAsync<Row>('SELECT * FROM library_items');
  for (const row of rows) {
    try {
      if (row.lifecycle === 'deleting') {
        await finishDeletion(row);
        continue;
      }
      let stat = await storage.statMedia(row.relativeMediaPath);
      if (
        row.lifecycle === 'pending' &&
        !stat.exists &&
        row.sourceCacheRelativePath
      ) {
        try {
          const ext = row.relativeMediaPath.split('.').at(-1) ?? '';
          await storage.movePrepared(row.sourceCacheRelativePath, row.id, ext);
          stat = await storage.statMedia(row.relativeMediaPath);
        } catch {
          // Missing/invalid source is handled below; other failures are retried next launch.
          stat = await storage.statMedia(row.relativeMediaPath);
        }
      }
      if (
        !stat.exists ||
        !stat.sizeBytes ||
        stat.sizeBytes <= 0 ||
        (row.sizeBytes > 0 && row.sizeBytes !== stat.sizeBytes)
      ) {
        await db.runAsync('DELETE FROM library_items WHERE id = ?', row.id);
        if (stat.exists) await storage.removeMedia(row.relativeMediaPath);
        await storage.removeArtwork(row.id);
        continue;
      }
      if (row.lifecycle === 'pending') {
        await db.runAsync(
          `UPDATE library_items SET lifecycle = 'ready', sourceCacheRelativePath = NULL,
           sizeBytes = ? WHERE id = ?`,
          stat.sizeBytes,
          row.id,
        );
      }
      if (row.relativeArtworkPath) {
        const art = await storage.statArtwork(row.id);
        if (!art.exists) {
          await db.runAsync(
            'UPDATE library_items SET relativeArtworkPath = NULL, artworkSizeBytes = 0 WHERE id = ?',
            row.id,
          );
        } else if (row.artworkSizeBytes !== art.sizeBytes) {
          await db.runAsync(
            'UPDATE library_items SET artworkSizeBytes = ? WHERE id = ?',
            art.sizeBytes ?? 0,
            row.id,
          );
        }
      }
    } catch (error) {
      console.warn('[Drop library] Could not reconcile item', row.id, error);
    }
  }
  const tracked = new Set(
    (
      await db.getAllAsync<{ relativeMediaPath: string }>(
        'SELECT relativeMediaPath FROM library_items',
      )
    ).map((row) => row.relativeMediaPath),
  );
  for (const relative of await storage.listMedia()) {
    if (!tracked.has(relative)) {
      try {
        await storage.removeMedia(relative);
      } catch (error) {
        console.warn('[Drop library] Could not remove orphan', error);
      }
    }
  }
  const artworkOwners = new Set(
    (
      await db.getAllAsync<{ id: string }>(
        "SELECT id FROM library_items WHERE relativeArtworkPath IS NOT NULL AND lifecycle = 'ready'",
      )
    ).map((row) => row.id),
  );
  for (const id of await storage.listArtwork()) {
    if (!artworkOwners.has(id)) {
      try {
        await storage.removeArtwork(id);
      } catch (error) {
        console.warn('[Drop library] Could not remove orphan artwork', error);
      }
    }
  }
  changed();
}

export function initializeLibrary(): Promise<void> {
  if (!startup)
    startup = reconcile().catch((error: unknown) => {
      startup = null;
      throw error;
    });
  return startup;
}

async function attach(row: Row): Promise<LibraryItem | null> {
  const stat = await native().statMedia(row.relativeMediaPath);
  if (!stat.exists || !stat.uri || stat.sizeBytes !== row.sizeBytes)
    return null;
  const art = row.relativeArtworkPath
    ? await native().statArtwork(row.id)
    : null;
  return {
    ...row,
    sizeBytes: stat.sizeBytes ?? row.sizeBytes,
    artworkSizeBytes: art?.exists ? (art.sizeBytes ?? 0) : 0,
    thumbnailUrl: null,
    uri: stat.uri,
    artworkUri: art?.exists ? (art.uri ?? null) : null,
  };
}

export async function listLibrary(): Promise<LibraryItem[]> {
  await initializeLibrary();
  const rows = await (
    await database()
  ).getAllAsync<Row>(
    `SELECT * FROM library_items WHERE lifecycle = 'ready' ORDER BY downloadedAt DESC, id DESC`,
  );
  const items = await Promise.all(
    rows.map(async (row) => {
      try {
        return await attach(row);
      } catch (error) {
        console.warn('[Drop library] Invalid item omitted', row.id, error);
        return null;
      }
    }),
  );
  return items.filter((item): item is LibraryItem => item !== null);
}

export async function librarySpaceUsed(): Promise<number> {
  const items = await listLibrary();
  return items.reduce(
    (total, item) => total + item.sizeBytes + item.artworkSizeBytes,
    0,
  );
}

export async function promoteToLibrary(
  uri: string,
  metadata: LibraryMetadata,
): Promise<LibraryItem> {
  await initializeLibrary();
  const storage = native();
  const db = await database();
  const prepared = await storage.inspectSource(uri);
  const relative = mediaRelative(prepared.id, prepared.extension);
  const safe = validatedMetadata(metadata);
  const downloadedAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO library_items (
      id, sourceKind, sourceVideoId, title, mediaType, relativeMediaPath,
      sourceCacheRelativePath, durationSeconds, sizeBytes, resolution, height, fps,
      videoCodec, audioCodec, container, downloadedAt, lifecycle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    prepared.id,
    safe.sourceKind,
    safe.sourceVideoId ?? null,
    safe.title,
    safe.mediaType,
    relative,
    prepared.cacheRelativePath,
    safe.durationSeconds ?? null,
    prepared.sizeBytes,
    safe.resolution ?? null,
    safe.height ?? null,
    safe.fps ?? null,
    safe.videoCodec ?? null,
    safe.audioCodec ?? null,
    safe.container ?? null,
    downloadedAt,
  );
  let moved: Awaited<ReturnType<NativeLibrary['movePrepared']>>;
  try {
    moved = await storage.movePrepared(
      prepared.cacheRelativePath,
      prepared.id,
      prepared.extension,
    );
  } catch (error) {
    // A move that reached the destination may be recovered from the pending row.
    const destination = await storage.statMedia(relative);
    if (!destination.exists) {
      try {
        await storage.removeOwnedCache(prepared.cacheRelativePath);
      } catch (cleanupError) {
        console.warn('[Drop library] Failed source cleanup', cleanupError);
      }
      await db.runAsync('DELETE FROM library_items WHERE id = ?', prepared.id);
    }
    throw error;
  }
  if (moved.sizeBytes !== prepared.sizeBytes) {
    await storage.removeMedia(relative);
    await db.runAsync('DELETE FROM library_items WHERE id = ?', prepared.id);
    throw new Error('El archivo cambió antes de entrar en Biblioteca.');
  }
  await db.runAsync(
    `UPDATE library_items SET lifecycle = 'ready', sourceCacheRelativePath = NULL,
     sizeBytes = ? WHERE id = ?`,
    moved.sizeBytes,
    prepared.id,
  );
  const row = await rowFor(prepared.id);
  if (!row) throw new Error('No se pudo confirmar el archivo en Biblioteca.');
  const item = await attach(row);
  if (!item) throw new Error('No se pudo verificar el archivo en Biblioteca.');
  changed();
  if (safe.thumbnailUrl && safe.sourceKind === 'youtube') {
    void storage
      .saveArtwork(safe.thumbnailUrl, prepared.id)
      .then(async ({ sizeBytes }) => {
        const result = await db.runAsync(
          `UPDATE library_items SET relativeArtworkPath = ?, artworkSizeBytes = ?
           WHERE id = ? AND lifecycle = 'ready'`,
          `Artwork/${prepared.id}.jpg`,
          sizeBytes,
          prepared.id,
        );
        if (result.changes === 0) await storage.removeArtwork(prepared.id);
        changed();
      })
      .catch(() => {
        // Artwork is optional. A local fallback is always available.
      });
  }
  return item;
}

export async function withLibraryLease<T>(
  id: string,
  operation: (item: LibraryItem) => Promise<T>,
): Promise<T> {
  await initializeLibrary();
  leases.set(id, (leases.get(id) ?? 0) + 1);
  try {
    const row = await rowFor(id);
    if (!row || row.lifecycle !== 'ready')
      throw new Error('El archivo ya no está en Biblioteca.');
    const item = await attach(row);
    if (!item) throw new Error('El archivo ya no está disponible.');
    return await operation(item);
  } finally {
    const remaining = (leases.get(id) ?? 1) - 1;
    if (remaining > 0) leases.set(id, remaining);
    else {
      leases.delete(id);
      if (pendingDeletion.has(id)) {
        const deleting = await rowFor(id);
        if (deleting?.lifecycle === 'deleting') {
          try {
            await finishDeletion(deleting);
          } catch (error) {
            console.warn('[Drop library] Deferred deletion failed', error);
          }
        }
      }
    }
  }
}

export async function deleteLibraryItem(id: string): Promise<void> {
  await initializeLibrary();
  const db = await database();
  await db.runAsync(
    "UPDATE library_items SET lifecycle = 'deleting' WHERE id = ? AND lifecycle = 'ready'",
    id,
  );
  changed();
  const row = await rowFor(id);
  if (row?.lifecycle === 'deleting') await finishDeletion(row);
}
