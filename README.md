# Drop

Aplicación para iPhone que descarga contenido multimedia autorizado y conserva
las nuevas descargas en una Biblioteca local persistente. La candidata v1.1.0
añade reproducción offline de MP4/M4A, progreso y reanudación, audio en segundo
plano, controles del sistema y Picture in Picture para video. YouTube se analiza
y descarga en el dispositivo; los recursos directos conservan su arquitectura
existente. No se usan cookies, cuentas de Google, proxies ni mecanismos para
eludir DRM o controles de acceso. Esta versión todavía requiere validación
física final antes del commit, tag o publicación.

Véanse las [notas de la candidata v1.1.0](docs/release-notes-v1.1.0.md) y el
[procedimiento de Release reproducible](docs/reproducible-ios-release.md).

## Referencia histórica: fase 0.6

El material siguiente documenta la arquitectura y los comandos de la fase
0.6; no describe por completo el flujo móvil vigente de v1.1.0. La fase 0.6
introdujo videos públicos individuales de YouTube en el backend mediante
`yt-dlp`, FFmpeg y ffprobe, junto a recursos directos. En aquel momento el
backend público aún ejecutaba la fase 0.5 hasta aprobar su despliegue.

## Estructura

```text
mobile/
  src/app/                       # Expo Router; una pantalla
  src/components/                # Acceso, metadatos, selección y progreso
  src/hooks/                     # Estado tipado de análisis y descarga
  src/models/                    # Contratos Zod y selección
  src/services/                  # API, SecureStore, jobs, FileSystem y Sharing
backend/
  app/api/                       # Endpoints, Bearer auth y errores
  app/core/                      # Configuración central
  app/models/                    # Modelos Pydantic
  app/providers/                 # Registry, Direct, Mock y YouTube
  app/services/youtube/          # Extracción aislada con yt-dlp
  app/services/media_processing/ # ffprobe y FFmpeg seguros
  app/services/http.py           # Streaming con SSRF/TLS/IP pinning
  app/services/jobs.py           # Jobs, progreso, cancelación y limpieza
  app/storage/                   # Workspaces temporales con TTL
  tests/
  Dockerfile
docs/
render.yaml                      # Un único Web Service Render Free
```

Consulta [la arquitectura](docs/architecture.md) para el flujo y las decisiones de seguridad.

## Requisitos en macOS

