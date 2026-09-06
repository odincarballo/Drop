# MediaDrop

Aplicación Expo para iPhone y backend FastAPI para analizar y descargar archivos multimedia directos autorizados. El flujo real de la fase 0.3 se conserva sin FFmpeg, conversión ni separación de pistas.

La fase 0.5 deja preparado el backend como contenedor de una sola instancia, añade acceso Bearer privado y guarda el token en el llavero de iOS mediante Expo SecureStore. El despliegue público y la instalación Release deben completarse después de elegir el hosting y obtener su URL HTTPS.

## Estructura

```text
mobile/
  src/app/          # Expo Router; una pantalla
  src/components/   # Acceso, metadatos, selección y progreso
  src/hooks/        # Estado de análisis y descarga
  src/models/       # Zod y tipos TypeScript
  src/services/     # API, SecureStore, jobs, FileSystem y Sharing
  src/utils/        # Formato y validación
backend/
  app/api/          # Endpoints, autenticación y errores HTTP
  app/core/         # Configuración central
  app/models/       # Modelos Pydantic
  app/providers/    # MediaProvider, Direct y Mock
  app/services/     # Acceso, análisis, HTTP seguro, catálogo y jobs
  app/storage/      # Temporales con TTL
  tests/
  Dockerfile
docs/
```

## Requisitos en macOS

