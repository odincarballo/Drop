# Drop v1.2.1 — playback polish

Estas fuentes preparan v1.2.1; la Release Candidate final, su instalación sobre
Drop estable, el merge, el tag y la GitHub Release todavía no se han realizado.

## Continuidad y contexto de reproducción

Navegar fuera de `PlayerScreen` ya no destruye la reproducción nativa. Tocar un
MP4 o M4A reproducible inicia el item antes de abrir la ruta del reproductor.
La selección crea una instantánea de los IDs visibles y reproducibles, en su
orden actual: Descargas usa `downloadedAt DESC, id DESC` (Todos, Videos o
Audio); una Collection usa `addedAt DESC, itemId DESC`; Sin colección usa
`downloadedAt DESC, id DESC`. La siguiente selección manual reemplaza la
instantánea. No hay cola editable ni persistencia del contexto entre procesos.

`DropPlaybackService` conserva el contexto en memoria junto a un único
`AVQueuePlayer` (subclase de `AVPlayer`, compartida por inline, fullscreen y
PiP). Su ventana interna tiene como máximo `CURRENT + NEXT`; es un mecanismo
interno, no una Queue de producto. Solo recibe IDs. Reserva un lease nativo para
el siguiente candidato, consulta SQLite y valida el registro `ready`, formato y
archivo administrado. Los candidatos inválidos se saltan una sola vez. Prepara
el `AVPlayerItem` y su posición persistida antes de insertarlo detrás del
actual; completed empieza en cero. `actionAtItemEnd = .advance` deja a
AVFoundation iniciar el siguiente item sin esperar callbacks Swift, SQLite o
JavaScript después del fin natural. El `currentItem` observado actualiza
identidad, contexto, metadata/Now Playing y lease; la finalización de A se
persiste mientras B ya reproduce. Luego se prepara C. El último item termina
sin repetir. Progreso y `completedAt` siguen persistentes. No se usa
`beginBackgroundTask` para sostener el cambio de item.

Pausa, navegación a Biblioteca, background y cambios de salida no activan
auto-next. `leavePlayerScreen` conserva item, lease y contexto; `close` y Delete
del item activo retiran ambos slots y sus leases. Delete del NEXT preparado lo
retira de `AVQueuePlayer` antes de liberar su lease y busca otro candidato. Un
Delete futuro se salta al llegar a ese ID. La UI adopta el nuevo ID nativo al
recuperar foco/foreground sin abrir un segundo player.

## Velocidad global y portada

La velocidad seleccionada es una preferencia global nativa, almacenada en
`UserDefaults` mediante `PlaybackRatePreference`, no un campo de `LibraryItem`.
El servicio la carga al inicializarse y configura `AVQueuePlayer.defaultRate`
antes de abrir el primer item. Se conserva entre items manuales, auto-next,
`close`, Delete y relanzamientos. Solo se guardan las velocidades admitidas por
`PlaybackPolicy.rates`; ausencia o valor inválido vuelve a 1×. Un `rate = 0`
transitorio por pausa, buffering o cambio de item no modifica la preferencia.

La portada estática del reproductor de audio usa `contain`: muestra la imagen
completa, centrada y sin recorte ni deformación dentro del cuadro existente. El
icono fallback sigue la misma política. Esto solo afecta la presentación de
`PlayerScreen`; el archivo y el artwork de Now Playing no cambian.

## Validación física y límites

En la app de prueba se verificaron auto-next en foreground, audio → video y
avance al siguiente item sin interacción con el iPhone bloqueado. Se verificó
también que 1.5× persiste tras cerrar completamente y relanzar la app, y que la
portada se muestra completa sin crop. La regresión PiP video → Biblioteca
quedó validada: la ventana permanece visible y la reproducción continúa; no es
una funcionalidad nueva independiente de este polish.

No incluye Queue editable, playlists, mini-player, sleep timer, descargas en
background ni persistencia del Playback Context entre procesos.
