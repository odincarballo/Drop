# Drop 1.8.0 · Tareas y pruebas de importación local

[Especificación](local-import-v1.8.0.md) · [Plan técnico](local-import-plan-v1.8.0.md)

La implementación y la evidencia vigente se registran en
[el estado operativo](engineering-state.md). Los bloques nuevos aplican
RED/GREEN a sus carencias demostradas y reutilizan pruebas equivalentes.
La matriz incluye aceptación física todavía pendiente.

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

### C · Integración de aplicación sin selector

- [x] Incorporar una preparación nativa mediante `importPreparedLocalFile`,
  reutilizando promoción, lectura y recuperación de B.
- **Archivos implicados** — `library.ts`, identidad y metadatos del bridge,
  validación de medios y políticas compartidas del reproductor, con sus pruebas.
- **Dependencias y riesgo** — A y B. Dobles callbacks, reintento en la misma
  sesión, duración no persistida y rechazo de MP3 por filtros anteriores.
- **RED** — Entrada de aplicación ausente, duración enviada por JS conservada
  en lugar de la comprobada, y MP3 excluido del contexto y servicio nativo.
- **GREEN y cierre** — Identidad nativa estable, una operación activa,
  reintento del mismo UUID, confirmación de metadatos, protección del staging
  durante startup y conservación de filas y relaciones en SQLite real.
  MP3 participa en el mismo motor y contexto. M4A conserva compatibilidad AAC.
  Sin selector, UI ni pruebas en iPhone.

### D · Selector y experiencia en Biblioteca

- [x] Conectar el selector iOS y los estados de UI al flujo de B/C, con pruebas de host.
- **Archivos previstos** — `DropLibraryModule.swift`, el auxiliar del selector
  si hace falta, `mobile/src/app/library.tsx` y
  `mobile/tests/library-screen.test.tsx`. Reutilizar componentes y anuncios
  accesibles del proyecto.
- **Dependencias y riesgo** — A, B y C. Delegados duplicados, selector ya
  presentado, cambios de pestaña y resultados tardíos del proveedor.
- **RED** — La acción no abre el selector. Cancelar, pulsar dos veces o recibir
  una respuesta tardía produce un estado incorrecto. El éxito no informa si
  los filtros ocultan la nueva fila.
- **GREEN y cierre** — Una operación activa. Selección, cancelación, errores
  y progreso accesibles. Lista y cuadrícula refrescan sin alterar filtros,
  reproducción o Cola. Sin importación masiva ni cambios de dependencias.
  UIKit y los proveedores reales quedan pendientes del checklist físico E.

### E · Integración y candidata reprotest

- [ ] Ejecutar primero las comprobaciones afectadas y después las pruebas
  integradas que exige el workflow. Preparar candidata y respaldar reprotest
  únicamente con la autorización correspondiente.
- **Archivos previstos** — Harness y fixtures sintéticos de las suites
  existentes, checklist físico de esta página y evidencia externa según
  [el workflow](engineering-workflow.md). Sin incorporar el diagnóstico ni
  cambiar el comportamiento para lograr un PASS.
- **Dependencias y riesgo** — A, B, C y D. Diferencias de AVFoundation, permisos
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

## E1 y E2 · Protocolo y cronología

E1 autoriza una sola candidata firmada de reprotest, no instalación ni acceso
al contenedor. Preflight del 7/11/2026 **BLOCKED**: no existe el entorno iOS
preparado en el checkout de importación. Cero builds ejecutadas. La validación
completa del bridge Expo, registro de DropLibrary, target y enlace sigue pendiente.
Los chequeos de UIKit de host no demuestran presentación/cierre en un iPhone.

Antes de reanudar E1, preparar únicamente los recursos nativos imprescindibles
con procedencia verificada y sin usar ni modificar el worktree del diagnóstico.
Identidad explícita `com.odincarballo.drop.reprotest`, Team HK927RUDLZ,
1.8.0/build 18 propuesto sujeto a comprobar numeración real. Firma automática,
sin UUID manual ni actualizaciones de aprovisionamiento. Verificar fuentes,
registro Expo, inclusión de todos los Swift de D y bundle Hermes actualizado.
Exigir 24 GiB justo antes de Xcode, dos jobs, medir cada cinco segundos y
parar al umbral de 15 GiB. No reintentar automáticamente un fallo.

### Protocolo E2 · estado actual al final del documento

Requiere autorización independiente y una candidata E1 íntegra. Cada resultado
empieza como **NO VERIFICADO** y se registra con acción, esperado, observación
y evidencia. No convertir disponibilidad de tests o mocks en PASS físico.

