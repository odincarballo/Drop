# Drop on-device: estado y evolución

Este documento sustituye el plan histórico del spike. Describe el motor que
está implementado en Drop y delimita qué se comprobó en el iPhone frente a lo
que solo tiene pruebas automatizadas. El tag `v1.0.0` conserva el primer estado
estable. `v1.0.1` permanece etiquetada y estable; la rama
`feature/v1.1.0` documenta mejoras en desarrollo, aún sin release.

## Flujo implementado

- El botón principal «Analizar» envía YouTube al módulo local
  `on-device-youtube`, sin fallback a Render. Las URL de recursos directos
  compatibles mantienen su ruta anterior. No se exponen URL firmadas de los
  streams a React Native.
- CPython 3.13.15 ejecuta yt-dlp 2026.08.19 dentro del iPhone. QuickJS-NG
  0.16.2 está empaquetado para el proveedor EJS, pero su presencia no garantiza
  compatibilidad completa con todos los videos de YouTube.
- El diagnóstico EJS sintético no forma parte de la app: no hay botón ni fixture
  empaquetada. La fixture original de Drop vive solo en `tests/fixtures/` y el
  verificador `node mobile/scripts/verify_ejs_diagnostic.mjs` ejercita el solver
  EJS fijado en el host. Esta prueba **no** recorre el puente nativo del iPhone
  ni demuestra compatibilidad con el JavaScript actual de YouTube. La
  extracción normal conserva el proveedor EJS y QuickJS integrados.
- La selección usa el catálogo del análisis actual y la identidad única de la
  pista de audio. Prioriza la pista original/predeterminada cuando los metadatos
  permiten identificarla; si hay ambigüedad, no sustituye silenciosamente la
  pista. Excluye HLS de la ruta de MP4 directo.
- Audio M4A/AAC y video MP4/H.264 se descargan directamente al iPhone mediante
  URLSession. El video y Solo audio usan rangos de 256 KiB. La respuesta HTTP
  200 tiene un fallback de streaming a disco únicamente donde la política
  existente lo permite. La política actual limita el video compatible cercano
  a 360p/720p a **1 GiB por pista**, 1080p Fase 1 a **50 MiB por pista** y el
  audio a **250 MiB por pista**; el límite se comprueba durante la transferencia.
- Video + audio utiliza AVFoundation passthrough para combinar las pistas en
  MP4. Solo audio normaliza con AVFoundation passthrough el timeline de un M4A
  DASH a la duración validada del análisis: no cambia códec ni bitrate de
  forma intencionada y no publica el M4A descargado antes de validar la salida.
- Se muestran progreso, cancelación, resultado y «Guardar en Archivos» mediante
  UIDocumentPicker; «Más opciones» mantiene la hoja de compartir. Los archivos
  activos quedan retenidos durante descarga, mux y exportación. Los parciales y
  trabajos abandonados propios de Drop se limpian de forma conservadora.
- Los detalles HTTP visibles se limitan a status, Range, índice de petición,
  host, Content-Range, Content-Length y bytes acumulados. Se reconstruyen desde
  números o valores estrictamente validados; no se transfieren URL, queries,
  cookies, Authorization ni headers arbitrarios.

## Validado físicamente en «iPhone de Odín»

- YouTube: análisis local, Video + audio, Solo video y Solo audio; selección
  de calidades directas 360p/364p y 720p según el recurso; progreso, mux,
  exportación a Archivos y reproducción externa con imagen y sonido
  sincronizados. La selección de 720p y la distinción HLS frente a MP4 directo
  se comprobaron con contenidos distintos, incluido NASA IRIS.
- `HdQHE3zg4SE`: Solo audio M4A/AAC en español descargó con rapidez y duró
  aproximadamente 15:17, sin cola de silencio ni `AUDIO_TIMEOUT`/
  `AUDIO_HTTP_ERROR`. Video + audio 360p conservó español, sincronización y
  duración. La pista original/predeterminada quedó identificada correctamente.
- `AWGPaFraPN4`: Solo audio duró aproximadamente 2:01 sin silencio añadido;
  Video + audio 360p mantuvo imagen, sonido y sincronización.
