# Estado operativo de Drop

Actualizado: 6 de noviembre de 2026. Snapshot humano: verificar Git antes de actuar.
No contiene autorizaciones nuevas ni resultados inferidos.

## Estado actual de Drop 1.7.1 build 16

- Rama `codex/v1.7.1-library-recovery` desde v1.7.0
  `cfdc271f37325264bbb46f3f2e2e27b8c9bafb13`. Archivos y Colecciones
  conservaban un error de lectura tras una recarga exitosa. El detalle
  de colección borraba también los errores de operación al refrescar.
- El error de lectura de la pestaña o colección vigente tiene una acción
  accesible de reintento. La lectura exitosa retira ese error y recupera
  el resultado o el estado vacío. Las respuestas obsoletas se descartan
  y la recarga conserva consulta, filtros, orden y modo de vista.
- RED con siete fallos esperados. GREEN con 72 PASS y 0 FAIL en Biblioteca, detalle de
  Colecciones y navegación. TypeScript y lint focal sin errores.
  Formato y diff verificados. Logs en DropValidationEvidence/v1.7.1-library-recovery-2026-11-06-pepqbu2n.
- Reprotest com.odincarballo.drop.reprotest actualizada in-place a 1.7.1/build 16
  desde 1.7.0/build 15 en una ejecución. Conservados los seis LibraryItems,
  seis medios, seis portadas, identificadores, progreso y preferencias.
  SQLite v3 íntegro, cero violaciones FK, respaldo incremental de 20 archivos
  verificado. Evidencia en DropValidationEvidence/v1.7.1-build16-install-2026-11-06-kwp9auq9.
- Validación física confirmada por el usuario en reprotest: 4 PASS, 0 FAIL
  en Biblioteca, Colecciones, navegación y controles, y reproducción.
  La recuperación de errores se cubrió en la suite automatizada de 72 PASS.
  La prueba física se limitó al funcionamiento normal y no provocó un error real.
- Original com.odincarballo.mediadrop actualizada in-place a 1.7.1/build 16
  desde 1.7.0/build 15 en una ejecución. Conservados 14 LibraryItems,
  14 medios, 14 portadas, una colección, identificadores, progreso y preferencias.
  SQLite v3 íntegro y cero violaciones FK. Respaldo incremental de 34 archivos
  verificado. Se conservaron las eliminaciones intencionales y los respaldos
  históricos. Evidencia en DropValidationEvidence/v1.7.1-original-install-2026-11-06-4kgx7t06.
- El usuario confirmó 4 PASS y 0 FAIL físicos en la original para Biblioteca
  y archivos, Colecciones, reproducción, y navegación y preferencias.
  Total físico de las dos aplicaciones instaladas y validadas de 8 PASS y 0 FAIL.
  Los escenarios de recuperación ante errores se verificaron con pruebas
  automatizadas. En iPhone se comprobó el funcionamiento normal, sin provocar
  un error de lectura real. Sin fallos confirmados pendientes dentro del alcance probado.
- La build original corresponde a 74fa2ed6660f94f72b22015892f550bb518a9d51.
  El cierre posterior registra los resultados físicos en un commit documental.
  La publicación en odincarballo/Drop se comprueba con main y el tag anotado v1.7.1.

Las notas siguientes conservan el historial; no describen el estado vigente.

## Histórico de Drop 1.7.0 build 15

- Original com.odincarballo.mediadrop y reprotest com.odincarballo.drop.reprotest:
  1.7.0/build 15 instaladas in-place. Team HK927RUDLZ. Bloques 0, A1, A2, B y C
  cerrados. Sin fallos conocidos pendientes dentro del alcance validado.
- Usuario confirma 11 PASS físicos, cero FAIL. Reprotest (7): encabezado/navegación,
  ordenamiento compacto, persistencia lista/cuadrícula, integridad/reproducción,
  Dynamic Type, temas claro/oscuro, VoiceOver/foco. Original (4): Biblioteca/datos,
  reproducción/progreso, nueva interfaz y persistencia. No se repitieron pruebas.
  Son resultados del alcance observado, no garantía de todos los escenarios,
  dispositivos, versiones de iOS ni accesibilidad exhaustiva.
- Datos originales antes/después: 13 LibraryItems ready, 13 medios, 13 portadas,
  una Collection, cero memberships y Cola vacía. IDs, metadatos, progreso y
  preferencias conservados; SQLite v3 integrity_check=ok, FK=0. Las nueve
  eliminaciones previas fueron confirmadas como intencionales y no se restauraron.
- Evidencia bajo DropValidationEvidence:
  original v1.7.0-original-install-2026-11-05-adxnsgax/RESULT.json;
  respaldo original v1.7.0-original-data-preflight-2026-11-05-ajfvp7x0/backup-current
  (32 archivos verificados, incluidos 26 hashes de medios/portadas).
  Reprotest v1.7.0-build15-install-2026-11-05-7nsohzo1/RESULT.json y backup-current
  (seis elementos, seis medios, seis portadas; 19 archivos protegidos).
