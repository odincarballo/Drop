import { requireOptionalNativeModule } from 'expo';

import {
  isAvailableLibraryItem,
  type AvailableLibraryItem,
  type LibraryAvailability,
  type LibraryItem,
  type LibraryMetadata,
} from '@/models/library';
import {
  openLibraryDatabase,
  withLibraryForeignKeyTransaction,
} from '@/services/libraryDatabase';
import {
  beginPlaybackDeletion,
  endPlaybackDeletion,
} from '@/services/playback';

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
  statPreparedSource(relative: string): Promise<NativeStat>;
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

export type LibraryRow = Omit<
  LibraryItem,
  'uri' | 'artworkUri' | 'thumbnailUrl' | 'availability' | 'mediaSizeOnDisk'
> & {
  sourceCacheRelativePath: string | null;
};
type Row = LibraryRow;

let startup: Promise<void> | null = null;
const leases = new Map<string, number>();
const pendingDeletion = new Set<string>();
const deletions = new Map<string, Promise<void>>();
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
      await openLibraryDatabase()
    ).getFirstAsync<Row>('SELECT * FROM library_items WHERE id = ?', id)) ??
    null
  );
}

async function deleteLibraryRow(id: string): Promise<void> {
  await withLibraryForeignKeyTransaction(async (txn) => {
    await txn.runAsync('DELETE FROM library_items WHERE id = ?', id);
  });
}

async function finishDeletion(row: Row): Promise<void> {
  if ((leases.get(row.id) ?? 0) > 0) {
    pendingDeletion.add(row.id);
    return;
  }
  await beginPlaybackDeletion(row.id);
  try {
    const storage = native();
    await storage.removeMedia(row.relativeMediaPath);
    await storage.removeArtwork(row.id);
    await deleteLibraryRow(row.id);
    pendingDeletion.delete(row.id);
    changed();
  } finally {
    await endPlaybackDeletion(row.id);
  }
}

