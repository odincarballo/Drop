import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import { config } from '@/config';
import type { AnalysisState } from '@/models/analysis';
import {
  initialSelection,
  reduceSelection,
  type SelectionEvent,
} from '@/models/selection';
import { ApiError } from '@/services/errors';
import { analyzeMedia } from '@/services/media';
import { validateMediaUrl } from '@/utils/validation';

export function useMediaAnalysis() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<AnalysisState>({ status: 'idle' });
  const [isPasting, setIsPasting] = useState(false);
  const request = useRef<AbortController | null>(null);
  const pasteInProgress = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  function updateUrl(value: string) {
    request.current?.abort();
    request.current = null;
    setUrl(value);
    setState({ status: 'idle' });
  }

  async function pasteUrl() {
    if (pasteInProgress.current || request.current) return;
    pasteInProgress.current = true;
    setIsPasting(true);
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!mounted.current) return;
      if (!text) {
        setState({
          status: 'error',
          message:
            'No se pudo leer texto. Copia una URL o permite pegar en los ajustes de iOS.',
        });
      } else if (text.length > config.maxUrlLength) {
        setState({
          status: 'error',
          message: 'La URL copiada es demasiado larga.',
        });
      } else {
        updateUrl(text);
      }
    } catch {
      if (mounted.current) {
        setState({
          status: 'error',
          message: 'No se pudo pegar. Puedes introducir la URL manualmente.',
        });
      }
    } finally {
      pasteInProgress.current = false;
      if (mounted.current) setIsPasting(false);
    }
  }

  async function analyze() {
    if (request.current || pasteInProgress.current) return;
    const result = validateMediaUrl(url);
    if (!result.valid) {
      setState({
        status: 'error',
        message: result.message,
      });
      return;
    }
    Keyboard.dismiss();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: 'loading' });
    try {
      const data = await analyzeMedia(result.url, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: 'success',
          data,
          selection: initialSelection(data),
        });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : 'No se pudo analizar el recurso.',
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  const isBusy = state.status === 'loading' || isPasting;
  function select(event: SelectionEvent) {
    setState((current) =>
      current.status === 'success'
        ? {
            ...current,
            selection: reduceSelection(current.selection, event, current.data),
          }
        : current,
    );
  }
  return {
    url,
    state,
    isBusy,
    isPasting,
    updateUrl,
    pasteUrl,
    analyze,
    select,
  };
}
