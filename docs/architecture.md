# Arquitectura y seguridad de MediaDrop 0.6

## Flujo

```text
iPhone (Expo Release)
  HomeScreen
    ├─ SecureStore → Bearer token local
    ├─ useMediaAnalysis → POST /analyze
    └─ useMediaDownload → POST/GET/DELETE /jobs
                            └─ GET /jobs/{id}/file → FileSystem → Sharing

FastAPI
  API routes
    ├─ AnalysisService → MediaProviderRegistry
    │                     ├─ YouTubeProvider → YtDlpYouTubeExtractor
    │                     └─ DirectMediaProvider → SafeHTTPClient.probe
    └─ JobManager → provider.prepare_download
                    ├─ SafeHTTPClient.download → workspace aislado
                    └─ FFmpegMediaProcessor → FFprobeService

SafeHTTPClient → URLSafetyPolicy → DNS/IP pública validada
               └─ AiohttpPinnedTransport, TLS estricto y redirects manuales
```

Los endpoints validan, delegan y serializan; no contienen lógica de proveedor ni procesamiento. `/health` es público. El análisis, los jobs y la entrega del archivo exigen el Bearer token configurado en el servidor. El rate limiter, catálogo y gestor de jobs pertenecen a una única instancia.

`MockMediaProvider` conserva el flujo determinista de pruebas. `DirectMediaProvider` mantiene el contrato 0.5. `YouTubeProvider` añade capacidades opacas que el móvil puede seleccionar sin recibir URLs firmadas.

## Contrato de análisis

`MediaAnalysis` mantiene los campos 0.5 y añade información compatible de forma aditiva:

- `provider`/`source`: `direct`, `mock` o `youtube`;
- `formatId`, dimensiones, fps y bitrate cuando existen;
- `estimatedSize` solo cuando la fuente aporta una estimación razonable.

Los formatos de YouTube se agrupan por resolución. Se conserva una opción MP4 real por altura, prefiriendo un stream progresivo y codecs compatibles. No se inventan resoluciones. Los videos WebM-only se excluyen porque producir MP4 exigiría transcodificar video; esa operación queda fuera de esta fase.

El catálogo en memoria asocia el `mediaId` aleatorio con streams validados, metadata y expiración. No persiste URLs, cookies ni credenciales. Reiniciar la instancia invalida el catálogo.

## Extracción de YouTube

`YtDlpYouTubeExtractor` acepta únicamente:

- `youtube.com/watch?v=<id>`;
- `youtu.be/<id>`;
- `youtube.com/shorts/<id>`.

El identificador debe tener exactamente el formato de un ID de video y se normaliza a una URL HTTPS canónica. Una URL de playlist sin video inequívoco se rechaza; `noplaylist` permanece activo. `allowed_extractors` limita yt-dlp a YouTube, `ignoreconfig` impide heredar configuración local y no se configuran cookies, navegador, OAuth ni proxy.

La extracción usa la API Python versionada de yt-dlp solo para metadata. Node 22 y `yt-dlp-ejs` resuelven desafíos JavaScript compatibles sin autenticación. Los errores se clasifican y sanitizan; nunca se registra el texto de yt-dlp porque podría contener una URL firmada.

Los streams aceptados deben ser HTTPS. Solo se copian `User-Agent`, `Referer`, `Origin` y `Accept-Language`, con límites de longitud y sin saltos de línea. Cookies y cabeceras de autorización se descartan.

## Planes de descarga y procesamiento

El proveedor devuelve un `PreparedDownload` interno con uno o dos `DownloadSource`, modo de procesamiento, nombre final, MIME, duración y estimaciones. Los paths se generan internamente y nunca provienen del cliente.

- `DIRECT`: un MP4 progresivo o audio M4A compatible se entrega intacto.
- `MUX`: video MP4 separado + mejor audio; el video se copia. AAC/ALAC se copia y audio incompatible se convierte a AAC.
- `STRIP_AUDIO`: copia la pista de video y elimina audio.
- `AUDIO_M4A`: copia/remuxea AAC/ALAC o convierte a AAC.
- `AUDIO_MP3`: convierte con `libmp3lame` a 128/192/256 kbps.

FFmpeg y ffprobe se ejecutan con `asyncio.create_subprocess_exec`, argumentos separados, `stdin` cerrado, timeout y captura acotada. No se usa shell. ffprobe confirma streams y codecs antes/después. El tamaño de salida se vigila mientras FFmpeg corre y el proceso se termina si supera el límite.

## Jobs y progreso

Estados públicos:

```text
PENDING → PREPARING → DOWNLOADING → PROCESSING → COMPLETED
                                             └→ FAILED / CANCELLED
```

