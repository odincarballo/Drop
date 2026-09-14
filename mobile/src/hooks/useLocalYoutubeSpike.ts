import { useEffect, useRef, useState } from 'react';

import type {
  LocalEjsFixtureResult,
  LocalYoutubeResult,
} from '@/models/onDeviceYoutube';
import {
  analyzeYoutubeOnDevice,
  cancelLocalYoutube,
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

export function useLocalYoutubeSpike() {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [ejsState, setEjsState] = useState<EjsState>({ status: 'idle' });
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (busy.current) cancelLocalYoutube();
    };
  }, []);
  async function analyze(url: string) {
    if (busy.current) return;
    busy.current = true;
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
  return {
    state,
    ejsState,
    analyze,
    testEjs,
    cancel: cancelLocalYoutube,
    isBusy: state.status === 'loading' || ejsState.status === 'loading',
  };
}
