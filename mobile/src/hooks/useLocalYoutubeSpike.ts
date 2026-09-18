import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  LocalAudioDownloadEvent,
  LocalEjsFixtureResult,
  LocalVideoDownloadEvent,
  LocalYoutubeResult,
} from '@/models/onDeviceYoutube';
import { shareLocalFile } from '@/services/jobs';
import {
  analyzeYoutubeOnDevice,
  cancelLocalAudioDownload,
  cancelLocalVideoDownload,
  cancelLocalYoutube,
  localAudioError,
  localVideoError,
  observeLocalAudioDownload,
  observeLocalVideoDownload,
  startLocalAudioDownload,
  startLocalVideoDownload,
  testEjsOnDevice,
} from '@/services/onDeviceYoutube';

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
    }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; code: string };

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
    }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; code: string };

export function useLocalYoutubeSpike() {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [ejsState, setEjsState] = useState<EjsState>({ status: 'idle' });
  const [audioState, setAudioState] = useState<LocalAudioState>({
    status: 'idle',
  });
  const [videoState, setVideoState] = useState<LocalVideoState>({
    status: 'idle',
  });
  const busy = useRef(false);
  const audioJobId = useRef<string | null>(null);
  const videoJobId = useRef<string | null>(null);
  const mounted = useRef(true);

  const handleAudioEvent = useCallback((event: LocalAudioDownloadEvent) => {
    if (!mounted.current) return;
    if (audioJobId.current && audioJobId.current !== event.jobId) return;
    audioJobId.current = event.jobId;
    if (event.status === 'PREPARING') {
      setAudioState({
        status: 'preparing',
        jobId: event.jobId,
        formatId: event.formatId ?? '',
      });
    } else if (event.status === 'DOWNLOADING') {
      setAudioState({
        status: 'downloading',
        jobId: event.jobId,
        formatId: event.formatId ?? '',
        container: 'm4a',
        codec: event.codec ?? null,
        bytesDownloaded: event.bytesDownloaded ?? 0,
        totalBytes: event.totalBytes ?? null,
        progress: event.progress ?? null,
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
      });
    } else if (event.status === 'CANCELLED') {
      audioJobId.current = null;
      setAudioState({ status: 'cancelled' });
    } else if (event.status === 'FAILED') {
      audioJobId.current = null;
      const code = event.errorCode ?? 'AUDIO_DOWNLOAD_FAILED';
      setAudioState({ status: 'error', code, message: localAudioError(code) });
    }
  }, []);

  const handleVideoEvent = useCallback((event: LocalVideoDownloadEvent) => {
    if (!mounted.current) return;
    if (videoJobId.current && videoJobId.current !== event.jobId) return;
    videoJobId.current = event.jobId;
    if (event.status === 'PREPARING') {
      setVideoState({
        status: 'preparing',
        jobId: event.jobId,
        formatId: event.formatId ?? '',
      });
    } else if (event.status === 'DOWNLOADING') {
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
      });
    } else if (event.status === 'CANCELLED') {
      videoJobId.current = null;
      setVideoState({ status: 'cancelled' });
    } else if (event.status === 'FAILED') {
      videoJobId.current = null;
      const code = event.errorCode ?? 'VIDEO_DOWNLOAD_FAILED';
      setVideoState({ status: 'error', code, message: localVideoError(code) });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const subscription = observeLocalAudioDownload(handleAudioEvent);
    const videoSubscription = observeLocalVideoDownload(handleVideoEvent);
    return () => {
      mounted.current = false;
      if (busy.current) cancelLocalYoutube();
      if (audioJobId.current) cancelLocalAudioDownload();
      if (videoJobId.current) cancelLocalVideoDownload();
      subscription.remove();
      videoSubscription.remove();
    };
  }, [handleAudioEvent, handleVideoEvent]);
  async function analyze(url: string) {
    if (busy.current) return;
    busy.current = true;
    setAudioState({ status: 'idle' });
    setVideoState({ status: 'idle' });
    setState({ status: 'loading' });
    try {
      const result = await analyzeYoutubeOnDevice(url);
      if (mounted.current) setState({ status: 'result', result });
    } catch {
      if (mounted.current)
        setState({
          status: 'error',
          message:
            'No se pudo iniciar el análisis local. Revisa la URL y esta build.',
        });
    } finally {
      busy.current = false;
    }
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
    if (busy.current || audioJobId.current || state.status !== 'result') return;
    const metadata = state.result.metadata;
    if (!metadata?.preferredAudioFormatId) {
      setAudioState({
        status: 'error',
        code: 'AUDIO_FORMAT_NOT_SUPPORTED',
        message: localAudioError('AUDIO_FORMAT_NOT_SUPPORTED'),
      });
      return;
    }
    try {
      const jobId = startLocalAudioDownload(
        metadata.analysisId,
        metadata.preferredAudioFormatId,
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
      });
    }
  }

  function cancelAudio() {
    if (!audioJobId.current) return;
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
      state.status !== 'result'
    )
      return;
    const metadata = state.result.metadata;
    if (!metadata?.preferredVideoFormatId) {
      setVideoState({
        status: 'error',
        code: 'VIDEO_FORMAT_NOT_SUPPORTED',
        message: localVideoError('VIDEO_FORMAT_NOT_SUPPORTED'),
      });
      return;
    }
    try {
      const jobId = startLocalVideoDownload(
        metadata.analysisId,
        metadata.preferredVideoFormatId,
      );
      videoJobId.current = jobId;
      setVideoState({
        status: 'preparing',
        jobId,
        formatId: metadata.preferredVideoFormatId,
      });
    } catch (error) {
      setVideoState({
        status: 'error',
        code: 'VIDEO_DOWNLOAD_FAILED',
        message:
          error instanceof Error
            ? error.message
            : localVideoError('VIDEO_DOWNLOAD_FAILED'),
      });
    }
  }

  function cancelVideo() {
    if (!videoJobId.current) return;
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

  return {
    state,
    ejsState,
    audioState,
    videoState,
    analyze,
    testEjs,
    downloadAudio,
    cancelAudio,
    shareAudio,
    downloadVideo,
    cancelVideo,
    shareVideo,
    cancel: cancelLocalYoutube,
    isBusy:
      state.status === 'loading' ||
      ejsState.status === 'loading' ||
      audioState.status === 'preparing' ||
      audioState.status === 'downloading' ||
      videoState.status === 'preparing' ||
      videoState.status === 'downloading',
  };
}
