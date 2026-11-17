# Descargas persistentes · C.2 · almacenamiento de bytes parciales

Base `b6003e7eb74256f2fffa4d5f3e4966f74cc87c1e`. Este bloque incorpora el
almacén y sus operaciones explícitas. La transferencia, la interfaz, la
reanudación HTTP y la entrega del archivo final quedan para C.3.

## Contrato

- La conexión existente de `drop-downloads.sqlite` usa `BEGIN IMMEDIATE`
  y sincronización SQLite FULL. La migración aditiva a v2 y el cambio de
  `user_version` se confirman juntos. Se conserva byte por byte el payload
  v1 de A+B, incluido el comprobante de publicación. Solo se admite una
  fila de parcial. Biblioteca conserva su propia base SQLite v5.
- Una reserva durable exige un intento directo local elegible y su job C.1
  vigente según la información del llamador. Fija ID y generación local,
  ID remoto, longitud total, ETag fuerte y SHA-256 completo. Se almacenan
  únicamente estos valores y el offset y SHA-256 del prefijo confirmado.
  No se persisten credenciales, URLs ni rutas. YouTube sigue fuera de este
  contrato. El almacén no consulta el backend. Al reabrir, el llamador
  debe verificar el parcial antes de usar su offset para una petición.
- Un append compara el checkpoint completo con la fila actual y vuelve a
  comprobar propiedad del intento. Solo escribe al offset confirmado.
  Sincroniza archivo y directorio antes de confirmar el nuevo offset y
  SHA-256 en SQLite. Si falla disco, verificación o COMMIT, el checkpoint
  visible no avanza. Al completar todos los bytes, también exige el
  SHA-256 completo de C.1. C.2 no publica el archivo en Biblioteca.
- El parcial vive en un directorio exclusivo de Application Support,
  marcado como excluido de respaldos del sistema. Su sello vincula el
  intento y la generación con el dispositivo, inodo y fecha de creación.
  Las operaciones usan un nombre fijo relativo a un descriptor de
  directorio y rechazan enlaces y sustituciones.
- La recuperación relee y verifica el prefijo confirmado en bloques de
  hasta 1 MiB. Una cola sobrante de una escritura sin COMMIT se elimina
  únicamente después de validar la identidad y el hash del prefijo.
  Un archivo ausente con offset positivo, truncado, sustituido o corrupto
  no se declara recuperable. La ausencia con offset cero es válida.
- Entre checkpoints contiguos se conserva en RAM un único estado incremental
  SHA-256. Se reconstruye al reabrir, al recuperar explícitamente o al
  encontrar un checkpoint distinto de la memoria. El almacén admite un
  parcial de hasta 100 MiB, bloques de hasta 1 MiB y reserva de 32 MiB
  libres antes de ampliar el archivo. La cuota no limita las descargas
  existentes de A+B. Un error del sistema de archivos se propaga de forma
  segura aunque el cálculo previo de espacio haya sido favorable.
- Invalidar la generación, retirar el intento o pasar a guardado registra
  una intención de descarte en la misma transacción que el cambio de
  propietario. El descarte explícito también confirma la intención antes
  de tocar disco. La limpieza verifica propiedad, mueve el parcial a
  cuarentena y retira solo ese archivo. Si se interrumpe, se puede repetir
  sin recrear la generación descartada. Una sustitución o un objeto sin
  sello se conserva y requiere revisión. Las operaciones soportadas se
  serializan en la conexión de descarga y en el almacén nativo. El bridge
  es interno al diario, que conserva el bloqueo SQLite durante cada llamada.
  El archivo nuevo se crea vacío en `.preparing`. Se sella y sincroniza
  antes de publicar `payload.partial` con un renombrado exclusivo. La
  reapertura desde offset cero puede completar ese paso si acredita el
  sello de una preparación vacía del mismo intento. Una preparación sin
  dueño verificable se conserva bajo un nombre exclusivo fuera de las
  rutas activas. Los nombres canónico y de descarte de otro intento
  sellado quedan protegidos contra operaciones de una generación obsoleta.
  Los objetos sin propiedad demostrable reciben un nombre
  `.preserved-<UUID>` mediante renombrado en el mismo directorio.
  No se vuelven a usar ni se eliminan automáticamente y siguen ocupando
  su espacio original. Ese espacio reduce la disponibilidad del volumen
  consultada antes de cada escritura. Los 100 MiB limitan el parcial
  activo y los archivos apartados se conservan fuera de esa cuota.

