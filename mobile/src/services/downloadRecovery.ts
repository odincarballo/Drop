import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';

import {
  appendPartialBytes,
  removePartialBytes,
  verifyPartialBytes,
} from './downloadPartialStorage';

const databaseName = 'drop-downloads.sqlite';
const schemaVersion = 2;
const mode = z.enum(['VIDEO_AUDIO', 'VIDEO_ONLY', 'AUDIO_ONLY']);
const format = z.string().regex(/^[a-zA-Z0-9_-]{1,55}(?:@[a-f0-9]{24})?$/);
const videoId = z.string().regex(/^[a-zA-Z0-9_-]{11}$/);
const jobId = z.string().regex(/^[a-f0-9]{32}$/);
const phase = z.enum([
  'creating',
  'preparing',
  'downloading',
  'transferring',
  'processing',
  'saving',
]);
const errorCode = z.enum(['DOWNLOAD_FAILED', 'REMOTE_EXPIRED']);
export const completedDownloadAssetSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/),
  ext: z.enum(['mp4', 'm4a', 'mp3', 'aac']),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type CompletedDownloadAsset = z.infer<
  typeof completedDownloadAssetSchema
>;
const fields = {
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  generation: z.number().int().positive(),
  status: z.enum([
    'pending',
    'interrupted',
    'failed',
    'cancelled',
    'remote-ready',
  ]),
  phase,
  bytes: z.number().int().nonnegative(),
  errorCode: errorCode.nullable(),
  publication: z
    .strictObject({
      asset: completedDownloadAssetSchema.optional(),
      discarding: z.literal(true).optional(),
    })
    .optional(),
};
const schema = z.discriminatedUnion('source', [
  z.strictObject({
    ...fields,
    source: z.literal('direct'),
    selection: z.strictObject({ mode }),
    remoteJobId: jobId.nullable(),
  }),
  z.strictObject({
    ...fields,
    source: z.literal('youtube'),
    selection: z.strictObject({
      mode,
      videoId,
      videoFormatId: format.optional(),
      audioFormatId: format.optional(),
    }),
    remoteJobId: z.null(),
  }),
]);

export type DownloadRecord = z.infer<typeof schema>;
type Selection =
  | {
      source: 'direct';
      selection: Extract<DownloadRecord, { source: 'direct' }>['selection'];
    }
  | {
      source: 'youtube';
      selection: Extract<DownloadRecord, { source: 'youtube' }>['selection'];
    };
type Phase = z.infer<typeof phase>;
type Update = Partial<
  Pick<
    DownloadRecord,
    'status' | 'phase' | 'bytes' | 'errorCode' | 'remoteJobId'
  >
>;
type Identity = Pick<DownloadRecord, 'id' | 'generation'>;
const maxPartialBytes = 100 * 1024 * 1024;
const maxPartialChunkBytes = 1024 * 1024;
const emptyPrefixSha256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const partialResource = z.strictObject({
  remoteJobId: jobId,
  totalBytes: z.number().int().positive().max(maxPartialBytes),
  sha256,
  etag: z.string().regex(/^"sha256-[a-f0-9]{64}"$/),
});
const partialProgress = z.strictObject({
  confirmedBytes: z.number().int().nonnegative().max(maxPartialBytes),
  prefixSha256: sha256,
});
const partialCheckpoint = partialResource
  .extend({
    id: fields.id,
    generation: fields.generation,
    ...partialProgress.shape,
  })
  .refine(
    (value) =>
      value.etag === `"sha256-${value.sha256}"` &&
      value.confirmedBytes <= value.totalBytes &&
      (value.confirmedBytes !== 0 ||
        value.prefixSha256 === emptyPrefixSha256) &&
      (value.confirmedBytes !== value.totalBytes ||
        value.prefixSha256 === value.sha256),
  );
const partialState = z.enum(['active', 'discarding', 'discarded']);
export type DownloadPartialResource = z.infer<typeof partialResource>;
export type DownloadPartialCheckpoint = z.infer<typeof partialCheckpoint>;

