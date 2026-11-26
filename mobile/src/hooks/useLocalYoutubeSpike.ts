import { useCallback, useEffect, useRef, useState } from 'react';

import type { DownloadType } from '@/models/media';
import type { LibraryMetadata } from '@/models/library';

import type {
  LocalAudioDownloadEvent,
  LocalCombinedDownloadEvent,
  LocalHttpTransferDiagnostics,
  LocalVideoDownloadEvent,
  LocalYoutubeResult,
  LocalYoutubeMetadata,
} from '@/models/onDeviceYoutube';
import { saveTransferredDownload } from '@/services/downloadPublication';
import {
  DownloadRecoveryError,
  rememberDownload,
  type DownloadAttempt,
  type DownloadRecord,
} from '@/services/downloadRecovery';
import { DownloadStartInterrupted } from '@/services/errors';
import { withNamedLibraryFile } from '@/services/fileExport';
import { shareLocalFile } from '@/services/jobs';
import { withLibraryLease } from '@/services/library';
import {
  analyzeYoutubeOnDevice,
  cancelLocalAudioDownload,
  cancelLocalCombinedDownload,
  cancelLocalVideoDownload,
  cancelLocalYoutube,
  hasLocalYoutubeEngine,
  localDownloadForegroundGeneration,
  localAudioError,
  localCombinedError,
  localVideoError,
  observeLocalAudioDownload,
  observeLocalCombinedDownload,
  observeLocalVideoDownload,
  startLocalAudioDownload,
  startLocalCombinedDownload,
  startLocalVideoDownload,
} from '@/services/onDeviceYoutube';
import {
  selectLocalAudioOptions,
  selectLocalVideoOptions,
} from '@/utils/onDeviceYoutubeFormats';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'result'; result: LocalYoutubeResult }
  | { status: 'error'; message: string };

export type LocalAudioState =
  | { status: 'idle' }
  | { status: 'saving'; jobId: string }
  | { status: 'preparing'; jobId: string; formatId: string }
  | {
      status: 'downloading';
      jobId: string;
      formatId: string;
      container: 'm4a';
      codec: string | null;
      bytesDownloaded: number;
      totalBytes: number | null;
      progress: number | null;
      retrying: boolean;
      retryCategory: 'connection' | 'timeout' | 'server' | null;
    }
  | {
      status: 'completed';
      jobId: string;
      formatId: string;
      container: 'm4a';
      codec: string | null;
      fileName: string;
      fileSize: number;
      localUri: string;
      libraryId: string;
      actionError: string | null;
      httpDiagnostics: LocalHttpTransferDiagnostics | null;
    }
  | { status: 'cancelled' }
  | {
      status: 'error';
      message: string;
      code: string;
      httpDiagnostics: LocalHttpTransferDiagnostics | null;
    };

export type LocalVideoState =
  | { status: 'idle' }
  | { status: 'saving'; jobId: string }
  | { status: 'preparing'; jobId: string; formatId: string }
  | {
      status: 'downloading';
      jobId: string;
      formatId: string;
      container: 'mp4';
      codec: string | null;
      height: number | null;
      bytesDownloaded: number;
      totalBytes: number | null;
      progress: number | null;
      retrying: boolean;
      retryCategory: 'connection' | 'timeout' | 'server' | null;
    }
  | {
      status: 'completed';
      jobId: string;
      formatId: string;
      container: 'mp4';
      codec: string | null;
      height: number | null;
      fileName: string;
      fileSize: number;
      localUri: string;
      libraryId: string;
      actionError: string | null;
      httpDiagnostics: LocalHttpTransferDiagnostics | null;
    }
  | { status: 'cancelled' }
  | {
      status: 'error';
      message: string;
      code: string;
      httpDiagnostics: LocalHttpTransferDiagnostics | null;
    };

