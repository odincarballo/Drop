# Verificación de MediaDrop 0.4

Fecha: 4 de septiembre de 2026. Entorno: macOS 26.6.2, Xcode 26.6 (17F113), plataforma iOS 26.5, Node 22.19.0, npm 10.9.3, Python 3.13.5 y uv 0.12.9.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| `uv lock --check` | Lockfile coherente |
| `uv sync --frozen --extra dev` | Instalación reproducible correcta |
| `pytest -q` | 85 aprobadas |
| `ruff check app tests` | Sin errores |
| `ruff format --check app tests` | 34 archivos correctamente formateados |
| `mypy app tests` | Sin errores en modo estricto |
| `python -m compileall -q app` | Correcto |
| `uv build` | Wheel y sdist 0.3.0 generados |
| `npm ci` | Instalación reproducible correcta |
| `npm test` | 75 aprobadas; 1 integración optativa omitida |
| `npm run lint` | Sin errores |
| `npm run format:check` | Formato correcto |
| `npm run typecheck` | Sin errores |
| `npx expo-doctor` | 21/21 comprobaciones aprobadas |
| `npm run build:ios` | Bundle Hermes iOS generado, 1241 módulos |
| Build nativo Debug para iPhone | Correcto; firmado mediante Apple Development y Personal Team |
| Instalación en iPhone físico | Correcta; `MediaDrop` instalada con bundle `com.odincarballo.mediadrop` |
| Development client → Metro | Correcto; bundle de desarrollo solicitado y generado, 1403 módulos |
| Uvicorn en `0.0.0.0:8000` | Arranque y apagado correctos |
| `GET /health` real | 200, `{"status":"ok","service":"MediaDrop"}` |
| Contrato OpenAPI real | Versión 0.3.0 y cinco rutas esperadas |
| SSRF en servidor real | `127.0.0.1` rechazado con `UNSAFE_URL` |

## Cobertura relevante

Backend:

- MIME permitido y rechazado.
- `Content-Length`, respuesta sin longitud y límite durante streaming.
- Confirmación acotada de `application/octet-stream`.
- Nombre seguro y extensión canónica.
- DNS público, mixto y privado; loopback, link-local, reservadas e IPv6 especiales.
- Redirect público permitido y redirect a red privada rechazado antes del segundo request.
- Resolver de transporte fijado a IPs ya validadas.
- Conexión HTTPS real contra un servidor TLS local: SNI, certificado y `Host` conservan el hostname original aunque la IP esté fijada.
- Redirect HTTPS real: cada destino se revalida y cada conexión conserva SNI y `Host`.
- El transporte rechaza contextos TLS sin validación y los diagnósticos no filtran URL ni query.
- Error de conexión sin Internet público.
- Job creado, progreso parcial, finalización, descarga del archivo, error remoto y formato inválido.
- Cancelación idempotente y eliminación de parciales.
- Recolección por TTL de workspaces completados.
- Pruebas de salud, mock, errores y límites de fases anteriores.

Mobile:

- Contratos Zod de análisis y jobs.
- Cliente API, POST/DELETE, errores, timeout y respuesta inválida.
- Selección directa de video intacto y audio-only.
- Flujo de archivo directo hasta copia local y acción Compartir simuladas.
- Progreso con porcentaje/bytes, cancelación y estado completado.
- Pruebas anteriores de portapapeles, análisis, formato, accesibilidad básica y estados nulos.

Las pruebas HTTP del backend usan transportes simulados y no dependen de Internet público. El archivo no se acumula en memoria durante el flujo real.

## Regresión HTTPS de `/analyze`

El Python 3.13 de macOS no encontraba un archivo CA en su ruta OpenSSL predeterminada, por lo que `aiohttp` convertía la conexión en `ClientConnectorCertificateError`, causado por `SSLCertVerificationError` (`unable to get local issuer certificate`). El transporte usa ahora de forma explícita el almacén CA de `certifi`, manteniendo obligatorias la verificación del certificado y del hostname.

Con el backend real en ejecución, `POST /analyze` para `https://samplelib.com/preview/mp4/sample-5s.mp4` devolvió `200 OK`, fuente `direct`, contenedor `mp4` y tamaño estimado `2848208` bytes. Esta comprobación manual complementa las regresiones TLS locales; las pruebas automatizadas no dependen de Samplelib ni de Internet.

## Development build en iPhone

Se generó `mobile/ios/` mediante Continuous Native Generation sin usar `prebuild --clean`. La carpeta continúa ignorada por Git. `expo-dev-client` quedó alineado con Expo SDK 57 y la app se configuró con nombre `MediaDrop`, esquema `mediadrop`, icono provisional y bundle identifier `com.odincarballo.mediadrop`.

Xcode firmó la app con el certificado Apple Development del usuario y el Personal Team `HK927RUDLZ`, con firma automática y perfil de aprovisionamiento de desarrollo. El iPhone físico `iPhone de Odín` (iOS 26.6.1) aceptó la instalación después de confiar en el perfil. La app se lanzó desde su bundle propio y solicitó correctamente el bundle a Metro en la LAN; Expo Go no intervino.

La fase 0.3 ya había sido validada físicamente por el usuario: MP4 directo, progreso, transferencia, Compartir y Guardar en Archivos. El código de ese flujo no se modificó. La comprobación manual final dentro de la development build puede realizarse con `https://samplelib.com/preview/mp4/sample-5s.mp4` mientras backend y Metro permanecen activos.

La IP Wi-Fi observada fue `192.168.100.42`; puede cambiar. `mobile/.env` se actualizó localmente a `EXPO_PUBLIC_API_URL=http://192.168.100.42:8000` y permanece ignorado por Git.

## Advertencias no bloqueantes

- Pytest muestra una advertencia de obsolescencia transitoria de AnyIO usada por el TestClient de Starlette. No afecta las pruebas y no se silenció.
- `npm audit` informa 14 vulnerabilidades moderadas transitivas del árbol de herramientas Expo. `npm audit fix --force` no se ejecutó porque puede reemplazar el SDK por versiones incompatibles.
- `npm ci` informa paquetes transitivos obsoletos de Jest/Expo. Las versiones directas permanecen alineadas con Expo Doctor.
- `build:ios` genera el bundle JavaScript/Hermes, no un `.ipa` ni una compilación nativa de Xcode.
- La primera instalación encontró un `ExpoLogBox.modulemap` ausente; ejecutar nuevamente `pod install` regeneró correctamente los enlaces de headers de CocoaPods.
- Denegar inicialmente el acceso del Llavero dejó `hermesvm.framework` sin firma. Un build limpio posterior, autorizado por el usuario, firmó todos los frameworks; el iPhone verificó e instaló la app correctamente.
- Xcode informa dos advertencias no bloqueantes: una biblioteca `-lc++` duplicada y una fase de Expo Dev Launcher sin salidas declaradas.

Estos resultados no convierten el prototipo en un servicio listo para exposición pública. Faltan controles operativos como rate limiting, autenticación, aislamiento de egreso, observabilidad y almacenamiento multi-instancia; están fuera del alcance solicitado.
