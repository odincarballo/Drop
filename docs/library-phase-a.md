# Drop v1.1.0 — Biblioteca, subfase A

Esta subfase guarda automáticamente las **descargas nuevas** completadas dentro de Drop.
No importa archivos previamente exportados a Archivos y aún no incorpora reproducción.
«Guardar en Archivos» continúa exportando una copia independiente mediante el picker de iOS.

## Ciclo de vida

- Las transferencias, la normalización M4A y el mux continúan usando sus rutas temporales actuales en Caches.
- Solo al recibir el evento final válido se inspecciona un archivo regular en una ruta temporal propiedad de Drop.
- SQLite inserta `pending` con un ID UUID, metadatos limitados y una ruta de Caches **relativa**.
- Un módulo nativo mueve, no copia, el medio a `Library/Application Support/Drop/Media/<id>.<ext>`.
- Se verifica tamaño y existencia; luego SQLite confirma `ready`. La UI no muestra éxito antes de `ready`.
- Un fallo de movimiento sin destino elimina el origen y el registro pendiente. Si el movimiento ocurrió pero falló la confirmación, el registro `pending` permite recuperarlo al siguiente arranque.
- Al iniciar, la conciliación de la Biblioteca ocurre **antes** del barrido de Caches. Resuelve `pending`, oculta entradas sin medio, termina `deleting` y limpia medios/portadas huérfanos administrados por Drop.
- El borrado confirmado marca `deleting` y retira inmediatamente la entrada de la lista. El archivo se elimina después de terminar cualquier lease de exportación/compartir. Un cierre abrupto deja `deleting` para el siguiente arranque.

La base `library.sqlite` usa `PRAGMA user_version = 1`; las rutas persistidas son relativas. No se guardan URLs firmadas ni tokens. El medio se denomina con UUID, jamás con un título remoto.

SQLite se abre en `Library/Application Support/Drop/library.sqlite`, la misma raíz canónica que `Media` y `Artwork`. Antes de abrir la conexión, el módulo nativo reconoce una base de versiones anteriores guardada bajo la carpeta **literal** `Application%20Support`, la copia con la API de backup de SQLite (incluido WAL confirmado), verifica integridad y número de registros, y solo entonces elimina los archivos antiguos. Si existen dos bases, no sobrescribe ni mezcla datos: conserva ambas y detiene la apertura con un diagnóstico de conflicto.

## Portadas y backup

La portada de YouTube es opcional. Solo se admite una URL HTTPS de `ytimg.com` o sus subdominios, sin credenciales ni query; cada redirección se valida. La respuesta debe ser imagen reconocida, se limita a 2 MiB y 16 millones de píxeles, se reduce a aproximadamente 512 px y se guarda como JPEG. Una portada fallida o corrupta usa el asset local de Drop y no invalida el medio.

Medios y portadas en Application Support están marcados `isExcludedFromBackup` para no introducir cientos de MiB en iCloud Backup. La base y metadatos pueden respaldarse; tras una restauración sin medios, el conciliador retira las entradas faltantes. Biblioteca persiste entre reinicios y actualizaciones sobre la misma instalación, **no** se promete restauración tras desinstalar Drop. El usuario puede exportar una copia a Archivos si desea conservarla aparte.

## Alcance y siguiente subfase

La Biblioteca permite listar, filtrar, ver espacio real ocupado, exportar, compartir y eliminar. `playbackPositionSeconds` y `completedAt` quedan en el esquema para la subfase B. No hay AVPlayer, audio en segundo plano, Now Playing, PiP ni temporizador en esta subfase. El downloader, límites, retry, selección de formatos y Render no se modifican.
