# Drop v1.2.0-A — Collections

Esta especificación fija las decisiones de arquitectura de Collections antes de
implementarlas. El alcance es organización lógica y persistente de elementos ya
administrados por la Biblioteca. No cambia el contrato de descarga ni la propiedad
de los archivos.

## 1. Alcance y modelo funcional

- `library_items` sigue siendo la fuente de verdad del medio, portada, metadatos,
  progreso, estado de reproducción y ciclo de vida. Un elemento puede pertenecer a
  cero, una o varias Collections mediante `collection_items` (many-to-many).
- Una Collection conserva su identidad aunque quede vacía. El usuario puede crearla,
  renombrarla y eliminarla, así como añadir y quitar membresías.
- Añadir un elemento no mueve ni copia `Media/` o `Artwork/`, ni cambia el espacio
  ocupado. Collections no es dueña de archivos. Exportar, compartir, reproducir y
  eliminar un medio siguen usando el `LibraryItem` y sus leases existentes.
- Eliminar una Collection borra su fila y sus membresías, nunca sus LibraryItems,
  medios o portadas. Eliminar un LibraryItem sigue su flujo `deleting`; al borrar
  su fila se eliminan sus membresías por cascade.

## 2. Fuera de alcance

Collections no es playlist ni queue: no hay reproducción secuencial, auto-next,
reordenamiento manual, reglas automáticas, orden configurable, búsqueda, favoritos,
importación de archivos, ni copias multimedia por Collection. Esta fase tampoco
cambia el downloader, el reproductor, el esquema de progreso o el bundle estable.

## 3. Esquema v2 objetivo

La migración será aditiva sobre `library.sqlite` en su ruta canónica. No se crean
estas tablas en la fase de especificación.

```sql
CREATE TABLE collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  normalizedName TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE collection_items (
  collectionId TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  addedAt TEXT NOT NULL,
  PRIMARY KEY (collectionId, itemId)
);

CREATE INDEX collection_items_by_item
  ON collection_items(itemId, collectionId);
CREATE INDEX collection_items_recent
  ON collection_items(collectionId, addedAt DESC, itemId DESC);
```

`id` será un UUID interno; las fechas se escribirán en UTC ISO 8601. El índice
único de `normalizedName` es la defensa final contra duplicados, incluso ante
operaciones concurrentes. No se guarda una columna de conteo ni de tamaño: se
derivan de las filas existentes y el almacenamiento se contabiliza una sola vez
por LibraryItem.

## 4. Foreign keys y migración

La conexión Expo que ejecuta la migración, las operaciones de Collections y los
`DELETE` de `library_items` de los que dependen las cascades debe activar
`PRAGMA foreign_keys = ON` **fuera de una transacción** y verificarlo con una
lectura posterior en esa conexión. No basta con confiar en otra conexión. La
conexión nativa de progreso no modifica Collections ni memberships.

La migración lógica `user_version = 1` → `2` será aditiva y se ejecutará en una
transacción exclusiva: crear tablas e índices, verificar el resultado y fijar
`user_version = 2` únicamente al final de una operación exitosa. Todo fallo hace
rollback completo; no debe quedar un esquema parcialmente v2 que se anuncie como
válido. Reabrir una base v2 es idempotente. Una instalación limpia debe terminar
directamente en un esquema v2 íntegro. Versiones futuras desconocidas se rechazan
sin escritura destructiva.

La migración no modifica `library_items`, `Media/`, `Artwork/`, sus rutas,
`playbackPositionSeconds`, `completedAt`, metadata, `sizeBytes`, `downloadedAt` ni
`lifecycle`. Los LibraryItems preexistentes empiezan con cero memberships; no se
crean Collections automáticamente. El módulo nativo
`DropLibraryDatabase.prepare()` conserva su responsabilidad actual de preparar la
ruta y recuperar la ubicación SQLite legacy: **no** es dueño de la migración
lógica v1 → v2. El helper de apertura de Expo será el único punto de bootstrap y
migración lógica, compartido por Biblioteca y Collections.

## 5. Contrato exacto de nombres

Habrá una sola implementación autoritativa del siguiente algoritmo en un helper
nativo Swift, reutilizado por el servicio para crear y renombrar. La UI puede
mostrar errores, pero no mantiene otra normalización. SQLite almacena y compara
el resultado; no usa `NOCASE` como sustituto.

1. Rechazar cualquier Unicode scalar perteneciente a
   `CharacterSet.controlCharacters`; no eliminarlo silenciosamente.
