# Drop 1.8.1 · Metadatos y portadas locales

Contrato SDD preparado el 8/11/2026. A/A.1 implementados y verificados en host;
cerrados en commit local; B/B.1 cerrados en bf72e954cbad4682cba2dfc66bb66ff9e618870a.
C/C.1 implementados y verificados para cierre local; Unicode de borde corregido.
D implementado/verificado y revisado para cierre local. E1 autorizado por separado.
Los resultados C previos se amplían con regresiones C.1 y D.
Base: checkpoint `8e6ade1ba6e60a036623b20af02aa76d25435864`, rama publicada
`codex/v1.8.0-local-import`. Trabajo local: `codex/v1.8.1-local-metadata`.
Versión/build permanecen 1.8.0/18 hasta autorización de candidata.
[Estado operativo](engineering-state.md) · [Importación existente](local-import-v1.8.0.md).

## Base real y alcance

1.8.0 tiene PASS manuales principales confirmados por el usuario en reprotest;
no equivale a release pública ni actualización de la original. Preservar ambas
instalaciones y sus respaldos. No repetir pruebas físicas ahora.

En la base 1.8.0, `LibraryMetadata` y SQLite v4 tienen título, tipo, duración y referencia/tamaño de
portada; no tienen artist/album/genre/year. `DropLocalMediaInspection` valida el
medio y duración; `DropLibraryStorage.stageLocalFile` deriva título del nombre.
`saveJPEG` normaliza a JPEG/512px y limita imágenes; `saveArtwork` del bridge está
restringido a HTTPS de YouTube. Mantener esa autorización sin ampliarla a URLs
arbitrarias. Reutilizar biblioteca, leases, notificaciones y resolver existentes.

Solo medios `sourceKind=local`: MP3 de audio, M4A/AAC y MP4 con video, como 1.8.0.
No nuevas extensiones/codecs, descarga de imágenes, dependencia nueva, parsing
manual de contenedores, transcodificación ni cambios en PlaybackService.
El archivo multimedia y su nombre físico administrado nunca se reescriben.

## Contrato de extracción

- Swift/AVFoundation, asíncrono fuera del hilo principal. Leer la copia local
  validada, no volver al original de Archivos ni a su proveedor. Prohibir referencias
  externas como en la inspección existente. Sin red, cuentas o URLs de portada.
- MP3/M4A: título, artista, álbum, género y año opcionales; artwork incrustado
  opcional. Metadatos comunes más espacios ID3/iTunes cuando estén disponibles.
  No prometer compatibilidad con toda etiqueta que AVFoundation no exponga.
- Preferir identificadores específicos del contenedor y completar con comunes;
  precedencia determinista, primer valor válido, artista de pista antes que artista
  de álbum. No confundir autor/compositor con artista ni fecha de archivo con año.
  Género numérico no interpretable queda ausente; no inventar una clasificación.
- Texto recortado, normalizado y sin caracteres de control, máximo 240 caracteres
  por campo. Vacío equivale a ausente. Año entero 1–9999 desde etiqueta de año o
  prefijo YYYY de fecha musical válida; si es ambiguo, ausente. No usar mtime.
- MP4: un fotograma en min(1 segundo, duración/2), tolerancia temporal limitada,
  orientación aplicada y encuadre proporcional; no buscar el fotograma ideal.
  Un fallo conserva fallback. No ampliar a extracción de textos MP4 en este alcance.
- Resultado parcial tipado: campos opcionales y estado de portada, con diagnóstico
  acotado, sin nombres/rutas personales. Ninguna imagen/base64 cruza a JavaScript.
  Cancelación cooperativa y cancelación de generación; no presentar un timeout
  como garantía de que AVFoundation haya detenido internamente toda operación.

## Persistencia y conservación

SQLite v5 aditivo, sujeto a comprobación del esquema al implementar B:
`artist TEXT NULL`, `album TEXT NULL`, `genre TEXT NULL`, `year INTEGER NULL`.
Título y columnas de portada existentes se reutilizan. Sin tablas auxiliares ni
JSON lateral para los campos. Actualizar validación estricta de columnas y rutas
v3→v4→v5; mantener migración transaccional, rollback, FK e inventario. Usar NULL
para ausencias, no valores ficticios. Probar que lectores Swift con SELECT explícito
siguen compatibles. No ejecutar migraciones en el dispositivo durante desarrollo.
Una versión anterior rechaza v5: reinstalar build18 no es rollback suficiente.

Nuevas importaciones: título incrustado válido o fallback de nombre de 1.8.0;
metadatos incompletos/imagen inválida no impiden publicar un medio válido.
Extracción después de validar y sin duplicar la inspección multimedia existente.

