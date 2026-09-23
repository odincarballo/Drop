# Spike de YouTube en el iPhone

## Estado y alcance

Experimento en `feature/on-device-youtube`, creado desde `main` limpio en
`407d2a2`. No sustituye MediaDrop 0.6. La viabilidad de análisis quedó demostrada
en el iPhone físico el 11 de septiembre de 2026. Una compilación, tests o un
resultado en macOS por sí solos no habrían satisfecho ese criterio.

Se añade una sección «YouTube · prueba local» con el botón «Analizar en este
iPhone». Usa el enlace del campo existente y no tiene acción de descarga.
El botón original «Analizar», el cliente API, SecureStore y las descargas siguen
utilizando su implementación anterior. No existe fallback del spike a Render.
No se ha modificado el backend, Render, la firma ni el metadato nativo 0.3.0.

## Auditoría y elección

La app existente utiliza Expo 57.0.20, React Native 0.86.3, Hermes y un proyecto
Xcode ya generado. Expo Modules permite incorporar el adaptador Swift/Objective-C
sin convertir la UI a Swift ni regenerar `ios/`.

```text
Pantalla React Native (solo prueba de metadatos)
  → módulo Expo OnDeviceYouTube
  → hilo nativo → API C de CPython
  → yt-dlp Python + transporte HTTPS restringido
  → YouTube desde la conexión del iPhone
  → EJS → API C de QuickJS-NG, cuando hace falta JavaScript
  → metadatos JSON normalizados → pantalla
```

### Python y yt-dlp

CPython **3.13.15**, distribución iOS de BeeWare **3.13-b15**, como XCFramework
ARM64. Se inicializa mediante `Py_InitializeFromConfig`, en modo aislado, sin
variables Python del entorno, bytecode en disco ni intérprete externo.
La biblioteca estándar y sus extensiones se empaquetan como frameworks firmados,
con los marcadores `.fwork` y `.origin` de Python para iOS.

Se incluyen wheels pure-Python de **yt-dlp 2026.8.19**, **yt-dlp-ejs 0.8.0** y
**certifi 2026.7.22**. Versiones y SHA-256 están fijados en el script de preparación.
No se instala nada ni se actualiza código Python desde el teléfono.

No se invoca la CLI de yt-dlp: se utiliza `YoutubeDL.extract_info` con
`download=False`, `process=False`, `noplaylist=True`. El único extractor permitido
es YouTube. Un audit hook rechaza creación de procesos.

### JavaScript

QuickJS-NG **0.16.2**, compilado como C dentro del pod. No se incluye `qjs`, Node,
Deno, `quickjs-libc`, JIT, loader de módulos ni APIs de filesystem/red/procesos.
Un proveedor EJS adapta el punto de extensión de yt-dlp a una función C de Python.
Conserva la validación upstream de versión/hash de los scripts EJS empaquetados.
Los scripts del reproductor se procesan dentro de este contexto restringido; no
se habilitan cookies, autenticación, proxies ni mecanismos para continuar ante
una exigencia de login o DRM.

### FFmpeg y ffprobe: todavía no incorporados

La vía posterior sería un XCFramework compilado para iOS con `libavformat`,
`libavcodec`, `libavutil` y `libswresample`, invocados por C/Objective-C++.
Mux/remux no necesita ejecutar el binario `ffmpeg`. La inspección puede utilizar
`avformat_open_input` / `avformat_find_stream_info` y sustituir al proceso ffprobe.
MP3 requeriría habilitar un encoder compatible, por ejemplo libmp3lame, con revisión
de licencias. Se preferiría una configuración LGPL sin componentes GPL innecesarios.
No se incluye ahora ningún framework FFmpeg ni una dependencia FFmpegKit abandonada.

## Seguridad y límites del spike

- Solo URLs individuales watch/youtu.be/shorts; listas sin video inequívoco, lives,
  contenido privado/restringido y DRM se rechazan.
- Solo HTTPS, puerto 443 y dominios YouTube/googlevideo/ytimg y
  `youtubei.googleapis.com`. Render no pertenece a esa lista.