const partialSchema = `
  CREATE TABLE download_partial (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation > 0),
    remoteJobId TEXT NOT NULL,
    totalBytes INTEGER NOT NULL CHECK (totalBytes BETWEEN 1 AND ${maxPartialBytes}),
    sha256 TEXT NOT NULL,
    etag TEXT NOT NULL,
    confirmedBytes INTEGER NOT NULL CHECK (confirmedBytes BETWEEN 0 AND totalBytes),
    prefixSha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'discarding', 'discarded'))
  );
  CREATE TRIGGER discard_partial_on_attempt_update
  AFTER UPDATE OF id, generation ON download_attempt
  WHEN OLD.id <> NEW.id OR OLD.generation <> NEW.generation
  BEGIN
    UPDATE download_partial SET state = 'discarding'
    WHERE slot = 1 AND id = OLD.id AND generation = OLD.generation AND state = 'active';
  END;
  CREATE TRIGGER discard_partial_on_attempt_delete
  AFTER DELETE ON download_attempt
  BEGIN
    UPDATE download_partial SET state = 'discarding'
    WHERE slot = 1 AND id = OLD.id AND generation = OLD.generation AND state = 'active';
  END;
`;

let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.catch(() => undefined);
  return result;
}

type StoredAttempt = Identity & { payload: string };

export class DownloadRecoveryError extends Error {
  constructor(
    readonly code:
      'DOWNLOAD_ACTIVE' | 'DOWNLOAD_STORAGE' | 'DOWNLOAD_INTERRUPTION',
  ) {
    super(
      {
        DOWNLOAD_ACTIVE:
          'Ya hay una descarga pendiente. Cierra y vuelve a abrir Drop para revisarla.',
        DOWNLOAD_STORAGE:
          'No se pudo guardar el estado de la descarga. Inténtalo de nuevo.',
        DOWNLOAD_INTERRUPTION:
          'No se pudo registrar la interrupción. Cierra y vuelve a abrir Drop para revisar el intento.',
      }[code],
    );
  }
}

let database: Promise<SQLiteDatabase> | undefined;

async function transaction<T>(
  db: SQLiteDatabase,
  action: () => Promise<T>,
): Promise<T> {
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    const result = await action();
    await db.execAsync('COMMIT');
    return result;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      database = undefined;
      await db.closeAsync().catch(() => undefined);
    }
    throw error;
  }
}

async function open() {
  const db = await openDatabaseAsync(databaseName, { useNewConnection: true });
  try {
    await db.execAsync('PRAGMA busy_timeout = 1000');
    await db.execAsync('PRAGMA synchronous = FULL');
    await transaction(db, async () => {
      const version = await db.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version',
      );
      if (version?.user_version === schemaVersion) return;
      if (version?.user_version !== 0 && version?.user_version !== 1)
        throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
      if (version.user_version === 0)
        await db.execAsync(`
        CREATE TABLE download_attempt (
          slot INTEGER PRIMARY KEY CHECK (slot = 1),
          id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK (generation > 0),
          payload TEXT NOT NULL
        );
      `);
      await db.execAsync(
        `${partialSchema} PRAGMA user_version = ${schemaVersion};`,
      );
    });
    return db;
  } catch (error) {
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
}

function getDatabase() {
  database ??= open().catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}

function readRow(db: SQLiteDatabase) {
  return db.getFirstAsync<StoredAttempt>(
    'SELECT id, generation, payload FROM download_attempt WHERE slot = 1',
  );
}

function decode(row: StoredAttempt | null): DownloadRecord | null {
  if (!row || typeof row.payload !== 'string' || row.payload.length > 1024)
    return null;
  try {
    const record = schema.safeParse(JSON.parse(row.payload)).data;
    if (
      record?.publication &&
      (record.status !== 'pending' ||
        record.phase !== 'saving' ||
        record.bytes < 1 ||
        (record.publication.asset &&
          record.publication.asset.sizeBytes !== record.bytes))
    )
      return null;
    return record?.id === row.id && record.generation === row.generation
      ? record
      : null;
  } catch {
    return null;
  }
}

function requireWrite(result: { changes: number }) {
  if (result.changes !== 1) throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
}

export function readDownloadRecord() {
  return serialized(async () => decode(await readRow(await getDatabase())));
}

async function write(
  db: SQLiteDatabase,
  value: DownloadRecord,
  expected: Identity | null,
) {
  const checked = schema.parse(value);
  const payload = JSON.stringify(checked);
  const result = expected
    ? await db.runAsync(
        'UPDATE download_attempt SET id = ?, generation = ?, payload = ? WHERE slot = 1 AND id = ? AND generation = ?',
        checked.id,
        checked.generation,
        payload,
        expected.id,
        expected.generation,
      )
    : await db.runAsync(
        'INSERT INTO download_attempt (slot, id, generation, payload) VALUES (1, ?, ?, ?)',
        checked.id,
        checked.generation,
        payload,
      );
  requireWrite(result);
  if (checked.phase === 'saving') {
    await db.runAsync(
      "UPDATE download_partial SET state = 'discarding' WHERE slot = 1 AND id = ? AND generation = ? AND state = 'active'",
      checked.id,
      checked.generation,
    );
  }
  return checked;
}