- Código instalado original: 317f9434ac7e17db6b98dc9a3528a92731e38815.
  Este cierre documental es posterior y no cambia código ni metadatos.
  Artefactos original y reprotest conservados por separado:
  v1.7.0-build15-original-2026-11-05-is1n_sro/Drop.app y
  v1.7.0-build15-auto-reprotest-2026-11-05-cdsq3zva/Drop.app.
- Firma automática existente, sin renovación: original hasta 11/11/2026,
  11:56:12 CDMX; reprotest hasta 11/11/2026, 07:40:54 CDMX. Revalidar antes
  de futuras operaciones. Perfil administrado por Xcode: no imponer firma manual.
- Metadatos 1.7.0/build 15 consolidados; sin cambios de dependencias. Identidad
  por entorno, sin Bundle ID fijo de reprotest. Lista/cuadrícula es la única
  preferencia nueva; no garantiza persistir una escritura fallida/interrumpida.
- Cierre Git autorizado: commit documental en main, tag anotado v1.7.0 sobre ese
  commit y push normal exclusivamente de main y ese tag a odincarballo/Drop.
  Verificar publicación mediante refs remotas. Sin GitHub Release adicional.
  v1.6.0 se conserva intacto; no iniciar 1.8.0 automáticamente.
- NOT_READY continúa como observación independiente no reproducida; reinicio de
  medios completados es comportamiento previsto. No son fallos confirmados de 1.7.0.

## Histórico: desarrollo y preflight de 1.7.0 desde 1.6.0

- Release estable: `77f87b352ec9738bc57a5ac0579572d392582409`.
  Main y tag anotado v1.6.0 publicados en `https://github.com/odincarballo/Drop`.
  v1.5.0 permanece intacto. No se creó GitHub Release.
- Original `com.odincarballo.mediadrop`, Team `HK927RUDLZ`: 1.6.0/build 14
  instalada in-place y validada físicamente. Usuario confirma Biblioteca,
  Colecciones, reproducción, conservación de cuadrícula y navegación a Descargar:
  cinco PASS dentro de esos escenarios, sin ampliar su alcance.
- Preservados 18 LibraryItems ready, 18 medios, 18 portadas y una Collection;
  identificadores, relaciones, progreso y preferencias conservados. SQLite v3:
  integrity_check=ok y FK=0. Respaldo recuperable vigente y evidencia de instalación
  bajo `DropValidationEvidence/`:
  `original-v1.6.0-preflight-2026-11-04-vrflo7g7/backup-current` y
  `v1.6.0-original-install-2026-11-04-jke7t9q1/RESULT.json`.
- Artefacto original conservado:
  `v1.6.0-build14-original-renewal-2026-11-04-a37zu9qz/Drop.app`.
  Perfil original renovado hasta 11/11/2026, 11:56:12 CDMX;
  reprotest hasta 11/11/2026, 07:40:54 CDMX. Revalidar antes de firmar/instalar.
- Reprotest `com.odincarballo.drop.reprotest`: 1.6.0/build 14 instalada;
  seis elementos, medios y portadas preservados. A/B/C y navegación 3/3 PASS físicos.
  Artefacto build 14 y respaldo `v1.6.0-build14-install-2026-11-04-haz54hdq/backup-current`
  conservados. Binarios sustituidos de build 12/13 retirados con autorización;
  manifiestos, source maps y logs conservados. No asumir que esos binarios existen.
- Host histórico: A 35 PASS, B 4 focales PASS, C 30 PASS y navegación 8 focales PASS;
  ejecuciones solapadas, no sumables. Tipos, lint, formato y diff aprobados según
  sus evidencias. No se repiten para este cambio documental.
- Configuración estable: 1.6.0/build 14; plugin explícito
  `expo-status-bar/app.plugin.js`; Metro extiende `expo/metro-config`, resolución
  local y externa opcional por `DROP_METRO_NODE_MODULES`, sin worktree fijo.
  Identidad por `DROP_BUNDLE_IDENTIFIER`; original `com.odincarballo.mediadrop`.
  No incorporar perfiles, certificados ni proyectos nativos generados a Git.
- Límites históricos de 1.6.0: VoiceOver completo y duraciones numéricas de todos los ordenamientos
  no contrastados físicamente. NOT_READY no reproducido; reinicio de un medio
  completado es comportamiento previsto de PlaybackPolicy.restored(). Sin 1.5.1.