- DNS público comprobado antes de conectar; se rechaza cualquier respuesta
  privada, reservada, multicast, loopback o link-local, incluso mezclada con IP pública.
- Conexión fijada a la IP validada, SNI/certificado/Host del hostname original.
  Certificados CA de certifi; verificación TLS activa.
- Cada redirect se vuelve a validar y resolver, máximo tres.
- No se envían Cookie, Authorization ni Proxy-Authorization. No se conservan
  Set-Cookie. No se leen credenciales del usuario.
- Un análisis activo; 40 solicitudes, 12 MiB por respuesta, 32 MiB acumulados,
  socket hasta 10 s, presupuesto cooperativo de análisis 90 s.
- QuickJS: heap hasta 96 MiB, stack 2 MiB y ejecución hasta 25 s por llamada.
  El worker nativo tiene stack de 8 MiB. Estos **no son límites de RAM de toda la app**.
- Cancelación cooperativa en solicitudes, lecturas y QuickJS; cancelar también al
  pasar a background. Una resolución DNS del sistema ya iniciada no se puede
  interrumpir con este mecanismo. No se promete ejecución en segundo plano.
- No se descargan archivos multimedia ni se generan temporales multimedia.
  La respuesta a React Native descarta URLs firmadas de streams. Los diagnósticos
  contienen versión, host sin query, conteos, tiempo y RAM residente al terminar;
  nunca tokens, cookies ni tracebacks.

## Compilación desde checkout limpio

El procedimiento de Release actual se documenta en
[`reproducible-ios-release.md`](reproducible-ios-release.md). No requiere un
`mobile/ios/` histórico: Expo genera el proyecto, el script versionado localiza
el target por el bundle ID de `app.json`, y Bundler fija CocoaPods y `xcodeproj`.
Las dependencias descargadas, Pods y builds permanecen ignorados por Git.

## Verificación

Desde la raíz:

```bash
PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python -B -m unittest discover \
  -s mobile/modules/on-device-youtube/tests -v
backend/.venv/bin/ruff check --isolated --select E,F,I \
  mobile/modules/on-device-youtube/python mobile/modules/on-device-youtube/tests
backend/.venv/bin/ruff format --isolated --check \
  mobile/modules/on-device-youtube/python mobile/modules/on-device-youtube/tests
```

Desde `mobile/`: `npm test -- --silent`, `npm run lint`,
`npm run format:check`, `npm run typecheck`, `npx expo-doctor`.
Para Expo Doctor en esta Mac utilizar el mismo PATH/RUBYOPT que en `pod install`.

Resultados locales: 108 tests móviles aprobados, 1 integración opt-in omitida;
15 tests offline del spike aprobados; ESLint, Prettier y TypeScript correctos.
Backend sin cambios: 133 aprobados, 1 opt-in omitido; Ruff, formato y mypy correctos.
Expo Doctor: 20/21, únicamente recomienda los parches Expo 57.0.21 y Router
57.0.20; no se actualizaron dependencias principales ni se ocultó el aviso.

## Resultado físico

La Release se instaló sobre MediaDrop existente, sin desinstalarla, con el mismo
ID y Team. No utilizó Metro. En `iPhone de Odín` la URL autorizada
`https://www.youtube.com/watch?v=AWGPaFraPN4` produjo directamente:

- título, ID `AWGPaFraPN4`, duración `2:01` y miniatura;
- 10 formatos de video y 3 de audio;
- resoluciones 144p, 360p, 720p y 1080p;
- MP4/AVC1 y WebM/VP9; M4A/mp4a y WebM/Opus;
- `ios-device`, 1.74 s, 3 solicitudes, 201.9 MB residentes al terminar;
- hosts `www.youtube.com` y `manifest.googlevideo.com`.

No hubo llamada de análisis a Render. El valor EJS fue cero: yt-dlp no acumuló
retos de firma o parámetro `n` para los formatos de este video, así que no llamó
al método `_run_js_runtime` del proveedor EJS. QuickJS sí ejecutó el autodiagnóstico
básico de la línea anterior a `extract_info`, pero ese autodiagnóstico no incrementa
el contador EJS y no representa una carga EJS real.

