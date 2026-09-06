# Verificación local de MediaDrop 0.6

Fecha: 6 de septiembre de 2026. Entorno: macOS, Node 22.19.0, npm 10.9.3, Python 3.13.5 y uv 0.12.9.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| `uv lock --check` | Lockfile coherente, 55 paquetes resueltos |
| `uv sync --frozen --extra dev` | Dependencias reproducibles correctas |
| `pytest -q` | 133 aprobadas; 1 integración real YouTube opt-in omitida |
| `ruff check app tests` | Sin errores |
| `ruff format --check app tests` | 50 archivos correctamente formateados |
| `mypy app tests` | Sin errores en modo estricto |
| `python -m compileall -q app` | Correcto |
| `uv build` | Wheel y sdist 0.6.0 generados |
| `npm ci` | Instalación reproducible correcta |
| `npm test` | 99 aprobadas; 1 integración optativa omitida |
| `npm run lint` | Sin errores |
| `npm run format:check` | Formato correcto |
| `npm run typecheck` | Sin errores |
| `npx expo-doctor` con PATH de CocoaPods configurado | 21/21 comprobaciones aprobadas |
| `npm run build:ios:production` | Bundle Hermes iOS generado, 1245 módulos |
| Bundle de producción | 3.1 MB; contiene `https://mediadrop-api.onrender.com` y no contiene URL LAN |
| Uvicorn local con proveedor Direct | Arranque y apagado correctos |
| `GET /health` real local | 200, `{"status":"ok","service":"MediaDrop"}` |
| `POST /analyze` real a Samplelib | 200, `provider/source=direct`, MP4 y 2,848,208 bytes |
| `render.yaml` | YAML válido; un único Web Service `plan: free` |
| Docker build local | No disponible: este Mac no tiene runtime Docker |
| `ios/` | Sin archivos modificados |

## Cobertura 0.6

Backend:

- URLs watch, youtu.be y Shorts; playlist ambigua rechazada.
- Restricción del extractor a YouTube, `noplaylist`, `ignoreconfig`, Node y ausencia de cookies.
- Live, privado, login, DRM, video no disponible y fallo de yt-dlp sanitizados.
- Formatos reales agrupados por resolución, `formatId`, tamaños exactos frente a aproximados y selección de audio compatible.
- Video + audio progresivo y video/audio separado.
- Solo video directo o eliminación de pista de audio.
- M4A directo/remux/conversión y MP3 128/192/256 kbps.
- ffprobe: duración, container, streams, resolución, codecs y bitrate.
- FFmpeg: mux, progreso temporal, salida sin audio, fallo, límite de salida y cancelación sin proceso vivo.
- Job YouTube: fases, bytes reales, total HTTP, slot atómico de procesamiento, cancelación, fallo y eliminación de inputs/parciales.
- Límite de input/output/workspace y rechazo previo cuando existe estimación suficiente.
- Suite completa heredada de Direct: MIME, tamaño, streaming, cancelación, TTL, SSRF, DNS, IP pinning, redirects y TLS/SNI/Host.
- Bearer auth y rate limiting previos continúan activos.

Mobile:

- Contratos aditivos 0.5/0.6 para análisis y jobs.
- Selección 720p equilibrada y 4K nunca automático.
- Video + audio con mejor pista compatible sin mostrar IDs técnicos.
- Solo video, M4A y MP3 con bitrates de salida tipados.
- Tamaño combinado estimado cuando todos los componentes son conocidos.
- Fases PREPARING/DOWNLOADING/PROCESSING sin inventar porcentaje.
- Creación de job con `formatId`, salida y bitrate correctos.
- Flujos previos de Direct, SecureStore, transferencia iOS y Sharing permanecen cubiertos.

## Motor y contenedor

El Dockerfile fija:

- Python 3.13.5;
- uv 0.12.9;
- Node 22.23.2;
- FFmpeg/ffprobe Debian 5.1.9 (`7:5.1.9-0+deb12u1`);
- yt-dlp 2026.8.19 con extras reproducibles en `uv.lock`.

El build comprueba esas versiones antes de crear la imagen final. Las etiquetas de Node existen para múltiples arquitecturas y el paquete FFmpeg fijado está publicado para amd64 y arm64. No se pudo ejecutar `docker build` localmente porque Docker no está instalado; la primera construcción integral será el despliegue manual aprobado en Render.

## Prueba real opt-in

La suite normal no usa Internet ni YouTube. Para un video público propio/autorizado:

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/backend
MEDIADROP_YOUTUBE_TEST_URL='https://www.youtube.com/watch?v=<video-autorizado>' \
  ~/.local/bin/uv run --frozen pytest -q tests/test_youtube_live_opt_in.py
```

Esta prueba solo analiza metadata y formatos; no descarga el contenido. No se ejecutó porque no se proporcionó una URL opt-in autorizada.

## Advertencias no bloqueantes

- Pytest muestra una advertencia transitoria de AnyIO usada por Starlette TestClient.
- `npm ci` informa 14 vulnerabilidades moderadas transitivas del tooling Expo. No se usó `npm audit fix --force` porque puede romper la compatibilidad con SDK 57.
- Expo Doctor necesita el PATH de CocoaPods ya documentado en este Mac; con ese entorno pasa 21/21.
- Las pruebas FFmpeg locales usan ejecutables controlados y verifican argumentos/procesos. El binario real se instala y valida dentro del contenedor.
- yt-dlp y YouTube cambian con frecuencia; una IP de centro de datos puede recibir desafíos o restricciones. No se eluden con cookies, login ni proxies.
- Render Free dispone de recursos modestos; una conversión cercana a los límites puede exceder el timeout aunque el código sea correcto.
- El backend 0.6 todavía no está desplegado y la Release 0.6 todavía no está instalada en el iPhone.
