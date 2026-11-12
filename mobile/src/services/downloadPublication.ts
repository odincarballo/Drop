import type { LibraryMetadata } from '@/models/library';
import {
  beginDownloadDiscard,
  completedDownloadAssetSchema,
  finishDownloadPublication,
  readDownloadRecord,
  recordCompletedAsset,
  type DownloadAttempt,
  type DownloadRecord,
} from '@/services/downloadRecovery';
import {
  discardDownloadAsset,
  findDownloadAsset,
  publishDownloadAsset,
  stageDownloadAsset,
} from '@/services/library';

type TransferredFile = { uri: string; owner: string; sizeBytes: number };

let operations: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}

function stagingKey(record: DownloadRecord) {
  return record.id + '.' + record.generation;
}

async function currentPublication(record: DownloadRecord) {
  const current = await readDownloadRecord();
  return current?.publication &&
    current.id === record.id &&
    current.generation === record.generation
    ? current
    : null;
}

async function publish(record: DownloadRecord, metadata: LibraryMetadata) {
  const key = stagingKey(record);
  const asset =
    record.publication?.asset ??
    completedDownloadAssetSchema.parse(
      await findDownloadAsset(key, record.bytes),
    );
  const sealed = await recordCompletedAsset(record, asset);
  if (!sealed) return null;
  const item = await publishDownloadAsset(key, asset, metadata);
  await finishDownloadPublication(sealed);
  return item;
}

export function saveTransferredDownload(
  attempt: DownloadAttempt,
  file: TransferredFile,
  metadata: LibraryMetadata,
) {
  return serialized(async () => {
    const record = await attempt.beginPublication(file.sizeBytes, file.owner);
    if (!record) return null;
    try {
      const asset = completedDownloadAssetSchema.parse(
        await stageDownloadAsset(stagingKey(record), file, metadata),
      );
      const item = await publish(
        { ...record, publication: { asset } },
        metadata,
      );
      return item ? { item } : null;
    } catch {
      // The durable stage or pending/ready Library row remains available.
      // Only return the committed attempt, never a path or native exception.
      const current = await currentPublication(record);
      return current ? { record: current } : null;
    }
  });
}

export function recoverTransferredDownload(record: DownloadRecord) {
  return serialized(async () => {
    const current = await currentPublication(record);
    if (!current || current.publication?.discarding) return null;
    const audio = current.selection.mode === 'AUDIO_ONLY';
    return publish(current, {
      sourceKind: current.source,
      mediaType: audio ? 'audio' : 'video',
      title: audio ? 'Audio recuperado' : 'Video recuperado',
      sourceVideoId:
        current.source === 'youtube' ? current.selection.videoId : null,
    });
  });
}

export function discardTransferredDownload(record: DownloadRecord) {
  return serialized(async () => {
    const current = await currentPublication(record);
    if (!current) return null;
    const key = stagingKey(current);
    const discovered =
      !current.publication?.discarding && !current.publication?.asset
        ? await findDownloadAsset(key, current.bytes)
        : null;
    const intent = await beginDownloadDiscard(
      current,
      discovered == null
        ? undefined
        : completedDownloadAssetSchema.parse(discovered),
    );
    if (!intent) return null;
    if (intent.publication?.asset)
      await discardDownloadAsset(key, intent.publication.asset);
    return finishDownloadPublication(intent);
  });
}
