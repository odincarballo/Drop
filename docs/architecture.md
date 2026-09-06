# Arquitectura y seguridad de MediaDrop 0.3

## Flujo

```text
iPhone
  HomeScreen
    ├─ useMediaAnalysis → services/media → POST /analyze
    └─ useMediaDownload → services/jobs → POST/GET/DELETE /jobs
                                                └─ GET /jobs/{id}/file

FastAPI
  API routes
    ├─ AnalysisService → DirectMediaProvider
    └─ JobManager → DirectMediaProvider.prepare_download
                        ├─ SafeHTTPClient
                        └─ TemporaryStorage

SafeHTTPClient → URLSafetyPolicy → IPs públicas validadas
               └─ AiohttpPinnedTransport (sin redirect automático)
```

Los endpoints solo validan, delegan y serializan. Los proveedores no conocen FastAPI. `create_app()` compone configuración, política de URL, transporte, catálogo efímero, proveedor, almacenamiento y gestor de jobs. `MockMediaProvider` sigue disponible con `MEDIADROP_ANALYSIS_PROVIDER=mock`, pero los jobs solo aceptan capacidades emitidas por `DirectMediaProvider`.

La app mantiene una única ruta. La UI no hace HTTP: `services/api.ts` centraliza JSON, timeout, cancelación y Zod; `services/media.ts` analiza; `services/jobs.ts` gestiona jobs, Expo FileSystem y Expo Sharing. Los hooks contienen estados discriminados para impedir solicitudes o descargas simultáneas.

## Contrato directo

Un análisis correcto crea dos identificadores aleatorios y efímeros:

- `media.id`: capacidad para el recurso analizado.
- `videoFormats[].id` o `audioFormats[].id`: formato original que el job puede entregar.

La URL remota nunca se devuelve en el análisis, en el job ni en `downloadUrl`. El cliente crea un job con `mediaId`, `downloadType` y `formatId`. Para MP4 se permite `VIDEO_AUDIO` como entrega intacta del contenedor original; no se afirma ni se inspecciona la presencia de pistas. Para MP3/M4A/AAC se permite `AUDIO_ONLY`. `VIDEO_ONLY` no se ofrece a recursos directos porque exigiría separar o procesar pistas.

`JobResponse` contiene:

```text
id, status, progress, bytesDownloaded, totalBytes,
fileName, fileSize, error, downloadUrl
```

Estados: `PENDING`, `DOWNLOADING`, `COMPLETED`, `FAILED`, `CANCELLED`. Los bytes se actualizan después de cada bloque escrito. `progress` es `null` si no existe un total fiable. Al completar, `downloadUrl` apunta exclusivamente al archivo temporal del job.

## Análisis HTTP

`DirectMediaProvider` solicita metadatos con `HEAD`. Si el servidor no permite `HEAD`, o si el tipo es ausente/`application/octet-stream`, hace un `GET Range` y lee como máximo 4096 bytes. Nunca consume el archivo completo durante `/analyze`.

Tipos aceptados:

- `video/mp4`
- `audio/mpeg`
- `audio/mp4`
- `audio/aac`

Se ignoran parámetros como `charset` al comparar el MIME. `application/octet-stream` exige firma MP3/AAC o firma ISO-BMFF junto con extensión `.mp4`/`.m4a`; una firma MP4 sin una pista segura para distinguir video de audio se rechaza. El nombre se obtiene de `Content-Disposition` o del path, se reduce a basename, se limpia y recibe la extensión canónica del MIME.

Los codecs, bitrate, resolución real, duración, miniatura y pistas internas permanecen en `null` cuando HTTP no puede demostrarlos. No se usa FFmpeg ni se inventan metadatos.

## Defensa SSRF

La protección se aplica tanto al análisis como a la descarga:

1. Pydantic solo acepta HTTP/HTTPS.
2. Se rechazan credenciales, puertos distintos de 80/443, hostnames locales, loopback, privadas, link-local, reservadas, multicast y direcciones IPv6 de transición.
3. DNS se resuelve bajo timeout y el destino se rechaza si **cualquier** respuesta no es pública.
4. La conexión utiliza un resolver de transporte que solo devuelve las IP ya comprobadas. La URL original conserva el hostname para TLS SNI, validación del certificado y cabecera `Host`; el contexto TLS usa el almacén de CA de `certifi` y exige verificación de certificado y hostname. Esto evita una segunda resolución susceptible a DNS rebinding sin degradar HTTPS.
5. Los redirects automáticos están desactivados. Cada `Location`, incluso relativo, vuelve a los pasos 1–4 y el número de saltos está limitado.
6. El cliente no hereda proxies del entorno, solicita `Accept-Encoding: identity` y no reenvía cookies ni credenciales del usuario.
7. La descarga vuelve a validar MIME, tamaño y redirects; un cambio respecto al análisis falla cerrado.

En desarrollo, un fallo de transporte registra solo la cadena de tipos de excepción y códigos técnicos seguros. No registra URLs, queries ni mensajes de la excepción y la respuesta al cliente mantiene el error público sanitizado.

Permitir toda IP pública es apropiado para este prototipo local de URLs directas autorizadas, pero no sustituye controles de egreso, rate limiting ni allowlists en un despliegue público.

## Límites y streaming

`Content-Length` se rechaza antes de transferir si supera `MAX_FILE_SIZE`. Si falta, cada bloque incrementa `bytesDownloaded` y la transferencia se aborta antes de escribir el bloque que excedería el límite. El tiempo total se envuelve con `DOWNLOAD_TIMEOUT`; DNS/TCP usan `CONNECT_TIMEOUT`.

La respuesta se itera en bloques de 64 KiB y se escribe directamente a disco. No se acumula el archivo en memoria. Una longitud conocida debe coincidir al finalizar; de lo contrario el job falla como incompleto o cambiado.

## Temporales y cancelación

`TemporaryStorage` expone creación, preservación, borrado y recolección. `LocalTemporaryStorage` crea directorios aleatorios con modo privado bajo una raíz configurada; nunca acepta paths del cliente.

Los jobs activos mantienen su workspace protegido del recolector. Al fallar o cancelar se elimina el directorio completo. Al completar se vuelve elegible para TTL. El cliente solicita `DELETE` después de copiar el archivo al iPhone, y el recolector sirve como respaldo ante cierres o pérdidas de red. `DELETE` es idempotente para un job conocido.

Esta implementación usa memoria y un solo proceso. Reiniciar invalida IDs; los directorios huérfanos se recogen por TTL en el siguiente arranque. No ejecutar varios workers sobre el mismo almacenamiento.

## iPhone

Tras `COMPLETED`, Expo FileSystem crea una tarea de descarga hacia `Paths.cache`. La tarea aporta progreso real y `AbortSignal`; la UI distingue la descarga remoto→backend de la transferencia backend→iPhone. Expo Sharing abre la hoja estándar. Guardar en Archivos, si iOS lo ofrece, crea una copia administrada por el sistema.

El caché no es almacenamiento permanente. **Nueva descarga** elimina la copia local de MediaDrop; iOS también puede liberar el caché por falta de espacio. La copia elegida por el usuario en la hoja de compartir no se elimina.

## Exclusiones

No hay proxy arbitrario, autenticación, base de datos, historial, concurrencia de descargas, YouTube, yt-dlp, FFmpeg, extracción, conversión, merge, playlists, DRM bypass ni integraciones con plataformas de terceros.