2. Tratar como whitespace válido los scalars de `CharacterSet.whitespaces`:
   quitarlo de los extremos y colapsar cada secuencia interior a un único
   `U+0020 SPACE`. Los saltos de línea se rechazan en el paso anterior.
3. Canonicalizar el resultado a NFC, equivalente en Swift a
   `precomposedStringWithCanonicalMapping`. Este valor es `name`: conserva
   capitalización, acentos, símbolos y emoji válidos.
4. Rechazar `name` vacío y limitarlo a 1–80 *extended grapheme clusters*, medidos
   con `String.count`/`Character`, no con bytes UTF-8 ni unidades UTF-16.
5. Desde `name`, aplicar exclusivamente case folding insensible a mayúsculas
   mediante `folding(options: [.caseInsensitive], locale: Locale(identifier:
   "es"))`; no usar el locale del dispositivo, `.diacriticInsensitive` ni
   `.widthInsensitive`. Canonicalizar de nuevo a NFC. Este valor es
   `normalizedName`.

Así, `Música` y `música` colisionan; `Musica` y `Música` son distintos;
`Cursos  Python` y `Cursos Python` colisionan. La validación de «Sin colección»
usa **el mismo helper**: se rechaza cualquier nombre cuyo `normalizedName` sea
igual al de esa etiqueta reservada. No existe una fila ni una constraint SQLite
especial para la vista virtual. Una vez publicado `normalizedName`, cambiar el
algoritmo es un cambio de datos y puede exigir migración explícita.

## 6. CRUD y membresías

- Crear: normalizar, validar nombre reservado, generar UUID y fecha; insertar en
  transacción. Un conflicto `UNIQUE(normalizedName)` se convierte en un error
  comprensible, sin reemplazar una Collection existente.
- Renombrar: aplicar el mismo helper y la misma restricción única; conservar ID,
  fecha de creación y membresías; actualizar `updatedAt` solo si se confirma.
- Eliminar Collection: confirmar en UI; borrar su fila en transacción, dejando a
  SQLite eliminar membresías por cascade. No invocar Delete de Biblioteca.
- Añadir membresía: exigir Collection existente y LibraryItem `ready`; insertar
  una vez. La clave compuesta impide duplicados. Repetir una adición no debe
  cambiar `addedAt` ni reordenar silenciosamente.
- Quitar membresía: borrar solo la pareja `(collectionId, itemId)`, sin tocar el
  LibraryItem. Repetir una eliminación ya completada es seguro.

Las operaciones se serializan con transacciones del helper de base de datos. Si
una adición se confirma antes de que Delete marque el elemento `deleting`, la
vista lo oculta y la eliminación final de la fila hará cascade. Si Delete gana
primero, la adición se rechaza. En ningún orden debe quedar una membresía huérfana
ni borrarse un archivo desde Collections. La conciliación de Biblioteca que borra
filas faltantes también depende de la misma conexión con foreign keys activas.

## 7. Vista «Sin colección» y orden

«Sin colección» es una consulta virtual de LibraryItems `ready` sin ninguna
membresía (`NOT EXISTS`), no una Collection ni un propietario de archivos. Un
elemento en varias Collections no aparece allí. Las vistas de Collections
excluyen elementos `pending` y `deleting` aunque una membresía exista todavía
durante un Delete diferido.

Dentro de una Collection el orden predeterminado es
`collection_items.addedAt DESC, itemId DESC`; los timestamps iguales tienen así
un desempate estable. Descargas conserva `downloadedAt DESC` y su desempate
actual. Esta fase no introduce orden manual.

## 8. Observación e invalidación

El servicio de Collections expondrá CRUD, consultas y una suscripción a cambios
de datos. Emitirá invalidación después de commits, no antes ni tras rollback.
Las pantallas enfocadas recargarán su consulta cuando cambie una Collection,
una membresía o el estado de un LibraryItem. Se reutilizará la observación de
Biblioteca para promoción, Delete y conciliación, sin copiar su lista completa
como fuente de verdad de Collections. La posición de reproducción podrá seguir
refrescándose con el mecanismo existente sin escribir memberships. Conteos y
«Sin colección» se derivan del estado actual, no de cachés persistentes.

## 9. UI mínima

