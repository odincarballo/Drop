# Drop 1.8.0 · Plan técnico de importación local

[Especificación](local-import-v1.8.0.md) · [Tareas y pruebas](local-import-tasks-v1.8.0.md)

## Arquitectura actual y elección del selector

La [Biblioteca](../mobile/src/services/library.ts) admite archivos ya
preparados dentro de una caché propiedad de Drop. `promoteToLibrary` inserta
una fila `pending`, mueve el archivo al almacenamiento administrado y
confirma la fila como `ready`. Al iniciar, la reconciliación inspecciona las
rutas conocidas y recupera operaciones pendientes. `ready` describe el estado
de la fila. La disponibilidad física se comprueba aparte. El
[repositorio Swift de reproducción](../mobile/modules/drop-playback/ios/PlaybackProgressRepository.swift)
lee la ruta administrada desde SQLite y solo abre filas `ready`.

| Opción | Ventaja | Coste y decisión |
| --- | --- | --- |
| `UIDocumentPickerViewController`, `asCopy: false` | Permite leer la selección autorizada y copiarla directamente al staging de Drop después de medir espacio. | **Elegida.** Requiere gestionar el delegado, el acceso temporal y la lectura coordinada en Swift. El módulo nativo ya existe y el [exportador](../mobile/modules/drop-file-export/ios/DropFileExportModule.swift) sirve de referencia para presentación y cancelación. |
| Selector nativo, `asCopy: true` | El sistema entrega una copia y simplifica el acceso externo. | El proveedor o el sistema pueden copiar antes de que Drop mida espacio y la entrega puede requerir otro temporal. |
| Expo DocumentPicker, SDK 57 | API de JavaScript sencilla y selector del sistema. | `expo-document-picker` no figura en [package.json](../mobile/package.json). La opción predeterminada copia a caché antes de que Drop pueda controlar esa escritura. Desactivarla no sustituye la gestión nativa de la lectura coordinada. |

Usar la pestaña Biblioteca y exponer una operación acotada desde
[DropLibraryModule](../mobile/modules/drop-library/ios/DropLibraryModule.swift).
Presentar el selector en el hilo principal, elegir un solo archivo y finalizar
el delegado exactamente una vez. Pasar a TypeScript solo la referencia al
temporal administrado y los metadatos seguros. iCloud Drive y los proveedores
se usan mediante la selección explícita en Archivos, sin agregar un
contenedor iCloud propio.

## Preparación segura del archivo

1. Abrir la URL elegida en solo lectura. Para una URL externa, exigir acceso
   security-scoped y liberarlo al terminar con `defer`. Coordinar la lectura
   con `NSFileCoordinator` y usar la URL entregada a su callback. Limitar el
   trabajo al archivo seleccionado. Rechazar directorios, paquetes, enlaces
   simbólicos y otros recursos no regulares. Evitar URLs, nombres y rutas
   externas en logs, preferencias o SQLite.
2. Dentro de la lectura coordinada, después de que el proveedor materialice
   el documento, obtener el tamaño real. Si no se puede determinar o es
   cero, informar del fallo. Consultar la capacidad en el volumen de Drop
   antes de escribir. Presupuestar una copia del archivo, un margen de
   confirmación SQLite y la reserva conservadora ya usada como referencia por
   Descargas: el mayor valor entre 1 GiB y el 10 % del espacio disponible al
   comenzar. Usar el motivo de privacidad de espacio en disco aplicable al
   caso. Revalidar espacio durante la copia y antes de promover. Un error
   `ENOSPC` sigue siendo posible si otro proceso ocupa espacio.
3. Copiar por bloques fuera del hilo principal a
   `Caches/DropImport/<uuid>/payload.part`. Confirmar cantidad de bytes y
   cerrar la escritura. Detectar desaparición, truncamiento o crecimiento
   durante la lectura. Una copia del proveedor puede coexistir con la de
   Drop, incluso si Drop solo crea un temporal. Si se cancela mientras se
   espera al proveedor, descartar el resultado tardío y limpiar el temporal
   únicamente después de que el lector haya terminado.
4. Con la copia cerrada, preparar un candidato privado con la extensión
   canónica que se va a validar. Cargar de forma asíncrona con AVFoundation
   la reproducibilidad, la protección, la duración y las pistas. Exigir una pista válida
   del tipo permitido, duración finita y positiva, contenedor compatible
   corroborado con el contenido y reproducción autocontenida. Configurar
   `AVAssetReferenceRestrictions.forbidAll` para impedir referencias externas.
   Si es necesario, confirmar que AVFoundation puede preparar el medio y
   leer una muestra sin tocar el reproductor activo. La validación detecta
   formatos inválidos y corrupciones observables sin decodificar todo el
   archivo. Probar un medio truncado con cabecera válida.
5. Marcar el temporal como preparado solo tras validarlo. Devolver su UUID,
   ruta propia y datos derivados. Aplicar el límite de título
   actual y un fallback si queda vacío. Mantener `sourceVideoId`,
   `thumbnailUrl` y metadatos desconocidos en nulo. Usar `downloadedAt` como
   fecha de incorporación para conservar el orden actual. Conservar la
   portada genérica y evitar extraer arte embebido en esta entrega.

## Promoción, respaldo y recuperación

- Extender el contrato de `promoteToLibrary` para aceptar la fuente preparada
  y su UUID sin generar otro ID. Mantener el flujo `pending → ready`, la
  notificación de Biblioteca y los contratos de Descargas. Validar el token,
  el origen y la ruta en la frontera nativa. Los llamadores que descargan
  siguen produciendo `Media/<uuid>.<ext>`. Una importación usa
  `ImportedMedia/<uuid>.<ext>`.