- 1.7.0: Bloque 0 exclusivamente documental en `codex/v1.7.0-library-ux`,
  desde el release estable; [contrato UX/UI](library-ux-v1.7.0.md) aprobado.
  Composición de Biblioteca y persistencia futura de lista/cuadrícula mediante
  AsyncStorage existente. Bloque 0 aprobado en `56b2b830f6ca1d4499ebecb30e9d3ecf33fc9f8d`.
  A1 (`69be727`) implementa un encabezado Biblioteca, accesos Cola/Ajustes y pestañas
  Archivos/Colecciones; rutas y valores internos downloads/collections intactos.
  Encabezado y pestañas permiten ajuste de líneas; objetivos táctiles mínimos
  de 48 puntos en accesos y 44 en pestañas, sin altura fija de los accesos.
- A1: TDD inicial con tres fallos esperados de composición/etiquetas; después
  seis casos PASS, cero FAIL y 46 no seleccionados en library-screen y
  main-navigation (encabezado, pestañas y navegación/contexto de vista).
  TypeScript: cero diagnósticos. ESLint focal con configuración Expo: cero errores;
  nueve advertencias preexistentes en imports/require del archivo de pruebas.
  Formato focal y diff check PASS. Dependencias externas existentes reutilizadas
  mediante resolución explícita de las herramientas, sin instalaciones, copias ni
  enlaces nuevos. Las consultas iniciales de tipos/lint sin resolución externa
  correcta fallaron; no eran defectos de código ni resultados reutilizables.
- A2 (`6949bd5`): único botón Orden con criterio actual, ActionSheetIOS
  con las seis etiquetas originales y Cancelar; selección anunciada en el mensaje,
  tema claro/oscuro efectivo y control mínimo de 44 puntos con texto adaptable.
  Guardas de apertura única y generación por foco/sección descartan callbacks
  repetidos, tardíos o posteriores al desmontaje. Algoritmos libraryQuery intactos;
  búsqueda, filtros, vista, tarjetas, motores y persistencia sin cambios.
- A2 TDD: tres fallos iniciales esperados por ausencia del selector; nueve casos
  focales PASS antes del cierre. Bloqueo de lint preexistente confirmado contra HEAD:
  cuatro asignaciones durante render en LibraryRoute, LandingRoute y DownloadRoute
  (playbackSnapshot y session), regla react-hooks/globals. Corrección expresamente
  autorizada: capturar los valores de hooks en useLayoutEffect, sin alterar rutas,
  aserciones ni providers y sin desactivar reglas. Sin cambios adicionales de producción.
- Validación final tras corregir el mock: 21 pruebas de navegación PASS y seis
  focales de Biblioteca PASS (28 no seleccionadas); 27 casos distintos, cero FAIL.
  Incluye seis correspondencias en lista/cuadrícula, cancelación, reproducción
  contextual, aperturas repetidas, fallo nativo y callbacks tardíos/desmontaje.
  TypeScript cero diagnósticos; ESLint focal cero errores, con nueve avisos previos
  en library-screen y dos en main-navigation conservados. Formato y diff check PASS.
  Dependencias externas existentes reutilizadas por resolución explícita de las
  herramientas, sin instalaciones, copias de dependencias ni enlaces nuevos.
- B (`47af3e4`): LibraryViewProvider existente persiste exclusivamente
  list/grid mediante AsyncStorage 2.2.0, clave drop.library.view.v1. Lista por defecto
  si falta preferencia, es inválida o falla su lectura. UI inmediata y selección
  del usuario prioritaria frente a hidratación tardía; lecturas pendientes ignoradas
  tras desmontaje. Escrituras serializadas después de la lectura inicial, sin
  escribir valores predeterminados ni permitir finalizaciones fuera de orden.
  Los errores no rompen la UI, no declaran éxito y no bloquean escrituras posteriores.
  No se garantiza persistencia de una escritura fallida o interrumpida al terminar
  el proceso. No se persisten búsqueda, filtros, ordenamiento ni desplazamiento.
- B TDD: 10 fallos y dos PASS iniciales sobre el provider previo; validación final:
  19 PASS, cero FAIL, 48 no seleccionadas en tres archivos (12 casos del provider,
  cuatro de navegación de vista y tres de Biblioteca directamente afectados).
  Caso histórico de nuevo propietario actualizado deliberadamente para restaurar
  cuadrícula; almacenamiento simulado aislado entre pruebas de Biblioteca.
  TypeScript cero diagnósticos; lint focal cero errores y 11 avisos preexistentes;
  formato focal y diff check PASS. Sin nuevas dependencias ni cambios a A1/A2,
  SQLite, LibraryItem, tarjetas, reproducción, descargas o navegación.
- C aprobado: usuario confirma en reprotest 1.7.0/build 15 siete PASS físicos,
  cero FAIL: encabezado/navegación; ordenamiento compacto; persistencia lista/cuadrícula;
  integridad básica/reproducción; Dynamic Type; temas claro/oscuro; VoiceOver/foco.
  Son observaciones del usuario dentro del alcance realizado, no certificación
  exhaustiva de accesibilidad, todos los dispositivos o duraciones numéricas.