- Se canceló y reintentó una descarga de YouTube; también se forzó el cierre
  durante una descarga, se reabrió Drop y se inició otra descarga sin falso
  «completado» ni bloqueo. La limpieza de carpetas internas no fue inspeccionada
  manualmente en el teléfono.
- «Guardar en Archivos» exportó y reprodujo archivos fuera de Drop. El recurso
  directo de Samplelib se analizó y descargó normalmente. Sistema/Claro/Oscuro,
  Ajustes, token preservado y preferencias se validaron en el iPhone.

## Validado por tests o revisión de código, no físicamente

- Cancelación y reintento del recurso directo: el archivo físico usado para la
  prueba terminaba demasiado rápido para provocar una cancelación manual.
- Fallos de escritura, limpieza de parciales y barrido conservador de trabajos
  abandonados al arranque; leases de archivos durante UIDocumentPicker y hoja
  de compartir; cancelación durante mux y exportación.
- El M4A real de `HdQHE3zg4SE`, copiado del iPhone, se normalizó en un laboratorio
  macOS a **917,0 s** y conservó AAC. También se comprobó `AWGPaFraPN4` a
  **121,0 s**. La validación física de esas duraciones se enumera arriba.
- Las suites móviles, Python y Swift y la construcción Release ARM64 desde
  checkout limpio forman parte del cierre de la Release Candidate. Sus conteos
  definitivos se registran al terminar esa validación, no se infieren aquí.

## Reproducibilidad y configuración

El procedimiento versionado se detalla en
[`reproducible-ios-release.md`](reproducible-ios-release.md). Parte sin `ios/`,
`node_modules`, `vendor`, Pods ni DerivedData previos; ejecuta `npm ci`, prepara
las dependencias fijadas, genera el proyecto Expo, integra los módulos nativos,
instala Pods con Bundler y compila Release ARM64 firmada. Regenera el icono, el
nombre Drop, el módulo `on-device-youtube` y `drop-file-export` desde archivos
versionados. El bundle ID permanece `com.odincarballo.mediadrop` y el Team de
desarrollo `HK927RUDLZ`; SecureStore no cambia.

## Limitaciones actuales

- Funciona en **foreground**; no hay background downloads.
- El video directo compatible es MP4/H.264 y el audio directo M4A/AAC. La UI
  expone calidades compatibles alrededor de 360p y 720p cuando existen, no
  1080p. No hay MP3, FFmpeg ni libav.
- HLS/m3u8 no pertenece a la ruta primaria de descarga. La disponibilidad de
  streams directos y sus metadatos depende de YouTube; no se promete cobertura
  universal ni funcionamiento con contenido privado, de pago o con DRM.
- En `v1.0.1` los límites son 50 MiB por pista de video y 25 MiB por pista de
  audio. La política ampliada en desarrollo se describe al final; no forma
  parte de esa versión estable. La caché de Drop es temporal, no almacenamiento
  permanente.
- EJS/QuickJS está empaquetado, pero no se declara compatibilidad EJS completa.
  No se incluyen cookies, login, credenciales, proxies ni evasión de DRM.

## En desarrollo en `feature/v1.1.0`: 1080p Fase 1

Esta política todavía no forma parte de `v1.0.1`. La opción 1080p solo es
elegible para un stream directo MP4 con H.264/`avc1`, sin audio embebido,
FPS conocido de hasta 30 y tamaño exacto
conocido de hasta 50 MiB por pista de video. La pista M4A/AAC mantiene su
límite independiente, ampliado a 250 MiB en la política de tamaño en desarrollo
descrita abajo. HLS, VP9, AV1, FPS desconocido, 1080p60,
tamaño desconocido y cualquier rango dinámico identificado como HDR siguen
excluidos; no hay transcodificación.

En la extracción sin procesar utilizada por Drop, `dynamic_range` suele venir
ausente incluso en MP4/H.264 directos. Por ello se acepta tanto `SDR` explícito
como valor ausente o `unknown`, siempre que se cumplan las demás restricciones.
Un rango desconocido **no se presenta como SDR confirmado**: Detalles técnicos
lo identifica como desconocido. Esta decisión no equivale a verificar la
colorimetría del archivo; el resultado 1080p se comprobó físicamente en el
caso descrito a continuación.

