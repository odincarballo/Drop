import { requireOptionalNativeModule } from 'expo';

import {
  localCombinedDownloadEventSchema,
  localEjsFixtureResultSchema,
  localAudioDownloadEventSchema,
  localVideoDownloadEventSchema,
  localYoutubeResultSchema,
  type LocalAudioDownloadEvent,
  type LocalCombinedDownloadEvent,
  type LocalVideoDownloadEvent,
} from '@/models/onDeviceYoutube';
import { serverError } from '@/services/errors';

type LocalEngine = {
  analyze: (url: string) => Promise<string>;
  testEjsFixture: () => Promise<string>;
  startAudioDownload: (analysisId: string, formatId: string) => string | null;
  cancelAudioDownload: () => void;
  startVideoDownload: (analysisId: string, formatId: string) => string | null;
  cancelVideoDownload: () => void;
  startCombinedDownload: (
    analysisId: string,
    videoFormatId: string,
    audioFormatId: string,
    durationSeconds: number,
  ) => string | null;
  cancelCombinedDownload: () => void;
  cancel: () => void;
  addListener: (
    eventName:
      | 'onAudioDownloadState'
      | 'onVideoDownloadState'
      | 'onCombinedDownloadState',
    listener: (event: unknown) => void,
  ) => { remove: () => void };
};
function engine() {
  return requireOptionalNativeModule<LocalEngine>('OnDeviceYouTube');
}

export function hasLocalYoutubeEngine() {
  return Boolean(engine());
}

export function isYoutubeUrl(value: string): boolean {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return (
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com')
    );
  } catch {
    return false;
  }
}