- Candidata construida desde `47af3e4afd26bdbbd314b56cc47d2cb1c1ed4dde` y los
  tres metadatos preparados. Primer intento falló por imponer firma manual sobre
  perfil gestionado por Xcode; reintento autorizado con firma automática PASS,
  sin renovación. Mantener firma automática para ese perfil; no repetir ese ajuste.
  Artefacto/evidencia bajo DropValidationEvidence:
  `v1.7.0-build15-auto-reprotest-2026-11-05-cdsq3zva/RESULT.json`.
  Reprotest: perfil vigente hasta 11/11/2026, 07:40:54 CDMX.
- Instalación in-place de reprotest: una ejecución PASS; seis LibraryItems, seis
  medios y seis portadas preservados; IDs, metadatos, progreso y preferencias
  coincidentes. SQLite v3 integrity_check=ok, FK=0. Respaldo incremental recuperable
  `v1.7.0-build15-install-2026-11-05-7nsohzo1/backup-current`, 19 archivos verificados;
  resultado de instalación en RESULT.json de esa misma carpeta padre.
- Git: rama codex/v1.7.0-library-ux; base main/v1.6.0
  `77f87b352ec9738bc57a5ac0579572d392582409`. Bloque 0 `56b2b83`, A1 `69be727`,
  A2 `6949bd5`, B `47af3e4`; este cierre es solo documental. Metadatos pendientes
  app.json/package.json/package-lock.json: exclusivamente 1.7.0/build 15, sin
  cambios de dependencias ni identidad fija de reprotest. Son comunes a la release;
  Bundle ID/Team/perfil y overrides nativos son configuración de variante separada.
- Plan mínimo pendiente, sujeto a autorizaciones: consolidar los tres metadatos;
  verificar rama/main limpios y ascendencia, integrar por fast-forward sin tag;
  preparar original con DROP_BUNDLE_IDENTIFIER=com.odincarballo.mediadrop,
  Team HK927RUDLZ, firma automática y perfil original vigente (no el de reprotest).
  Revalidar versión instalada para confirmar actualización 1.6.0/14 a 1.7.0/15.
  Una build incremental Release ARM64 con recursos existentes, >=24 GiB iniciales,
  dos jobs y vigilancia cada cinco segundos, parada a 15 GiB; sin clean/prebuild.
  Verificar identidad, versión, firma/perfil/entitlements/dispositivo, Hermes,
  fuentes y hashes; archivar candidata original sin reutilizar el binario reprotest.
- Antes de instalar: inventariar original cerrada y comparar con respaldo reciente;
  no asumir que siga teniendo 18 elementos. Proteger diferencias incrementalmente
  y verificar recuperación, SQLite/FK, medios/portadas, relaciones, progreso y
  preferencias. Una instalación in-place autorizada, sin desinstalar ni restaurar;
  comparar después y validar físicamente la original. Solo tras su aprobación:
  cierre documental, tag anotado v1.7.0 y publicación GitHub con autorización.
- No se integra, compila, instala ni renueva en este preflight. La original
  permanece en 1.6.0/build 14 según última evidencia; su inventario y perfil deberán
  revalidarse antes de las operaciones futuras. No existe release original 1.7.0
  desplegada ni tag v1.7.0 creado por esta intervención.

Las secciones siguientes son snapshots históricos, no instrucciones vigentes.

## Histórico: cierre de Drop 1.5.0 build 11

- Instalada en la original `com.odincarballo.mediadrop`, Team `HK927RUDLZ`.
  Código funcional: `66f5ea563e9b7bc1bfe61046dc883e7cc2a729e8`.
  El commit de cierre consolida únicamente metadatos 1.5.0/build 11 y este estado;
  se distingue del commit funcional usado para construir. Sin cambios de dependencias.
- A–D completados: sesión de descarga estable durante navegación, Biblioteca/Descargar,
  búsqueda combinada, filtros y seis órdenes, acciones del archivo completado.
  PASS físicos comunicados por el usuario en reprotest: navegación, conservación
  visual de originales y nuevas descargas, búsquedas en chino/sin distinguir
  mayúsculas y tonos/múltiples palabras, filtros combinados y controles de orden;
  autoplay desde Biblioteca, MiniPlayer/pausa/reanudación, reproducción entre
  pestañas, descarga durante navegación repetida, finalización con una entrada
  visible, apertura/estado de Cola y teclado sin superposición incorrecta.
- Autoplay desde «Abrir archivo»: FAIL en build 10; corregido en el commit
  funcional, 46 + 21 pruebas focales PASS y checks estáticos PASS; PASS físico
  confirmado por el usuario en reprotest build 11. No se repitieron suites para cerrar Git.
