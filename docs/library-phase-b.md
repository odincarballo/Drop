# Biblioteca — Subfase B: reproducción local

El Paso 1 incorporó un único
`AVPlayer` nativo, controlado mediante `DropPlayback.open(libraryId)` y órdenes
play/pause/seek/skip/rate/close. Solo acepta el ID de un registro `ready` de
Biblioteca y resuelve su archivo regular dentro de `Application Support/Drop/Media`.
La garantía inicial es MP4 de video y M4A de audio; otros formatos conservan
Exportar, Compartir y Eliminar, pero `open` devuelve formato no compatible.
No hay autoplay ni red.

## Retención y eliminación

El servicio reserva un lease nativo antes de leer SQLite o cargar el asset y lo
mantiene mientras el `AVPlayerItem` esté activo. `beginDelete(id)` bloquea nuevas
aperturas de ese ID y cierra/descarga el item activo, guardando progreso antes
de liberar el lease. Biblioteca llama esta barrera **antes** de pasar el registro
a `deleting`; solo después puede borrar físicamente. El contador JavaScript de
exportación/compartir continúa reteniendo el mismo medio hasta que termina su
operación. `endDelete(id)` libera la barrera: los registros `deleting` siguen
sin poder abrirse. Cada callback nativo verifica la generación del item para
ignorar notificaciones tardías tras cambio, cierre o eliminación.

## Progreso y finalización

La UI recibe estado aproximadamente cada segundo. Un repositorio
nativo separado del AVPlayer actualiza los campos existentes
`playbackPositionSeconds` y `completedAt` cada 12 segundos de reproducción y
al pausar, seek, cerrar, cambiar de item o finalizar. Usa conexiones SQLite
breves y serializadas, compatibles con WAL; `SQLITE_BUSY` tiene hasta tres
intentos acotados (150 ms de busy timeout por intento y 50/100 ms de espera).
Nunca crea otra base. La persistencia no necesita JavaScript activo.

Un item se marca terminado cuando AVPlayer informa fin real o al alcanzar los
últimos `min(30 segundos, 5 % de duración válida)` durante reproducción. Solo
abrir o hacer seek cerca del final no lo marca terminado. Si el registro estaba
terminado, se prepara desde cero sin autoplay. Al reproducir o buscar una
posición anterior al umbral, se limpia `completedAt`. Posiciones no finitas o
duraciones desconocidas no generan finalización.

## Paso 2: interfaz y superficie de video

Biblioteca abre una ruta por `libraryId`; nunca entrega la ruta del medio al
reproductor. Una Expo View dibuja el `AVPlayer` único mediante `AVPlayerLayer`.
La presentación fullscreen usa `AVPlayerViewController` con ese mismo player e
item, sin reiniciar la reproducción. PiP se añadió posteriormente en C1. El `app.json`
versionado declara orientaciones posibles y un AppDelegate subscriber limita
las pantallas normales a portrait, permitiendo landscape solamente durante
fullscreen. Al salir, incluso mediante Done/gesto o cierre de la ruta, restaura
portrait. Las transiciones y el dismiss interactivo se validaron físicamente
en iPhone tras los ajustes de C1.

La velocidad seleccionada se guarda en el servicio aparte de `AVPlayer.rate`:
pausado, `AVPlayer.rate` es cero, pero la UI conserva 0.75–2× y Play reanuda
con la selección. La barra muestra posición aproximadamente cada segundo;
durante arrastre solo actualiza la vista y al soltar emite un único seek. Al
abandonar realmente la ruta sin PiP se llama `close()` una sola vez; con PiP
activo, C1 conserva player, item y lease hasta restauración o cierre. Biblioteca
se refresca al recuperar foco. Abrir no reproduce automáticamente. Un elemento
terminado se prepara en cero y ofrece “Reproducir de nuevo”.

## Paso 3: audio del sistema y segundo plano

El mismo `AVPlayer` usa `audiovisualBackgroundPlaybackPolicy = .continuesIfPossible`
para mantener el audio de M4A y MP4 al bloquear el iPhone o cambiar de app.
`UIBackgroundModes = audio` se genera desde `mobile/app.json`; no habilita
descargas en segundo plano. `AVAudioSession.Category.playback` se configura y
activa al empezar la reproducción, no al abrir Drop. Esto permite audio con
el interruptor de silencio activo. Al cerrar el item se desactiva la sesión
cuando es posible.

Now Playing publica título, duración, posición, velocidad efectiva y portada
local de Biblioteca; si falta o falla la portada se usa un recurso local de
reserva. La imagen se decodifica fuera del hilo principal y se reduce a un
máximo de 512 píxeles. No se consulta ninguna URL remota. El tiempo se
actualiza en cambios importantes y, durante reproducción, como máximo cada
15 segundos; iOS extrapola entre actualizaciones. Los comandos estándar de
play, pause, ±15 segundos y seek actúan sobre el mismo servicio. No hay cola:
next/previous/shuffle/repeat quedan deshabilitados.

Una interrupción guarda progreso y recuerda si el usuario estaba reproduciendo.
Solo se reanuda si iOS indica `shouldResume`, el item/generación sigue siendo
el mismo y el usuario no pausó ni cerró durante la interrupción. Al perder
una salida de audio (`oldDeviceUnavailable`) se pausa para evitar sonido
inesperado por el altavoz; conectar una salida nueva no inicia la reproducción.
Comandos y notificaciones tardías se ignoran por generación. Close, cambio
de item y Delete retiran controles y metadata antes de soltar el player lease.

React Native no cierra el reproductor por un cambio de `AppState` a background;
la ruta solo lo cierra al navegar realmente fuera. Al volver a foreground,
la pantalla solicita el estado nativo actualizado, incluido progreso y
velocidad seleccionada. La persistencia periódica (~12 s de reproducción
efectiva) sigue siendo nativa y no depende de JavaScript activo.

## Estado posterior a B

El audio en segundo plano, Lock Screen, Bluetooth/AirPods y cambios de salida
se validaron físicamente en iPhone. C1 añadió y validó PiP para video local;
véase [la documentación de C1](library-phase-c.md). El temporizador de apagado
queda fuera de v1.1.0 por decisión de producto. No se añadieron descargas en
segundo plano.
