# Playback polish v1.2.1 — Block B

Tocar una fila MP4 o M4A reproducible inicia el item antes de abrir la ruta del
reproductor. La selección crea una instantánea de los IDs visibles y reproducibles,
en su orden actual: Descargas usa `downloadedAt DESC, id DESC` (Todos, Videos o
Audio); una Collection usa `addedAt DESC, itemId DESC`; Sin colección usa
`downloadedAt DESC, id DESC`. La siguiente selección manual reemplaza la
instantánea. No hay cola editable ni persistencia del contexto entre procesos.

`DropPlaybackService` conserva el contexto en memoria junto a un único
`AVQueuePlayer` (subclase de `AVPlayer`, compartida por inline, fullscreen y
PiP). Su ventana interna tiene como máximo `CURRENT + NEXT`; no es una cola
editable. Solo recibe IDs. Reserva un lease nativo para el siguiente candidato,
consulta SQLite y valida el registro `ready`, formato y archivo administrado.
Los candidatos inválidos se saltan una sola vez. Prepara el `AVPlayerItem` y su
posición persistida antes de insertarlo detrás del actual; completed empieza en
cero. `actionAtItemEnd = .advance` deja a AVFoundation iniciar el siguiente item
sin esperar callbacks Swift, SQLite o JavaScript después del fin natural. El
`currentItem` observado actualiza identidad, contexto, metadata/Now Playing y
lease; la finalización de A se persiste mientras B ya reproduce. Luego se
prepara C. El último item termina sin repetir. La velocidad seleccionada se
conserva. No se usa `beginBackgroundTask` para sostener el cambio de item.

## Block C1 — Velocidad global

La velocidad seleccionada es una preferencia global nativa, almacenada en
`UserDefaults` mediante `PlaybackRatePreference`, no un campo de `LibraryItem`.
El servicio la carga al inicializarse y configura `AVQueuePlayer.defaultRate`
antes de abrir el primer item. Se conserva entre items manuales, auto-next,
`close`, Delete y relanzamientos. Solo se guardan las velocidades admitidas por
`PlaybackPolicy.rates`; ausencia o valor inválido vuelve a 1×. Un `rate = 0`
transitorio por pausa, buffering o cambio de item no modifica la preferencia.

Pausa, navegación a Biblioteca, background y cambios de salida no activan
auto-next. `leavePlayerScreen` conserva item, lease y contexto; `close` y Delete
del item activo retiran ambos slots y sus leases. Delete del NEXT preparado lo
retira de AVQueuePlayer antes de liberar su lease y busca otro candidato. Un
Delete futuro se salta al llegar a ese ID.
La UI adopta el nuevo ID nativo al recuperar foco/foreground sin abrir un
segundo player. La validación física de Block B está pendiente; los tests y
typecheck no sustituyen una prueba en iPhone.

Limitación visual P1 heredada de Block A: al navegar del reproductor a
Biblioteca, la ventana PiP desaparece aunque el mismo AVPlayer continúa con
audio y al regresar se adopta la sesión. Este bloque no cambia ese comportamiento.
No incluye Queue, shuffle, repeat, mini-player, persistencia de contexto ni el
polish de artwork posterior a C1.
