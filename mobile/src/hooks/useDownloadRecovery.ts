import { useCallback, useEffect, useRef, useState } from 'react';

import {
  discardTransferredDownload,
  recoverTransferredDownload,
} from '@/services/downloadPublication';
import {
  discardRecoveredDownload,
  readDownloadRecord,
  updateRecoveredDownload,
  type DownloadRecord,
} from '@/services/downloadRecovery';
import { ApiError } from '@/services/errors';
import { deleteDownloadJob, getDownloadJob } from '@/services/jobs';

export function useDownloadRecovery() {
  const [record, setRecord] = useState<DownloadRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);

  const run = useCallback(
    async (task: (signal: AbortSignal) => Promise<void>) => {
      if (operation.current) return;
      const controller = new AbortController();
      operation.current = controller;
      setWorking(true);
      setMessage(null);
      try {
        await task(controller.signal);
      } catch {
        if (!controller.signal.aborted)
          setMessage(
            'No se pudo consultar o actualizar el estado. Inténtalo de nuevo.',
          );
      } finally {
        if (operation.current === controller) {
          operation.current = null;
          setWorking(false);
        }
      }
    },
    [],
  );

  const load = useCallback(() => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    void readDownloadRecord()
      .then((restored) => {
        if (controller.signal.aborted) return;
        setRecord(restored);
        setLoaded(true);
        setMessage(null);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage(
            'No se pudo leer el estado de descargas. Inténtalo de nuevo.',
          );
      })
      .finally(() => {
        if (operation.current === controller) operation.current = null;
      });
  }, []);

  useEffect(() => {
    void load();
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [load]);

  function query() {
    if (
      !record?.remoteJobId ||
      record.publication ||
      record.status === 'cancelled' ||
      record.errorCode === 'REMOTE_EXPIRED'
    )
      return;
    const id = record.remoteJobId;
    return run(async (signal) => {
      let update: Parameters<typeof updateRecoveredDownload>[1];
      try {
        const job = await getDownloadJob(id, signal);
        if (job.id !== id) throw new Error('Unexpected job ID');
        if (job.status === 'CANCELLED') update = { status: 'cancelled' };
        else if (job.status === 'FAILED')
          update = { status: 'failed', errorCode: 'DOWNLOAD_FAILED' };
        else if (job.status === 'COMPLETED')
          update = { status: 'remote-ready', errorCode: null };
        else
          update = {
            status: 'interrupted',
            errorCode: null,
          };
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          !['JOB_NOT_FOUND', 'FILE_EXPIRED'].includes(error.code)
        )
          throw error;
        update = { status: 'failed', errorCode: 'REMOTE_EXPIRED' };
      }
      if (signal.aborted) return;
      const saved = await updateRecoveredDownload(record, update);
      if (!signal.aborted) {
        setRecord(saved);
        if (saved?.status === 'interrupted')
          setMessage('El servidor sigue preparando la descarga.');
      }
    });
  }

  function saveCompleted() {
    if (!record?.publication || record.publication.discarding) return;
    return run(async (signal) => {
      try {
        const item = await recoverTransferredDownload(record);
        if (item && record.remoteJobId)
          void deleteDownloadJob(record.remoteJobId).catch(() => undefined);
        if (signal.aborted) return;
        const latest = await readDownloadRecord();
        if (!signal.aborted) {
          setRecord(latest);
          if (item) setMessage('Archivo guardado en Biblioteca.');
        }
      } catch {
        if (!signal.aborted)
          setMessage(
            'No se pudo verificar o guardar el archivo. Inténtalo de nuevo.',
          );
      }
    });
  }

  function dismiss(retry?: (record: DownloadRecord) => void) {
    if (!record) return;
    return run(async (signal) => {
      // Cancel only the job owned by this record. Removing the record first keeps
      // an interrupted network cleanup from making it resumable on next launch.
      let discarded: DownloadRecord | null;
      try {
        discarded = await (record.publication
          ? discardTransferredDownload(record)
          : discardRecoveredDownload(record));
      } catch {
        try {
          const latest = await readDownloadRecord();
          if (!signal.aborted) setRecord(latest);
        } catch {
          if (!signal.aborted) {
            setRecord(null);
            setLoaded(false);
          }
        }
        throw new Error('No se pudo completar el descarte.');
      }
      if (signal.aborted) return;
      if (!discarded) {
        const latest = await readDownloadRecord();
        if (!signal.aborted) setRecord(latest);
        return;
      }
      setRecord(null);
      if (
        record.remoteJobId &&
        record.status !== 'cancelled' &&
        record.errorCode !== 'REMOTE_EXPIRED'
      )
        void deleteDownloadJob(record.remoteJobId).catch(() => undefined);
      retry?.(record);
    });
  }

  return {
    record,
    loaded,
    working,
    message,
    load,
    query,
    saveCompleted,
    dismiss,
    showInterrupted: setRecord,
  };
}