async function remove(db: SQLiteDatabase, record: Identity) {
  const result = await db.runAsync(
    'DELETE FROM download_attempt WHERE slot = 1 AND id = ? AND generation = ?',
    record.id,
    record.generation,
  );
  requireWrite(result);
}

function change(
  identity: Identity,
  update: (
    db: SQLiteDatabase,
    current: DownloadRecord,
  ) => Promise<DownloadRecord | null>,
) {
  return serialized(async () => {
    const db = await getDatabase();
    return transaction(db, async () => {
      const current = decode(await readRow(db));
      if (
        !current ||
        current.id !== identity.id ||
        current.generation !== identity.generation
      )
        return null;
      return update(db, current);
    });
  });
}

export function updateRecoveredDownload(
  record: DownloadRecord,
  update: Update,
) {
  return change(record, (db, current) =>
    current.publication
      ? Promise.resolve(null)
      : write(db, { ...current, ...update } as DownloadRecord, current),
  );
}

export function discardRecoveredDownload(record: DownloadRecord) {
  return change(record, async (db, current) => {
    if (current.publication) return null;
    await remove(db, current);
    return current;
  });
}

export function recordCompletedAsset(
  record: Identity,
  asset: CompletedDownloadAsset,
) {
  return change(record, async (db, current) => {
    if (
      !current.publication ||
      current.publication.discarding ||
      current.bytes !== asset.sizeBytes
    )
      return null;
    const existing = current.publication.asset;
    if (existing)
      return existing.id === asset.id &&
        existing.ext === asset.ext &&
        existing.sha256 === asset.sha256
        ? current
        : null;
    return write(db, { ...current, publication: { asset } }, current);
  });
}

export function beginDownloadDiscard(
  record: Identity,
  discovered?: CompletedDownloadAsset,
) {
  return change(record, async (db, current) => {
    if (!current.publication) return null;
    if (current.publication.discarding) return current;
    const asset = current.publication.asset ?? discovered;
    if (asset && asset.sizeBytes !== current.bytes) return null;
    return write(
      db,
      { ...current, publication: { asset, discarding: true } },
      current,
    );
  });
}

export function finishDownloadPublication(record: DownloadRecord) {
  return change(record, async (db, current) => {
    if (
      !current.publication ||
      current.publication.discarding !== record.publication?.discarding
    )
      return null;
    await remove(db, current);
    return current;
  });
}

function partialTransaction<T>(action: (db: SQLiteDatabase) => Promise<T>) {
  return serialized(async () => {
    const db = await getDatabase();
    return transaction(db, () => action(db));
  });
}

