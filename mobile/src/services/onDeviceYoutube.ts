import { requireOptionalNativeModule } from 'expo';

import {
  localEjsFixtureResultSchema,
  localAudioDownloadEventSchema,
  localYoutubeResultSchema,
  type LocalAudioDownloadEvent,
} from '@/models/onDeviceYoutube';
import { serverError } from '@/services/errors';

type LocalEngine = {
  analyze: (url: string) => Promise<string>;
  testEjsFixture: () => Promise<string>;
  startAudioDownload: (analysisId: string, formatId: string) => string | null;
  cancelAudioDownload: () => void;
  cancel: () => void;
  addListener: (
    eventName: 'onAudioDownloadState',
    listener: (event: unknown) => void,
  ) => { remove: () => void };
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

export function startLocalAudioDownload(
  analysisId: string,
  formatId: string,
): string {
  const native = engine();
  if (!native)
    throw new Error('Esta build no incluye el motor local experimental.');
  const jobId = native.startAudioDownload(analysisId, formatId);
  if (!jobId) throw new Error('Ya hay una descarga local activa.');
  return jobId;
}

export function cancelLocalAudioDownload(): void {
  engine()?.cancelAudioDownload();
}

export function observeLocalAudioDownload(
  listener: (event: LocalAudioDownloadEvent) => void,
): { remove: () => void } {
  const native = engine();
  if (!native) return { remove: () => undefined };
  return native.addListener('onAudioDownloadState', (value: unknown) => {
    const parsed = localAudioDownloadEventSchema.safeParse(value);
    if (parsed.success) listener(parsed.data);
  });
}

export function localAudioError(code: string): string {
  const messages: Record<string, string> = {
    ANALYSIS_NOT_FOUND:
      'El análisis local caducó. Analiza nuevamente el video.',
    FORMAT_NOT_AVAILABLE: 'El formato seleccionado ya no está disponible.',
    AUDIO_FORMAT_NOT_SUPPORTED:
      'Este formato no es un audio M4A directo compatible.',
    AUDIO_FILE_TOO_LARGE: 'El audio supera el límite de 25 MB de esta prueba.',
    AUDIO_URL_EXPIRED: 'El enlace de descarga caducó. Analiza nuevamente.',
    AUDIO_TIMEOUT: 'La descarga tardó demasiado tiempo.',
    AUDIO_STORAGE_UNAVAILABLE:
      'No se pudo guardar el audio. Comprueba el espacio disponible.',
    AUDIO_MIME_NOT_ALLOWED:
      'YouTube devolvió un tipo de archivo no compatible.',
    AUDIO_HEADERS_FORBIDDEN:
      'Este recurso requiere credenciales no permitidas.',
    LOCAL_CANCELLED: 'Descarga cancelada.',
  };
  return messages[code] ?? 'No se pudo completar la descarga local de audio.';
}

export function localYoutubeError(code: string) {
  if (code === 'LOCAL_CANCELLED') return 'Análisis local cancelado.';
  if (code === 'LOCAL_TIMEOUT') return 'El análisis local tardó demasiado.';
  if (code.startsWith('LOCAL_'))
    return 'El motor local no pudo completar la prueba. Consulta el código de diagnóstico.';
  return serverError(400, { error: { code, message: '' } }).message;
}