- Node.js 22.13 o superior y npm.
- Python 3.13 y [uv](https://docs.astral.sh/uv/).
- Para el backend 0.6 local: FFmpeg/ffprobe 5.1 o superior y Node.js 22 o superior.
- Para iPhone: Xcode, CocoaPods y el Personal Team ya configurado para `com.odincarballo.mediadrop`.
- Docker Desktop solo si se quiere construir localmente el contenedor; no es necesario para las pruebas unitarias.

El contenedor fija Python 3.13.5, Node 22.23.2, FFmpeg/ffprobe 5.1.9 y `yt-dlp` 2026.8.19. No guarda binarios multimedia en Git.

## Backend local

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/backend
cp -n .env.example .env
~/.local/bin/uv sync --frozen --extra dev
```

En `backend/.env`, sustituye `change-me` por un token local de 32 caracteres o más. No guardes ese archivo en Git ni uses una variable `EXPO_PUBLIC_*` para el token.

```dotenv
MEDIADROP_ENVIRONMENT=development
MEDIADROP_API_TOKEN=un-token-local-de-al-menos-32-caracteres
MEDIADROP_ANALYSIS_PROVIDER=auto
```

Con FFmpeg, ffprobe y Node 22 disponibles en `PATH`:

```bash
~/.local/bin/uv run --frozen uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Para ejecutar temporalmente solo el proveedor directo sin esos motores:

```bash
MEDIADROP_ANALYSIS_PROVIDER=direct \
  ~/.local/bin/uv run --frozen uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`GET /health` es público; análisis, jobs y archivos requieren Bearer token:

```bash
curl --fail http://127.0.0.1:8000/health

curl --fail http://127.0.0.1:8000/analyze \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://samplelib.com/preview/mp4/sample-5s.mp4"}'
```

Endpoints:

- `GET /health`
- `POST /analyze`
- `POST /jobs`
- `GET /jobs/{id}`
- `GET /jobs/{id}/file`
- `DELETE /jobs/{id}`

## Flujos 0.6

`POST /analyze` selecciona `YouTubeProvider` únicamente para hosts y rutas individuales de YouTube estrictamente normalizados. El resto de URLs HTTP(S) sigue pasando por `DirectMediaProvider`. Las URLs firmadas de streams nunca se devuelven al móvil.

- **Video + audio:** entrega directamente un MP4 progresivo cuando la resolución ya contiene ambas pistas. Si el video es separado, descarga video y el mejor audio compatible, y FFmpeg hace mux a MP4 copiando el video. El audio se copia si es AAC/ALAC o se convierte a AAC cuando el contenedor lo exige.
- **Solo video:** entrega un stream MP4 video-only. Si la opción progresiva contiene audio, FFmpeg retira la pista con copia de video, sin recodificarlo.
- **Solo audio M4A:** conserva/remuxea AAC/ALAC cuando es compatible; de lo contrario convierte correctamente a AAC/M4A.
- **Solo audio MP3:** convierte con `libmp3lame` al bitrate de salida seleccionado: 128, 192 o 256 kbps. Un bitrate mayor no mejora la fuente.

La UI muestra solo resoluciones MP4 reales agrupadas por altura y conserva internamente su `formatId`. Prefiere 720p, una resolución razonable inferior/superior si no existe, y nunca elige 4K automáticamente. Los streams de video WebM-only no se ofrecen en esta fase para evitar una transcodificación de video costosa.

## Mobile en desarrollo

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/mobile
cp -n .env.development.example .env.development
npm ci
npx expo start --dev-client --lan
```

En un iPhone físico, usa la IP Wi-Fi actual del Mac:

```dotenv
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_API_URL=http://192.168.1.10:8000
```

Introduce el token una vez en **Acceso privado**. Se guarda con Expo SecureStore y `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; no se registra ni se incluye en la URL.

## Build iOS autónoma

`mobile/.env.production` es local e ignorado por Git. Debe mantener HTTPS y el backend público real:

```dotenv
EXPO_PUBLIC_APP_ENV=production
EXPO_PUBLIC_API_URL=https://mediadrop-api.onrender.com
EXPO_PUBLIC_API_TIMEOUT_MS=90000
EXPO_PUBLIC_JOB_POLL_INTERVAL_MS=750
```

Después de desplegar y validar backend 0.6, la nueva Release se construye sin tocar ni regenerar `ios/`:

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/mobile
npm run ios:release
```

La Release embebe Hermes/JavaScript, no necesita Metro y conserva el bundle identifier y Personal Team existentes. SecureStore debería conservar el token al actualizar la app con el mismo identificador y firma. Las instalaciones con Personal Team caducan según el aprovisionamiento de Apple y requieren reinstalación periódica desde el Mac.

## Contenedor y Render Free

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/backend
docker build -t mediadrop-backend:0.6 .
docker run --rm -p 8000:8000 \
  -e MEDIADROP_ENVIRONMENT=production \
  -e MEDIADROP_API_TOKEN='<token-secreto>' \
  mediadrop-backend:0.6
```

El Dockerfile usa el lockfile, CA válidas, usuario sin privilegios, `PORT`, health check, FFmpeg/ffprobe y Node 22 para los desafíos JavaScript compatibles de `yt-dlp`. En este Mac no hay runtime Docker, por lo que la construcción local completa no está disponible; el despliegue manual de Render realizará el build definitivo cuando sea aprobado.

`render.yaml` conserva exactamente un Web Service Docker Free en Ohio, una instancia, sin disco ni base de datos y con despliegues automáticos desactivados. El backend actual está en `https://mediadrop-api.onrender.com`; no se actualizará hasta una aprobación manual. Consulta [Render Free](docs/render-free.md).

## Variables del backend

| Variable | Predeterminado | Función |
| --- | ---: | --- |
| `PORT` | `8000` | Puerto del contenedor |
| `MEDIADROP_ENVIRONMENT` | `development` | Usa `production` en Render |
| `MEDIADROP_API_TOKEN` | `change-me` | Bearer privado; producción exige 32+ caracteres |
| `MEDIADROP_ANALYSIS_PROVIDER` | `auto` | `auto`, `direct` o `mock` |
| `MEDIADROP_ANALYSIS_TIMEOUT_SECONDS` | `10` | Tiempo máximo de extracción/análisis |
| `MAX_FILE_SIZE` | `104857600` | Límite del recurso directo |
| `MAX_INPUT_BYTES` | `104857600` | Suma máxima real de streams de entrada |
| `MAX_OUTPUT_BYTES` | `104857600` | Tamaño máximo del archivo final |
| `MAX_TEMP_WORK_BYTES` | `230686720` | Presupuesto del workspace aislado (220 MiB) |
| `DOWNLOAD_TIMEOUT` | `120` | Tiempo máximo de cada transferencia remota |
| `CONNECT_TIMEOUT` | `10` | Tiempo para DNS/conexión |
| `MAX_REDIRECTS` | `3` | Redirects máximos, todos revalidados |
| `TEMP_FILE_TTL` | `3600` | Retención del archivo final |
| `MAX_ACTIVE_JOBS` | `2` | Jobs activos en la instancia |
| `MAX_PROCESSING_JOBS` | `1` | Jobs con FFmpeg simultáneos |
| `MEDIADROP_MEDIA_PROCESSING_TIMEOUT_SECONDS` | `300` | Tiempo máximo de FFmpeg/ffprobe |
| `MEDIADROP_MAX_MEDIA_DURATION_SECONDS` | `600` | Duración máxima analizable |
| `MEDIADROP_YOUTUBE_SOCKET_TIMEOUT_SECONDS` | `10` | Timeout de yt-dlp |
| `MEDIADROP_YOUTUBE_RETRIES` | `1` | Reintentos de extracción |
| `LOG_LEVEL` | `INFO` | Nivel de logs sanitizados |

El estado, catálogo, jobs y archivos son efímeros y pertenecen a una única instancia/proceso. Un reinicio, suspensión o redeploy invalida las capacidades existentes.

## Pruebas y calidad

Backend:

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/backend
~/.local/bin/uv sync --frozen --extra dev
~/.local/bin/uv run --frozen pytest -q
~/.local/bin/uv run --frozen ruff check app tests
~/.local/bin/uv run --frozen ruff format --check app tests
~/.local/bin/uv run --frozen mypy app tests
~/.local/bin/uv run --frozen python -m compileall -q app
~/.local/bin/uv build
```

La integración real es opt-in y debe usar un video público propio/autorizado; la suite normal nunca contacta YouTube:

```bash
MEDIADROP_YOUTUBE_TEST_URL='https://www.youtube.com/watch?v=<video-autorizado>' \
  ~/.local/bin/uv run --frozen pytest -q tests/test_youtube_live_opt_in.py
```

Mobile:

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/mobile
npm ci
npm test
npm run lint
npm run format:check
npm run typecheck
npx expo-doctor
EXPO_PUBLIC_APP_ENV=production npm run build:ios:production
```

## Seguridad y alcance

Se mantienen Bearer auth, rate limiting, DNS público, IP pinning, SNI/Host correctos, TLS estricto, validación de cada redirect, MIME, límites y timeouts. La extracción solo acepta una URL canónica individual de YouTube, sin configuración local de yt-dlp, cookies ni otros extractores. Cada URL de stream se valida antes de guardarse y vuelve a pasar por `SafeHTTPClient` para la descarga.

FFmpeg/ffprobe reciben listas de argumentos y paths internos; nunca se usa `shell=True`. La cancelación termina el subprocess y borra el workspace. Los logs no contienen tokens, queries firmadas, contenido ni stderr remoto.

No se implementan playlists, canales, búsquedas, cookies, login, contenido privado/de pago/miembros, DRM, subtítulos, editor, procesamiento por lotes, cuentas, base de datos, App Store ni TestFlight.
