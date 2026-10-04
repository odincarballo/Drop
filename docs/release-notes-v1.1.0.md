# Drop v1.1.0 — notas de la candidata

Drop 1.1.0 build 3 es una candidata para validación física final; todavía no
es una Release aprobada. Mantiene el bundle ID y Team de v1.0.1, sin modificar
la versión estable ni su tag.

## Descargas

- Mayor resiliencia de descargas YouTube por rangos y diagnóstico sanitizado.
- 1080p Fase 1 para MP4/H.264 directo, hasta 30 fps y 50 MiB de video. Se
  rechaza HDR identificado; rango dinámico no informado puede aceptarse, pero
  **no** se presenta como SDR confirmado.
- Recuperación acotada de audio YouTube ante HTTP 403: una sola reextracción de
  la misma identidad y reinicio del audio desde cero, sin volver el 403
  generalmente reintentable. El flujo normal se validó físicamente; la ruta
  automática de 403 está cubierta por pruebas deterministas, pues el 403 real
  no volvió a reproducirse tras instalar la corrección.
- Descargas largas: máximo 1 GiB por pista de video 360p/720p, 250 MiB por
  pista de audio y comprobaciones dinámicas de espacio libre; 1080p conserva
  el límite de 50 MiB. La política se validó físicamente con una descarga de
  aproximadamente 457 MB y 2 h 25 min.

## Biblioteca y reproducción

- Biblioteca offline persistente para nuevas descargas, con medio y portada
  locales, metadatos SQLite, espacio ocupado, Delete, Compartir y Guardar en
  Archivos con nombre amigable. Biblioteca y exportación a Files son copias
  independientes; el archivo interno conserva un nombre UUID.
- Reproductor local de MP4/M4A con un único AVPlayer y un único item activo:
  Play/Pausa, timeline con scrubbing, ±15 s, velocidades 0.75–2×, progreso
  persistente, reanudación y reproducción desde cero tras completarse.
- Fullscreen con orientación horizontal, salida por X o gesto interactivo y
  cancelación de gesto sin pérdida de posición ni estado playing/paused.
- Audio en segundo plano y con el interruptor de silencio activo; Now Playing,
  Lock Screen, Control Center, AirPods/Bluetooth, interrupciones y cambios de
  salida con pausa segura al desconectar audífonos.
- Picture in Picture para video local: inicio manual inline, auto-PiP al ir
  Home cuando iOS lo permite, PiP desde fullscreen, restauración a Drop y
  preservación de posición, playing/paused y velocidad. Delete del item activo
  cierra PiP y respeta el player lease antes de borrar el medio.

## Alcance y evidencia

PiP, fullscreen, reproducción, Biblioteca y las descargas indicadas tuvieron
validación física de sus flujos descritos. El fin natural de video dentro de
PiP cuenta con pruebas automatizadas, no con una prueba física específica.

No forman parte de v1.1.0: temporizador de apagado, cola, playlists, búsqueda,
favoritos, descargas en segundo plano, Chromecast, CarPlay específico, widgets
ni Live Activities. No se añade acceso a contenido privado, de pago o con DRM
ni mecanismos para eludir controles de acceso. Los recursos directos conservan
su arquitectura existente.