// Deliberately no API client, token or backend fallback in this experimental path.
export async function analyzeYoutubeOnDevice(url: string) {
  if (!url.trim())
    throw new Error('Introduce una URL pública individual de YouTube.');
  const native = engine();
  if (!native)
    throw new Error(
      'Esta versión no incluye el motor de YouTube en el iPhone. Actualiza Drop para analizar este enlace.',
    );
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
    AUDIO_RANGE_NOT_SUPPORTED:
      'YouTube no permitió descargar el audio por fragmentos.',
    AUDIO_HTTP_FORBIDDEN: 'YouTube rechazó la descarga de audio (HTTP 403).',
    AUDIO_RANGE_REJECTED:
      'YouTube rechazó el rango solicitado para el audio (HTTP 416).',
    AUDIO_RATE_LIMITED: 'YouTube limitó temporalmente la descarga de audio.',
    AUDIO_RANGE_INVALID:
      'YouTube devolvió un fragmento de audio incompleto o inesperado.',
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

export function startLocalVideoDownload(
  analysisId: string,
  formatId: string,
): string {
  const native = engine();
  if (!native)
    throw new Error('Esta build no incluye el motor local experimental.');
  const jobId = native.startVideoDownload(analysisId, formatId);
  if (!jobId) throw new Error('Ya hay una descarga local activa.');
  return jobId;
}

export function cancelLocalVideoDownload(): void {
  engine()?.cancelVideoDownload();
}

export function observeLocalVideoDownload(
  listener: (event: LocalVideoDownloadEvent) => void,
): { remove: () => void } {
  const native = engine();
  if (!native) return { remove: () => undefined };
  return native.addListener('onVideoDownloadState', (value: unknown) => {
    const parsed = localVideoDownloadEventSchema.safeParse(value);
    if (parsed.success) listener(parsed.data);
  });
}

export function localVideoError(code: string): string {
  const messages: Record<string, string> = {
    ANALYSIS_NOT_FOUND:
      'El análisis local caducó. Analiza nuevamente el video.',
    FORMAT_NOT_AVAILABLE: 'El formato seleccionado ya no está disponible.',
    VIDEO_FORMAT_NOT_SUPPORTED:
      'Este formato no es un video MP4 directo compatible.',
    VIDEO_FILE_TOO_LARGE: 'El video supera el límite de 50 MB de esta prueba.',
    VIDEO_URL_EXPIRED: 'El enlace de descarga caducó. Analiza nuevamente.',
    VIDEO_URL_INVALID: 'YouTube devolvió un enlace de video no permitido.',
    VIDEO_DNS_INVALID: 'El host del video no pasó la validación de seguridad.',
    VIDEO_HTTP_ERROR: 'YouTube rechazó la transferencia del video.',
    VIDEO_RANGE_NOT_SUPPORTED:
      'YouTube no permitió descargar este video por fragmentos.',
    VIDEO_HTTP_FORBIDDEN: 'YouTube rechazó la descarga de video (HTTP 403).',
    VIDEO_RANGE_REJECTED:
      'YouTube rechazó el rango solicitado para el video (HTTP 416).',
    VIDEO_RATE_LIMITED: 'YouTube limitó temporalmente la descarga de video.',
    VIDEO_RANGE_INVALID:
      'YouTube devolvió un fragmento de video incompleto o inesperado.',
    VIDEO_TIMEOUT: 'La descarga tardó demasiado tiempo.',
    VIDEO_STORAGE_UNAVAILABLE:
      'No se pudo guardar el video. Comprueba el espacio disponible.',
    VIDEO_MIME_NOT_ALLOWED: 'YouTube devolvió un tipo de video no compatible.',
    VIDEO_HEADERS_FORBIDDEN:
      'Este recurso requiere credenciales no permitidas.',
    VIDEO_HEADERS_INVALID:
      'YouTube devolvió cabeceras no compatibles con esta prueba.',
    LOCAL_CANCELLED: 'Descarga cancelada.',
  };
  return messages[code] ?? 'No se pudo completar la descarga local de video.';
}

export function startLocalCombinedDownload(
  analysisId: string,
  videoFormatId: string,
  audioFormatId: string,
  durationSeconds: number,
): string {
  const native = engine();
  if (!native)
    throw new Error('Esta build no incluye el motor local experimental.');
  const jobId = native.startCombinedDownload(
    analysisId,
    videoFormatId,
    audioFormatId,
    durationSeconds,
  );
  if (!jobId) throw new Error('Ya hay una descarga local activa.');
  return jobId;
}

export function cancelLocalCombinedDownload(): void {
  engine()?.cancelCombinedDownload();
}

export function observeLocalCombinedDownload(
  listener: (event: LocalCombinedDownloadEvent) => void,
): { remove: () => void } {
  const native = engine();
  if (!native) return { remove: () => undefined };
  return native.addListener('onCombinedDownloadState', (value: unknown) => {
    const parsed = localCombinedDownloadEventSchema.safeParse(value);
    if (parsed.success) listener(parsed.data);
  });
}

export function localCombinedError(code: string): string {
  const messages: Record<string, string> = {
    ANALYSIS_NOT_FOUND:
      'El análisis local caducó. Analiza nuevamente el video.',
    FORMAT_NOT_AVAILABLE: 'Uno de los formatos ya no está disponible.',
    VIDEO_FORMAT_NOT_SUPPORTED: 'El video seleccionado dejó de ser compatible.',
    AUDIO_FORMAT_NOT_SUPPORTED: 'El audio seleccionado dejó de ser compatible.',
    VIDEO_FILE_TOO_LARGE: 'El video supera el límite de esta prueba.',
    AUDIO_FILE_TOO_LARGE: 'El audio supera el límite de esta prueba.',
    MUX_VIDEO_TRACK_MISSING: 'El archivo descargado no contiene video.',
    MUX_AUDIO_TRACK_MISSING: 'El archivo descargado no contiene audio.',
    MUX_VIDEO_CODEC_UNSUPPORTED: 'La pista de video no es H.264 compatible.',
    MUX_AUDIO_CODEC_UNSUPPORTED: 'La pista de audio no es AAC compatible.',
    MUX_VIDEO_DURATION_INVALID: 'La duración del video no es coherente.',
    MUX_AUDIO_DURATION_INVALID: 'La duración del audio no es coherente.',
    MUX_OUTPUT_DURATION_INVALID:
      'La duración del archivo combinado no es válida.',
    MUX_PASSTHROUGH_UNAVAILABLE:
      'AVFoundation no puede combinar estas pistas sin recodificarlas.',
    MUX_EXPORT_FAILED: 'AVFoundation no pudo combinar el video y el audio.',
    MUX_OUTPUT_INVALID: 'El archivo combinado no superó la validación final.',
    COMBINED_STORAGE_UNAVAILABLE:
      'No se pudieron guardar los archivos temporales en el iPhone.',
    LOCAL_CANCELLED: 'Descarga cancelada.',
  };
  if (messages[code]) return messages[code];
  if (code.startsWith('VIDEO_')) return localVideoError(code);
  if (code.startsWith('AUDIO_')) return localAudioError(code);
  return 'No se pudo completar el video con audio.';
}

export function localYoutubeError(code: string) {
  if (code === 'LOCAL_CANCELLED') return 'Análisis local cancelado.';
  if (code === 'LOCAL_TIMEOUT') return 'El análisis local tardó demasiado.';
  if (code.startsWith('LOCAL_'))
    return 'El motor local no pudo completar la prueba. Consulta el código de diagnóstico.';
  return serverError(400, { error: { code, message: '' } }).message;
}
