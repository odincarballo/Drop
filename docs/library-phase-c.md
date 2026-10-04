# Biblioteca — Subfase C1: Picture in Picture

C1 añade PiP solo al video MP4 local. C1 quedó validado físicamente en iPhone.
El temporizador de apagado (C2) queda fuera de v1.1.0 por decisión de producto;
no es un requisito pendiente para cerrar esta versión. Se conserva un único `AVPlayer`,
un único `AVPlayerItem`, la identidad de Biblioteca y el player lease nativo.
No hay segunda pista de audio ni copia del medio.

`DropPlaybackPiPCoordinator`, propiedad de `DropPlaybackService`, es el único
dueño lógico de PiP. Inline usa `AVPictureInPictureController` con el
`AVPlayerLayer` existente. Fullscreen usa PiP nativo de un
`AVPlayerViewController` estándar; la antigua subclase se eliminó. Antes de
presentar fullscreen se desconecta el controlador inline. Ningún controlador
PiP nuevo se inicia mientras haya una transición activa. La orientación normal
permanece vertical y fullscreen solicita landscape mediante la configuración
versionada y el AppDelegate subscriber existente.

La presentación (`inline`, `fullscreen`, `pipStarting`, `pip`, `pipStopping`,
`restoringUI`, `backgroundAudio`, `closed`) es independiente de play/pausa.
El controlador inline solo se ofrece si iOS soporta PiP, el controlador lo
considera posible y el layer está listo. El inicio manual es una acción del
usuario. El inicio automático se delega a
`canStartPictureInPictureAutomaticallyFromInline` únicamente con video
reproduciéndose y visible; no se simula desde AppState. La configuración de
background audio de `app.json` permanece; no se añade entitlement ni descarga
en segundo plano.

Durante PiP inline el layer de origen permanece retenido incluso si React
desmonta su vista. Se libera tras la parada confirmada y no sobrevive al close
definitivo. Salir de la ruta llama a `leavePlayerScreen(libraryId)`: sin PiP
cierra como antes; con PiP conserva player/item/lease. El callback oficial de
restauración solicita la ruta por `libraryId`; esa ruta adopta el item activo
sin otro `open()`, confirma a AVKit y reconecta la superficie. La confirmación
de restauración tiene plazo acotado; un fallo termina de forma conservadora.
Volver a foreground sin restauración explícita no detiene PiP ni crea una
segunda superficie visible.

Las paradas internas distinguen restauración, Delete, fin natural, reemplazo,
fallo y parada del sistema. Si PiP termina sin restauración confirmada, Drop
persiste y cierra: nunca deja audio oculto por interpretar un `didStop` como
simple retorno a la app. Delete espera la salida PiP antes de retirar el item
y liberar el player lease; export/share conservan sus leases propios. Si AVKit
no confirma la salida, Delete falla de forma segura y no borra el archivo.
Al fin natural se mantiene `completedAt`, se detiene PiP y se limpia Now
Playing. Los callbacks comprueban identidad del controlador y generación del
item para ignorar eventos tardíos.

Now Playing, comandos remotos, progreso y `selectedRate` siguen perteneciendo
a `DropPlaybackService`. La observación del `AVPlayer` ya no depende de que
fullscreen esté abierto; los controles de PiP también sincronizan play/pausa,
rate y seek. Interrupciones y cambios de ruta conservan la política de B3:
`oldDeviceUnavailable` pausa y `newDeviceAvailable` no inicia reproducción.

Límites: disponibilidad y auto-PiP dependen del dispositivo, la preferencia
del usuario y AVKit. El botón se deshabilita si el sistema no puede iniciarlo.
La restauración, auto-PiP, las transiciones fullscreen/PiP y Delete del item
activo en PiP se validaron físicamente en iPhone. El fin natural dentro de PiP
está cubierto por pruebas automatizadas, no por una prueba física específica.
La disponibilidad y el inicio automático siguen sujetos a iOS y a las
preferencias del usuario. El temporizador puede reconsiderarse en una versión
futura, sin formar parte de v1.1.0.
