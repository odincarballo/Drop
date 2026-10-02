import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  LocalAudioDownloadEvent,
  LocalCombinedDownloadEvent,
  LocalEjsFixtureResult,
  LocalHttpTransferDiagnostics,
  LocalVideoDownloadEvent,
  LocalYoutubeResult,
} from '@/models/onDeviceYoutube';
import { deleteLocalFile, shareLocalFile } from '@/services/jobs';
import {
  analyzeYoutubeOnDevice,
  cancelLocalAudioDownload,
  cancelLocalCombinedDownload,
  cancelLocalVideoDownload,
  cancelLocalYoutube,
  localAudioError,
  localCombinedError,
  localVideoError,
  observeLocalAudioDownload,
  observeLocalCombinedDownload,
  observeLocalVideoDownload,
  startLocalAudioDownload,
  startLocalCombinedDownload,
  startLocalVideoDownload,
  testEjsOnDevice,
} from '@/services/onDeviceYoutube';
import { selectLocalVideoOptions } from '@/utils/onDeviceYoutubeFormats';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'result'; result: LocalYoutubeResult }
  | { status: 'error'; message: string };

type EjsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'result'; result: LocalEjsFixtureResult }
  | { status: 'error'; message: string };

export type LocalAudioState =
  | { status: 'idle' }
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