`phase` distingue `DOWNLOADING_VIDEO`, `DOWNLOADING_AUDIO`, `MUXING`, `CONVERTING` y `FINALIZING`. `message` contiene texto seguro para la UI.

Durante la descarga, `bytesDownloaded` suma bytes reales escritos. El porcentaje solo se calcula cuando el servidor remoto aporta longitudes exactas; `filesize_approx` nunca se usa como `Content-Length`. Durante FFmpeg se usa el timestamp reportado respecto de la duración conocida; de lo contrario el progreso es `null`. La transferencia backend→iPhone conserva el progreso nativo de Expo FileSystem.

La creación bajo un lock hace atómicos `MAX_ACTIVE_JOBS` y `MAX_PROCESSING_JOBS`. Render Free procesa como máximo un trabajo FFmpeg a la vez. La app tampoco inicia dos descargas simultáneas.

Cancelar una tarea cancela el streaming o FFmpeg, termina el subprocess con escalado terminate/kill, libera el slot y borra el workspace. Fallos y falta de espacio siguen el mismo cierre. Al completar, se eliminan los inputs y solo se conserva el archivo final hasta TTL.

## Seguridad de red

La defensa SSRF se mantiene para Direct y para cada URL de stream extraída:

1. Solo HTTP/HTTPS; YouTube y sus streams requieren HTTPS.
2. Se rechazan credenciales, puertos no permitidos, hostnames locales y direcciones loopback, privadas, link-local, reservadas, multicast o IPv6 de transición.
3. DNS se resuelve bajo timeout y se rechaza el destino si cualquier respuesta no es pública.
4. La conexión usa únicamente las IP verificadas. El hostname original se conserva para TLS SNI, validación del certificado y `Host`.
5. Los redirects automáticos están desactivados; cada destino se resuelve y valida de nuevo.
6. Se usa CA de `certifi`, verificación TLS/hostname obligatoria y no se heredan proxies del entorno.
7. MIME, encoding, longitud y límites se revalidan durante la descarga.

yt-dlp solo puede iniciar extracción contra la URL canónica de YouTube; no acepta una URL arbitraria. Las URLs concretas de medios se someten a la política completa y se descargan exclusivamente mediante `SafeHTTPClient`.

## Límites y temporales

- `MAX_FILE_SIZE`: 100 MiB para un archivo directo.
- `MAX_INPUT_BYTES`: 100 MiB acumulados de streams.
- `MAX_OUTPUT_BYTES`: 100 MiB de resultado.
- `MAX_TEMP_WORK_BYTES`: 220 MiB para que convivan inputs y resultado.
- `MAX_PROCESSING_JOBS`: 1.
- `MEDIADROP_MEDIA_PROCESSING_TIMEOUT_SECONDS`: 300 segundos.
- `MEDIADROP_MAX_MEDIA_DURATION_SECONDS`: 600 segundos.

Cada job tiene un directorio `mediadrop-<uuid>` privado. Los nombres internos llevan prefijo `input-`; el nombre final deriva de un título sanitizado o del nombre HTTP seguro. No hay path traversal. El almacenamiento es efímero y no se comparte entre instancias.

## Compatibilidad directa

El análisis directo sigue usando `HEAD` y, cuando hace falta, un `GET Range` de hasta 4096 bytes. Admite `video/mp4`, `audio/mpeg`, `audio/mp4` y `audio/aac`; `application/octet-stream` requiere firma y extensión coherentes.

Un MP4 directo continúa ofreciéndose como `VIDEO_AUDIO → Original`, sin afirmar que existe una pista separada y sin pasar por FFmpeg. Los archivos de audio directos continúan como `AUDIO_ONLY` intacto. Todas las pruebas 0.5 permanecen en la suite.

## Mobile

La única pantalla conserva la arquitectura previa. Zod valida respuestas aditivas 0.5/0.6. El estado discriminado mantiene tipo, resolución real, salida de audio y bitrate sin combinaciones ambiguas.

Para YouTube, 720p es el valor equilibrado por defecto si existe; nunca se preselecciona 4K. Video + audio elige automáticamente el mejor audio compatible. Solo audio ofrece M4A o MP3 y etiqueta el bitrate como salida, sin prometer mejora de calidad.

El token permanece en SecureStore con `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, nunca en `EXPO_PUBLIC_*`. La Release usa el backend HTTPS público, incluye Hermes y no depende de Metro.

## Límites deliberados

No hay playlists, canales, búsquedas, cookies, Google login/OAuth, contenido privado/de pago/miembros, DRM, streams en vivo, subtítulos, edición, metadata avanzada, lotes, cuentas, base de datos ni múltiples instancias. La integración con YouTube puede requerir actualizar la versión aislada de yt-dlp cuando YouTube cambie.
