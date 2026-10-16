# Playback polish v1.2.1 — Block B

Tocar una fila MP4 o M4A reproducible inicia el item antes de abrir la ruta del
reproductor. La selección crea una instantánea de los IDs visibles y reproducibles,
en su orden actual: Descargas usa `downloadedAt DESC, id DESC` (Todos, Videos o
Audio); una Collection usa `addedAt DESC, itemId DESC`; Sin colección usa
`downloadedAt DESC, id DESC`. La siguiente selección manual reemplaza la
instantánea. No hay cola editable ni persistencia del contexto entre procesos.

`DropPlaybackService` conserva el contexto en memoria junto al único `AVPlayer`.
Solo recibe IDs: para cada candidato vuelve a consultar SQLite, valida el
registro `ready`, formato y archivo administrado antes de adquirir el player
lease. Al recibir el fin natural del `AVPlayerItem`, persiste posición final y
`completedAt`, avanza solo hacia adelante y reproduce el primer candidato
disponible. Los candidatos eliminados, ausentes o no reproducibles se saltan a
lo sumo una vez. El último item termina sin repetir ni volver al inicio. El
siguiente item conserva la velocidad elegida, reanuda su progreso parcial o
empieza en cero si estaba completado. Now Playing se reemplaza al cambiar de
item. Esta secuencia, incluida la transición con pantalla bloqueada, es nativa:
no necesita `PlayerScreen` ni listeners JavaScript activos.

Pausa, navegación a Biblioteca, background y cambios de salida no activan
auto-next. `leavePlayerScreen` conserva item, lease y contexto; `close` y Delete
del item activo lo invalidan. Un Delete futuro se salta al llegar a ese ID.
La UI adopta el nuevo ID nativo al recuperar foco/foreground sin abrir un
segundo player. La validación física de Block B está pendiente; los tests y
typecheck no sustituyen una prueba en iPhone.

Limitación visual P1 heredada de Block A: al navegar del reproductor a
Biblioteca, la ventana PiP desaparece aunque el mismo AVPlayer continúa con
audio y al regresar se adopta la sesión. Este bloque no cambia ese comportamiento.
No incluye Queue, shuffle, repeat, mini-player, persistencia de contexto o
velocidad global, ni el polish de artwork de Block C.