- Original: una actualización in-place de 1.4.1/build 9 a 1.5.0/build 11, sin
  desinstalar ni restaurar. Preservados 15 LibraryItems ready, 15 medios,
  15 portadas y 1 Collection; IDs, metadatos, progreso y preferencias coincidentes.
  SQLite v3 integrity_check=ok, FK=0, sin archivos faltantes, huérfanos ni duplicados.
  Se reutilizaron hashes donde los metadatos no cambiaron; cuatro archivos con
  metadatos distintos se releyeron y coincidieron. Inicio con portadas, reproducción
  de un archivo existente y apertura de la Collection: PASS observados por el usuario.
- Evidencia durable bajo `/Users/odincarballo/Library/Application Support/DropValidationEvidence/`:
  `v1.5.0-build11-original-2026-10-31-_86rrbhc/installation/RESULT.json`;
  respaldo recuperable `drop-original-v1.4.1-build9-pre-v1.5.0-2026-10-31-jbl7tpzz/`.
  Respaldo con 30 hashes de medios/portadas verificados, SQLite/WAL/SHM, preferencias;
  clones APFS independientes y copia de archivos nuevos; restauración física no ensayada.
- Identidad Expo por `DROP_BUNDLE_IDENTIFIER`; para original:
  `com.odincarballo.mediadrop`. No fijar reprotest ni sobrescribir la configuración
  guardada de variantes; los proyectos nativos generados no forman parte del commit.
- Límites: validación dentro del alcance observado; VoiceOver no verificado y
  duraciones numéricas del orden no contrastadas. Apertura de Cola no acredita
  todas sus operaciones; no se infieren PASS físicos de escenarios no documentados.
  Mejora no bloqueante: indicar mejor el desplazamiento horizontal de los órdenes.
  NOT_READY y progreso al repetir archivos completados siguen como incidencias
  independientes, sin diagnóstico/corrección atribuida a esta versión.
- Próxima acción: renovar aprovisionamiento antes del **06/11/2026, 17:43:54 CDMX**
  (perfil original `549b057e-e195-4b9a-9315-d6f3241efd9f`). Mantener Bundle ID,
  Team, certificado, dispositivo y entitlements; proteger datos actuales antes de
  actualizar in-place. Renovación, nueva firma e instalación requieren autorización.
  Cierre Git local: commit de metadatos/estado, main por fast-forward y tag anotado
  v1.5.0; sin push. No iniciar 1.6.0. Las secciones siguientes son snapshots históricos.

## Histórico: pulido y cierre 1.5.0 D

- Misma rama/worktree; base `ae7c5ccb2acb5916eccb9ef7a09932bc9d39dade`,
  árbol `01eafd890524c964c0d5306ce36cda3bfca635f6`. D cerrado con commit local en esta rama (consultar SHA con Git); sin build ni instalación.
- Resultado completado: botón Abrir archivo mediante libraryId real y PlayerScreen
  existente. Sin URI como identidad, sin otra sesión de reproducción ni cambios
  de motores/providers. PlayerScreen conserva el rechazo de archivos ausentes.
  Mensajes de exportación con región viva; tamaños/temas de ActionButton reutilizados.
- Verificación cruzada sobre rutas/providers reales con I/O simulado: continuidad,
  apertura del resultado, búsqueda/orden, reproducción contextual y archivo ausente.
  Pruebas de operaciones consecutivas usan el ID actualizado. Regresiones de
  cancelación y finalización locales seleccionadas; no repetir suites A/B/C completas.
- Validación D: 30 pruebas distintas PASS (22 acciones/rutas, 5 regresiones de
  descarga/cancelación, 3 finalizaciones locales); las demás no ejecutadas por filtro.
  TypeScript, lint Expo y formato focal comprobados; no se suman suites históricas.
- Reutilización: selectores y Biblioteca de C, políticas de limpieza de A y rutas,
  MiniPlayer/temas de B sin cambios. Sus resultados históricos no se suman a D.
- Identidad futura de prueba: `DROP_BUNDLE_IDENTIFIER=com.odincarballo.drop.reprotest`,
  Team HK927RUDLZ vía configuración externa existente. Compatibilidad in-place
  prevista por identidad/schema v3 conservados, pendiente de comprobar contra
  instalación, entitlements y provisioning reales; no hay garantía de contenedor.
  Metadatos siguen 1.4.1 build 9: preparar versión de candidata por separado.
- Sesión física única propuesta, con autorización posterior:
  1. Verificar identidad/firma y respaldo consistente actualizado de reprotest,
     SQLite/WAL, integridad/FK, conteos y hashes de medios/portadas/progreso/cola.
  2. Usar solo nuevos medios pequeños autorizados (audio/video); analizar y
     descargar cambiando Biblioteca/Descargar, comprobar progreso y promoción única.
  3. Abrir resultado, buscarlo, combinar filtros/orden, iniciar reproducción y
     cambiar consulta sin alterar CURRENT; MiniPlayer, Cola, Collections y PiP/retorno.
  4. Teclado/dismiss, safe areas, orientación/tamaño disponible, Dynamic Type y
     VoiceOver; no declarar otros dispositivos o tamaños comprobados.
  5. Comparar datos previos/posteriores, diferenciar progreso legítimo, conservar
     evidencia y limpiar solo fixtures por acciones normales si se autoriza.
     La original queda fuera. No reutilizar instrumentación temporal.
