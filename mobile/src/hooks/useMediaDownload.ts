import { useEffect, useRef, useState } from 'react';

import { config } from '@/config';
import type { DownloadJob, MediaAnalysis } from '@/models/media';
import {
  selectedDownloadRequest,
  type DownloadSelection,
} from '@/models/selection';
import type { LibraryMetadata } from '@/models/library';
import { inDownloadForeground } from '@/hooks/useDownloadForeground';
import {
  saveCompletedPartial,
  saveTransferredDownload,
} from '@/services/downloadPublication';
import {
  DownloadRecoveryError,
  finishDownloadPartialCleanup,
  readDownloadRecord,
  rememberDownload,
  reserveDownloadPartial,
  type DownloadAttempt,
  type DownloadPartialCheckpoint,
  type DownloadRecord,
} from '@/services/downloadRecovery';
import {
  resumableResource,
  transferDownloadPartial,
} from '@/services/downloadResumption';
import {
  ApiError,
  DownloadStartInterrupted,
  jobError,
} from '@/services/errors';
import { withNamedLibraryFile } from '@/services/fileExport';
import { withLibraryLease } from '@/services/library';
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

export function useMediaDownload(
  foregroundGeneration: () => number | null,
  canStart: () => boolean,
  onInterrupted: (record: DownloadRecord, message?: string) => void,
) {
  const [state, setState] = useState<DownloadState>({ status: 'idle' });
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const attempt = useRef<Promise<DownloadAttempt> | null>(null);
  const committing = useRef(false);
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
    };
  }, []);

  async function start(
    media: MediaAnalysis,
    selection: DownloadSelection,
    conventional = false,
  ) {
    if (active.current || !canStart()) return;
    const foreground = foregroundGeneration();
    if (foreground === null) return;
    const isStillForeground = () => foregroundGeneration() === foreground;
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
    jobId.current = null;
    const currentOperation = ++operation.current;
    const requestController = new AbortController();
    controller.current = requestController;
    setState({ status: 'creating' });
    setPersistenceError(null);
    const recorded = rememberDownload({
      source: 'direct',
      selection: { mode: selection.type },
    });
    attempt.current = recorded;
    let journal: DownloadAttempt | undefined;
    let checkpoint: DownloadPartialCheckpoint | null = null;
    const isCurrent = () =>
      mounted.current &&
      operation.current === currentOperation &&
      !requestController.signal.aborted;
    try {
      journal = await recorded;
      if (!isCurrent()) return;
      const ownsReservation = await journal.ownsReservation();
      if (!isCurrent()) return;
      if (!ownsReservation) {
        setState({ status: 'idle' });
        return;
      }
      let job: DownloadJob;
      try {
        if (!isStillForeground()) throw new DownloadStartInterrupted();
        job = await createDownloadJob(
          downloadRequest,
          requestController.signal,
          isStillForeground,
        );
      } catch (error) {
        if (!(error instanceof DownloadStartInterrupted)) throw error;
        if (!isCurrent()) return;
        const interrupted = await journal.interrupt();
        if (isCurrent()) {
          setState({ status: 'idle' });
          if (interrupted) onInterrupted(interrupted);
        }
        return;
      }
      // A cancelled creation may still resolve. Never adopt it into a new
      // session or start its transfer, even if the transport ignored abort.
      if (!isCurrent()) {
        void deleteDownloadJob(job.id).catch(() => undefined);
        return;
      }
      jobId.current = job.id;
      const accepted = await journal.update(
        'downloading',
        job.bytesDownloaded,
        job.id,
      );
      if (!accepted || !isCurrent()) return;
      while (
        job.status === 'PENDING' ||
        job.status === 'PREPARING' ||
        job.status === 'DOWNLOADING' ||
        job.status === 'PROCESSING'
      ) {
        journal.observe(
          job.status === 'PROCESSING' ? 'processing' : 'downloading',
          job.bytesDownloaded,
        );
        setState({ status: 'downloading', job });
        await pause(config.jobPollIntervalMs, requestController.signal);
        if (requestController.signal.aborted) return;
        job = await getDownloadJob(job.id, requestController.signal);
        if (!isCurrent()) return;
        if (job.id !== jobId.current) throw jobError('DOWNLOAD_FAILED');
      }
      if (job.status === 'FAILED') throw jobError(job.error?.code);
      if (job.status === 'CANCELLED') {
        await journal.cancel();
        if (isCurrent()) setState({ status: 'cancelled' });
        return;
      }
      if (job.status !== 'COMPLETED') throw jobError('DOWNLOAD_FAILED');

      if (!(await journal.update('transferring')) || !isCurrent()) return;
      setState({
        status: 'transferring',
        job,
        bytesDownloaded: 0,
        totalBytes: job.fileSize,
      });
      function progress(bytesDownloaded: number, totalBytes: number | null) {
        if (isCurrent() && !committing.current) {
          journal?.observe('transferring', bytesDownloaded);
          setState({
            status: 'transferring',
            job,
            bytesDownloaded,
            totalBytes,
          });
        }
      }
      const resource = conventional ? null : resumableResource(job);
      if (resource) {
        const owner = await readDownloadRecord();
        if (!isCurrent()) return;
        if (owner?.source === 'direct' && owner.remoteJobId === job.id)
          checkpoint = await reserveDownloadPartial(owner, resource).catch(
            () => null,
          );
      }
      if (!isCurrent()) return;
      let file: Awaited<ReturnType<typeof downloadJobFile>> | null = null;
      if (checkpoint) {
        const reserved = checkpoint;
        checkpoint = await inDownloadForeground(
          requestController.signal,
          isStillForeground,
          (signal) => transferDownloadPartial(job, reserved, signal, progress),
        );
        if (!isStillForeground()) throw new DownloadStartInterrupted();
      } else {
        file = await downloadJobFile(job, requestController.signal, progress);
      }
      if (!isCurrent()) {
        if (file) deleteLocalFile(file.uri);
        return;
      }
      if (!job.fileSize || (file && file.size !== job.fileSize)) {
        if (file) deleteLocalFile(file.uri);
        throw new ApiError(
          'INCOMPLETE_DOWNLOAD',
          'No se pudo verificar el tamaño del archivo terminado.',
        );
      }
      committing.current = true;
      setState({ status: 'saving', job });
      const video =
        'videoIndex' in selection && selection.videoIndex !== null
          ? media.videoFormats[selection.videoIndex]
          : null;
      const audio =
        'audioIndex' in selection && selection.audioIndex !== null
          ? media.audioFormats[selection.audioIndex]
          : null;
      const metadata: LibraryMetadata = {
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
      };
      const result = file
        ? await saveTransferredDownload(
            journal,
            { uri: file.uri, owner: job.id, sizeBytes: job.fileSize },
            metadata,
          )
        : checkpoint && (await saveCompletedPartial(checkpoint, metadata));
      if (!result?.item) {
        if (isCurrent()) {
          setState({ status: 'idle' });
          if (result?.record) onInterrupted(result.record);
        }
        return;
      }
      const saved = result.item;
      // The source was moved. A visual reset must never delete Library media.
      localUri.current = null;
      if (operation.current === currentOperation) jobId.current = null;
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
      if (isCurrent()) {
        if (checkpoint) {
          const expired =
            error instanceof ApiError &&
            ['JOB_NOT_FOUND', 'FILE_EXPIRED'].includes(error.code);
          await (
            expired ? journal?.fail('REMOTE_EXPIRED') : journal?.interrupt()
          )?.catch(() => undefined);
          const recovered = await readDownloadRecord().catch(() => null);
          if (
            isCurrent() &&
            recovered?.id === checkpoint.id &&
            recovered.generation === checkpoint.generation
          ) {
            jobId.current = null;
            setState({ status: 'idle' });
            onInterrupted(
              recovered,
              error instanceof ApiError ? error.message : undefined,
            );
            return;
          }
        }
        const failedJob = jobId.current;
        jobId.current = null;
        if (failedJob && !committing.current && !checkpoint)
          void deleteDownloadJob(failedJob).catch(() => undefined);
        if (!(
          error instanceof DownloadRecoveryError &&
          error.code === 'DOWNLOAD_INTERRUPTION'
        ))
          await journal
            ?.fail(
              error instanceof ApiError &&
                ['JOB_NOT_FOUND', 'FILE_EXPIRED'].includes(error.code)
                ? 'REMOTE_EXPIRED'
                : 'DOWNLOAD_FAILED',
            )
            .catch(() => undefined);
      }
      if (
        mounted.current &&
        operation.current === currentOperation &&
        !requestController.signal.aborted
      ) {
        setState({
          status: 'error',
          message:
            error instanceof ApiError || error instanceof DownloadRecoveryError
              ? error.message
              : !journal
                ? 'No se pudo guardar el estado de la descarga. Inténtalo de nuevo.'
                : 'No se pudo guardar en Biblioteca. Inténtalo de nuevo.',
        });
      }
    } finally {
      if (operation.current === currentOperation) {
        active.current = false;
        controller.current = null;
        attempt.current = null;
        committing.current = false;
      }
    }
  }

  async function cancel() {
    if (!active.current || !attempt.current || committing.current) return;
    const currentOperation = operation.current;
    const recorded = attempt.current;
    try {
      const journal = await recorded;
      if (!(await journal.cancel()) || operation.current !== currentOperation)
        return;
    } catch {
      if (mounted.current && operation.current === currentOperation)
        setPersistenceError(
          'No se pudo registrar la cancelación. Inténtalo de nuevo.',
        );
      return;
    }
    setPersistenceError(null);
    attempt.current = null;
    const cancellation = ++operation.current;
    controller.current?.abort();
    const currentJobId = jobId.current;
    jobId.current = null;
    active.current = false;
    void finishDownloadPartialCleanup().catch(() => undefined);
    if (currentJobId) {
      await deleteDownloadJob(currentJobId).catch(() => undefined);
    }
    if (mounted.current && operation.current === cancellation)
      setState({ status: 'cancelled' });
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
    if (active.current) return;
    ++operation.current;
    setPersistenceError(null);
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
  return {
    state,
    isActive,
    hasActiveOperation: () => active.current,
    start,
    cancel,
    share,
    reset,
    persistenceError,
  };
}
