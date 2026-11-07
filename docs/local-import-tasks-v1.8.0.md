# Drop 1.8.0 · Tareas y pruebas de importación local

[Especificación](local-import-v1.8.0.md) · [Plan técnico](local-import-plan-v1.8.0.md)

Estado: planificado. Cada bloque de código empieza por una prueba RED que
falla por el motivo esperado y termina con la implementación mínima GREEN.
La fase documental no ejecuta las pruebas de la matriz.

## Bloques por dependencia

### A · Contrato de datos y migración

- [ ] Partir de v4 limpia y de copias sintéticas v1, v2 y v3. Sembrar
  descargas, progreso, colecciones y entradas repetidas de Cola con orden.
- **Archivos previstos** — `mobile/src/models/library.ts`,
  `mobile/src/services/libraryDatabase.ts`,
  `mobile/tests/libraryDatabase.test.ts` y su adaptador SQLite real si
  requiere simular fallos de la migración.
- **Dependencias y riesgo** — Base publicada. Retirar la tabla padre con
  claves foráneas activas borraría relaciones. Una app anterior no abre v4.
- **RED** — Un INSERT local falla por el `CHECK` anterior. Añadir pruebas
  de actualización, cascadas indebidas y rollback inyectado tras el retiro
  de la tabla y antes de confirmar la versión.
- **GREEN y cierre** — Admitir `local`, conservar las filas antiguas y sus
  relaciones, y demostrar rollback e integridad en SQLite real. Verificar
  que v4 conserva los contratos de lectura/escritura de Swift y que se
  rechaza un esquema desconocido. Sin selector, archivos ni UI.

### B · Preparación y promoción sin interfaz

- [ ] Preparar un medio en staging con URL autorizada y reutilizar
  `promoteToLibrary`. Cerrar la recuperación de una interrupción antes de
  habilitar el selector para usuarios.
- **Archivos previstos** — `DropLibraryPaths.swift`, `DropLibraryStorage.swift`,
  `DropLibraryModule.swift` y un auxiliar Swift solo si separa la lectura
  coordinada de la presentación. `mobile/src/services/library.ts`,
  `mobile/tests/library.test.ts`, pruebas de rutas, almacenamiento y
  reproducción Swift existentes. Revisar el podspec si necesita declarar
  AVFoundation y el manifiesto de privacidad si el motivo existente de
  espacio en disco no cubre este uso.
- **Dependencias y riesgo** — A. Permiso transitorio, almacenamiento, medios
  inválidos, interrupción entre archivo y SQLite, y respaldo parcial.
- **RED** — Audio y video válidos no pueden entrar desde el nuevo staging.
  Fallan los casos de espacio, archivo truncado, error SQL y recuperación en
  el mismo UUID. Una ruta nueva tampoco se resuelve aún para reproducción.
- **GREEN y cierre** — Copia única verificada, clasificación con AVFoundation,
  promoción con el flujo actual, resolver de rutas común y restauración del
  estado pendiente sin duplicar datos. Verificar elegibilidad de respaldo,
  protección del original y regresiones de descargas y borrado explícito.
  Sin entrada UI, portadas nuevas, cambios de Cola ni transcodificación.

### C · Selector y experiencia en Biblioteca

- [ ] Conectar el selector iOS y los estados de UI al flujo aprobado en B.
- **Archivos previstos** — `DropLibraryModule.swift`, el auxiliar del selector
  si hace falta, `mobile/src/app/library.tsx` y
  `mobile/tests/library-screen.test.tsx`. Reutilizar componentes y anuncios
  accesibles del proyecto.
- **Dependencias y riesgo** — A y B. Delegados duplicados, selector ya
  presentado, cambios de pestaña y resultados tardíos del proveedor.
- **RED** — La acción no abre el selector. Cancelar, pulsar dos veces o recibir
  una respuesta tardía produce un estado incorrecto. El éxito no informa si
  los filtros ocultan la nueva fila.
- **GREEN y cierre** — Una operación activa. Selección, cancelación, errores
  y progreso accesibles. Lista y cuadrícula refrescan sin alterar filtros,
  reproducción o Cola. Sin importación masiva ni cambios de dependencias.

### D · Integración y candidata reprotest

- [ ] Ejecutar primero las comprobaciones afectadas y después las pruebas
  integradas que exige el workflow. Preparar candidata y respaldar reprotest
  únicamente con la autorización correspondiente.
- **Archivos previstos** — Harness y fixtures sintéticos de las suites
  existentes, checklist físico de esta página y evidencia externa según
  [el workflow](engineering-workflow.md). Sin incorporar el diagnóstico ni
  cambiar el comportamiento para lograr un PASS.
- **Dependencias y riesgo** — A, B y C. Diferencias de AVFoundation, permisos
  del proveedor y migración real en iOS. Reprotest puede conservar una
  Biblioteca v3. Probar actualización y arranque limpio sin borrar ni
  sustituir el contenedor existente.