- Reanudación: A/B/C/D implementados mediante commits locales. Preparar una única
  candidata integrada en reprotest requiere autorización posterior; no comenzar
  esa preparación en este cierre ni integrar en main. Después, autorización de
  firma, backup e instalación con límites de recursos del workflow. NOT_READY y
  progreso al repetir completados siguen independientes. No desplegado; main intacto.

## Bloque C cerrado: búsqueda y organización

- Misma rama/worktree; base `b25339944645fede8ef9079fa55680c5fb0b47bc`,
  árbol `598f2716f8ea8512460455c6eaa34ce0d0ae3338`. C cerrado con commit local en esta rama (consultar SHA con Git).
- Selector puro sobre el snapshot: palabras combinadas con AND, sin mayúsculas,
  tildes o espacios sobrantes; título, contenedor, resolución e ID de origen.
  Filtros audio/video y seis órdenes, con desempates de fecha/ID; duraciones
  desconocidas al final en ambas direcciones. Predeterminado igual que SQLite:
  downloadedAt DESC, id DESC. No se persiste consulta ni preferencia.
- Controles desplazables, estados vacío/sin coincidencias/sin tipo/error distintos.
  Filas no disponibles, acciones y confirmaciones existentes preservadas.
  Solo reproducción explícita adopta el orden visible de elementos reproducibles;
  los cambios de consulta no reescriben CURRENT ni su contexto activo.
- Pruebas focales: 53 PASS sobre selectores, Biblioteca, rutas reales y Collections.
  Avisos act de Collections conservados. No hay cambios en servicios, providers,
  schema, motores, dependencias, versión/build ni acceso al dispositivo.
- Reanudación: Bloque D — pulido final de interfaz y preparación de validación
  integrada de 1.5.0, pendiente de autorización; reutilizar esta rama/worktree.
  Validación física, VoiceOver y NOT_READY pendientes. No iniciar D durante este
  cierre ni integrar A/B/C en main.

## Bloque B cerrado: navegación principal

- Misma rama/worktree de A, HEAD base
  `cf97ca7baf9e670e6d7c0285364c4427e56a301c`, árbol
  `f37e046cf4653e55668254c6efcd9b0ede898fda`. B cerrado mediante commit local en esta rama (consultar SHA con Git).
- Biblioteca abre directamente en `/`; `/library` permanece como acceso directo.
  Descargar vive en `/download`. Una barra compartida usa `router.replace`,
  conserva las rutas secundarias y no reemplaza Expo Router. Seleccionar la
  sección activa conserva sus parámetros (incluida Colecciones).
- Un único MiniPlayer existente encima de la barra; la barra absorbe el inset
  inferior en rutas principales. El footer se oculta con teclado y el MiniPlayer
  conserva su propia política de ocultación en PlayerScreen. No se modifican
  PlaybackProvider, DownloadSessionProvider, hooks, motores ni contratos nativos.
- Pruebas nuevas con Expo Router, providers y pantallas reales; solo I/O simulado.
  Cubren historial, continuidad, selección/progreso, rutas secundarias, regreso
  del Player, teclado, safe areas y temas. No equivalen a una build o prueba física.
- Validación ejecutada: 155 pruebas PASS, una integración HTTP opt-in omitida;
  TypeScript y lint Expo PASS. Jest emite avisos `act` en la suite de Collections
  sin cambios; no se ocultaron ni se modificaron reglas. Compilación y físico pendientes.
- Reanudación: Bloque C — búsqueda, filtros combinados y ordenamiento de Biblioteca,
  pendiente de autorización. Reutilizar este entorno, el snapshot ya cargado,
  los filtros audio/video existentes y los contratos de reproducción contextual.
  No integrar A/B en main todavía; no comenzar C durante este cierre.
  Main, tags, versiones/build, dependencias y apps del iPhone intactos.
  NOT_READY y validación física siguen pendientes. No iniciar C.

## Bloque A cerrado: continuidad de descargas

- Worktree aislado `v1.5.0-download-continuity`, rama
  `codex/v1.5.0-download-continuity`, base
  `23873b3ad87fa69f97dff331428a7ce7c5e8871f`. Cierre de A:
  `cf97ca7baf9e670e6d7c0285364c4427e56a301c`;
  main y las apps instaladas no se modifican en este bloque.
- Implementación: propietario único de la sesión por encima de las rutas,
  reutilizando los tres hooks existentes. URL, selección, progreso y resultado
  sobreviven al desmontaje de Descargar; navegación no cancela, cancelación
  explícita y desmontaje del propietario conservan su limpieza.