| Paso | Responsable | Comprobación y criterio de aceptación |
| --- | --- | --- |
| 1 · Seguridad | Codex + usuario para cerrar la app | Identificar iPhone, reprotest y versión instalada. Cerrar solo reprotest y capturar estado estable. Inventariar LibraryItems/IDs, medios, portadas, Colecciones/relaciones, Cola ordenada, progreso y preferencias. Los seis medios históricos no son una cantidad obligatoria. |
| 2 · Respaldo | Codex, herramientas establecidas | Comparar con respaldo recuperable vigente; proteger incrementalmente diferencias legítimas, incluida SQLite y WAL/SHM coherentes cuando existan. Verificar hashes, integridad y FK, conservar respaldos históricos y originales. Detenerse ante diferencias inexplicadas. |
| 3 · Artefacto | Codex | Verificar reprotest 1.8.0/build 18 real, SHA-256, firma automática, Team, perfil vigente/dispositivo y entitlements. Código A–D presente; ningún DROP_LOCK_SCREEN_PROBE. Revalidar espacio de instalación sin imponer el mínimo de Xcode a este paso. |
| 4 · Actualización | Codex, tras autorización | Una instalación in-place, sin desinstalar, borrar contenedor ni abrir automáticamente. Si falla, detenerse. Ninguna intervención sobre la original. |
| 5 · Migración | Usuario abre; Codex compara tras cierre | Primer arranque correcto; cerrar y verificar SQLite v4, integrity_check=ok y FK=0. Comparar todo el inventario y relaciones contra el preflight. La migración sucede al abrir; no certificarla solo por instalar. Ante pérdida, parar sin restauración automática. |
| 6 · Selector | Usuario | En Biblioteca → Archivos, Importar archivo abre una sola selección nativa. Cancelar vuelve sin error ni elemento nuevo. Registrar presentación, cierre y recuperación del foco. |
| 7 · MP3 | Usuario + comparación técnica | Seleccionar fixture pequeño autorizado con audio MP3. Confirmar un ready disponible, título/tipo/duración, portada genérica y reproducción mediante el motor existente. |
| 8 · M4A/AAC | Usuario + comparación técnica | Mismo contrato para M4A con AAC. ALAC queda fuera. El sufijo por sí solo no acredita compatibilidad. |
| 9 · MP4 con video | Usuario + comparación técnica | Fixture MP4 con pista de video; imagen/audio según el medio. Un MP4 solo de audio queda fuera del contrato. |
| 10 · Fuente | Codex donde haya acceso autorizado + usuario | Original de cada fixture en Archivos sin mover, alterar ni borrar. Comparar hash cuando sea verificable; no leer documentos personales. No dar por preservado el original solo por aparecer en la UI. |
| 11 · Proveedores | Usuario | Probar iCloud Drive no materializado si está disponible y un proveedor externo ya configurado, por separado. No iniciar sesiones nuevas por rutina. Si no están disponibles, NO VERIFICADO con motivo. |
| 12 · Progreso/cancelación | Usuario | Distinguir preparación, copia medida, validación y guardado. Cancelar selección y copia cuando sea observable; esperar al lector antes de confirmar. Guardado no ofrece una cancelación ficticia. No exigir observar un estado instantáneo ni llenar el dispositivo para provocar errores. |
| 13 · Error/recuperación | Usuario | Fixture propio corrupto o incompatible con extensión seleccionable: error comprensible, ninguna fila ready y posibilidad de nueva importación. No forzar rutas ni inyectar fallos en datos reales. Errores SQL, espacio y permisos no reproducibles siguen cubiertos en host, sin PASS físico inventado. |
| 14 · Doble activación | Usuario + inventario | Pulsaciones rápidas: un selector, una operación y una fila. Una selección deliberada posterior es otra importación con UUID propio, no una duplicación accidental. |
| 15 · Biblioteca/contexto | Usuario | Búsqueda, filtros, orden, lista/cuadrícula y reproducción actual se mantienen. Si ocultan el nuevo archivo, mensaje útil sin restablecerlos. Confirmar aparición al retirar voluntariamente el filtro. |
| 16 · Sin conexión/reinicio | Usuario | Tras ready, reproducir la copia sin red ni acceso al proveedor. Cerrar y reabrir Drop: archivo disponible, progreso y preferencia de vista conservados. |
| 17 · Controles existentes | Usuario | Play/Pause y ±15 segundos sin regresiones. No probar Anterior/Siguiente como función nueva ni registrar diagnóstico de build 17. |
| 18 · Accesibilidad/aspecto | Usuario | VoiceOver, foco tras selector/error/fin, Dynamic Type, temas y pantallas pequeñas; acciones accesibles, sin superposición ni anuncios repetidos de porcentajes. |
| 19 · Borrado controlado | Usuario + comparación técnica | Solo un importado de prueba identificado por UUID y con confirmación; conservar fuente de Archivos y todos los demás elementos/relaciones. No usar archivos preexistentes como fixtures destructivas. |
| 20 · Cierre de datos | Codex | Comparar inventario esperado tras importaciones/borrado deliberados, IDs y relaciones; SQLite íntegro, FK=0, sin pérdidas ni duplicados accidentales. Separar cambios legítimos de progreso y cachés. Conservar evidencia y respaldo previo recuperable. |

No ejecutar este protocolo en E1 ni crear una tercera identidad. La instalación
limpia de la matriz histórica requiere un entorno desechable y autorización
propia; no justifica desinstalar reprotest. Una build 17 no puede considerarse
rollback suficiente de SQLite v4: la recuperación requiere una estrategia de
esquema y respaldo coherente, sin restauración destructiva automática.

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