export function useLocalYoutubeSpike() {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [ejsState, setEjsState] = useState<EjsState>({ status: 'idle' });
  const [audioState, setAudioState] = useState<LocalAudioState>({
    status: 'idle',
  });
  const [videoState, setVideoState] = useState<LocalVideoState>({
    status: 'idle',
  });
  const [combinedState, setCombinedState] = useState<LocalCombinedState>({
    status: 'idle',
  });
  const [selectedVideoFormatId, setSelectedVideoFormatId] = useState<
    string | null
  >(null);
  const busy = useRef(false);
  const audioJobId = useRef<string | null>(null);
  const videoJobId = useRef<string | null>(null);
  const combinedJobId = useRef<string | null>(null);
  const analysisGeneration = useRef(0);
  const mounted = useRef(true);

  const handleAudioEvent = useCallback((event: LocalAudioDownloadEvent) => {
    if (!mounted.current) return;
    if (audioJobId.current !== event.jobId) return;
    if (event.status === 'PREPARING') {
      setAudioState({
        status: 'preparing',
        jobId: event.jobId,
        formatId: event.formatId ?? '',
      });
    } else if (event.status === 'DOWNLOADING' || event.status === 'RETRYING') {
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
      setAudioState({
        status: 'completed',
        jobId: event.jobId,
        formatId: event.formatId ?? '',
        container: 'm4a',
        codec: event.codec ?? null,
        fileName: event.fileName,
        fileSize: event.fileSize,
        localUri: event.localUri,
        actionError: null,
        httpDiagnostics: event.httpDiagnostics ?? null,
      });
    } else if (event.status === 'CANCELLED') {
      audioJobId.current = null;
      setAudioState({ status: 'cancelled' });
    } else if (event.status === 'FAILED') {
      audioJobId.current = null;
      const code = event.errorCode ?? 'AUDIO_DOWNLOAD_FAILED';
      setAudioState({
        status: 'error',
        code,
        message: localAudioError(code),
        httpDiagnostics: event.httpDiagnostics ?? null,
      });
    }
  }, []);

  const handleVideoEvent = useCallback((event: LocalVideoDownloadEvent) => {
    if (!mounted.current) return;
    if (videoJobId.current !== event.jobId) return;
    if (event.status === 'PREPARING') {
      setVideoState({
        status: 'preparing',
        jobId: event.jobId,
        formatId: event.formatId ?? '',
      });
    } else if (event.status === 'DOWNLOADING' || event.status === 'RETRYING') {
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
      setVideoState({
        status: 'completed',
        jobId: event.jobId,
        formatId: event.formatId ?? '',
        container: 'mp4',
        codec: event.codec ?? null,
        height: event.height ?? null,
        fileName: event.fileName,
        fileSize: event.fileSize,
        localUri: event.localUri,
        actionError: null,
        httpDiagnostics: event.httpDiagnostics ?? null,
      });
    } else if (event.status === 'CANCELLED') {
      videoJobId.current = null;
      setVideoState({ status: 'cancelled' });
    } else if (event.status === 'FAILED') {
      videoJobId.current = null;
      const code = event.errorCode ?? 'VIDEO_DOWNLOAD_FAILED';
      setVideoState({
        status: 'error',
        code,
        message: localVideoError(code),
        httpDiagnostics: event.httpDiagnostics ?? null,
      });
    }
  }, []);

  const handleCombinedEvent = useCallback(
    (event: LocalCombinedDownloadEvent) => {
      if (!mounted.current) return;
      if (combinedJobId.current !== event.jobId) return;
      if (event.status === 'PREPARING') {
        setCombinedState({ status: 'preparing', jobId: event.jobId });
      } else if (
        event.status === 'DOWNLOADING_VIDEO' ||
        event.status === 'DOWNLOADING_AUDIO' ||
        event.status === 'RETRYING_VIDEO' ||
        event.status === 'RETRYING_AUDIO'
      ) {
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
        setCombinedState({
          status: 'completed',
          jobId: event.jobId,
          fileName: event.fileName,
          fileSize: event.fileSize,
          localUri: event.localUri,
          durationSeconds: event.durationSeconds,
          height: event.height ?? null,
          videoCodec: event.videoCodec ?? null,
          audioCodec: event.audioCodec ?? null,
          actionError: null,
          videoHttpDiagnostics: event.videoHttpDiagnostics ?? null,
          audioHttpDiagnostics: event.audioHttpDiagnostics ?? null,
        });
      } else if (event.status === 'CANCELLED') {
        combinedJobId.current = null;
        setCombinedState({ status: 'cancelled' });
      } else if (event.status === 'FAILED') {
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
    [],
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

  function clearCompletedFiles() {
    for (const completed of [audioState, videoState, combinedState]) {
      if (completed.status !== 'completed') continue;
      try {
        deleteLocalFile(completed.localUri);
      } catch {
        // The result must still be cleared if iOS already removed its cache file.
      }
    }
  }

  async function analyze(url: string) {
    if (busy.current) return;
    busy.current = true;
    const generation = ++analysisGeneration.current;
    clearCompletedFiles();
    setAudioState({ status: 'idle' });
    setVideoState({ status: 'idle' });
    setCombinedState({ status: 'idle' });
    setSelectedVideoFormatId(null);
    setState({ status: 'loading' });
    try {
      const result = await analyzeYoutubeOnDevice(url);
      if (mounted.current && analysisGeneration.current === generation) {
        setState({ status: 'result', result });
        const options = result.metadata
          ? selectLocalVideoOptions(result.metadata.videoFormats)
          : [];
        const preferred = options.find(
          (format) => format.id === result.metadata?.preferredVideoFormatId,
        );
        setSelectedVideoFormatId(preferred?.id ?? options[0]?.id ?? null);
      }
    } catch (error) {
      if (mounted.current && analysisGeneration.current === generation)
        setState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'No se pudo iniciar el análisis local. Revisa la URL y esta build.',
        });
    } finally {
      if (analysisGeneration.current === generation) busy.current = false;
    }
  }

  function reset() {
    ++analysisGeneration.current;
    clearCompletedFiles();
    if (busy.current) cancelLocalYoutube();
    if (audioJobId.current) cancelLocalAudioDownload();
    if (videoJobId.current) cancelLocalVideoDownload();
    if (combinedJobId.current) cancelLocalCombinedDownload();
    busy.current = false;
    audioJobId.current = null;
    videoJobId.current = null;
    combinedJobId.current = null;
    setState({ status: 'idle' });
    setEjsState({ status: 'idle' });
    setAudioState({ status: 'idle' });
    setVideoState({ status: 'idle' });
    setCombinedState({ status: 'idle' });
    setSelectedVideoFormatId(null);
  }

  const videoOptions =
    state.status === 'result' && state.result.metadata
      ? selectLocalVideoOptions(state.result.metadata.videoFormats)
      : [];

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
  async function testEjs() {
    if (busy.current) return;
    busy.current = true;
    setEjsState({ status: 'loading' });
    try {
      const result = await testEjsOnDevice();
      if (mounted.current) setEjsState({ status: 'result', result });
    } catch {
      if (mounted.current)
        setEjsState({
          status: 'error',
          message: 'No se pudo completar la prueba EJS local.',
        });
    } finally {
      busy.current = false;
    }
  }

  function downloadAudio() {
    if (
      busy.current ||
      audioJobId.current ||
      combinedJobId.current ||
      state.status !== 'result'
    )
      return;
    const metadata = state.result.metadata;
    if (!metadata?.preferredAudioFormatId) {
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
    try {
      const jobId = startLocalAudioDownload(
        metadata.analysisId,
        metadata.preferredAudioFormatId,
        metadata.duration,
      );
      audioJobId.current = jobId;
      setAudioState({
        status: 'preparing',
        jobId,
        formatId: metadata.preferredAudioFormatId,
      });
    } catch (error) {
      setAudioState({
        status: 'error',
        code: 'AUDIO_DOWNLOAD_FAILED',
        message:
          error instanceof Error
            ? error.message
            : localAudioError('AUDIO_DOWNLOAD_FAILED'),
        httpDiagnostics: null,
      });
    }
  }

  function cancelAudio() {
    if (!audioJobId.current) return;
    audioJobId.current = null;
    setAudioState({ status: 'cancelled' });
    cancelLocalAudioDownload();
  }

  async function shareAudio() {
    if (audioState.status !== 'completed') return;
    try {
      await shareLocalFile(audioState.localUri);
    } catch {
      if (mounted.current && audioState.status === 'completed') {
        setAudioState({
          ...audioState,
          actionError: 'No se pudo abrir la hoja de compartir.',
        });
      }
    }
  }

  function downloadVideo() {
    if (
      busy.current ||
      audioJobId.current ||
      videoJobId.current ||
      combinedJobId.current ||
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
      const jobId = startLocalVideoDownload(
        metadata.analysisId,
        selectedVideoFormatId,
      );
      videoJobId.current = jobId;
      setVideoState({
        status: 'preparing',
        jobId,
        formatId: selectedVideoFormatId,
      });
    } catch (error) {
      setVideoState({
        status: 'error',
        code: 'VIDEO_DOWNLOAD_FAILED',
        message:
          error instanceof Error
            ? error.message
            : localVideoError('VIDEO_DOWNLOAD_FAILED'),
        httpDiagnostics: null,
      });
    }
  }

  function cancelVideo() {
    if (!videoJobId.current) return;
    videoJobId.current = null;
    setVideoState({ status: 'cancelled' });
    cancelLocalVideoDownload();
  }

  async function shareVideo() {
    if (videoState.status !== 'completed') return;
    try {
      await shareLocalFile(videoState.localUri);
    } catch {
      if (mounted.current && videoState.status === 'completed') {
        setVideoState({
          ...videoState,
          actionError: 'No se pudo abrir la hoja de compartir.',
        });
      }
    }
  }

  function downloadCombined() {
    if (
      busy.current ||
      audioJobId.current ||
      videoJobId.current ||
      combinedJobId.current ||
      state.status !== 'result'
    )
      return;
    const metadata = state.result.metadata;
    if (
      !metadata ||
      !selectedVideoFormatId ||
      !metadata.preferredAudioFormatId ||
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
    try {
      const jobId = startLocalCombinedDownload(
        metadata.analysisId,
        selectedVideoFormatId,
        metadata.preferredAudioFormatId,
        metadata.duration,
      );
      combinedJobId.current = jobId;
      setCombinedState({ status: 'preparing', jobId });
    } catch (error) {
      setCombinedState({
        status: 'error',
        code: 'COMBINED_DOWNLOAD_FAILED',
        message:
          error instanceof Error
            ? error.message
            : localCombinedError('COMBINED_DOWNLOAD_FAILED'),
        videoHttpDiagnostics: null,
        audioHttpDiagnostics: null,
      });
    }
  }

  function cancelCombined() {
    if (!combinedJobId.current) return;
    combinedJobId.current = null;
    setCombinedState({ status: 'cancelled' });
    cancelLocalCombinedDownload();
  }

  async function shareCombined() {
    if (combinedState.status !== 'completed') return;
    try {
      await shareLocalFile(combinedState.localUri);
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
    ejsState,
    audioState,
    videoState,
    combinedState,
    selectedVideoFormatId,
    videoOptions,
    selectVideoFormat,
    analyze,
    reset,
    testEjs,
    downloadAudio,
    cancelAudio,
    shareAudio,
    downloadVideo,
    cancelVideo,
    shareVideo,
    downloadCombined,
    cancelCombined,
    shareCombined,
    cancel: cancelLocalYoutube,
    isBusy:
      state.status === 'loading' ||
      ejsState.status === 'loading' ||
      audioState.status === 'preparing' ||
      audioState.status === 'downloading' ||
      videoState.status === 'preparing' ||
      videoState.status === 'downloading' ||
      combinedState.status === 'preparing' ||
      combinedState.status === 'downloading-video' ||
      combinedState.status === 'downloading-audio' ||
      combinedState.status === 'muxing',
  };
}
