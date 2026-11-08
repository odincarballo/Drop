import { requireOptionalNativeModule } from 'expo';

import {
  isAvailableLibraryItem,
  type AvailableLibraryItem,
  type LibraryAvailability,
  type LibraryItem,
  type LibraryMetadata,
  type LibraryDescriptiveMetadata,
  type LibrarySourceKind,
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
type LocalImportIdentity = {
  id: string;
  cacheRelativePath: string;
  relativeMediaPath: string;
};
export type PreparedLocalFile = LibraryDescriptiveMetadata & {
  uri: string;
  title: string;
  mediaType: LibraryMetadata['mediaType'];
};
type LocalArtworkPublication = {
  relativePath: string;
  sizeBytes: number;
  token?: string;
};
type NativeLibrary = {
  inspectExistingMetadata(
    request: number,
    id: string,
    path: string,
    size: number,
    duration: number,
  ): Promise<LibraryDescriptiveMetadata & { title?: string }>;
  cancelExistingMetadata(request: number): Promise<void>;
  publishExistingArtwork(
    request: number,
    id: string,
  ): Promise<LocalArtworkPublication | null>;
  finishExistingArtwork(
    request: number,
    id: string,
    token: string,
    keep: boolean,
  ): Promise<void>;
  discardExistingMetadata(request: number, id: string): Promise<void>;
  publishLocalArtwork(id: string): Promise<LocalArtworkPublication | null>;
  finishLocalArtwork(id: string, token: string, keep: boolean): Promise<void>;
  discardLocalArtwork(id: string): Promise<void>;
  localImportIdentity(uri: string): Promise<LocalImportIdentity>;
  prepare(): Promise<{ databaseDirectoryURL: string }>;
  inspectSource(
    uri: string,
    origin: LibrarySourceKind,
  ): Promise<{
    id: string;
    cacheRelativePath: string;
    extension: string;
    sizeBytes: number;
    relativeMediaPath: string;
  }>;
  movePrepared(
    relative: string,
    id: string,
    ext: string,
    origin: LibrarySourceKind,
    expectedSize: number,
    expectedPath: string,
  ): Promise<{
    relativeMediaPath: string;
    uri: string;
    sizeBytes: number;
  }>;
  confirmImported(
    relative: string,
    id: string,
    size: number,
    mediaType: LibraryMetadata['mediaType'],
  ): Promise<{
    mediaType: LibraryMetadata['mediaType'];
    durationSeconds: number;
  }>;
  cleanupImportStaging(protectedPaths: string[]): Promise<void>;
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
const localImports = new Map<
  string,
  {
    cacheRelativePath: string;
    promise: Promise<AvailableLibraryItem>;
  }
>();

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

/** Fill absent local descriptive fields only. NULL/undefined never mean erase.
 * Existing values require a future explicit-consent operation, not this method.
 * One guarded SQL UPDATE is atomic and cannot recreate a deleted row.
 */
export async function updateLocalDescriptiveMetadata(
  id: string,
  patch: Partial<LibraryDescriptiveMetadata>,
): Promise<boolean> {
  const keys = ['artist', 'album', 'genre', 'year'] as const;
  if (
    !patch ||
    typeof patch !== 'object' ||
    Array.isArray(patch) ||
    Object.keys(patch).some(
      (key) => !keys.includes(key as (typeof keys)[number]),
    )
  ) {
    throw new Error('Metadatos descriptivos no válidos.');
  }
  const updates: { key: (typeof keys)[number]; value: string | number }[] = [];
  for (const key of keys) {
    const value = patch[key];
    if (value == null) continue;
    if (key === 'year') {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 9999
      )
        throw new Error('Año no válido.');
      updates.push({ key, value });
    } else {
      if (typeof value !== 'string')
        throw new Error('Texto descriptivo no válido.');
      const text = Array.from(
        value
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
        .slice(0, 240)
        .join('');
      if (text) updates.push({ key, value: text });
    }
  }
  if (updates.length === 0) return false;
  const absent = (key: (typeof keys)[number]) =>
    key === 'year' ? 'year IS NULL' : `(${key} IS NULL OR trim(${key}) = '')`;
  const assignments = updates
    .map(
      ({ key }) => `${key} = CASE WHEN ${absent(key)} THEN ? ELSE ${key} END`,
    )
    .join(', ');
  const predicate = updates.map(({ key }) => absent(key)).join(' OR ');
  const db = await openLibraryDatabase();
  const result = await db.runAsync(
    `UPDATE library_items SET ${assignments} WHERE id = ? AND sourceKind = 'local' AND lifecycle = 'ready' AND (${predicate})`,
    ...updates.map(({ value }) => value),
    id,
  );
  if (result.changes > 0) changed();
  return result.changes > 0;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return (
    Array.from(
      value
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
      .slice(0, 240)
      .join('') || null
  );
}

function validatedMetadata(meta: LibraryMetadata): LibraryMetadata {
  // Count Unicode code points, not UTF-16 units or complete graphemes.
  const title =
    Array.from(meta.title.trim()).slice(0, 240).join('') || 'Archivo de Drop';
  const finite = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    ...meta,
    title,
    artist: optionalText(meta.artist),
    album: optionalText(meta.album),
    genre: optionalText(meta.genre),
    year:
      typeof meta.year === 'number' &&
      Number.isInteger(meta.year) &&
      meta.year >= 1 &&
      meta.year <= 9999
        ? meta.year
        : null,
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

async function confirmReady(
  row: Pick<
    Row,
    'id' | 'relativeMediaPath' | 'sizeBytes' | 'sourceKind' | 'mediaType'
  >,
  storage: NativeLibrary,
): Promise<void> {
  const db = await openLibraryDatabase();
  if (row.sourceKind === 'local') {
    const metadata = await storage.confirmImported(
      row.relativeMediaPath,
      row.id,
      row.sizeBytes,
      row.mediaType,
    );
    if (
      metadata?.mediaType !== row.mediaType ||
      !Number.isFinite(metadata.durationSeconds) ||
      metadata.durationSeconds <= 0
    )
      throw new Error('No se pudieron verificar los metadatos del archivo.');
    await db.runAsync(
      `UPDATE library_items SET lifecycle = 'ready', sourceCacheRelativePath = NULL,
       sizeBytes = ?, durationSeconds = ? WHERE id = ? AND lifecycle = 'pending'`,
      row.sizeBytes,
      metadata.durationSeconds,
      row.id,
    );
  } else {
    await db.runAsync(
      `UPDATE library_items SET lifecycle = 'ready', sourceCacheRelativePath = NULL,
       sizeBytes = ? WHERE id = ? AND lifecycle = 'pending'`,
      row.sizeBytes,
      row.id,
    );
  }
}

async function recoverPending(row: Row, storage: NativeLibrary): Promise<void> {
  if (row.sourceKind === 'local' && !row.sourceCacheRelativePath) return;
  let stat = await storage.statMedia(row.relativeMediaPath);
  if (
    row.sourceCacheRelativePath &&
    (!stat.exists || row.sourceKind === 'local')
  ) {
    // Inspection errors are not evidence of abandonment.
    const source = await storage.statPreparedSource(
      row.sourceCacheRelativePath,
    );
    if (source.exists) {
      // With an exclusive rename, a staged and a final copy indicate a collision.
      if (
        stat.exists ||
        !source.sizeBytes ||
        source.sizeBytes !== row.sizeBytes
      )
        return;
      const ext = row.relativeMediaPath.split('.').at(-1) ?? '';
      await storage.movePrepared(
        row.sourceCacheRelativePath,
        row.id,
        ext,
        row.sourceKind,
        row.sizeBytes,
        row.relativeMediaPath,
      );
      stat = await storage.statMedia(row.relativeMediaPath);
    }
  }
  if (!stat.exists) {
    await deleteLibraryRow(row.id);
    await storage.removeArtwork(row.id);
    return;
  }
  if (
    !stat.sizeBytes ||
    stat.sizeBytes <= 0 ||
    row.sizeBytes !== stat.sizeBytes
  )
    return;
  await confirmReady(row, storage);
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
      await recoverPending(row, storage);
      // Artwork references survive missing/partial images; hydration uses a
      // fallback without changing the stored reference or expected metadata.
    } catch (error) {
      console.warn('[Drop library] Could not reconcile item', row.id, error);
    }
  }
  const references = await db.getAllAsync<
    Pick<Row, 'relativeMediaPath' | 'sourceCacheRelativePath'>
  >('SELECT relativeMediaPath, sourceCacheRelativePath FROM library_items');
  const tracked = new Set(references.map((row) => row.relativeMediaPath));
  try {
    await storage.cleanupImportStaging([
      ...references.flatMap((row) =>
        row.sourceCacheRelativePath ? [row.sourceCacheRelativePath] : [],
      ),
      ...[...localImports.values()].map(
        (operation) => operation.cacheRelativePath,
      ),
    ]);
  } catch (error) {
    console.warn('[Drop library] Could not clean import staging', error);
  }
  let untrackedImports = 0;
  for (const relative of await storage.listMedia()) {
    if (tracked.has(relative)) continue;
    // A final import may have been restored before its database row.
    if (relative.startsWith('ImportedMedia/')) untrackedImports++;
    if (relative.startsWith('Media/')) {
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
  if (untrackedImports > 0) {
    console.warn(
      '[Drop library] Preserved untracked imports',
      untrackedImports,
    );
  }
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

// Input comes from validated native staging; optional enrichment never validates media.
export async function importPreparedLocalFile(
  prepared: PreparedLocalFile,
): Promise<AvailableLibraryItem> {
  if (
    !prepared ||
    typeof prepared.uri !== 'string' ||
    typeof prepared.title !== 'string' ||
    !['audio', 'video'].includes(prepared.mediaType)
  )
    throw new Error('El archivo preparado no es válido.');
  const storage = native();
  const source = await storage.localImportIdentity(prepared.uri);
  const active = localImports.get(source.id);
  if (active) {
    if (active.cacheRelativePath !== source.cacheRelativePath)
      throw new Error(
        'La identidad del archivo no coincide con la importación activa.',
      );
    return active.promise;
  }
  if (localImports.size > 0)
    throw new Error('Ya hay una importación en curso.');
  const promise = Promise.resolve()
    .then(async () => {
      await initializeLibrary();
      const row = await rowFor(source.id);
      if (!row) {
        const item = await promoteToLibrary(prepared.uri, {
          sourceKind: 'local',
          title: prepared.title
            .replace(/[\u0000-\u001f\u007f]+/g, ' ')
            .replace(/\s+/g, ' '),
          mediaType: prepared.mediaType,
          artist: prepared.artist,
          album: prepared.album,
          genre: prepared.genre,
          year: prepared.year,
        });
        await attachLocalImportArtwork(item.id, storage);
        const current = await rowFor(item.id);
        if (current?.lifecycle !== 'ready')
          throw new Error('El archivo ya no está en Biblioteca.');
        const available = await attach(current);
        if (!isAvailableLibraryItem(available))
          throw new Error('El archivo ya no está disponible.');
        return available;
      }
      if (
        row.sourceKind !== 'local' ||
        row.relativeMediaPath !== source.relativeMediaPath ||
        (row.lifecycle === 'pending' &&
          row.sourceCacheRelativePath !== source.cacheRelativePath)
      )
        throw new Error('La identidad del archivo no coincide con Biblioteca.');
      if (row.lifecycle === 'pending') await recoverPending(row, storage);
      const current = await rowFor(source.id);
      if (current?.lifecycle !== 'ready')
        throw new Error('La importación todavía no pudo confirmarse.');
      const item = await attach(current);
      if (!isAvailableLibraryItem(item))
        throw new Error('No se pudo verificar el archivo en Biblioteca.');
      if (row.lifecycle === 'pending') changed();
      return item;
    })
    .finally(async () => {
      localImports.delete(source.id);
      try {
        await storage.discardLocalArtwork?.(source.id);
      } catch (error) {
        console.warn('[Drop library] Native artwork discard deferred', error);
      }
    });
  localImports.set(source.id, {
    cacheRelativePath: source.cacheRelativePath,
    promise,
  });
  return promise;
}

// A lease protects media deletion while native publication and SQL association settle.
// Native compensation additionally verifies token, hash, managed path and all SQL references.
async function attachLocalImportArtwork(
  id: string,
  storage: NativeLibrary,
): Promise<void> {
  await withLibraryLease(id, async () => {
    let publication: LocalArtworkPublication | null = null;
    let linked = false;
    try {
      publication = (await storage.publishLocalArtwork?.(id)) ?? null;
      if (!publication) return;
      if (
        publication.relativePath !== `Artwork/${id}.jpg` ||
        !Number.isSafeInteger(publication.sizeBytes) ||
        publication.sizeBytes <= 0 ||
        publication.sizeBytes > 2 * 1_048_576
      )
        return;
      const stat = await storage.statArtwork(id);
      if (!stat.exists || stat.sizeBytes !== publication.sizeBytes) return;
      const db = await openLibraryDatabase();
      const result = await db.runAsync(
        `UPDATE library_items SET relativeArtworkPath = ?, artworkSizeBytes = ?
         WHERE id = ? AND lifecycle = 'ready' AND sourceKind = 'local' AND relativeArtworkPath IS NULL`,
        publication.relativePath,
        publication.sizeBytes,
        id,
      );
      linked = result.changes > 0;
      if (linked) changed();
    } catch (error) {
      // The confirmed medium remains valid. No retry or late metadata write.
      console.warn('[Drop library] Optional local artwork unavailable', error);
    } finally {
      if (publication?.token) {
        try {
          await storage.finishLocalArtwork(id, publication.token, linked);
        } catch (error) {
          console.warn(
            '[Drop library] Local artwork reconciliation deferred',
            error,
          );
        }
      }
    }
  });
}

export async function promoteToLibrary(
  uri: string,
  metadata: LibraryMetadata,
): Promise<AvailableLibraryItem> {
  await initializeLibrary();
  const storage = native();
  const db = await openLibraryDatabase();
  const safe = validatedMetadata(metadata);
  const prepared = await storage.inspectSource(uri, safe.sourceKind);
  const relative = prepared.relativeMediaPath;
  const downloadedAt = new Date().toISOString();
  try {
    await db.runAsync(
      `INSERT INTO library_items (
      id, sourceKind, sourceVideoId, title, mediaType, relativeMediaPath,
      sourceCacheRelativePath, durationSeconds, sizeBytes, resolution, height, fps,
      videoCodec, audioCodec, container, downloadedAt, artist, album, genre, year, lifecycle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
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
      safe.artist ?? null,
      safe.album ?? null,
      safe.genre ?? null,
      safe.year ?? null,
    );
  } catch (error) {
    if (safe.sourceKind === 'local') {
      try {
        if (!(await rowFor(prepared.id)))
          await storage.removeOwnedCache(prepared.cacheRelativePath);
      } catch (cleanupError) {
        console.warn(
          '[Drop library] Could not clean unregistered import',
          cleanupError,
        );
      }
    }
    throw error;
  }
  let moved: Awaited<ReturnType<NativeLibrary['movePrepared']>>;
  try {
    moved = await storage.movePrepared(
      prepared.cacheRelativePath,
      prepared.id,
      prepared.extension,
      safe.sourceKind,
      prepared.sizeBytes,
      relative,
    );
  } catch (error) {
    if (safe.sourceKind === 'local') throw error; // Recovery needs the staged copy and pending row.
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
  if (moved.relativeMediaPath !== relative)
    throw new Error('El destino no coincide con el registro de Biblioteca.');
  if (moved.sizeBytes !== prepared.sizeBytes) {
    if (safe.sourceKind !== 'local') {
      await storage.removeMedia(relative);
      await deleteLibraryRow(prepared.id);
    }
    throw new Error('El archivo cambió antes de entrar en Biblioteca.');
  }
  await confirmReady(
    {
      id: prepared.id,
      sourceKind: safe.sourceKind,
      mediaType: safe.mediaType,
      relativeMediaPath: relative,
      sizeBytes: moved.sizeBytes,
    },
    storage,
  );
  const row = await rowFor(prepared.id);
  if (row?.lifecycle !== 'ready')
    throw new Error('No se pudo confirmar el archivo en Biblioteca.');
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

export type MetadataPhase = 'analyzing' | 'found' | 'applying';
let metadataRequest = Date.now();
let existingCompletion: {
  id: string;
  request: number;
  cancelled: boolean;
  applying: boolean;
  cancel: () => void;
} | null = null;
export function cancelExistingMetadataCompletion(id: string): boolean {
  const op = existingCompletion;
  if (!op || op.id !== id || op.applying) return false;
  op.cancelled = true;
  op.cancel();
  void native()
    .cancelExistingMetadata(op.request)
    .catch(() => undefined);
  return true;
}

export async function completeExistingLocalMetadata(
  id: string,
  decide: (
    current: string,
    proposed: string,
  ) => Promise<'keep' | 'replace' | 'cancel'>,
  report: (phase: MetadataPhase) => void = () => undefined,
): Promise<boolean> {
  if (existingCompletion) throw new Error('Ya hay un análisis en curso.');
  let cancel!: () => void;
  const cancelled = new Promise<null>((resolve) => {
    cancel = () => resolve(null);
  });
  const op = {
    id,
    request: ++metadataRequest,
    cancelled: false,
    applying: false,
    cancel,
  };
  existingCompletion = op;
  const storage = native();
  try {
    return await withLibraryLease(id, async (item) => {
      if (
        item.sourceKind !== 'local' ||
        !item.relativeMediaPath.startsWith('ImportedMedia/') ||
        !/\.(mp3|m4a|mp4)$/.test(item.relativeMediaPath) ||
        !item.durationSeconds
      )
        throw new Error('El archivo local no es compatible.');
      report('analyzing');
      const metadata = await Promise.race([
        storage.inspectExistingMetadata(
          op.request,
          id,
          item.relativeMediaPath,
          item.sizeBytes,
          item.durationSeconds,
        ),
        cancelled,
      ]);
      if (!metadata || op.cancelled) return false;
      const proposed = optionalText(metadata.title);
      report('found');
      const choice =
        proposed && proposed !== item.title
          ? await Promise.race([decide(item.title, proposed), cancelled])
          : 'keep';
      if (!choice || choice === 'cancel' || op.cancelled) return false;
      const current = await rowFor(id);
      if (
        !current ||
        current.lifecycle !== 'ready' ||
        current.sourceKind !== 'local' ||
        current.relativeMediaPath !== item.relativeMediaPath ||
        current.sizeBytes !== item.sizeBytes
      )
        throw new Error('El archivo cambió o fue eliminado.');
      const stat = await storage.statMedia(item.relativeMediaPath);
      if (!stat.exists || stat.sizeBytes !== item.sizeBytes)
        throw new Error('El archivo ya no está disponible.');
      const oldArt = await storage.statArtwork(id);
      if (op.cancelled) return false;
      // Commit boundary: cancellation is no longer accepted after this point.
      op.applying = true;
      report('applying');
      let publication: LocalArtworkPublication | null = null,
        linked = false;
      try {
        if (!oldArt.exists) {
          try {
            publication = await storage.publishExistingArtwork(op.request, id);
          } catch {
            /* Optional image; preserve text and medium. */
          }
        }
        if (
          publication &&
          (publication.relativePath !== `Artwork/${id}.jpg` ||
            !Number.isSafeInteger(publication.sizeBytes) ||
            publication.sizeBytes <= 0 ||
            publication.sizeBytes > 2 * 1_048_576)
        )
          throw new Error('Portada no válida.');
        if (publication) {
          const art = await storage.statArtwork(id);
          if (!art.exists || art.sizeBytes !== publication.sizeBytes)
            throw new Error('Portada no disponible.');
        }
        const db = await openLibraryDatabase();
        const text =
          choice === 'replace' && current.title === item.title
            ? proposed
            : null;
        const artist = optionalText(metadata.artist),
          album = optionalText(metadata.album),
          genre = optionalText(metadata.genre);
        const year =
          typeof metadata.year === 'number' &&
          Number.isInteger(metadata.year) &&
          metadata.year >= 1 &&
          metadata.year <= 9999
            ? metadata.year
            : null;
        const artPath = publication?.relativePath ?? null,
          artSize = publication?.sizeBytes ?? null;
        const result = await db.runAsync(
          `UPDATE library_items SET relativeArtworkPath=COALESCE(?,relativeArtworkPath),artworkSizeBytes=COALESCE(?,artworkSizeBytes),
          title=COALESCE(?,title),artist=CASE WHEN artist IS NULL OR trim(artist)='' THEN COALESCE(?,artist) ELSE artist END,
          album=CASE WHEN album IS NULL OR trim(album)='' THEN COALESCE(?,album) ELSE album END,
          genre=CASE WHEN genre IS NULL OR trim(genre)='' THEN COALESCE(?,genre) ELSE genre END,year=COALESCE(year,?)
          WHERE id=? AND lifecycle='ready' AND sourceKind='local' AND title=? AND relativeMediaPath=? AND sizeBytes=? AND relativeArtworkPath IS ?
          AND ((? IS NOT NULL AND title<>?) OR (? IS NOT NULL AND (artist IS NULL OR trim(artist)='')) OR (? IS NOT NULL AND (album IS NULL OR trim(album)='')) OR (? IS NOT NULL AND (genre IS NULL OR trim(genre)='')) OR (? IS NOT NULL AND year IS NULL) OR ? IS NOT NULL)`,
          artPath,
          artSize,
          text,
          artist,
          album,
          genre,
          year,
          id,
          current.title,
          current.relativeMediaPath,
          current.sizeBytes,
          current.relativeArtworkPath,
          text,
          text,
          artist,
          album,
          genre,
          year,
          artPath,
        );
        linked = result.changes > 0 && publication !== null;
        if (result.changes > 0) changed();
        const after = await rowFor(id);
        if (after?.lifecycle !== 'ready')
          throw new Error('El archivo fue eliminado.');
        return result.changes > 0;
      } finally {
        if (publication?.token)
          await storage.finishExistingArtwork(
            op.request,
            id,
            publication.token,
            linked,
          );
      }
    });
  } finally {
    try {
      await storage.discardExistingMetadata(op.request, id);
    } finally {
      if (existingCompletion === op) existingCompletion = null;
    }
  }
}