Importados existentes: acción explícita por elemento disponible y ready; nunca
escanear Biblioteca automáticamente al arrancar o renderizar. Vista previa de las
novedades; por defecto completar solo ausencias y conservar título/valores válidos.
Cambiar un título o texto válido requiere selección explícita de ese campo y
confirmación. Cancelar no escribe nada. Sin etiqueta nueva, conservar valor actual.
Portada válida existente se conserva en esta entrega: no se ofrece reemplazo de
portada válida. Esa ampliación necesitaría consentimiento y contrato propio.
La normalización en memoria no debe truncar silenciosamente valores ya guardados.

## Portadas y recuperación

Reutilizar `Artwork/<id>.jpg`, inspección/normalización de imágenes y campos
relativeArtworkPath/artworkSizeBytes. JPEG máximo 512px por lado, proporciones
preservadas, máximo 2MiB; comprobar dimensiones/píxeles antes de decodificar.
Imágenes incrustadas mayores que el límite o inválidas se omiten. La carga de
Data por AVFoundation puede asignar memoria antes de validar: medirlo con fixtures,
no afirmar que el límite de salida acota toda memoria interna. Downsampling ImageIO.

Una operación por ID y procesamiento serial global; reutilizar withLibraryLease.
Revalidar fila ready/local, identidad y ruta antes de cada publicación. No mantener
transacción SQL abierta mientras se decodifica el medio. No tocar columnas de
progreso, completedAt, downloadedAt, Cola o Colecciones. UPDATE con guardas y
comparación de valores previos; si la fila cambió o está deleting, descartar resultado.

Protocolo sin transacción distribuida ni nuevo journal general:

1. Extraer y normalizar en memoria nativa acotada; aún no cambiar la portada vigente.
   Solo la publicación usa un temporal propio en el mismo directorio final.
2. Con guardas de identidad vigentes y sin portada válida, publicar archivo
   completo sin sobrescribir un archivo válido que apareció concurrentemente.
3. En C, INSERT inicial conserva los campos descriptivos de la nueva importación;
   después de confirmar el medio, UPDATE ready/local asocia la portada publicada
   solo si no hay referencia previa. No hay transacción SQL durante extracción.
4. Fallo antes de publicación: retirar únicamente el temporal propio. Fallo SQL
   posterior controlado: compensar solo JPEG nuevo con token/hash verificables y
   ausencia de referencias SQL. Ante referencia, cambios o estado SQL desconocido,
   conservar archivo y diagnóstico. Nunca sobrescribir una portada preexistente.
5. Cierre abrupto: no se asocia una imagen parcial. Puede sobrevivir un temporal
   propio o un JPEG completo sin asociación; no hay journal/reconciliador nuevo
   implementado en C. Una futura recuperación autorizada deberá demostrar propiedad,
   imagen íntegra y referencias SQL antes de asociar o retirar; no basta con el nombre.
   Los reintentos con fila existente no enriquecen ni reemplazan sus datos en C.
6. Borrado concurrente: lease aplaza eliminación física, UPDATE guarded falla y no
   recrea fila. Liberar lease permite finalizar el borrado existente. No borrar
   archivos por callbacks obsoletos que puedan pertenecer a otra operación.

Los temporales propios se limpian ante finalización/fallo controlado. Tras cierre
abrupto, recuperación de imágenes pendiente de implementar y probar; no ejecutar
un barrido de Artwork ni prometer limpieza inmediata. El staging de medios mantiene
su recuperación existente, independiente de esta limitación de imágenes.
No cachear resultados fallidos como éxitos. No reemplazar portadas válidas evita
cambios de URI/caché y elimina una transacción de reemplazo innecesaria en este MVP.
Las portadas mantienen su exclusión de backup actual; son regenerables desde el
medio, cuya protección no cambia. No afirmar que iOS realizó un backup.

## Presentación y recursos

Portadas mediante artworkUri existente, sin rediseñar tarjetas. Corregir etiqueta
accesible «Portada descargada» para distinguir incrustada/miniatura local sin
prometer procedencia no almacenada; usar etiqueta genérica «Portada del archivo».
Artista/álbum/género/año en información del elemento o resumen compacto accesible,
sin desplegar seis líneas permanentes por tarjeta ni modificar filtros/orden.
Sin nueva semántica de búsqueda por etiquetas ni cambios en pantalla bloqueada.