async function reconcile(): Promise<void> {
  const db = await openLibraryDatabase();
  const storage = native();
  const rows = await db.getAllAsync<Row>('SELECT * FROM library_items');
  for (const row of rows) {
    try {
      if (row.lifecycle === 'deleting') {
        await finishDeletion(row);
        continue;
      }
      // A confirmed record is durable metadata, not proof of current disk availability.
      // Only an explicit deleting tombstone authorizes removing it and its relations.
      if (row.lifecycle === 'ready') continue;
      let stat = await storage.statMedia(row.relativeMediaPath);
      if (
        row.lifecycle === 'pending' &&
        !stat.exists &&
        row.sourceCacheRelativePath
      ) {
        // Inspection errors are not evidence of abandonment. Let the outer catch
        // retain pending until a later startup can inspect both locations safely.
        const source = await storage.statPreparedSource(
          row.sourceCacheRelativePath,
        );
        if (source.exists) {
          if (!source.sizeBytes || source.sizeBytes !== row.sizeBytes) continue;
          const ext = row.relativeMediaPath.split('.').at(-1) ?? '';
          await storage.movePrepared(row.sourceCacheRelativePath, row.id, ext);
          stat = await storage.statMedia(row.relativeMediaPath);
        }
      }
      if (
        !stat.exists ||
        !stat.sizeBytes ||
        stat.sizeBytes <= 0 ||
        row.sizeBytes <= 0 ||
        row.sizeBytes !== stat.sizeBytes
      ) {
        // Only an unconfirmed import absent from both known locations is
        // abandoned. Existing partial files may still be restored: do not erase.
        if (!stat.exists) {
          await deleteLibraryRow(row.id);
          await storage.removeArtwork(row.id);
        }
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
      // Artwork references survive missing/partial images; hydration uses a
      // fallback without changing the stored reference or expected metadata.
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
    (await db.getAllAsync<{ id: string }>('SELECT id FROM library_items')).map(
      (row) => row.id,
    ),
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

async function attach(row: Row): Promise<LibraryItem> {
  let stat: NativeStat | null = null;
  let availability: LibraryAvailability;
  try {
    stat = await native().statMedia(row.relativeMediaPath);
    availability = !stat.exists
      ? 'missing'
      : !stat.uri ||
          !stat.sizeBytes ||
          stat.sizeBytes <= 0 ||
          stat.sizeBytes !== row.sizeBytes
        ? 'invalid'
        : 'available';
  } catch {
    availability = 'unreadable';
  }
  let art: NativeStat | null = null;
  if (row.relativeArtworkPath) {
    try {
      art = await native().statArtwork(row.id);
    } catch {
      /* Optional; retry on next read. */
    }
  }
  return {
    ...row,
    availability,
    mediaSizeOnDisk:
      stat?.exists &&
      typeof stat.sizeBytes === 'number' &&
      Number.isFinite(stat.sizeBytes) &&
      stat.sizeBytes >= 0
        ? stat.sizeBytes
        : null,
    artworkSizeBytes: art?.exists ? (art.sizeBytes ?? 0) : 0,
    thumbnailUrl: null,
    uri: availability === 'available' ? stat!.uri! : null,
    artworkUri: art?.exists ? (art.uri ?? null) : null,
  };
}

/** Keep durable records visible; availability is re-evaluated without SQL writes. */
export async function hydrateLibraryRows(
  rows: LibraryRow[],
): Promise<LibraryItem[]> {
  return Promise.all(rows.map(attach));
}

export async function listLibrary(): Promise<LibraryItem[]> {
  await initializeLibrary();
  const rows = await (
    await openLibraryDatabase()
  ).getAllAsync<Row>(
    `SELECT * FROM library_items WHERE lifecycle = 'ready' ORDER BY downloadedAt DESC, id DESC`,
  );
  return hydrateLibraryRows(rows);
}

export async function getLibraryItem(id: string): Promise<LibraryItem | null> {
  await initializeLibrary();
  const row = await rowFor(id);
  return row?.lifecycle === 'ready' ? attach(row) : null;
}

export async function librarySpaceUsed(): Promise<number> {
  const items = await listLibrary();
  return items.reduce(
    (total, item) =>
      total + (item.mediaSizeOnDisk ?? 0) + item.artworkSizeBytes,
    0,
  );
}

export async function promoteToLibrary(
  uri: string,
  metadata: LibraryMetadata,
): Promise<AvailableLibraryItem> {
  await initializeLibrary();
  const storage = native();
  const db = await openLibraryDatabase();
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
      await deleteLibraryRow(prepared.id);
    }
    throw error;
  }
  if (moved.sizeBytes !== prepared.sizeBytes) {
    await storage.removeMedia(relative);
    await deleteLibraryRow(prepared.id);
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
  if (!isAvailableLibraryItem(item))
    throw new Error('No se pudo verificar el archivo en Biblioteca.');
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
  operation: (item: AvailableLibraryItem) => Promise<T>,
): Promise<T> {
  await initializeLibrary();
  leases.set(id, (leases.get(id) ?? 0) + 1);
  try {
    const row = await rowFor(id);
    if (!row || row.lifecycle !== 'ready')
      throw new Error('El archivo ya no está en Biblioteca.');
    const item = await attach(row);
    if (!isAvailableLibraryItem(item))
      throw new Error('El archivo ya no está disponible.');
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

async function performDeletion(id: string): Promise<void> {
  await initializeLibrary();
  await beginPlaybackDeletion(id);
  try {
    const db = await openLibraryDatabase();
    await db.runAsync(
      "UPDATE library_items SET lifecycle = 'deleting' WHERE id = ? AND lifecycle = 'ready'",
      id,
    );
    changed();
    const row = await rowFor(id);
    if (row?.lifecycle === 'deleting') await finishDeletion(row);
  } finally {
    await endPlaybackDeletion(id);
  }
}

export function deleteLibraryItem(id: string): Promise<void> {
  const existing = deletions.get(id);
  if (existing) return existing;
  const operation = performDeletion(id).finally(() => {
    deletions.delete(id);
  });
  deletions.set(id, operation);
  return operation;
}
