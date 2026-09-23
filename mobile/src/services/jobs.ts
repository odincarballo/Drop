import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  jobSchema,
  type DownloadJob,
  type DownloadRequest,
} from '@/models/media';
import { apiClient, apiUrl } from './api';
import { ApiError } from './errors';
import { getApiToken } from './token';

export function createDownloadJob(
  request: DownloadRequest,
  signal?: AbortSignal,
): Promise<DownloadJob> {
  return apiClient.request('/jobs', {
    method: 'POST',
    body: request,
    signal,
    schema: jobSchema,
  });
}

export function getDownloadJob(
  id: string,
  signal?: AbortSignal,
): Promise<DownloadJob> {
  return apiClient.request(`/jobs/${encodeURIComponent(id)}`, {
    signal,
    schema: jobSchema,
  });
}

export function deleteDownloadJob(id: string): Promise<DownloadJob> {
  return apiClient.request(`/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: jobSchema,
  });
}

function safeLocalName(job: DownloadJob): string {
  const source = (job.fileName ?? 'media').replace(/[\\/:*?"<>|%]/g, '_');
  const fileName = source.replace(/^\.+/, '').slice(-120) || 'media';
  return `mediadrop-${job.id}-${fileName}`;
}

export async function downloadJobFile(
  job: DownloadJob,
  signal: AbortSignal,
  onProgress: (bytes: number, total: number | null) => void,
): Promise<{ uri: string; size: number }> {
  if (!job.downloadUrl) {
    throw new ApiError(
      'FILE_UNAVAILABLE',
      'El archivo todavía no está disponible.',
    );
  }
  const destination = new File(Paths.cache, safeLocalName(job));
  if (destination.exists) destination.delete();
  const token = await getApiToken();
  if (!token) {
    throw new ApiError(
      'AUTH_REQUIRED',
      'Configura el token de acceso de Drop.',
    );
  }
  const task = File.createDownloadTask(apiUrl(job.downloadUrl), destination, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    sessionType: 'foreground',
    onProgress: ({ bytesWritten, totalBytes }) =>
      onProgress(bytesWritten, totalBytes >= 0 ? totalBytes : null),
  });
  try {
    const file = await task.downloadAsync();
    if (!file) {
      throw new ApiError(
        'TRANSFER_FAILED',
        'No se pudo guardar el archivo en el iPhone.',
      );
    }
    return { uri: file.uri, size: file.size };
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(
      'TRANSFER_FAILED',
      'No se pudo transferir el archivo al iPhone. Revisa el espacio disponible y la conexión.',
    );
  } finally {
    task.release();
  }
}

export async function shareLocalFile(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new ApiError(
      'SHARING_UNAVAILABLE',
      'La hoja de compartir no está disponible en este dispositivo.',
    );
  }
  await withLocalFileLease(uri, () =>
    Sharing.shareAsync(uri, { dialogTitle: 'Compartir archivo de Drop' }),
  );
}

const activeFileUses = new Map<string, number>();
const pendingRemoval = new Set<string>();

function removeLocalFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function withLocalFileLease<T>(
  uri: string,
  operation: () => Promise<T>,
): Promise<T> {
  activeFileUses.set(uri, (activeFileUses.get(uri) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    const remaining = (activeFileUses.get(uri) ?? 1) - 1;
    if (remaining > 0) activeFileUses.set(uri, remaining);
    else {
      activeFileUses.delete(uri);
      if (pendingRemoval.delete(uri)) {
        try {
          removeLocalFile(uri);
        } catch {
          // Cleanup must not turn a completed export into an error.
        }
      }
    }
  }
}

export function deleteLocalFile(uri: string): void {
  if (activeFileUses.has(uri)) {
    pendingRemoval.add(uri);
    return;
  }
  removeLocalFile(uri);
}