## Límites de reanudación

- **100 MiB por parcial.** La cuota cubre el tamaño de salida predeterminado
  del backend y acota el espacio retenido entre lanzamientos. Los límites
  configurables del servidor y los de los otros motores se mantienen.
- **1 MiB por bloque.** El límite acota cada copia de datos del bridge y el
  búfer de verificación. Un archivo de 100 MiB necesita 100 checkpoints
  si se usan bloques completos. C.3 deberá esperar el checkpoint de
  cada bloque antes de entregar el siguiente al almacén. La frecuencia
  final de sincronización queda sujeta a medición física.
- **32 MiB de reserva libre.** Es un margen inicial para SQLite y las
  escrituras del volumen durante el checkpoint. Su suficiencia en iOS
  y el costo bajo carga quedan por medir.

**Requisito para C.3.** La cuota de 100 MiB, el máximo de bloque y la
reserva libre pertenecen exclusivamente al almacén de parciales. Si un
archivo excede la cuota o no dispone del margen para persistir, la descarga
convencional debe seguir disponible bajo sus propias validaciones de
tamaño y espacio. La descarga convencional desde cero debe descartar los
bytes parciales como fuente de la transferencia.

## Corrección del cierre antes del sello

La revisión reprodujo que un cierre antes de `fsetxattr` dejaba el
nombre canónico ocupado e impedía recuperar, descartar o empezar otro
intento. La corrección publica el nombre canónico solo después del
sello y la sincronización, y aparta el huérfano sin sello de la versión
anterior al volver desde offset cero o al descartar.

Las fixtures con disco real cubren los estados antes y después del
sello, antes y después del renombrado, repeticiones de descarte y la
preservación de sustituciones, enlaces y archivos de solo lectura.
La exclusión de respaldos y el comportamiento ante cierres en un
iPhone siguen pendientes de comprobación física.

## Compatibilidad y reversión

Las builds que solo entienden v1 rechazan v2. Una reversión planificada
requiere parar los escritores, verificar un respaldo coherente de
`drop-downloads.sqlite`, completar o descartar el parcial con v2 y comprobar
que no quedan bytes propios pendientes. En una copia de la base se verifica
la retirada transaccional de los triggers y la tabla de C.2 junto con el
retorno de `user_version` a 1. Ejecutar el siguiente SQL exclusivamente
en esa copia, con versión 2 confirmada y sin filas `active` o `discarding`.

```sql
BEGIN IMMEDIATE;
DROP TRIGGER discard_partial_on_attempt_update;
DROP TRIGGER discard_partial_on_attempt_delete;
DROP TABLE download_partial;
PRAGMA user_version = 1;
COMMIT;
```

Verificar `integrity_check`, `user_version` y la igualdad del ID, generación
y payload A+B antes de considerar el uso de la copia. Si se restauró un
respaldo de v2 sin el archivo excluido, un offset positivo resulta no
recuperable y el descarte explícito puede cerrar su registro.
Restaurar un respaldo de antes de migrar es otra opción si se acepta perder
cambios posteriores de ese diario. No hay downgrade automático. La
recuperación ante cierre de proceso no equivale a una prueba de apagado
físico, de presión de disco en iOS ni de ejecución sobre el dispositivo.

## RED → GREEN

Migrar una fila v1 real con comprobante A+B y forzar rollback de DDL.
Usar SQLite real para provocar COMMIT fallido, un UPDATE que cambia cero
filas y un SIGKILL después de fsync y antes de COMMIT. Comprobar recuperación
al reabrir, accesos concurrentes, generaciones obsoletas, descarte reintentado
y conservación del payload A+B. En Swift probar disco real, hash incremental
de varios bloques, cola sin checkpoint, espacio, corrupción, truncamiento,
sustitución del archivo y descarte idempotente.
