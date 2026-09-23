import { apiErrorSchema } from '@/models/media';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const messages = {
  AUTH_REQUIRED: 'Configura el token de acceso de Drop.',
  AUTH_INVALID: 'El token de acceso no es válido. Revisa la configuración.',
  RATE_LIMITED: 'Se hicieron demasiadas solicitudes. Espera un momento.',
  SERVER_BUSY: 'El servidor está ocupado. Inténtalo de nuevo más tarde.',
  PROCESSING_BUSY:
    'Drop está procesando otra descarga. Inténtalo nuevamente en unos momentos.',
  INVALID_REQUEST:
    'El enlace no es válido. Revisa la URL e inténtalo de nuevo.',
  UNSAFE_URL:
    'Utiliza un enlace público. No se permiten direcciones locales o privadas.',
  UNSUPPORTED_URL: 'Esta fuente todavía no es compatible.',
  PLAYLIST_NOT_SUPPORTED: 'Las playlists todavía no son compatibles.',
  LIVE_NOT_SUPPORTED: 'Las transmisiones en vivo todavía no son compatibles.',
  VIDEO_UNAVAILABLE: 'Este video no está disponible.',
  PRIVATE_CONTENT: 'Este video es privado y no puede procesarse.',
  LOGIN_REQUIRED:
    'Este contenido requiere iniciar sesión y no puede procesarse.',
  DRM_NOT_SUPPORTED: 'Este contenido no puede procesarse.',
  FORMAT_NOT_AVAILABLE: 'El formato seleccionado ya no está disponible.',
  PROCESSING_FAILED: 'No se pudo generar el archivo multimedia.',
  PROCESSING_UNAVAILABLE:
    'El motor multimedia no está disponible temporalmente.',
  YOUTUBE_EXTRACTION_FAILED:
    'No se pudo analizar el video de YouTube. Inténtalo de nuevo.',
  URL_TOO_LONG: 'La URL es demasiado larga.',
  MEDIA_TOO_LARGE: 'El archivo supera el tamaño permitido.',
  MEDIA_TOO_LONG: 'El recurso supera la duración permitida.',
  DNS_UNAVAILABLE: 'No se pudo comprobar el enlace. Inténtalo de nuevo.',
  ANALYSIS_TIMEOUT: 'El análisis tardó demasiado. Inténtalo de nuevo.',
  FILE_NOT_FOUND: 'El archivo no fue encontrado.',
  URL_EXPIRED: 'El enlace caducó. Analízalo de nuevo.',
  REMOTE_UNAVAILABLE: 'El servidor del archivo no responde.',
  REMOTE_TIMEOUT: 'El servidor del archivo tardó demasiado en responder.',
  UNSUPPORTED_MIME: 'El enlace no apunta a un archivo compatible.',
  FILE_TOO_LARGE: 'El archivo supera el tamaño permitido.',
  DOWNLOAD_TIMEOUT: 'La descarga tardó demasiado y se detuvo.',
  DOWNLOAD_INTERRUPTED: 'La conexión se interrumpió durante la descarga.',
  INCOMPLETE_DOWNLOAD: 'La conexión terminó antes de completar el archivo.',
  EMPTY_FILE: 'El servidor entregó un archivo vacío.',
  RESOURCE_CHANGED: 'El archivo cambió. Analiza de nuevo el enlace.',
  STORAGE_FULL: 'No hay espacio suficiente para guardar el archivo.',
  STORAGE_ERROR: 'No se pudo guardar el archivo temporal.',
  MEDIA_EXPIRED: 'El análisis caducó. Analiza de nuevo el enlace.',
  INVALID_FORMAT: 'El formato seleccionado ya no está disponible.',
  JOB_NOT_FOUND: 'La descarga ya no está disponible.',
  FILE_EXPIRED: 'El archivo temporal caducó. Inicia otra descarga.',
} satisfies Record<string, string>;

export function serverError(status: number, payload: unknown): ApiError {
  const parsed = apiErrorSchema.safeParse(payload);
  const code = parsed.success ? parsed.data.error.code : 'HTTP_ERROR';
  if (status >= 500)
    return Object.hasOwn(messages, code)
      ? new ApiError(code, messages[code as keyof typeof messages])
      : new ApiError(
          'SERVER_ERROR',
          'El servidor no pudo completar la solicitud. Inténtalo más tarde.',
        );
  // Never display an arbitrary backend message or stack trace, even with a valid envelope.
  const knownMessages: Readonly<Record<string, string>> = messages;
  return new ApiError(
    code,
    (Object.hasOwn(knownMessages, code) ? knownMessages[code] : undefined) ??
      'No se pudo analizar el enlace. Inténtalo de nuevo.',
  );
}

export function jobError(code: string | undefined): ApiError {
  const knownMessages: Readonly<Record<string, string>> = messages;
  return new ApiError(
    code ?? 'DOWNLOAD_FAILED',
    (code && Object.hasOwn(knownMessages, code)
      ? knownMessages[code]
      : undefined) ?? 'No se pudo completar la descarga. Inténtalo de nuevo.',
  );
}