Por ello queda demostrada la arquitectura on-device de metadatos, pero **no queda
cerrado el riesgo EJS**. Antes de desarrollar descargas debe hacerse un segundo
spike físico que ejecute el EJS empaquetado sobre un fixture upstream reproducible
y, si se encuentra sin evasión, un video público autorizado que entregue un reto
real. La condición de éxito debe incluir `jsChallengeCalls > 0` y formatos válidos.
No se usarán cookies, login, proxies ni credenciales. Una URL pública no es una
prueba estable porque YouTube decide dinámicamente qué respuestas llevan retos.

La medición de RAM mostrada es del proceso completo al finalizar, **no un pico ni
un incremento aislado**. Para decidir el motor definitivo hay que medir pico y
presión de memoria con Instruments en el dispositivo. El coste de almacenamiento
también debe medirse en la build terminada; no equivale al tamaño del SDK descargado.

## Plan condicionado al éxito físico (no implementado)

1. Estabilizar análisis nativo y modelar proveedor/capacidades sin cambiar Direct.
2. Catálogo local efímero de streams identificados, URLs no expuestas en logs.
3. Descarga con transporte seguro y streaming a `Caches/MediaDrop/<job UUID>/`;
   límites agregados, un job, validación de cada redirect y limpieza al iniciar/TTL.
4. Video + audio: conservar progresivo o descargar pistas y mux sin recodificar
   si son compatibles con MP4; rechazar alternativas costosas no autorizadas.
5. Solo video: mapear únicamente stream de video, comprobar salida con libav.
6. M4A: copiar/remuxear AAC compatible; convertir otros codecs cuando se apruebe.
7. MP3: conversión local con bitrate de salida 128/192/256, sin prometer mejora.
8. Progreso: bytes reales de red y timestamps de procesamiento cuando sean
   fiables. Cancelación atómica, interrupción de I/O y cierre/liberación de libav.
9. Mantener solo archivo final hasta TTL; compartirlo con expo-sharing existente.
10. Pruebas físicas separadas de consumo, suspensión, almacenamiento insuficiente
    y regresión Direct antes de migrar el routing normal.

Se pueden reutilizar UI, tipos de selección, formatos, errores, utilidades y hoja
Compartir. Jobs/almacenamiento/backend streaming actuales sirven de referencia,
pero no se pueden copiar como procesos/subprocess dentro de iOS. Solo tras validar
el nuevo flujo dejarían de ser necesarios para YouTube el análisis, jobs, descarga
y procesamiento remotos; permanecerían disponibles para Direct. No se eliminan ahora.

## Veredicto

**GO: YouTube on-device en iPhone es técnicamente viable y razonablemente
mantenible para MediaDrop.** La evidencia física demuestra CPython, imports,
yt-dlp, red/TLS del dispositivo, extracción y puente React Native en ARM64 iOS.
La implementación usa un proveedor EJS pequeño en lugar de una bifurcación de
yt-dlp. El GO habilita únicamente continuar el proyecto; no autoriza implementar
la descarga hasta validar el camino EJS real.

Riesgos: cambios frecuentes de YouTube/EJS, desafío de la propia IP móvil,
compatibilidad de extensiones CPython, memoria/temperatura, suspensión de iOS y
renovación periódica de la firma Personal Team. Cambiar el origen a iPhone no
garantiza que YouTube autorice todos los videos públicos. No hay afirmación de
distribuibilidad App Store ni se solicita publicación.

## Referencias primarias

- [Python: ejecución embebida y empaquetado iOS](https://docs.python.org/3/using/ios.html).
- [BeeWare Python-Apple-support](https://github.com/beeware/Python-Apple-support).
- [QuickJS-NG](https://quickjs-ng.github.io/quickjs/).
- [yt-dlp: proveedores de JavaScript](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/jsc/README.md).
- [libavformat: inspección y demux](https://ffmpeg.org/doxygen/trunk/group__lavf__decoding.html).
