import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';

const databaseName = 'drop-downloads.sqlite';
const schemaVersion = 1;
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
    await transaction(db, async () => {
      const version = await db.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version',
      );
      if (version?.user_version === schemaVersion) return;
      if (version?.user_version !== 0)
        throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
      await db.execAsync(`
        CREATE TABLE download_attempt (
          slot INTEGER PRIMARY KEY CHECK (slot = 1),
          id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK (generation > 0),
          payload TEXT NOT NULL
        );
        PRAGMA user_version = ${schemaVersion};
      `);
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
    return record?.id === row.id && record.generation === row.generation
      ? record
      : null;
  } catch {
    return null;
  }
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
  if (result.changes !== 1) throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
  return checked;
}

async function remove(db: SQLiteDatabase, record: Identity) {
  const result = await db.runAsync(
    'DELETE FROM download_attempt WHERE slot = 1 AND id = ? AND generation = ?',
    record.id,
    record.generation,
  );
  if (result.changes !== 1) throw new DownloadRecoveryError('DOWNLOAD_STORAGE');
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
    write(db, { ...current, ...update } as DownloadRecord, current),
  );
}

export function discardRecoveredDownload(record: DownloadRecord) {
  return change(record, async (db, current) => {
    await remove(db, current);
    return current;
  });
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
        if (current.status === 'pending') await remove(db, current);
        return null;
      });
    },
  };
}

export type DownloadAttempt = ReturnType<typeof attemptFor>;
