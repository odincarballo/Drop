import { useEffect, useRef, useState } from 'react';

import { config } from '@/config';
import type { DownloadJob, MediaAnalysis } from '@/models/media';
import {
  isSelectionComplete,
  selectedFormatId,
  type DownloadSelection,
} from '@/models/selection';
import { ApiError, jobError } from '@/services/errors';
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
    if (media.source !== 'direct') {
      setState({
        status: 'error',
        message: 'Los datos simulados no contienen un archivo descargable.',
      });
      return;
    }
    const formatId = selectedFormatId(selection, media);
    if (!isSelectionComplete(selection, media) || !formatId) return;

    active.current = true;
    const currentOperation = ++operation.current;
    const requestController = new AbortController();
    controller.current = requestController;
    setState({ status: 'creating' });
    try {
      let job = await createDownloadJob(
        {
          mediaId: media.id,
          downloadType: selection.type,
          formatId,
        },
        requestController.signal,
      );
      jobId.current = job.id;
      while (job.status === 'PENDING' || job.status === 'DOWNLOADING') {
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
      localUri.current = file.uri;
      jobId.current = null;
      void deleteDownloadJob(job.id).catch(() => undefined);
      if (mounted.current && operation.current === currentOperation) {
        setState({
          status: 'completed',
          job,
          localUri: file.uri,
          localSize: file.size,
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
              : 'No se pudo completar la descarga. Inténtalo de nuevo.',
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
      await shareLocalFile(state.localUri);
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

  const isActive = ['creating', 'downloading', 'transferring'].includes(
    state.status,
  );
  return { state, isActive, start, cancel, share, reset };
}