- Mantener `Media` y `Artwork` con la política actual. Crear
  `Application Support/Drop/ImportedMedia` como carpeta hermana, sin marcar
  el árbol importado como excluido. Comprobar la elegibilidad efectiva del
  archivo después del movimiento desde Caches, ya que los atributos de
  respaldo pueden variar al guardar o mover un archivo. Usar el resolver
  central de [rutas Swift](../mobile/modules/drop-library/ios/DropLibraryPaths.swift)
  y de [almacenamiento](../mobile/modules/drop-library/ios/DropLibraryStorage.swift)
  para inspección, reproducción, exportación y borrado explícito de ambas
  rutas. Prohibir escapes, colisiones y enlaces. El directorio y el UUID los
  elige Drop. Jamás se deriva el destino del nombre original.
- Insertar `pending` antes del movimiento. Exigir promoción en el mismo
  volumen con una operación de renombrado sin reemplazo. Comprobar ruta,
  tamaño y elegibilidad para backup antes de confirmar `ready`. La app
  solo anuncia éxito después de comprobar que la fila y el medio coinciden.
  Usar el mismo UUID en toda recuperación. Sin una segunda copia completa
  de Drop ni una transacción SQLite que permanezca abierta durante la E/S.
- Antes de insertar, un error o cancelación permite limpiar el temporal
  propio. Si el resultado del INSERT es incierto, comprobar el UUID antes
  de borrar. Con fila `pending`, reintentar la promoción con el temporal
  validado o verificar un destino que ya recibió el movimiento. Solo retirar
  la fila pendiente si ambas rutas faltan de forma verificable. Un error de
  lectura, destino ajeno, falta de espacio o resultado SQL incierto conserva
  evidencia y no dispara un borrado. Si el commit final ocurrió pero se
  perdió la respuesta, reconocer la fila `ready` al reabrir.
- Al iniciar, reconciliar SQLite antes del barrido. Limpiar únicamente
  entradas reconocidas de `Caches/DropImport` que Drop creó y que no estén
  activas ni referenciadas por una fila. Ante una consulta fallida, omitir el
  barrido. Mantener los archivos finales importados sin fila fuera del
  borrado automático de huérfanos: una restauración parcial puede haber
  entregado el medio antes que su índice. Registrar el caso para diagnóstico
  sin publicar ni borrar contenido. Un `ready` cuyo archivo falte conserva
  el contrato actual de Biblioteca. No prometer restauración portable.

## SQLite v4 y coordinación con Swift

[El modelo TypeScript](../mobile/src/models/library.ts) y el
[`CHECK` vigente](../mobile/src/services/libraryDatabase.ts) aceptan
`youtube` y `direct`. `direct` ya identifica descargas de URL. Añadir
`local` a ambos contratos en la versión de esquema 4, sin una nueva columna
y sin recodificar filas antiguas. `DropLibraryDatabase.swift` prepara la
ubicación canónica y la recuperación de la ubicación anterior. La migración
de esquema sigue en `libraryDatabase.ts`, que es su dueño actual.

- Inspeccionar la versión y estructura antes de escribir. Validar el
  `CHECK` según versión y comprobar objetos dependientes antes de
  reconstruir. Rechazar esquemas futuros o alterados. Un v0 limpio crea
  directamente v4. Para v1 y v2, completar los pasos históricos en la misma
  transacción de actualización y aplicar el cambio de v3 a v4.
- Para actualizar tablas existentes, seguir el procedimiento de SQLite
  **crear → copiar → retirar la tabla anterior → renombrar la nueva**.
  Usar una conexión de migración privada, con `foreign_keys` desactivadas y
  verificadas en esa conexión **antes** de `BEGIN IMMEDIATE`. Con las
  claves foráneas activas, retirar la tabla padre puede borrar relaciones
  de Colecciones y Cola por cascada. `withExclusiveTransactionAsync`
  abre otra conexión y comienza antes de su callback. No sirve para fijar
  ese PRAGMA dentro del callback.
- Copiar columnas explícitas preservando todos los valores. Recrear
  `library_items_recent`, validar tabla, índices y referencias, y ejecutar
  `foreign_key_check` antes de elevar `user_version` a 4 y confirmar.
  En fallo, revertir. Reactivar claves foráneas fuera de la transacción y
  cerrar la conexión privada aun si falla. Mantener el modo WAL existente
  para actualizaciones y verificar integridad, filas e índices al abrir.
  Cualquier apertura concurrente de Drop espera la preparación compartida.
  Verificar que los accesos Swift abren después de migrar y que los
  escritores independientes conservan su política de contención.
- Probar lectura, borrado explícito, exportación, reproducción y Cola con
  `ImportedMedia`. Los repositorios Swift de progreso y Cola ya leen la
  ruta o referencian el ID. Solo se amplía su código si la prueba demuestra
  una suposición incompatible. Una app anterior no comprende v4. El
  rollback de la transacción se prueba. La reversión de una instalación ya
  migrada exige el respaldo previo y autorización, fuera del MVP.

## Fuentes oficiales

- [Apple · UIDocumentPickerViewController](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)
  y [acceso temporal a documentos](https://developer.apple.com/documentation/foundation/nsurl).
- [Apple · Carga asíncrona de AVFoundation](https://developer.apple.com/documentation/avfoundation/loading-media-data-asynchronously),
  [restricciones de referencias](https://developer.apple.com/documentation/avfoundation/avassetreferencerestrictions)
  y [capacidad del volumen](https://developer.apple.com/documentation/foundation/checking-volume-storage-capacity).
- [Apple · Respaldo de datos de apps](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup).
- [Expo SDK 57 · DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/)
  y [Expo SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).
- [SQLite · Alteraciones de esquema](https://sqlite.org/lang_altertable.html)
  y [claves foráneas](https://sqlite.org/foreignkeys.html).