Una operación a la vez, sin copias completas del medio y sin decodificación en
render. Capacidad medida antes de escribir; presupuesto de un temporal de imagen
más salida (hasta 4MiB de JPEG), margen operacional y reserva conservadora de
almacenamiento existente. No atribuir ese presupuesto a toda memoria del decoder.
Límites y cancelación comprobados con fixtures 4K/rotados y artwork grande.
Éxito parcial informa campos omitidos; error de escritura mantiene UI funcional y
ofrece reintento explícito. Sin cachés o trabajos automáticos sin límite.

## Bloques y aceptación TDD

| Bloque | Alcance permitido al autorizarlo | RED/GREEN y aceptación |
| --- | --- | --- |
| A | Extractor Swift aislado y tipos de resultado; sin DB/bridge/UI ni instalación | Fixtures propios MP3 ID3/M4A, etiquetas presentes/ausentes/Unicode/control/inválidas; precedencia, año y título fallback; portada válida/corrupta/excesiva; MP4 corto/rotado; error parcial y cancelación. Hash del medio igual antes/después, cero red. Reutilizar inspección de 1.8.0 y añadir solo pruebas pertinentes. |
| B | Modelo/migración v5 y normalización | SQLite real v3/v4→v5, rollback inyectado, NULL, relectura; IDs/filas/relaciones/Cola/progreso idénticos; lector Swift compatible. Sin iPhone. |
| C | Bridge y nuevas importaciones | Reutilizar promoción pending→ready; imagen falla pero medio válido queda ready; resultado tipado sin base64; persistencia tras reapertura; límites y duplicación/cancelación controlados. Sin tocar descargas. |
| D | Actualización explícita y presentación mínima | Completar ausencias; valores/portada válidos conservados; consentimiento por campo; cancelar sin cambios; repetición idempotente; SQL falla tras imagen; cierre/reintento; borrado y respuestas tardías; ningún cambio en reproducción/relaciones. |
| E | Integración y validación física autorizadas aparte | Una candidata reprotest, backup coherente previo y control de migración v5. Offline/reinicio, miniatura y orientación, UI accesible, memoria/tiempo/espacio con tamaños registrados; medios y estado intactos. Fallos no reproducidos físicamente se distinguen de tests host. |

TDD focalizado: mostrar fallo esperado antes de implementar lo ausente. Reutilizar
library.test.ts, libraryDatabase.test.ts, local-import.test.ts, library-screen.test.tsx
y harnesses Swift existentes, ampliando por contratos nuevos, sin duplicar algoritmos.
Tipos/lint/formato/diff proporcionales. No ejecutar la batería histórica por rutina.
El bloque A puede probarse en host con fixtures; UIKit/bridge integrado/iPhone
requieren autorizaciones posteriores. Este documento no autoriza implementar A.

## Archivos previstos y límites

- A: archivo nuevo en `mobile/modules/drop-library/ios/` para extractor y tests
  correspondientes; consumir inspección existente sin alterar su aceptación.
- B/C: `mobile/src/models/library.ts`, servicios library/libraryDatabase,
  DropLibraryModule/Storage y contratos preparados estrictamente necesarios.
- D: LibraryItemRow, acciones e información mínima; sin motor de reproducción.
- E: metadatos/configuración de candidata solo con autorización independiente.
- Conservar main, tags, ambas apps, fuentes/artefacto de build18 y respaldos.
  Sin nuevas dependencias, builds, migraciones ejecutadas, instalación o commit
  de esta especificación en el bloque documental actual.