- Observadores nativos estables, cancelación de análisis con generación y
  respuestas de jobs cancelados aisladas de operaciones posteriores. Sin cambios
  de motores, schema, dependencias, versión ni build. Sin instrumentación.
- Validación focal: 72 pruebas móviles PASS (Home y on-device YouTube), con
  navegación durante análisis/descarga, modos/formatos, cancelación, resultados
  obsoletos, sesión caducada, promoción única y liberación de observadores.
  No se ejecutó integración HTTP opt-in, compilación iOS ni validación física.
- Continuidad: B utiliza esta misma rama/worktree (estado actual arriba).
  No integrar A en main todavía. La navegación real queda pendiente de una
  candidata iOS y validación física autorizadas. Background
  y fin del proceso conservan las políticas existentes; no se implementó
  persistencia de trabajos fuera del proceso.
  NOT_READY continúa independiente.

## Snapshot del release instalado (histórico)

- **Estado:** Drop **1.4.1 build 9 instalada y validada en la original**;
  corrección `/live/{videoId}` integrada y desplegada. Release cerrado localmente.
- **Git:** parche funcional `3c745cf9a790a28b3e6e5c7c1122a0dac12888d2`;
  código instalado `ada0298813d6a57aa96d6dac6972f6741b687535`, árbol
  `947528629c20cb0184a77976c56cbe34604ccf68`. El commit documental de cierre
  es posterior y modifica únicamente este archivo: no fue compilado ni instalado.
  Main y `codex/release-v1.4.1-build9` quedan sincronizados por fast-forward;
  obtener el SHA documental y árbol final mediante Git. Sin merge commit,
  push ni tags nuevos. El tag v1.4.0 conserva
  `7927dec6429bdc85fbc19082ad62c18de99ffa73`.
- **Identidad instalada:** `com.odincarballo.mediadrop`, Team `HK927RUDLZ`,
  versión 1.4.1 build 9. Bundle ID por entorno en `mobile/app.config.js`;
  dependencias y schema SQLite v3 sin cambios. No fijar IDs de prueba en fuentes.
- **Parche:** `/live/{videoId}` se normaliza a `/watch?v={videoId}` con
  validaciones de URL existentes; se conservan los rechazos `is_live`,
  `is_upcoming` y `post_live`. No habilita directos activos ni evade restricciones.
- **Automatización aprobada:** 54 pruebas Python PASS y 27 móviles PASS sobre
  los hashes del parche integrado. Evidencia `youtube-live-normalization-2026-10-30-b2366s24`
  bajo `DropValidationEvidence`. No se repiten por cambios de metadatos y
  documentación; la build definitiva firmada también fue verificada.
- **Validación física aislada PASS:** app
  `com.odincarballo.mediadrop.live141test`, versión declarada 1.4.0 build 8,
  fuente `3c745cf9a790a28b3e6e5c7c1122a0dac12888d2`. Analizó el enlace
  `/live/u_uUZRU6kkQ?si=hHEJ_1BJbbj7QwMo` sin UNSUPPORTED_URL; mostró
  «LULA GANA LAS ELECCIONES», 47:50. Descarga única M4A: 46,425,805 bytes,
  estado ready, portada presente, AAC estéreo; reproducción confirmada por
  el usuario y progreso persistido de 12.94 s. SQLite v3 integrity_check=ok,
  FK=0 y hashes de medio/portada conservados tras reproducción. Evidencia:
  `live141-iphone-validation-2026-10-30-zl3bx2po/FINAL-RESULT.json`.
- **Límites de evidencia:** interfaz/reproducción observadas por el usuario;
  SQLite, hashes y progreso comprobados por herramientas. La normalización de
  la función Python empaquetada se ejecutó en host; no se capturó la URL
  canónica interna del iPhone. El análisis sigue el bridge nativo local sin
  fallback HTTP en código, pero **no hubo captura de tráfico del backend**.
  No certificar cero solicitudes por esta prueba. Otros formatos no se probaron
  físicamente; 47 formatos reportados en macOS no equivalen a 47 descargas iOS.
- **Build original verificada:** Release iPhoneOS ARM64, dos jobs, Hermes,
  Swift/CPython/bridge y Python `/live/` empaquetados; firma deep/strict PASS,
  mismo certificado y entitlements compatibles con build 8, sin instrumentación.
  SHA-256 del ejecutable firmado:
  `b814b16d7f05b45a65de8c2160ca85671bc4f7bd2eb219ee202af4dd987be15e`.
  Artefacto y manifiestos bajo `DropValidationEvidence`:
  `original141-build9-final-2026-10-30-1jkxxp4a/Drop.app` y `FINAL-RESULT.json`.