### Validación física de 1080p Fase 1

En iPhone se validó manualmente
[Caminandes 3](https://www.youtube.com/watch?v=SkVqJ1SGeL0) en 1080p
MP4/H.264 a 24 fps: descarga de video y audio correcta, mux completado y
MP4 final reproducido correctamente, con imagen y sonido sincronizados durante
los 2:30 completos. También funcionó Guardar en Archivos.

### En desarrollo: recuperación acotada de HTTP 403 en audio YouTube

Un HTTP 403 durante un rango de audio puede iniciar, como máximo una vez por
trabajo, una reextracción de la misma pista con su identidad única. Este
refresh consume uno de los cuatro retries globales y respeta el presupuesto
compartido de 30 segundos. El audio vuelve a comenzar desde byte cero: nunca
se unen bytes de dos URLs. En Video + audio se conserva el video ya terminado
mientras se recupera el audio; si la recuperación falla, se limpian ambos.
El 403 sigue sin ser reintentable de forma general para video ni recursos
directos. El origen de los 403 observados no está demostrado: se consideran
potencialmente recuperables mediante una URL fresca, no necesariamente URLs
expiradas.

Tras instalar la build con esta corrección, se completaron físicamente dos
descargas adicionales de `SkVqJ1SGeL0` en 1080p con video y audio, mux y
reproducción correctos y sincronizados. En esas pruebas YouTube no volvió a
responder HTTP 403. Por tanto, el flujo normal está validado físicamente;
la recuperación automática específica del 403 está cubierta por pruebas
deterministas, pero aún no se ha activado ni validado físicamente.

### En desarrollo: tamaños mayores con presupuesto de almacenamiento

La política versionada en `mobile/modules/on-device-youtube/download-size-policy.json`
fija 1 GiB por pista de video compatible cercana a 360p/720p, 50 MiB para
1080p Fase 1 y 250 MiB por pista de audio. Un generador produce las constantes
de Python, TypeScript y Swift; la build limpia comprueba su coincidencia.
Estos límites siguen verificándose con Content-Length, Content-Range y los bytes
efectivamente recibidos, no solo en la interfaz.

Antes de la transferencia se consulta en iOS el espacio disponible para uso
importante en el volumen de Caches. Si `V` y `A` son tamaños previstos,
`salida(x) = x + max(64 MiB, 10 % de x)` y
`reserva = max(1 GiB, 10 % de la capacidad disponible)`, se exige:

- Solo video: `V + reserva`.
- Solo audio: `A + salida(A) + reserva`.
- Video + audio: `V + A + salida(V + A) + reserva`.

El tamaño aproximado de yt-dlp recibe un margen del 25 %; si falta tamaño se
presupuesta el máximo de la pista. El primer total HTTP validado corrige esa
previsión antes de escribir el cuerpo. Antes del mux se vuelve a medir el espacio
con los tamaños reales y se exige `salida(V + A) + reserva`. Si iOS no informa
capacidad, únicamente se permite la ruta pequeña previa; no se presume espacio
ilimitado para una descarga grande. Las comprobaciones no reservan espacio:
otros procesos pueden consumirlo, por lo que siguen siendo necesarios el manejo
de errores de escritura y la limpieza de parciales. No cambia los límites de
recursos directos/Render.

**Validación física manual:** con _The Wild Project #385 - Expediente Vallecas_
(aproximadamente 2 h 25 min), Drop habilitó 360p y Solo audio, bloqueó 720p
por superar 1 GiB y mostró aproximadamente 457,3 MB para Video + audio 360p.
La descarga combinada tardó unos 5–6 minutos, completó el mux y produjo un MP4
de duración completa. Se comprobó la reproducción al inicio, mitad y cerca del
final, con audio y video sincronizados y sin errores de tamaño o almacenamiento.
Esta prueba no demuestra por sí sola el comportamiento de todos los tamaños ni
los casos de poco espacio, cubiertos por pruebas automatizadas.