export type LocalCombinedState =
  | { status: 'idle' }
  | { status: 'saving'; jobId: string }
  | { status: 'preparing'; jobId: string }
  | {
      status: 'downloading-video' | 'downloading-audio';
      jobId: string;
      bytesDownloaded: number;
      totalBytes: number | null;
      progress: number | null;
      retrying: boolean;
      retryCategory: 'connection' | 'timeout' | 'server' | null;
    }
  | { status: 'muxing'; jobId: string; progress: number | null }
  | {
      status: 'completed';
      jobId: string;
      fileName: string;
      fileSize: number;
      localUri: string;
      libraryId: string;
      durationSeconds: number;
      height: number | null;
      videoCodec: string | null;
      audioCodec: string | null;
      actionError: string | null;
      videoHttpDiagnostics: LocalHttpTransferDiagnostics | null;
      audioHttpDiagnostics: LocalHttpTransferDiagnostics | null;
    }
  | { status: 'cancelled' }
  | {
      status: 'error';
      message: string;
      code: string;
      videoHttpDiagnostics: LocalHttpTransferDiagnostics | null;
      audioHttpDiagnostics: LocalHttpTransferDiagnostics | null;
    };

type YoutubeSelection = Extract<
  DownloadRecord,
  { source: 'youtube' }
>['selection'];

async function saveLiveDownload(
  attempt: DownloadAttempt | null,
  file: { uri: string; owner: string; sizeBytes: number },
  metadata: LibraryMetadata,
  isCurrent: () => boolean,
  onInterrupted?: (record: DownloadRecord) => void,
) {
  if (!attempt || !isCurrent()) return;
  const result = await saveTransferredDownload(attempt, file, metadata);
  if (result?.record && isCurrent()) onInterrupted?.(result.record);
  return result?.item;
}