- **RED y GREEN** — Registrar como fallo cualquier diferencia del checklist.
  La candidata cierra al repetir el caso afectado con el contrato satisfecho
  y evidencia de preservación de datos. Un caso que no se puede ejecutar
  queda pendiente. No repetir un build para sustituir esa evidencia.
- **Cierre físico** — Archivo local de cada tipo y un documento no
  materializado de iCloud Drive. Si hay un proveedor externo configurado
  para pruebas, registrar su comportamiento por separado. Verificar
  archivo fuente, lanzamiento en modo avión, persistencia tras
  reiniciar, exportación, permisos, cancelación, VoiceOver, filtro activo y
  una actualización v3 → v4 con Biblioteca existente. Probar instalación
  limpia con un entorno desechable autorizado, sin desinstalar reprotest
  ni tocar la original. El respaldo portable y otras funciones no se
  prueban como parte de 1.8.0.

## Matriz de pruebas

| Caso | Nivel y prueba RED | Evidencia de aceptación |
| --- | --- | --- |
| Audio válido | Swift unitaria e integración con fixture M4A o MP3, más físico | Audio y duración correctos. Copia completa y reproducible. |
| Video válido | Swift integración con MP4, más físico | Pista de video válida y reproducción con imagen y audio cuando corresponda. |
| Incompatible o protegido | Swift unitaria/integración con sufijo engañoso, DRM o referencia externa | Rechazo sin publicar fila, sin extraer claves y sin seguir recursos externos. |
| Vacío, corrupto o truncado | Swift integración con fixtures inválidos, incluido un archivo de cabecera válida | Error claro y sin publicar parcial. |
| Selector cancelado | TypeScript unitaria e iOS físico | Vuelve a Biblioteca sin error, filas ni temporales. |
| Espacio insuficiente | Swift unitaria con capacidad inyectada antes y durante la copia | Abortado sin archivo final ni `ready`. No borrar archivos anteriores para ganar espacio. |
| Permiso, proveedor y desaparición | Swift unitaria con acceso/lectura fallidos, más iOS físico cuando sea reproducible | Error adecuado. Acceso liberado y fuente intacta. |
| Copia interrumpida | Swift integración con fallo tras un bloque, más reinicio físico controlado cuando se autorice | Parcial sin publicar. El barrido solo retira temporales propios no referenciados. |
| Escritura SQLite falla | TypeScript con SQLite real. Fallar INSERT o confirmación | Antes de `pending`, limpiar si se confirma que no existe fila. Después, recuperar el mismo UUID sin anunciar éxito antes de tiempo. |
| Fallo al promover | TypeScript integración con fallos antes/después del renombrado y Swift almacenamiento | Reconciliación por UUID y tamaño, revalidación del medio, ruta ajena conservada y sin sobrescritura. |
| Reinicio y `ready` | Integración SQLite real y reprotest | Un registro disponible tras reabrir. Un archivo ausente conserva su fila y muestra el estado actual de Biblioteca. |
| Reproducción offline | Swift integración y reprotest en modo avión | La copia se reproduce sin acceso al proveedor y acepta los controles existentes. |
| Origen preservado | Swift integración y reprotest con fixture no personal | Mismo contenido y ubicación en Archivos. Sin modificación ni borrado. |
| Compatibilidad anterior | SQLite real v1, v2 y v3, y reprotest actualizada desde v3 | Rutas, IDs y todos los valores anteriores intactos. Descargas y exportación siguen funcionando. |
| Migración y rollback | SQLite real v0/v1/v2/v3/v4, versión futura y esquema alterado | `integrity_check=ok`, cero violaciones de FK, versión correcta y rollback con filas e índices intactos. |
| Colecciones, Cola y progreso | SQLite real más regresiones Swift de Cola y reproducción | Se preservan asociaciones, ocurrencias duplicadas de Cola y su orden, progreso y `completedAt`. |
| Duplicados y colisiones | TypeScript y Swift con selecciones repetidas, nombres iguales y destino ocupado | Dos selecciones intencionales, dos UUID. Una sola fila ante doble disparo. Destino existente intacto. |
| UI accesible | TypeScript y reprotest con VoiceOver | Acción, cancelación, errores y progreso comprensibles. Los filtros no se reinician para mostrar una fila nueva. |
| Respaldo y restauración parcial | Swift de rutas y prueba iOS de atributo en la copia confirmada | Importados elegibles, descargas aún excluidas. Un archivo final importado sin fila se conserva. |

Cada bloque añade solo las pruebas necesarias y reutiliza el SQLite temporal
de `mobile/tests/support/realSQLite.ts` y los harnesses Swift actuales.
Los fallos de proveedor o de tiempo difíciles de provocar físicamente se
cubren con inyección en host y se declaran como tales. La comprobación de
la documentación se limita a revisión, enlaces y whitespace.