## E0 · Preparación nativa del 7/11/2026

Prebuild propio y recursos Python/QuickJS preparados, sin alterar versiones ni
los resultados de A–D. Se conservan las notas E1/E2 anteriores. El estado actual
es **BLOCKED por herramientas Ruby**, no por espacio: no se ejecutó pod install.
Ruby 2.6/SDK y el runtime alternativo 3.1.7 no permiten el bundle fijado actual.
Antes de E1 hace falta un runtime completo compatible, luego gemas fijadas,
configuración nativa y una instalación focal de Pods con fuentes de este checkout.
No crear ni copiar DerivedData para aparentar un preflight válido. El bridge Expo,
registro en el target y funcionamiento físico permanecen pendientes.


### E0.1 · Estado posterior

Ruby 4.0.7 completo ya existe y pasó los módulos básicos en entorno aislado.
El lock actual no lo admite por dos restricciones transitivas verificadas.
La propuesta CFPropertyList 3.0.8/minitest 5.27.0 sigue en una copia privada;
no se cambió el lock real ni se inició su instalación por falta de reserva.
Recuperar margen (mínimo 24.35 GiB para presupuesto de ensayo 0.35 GiB) o
validar un destino externo autorizado antes de continuar. Después comprobar
CocoaPods 1.16.2 y Xcodeproj; no avanzar a E1/E2 automáticamente.


### E0.1B · Ensayo privado aprobado

Resolución del bundle y ejecución de CocoaPods1.16.2 PASS con Ruby4.0.7,
Bundler2.4.22 y compatibilidad del proyecto. Xcodeproj1.28.1 hace round-trip de
una copia privada. La propuesta requiere también BigDecimal4.0.1 y Benchmark0.5.0,
además de CFPropertyList3.0.8/minitest5.27.0. Gemfile/lock oficiales no modificados.
Aprobar explícitamente el diff y entorno antes de completar E0. No pod install,
compilación integrada ni E1/E2 ejecutados. Conservar BUNDLE_NO_PRUNE=true.


### E0.1C · Gemfile oficial verificado; integración de Pods pendiente

Adoptados CFPropertyList 3.0.8, minitest 5.27.0 y declaraciones explícitas de
bigdecimal 4.0.1/benchmark 0.5.0; lock idéntico al ensayo y sin otras versiones
modificadas. Ruby 4.0.7 ARM64/Bundler 2.4.22/CocoaPods 1.16.2/Xcodeproj 1.28.1
verificados desde el Gemfile oficial. Se conservan los avisos de plataforma.

Una sola instalación con deployment/no-repo-update falló en 1.01 s al evaluar
Podfile: PATH aislado sin `/usr/local/bin`, por lo que Node no se encontraba.
No se reintentó. Workspace/Pods.xcodeproj y registro integrado siguen pendientes.
Copias verificadas de fuentes, lock, configuración automática de reprotest y fase
Python preparadas en el árbol ignorado; no confundirlas con integración exitosa.
Antes de un nuevo intento autorizado, corregir solo PATH y validar Node/Expo/RN
desde el entorno efectivo; conservar reserva de espacio. Sin E1/E2, builds,
instalaciones, limpieza ni commit. Evidencia E0.1C en engineering-state.


### E0.1D · Pods preparados

PATH corregido y Node/Expo/RN verificados en el entorno efectivo. Una instalación
con deployment/no-repo-update PASS: 115 Pods, workspace propio válido y tres
módulos locales registrados con todas sus fuentes Swift. Python/QuickJS disponibles
con soporte generado. Locks sin cambios. Reserva de 24 GiB conservada.
No se compiló ni instaló; bridge integrado y ejecución física pendientes de E1/E2.
Evidencia y advertencias en engineering-state. No iniciar E1 automáticamente.


### E1 · Candidata integrada preparada

Build 18 reprotest 1.8.0 PASS: una Release ARM64 firmada, Hermes actualizado y
fuentes/módulos propios comprobados. Perfil existente vigente y sin renovación.
Evidencia E1-build18-reprotest-j25js2s0 en engineering-state. No instalada;
E2 sigue NO EJECUTADO. Revalidar versión instalada al conectar el iPhone y
respaldar inventario real/SQLite-WAL coherentes antes de la migración v3→v4.


## Checkpoint físico de reprotest · 8/11/2026

Usuario confirma PASS manual de MP3/M4A/MP4, reproducción y controles de audio,
video MP4, persistencia de los tres importados, offline, búsqueda/orden,
lista/cuadrícula, creación/persistencia de Colecciones y cancelación del selector.
Confirma conservación/migración v3→v4, también comprobadas técnicamente antes de
las nuevas importaciones. No atribuir un inventario técnico posterior no capturado.
No se repitieron pruebas ni se generaron logs físicos ficticios.

La matriz describe criterios, no un total de PASS: siguen sin confirmación los
escenarios de proveedor, fallos, cancelación de copia, doble activación, borrado
y accesibilidad completa. Es un checkpoint de la rama 1.8.0, sin release/tag/main.
Consultar el estado operativo para evidencia técnica y limitaciones históricas.