async function readPartial(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT id, generation, remoteJobId, totalBytes, sha256, etag, confirmedBytes,
            prefixSha256, state FROM download_partial WHERE slot = 1`,
  );
  if (!row) return null;
  const { state, ...values } = row;
  const checkpoint = partialCheckpoint.safeParse(values);
  const lifecycle = partialState.safeParse(state);
  if (!checkpoint.success || !lifecycle.success)
    throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
  return { state: lifecycle.data, checkpoint: checkpoint.data };
}

function sameOwner(a: Identity, b: Identity) {
  return a.id === b.id && a.generation === b.generation;
}

function sameResource(a: DownloadPartialResource, b: DownloadPartialResource) {
  return (
    a.remoteJobId === b.remoteJobId &&
    a.totalBytes === b.totalBytes &&
    a.etag === b.etag &&
    a.sha256 === b.sha256
  );
}

function storageKey(owner: Identity) {
  return `${owner.id}.${owner.generation}`;
}

async function ownsPartial(
  db: SQLiteDatabase,
  checkpoint: DownloadPartialCheckpoint,
) {
  const attempt = decode(await readRow(db));
  return (
    attempt?.source === 'direct' &&
    sameOwner(attempt, checkpoint) &&
    attempt.remoteJobId === checkpoint.remoteJobId &&
    attempt.status !== 'cancelled' &&
    attempt.phase !== 'saving' &&
    !attempt.publication
  );
}

export function reserveDownloadPartial(
  owner: Identity,
  resource: DownloadPartialResource,
) {
  return partialTransaction(async (db) => {
    const checked = partialCheckpoint.parse({
      ...resource,
      id: owner.id,
      generation: owner.generation,
      confirmedBytes: 0,
      prefixSha256: emptyPrefixSha256,
    });
    if (!(await ownsPartial(db, checked))) return null;
    const previous = await readPartial(db);
    if (previous && sameOwner(previous.checkpoint, checked)) {
      return previous.state === 'active' &&
        sameResource(previous.checkpoint, checked)
        ? previous.checkpoint
        : null;
    }
    if (previous?.state === 'active') return null;
    if (previous?.state === 'discarding')
      await cleanPartial(db, previous.checkpoint);
    requireWrite(
      await db.runAsync(
        `INSERT INTO download_partial
        (slot, id, generation, remoteJobId, totalBytes, sha256, etag, confirmedBytes, prefixSha256, state)
        VALUES (1, ?, ?, ?, ?, ?, ?, 0, ?, 'active')
        ON CONFLICT(slot) DO UPDATE SET id=excluded.id, generation=excluded.generation,
          remoteJobId=excluded.remoteJobId, totalBytes=excluded.totalBytes, sha256=excluded.sha256,
          etag=excluded.etag, confirmedBytes=0, prefixSha256=excluded.prefixSha256, state='active'`,
        checked.id,
        checked.generation,
        checked.remoteJobId,
        checked.totalBytes,
        checked.sha256,
        checked.etag,
        checked.prefixSha256,
      ),
    );
    return checked;
  });
}

export function appendDownloadPartial(
  expected: DownloadPartialCheckpoint,
  bytes: Uint8Array,
) {
  return partialTransaction(async (db) => {
    const previous = await readPartial(db);
    if (previous?.state !== 'active') return null;
    const current = previous.checkpoint;
    if (
      !sameOwner(current, expected) ||
      !sameResource(current, expected) ||
      current.confirmedBytes !== expected.confirmedBytes ||
      current.prefixSha256 !== expected.prefixSha256 ||
      !(await ownsPartial(db, current))
    )
      return null;
    const count = bytes.byteLength;
    if (
      count === 0 ||
      count > maxPartialChunkBytes ||
      current.confirmedBytes + count > current.totalBytes
    )
      throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
    const result = partialProgress.parse(
      await appendPartialBytes(
        storageKey(current),
        current.confirmedBytes,
        current.prefixSha256,
        current.totalBytes,
        bytes,
      ),
    );
    const next = partialCheckpoint.safeParse({ ...current, ...result });
    if (
      !next.success ||
      result.confirmedBytes !== current.confirmedBytes + count
    )
      throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
    requireWrite(
      await db.runAsync(
        `UPDATE download_partial SET confirmedBytes = ?, prefixSha256 = ?
       WHERE slot = 1 AND id = ? AND generation = ? AND state = 'active' AND confirmedBytes = ?`,
        next.data.confirmedBytes,
        next.data.prefixSha256,
        current.id,
        current.generation,
        current.confirmedBytes,
      ),
    );
    return next.data;
  });
}

export function recoverDownloadPartial(owner: Identity) {
  return partialTransaction(async (db) => {
    const row = await readPartial(db);
    if (
      row?.state !== 'active' ||
      !sameOwner(row.checkpoint, owner) ||
      !(await ownsPartial(db, row.checkpoint))
    )
      return null;
    const checkpoint = row.checkpoint;
    await verifyPartialBytes(
      storageKey(checkpoint),
      checkpoint.confirmedBytes,
      checkpoint.prefixSha256,
    );
    return checkpoint;
  });
}

async function cleanPartial(
  db: SQLiteDatabase,
  checkpoint: DownloadPartialCheckpoint,
) {
  await removePartialBytes(storageKey(checkpoint));
  requireWrite(
    await db.runAsync(
      "UPDATE download_partial SET state = 'discarded' WHERE slot = 1 AND id = ? AND generation = ? AND state = 'discarding'",
      checkpoint.id,
      checkpoint.generation,
    ),
  );
}

export function finishDownloadPartialCleanup(owner?: Identity) {
  return partialTransaction(async (db) => {
    const row = await readPartial(db);
    if (
      row?.state !== 'discarding' ||
      (owner && !sameOwner(row.checkpoint, owner))
    )
      return false;
    await cleanPartial(db, row.checkpoint);
    return true;
  });
}

export async function discardDownloadPartial(owner: Identity) {
  const marked = await partialTransaction(async (db) => {
    const row = await readPartial(db);
    if (!row || row.state === 'discarded' || !sameOwner(row.checkpoint, owner))
      return false;
    if (row.state === 'active')
      requireWrite(
        await db.runAsync(
          "UPDATE download_partial SET state = 'discarding' WHERE slot = 1 AND id = ? AND generation = ? AND state = 'active'",
          owner.id,
          owner.generation,
        ),
      );
    return true;
  });
  return marked && finishDownloadPartialCleanup(owner);
}

export function rememberDownload(input: Selection): Promise<DownloadAttempt> {
  return serialized(async () => {
    const db = await getDatabase();
    return transaction(db, async () => {
      const row = await readRow(db);
      const previous = decode(row);
      if (previous?.status === 'pending')
        throw new DownloadRecoveryError('DOWNLOAD_ACTIVE');
      // Local correlation only. This ID is neither a credential nor a server ID.
      const id =
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      const safeInput =
        input.source === 'youtube'
          ? {
              ...input,
              selection: {
                mode: input.selection.mode,
                videoId: input.selection.videoId,
                videoFormatId: format.safeParse(input.selection.videoFormatId)
                  .data,
                audioFormatId: format.safeParse(input.selection.audioFormatId)
                  .data,
              },
            }
          : input;
      const record = await write(
        db,
        {
          ...safeInput,
          id,
          version: 1,
          generation: (previous?.generation ?? 0) + 1,
          status: 'pending',
          phase: 'creating',
          bytes: 0,
          errorCode: null,
          remoteJobId: null,
        },
        row,
      );
      return attemptFor(record);
    });
  }).catch((error: unknown) => {
    if (error instanceof DownloadRecoveryError) throw error;
    throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
  });
}

function attemptFor(record: DownloadRecord) {
  let lastPhase = record.phase;
  let lastBytes = 0;
  function pending(update: Update) {
    return change(record, async (db, current) =>
      current.status === 'pending' &&
      !current.publication &&
      (current.phase !== 'saving' || !update.phase || update.phase === 'saving')
        ? write(db, { ...current, ...update } as DownloadRecord, current)
        : null,
    );
  }
  async function update(nextPhase: Phase, bytes = 0, remoteId?: string) {
    const safeBytes = Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0;
    const safeId = jobId.safeParse(remoteId).data;
    const next = await pending({
      phase: nextPhase,
      bytes: safeBytes,
      ...(safeId ? { remoteJobId: safeId } : {}),
    });
    if (next) {
      lastPhase = next.phase;
      lastBytes = next.bytes;
    }
    return next !== null;
  }
  let observed: { phase: Phase; bytes: number } | null = null;
  let flushing = false;
  async function flushProgress() {
    flushing = true;
    try {
      while (observed) {
        const latest = observed;
        observed = null;
        if (
          latest.phase !== lastPhase ||
          (lastBytes === 0 && latest.bytes > 0) ||
          Math.abs(latest.bytes - lastBytes) >= 1024 * 1024
        ) {
          await update(latest.phase, latest.bytes);
        }
      }
    } catch {
      // Progress is informational. Required transitions report storage failures.
    } finally {
      flushing = false;
    }
  }
  return {
    update,
    beginPublication(sizeBytes: number, owner: string) {
      return change(record, async (db, current) => {
        if (
          !Number.isSafeInteger(sizeBytes) ||
          sizeBytes <= 0 ||
          current.status !== 'pending' ||
          current.phase === 'saving' ||
          (current.source === 'direct' && current.remoteJobId !== owner)
        )
          return null;
        return write(
          db,
          {
            ...current,
            phase: 'saving',
            bytes: sizeBytes,
            publication: {},
          },
          current,
        );
      });
    },
    async ownsReservation() {
      const current = await readDownloadRecord().catch(() => {
        throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
      });
      return (
        current?.id === record.id &&
        current.generation === record.generation &&
        current.status === 'pending' &&
        current.phase === 'creating'
      );
    },
    observe(nextPhase: Phase, bytes = 0) {
      observed = { phase: nextPhase, bytes };
      if (!flushing) void flushProgress();
    },
    cancel() {
      return change(record, (db, current) =>
        current.status === 'pending' && current.phase !== 'saving'
          ? write(
              db,
              {
                ...current,
                status: 'cancelled',
                generation: current.generation + 1,
              },
              current,
            )
          : Promise.resolve(null),
      );
    },
    async interrupt() {
      try {
        return await pending({ status: 'interrupted' });
      } catch {
        throw new DownloadRecoveryError('DOWNLOAD_INTERRUPTION');
      }
    },
    fail(code: z.infer<typeof errorCode> = 'DOWNLOAD_FAILED') {
      return pending({ status: 'failed', errorCode: code });
    },
    finish() {
      return change(record, async (db, current) => {
        if (current.status === 'pending' && !current.publication)
          await remove(db, current);
        return null;
      });
    },
  };
}

export type DownloadAttempt = ReturnType<typeof attemptFor>;
