import { useEffect, useRef, useState } from 'react';

import { config } from '@/config';
import type { DownloadJob, MediaAnalysis } from '@/models/media';
import {
  selectedDownloadRequest,
  type DownloadSelection,
} from '@/models/selection';
import { ApiError, jobError } from '@/services/errors';
import { withNamedLibraryFile } from '@/services/fileExport';
import { promoteToLibrary, withLibraryLease } from '@/services/library';
import {
  createDownloadJob,
  deleteDownloadJob,
  deleteLocalFile,
  downloadJobFile,
  getDownloadJob,
  shareLocalFile,
} from '@/services/jobs';

export type DownloadState =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'downloading'; job: DownloadJob }
  | { status: 'saving'; job: DownloadJob }
  | {
      status: 'transferring';
      job: DownloadJob;
      bytesDownloaded: number;
      totalBytes: number | null;
    }
  | {
      status: 'completed';
      job: DownloadJob;
      localUri: string;
      localSize: number;
      libraryId: string;
      actionError: string | null;
    }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export function useMediaDownload() {
  const [state, setState] = useState<DownloadState>({ status: 'idle' });
  const mounted = useRef(true);
  const active = useRef(false);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const localUri = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (jobId.current)
        void deleteDownloadJob(jobId.current).catch(() => undefined);
    };
  }, []);

  async function start(media: MediaAnalysis, selection: DownloadSelection) {
    if (active.current) return;
    if (media.source !== 'direct' && media.source !== 'youtube') {
      setState({
        status: 'error',
        message: 'Los datos simulados no contienen un archivo descargable.',
      });
      return;
    }
    const downloadRequest = selectedDownloadRequest(media, selection);
    if (!downloadRequest) return;

    active.current = true;
    const currentOperation = ++operation.current;
    const requestController = new AbortController();
    controller.current = requestController;
    setState({ status: 'creating' });
    try {
      let job = await createDownloadJob(
        downloadRequest,
        requestController.signal,
      );
      jobId.current = job.id;
      while (
        job.status === 'PENDING' ||
        job.status === 'PREPARING' ||
        job.status === 'DOWNLOADING' ||
        job.status === 'PROCESSING'
      ) {
        if (mounted.current && operation.current === currentOperation) {
          setState({ status: 'downloading', job });
        }
        await pause(config.jobPollIntervalMs, requestController.signal);
        if (requestController.signal.aborted) return;
        job = await getDownloadJob(job.id, requestController.signal);
      }
      if (job.status === 'FAILED') throw jobError(job.error?.code);
      if (job.status === 'CANCELLED') {
        if (mounted.current) setState({ status: 'cancelled' });
        return;
      }
      if (job.status !== 'COMPLETED') throw jobError('DOWNLOAD_FAILED');

      if (mounted.current && operation.current === currentOperation) {
        setState({
          status: 'transferring',
          job,
          bytesDownloaded: 0,
          totalBytes: job.fileSize,
        });
      }
      const file = await downloadJobFile(
        job,
        requestController.signal,
        (bytesDownloaded, totalBytes) => {
          if (mounted.current && operation.current === currentOperation) {
            setState({
              status: 'transferring',
              job,
              bytesDownloaded,
              totalBytes,
            });
          }
        },
      );
      if (
        requestController.signal.aborted ||
        operation.current !== currentOperation ||
        !mounted.current
      ) {
        deleteLocalFile(file.uri);
        return;
      }
      if (mounted.current && operation.current === currentOperation)
        setState({ status: 'saving', job });
      const video =
        'videoIndex' in selection && selection.videoIndex !== null
          ? media.videoFormats[selection.videoIndex]
          : null;
      const audio =
        'audioIndex' in selection && selection.audioIndex !== null
          ? media.audioFormats[selection.audioIndex]
          : null;
      const saved = await promoteToLibrary(file.uri, {
        sourceKind: 'direct',
        title: media.title ?? job.fileName ?? 'Archivo de Drop',
        mediaType: selection.type === 'AUDIO_ONLY' ? 'audio' : 'video',
        durationSeconds: media.duration,
        resolution: video?.resolution,
        height: video?.height,
        fps: video?.fps,
        videoCodec: video?.codec,
        audioCodec: audio?.codec,
        container:
          selection.type === 'AUDIO_ONLY' ? audio?.container : video?.container,
      });
      // The source was moved. A visual reset must never delete Library media.
      localUri.current = null;
      jobId.current = null;
      void deleteDownloadJob(job.id).catch(() => undefined);
      if (mounted.current && operation.current === currentOperation) {
        setState({
          status: 'completed',
          job,
          localUri: saved.uri,
          localSize: saved.sizeBytes,
          libraryId: saved.id,
          actionError: null,
        });
      }
    } catch (error) {
      if (jobId.current) {
        void deleteDownloadJob(jobId.current).catch(() => undefined);
        jobId.current = null;
      }
      if (
        mounted.current &&
        operation.current === currentOperation &&
        !requestController.signal.aborted
      ) {
        setState({
          status: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? `No se pudo guardar en Biblioteca: ${error.message}`
                : 'No se pudo guardar en Biblioteca. Inténtalo de nuevo.',
        });
      }
    } finally {
      if (operation.current === currentOperation) {
        active.current = false;
        controller.current = null;
      }
    }
  }

  async function cancel() {
    if (!active.current) return;
    ++operation.current;
    controller.current?.abort();
    const currentJobId = jobId.current;
    jobId.current = null;
    active.current = false;
    if (currentJobId) {
      await deleteDownloadJob(currentJobId).catch(() => undefined);
    }
    if (mounted.current) setState({ status: 'cancelled' });
  }

  async function share() {
    if (state.status !== 'completed') return;
    try {
      await withLibraryLease(state.libraryId, (item) =>
        withNamedLibraryFile(item, shareLocalFile),
      );
    } catch (error) {
      if (mounted.current) {
        setState({
          ...state,
          actionError:
            error instanceof ApiError
              ? error.message
              : 'No se pudo abrir la hoja de compartir.',
        });
      }
    }
  }

  function reset() {
    ++operation.current;
    controller.current?.abort();
    controller.current = null;
    active.current = false;
    if (jobId.current)
      void deleteDownloadJob(jobId.current).catch(() => undefined);
    jobId.current = null;
    if (localUri.current) deleteLocalFile(localUri.current);
    localUri.current = null;
    setState({ status: 'idle' });
  }

  const isActive = [
    'creating',
    'downloading',
    'transferring',
    'saving',
  ].includes(state.status);
  return { state, isActive, start, cancel, share, reset };
}
