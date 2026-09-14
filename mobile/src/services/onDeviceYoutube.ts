import { requireOptionalNativeModule } from 'expo';

import {
  localEjsFixtureResultSchema,
  localYoutubeResultSchema,
} from '@/models/onDeviceYoutube';
import { serverError } from '@/services/errors';

type LocalEngine = {
  analyze: (url: string) => Promise<string>;
  testEjsFixture: () => Promise<string>;
  cancel: () => void;
};
function engine() {
  return requireOptionalNativeModule<LocalEngine>('OnDeviceYouTube');
}

export function hasLocalYoutubeEngine() {
  return engine() !== null;
}

// Deliberately no API client, token or backend fallback in this experimental path.
export async function analyzeYoutubeOnDevice(url: string) {
  if (!url.trim())
    throw new Error('Introduce una URL pública individual de YouTube.');
  const native = engine();
  if (!native)
    throw new Error('Esta build no incluye el motor local experimental.');
  const raw = await native.analyze(url.trim());
  if (raw.length > 512 * 1024)
    throw new Error('La respuesta local superó el límite permitido.');
  const parsed = localYoutubeResultSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success)
    throw new Error('El motor local devolvió una respuesta inválida.');
  return parsed.data;
}

export async function testEjsOnDevice() {
  const native = engine();
  if (!native)
    throw new Error('Esta build no incluye el motor local experimental.');
  const raw = await native.testEjsFixture();
  if (raw.length > 64 * 1024)
    throw new Error('El diagnóstico EJS superó el límite permitido.');
  const parsed = localEjsFixtureResultSchema.safeParse(
    JSON.parse(raw) as unknown,
  );
  if (!parsed.success)
    throw new Error('El motor EJS devolvió una respuesta inválida.');
  return parsed.data;
}

export function cancelLocalYoutube() {
  engine()?.cancel();
}

export function localYoutubeError(code: string) {
  if (code === 'LOCAL_CANCELLED') return 'Análisis local cancelado.';
  if (code === 'LOCAL_TIMEOUT') return 'El análisis local tardó demasiado.';
  if (code.startsWith('LOCAL_'))
    return 'El motor local no pudo completar la prueba. Consulta el código de diagnóstico.';
  return serverError(400, { error: { code, message: '' } }).message;
}