export function useLocalYoutubeSpike(
  foregroundGeneration: () => number | null,
  canStart: () => boolean = () => true,
  onInterrupted?: (record: DownloadRecord) => void,
) {
  const downloadAttempt = useRef<DownloadAttempt | null>(null);
  const recordingNative = useRef(false);
  const savingAttempt = useRef<DownloadAttempt | null>(null);
  const [recording, setRecording] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: 'idle' });
  const [audioState, setAudioState] = useState<LocalAudioState>({
    status: 'idle',
  });
  const [videoState, setVideoState] = useState<LocalVideoState>({
    status: 'idle',
  });
  const [combinedState, setCombinedState] = useState<LocalCombinedState>({
    status: 'idle',
  });
  const [selectedVideoFormatId, storeSelectedVideoFormatId] = useState<
    string | null
  >(null);
  const selectedVideoFormat = useRef<string | null>(null);
  const [selectedAudioFormatId, setSelectedAudioFormatId] = useState<
    string | null
  >(null);
  const [requestedMode, setRequestedMode] = useState<DownloadType | null>(null);
  function setSelectedVideoFormatId(value: string | null) {
    selectedVideoFormat.current = value;
    storeSelectedVideoFormatId(value);
  }
  const busy = useRef(false);
  const audioJobId = useRef<string | null>(null);
  const videoJobId = useRef<string | null>(null);
  const combinedJobId = useRef<string | null>(null);
  const analysisGeneration = useRef(0);
  const analyzedMetadata = useRef<LocalYoutubeMetadata | null>(null);
  const mounted = useRef(true);

  const interruptNative = useCallback(
    async (attempt: DownloadAttempt | null, clear: () => void) => {
      if (!attempt) return;
      try {
        const record = await attempt.interrupt();
        if (record && mounted.current && downloadAttempt.current === attempt) {
          clear();
          onInterrupted?.(record);
        }
      } catch (error) {
        if (mounted.current && downloadAttempt.current === attempt) {
          clear();
          if (error instanceof DownloadRecoveryError)
            setPersistenceError(error.message);
        }
      }
    },
    [onInterrupted],
  );

  const handleAudioEvent = useCallback(
    (event: LocalAudioDownloadEvent) => {
      if (!mounted.current) return;
      if (audioJobId.current !== event.jobId) return;
      const attempt = downloadAttempt.current;
      if (event.status === 'PREPARING') {
        attempt?.observe('preparing');
        setAudioState({
          status: 'preparing',
          jobId: event.jobId,
          formatId: event.formatId ?? '',
        });
      } else if (
        event.status === 'DOWNLOADING' ||
        event.status === 'RETRYING'
      ) {
        attempt?.observe('downloading', event.bytesDownloaded);
        setAudioState({
          status: 'downloading',
          jobId: event.jobId,
          formatId: event.formatId ?? '',
          container: 'm4a',
          codec: event.codec ?? null,
          bytesDownloaded: event.bytesDownloaded ?? 0,
          totalBytes: event.totalBytes ?? null,
          progress: event.progress ?? null,
          retrying: event.status === 'RETRYING',
          retryCategory:
            event.status === 'RETRYING' ? (event.retryCategory ?? null) : null,
        });
      } else if (
        event.status === 'COMPLETED' &&
        event.fileName &&
        event.fileSize !== undefined &&
        event.localUri
      ) {
        audioJobId.current = null;
        const metadata = analyzedMetadata.current;
        const generation = analysisGeneration.current;
        savingAttempt.current = attempt;
        setAudioState({ status: 'saving', jobId: event.jobId });
        void saveLiveDownload(
          attempt,
          {
            uri: event.localUri,
            owner: event.jobId,
            sizeBytes: event.fileSize,
          },
          {
            sourceKind: 'youtube',
            sourceVideoId: metadata?.id,
            title: metadata?.title ?? event.fileName,
            mediaType: 'audio',
            durationSeconds: metadata?.duration,
            audioCodec: event.codec,
            container: 'm4a',
            thumbnailUrl: metadata?.thumbnail,
          },
          () =>
            mounted.current &&
            analysisGeneration.current === generation &&
            downloadAttempt.current === attempt,
          onInterrupted,
        )
          .then((saved) => {
            if (!mounted.current || analysisGeneration.current !== generation)
              return;

            if (!saved) {
              setAudioState({ status: 'idle' });
              return;
            }
            setAudioState({
              status: 'completed',
              jobId: event.jobId,
              formatId: event.formatId ?? '',
              container: 'm4a',
              codec: event.codec ?? null,
              fileName: event.fileName!,
              fileSize: saved.sizeBytes,
              localUri: saved.uri,
              libraryId: saved.id,
              actionError: null,
              httpDiagnostics: event.httpDiagnostics ?? null,
            });
          })
          .catch(() => {
            void attempt?.fail().catch(() => undefined);
            if (mounted.current && analysisGeneration.current === generation)
              setAudioState({
                status: 'error',
                code: 'LIBRARY_SAVE_FAILED',
                message: 'No se pudo guardar en Biblioteca.',
                httpDiagnostics: event.httpDiagnostics ?? null,
              });
          })
          .finally(() => {
            if (savingAttempt.current === attempt) savingAttempt.current = null;
          });
      } else if (event.status === 'CANCELLED') {
        audioJobId.current = null;
        void interruptNative(attempt, () => setAudioState({ status: 'idle' }));
      } else if (event.status === 'FAILED') {
        void attempt?.fail().catch(() => undefined);
        audioJobId.current = null;
        const code = event.errorCode ?? 'AUDIO_DOWNLOAD_FAILED';
        setAudioState({
          status: 'error',
          code,
          message: localAudioError(code),
          httpDiagnostics: event.httpDiagnostics ?? null,
        });
      }
    },
    [interruptNative, onInterrupted],
  );

  const handleVideoEvent = useCallback(
    (event: LocalVideoDownloadEvent) => {
      if (!mounted.current) return;
      if (videoJobId.current !== event.jobId) return;
      const attempt = downloadAttempt.current;
      if (event.status === 'PREPARING') {
        attempt?.observe('preparing');
        setVideoState({
          status: 'preparing',
          jobId: event.jobId,
          formatId: event.formatId ?? '',
        });
      } else if (
        event.status === 'DOWNLOADING' ||
        event.status === 'RETRYING'
      ) {
        attempt?.observe('downloading', event.bytesDownloaded);
        setVideoState({
          status: 'downloading',
          jobId: event.jobId,
          formatId: event.formatId ?? '',
          container: 'mp4',
          codec: event.codec ?? null,
          height: event.height ?? null,
          bytesDownloaded: event.bytesDownloaded ?? 0,
          totalBytes: event.totalBytes ?? null,
          progress: event.progress ?? null,
          retrying: event.status === 'RETRYING',
          retryCategory:
            event.status === 'RETRYING' ? (event.retryCategory ?? null) : null,
        });
      } else if (
        event.status === 'COMPLETED' &&
        event.fileName &&
        event.fileSize !== undefined &&
        event.localUri
      ) {
        videoJobId.current = null;
        const metadata = analyzedMetadata.current;
        const generation = analysisGeneration.current;
        const format = metadata?.videoFormats.find(
          (entry) => entry.id === event.formatId,
        );
        savingAttempt.current = attempt;
        setVideoState({ status: 'saving', jobId: event.jobId });
        void saveLiveDownload(
          attempt,
          {
            uri: event.localUri,
            owner: event.jobId,
            sizeBytes: event.fileSize,
          },
          {
            sourceKind: 'youtube',
            sourceVideoId: metadata?.id,
            title: metadata?.title ?? event.fileName,
            mediaType: 'video',
            durationSeconds: metadata?.duration,
            resolution: format?.resolution,
            height: event.height,
            fps: format?.fps,
            videoCodec: event.codec,
            container: 'mp4',
            thumbnailUrl: metadata?.thumbnail,
          },
          () =>
            mounted.current &&
            analysisGeneration.current === generation &&
            downloadAttempt.current === attempt,
          onInterrupted,
        )
          .then((saved) => {
            if (!mounted.current || analysisGeneration.current !== generation)
              return;

            if (!saved) {
              setVideoState({ status: 'idle' });
              return;
            }
            setVideoState({
              status: 'completed',
              jobId: event.jobId,
              formatId: event.formatId ?? '',
              container: 'mp4',
              codec: event.codec ?? null,
              height: event.height ?? null,
              fileName: event.fileName!,
              fileSize: saved.sizeBytes,
              localUri: saved.uri,
              libraryId: saved.id,
              actionError: null,
              httpDiagnostics: event.httpDiagnostics ?? null,
            });
          })
          .catch(() => {
            void attempt?.fail().catch(() => undefined);
            if (mounted.current && analysisGeneration.current === generation)
              setVideoState({
                status: 'error',
                code: 'LIBRARY_SAVE_FAILED',
                message: 'No se pudo guardar en Biblioteca.',
                httpDiagnostics: event.httpDiagnostics ?? null,
              });
          })
          .finally(() => {
            if (savingAttempt.current === attempt) savingAttempt.current = null;
          });
      } else if (event.status === 'CANCELLED') {
        videoJobId.current = null;
        void interruptNative(attempt, () => setVideoState({ status: 'idle' }));
      } else if (event.status === 'FAILED') {
        void attempt?.fail().catch(() => undefined);
        videoJobId.current = null;
        const code = event.errorCode ?? 'VIDEO_DOWNLOAD_FAILED';
        setVideoState({
          status: 'error',
          code,
          message: localVideoError(code),
          httpDiagnostics: event.httpDiagnostics ?? null,
        });
      }
    },
    [interruptNative, onInterrupted],
  );

  const handleCombinedEvent = useCallback(
    (event: LocalCombinedDownloadEvent) => {
      if (!mounted.current) return;
      if (combinedJobId.current !== event.jobId) return;
      const attempt = downloadAttempt.current;
      if (event.status === 'PREPARING') {
        attempt?.observe('preparing');
        setCombinedState({ status: 'preparing', jobId: event.jobId });
      } else if (
        event.status === 'DOWNLOADING_VIDEO' ||
        event.status === 'DOWNLOADING_AUDIO' ||
        event.status === 'RETRYING_VIDEO' ||
        event.status === 'RETRYING_AUDIO'
      ) {
        attempt?.observe('downloading', event.bytesDownloaded);
        setCombinedState({
          status:
            event.status === 'DOWNLOADING_VIDEO' ||
            event.status === 'RETRYING_VIDEO'
              ? 'downloading-video'
              : 'downloading-audio',
          jobId: event.jobId,
          bytesDownloaded: event.bytesDownloaded ?? 0,
          totalBytes: event.totalBytes ?? null,
          progress: event.progress ?? null,
          retrying: event.status.startsWith('RETRYING'),
          retryCategory: event.status.startsWith('RETRYING')
            ? (event.retryCategory ?? null)
            : null,
        });
      } else if (event.status === 'MUXING') {
        attempt?.observe('processing');
        setCombinedState({
          status: 'muxing',
          jobId: event.jobId,
          progress: event.progress ?? null,
        });
      } else if (
        event.status === 'COMPLETED' &&
        event.fileName &&
        event.fileSize !== undefined &&
        event.localUri &&
        event.durationSeconds !== undefined
      ) {
        combinedJobId.current = null;
        const metadata = analyzedMetadata.current;
        const generation = analysisGeneration.current;
        const format = metadata?.videoFormats.find(
          (entry) => entry.id === selectedVideoFormat.current,
        );
        savingAttempt.current = attempt;
        setCombinedState({ status: 'saving', jobId: event.jobId });
        void saveLiveDownload(
          attempt,
          {
            uri: event.localUri,
            owner: event.jobId,
            sizeBytes: event.fileSize,
          },
          {
            sourceKind: 'youtube',
            sourceVideoId: metadata?.id,
            title: metadata?.title ?? event.fileName,
            mediaType: 'video',
            durationSeconds: event.durationSeconds,
            resolution: format?.resolution,
            height: event.height,
            fps: format?.fps,
            videoCodec: event.videoCodec,
            audioCodec: event.audioCodec,
            container: 'mp4',
            thumbnailUrl: metadata?.thumbnail,
          },
          () =>
            mounted.current &&
            analysisGeneration.current === generation &&
            downloadAttempt.current === attempt,
          onInterrupted,
        )
          .then((saved) => {
            if (!mounted.current || analysisGeneration.current !== generation)
              return;

            if (!saved) {
              setCombinedState({ status: 'idle' });
              return;
            }
            setCombinedState({
              status: 'completed',
              jobId: event.jobId,
              fileName: event.fileName!,
              fileSize: saved.sizeBytes,
              localUri: saved.uri,
              libraryId: saved.id,
              durationSeconds: event.durationSeconds!,
              height: event.height ?? null,
              videoCodec: event.videoCodec ?? null,
              audioCodec: event.audioCodec ?? null,
              actionError: null,
              videoHttpDiagnostics: event.videoHttpDiagnostics ?? null,
              audioHttpDiagnostics: event.audioHttpDiagnostics ?? null,
            });
          })
          .catch(() => {
            void attempt?.fail().catch(() => undefined);
            if (mounted.current && analysisGeneration.current === generation)
              setCombinedState({
                status: 'error',
                code: 'LIBRARY_SAVE_FAILED',
                message: 'No se pudo guardar en Biblioteca.',
                videoHttpDiagnostics: event.videoHttpDiagnostics ?? null,
                audioHttpDiagnostics: event.audioHttpDiagnostics ?? null,
              });
          })
          .finally(() => {
            if (savingAttempt.current === attempt) savingAttempt.current = null;
          });
      } else if (event.status === 'CANCELLED') {
        combinedJobId.current = null;
        void interruptNative(attempt, () =>
          setCombinedState({ status: 'idle' }),
        );
      } else if (event.status === 'FAILED') {
        void attempt?.fail().catch(() => undefined);
        combinedJobId.current = null;
        const code = event.errorCode ?? 'COMBINED_DOWNLOAD_FAILED';
        setCombinedState({
          status: 'error',
          code,
          message: localCombinedError(code),
          videoHttpDiagnostics: event.videoHttpDiagnostics ?? null,
          audioHttpDiagnostics: event.audioHttpDiagnostics ?? null,
        });
      }
    },
    [interruptNative, onInterrupted],
  );

  useEffect(() => {
    mounted.current = true;
    const subscription = observeLocalAudioDownload(handleAudioEvent);
    const videoSubscription = observeLocalVideoDownload(handleVideoEvent);
    const combinedSubscription =
      observeLocalCombinedDownload(handleCombinedEvent);
    return () => {
      mounted.current = false;
      if (busy.current) cancelLocalYoutube();
      if (audioJobId.current) cancelLocalAudioDownload();
      if (videoJobId.current) cancelLocalVideoDownload();
      if (combinedJobId.current) cancelLocalCombinedDownload();
      subscription.remove();
      videoSubscription.remove();
      combinedSubscription.remove();
    };
  }, [handleAudioEvent, handleCombinedEvent, handleVideoEvent]);

  async function analyze(url: string, retry?: YoutubeSelection) {
    if (busy.current) return;
    busy.current = true;
    const generation = ++analysisGeneration.current;
    analyzedMetadata.current = null;
    setAudioState({ status: 'idle' });
    setVideoState({ status: 'idle' });
    setCombinedState({ status: 'idle' });
    setSelectedVideoFormatId(null);
    setSelectedAudioFormatId(null);
    setRequestedMode(null);
    setState({ status: 'loading' });
    try {
      const result = await analyzeYoutubeOnDevice(url);
      if (mounted.current && analysisGeneration.current === generation) {
        analyzedMetadata.current = result.metadata ?? null;
        setState({ status: 'result', result });
        const options = result.metadata
          ? selectLocalVideoOptions(result.metadata.videoFormats)
          : [];
        const preferred = options.find(
          (format) => format.id === result.metadata?.preferredVideoFormatId,
        );
        const prior = options.find(
          (format) => format.id === retry?.videoFormatId,
        );
        setSelectedVideoFormatId(
          prior?.id ?? preferred?.id ?? options[0]?.id ?? null,
        );
        const audioOptions = selectLocalAudioOptions(
          result.metadata?.audioFormats ?? [],
        );
        const priorAudioId = retry?.audioFormatId;
        // A bare itag from an older analysis may now identify another language.
        const audioId =
          retry && retry.mode !== 'VIDEO_ONLY'
            ? priorAudioId?.includes('@')
              ? priorAudioId
              : null
            : result.metadata?.preferredAudioFormatId;
        setSelectedAudioFormatId(
          audioOptions.find((format) => format.id === audioId)?.id ?? null,
        );
        if (retry?.mode === 'AUDIO_ONLY') setRequestedMode(retry.mode);
      }
    } catch {
      if (mounted.current && analysisGeneration.current === generation)
        setState({
          status: 'error',
          message: hasLocalYoutubeEngine()
            ? 'No se pudo iniciar el análisis local. Revisa la URL y esta build.'
            : 'Esta versión no incluye el motor de YouTube en el iPhone. Actualiza Drop para analizar este enlace.',
        });
    } finally {
      if (analysisGeneration.current === generation) busy.current = false;
    }
  }

  function cancelAnalysis() {
    if (!busy.current) return;
    ++analysisGeneration.current;
    busy.current = false;
    cancelLocalYoutube();
    setState({ status: 'idle' });
  }

  function reset() {
    ++analysisGeneration.current;
    analyzedMetadata.current = null;
    if (busy.current) cancelLocalYoutube();
    if (audioJobId.current) cancelLocalAudioDownload();
    if (videoJobId.current) cancelLocalVideoDownload();
    if (combinedJobId.current) cancelLocalCombinedDownload();
    busy.current = false;
    audioJobId.current = null;
    videoJobId.current = null;
    combinedJobId.current = null;
    setState({ status: 'idle' });
    setAudioState({ status: 'idle' });
    setVideoState({ status: 'idle' });
    setCombinedState({ status: 'idle' });
    setSelectedVideoFormatId(null);
    setSelectedAudioFormatId(null);
    setRequestedMode(null);
  }

  const videoOptions =
    state.status === 'result' && state.result.metadata
      ? selectLocalVideoOptions(state.result.metadata.videoFormats)
      : [];
  const audioOptions = selectLocalAudioOptions(
    state.status === 'result'
      ? (state.result.metadata?.audioFormats ?? [])
      : [],
  );
  const selectedAudio = audioOptions.find(
    (format) => format.id === selectedAudioFormatId,
  );

  function selectAudioFormat(formatId: string) {
    if (
      busy.current ||
      hasActiveOperation() ||
      !audioOptions.some((format) => format.id === formatId)
    )
      return;
    setSelectedAudioFormatId(formatId);
    setAudioState({ status: 'idle' });
    setCombinedState({ status: 'idle' });
  }

  function selectVideoFormat(formatId: string) {
    if (
      busy.current ||
      audioJobId.current ||
      videoJobId.current ||
      combinedJobId.current ||
      !videoOptions.some((format) => format.id === formatId)
    )
      return;
    setSelectedVideoFormatId(formatId);
    setVideoState({ status: 'idle' });
    setCombinedState({ status: 'idle' });
  }
  function hasActiveOperation() {
    return !!(
      recordingNative.current ||
      savingAttempt.current ||
      audioJobId.current ||
      videoJobId.current ||
      combinedJobId.current
    );
  }

  async function startTracked(
    selection: YoutubeSelection,
    startNative: (generation: number) => void,
  ) {
    if (hasActiveOperation() || !canStart()) return;
    const foreground = foregroundGeneration();
    if (foreground === null) return;
    const nativeGeneration = localDownloadForegroundGeneration();
    if (nativeGeneration === null) return;
    recordingNative.current = true;
    setRecording(true);
    setPersistenceError(null);
    const generation = analysisGeneration.current;
    try {
      const attempt = await rememberDownload({ source: 'youtube', selection });
      if (!(await attempt.ownsReservation())) return;
      const isCurrent = () =>
        mounted.current && generation === analysisGeneration.current;
      if (isCurrent() && foregroundGeneration() === foreground) {
        downloadAttempt.current = attempt;
        try {
          startNative(nativeGeneration);
          return;
        } catch (error) {
          downloadAttempt.current = null;
          if (!(error instanceof DownloadStartInterrupted)) {
            void attempt.fail().catch(() => undefined);
            throw error;
          }
        }
      }
      const interrupted = await attempt.interrupt();
      if (interrupted && isCurrent()) onInterrupted?.(interrupted);
    } finally {
      recordingNative.current = false;
      if (mounted.current) setRecording(false);
    }
  }

  async function cancelTracked(
    job: { current: string | null },
    cancelNative: () => void,
    cancelled: () => void,
  ) {
    const id = job.current;
    const attempt = downloadAttempt.current;
    if (!id || !attempt) return;
    try {
      if (!(await attempt.cancel())) return;
    } catch {
      if (mounted.current)
        setPersistenceError(
          'No se pudo registrar la cancelación. Inténtalo de nuevo.',
        );
      return;
    }
    // A native completion must pass the same journal before publishing.
    if (downloadAttempt.current !== attempt) return;
    if (mounted.current) {
      setPersistenceError(null);
      cancelled();
    }
    if (job.current === id) {
      job.current = null;
      try {
        cancelNative();
      } catch {
        if (mounted.current)
          setPersistenceError(
            'Se registró la cancelación. El motor local no confirmó la detención.',
          );
      }
    }
  }

  async function downloadAudio() {
    if (hasActiveOperation() || busy.current || state.status !== 'result')
      return;
    const metadata = state.result.metadata;
    if (!metadata || !selectedAudio) {
      setAudioState({
        status: 'error',
        code: 'AUDIO_FORMAT_NOT_SUPPORTED',
        message: localAudioError('AUDIO_FORMAT_NOT_SUPPORTED'),
        httpDiagnostics: null,
      });
      return;
    }
    if (!metadata.duration || !Number.isFinite(metadata.duration)) {
      setAudioState({
        status: 'error',
        code: 'AUDIO_DURATION_INVALID',
        message: localAudioError('AUDIO_DURATION_INVALID'),
        httpDiagnostics: null,
      });
      return;
    }
    const audioFormatId = selectedAudio.id;
    const duration = metadata.duration;
    try {
      await startTracked(
        { mode: 'AUDIO_ONLY', videoId: metadata.id, audioFormatId },
        (foreground) => {
          const jobId = startLocalAudioDownload(
            metadata.analysisId,
            audioFormatId,
            duration,
            foreground,
          );
          audioJobId.current = jobId;
          setAudioState({
            status: 'preparing',
            jobId,
            formatId: audioFormatId,
          });
        },
      );
    } catch (error) {
      setAudioState({
        status: 'error',
        code: 'AUDIO_DOWNLOAD_FAILED',
        message:
          error instanceof DownloadRecoveryError
            ? error.message
            : localAudioError('AUDIO_DOWNLOAD_FAILED'),
        httpDiagnostics: null,
      });
    }
  }

  function cancelAudio() {
    return cancelTracked(audioJobId, cancelLocalAudioDownload, () =>
      setAudioState({ status: 'cancelled' }),
    );
  }

  async function shareAudio() {
    if (audioState.status !== 'completed') return;
    try {
      await withLibraryLease(audioState.libraryId, (item) =>
        withNamedLibraryFile(item, shareLocalFile),
      );
    } catch {
      if (mounted.current && audioState.status === 'completed') {
        setAudioState({
          ...audioState,
          actionError: 'No se pudo abrir la hoja de compartir.',
        });
      }
    }
  }

  async function downloadVideo() {
    if (
      requestedMode !== 'VIDEO_ONLY' ||
      hasActiveOperation() ||
      busy.current ||
      state.status !== 'result'
    )
      return;
    const metadata = state.result.metadata;
    if (!metadata || !selectedVideoFormatId) {
      setVideoState({
        status: 'error',
        code: 'VIDEO_FORMAT_NOT_SUPPORTED',
        message: localVideoError('VIDEO_FORMAT_NOT_SUPPORTED'),
        httpDiagnostics: null,
      });
      return;
    }
    try {
      await startTracked(
        {
          mode: 'VIDEO_ONLY',
          videoId: metadata.id,
          videoFormatId: selectedVideoFormatId,
        },
        (foreground) => {
          const jobId = startLocalVideoDownload(
            metadata.analysisId,
            selectedVideoFormatId,
            foreground,
          );
          videoJobId.current = jobId;
          setVideoState({
            status: 'preparing',
            jobId,
            formatId: selectedVideoFormatId,
          });
        },
      );
    } catch (error) {
      setVideoState({
        status: 'error',
        code: 'VIDEO_DOWNLOAD_FAILED',
        message:
          error instanceof DownloadRecoveryError
            ? error.message
            : localVideoError('VIDEO_DOWNLOAD_FAILED'),
        httpDiagnostics: null,
      });
    }
  }

  function cancelVideo() {
    return cancelTracked(videoJobId, cancelLocalVideoDownload, () =>
      setVideoState({ status: 'cancelled' }),
    );
  }

  async function shareVideo() {
    if (videoState.status !== 'completed') return;
    try {
      await withLibraryLease(videoState.libraryId, (item) =>
        withNamedLibraryFile(item, shareLocalFile),
      );
    } catch {
      if (mounted.current && videoState.status === 'completed') {
        setVideoState({
          ...videoState,
          actionError: 'No se pudo abrir la hoja de compartir.',
        });
      }
    }
  }

  async function downloadCombined() {
    if (hasActiveOperation() || busy.current || state.status !== 'result')
      return;
    const metadata = state.result.metadata;
    if (
      !metadata ||
      !selectedVideoFormatId ||
      !selectedAudio ||
      !metadata.duration
    ) {
      setCombinedState({
        status: 'error',
        code: 'COMBINED_FORMAT_NOT_SUPPORTED',
        message: localCombinedError('COMBINED_FORMAT_NOT_SUPPORTED'),
        videoHttpDiagnostics: null,
        audioHttpDiagnostics: null,
      });
      return;
    }
    const audioFormatId = selectedAudio.id;
    const duration = metadata.duration;
    try {
      await startTracked(
        {
          mode: 'VIDEO_AUDIO',
          videoId: metadata.id,
          videoFormatId: selectedVideoFormatId,
          audioFormatId,
        },
        (foreground) => {
          const jobId = startLocalCombinedDownload(
            metadata.analysisId,
            selectedVideoFormatId,
            audioFormatId,
            duration,
            selectedAudio.exactSize ?? null,
            selectedAudio.estimatedSize,
            foreground,
          );
          combinedJobId.current = jobId;
          setCombinedState({ status: 'preparing', jobId });
        },
      );
    } catch (error) {
      setCombinedState({
        status: 'error',
        code: 'COMBINED_DOWNLOAD_FAILED',
        message:
          error instanceof DownloadRecoveryError
            ? error.message
            : localCombinedError('COMBINED_DOWNLOAD_FAILED'),
        videoHttpDiagnostics: null,
        audioHttpDiagnostics: null,
      });
    }
  }

  function cancelCombined() {
    return cancelTracked(combinedJobId, cancelLocalCombinedDownload, () =>
      setCombinedState({ status: 'cancelled' }),
    );
  }

  async function shareCombined() {
    if (combinedState.status !== 'completed') return;
    try {
      await withLibraryLease(combinedState.libraryId, (item) =>
        withNamedLibraryFile(item, shareLocalFile),
      );
    } catch {
      if (mounted.current && combinedState.status === 'completed') {
        setCombinedState({
          ...combinedState,
          actionError: 'No se pudo abrir la hoja de compartir.',
        });
      }
    }
  }

  return {
    state,
    audioState,
    videoState,
    combinedState,
    selectedVideoFormatId,
    videoOptions,
    audioOptions,
    selectedAudio,
    selectAudioFormat,
    selectVideoFormat,
    analyze,
    reset,
    downloadAudio,
    cancelAudio,
    shareAudio,
    downloadVideo,
    cancelVideo,
    shareVideo,
    downloadCombined,
    cancelCombined,
    shareCombined,
    cancel: cancelAnalysis,
    requestedMode,
    setRequestedMode,
    persistenceError,
    hasActiveOperation,
    isBusy:
      recording ||
      state.status === 'loading' ||
      audioState.status === 'preparing' ||
      audioState.status === 'saving' ||
      audioState.status === 'downloading' ||
      videoState.status === 'preparing' ||
      videoState.status === 'saving' ||
      videoState.status === 'downloading' ||
      combinedState.status === 'preparing' ||
      combinedState.status === 'saving' ||
      combinedState.status === 'downloading-video' ||
      combinedState.status === 'downloading-audio' ||
      combinedState.status === 'muxing',
  };
}