- Node.js 22.13 o superior.
- Python 3.13 y [uv](https://docs.astral.sh/uv/).
- Xcode 26.6 con la plataforma iOS 26.5.
- CocoaPods 1.16.2.
- Apple ID/Personal Team configurado para `com.odincarballo.mediadrop`.
- Developer Mode activo y confianza concedida en el iPhone.

## Backend local

Desde la raíz del repositorio:

```bash
cd backend
cp -n .env.example .env
~/.local/bin/uv sync --frozen --extra dev
```

En `backend/.env`, sustituye `change-me` por un token aleatorio de 32 caracteres o más. Nunca lo guardes en Git ni lo introduzcas en una variable `EXPO_PUBLIC_*`.

```dotenv
MEDIADROP_ENVIRONMENT=development
MEDIADROP_API_TOKEN=un-token-local-de-al-menos-32-caracteres
```

Inicia el servidor:

```bash
~/.local/bin/uv run --frozen uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`GET /health` no necesita autenticación:

```bash
curl --fail http://127.0.0.1:8000/health
```

Las demás rutas sí requieren `Authorization: Bearer <token>`:

```bash
curl --fail http://127.0.0.1:8000/analyze \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://samplelib.com/preview/mp4/sample-5s.mp4"}'
```

Endpoints:

- `GET /health` — público.
- `POST /analyze` — protegido.
- `POST /jobs` — protegido.
- `GET /jobs/{id}` — protegido.
- `GET /jobs/{id}/file` — protegido.
- `DELETE /jobs/{id}` — protegido.

El estado vive en memoria y los archivos son efímeros. Ejecuta exactamente un worker: reiniciar o reemplazar la instancia invalida jobs y archivos existentes.

## Mobile en desarrollo

Copia la configuración local:

```bash
cd mobile
cp -n .env.development.example .env.development
npm ci
```

En un iPhone físico, cambia la URL por la IP Wi-Fi del Mac:

```dotenv
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_API_URL=http://192.168.1.10:8000
```

Inicia Metro para la development build instalada:

```bash
npx expo start --dev-client --lan
```

Abre MediaDrop y pega en **Acceso privado** el mismo token configurado en el backend. El valor se guarda con `WHEN_UNLOCKED_THIS_DEVICE_ONLY` en el llavero de iOS; no se guarda en `.env`, `app.json`, logs ni URLs.

Después de añadir o actualizar una dependencia nativa, sincroniza CocoaPods sin regenerar `ios/`:

```bash
cd ios
env RUBYOPT="-r$PWD/../scripts/cocoapods_compat.rb" \
  PATH="/Users/odincarballo/.gem/ruby/2.6.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  pod install
cd ..
```

## Backend en contenedor

El contexto de build es `backend/`:

```bash
cd backend
docker build -t mediadrop-backend:0.5 .
docker run --rm -p 8000:8000 \
  -e MEDIADROP_ENVIRONMENT=production \
  -e MEDIADROP_API_TOKEN='<token-secreto>' \
  mediadrop-backend:0.5
```

El `Dockerfile` instala dependencias con `uv.lock`, incluye certificados CA, ejecuta como usuario sin privilegios, escucha en `0.0.0.0`, usa `PORT` cuando el proveedor lo define y comprueba `/health`.

No hay Docker instalado actualmente en este Mac, por lo que la imagen debe construirse en el hosting o después de instalar Docker Desktop manualmente.

## Variables del backend

| Variable | Predeterminado | Función |
| --- | ---: | --- |
| `PORT` | `8000` | Puerto HTTP del contenedor |
| `MEDIADROP_ENVIRONMENT` | `development` | Usa `production` en el hosting |
| `MEDIADROP_API_TOKEN` | `change-me` | Secreto Bearer; producción exige 32+ caracteres y rechaza el valor de ejemplo |
| `MEDIADROP_ANALYSIS_PROVIDER` | `direct` | Proveedor de análisis |
| `MEDIADROP_ANALYSIS_TIMEOUT_SECONDS` | `10` | Límite del análisis |
| `MAX_FILE_SIZE` | `104857600` | Bytes máximos antes y durante la transferencia |
| `DOWNLOAD_TIMEOUT` | `120` | Segundos máximos de descarga remota |
| `CONNECT_TIMEOUT` | `10` | Segundos para DNS/conexión |
| `MAX_REDIRECTS` | `3` | Redirects máximos, todos revalidados |
| `TEMP_FILE_TTL` | `3600` | Retención máxima del archivo terminado |
| `MAX_ACTIVE_JOBS` | `2` | Descargas simultáneas en la instancia |
| `LOG_LEVEL` | `INFO` | Nivel de logs |
| `MEDIADROP_RATE_LIMIT_REQUESTS` | `180` | Solicitudes protegidas por ventana e IP/token |
| `MEDIADROP_RATE_LIMIT_WINDOW_SECONDS` | `60` | Duración de la ventana del limitador |
| `MEDIADROP_TEMP_CLEANUP_INTERVAL_SECONDS` | `60` | Intervalo del recolector |

El hosting debe ejecutar una sola réplica sin volumen persistente. La memoria, los jobs, el rate limiting y el catálogo no se comparten entre procesos.

## Build iOS autónoma

Cuando exista una URL pública HTTPS, crea localmente `mobile/.env.production` a partir del ejemplo:

```dotenv
EXPO_PUBLIC_APP_ENV=production
EXPO_PUBLIC_API_URL=https://dominio-real-del-backend
EXPO_PUBLIC_API_TIMEOUT_MS=90000
EXPO_PUBLIC_JOB_POLL_INTERVAL_MS=750
```

La validación de producción rechaza HTTP, `localhost` y redes privadas. El token no forma parte del bundle: se introduce en la app y se conserva en SecureStore.

Con el iPhone conectado, desbloqueado y manteniendo el Personal Team existente:

```bash
cd /Users/odincarballo/Documents/ChatGPT/Ø/mobile
npm run ios:release
```

La configuración Xcode `Release` no define `SKIP_BUNDLING`, por lo que incorpora el bundle JavaScript en la aplicación. No necesita Metro ni muestra el menú de desarrollo. La instalación/reinstalación en el dispositivo requiere confirmación manual y no debe hacerse con una URL ficticia.

Las instalaciones firmadas con Personal Team caducan normalmente en un plazo corto definido por Apple y deberán recompilarse/reinstalarse desde el Mac. Esta limitación no afecta el uso cotidiano mientras el aprovisionamiento siga vigente.

## Pruebas y calidad

Backend:

```bash
cd backend
~/.local/bin/uv sync --frozen --extra dev
~/.local/bin/uv run --frozen pytest -q
~/.local/bin/uv run --frozen ruff check app tests
~/.local/bin/uv run --frozen ruff format --check app tests
~/.local/bin/uv run --frozen mypy app tests
~/.local/bin/uv run --frozen python -m compileall -q app
~/.local/bin/uv build
```

Mobile:

```bash
cd mobile
npm ci
npm test
npm run lint
npm run format:check
npm run typecheck
env RUBYOPT="-r$PWD/scripts/cocoapods_compat.rb" \
  PATH="/Users/odincarballo/.gem/ruby/2.6.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  npx expo-doctor
EXPO_PUBLIC_APP_ENV=production \
EXPO_PUBLIC_API_URL=https://backend.example.com \
  npm run build:ios:production
```

## Seguridad y límites

El backend conserva la defensa SSRF completa: valida todas las resoluciones DNS, rechaza direcciones privadas/reservadas, fija la conexión a IPs públicas validadas, conserva hostname/SNI/certificado/`Host`, valida cada redirect y mantiene TLS estricto con CA de `certifi`. No hereda proxies del entorno.

Los archivos se escriben en streaming y se eliminan al cancelar, fallar, expirar por TTL o después de que la app solicita su eliminación. Los logs registran ID/estado/bytes/duración y tipos técnicos sanitizados, nunca tokens, contenido ni URLs completas con query sensible.

El rate limiter y `MAX_ACTIVE_JOBS` son controles de una sola instancia, adecuados para uso personal, no para un servicio multiusuario. El Bearer token incluido en una app personal evita acceso anónimo, pero no sustituye cuentas, rotación centralizada o atestación del dispositivo.

No hay YouTube, yt-dlp, FFmpeg, conversiones, separación de pistas, múltiples resoluciones, playlists, cuentas, base de datos, historial, pagos, App Store ni TestFlight.

Consulta [arquitectura](docs/architecture.md) y [verificación](docs/verification.md).