Referencias técnicas: [Apple, metadatos](https://developer.apple.com/documentation/avfoundation/retrieving-media-metadata)
y [tamaño de miniaturas](https://developer.apple.com/documentation/avfoundation/avassetimagegenerator/maximumsize).


## Estado de ejecución A · 8/11/2026

Extractor/harness añadidos sin integración. RED 11 fallos; primer GREEN 18 PASS.
Tipado iOS16.4 Swift5/6 aprobado. La suite ampliada NO termina: 19 checks PASS
antes de esperar indefinidamente al cancelar generación de miniatura en curso.
Diagnóstico detenido a20s; no hay PASS final. Mantener criterios de cancelación:
no reducirlos ni ocultar el caso. Propuesta para revisión: adapter callback,
finalización única y pruebas deterministas de carreras. Sin aplicar esa solución
ni iniciar B. Evidencia local v1.8.1-A-metadata-tp0e2mg2 en engineering-state.


## Resolución A.1 · 8/11/2026

Se conserva el bloqueo histórico de A como evidencia. La solicitud propia ahora
finaliza exactamente una vez por éxito/error/cancelación, con resultado/observador
protegidos y entrega fuera del lock. Cancelar no depende de que AVFoundation llame
su callback. Start/cancel del generador se confinan a cola; callbacks tardíos o
duplicados no publican resultados. Se conserva cancelación previa al registro.
No se promete liberación inmediata de memoria o toda actividad interna del decoder.

RED controlado 9 fallos/2 PASS; GREEN 36 casos únicos PASS en Swift5 y Swift6,
sin timeouts. Incluye MP4 real, ausencia de modificaciones de fuentes y rechazo
previo de URLs de red. Typecheck iOS16.4 ARM64 en ambos modos aprobado. No es
validación física ni captura de tráfico. Evidencia A1-cancellation-uuq2cixt en
engineering-state. Sin commits, migración, integración, builds o instalación.
A listo para revisión; B exige autorización independiente. Este contrato no cambia
la preservación de medios ni autoriza eliminar archivos tras cancelar una lectura.


## Cierre A/A.1

Revisión local aprobada según evidencia A1: 36 casos únicos por toolchain,
Swift5/6 e iOS16.4. Fuentes sin modificaciones desde la ejecución. Autorizado
commit local acotado de A, sin push. B tiene autorización independiente vigente
para persistencia; no se autoriza integrar extractor ni interfaz.


## Ejecución B · SQLite v5, compatibilidad nativa pendiente

A cerrado localmente en ece7724452d20027346d742a8b175a3942cca828, sin push.
SQLite v5 usa exactamente cuatro columnas anulables añadidas al final: artist,
album y genre TEXT, year INTEGER. v4→v5 es aditivo; v1–v3 pasan primero por el
cambio de sourceKind requerido en v4, dentro de la misma transacción. Base nueva
v5 directa. Sin reconstruir v4 ni agregar tablas, índices o constraints extra.

updateLocalDescriptiveMetadata completa campos ausentes en filas ready/local:
NULL/undefined/vacío no borran; inválidos se rechazan antes de ejecutar SQL;
no reemplaza valores válidos ni filas completas. No modifica título/portada,
sourceKind, rutas, fechas, IDs, progreso o relaciones. No se conecta a promoción
ni extractor: C decidirá la llamada tras validar/promover. La sustitución con
consentimiento sigue fuera de B; esta operación no la permite implícitamente.

RED19 fallos; 108 PASS SQLite/TS, cuatro suites focalizadas. Integridad/FK,
rollback/interrupción y persistencia acreditados en fixtures, no iPhone.
Bloqueo: el consumidor nativo de Cola exige user_version==3 y rechaza v5;
reproducción host independiente con código de producción lo confirma. El guard
ya rechaza v4; no atribuirlo a pérdida física o a una nueva regresión observada.
No modificarlo sin autorización: aceptar 3/4/5 explícitos con estructura/FK
verificadas y futuro6 rechazado es la propuesta mínima. B no está cerrado ni
committeado; no iniciar C. Evidencia B-sqlite5-ajbkgnl4 en estado operativo.


## Resolución B.1 · contrato nativo compatible

El bloqueo B anterior es histórico. PlaybackManualQueueRepository acepta
explícitamente v3/v4/v5, con las validaciones estructurales/FK existentes y
rechazo v6. Usa solo Cola de cuatro columnas y library_items.id/lifecycle,
contratos conservados; no crea ni migra esquema. Consume elimina la ocurrencia
seleccionada y compacta posiciones como antes, sin perder duplicados permitidos.
No se modifican leases ni operaciones del servicio de reproducción.

RED: v3 acepta, v4/v5 rechazan con fuente anterior. GREEN: escenarios completos
v3/v4/v5 y cinco grupos existentes pasan en Swift5/6, con integridad/FK, rechazo
futuro/corrupción y esquema/filas ajenas intactos. Regresión B 108 PASS y TS PASS;
typecheck iOS16.4 Swift5/6 como biblioteca. Evidencia B1-native-queue-9ps51nwt.
B/B.1 listos para revisión, sin commit. No iniciar C automáticamente.

La misma guardia existe en el checkpoint1.8.0 y rechaza v4: registrar un posible
parche independiente para1.8.0, previa autorización propia. No backport ahora;
no declarar que las instalaciones actuales ya contienen esta corrección.


## Cierre local B/B.1

Revisión final de hashes y contratos satisfactoria: 108 PASS y escenarios
nativos Swift5/6 acreditados para estas fuentes. Se autoriza/realiza commit
local exclusivo de B. Sin push. El defecto nativo de v4 debe corregirse antes
de publicar1.8.0; backport no realizado ni autorizado en este bloque.


## Propuesta de ajuste C · pendiente de aprobación, sin implementación

El prompt C exige no dejar huérfanos tras errores controlados, mientras el
protocolo anterior permite imagen no asociada tras fallo SQL. Propuesta: mantener
JPEG acotado en memoria nativa hasta confirmar el medio nuevo; publicar bajo
identidad de operación, asociar por UPDATE guardado y retirar solo su archivo
creado si SQL falla. No sobrescribir portada existente ni usar permiso HTTPS.
Para cierre abrupto, distinguir recuperación posterior del rollback controlado;
no prometer una transacción atómica entre filesystem y SQLite.

La espera opcional de etiquetas tampoco está temporalmente acotada por A.1.
Propuesta: presupuesto total 10 s de enriquecimiento, cancelación/fallback que
resuelven la operación propia, sin depender de respuesta del framework. Ignorar
resultados tardíos antes de publicar archivos o datos. Sin garantía de memoria
liberada inmediatamente; no volver al proveedor ni invalidar el medio válido.
Estas propuestas no están implementadas ni aprobadas por esta anotación.
B cerrado localmente; C detenido antes de RED/implementación, no iniciar D/E.


## Contrato C aprobado · importaciones nuevas

La autorización posterior sustituye la propuesta pendiente, sin alterar la
historia anterior. Presupuesto máximo de espera opcional10s para etiquetas y
artwork juntos. La espera propia finaliza una vez por respuesta/error/timeout/
cancelación sin esperar al perdedor. Un solo worker nativo activo: si continúa
limpiando tras timeout, nuevos intentos omiten enriquecimiento hasta liberarlo.
No se promete liberar instantáneamente recursos AVFoundation. Respuestas tardías
no pueden publicar JPEG ni escribir SQL; nombre y medio válidos siguen disponibles.

JPEG opcional acotado en memoria nativa; no base64/imagen JS. Publicación en
Artwork por ID nuevo y token de operación, con temporal propio y movimiento
sin sobrescritura. Si falla SQL, compensar solo archivo creado por ese token,
con hash/ruta verificados y sin referencia SQLite; conservar portadas anteriores.
SQL nunca apunta a un temporal o a una imagen aún no publicada. La cancelación
antes de publicar deja solo el medio o la cancelación de importación existente.
Cierre abrupto se distingue del error controlado: portada publicada sin asociación
puede quedar recuperable; no hay limpieza general ni recuperación inmediata
implícita. Si no puede verificarse ausencia de referencias, conservar antes que
borrar datos ambiguos y registrar la limitación. No invalidar un medio reproducible.

Para una reconciliación futura de crash hará falta un registro durable mínimo
(opID, itemID, ruta relativa, SHA256, fase) previo a publicar. Al reiniciar:
validar registro/imagen/ruta, consultar todas las referencias SQL y estado del
propietario; asociar solo con guardas o retirar solo un archivo propio sin referencias.
Sin esa prueba de propiedad, conservar y resolver explícitamente. Este journal y
su reconciliador NO están implementados en C; el token actual vive en memoria.

Solo nuevas filas reciben título incrustado y campos disponibles. Reintentos y
callbacks con fila existente conservan sus datos y no vuelven a enriquecerla.
D sigue reservado para actualizaciones explícitas. Aceptación: reloj controlado,
callback ausente/duplicado/tardío, timeout/cancelación, capacidad de nuevo worker,
compensación SQL, portada preexistente, borrado concurrente, persistencia real y
preservación de medios, contexto y relaciones. Sin candidata ni iPhone en C.


## Resultado C · integración enriquecida, revisión pendiente

Flujo real: copia validada → extractor A con coordinador10s → descriptor nativo
sin bytes de imagen JS → promoción pending/ready con campos v5 → lease → JPEG
atómico por ID/token → stat válido → UPDATE guarded → confirmación o compensación.
Solo nuevas filas; una repetición devuelve el registro existente sin sobrescribirlo.
La Biblioteca usa el título y artworkUri actuales, sin rediseño ni nuevas pantallas.

- 136 pruebas Jest PASS, seis suites afectadas; SQLite real, reapertura,
  integridad/FK, progreso, Colecciones y dos ocurrencias de Cola preservados.
- 49 comprobaciones nativas nuevas PASS por modo Swift5/6 (14 coordinación,
  17 propiedad/publicación y18 integración multimedia real). Harness previo de
  operación/selector también PASS. Extractor A1:36 casos reutilizados tras hashes
  idénticos; no se suman toolchains o repeticiones como casos adicionales.
- Typecheck completo DropLibrary/bridge ARM64 iOS16.4 PASS en Swift5/6.
  Swift6 conserva advertencia previa de ArtworkTransfer.data mutable; sin corregir
  el descargador YouTube ajeno. TypeScript, lint/formato focal y diff PASS.
- No validación física ni candidata: Pods generado aún debe incorporar los nuevos
  Swift en una preparación nativa autorizada. No pod install ni build en C.
- Evidencia durable C-enriched-0q5i_x4i bajo DropValidationEvidence: RED/GREEN,
  comandos y resultados individuales. Sin commit C, push, main ni datos reales.

GO técnico para revisión/cierre C. D requiere autorización independiente.


## Revisión de cierre C · límite Unicode (histórico, resuelto por C.1)

La revisión posterior reproduce239 letras+emoji: optionalText corta un surrogate
con slice UTF16 y SQLite lo convierte a U+FFFD. Debe mantenerse texto Unicode
válido en el límite de240; añadir regresión de campos descriptivos/persistencia y
comprobar el límite equivalente del título. Propuesta: convención Array.from del
repositorio B. Sin cambio de contrato funcional ni corrección aplicada todavía.
C no commiteado; D no iniciado. Ver REVIEW-UNICODE.json en evidencia C.


## C.1 · truncamiento Unicode seguro y cierre de C

Título y textos descriptivos se truncan a240 puntos de código mediante Array.from,
compatible con B. No se promete preservar grafemas completos (combinantes/ZWJ);
no se crean pares UTF16 incompletos a partir de una entrada válida. Se conservan
normalización y fallbacks. Sin cambios Swift, imágenes, SQL de esquema o versiones.

RED3/17 → GREEN20/20 en integración enriquecida; regresión afectada145 PASS en
seis suites. Nueve casos nuevos y roundtrip SQLite real incluyen emoji en/al otro
lado del límite, mezcla, CJK, combinantes, títulos cortos/largos y fallback vacío.
Sin U+FFFD introducido. TS/lint/formato/diff PASS;49 checks nativos/modo y tipado
Swift5/6 iOS16.4 reutilizados con hashes idénticos. Revisión completa sin otros
bloqueantes. C/C.1 listos para único commit local autorizado. No D/E iniciados.
La limitación de reconciliación tras crash permanece explícita y sin implementar.


## D · actualización explícita conservadora, implementada en host

Una sola operación activa de completado. Acción local disponible por elemento en
las acciones existentes; no análisis automático al abrir Biblioteca. Análisis de
copia ImportedMedia bajo lease, con el extractor y presupuesto opcional10s de C.
No nuevo LibraryItem, red, proveedor de Archivos ni cambios del medio original.

Preparación sin SQL → comparación → propuesta de título solo si difiere → aplicar.
Conservar título permite completar ausencias; cancelar operación no escribe nada.
Diálogo único con cancelar/conservar/usar encontrado y guardia de callback duplicado.
Cambios de título exigen consentimiento y comparación optimista con título leído.
SQL único rellena campos ausentes y asocia imagen opcional después de stat válido;
conserva ID, origen, duración, rutas, relaciones, Cola, progreso y completedAt.
Notificación solo tras cambios reales. Sin cambios se informa explícitamente.

Cancelar/desmontar antes de aplicar invalida resultado y solicitud nativa incluso
si aún no se registró. Una vez iniciada la aplicación no se acepta cancelar: no
prometer reversión de un commit SQL en curso. Leases/UPDATE guarded protegen borrado;
ninguna respuesta ni confirmación obsoleta recrea un registro. El descarte final
cierra también solicitudes tardías. Portada válida previa se conserva; imagen
corrupta preexistente no se sustituye automáticamente. Error JPEG permite texto;
error SQL compensa solo el JPEG propio sin referencias, reutilizando C.

Estados: analizando, encontrados, guardando, completado, sin cambios, cancelado y
error. No bloqueo de reproducción/navegación durante análisis; áreas táctiles y
etiquetas accesibles. Etiqueta genérica «Portada del archivo» en ambas vistas.

RED inicial11 fallos y20PASS; carrera adicional descarte-before-registration RED1.
GREEN172 Jest(6suites) y12 casos nativos por Swift5/6. MP3/M4A con artwork/MP4
reales, hashes intactos, SQLite/reapertura/integridad/FK/relaciones. Typecheck
ARM64 iOS16.4/bridge5/6, TS/lint/formato/diff PASS. Timeout/ausencia de callback,
concurrencia del worker y compensación profunda de C reutilizados con hash idéntico;
no se cuentan otra vez como nuevos casos. Warnings preexistentes conservados.

Crash conserva limitaciones y diseño futuro de journal descritos en C: no hay
reconciliación destructiva nueva ni garantía de limpieza inmediata. Validación
física/Pod registration/candidata requieren autorización E. Revisión D aprobada
para único commit local; E1 autorizado por separado, sin instalación.


## Cierre D y preflight E1 · build19 aún no generada

D confirmado localmente en56ea42a4dab77f3e3251915c23d9c3b0da05b5d4.
Versionado preparado1.8.1/19, sin cambiar dependencias ni identidad por entorno.
La preparación de Pods para incorporar cinco Swift nuevos falló por consulta de
índice CDN no disponible en caché privada bajo aislamiento sin red. El índice
existe en caché global; su reutilización CP_REPOS_DIR requiere autorización del
segundo intento, rechazado por revisión automática. Sin Xcode ni artefacto19.
Configuración temporal restaurada; logs y recursos previos conservados.

E2 sigue pendiente: inventario real, backup incremental SQLite/WAL coherente,
medios/portadas/relaciones/Cola/progreso/preferencias, hashes/integridad/FK,
recuperación de prueba fuera del dispositivo y actualización in-place autorizada.
Build18 no es rollback de SQLite5. Validación física focal de importación,
completado existente, reapertura, datos y Cola; no batería completa1.8.0.
Sin reconciliación nueva de imágenes tras crash ni intervención sobre el iPhone.


## E1.1 · preflight offline incompatible con resolución fijada

Segundo pod install expresamente autorizado pero no ejecutado: el índice a93
está disponible globalmente, pero su consumidor SocketRocket no figura en lock.
RN usa un HEAD Maven para elegir prebuilt; bloquear red provoca fallback a fuentes
antes de resolver dependencias. Debe conservarse React-Core-prebuilt y
ReactNativeDependencies mediante preparación offline validada, sin nuevos Pods,
versiones o respuestas HTTP simuladas. No basta reutilizar índice; ajuste adicional
pendiente de autorización, sin cambiar scripts/dependencias ni consumir segundo
intento. Caché global/privada y lockfiles intactos; E1/E2 no reanudados.


## E1.2 · modo local verificado, incompatibilidad con lock exacto

Archives0.86.3 Core/Deps Release íntegros y binarios ARM64 iguales a Pods existentes;
Debug también conservado. La variable TESTONLY de Core se evaluó realmente: ruta
local y retirada del selector de configuración, sin cambio de versión. Con ambos
flags de Maven en0 y ambas rutas locales existentes, no hay consulta HEAD ni fallback.
Evaluación sin instalación demuestra cambios únicamente source/script_phases en
ambos podspecs. Esto modifica checksums del lock y --deployment lo rechaza.
No se ejecutó pod install ni se tocaron locks/node_modules/caches. Resolver exige
autorizar adaptación acotada de metadatos/checksums conservando grafo y versiones;
no improvisar parche de RN o respuestas HTTP. E1 y compilación siguen pendientes.


## E1.3 · autorización corregida, intento fallido antes de resolución

Una ejecución pod install --no-repo-update autorizada, exit1/2.01s por aislamiento
propio excesivo: git --version no podía abrir /dev/null read/write. No se analizaron
Pods ni recalcularon checksums. Locks, podspecs, Manifest, Podfile/Gemfile y metadatos
intactos. Red bloqueada y global caches protegidos. Excepción puntual /dev/null
probada con Git/Node/Ruby, no reinstalación Pods. Requiere nuevo intento autorizado;
no Xcode, E2 ni cambios del contrato de dependencias.


## E1.3 adicional · copia generada ExpoSQLite fuera de ios

Otro intento expresamente autorizado, con excepción/dev/null: exit1/2.01s antes
 de resolución. Podspec ExpoSQLite copia vendor/sqlite3.c/.h a su ios dentro de
node_modules, destino fuera del alcance de escritura autorizado. Destinos/source
ya idénticos por SHA256. No ampliar permisos ni reintentar automáticamente;
requiere autorización puntual de ambos destinos generados, sin cambiar scripts.
Todos los locks/podspecs previos intactos; sin nuevos checksums ni candidata.


## Recuperación offline E1.3 concluida

Última autorización: pod install exit0/20.04s,116dependencias/115Pods, sin red,
prebuilt local0.86.3 sin fallback. Lockfile y Manifest exactos, ambos checksums
originales coinciden con JSON usados. No fue necesario alterar SPEC CHECKSUMS:
CocoaPods reutilizó podspecs instalados. La evaluación directa E1.2 describía otros
metadatos posibles; no demuestra un cambio inevitable al reutilizar esta instalación.
Swift A–D registrados(15Library/15Playback/11OnDeviceYouTube). Incidencia auxiliar
ExpoJSI conservada: intento de temporal stub denegado, seis slices ya disponibles,
binario iOSarm64 idéntico porUUID a build18 y scripts copy/embed correctos.
Preparación PASS, sin nuevo build/runtime ni bootstrap limpio offline probado.
No reparar/borrar recursos ni ejecutar otro podinstall. Revalidar firma/24GiB y
version19/configuración temporal antes de una única build autorizada por separado.


## Cierre técnico E1/E2 · 10 de noviembre de 2026

E1 PASS: build 19 de código de producción, Release ARM64/Hermes para reprotest,
archivada y sin instrumentación diagnóstica. E2-A/B/C PASS: protección recuperable,
instalación in-place y migración v4→v5 con IDs, datos y relaciones conservados.
E2-D permanece PARTIAL; no equivale a aprobación integral de release.

| Caso físico | Resultado acreditado |
| --- | --- |
| MP3/M4A: metadatos, título, artwork e importación | PASS en fixtures ensayadas; campos ausentes y artwork corrupto con fallback |
| MP4: miniaturas y proporciones | PASS visual/técnico, dimensiones de JPEG comprobadas |
| Actualización explícita de existente preparado | PASS en fixture nueva: cancelar diálogo no escribe; conservar título completa ausencias; reemplazo solo explícito; valores/portada válidos conservados en casos ensayados |
| Persistencia | PASS: reaperturas y SQLite posterior al cierre; sin reapertura visual extra del título final |
| Cola SQLite v5 | Incorporación/orden/consumo automático PASS; aislamiento del contexto PARTIAL por continuación de Biblioteca e incidente de progreso documentado |
| Video vertical durante reproducción en retrato | PASS visual por confirmación posterior del usuario sobre grabación; centrado y sin deformación apreciable antes del avance automático |
| Cancelación durante «Analizando…» | NOT TESTED físicamente; distinta de cancelar diálogo antes de aplicar (PASS) |
| Orientación horizontal durante reproducción | NOT TESTED |
| Fallo de miniatura, acción en YouTube, reproducción prolongada/fidelidad | NOT TESTED físicamente |

La confirmación vertical es observación del usuario, no medición ni nueva inspección
instrumentada. Las pruebas host históricas A–D permanecen diferenciadas; no se
repitieron ni se suman a los resultados físicos. Las matrices históricas conservan
su estado original: E2-D.4 cubre después las ramas de diálogo/ausencias pendientes.
No se atribuye al diálogo nativo una opción preseleccionada: conservar título es
una elección explícita; nunca se reemplaza sin consentimiento.

Último inventario acreditado, no inspección actual: 17 elementos/17 medios/10
portadas, una colección/una relación/Cola vacía. SQLite v5 íntegra, FK=0; conjunto
recuperable de 35 archivos. Se protegieron una fixture nueva y otro medio local
importado intencionalmente;
15 filas anteriores al diagnóstico intactas. Progreso histórico afectado durante
Cola documentado y no restaurado. Copias retenidas verificadas; medios antiguos
reutilizados por metadatos estables, sin nuevo hash de todos sus bytes en iPhone.

Build 20 es diagnóstica y última instalación acreditada en reprotest. Su código
reside en worktree separado; no está integrado en producción. Build 19 archivada
mantiene identidad reprotest, no original. No hacer rollback 20→19 automáticamente;
comprobar antes compatibilidad y protección. Original protegida, sin actualización
autorizada. Se conserva la limitación de imágenes huérfanas tras cierre abrupto,
sin nueva reconciliación/journal. No hay defecto confirmado que bloquee el alcance
ensayado; aceptar límites no transforma NOT TESTED en PASS.

Metadatos pendientes: Expo 1.8.1/build 19 y paquetes 1.8.1, dependencias intactas.
No acreditan identidad/configuración nativa de una futura candidata original.
Perfil reprotest registrado hasta 11/11/2026 07:40:54 CDMX; futura operación exige
revalidación. Cierre solo documental, sin commit, release ni nuevas operaciones.

Referencias completas en [estado operativo](engineering-state.md), sección de
cierre técnico. E1 `v1.8.1-E1-build19-reprotest-2026-11-08-9ym4dgm5`; E2-A/B/C
con sus RESULT.json; E2-D `v1.8.1-E2D-reprotest-2026-11-08-pxl7y7sx`; diagnóstico
`v1.8.1-E2D2-diagnostic-0dr1qkpf` y
`v1.8.1-E2D4-diagnostic-2026-11-09-ln_llpnn`, incluidas matriz, checkpoints y
manifiesto recuperable final. Registros de preparación anteriores son históricos,
no condiciones vigentes. Sin alterar sus evidencias ni inventar logs físicos.