Biblioteca añadirá una navegación interna `Descargas | Colecciones` sin cambiar
la navegación principal `Descargar | Biblioteca` ni mover Ajustes. Descargas
mantiene filtros, espacio utilizado y acciones actuales. Colecciones muestra
una lista sencilla, permite crear/renombrar/eliminar y conserva las vacías. El
detalle reutiliza la fila y las acciones de LibraryItem, con orden por `addedAt`.
Un selector de Collection permite añadir o quitar un elemento en varias
Collections sin moverlo ni duplicarlo. Se muestran errores de nombres, conflictos
y elementos no disponibles sin rutas internas ni mensajes SQL crudos. La vista
virtual «Sin colección» se presenta junto a las Collections, no se puede
renombrar ni eliminar.

## 10. Estrategia de pruebas

- **SQLite real:** base v1 con LibraryItems de prueba → v2 conserva filas,
  progreso y metadata; instalación limpia v2; fallo inyectado → rollback y
  `user_version` intacto; reapertura idempotente; foreign keys verificadas por
  conexión; cascades de Collection y LibraryItem; índices/orden; rechazo de
  membresías huérfanas y versiones desconocidas.
- **Servicio:** CRUD, nombre reservado, duplicados y renombre concurrente;
  normalización con whitespace Unicode, NFC, acentos, mayúsculas, controles,
  emoji y límites 1/80/81 graphemes; añadir/quitar idempotente; `ready` frente
  a `pending`/`deleting`; carrera add ↔ Delete, Delete con leases, conciliación,
  suscriptores tras commit y ausencia de copias físicas.
- **UI:** tabs internos, Collections vacías, detalle, selector múltiple,
  «Sin colección», orden, nombres inválidos, estados faltantes y regresión de
  reproducción, exportación, compartir, Delete, espacio y filtros de Descargas.
  Los mocks unitarios existentes de Jest no sustituyen las pruebas SQLite reales.
- **Integración:** suites Swift y móviles relevantes, TypeScript, lint, formato,
  `git diff --check`, build Release ARM64 aislada y verificación de firma. No se
  instala sobre la app estable durante los bloques de implementación.

## 11. Migración física sin riesgo para Drop estable

La primera prueba física v1 → v2 usará un bundle ID **separado** de
`com.odincarballo.mediadrop`; no tocará la Biblioteca personal estable. Sobre
ese ID de prueba se instalará una build v1.1.0, se crearán LibraryItems
controlados y se registrarán antes de la actualización número de filas, estado,
Media/Artwork, metadata, progreso y `completedAt`. Luego se instalará v1.2.0
encima de la misma app de prueba y se comparará cada dato, además de crear,
renombrar, poblar y borrar Collections. La prueba también verificará que
reproducción y exportación siguen encontrando los medios. Nunca se desinstala la
app de prueba entre ambas builds. Esta prueba no se ejecuta en la fase actual.

## 12. Riesgos y medidas

- `PRAGMA foreign_keys` es por conexión: activarlo y leerlo antes de depender de
  cascade; cubrir la conexión usada por el Delete/conciliación actuales.
- Un fallo de migración no puede anunciar v2: transacción exclusiva, versión al
  final, rollback y prueba con fallo inyectado.
- Una UI con datos obsoletos puede intentar añadir un elemento ya `deleting`:
  validar dentro de la transacción y tratar la carrera sin archivos huérfanos.
- Cambios futuros de Unicode/locale pueden alterar claves persistidas: mantener
  un helper autoritativo y versionar cualquier cambio del algoritmo.
- Un medio ausente o corrupto no debe aparecer como reproducible por estar en
  una Collection: usar la validación y conciliación existentes de Biblioteca.
- La primera migración física usa un contenedor separado y datos sintéticos;
  nunca la Biblioteca personal estable.

## 13. Bloques de implementación

Cada bloque se valida antes de iniciar el siguiente:

1. **Block 1 — Datos:** helper de apertura, esquema v2, migración, foreign keys,
   rollback y pruebas con SQLite real.
2. **Block 2 — Servicio:** CRUD de Collections y membresías, helper de nombres,
   concurrencia, invalidación y pruebas de servicio.
3. **Block 3 — UI:** navegación `Descargas | Colecciones`, detalle, selector,
   filas compartidas y pruebas de UI.
4. **Block 4 — Regresión:** suites completas pertinentes y Release ARM64 desde
   checkout aislado del árbol exacto.
5. **Block 5 — Validación física:** actualización real v1.1.0 → v1.2.0 en el
   bundle de prueba separado; comparación de datos y smoke test funcional.

Ninguno de estos bloques se implementa mediante este documento.