- **Instalación original in-place PASS:** una actualización, sin uninstall,
  reset ni restauración. Antes y después, previamente a reproducir:
  **13 LibraryItems ready, 13 medios, 13 portadas, 1 Collection,
  0 memberships y 0 entradas de Manual Queue**. IDs, metadatos, progreso y
  relaciones idénticos; 26 tamaños y SHA-256 coincidentes con el respaldo.
  SQLite v3 integrity_check=ok y FK=0 antes, después y tras el smoke.
  Evidencia de instalación:
  `/Users/odincarballo/Library/Application Support/DropValidationEvidence/original141-build9-install-2026-10-30-se0axyn4/FINAL-RESULT.json`.
- **Smoke original:** apertura sin Metro y reproducción confirmada por el usuario
  sin errores. Único cambio posterior: en «La forma CORRECTA de programar con IA
  en 2027: el método ODD», posición de 1261 s a 25.000150217 s y `completedAt`
  de fecha existente a null tras volver a reproducir un archivo completado.
  Es **comportamiento observado, sin diagnóstico definitivo**; no se declara
  corregido ni se interpreta como prueba de ausencia de defectos de progreso.
  Otros 12 registros y relaciones intactos. Tras reproducir se verificó que los
  metadatos de los 26 archivos no cambiaron; no se repitieron sus hashes completos.
- **Respaldo previo preservado:** bajo `DropValidationEvidence`,
  `drop-original-v1.4.0-build8-pre-build9-2026-10-30-aqz26b4c`, aproximadamente
  1.16 GiB; SQLite/WAL/SHM, 13 medios, 13 portadas, inventario y manifiesto.
  Dos lecturas independientes idénticas y metadatos estables; normalización solo
  sobre copia local. El paso histórico de 15 a 13 elementos corresponde a dos
  eliminaciones confirmadas por el usuario; ningún hash de archivo retenido cambió.
  Respaldos e informes anteriores conservados; no restaurar automáticamente.
- **Firma vigente:** perfil original renovado
  `549b057e-e195-4b9a-9315-d6f3241efd9f`, vence **06/11/2026, 17:43:54 CDMX**
  (2026-11-06T23:43:54Z). Mismo Team, certificado, App ID, entitlements y
  dispositivo. Perfil anterior apartado con copia verificada, no revocado;
  no se modificaron los otros perfiles. Para renovar de nuevo, autorización
  específica y verificación de la fecha real; no basta con que Xcode firme.
- **Unidad 1 y protocolo:** integrados en `9058c430eb55cd3c506e5d75bc330aecd8e4f99a`;
  commits originales `c4134d41cb0e60256fca29aa7e2bf826a7a693bf` y
  `7186eb8037ecad21bb1d5fa1f00c7f7085b7f59b` preservados. Protección de
  Biblioteca desplegada en build 8; schema v3 sin cambios en este release.
- **Incidencia independiente:** NOT_READY no fue reportado en los smokes
  aislado y original; origen histórico pendiente. No se declara corregido.
- **Aplicaciones de prueba conservadas:** `com.odincarballo.drop.reprotest`
  (1.4.0 build 7) y `com.odincarballo.mediadrop.live141test` (1.4.0 build 8)
  siguen instaladas según la verificación final. No se modificaron durante el
  upgrade original. Retirar la tercera requiere autorización independiente.
- **Protección:** árbol instrumentado `fix/library-incomplete-restore`, ambos
  Markdown locales protegidos, respaldos y evidencias permanecen intactos.
  Este cierre es exclusivamente documental y Git local, sin acceso al iPhone,
  nuevas pruebas, compilaciones ni instalaciones.
- **Próximo objetivo:** Drop **1.5.0**, pendiente de definición y autorización.
  No iniciar todavía. Pendientes independientes: seguimiento del provisioning,
  NOT_READY, observación de progreso al repetir completados y decisión sobre la
  app aislada. No se realizó publicación remota ni se autorizó por este cierre.

## Registro ligero de eficiencia

| Fecha      | Incidente verificado                                                    | Prevención                                                                                    |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2026-10-29 | App normal perdida tras desaparición de `/tmp`; hubo que regenerar      | Checkout durable y archivo automático antes de retirar entorno                                |
| 2026-10-29 | `eslint .` amplió alcance; seis errores reproducidos en base            | Usar lint Expo; registrar chequeos adicionales separados                                      |
| 2026-10-29 | Formato global recorrió 81 archivos de gemas/cachés                     | Formato sobre fuentes Git con reglas intactas                                                 |
| 2026-10-29 | Verificador supuso un nombre antiguo de framework Hermes                | Inspección de bytecode/dependencias reales                                                    |
| 2026-10-30 | Presencia de PID interpretada como app activa; bloqueo falso de captura | Confirmación de cierre y estabilidad de archivos/SQLite; no inferir escrituras solo de un PID |

Añadir solo incidencias accionables; no duplicar conversaciones ni logs.
