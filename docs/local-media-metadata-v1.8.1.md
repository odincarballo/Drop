# Drop 1.8.1 · Metadatos y portadas locales

Contrato SDD preparado el 8/11/2026. A/A.1 implementados y verificados en host;
pendientes de revisión/cierre, ver estado al final. B–E sin implementación.
Base: checkpoint `8e6ade1ba6e60a036623b20af02aa76d25435864`, rama publicada
`codex/v1.8.0-local-import`. Trabajo local: `codex/v1.8.1-local-metadata`.
Versión/build permanecen 1.8.0/18 hasta autorización de candidata.
[Estado operativo](engineering-state.md) · [Importación existente](local-import-v1.8.0.md).

## Base real y alcance

1.8.0 tiene PASS manuales principales confirmados por el usuario en reprotest;
no equivale a release pública ni actualización de la original. Preservar ambas
instalaciones y sus respaldos. No repetir pruebas físicas ahora.

`LibraryMetadata` y SQLite v4 tienen título, tipo, duración y referencia/tamaño de
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

1. Extraer y normalizar en temporal propio; aún no cambiar la portada vigente.
2. Con guardas de identidad vigentes y sin portada válida, publicar archivo
   completo sin sobrescribir un archivo válido que apareció concurrentemente.
3. Transacción breve: aplicar solo campos consentidos y asociar portada/tamaño
   después de validar el archivo publicado. Emitir cambio al confirmar SQL.
4. Fallo antes de publicación: retirar únicamente el temporal propio. Fallo SQL
   posterior: conservar medio y datos previos; la imagen final no asociada puede
   permanecer recuperable. Un reintento explícito valida y reutiliza ese archivo.
5. Cierre entre pasos: ninguna fila debe apuntar a un archivo parcial. Si la ruta
   ya existía pero estaba ausente/inválida, la nueva imagen completa es utilizable;
   confirmar tamaño en el reintento. Probar compatibilidad con reconciliación actual
   por propietario UUID, sin borrar imágenes de otros elementos.
6. Borrado concurrente: lease aplaza eliminación física, UPDATE guarded falla y no
   recrea fila. Liberar lease permite finalizar el borrado existente. No borrar
   archivos por callbacks obsoletos que puedan pertenecer a otra operación.

Los temporales propios se limpian al finalizar/cancelar; los interrumpidos usan
limpieza acotada de staging propio, nunca un barrido de medios o Biblioteca.
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
