import { fetch as fetchStream } from 'expo/fetch';

import { config } from '@/config';
import type { DownloadJob } from '@/models/media';
import {
  appendDownloadPartial,
  maxPartialBytes,
  maxPartialChunkBytes,
  prepareCompletedPartial,
  type CompletedDownloadAsset,
  type DownloadPartialCheckpoint,
  type DownloadPartialResource,
} from './downloadRecovery';
import { apiUrl } from './api';
import { ApiError } from './errors';
import { getApiToken } from './token';

const mediaExtensions = {
  'video/mp4': 'mp4',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
} as const;

function serverExtension(type: string | null | undefined) {
  if (!type || !Object.hasOwn(mediaExtensions, type)) return null;
  return mediaExtensions[type as keyof typeof mediaExtensions];
}

export function resumableResource(
  job: DownloadJob,
): DownloadPartialResource | null {
  const { id, fileSize, fileSha256, fileContentType } = job;
  if (
    job.status !== 'COMPLETED' ||
    !/^[a-f0-9]{32}$/.test(id) ||
    job.downloadUrl !== `/jobs/${id}/file` ||
    !fileSize ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 1 ||
    fileSize > maxPartialBytes ||
    !fileSha256 ||
    !/^[a-f0-9]{64}$/.test(fileSha256) ||
    !serverExtension(fileContentType)
  )
    return null;
  return {
    remoteJobId: id,
    totalBytes: fileSize,
    sha256: fileSha256,
    etag: `"sha256-${fileSha256}"`,
  };
}

function partialPublicationAsset(
  checkpoint: DownloadPartialCheckpoint,
  ext: CompletedDownloadAsset['ext'],
): CompletedDownloadAsset {
  const { remoteJobId: id, sha256, totalBytes } = checkpoint;
  // A backend job has one final resource and retains its UUID for the entire handoff.
  const uuid = [
    id.slice(0, 8),
    id.slice(8, 12),
    id.slice(12, 16),
    id.slice(16, 20),
    id.slice(20),
  ].join('-');
  return { id: uuid, ext, sizeBytes: totalBytes, sha256 };
}

function incompatible() {
  return new ApiError(
    'RESUME_INCOMPATIBLE',
    'El servidor no confirmó los bytes pendientes. Puedes reintentar desde cero.',
  );
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted)
    throw new ApiError('CANCELLED', 'Se interrumpió la transferencia.');
}

async function readWindow(
  url: string,
  token: string,
  checkpoint: DownloadPartialCheckpoint,
  contentType: string,
  signal: AbortSignal,
) {
  checkAbort(signal);
  const start = checkpoint.confirmedBytes;
  const count = Math.min(maxPartialChunkBytes, checkpoint.totalBytes - start);
  const end = start + count - 1;
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, config.apiTimeoutMs);
  try {
    const response = await fetchStream(url, {
      method: 'GET',
      redirect: 'error',
      signal: request.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=${start}-${end}`,
        'If-Range': checkpoint.etag,
        'Accept-Encoding': 'identity',
      },
    });
    if (response.status === 404 || response.status === 410)
      throw new ApiError(
        'FILE_EXPIRED',
        'El servidor ya no conserva esta descarga.',
      );
    const coding = response.headers.get('content-encoding')?.toLowerCase();
    if (
      response.status !== 206 ||
      response.headers.get('etag') !== checkpoint.etag ||
      response.headers.get('content-range') !==
        `bytes ${start}-${end}/${checkpoint.totalBytes}` ||
      response.headers.get('content-length') !== String(count) ||
      response.headers.get('content-type') !== contentType ||
      (coding && coding !== 'identity') ||
      !response.body
    )
      throw incompatible();
    const body = response.body.getReader();
    try {
      const bytes = new Uint8Array(count);
      let written = 0;
      for (;;) {
        const next = await body.read();
        if (next.done) break;
        if (next.value.length > count - written) throw incompatible();
        bytes.set(next.value, written);
        written += next.value.length;
      }
      if (written !== count) throw incompatible();
      return bytes;
    } finally {
      body.releaseLock();
    }
  } finally {
    // Abort incompatible responses without consuming an unbounded full body.
    abort();
    signal.removeEventListener('abort', abort);
    clearTimeout(timeout);
  }
}

export async function transferDownloadPartial(
  job: DownloadJob,
  checkpoint: DownloadPartialCheckpoint,
  signal: AbortSignal,
  onProgress?: (
    bytes: number,
    total: number,
    checkpoint: DownloadPartialCheckpoint,
  ) => void,
) {
  const resource = resumableResource(job);
  if (
    !resource ||
    resource.remoteJobId !== checkpoint.remoteJobId ||
    resource.totalBytes !== checkpoint.totalBytes ||
    resource.sha256 !== checkpoint.sha256 ||
    resource.etag !== checkpoint.etag
  )
    throw incompatible();
  checkAbort(signal);
  const ext = serverExtension(job.fileContentType)!;
  if (checkpoint.confirmedBytes === checkpoint.totalBytes) {
    const ready = await prepareCompletedPartial(
      checkpoint,
      partialPublicationAsset(checkpoint, ext),
    );
    if (!ready) throw incompatible();
    checkAbort(signal);
    return ready;
  }
  const token = await getApiToken();
  if (!token)
    throw new ApiError(
      'AUTH_REQUIRED',
      'Configura el token de acceso de Drop.',
    );
  const url = apiUrl(`/jobs/${resource.remoteJobId}/file`);
  while (checkpoint.confirmedBytes < checkpoint.totalBytes) {
    const bytes = await readWindow(
      url,
      token,
      checkpoint,
      job.fileContentType!,
      signal,
    );
    checkAbort(signal);
    const last =
      checkpoint.confirmedBytes + bytes.byteLength === checkpoint.totalBytes;
    const confirmed = await appendDownloadPartial(
      checkpoint,
      bytes,
      last ? partialPublicationAsset(checkpoint, ext) : undefined,
    );
    checkAbort(signal);
    if (!confirmed) throw incompatible();
    checkpoint = confirmed;
    onProgress?.(confirmed.confirmedBytes, confirmed.totalBytes, confirmed);
  }
  return checkpoint;
}
