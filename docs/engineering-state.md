# Estado operativo de Drop

Actualizado: 11 de noviembre de 2026. Snapshot humano: verificar Git antes de actuar.
No contiene autorizaciones nuevas ni resultados inferidos.

## Drop 1.8.1 · cierre de la original del 11/11/2026

- **Actualización PASS.** Drop original `com.odincarballo.mediadrop` pasó de
  1.7.1 build 16 a 1.8.1 build 19 en una sola instalación in-place.
- **Migración PASS.** Biblioteca cargó en el único primer arranque manual.
  SQLite pasó de v3 a v5 con `integrity_check=ok` y FK=0. Se añadieron
  `artist`, `album`, `genre` y `year` con valores nulos. Se verificó la
  recuperación de los 39 archivos sobre una copia aislada.
- **Validación funcional PARTIAL.** Biblioteca, Colecciones, búsqueda,
  Lista/Cuadrícula y portadas PASS por confirmación física del usuario.
  Apertura del reproductor NOT TESTED: seleccionar un elemento de Biblioteca
  inicia la reproducción y puede modificar el progreso.
- **Cierre técnico PASS.** Tras el cierre de la app, SQLite v5 conservó
  `integrity_check=ok` y FK=0. Los mismos 17 identificadores, 17 medios,
  16 portadas, una colección, cero relaciones y Cola vacía. Progreso y
  preferencias coincidieron con la captura posterior a la migración.
  El episodio eliminado intencionalmente sigue ausente del inventario y
  no debe restaurarse.
- La build 19 original usa código de producción y tiene su propio artefacto
  firmado. La build 20 de reprotest es diagnóstica y su instrumentación
  permanece en el worktree separado. E2-D conserva el resultado PARTIAL
  y los casos NOT TESTED registrados en el cierre histórico.
- El perfil original incorporado vence el 11/11/2026 a las 11:56:12 CDMX.
  La vigencia deberá verificarse antes de cualquier ejecución futura.

Evidencias bajo `DropValidationEvidence`:

- Original: `v1.8.1-build19-original-continued-2026-11-10-393velud/CLOSURE.json`.
- Instalación y protección v3: `v1.8.1-original-install-2026-11-11-0y37pjgk/`
  (`RESULT.json`, `INCREMENTAL-RECOVERY-MANIFEST.json`).
- Primer arranque y recuperación v5: `v1.8.1-original-first-launch-2026-11-11-ujd5sd8i/`
  (`RESULT.json`, `RECOVERY-MANIFEST-v5.json`).
- Cierre funcional: `v1.8.1-original-functional-2026-11-11-wf9a8j0m/RESULT.json`.

**GO condicionado para revisión de integración en main.** Aceptar los casos
físicos pendientes y revisar el delta final sin instrumentación diagnóstica.
Consolidar este registro y obtener autorización específica antes de integrar.

## Drop 1.8.1 · cierre histórico de reprotest del 10/11/2026; E2-D PARTIAL

Estado consolidado el 10 de noviembre de 2026, a partir de evidencias existentes
y confirmaciones del usuario; no es una inspección nueva del iPhone.

- **E1 PASS:** candidata de código de producción 1.8.1 build 19, Release iPhoneOS
  ARM64/Hermes, archivada para `com.odincarballo.drop.reprotest`, no para la original.
  Firma/Team y fuentes A–D acreditados; sin instrumentación diagnóstica.
- **E2-A/B/C PASS:** protección incremental y recuperación aislada; instalación
  in-place de build 19; primer arranque y migración SQLite v4→v5. Se conservaron
  los nueve elementos iniciales, medios, portadas, IDs, relaciones y preferencias.
- **E2-D PARTIAL:** MP3/M4A con etiquetas y artwork; importación sin etiquetas,
  fallback ante artwork corrupto; miniaturas MP4 y persistencia PASS según capturas,
  datos instrumentados y confirmaciones físicas. Reproducción offline observada,
  sin captura instrumental de tráfico. No declarar validación física integral.
- **E2-D.4:** cancelar el diálogo antes de aplicar, completar cuatro campos ausentes
  conservando título y sustituirlo solo por confirmación explícita: PASS físico y
  SQLite. Persistencia comprobada tras cierre; los campos sobrevivieron reapertura.
  No se realizó reapertura visual adicional del título final. El diálogo nativo no
  tiene opción preseleccionada; no se reemplaza el título sin consentimiento.
- **Cola v5:** incorporación, orden y consumo automático PASS; aislamiento del
  contexto PARTIAL. Tras consumir Cola continuó Biblioteca completa y cambió
  progreso de dos elementos históricos. Incidente de procedimiento documentado,
  sin defecto de código confirmado, sin pérdida de medios ni restauración.
- **Video vertical en retrato PASS visual:** confirmación posterior del usuario
  sobre grabación: `E2D-06-vertical` centrado, sin deformaciones apreciables durante
  reproducción, antes del avance automático. No es una medición instrumentada.
- **NOT TESTED físicamente:** cancelar durante «Analizando…»; orientación horizontal
  durante reproducción; fallo de generación de miniatura; visibilidad de la acción
  en YouTube; reproducción prolongada/fidelidad audible. No convertir cobertura
  automatizada ni limitaciones aceptadas en PASS físico.
- **Último inventario acreditado:** 17 elementos/17 medios/10 portadas, una colección,
  una relación y Cola vacía. SQLite v5, integrity_check=ok, FK=0; conjunto recuperable
  de 35 archivos, recuperación verificada en copias aisladas. Se protegió otro medio local
  importado intencionalmente; 15 registros previos al diagnóstico idénticos al
  baseline de E2-D.4. Sin restaurar progreso histórico. Archivos previos reutilizados
  por tamaño/fecha estables y hashes de copias retenidas; no se rehashearon todos
  los medios en el dispositivo. No se generó otro respaldo completo.
- **Candidatas separadas:** build 20 diagnóstica, última instalación acreditada en
  reprotest; fuentes en worktree `v1.8.1-metadata-diagnostic`, ajenas a producción.
  No integrar esa instrumentación ni proponer build 19 sobre 20 como rollback
  automático. Evaluar compatibilidad y proteger datos antes de cualquier cambio.
- **Original protegida:** última versión acreditada 1.7.1/16, sin actualización
  autorizada a 1.8.1. No se volvió a inspeccionar su contenedor en este cierre.
- **Git:** `codex/v1.8.1-local-metadata`, HEAD
  `56ea42a4dab77f3e3251915c23d9c3b0da05b5d4`; cinco pendientes: estos dos documentos
  y `mobile/{app.json,package.json,package-lock.json}`. Metadatos coherentes con
  1.8.1/19, sin cambios de dependencias ni identidad fija reprotest. Los tres JSON
  permanecen intactos. Expo no acredita la configuración nativa futura de original.
- **Riesgos:** imágenes propias sin asociación pueden sobrevivir un cierre abrupto
  (sin journal nuevo); cobertura física limitada anterior. Perfil reprotest
  registrado hasta 11/11/2026 07:40:54 CDMX: revalidar antes de uso futuro, sin
  renovar en este cierre. Sin defecto confirmado bloqueante dentro del alcance.
- **Siguiente paso mínimo:** revisión y aceptación explícita de limitaciones y del
  cierre documental/metadatos antes de autorizar su commit. Una candidata original
  requerirá autorización propia, identidad/firma/entitlements nativos originales,
  recursos disponibles y protección actual de sus datos. No se inició release.

Evidencias bajo `DropValidationEvidence`:
`v1.8.1-E1-build19-reprotest-2026-11-08-9ym4dgm5/{VERIFICATION,CLOSURE}.json`;
`v1.8.1-E2A-reprotest-2026-11-08-yv7ysjk5/RESULT.json`;
`v1.8.1-E2B-reprotest-2026-11-08-mpk2wt35/RESULT.json`;
`v1.8.1-E2C-reprotest-2026-11-08-e19o9i_v/RESULT.json`;
`v1.8.1-E2D-reprotest-2026-11-08-pxl7y7sx/VALIDATION-MATRIX.json`;
`v1.8.1-E2D2-diagnostic-0dr1qkpf/{DIAGNOSTIC-INPUTS,CLOSURE}.json`;
`v1.8.1-E2D4-diagnostic-2026-11-09-ln_llpnn/{SUMMARY.md,VALIDATION-MATRIX.json}`
y `final-checkpoint/{RESULT,RECOVERY-MANIFEST,PROJECT-CHECK}.json`.
La confirmación posterior de orientación vertical procede del usuario en este chat;
no se inventó ni archivó una grabación no proporcionada. Las entradas siguientes
son historia de ejecución; sus bloqueos y «no ejecutado» no describen el estado actual.

## Drop 1.8.1 · CocoaPods offline preparado; listo para preflight de build19

- Último intento expresamente autorizado: pod install --no-repo-update exit0,
  20.04s,116 dependencias/115Pods. Red denegada; escrituras limitadas a ios,
  /dev/null y exactamente los dos destinos SQLite generados, hashes idénticos.
- Prebuilt React0.86.3 local seleccionado sin fallback a fuentes; todos los
  archives originales y dependencias JS intactos. Podfile.lock y Manifest.lock
  idénticos byte a byte a referencia. Ninguna sección, versión, grafo ni checksum
  cambió. Checksums actuales coinciden con los JSON realmente usados. No forzar
  recálculo: CocoaPods conservó especificaciones instaladas; la comparación E1.2
  de evaluación directa no implicaba un cambio obligatorio del lock en este caso.
- Workspace válido: DropLibrary15/DropPlayback15/OnDeviceYouTube11Swift; todos los
  archivos actuales de A–D registrados en sus targets y configuración Release.
- Incidencia conservada: clang no pudo crear temporal .stub-binary de ExpoModulesJSI
  por límite de escritura. No se ignoró por exit0: seis slices ya presentes,
  iPhoneOSarm64 real con UUID9E0AE7EE-4753-377E-BC98-B5AFDF349709 idéntico al
  build18 validado, copy/embed generado. Sin reparación ni modificación binaria.
- Inventario de435 archivos regenerados/tocados en raíces nativas conocidas,
  con hashes; no afirmar diferencias byte a byte sin snapshot anterior completo.
  Preparación PASS para iPhoneOS ARM64; no demuestra bootstrap limpio offline.
- Evidencia actual en continuidad. Cinco pendientes conservados, D HEAD56ea42a...
  intacto; sin commits/push/main/apps. GO técnico para preflight de compilación19
  con autorización independiente; NO Xcode/build/instalación/E2 ejecutados.

## Drop 1.8.1 · E1.3 /dev/null: único intento adicional fallido

- Autorización «sí» aplicada a un solo pod install offline. Exit1/2.01s antes de
  resolución; /dev/null corregido. ExpoSQLite.podspec34 intenta copiar vendor/sqlite3
  a node_modules/expo-sqlite/ios/sqlite3.c y sqlite3.h, fuera de ios autorizado.
  Política lo impidió. El preflight previo no había identificado esa escritura.
- Ambos destinos ya existen y coinciden byte a byte con vendor; hashes archivados.
  Inspección focal de podspecs detectó esa copia explícita; no garantiza todas las
  escrituras dinámicas posibles. Propuesta: autorizar exclusivamente esos dos
  destinos generados, con verificación de hashes posterior, sin permitir escribir
  scripts/node_modules en general. No se aplicó ni se reintentó.
- Locks, Manifest, dos podspecs, metadatos y archivos previos respaldados intactos.
  No checksums nuevos, dependencias, descargas ni módulos nuevos registrados.
  Cinco pendientes conservados; docs/continuidad registran resultado. No Xcode,
  commits, main, dispositivos ni limpieza. BLOCKED/NO-GO build19.

## Drop 1.8.1 · E1.3: intento único fallido antes de resolución

- Autorización corregida recibida para source/script_phases locales y dos checksums.
  Verificados los cuatro archives contra hashes E1.2; backup lockfile/Manifest y
  podspecs en evidencia independiente. Se ejecutó exactamente un pod install
  --no-repo-update con red denegada, rutas Release locales y escritura confinada a ios.
- Exit1 en2.01s, antes de analizar Pods: perfil propio negaba acceso read/write a
  /dev/null usado por git --version. Error de configuración de aislamiento, no de
  Git, CocoaPods, artefactos o grafo. No culpar al lock ni al entorno Ruby por esto.
- Comparación posterior: los doce archivos respaldados intactos (locks, Manifest,
  dos podspecs, Podfile/Gemfile, metadatos y dos documentos previos). Ningún checksum
  nuevo, descarga o cambio de grafo. Nuevos módulos todavía no registrados en Pods.
- Corrección propuesta del perfil: permitir solo /dev/null además de ios, mantener
  deny network*. Probados git/node/ruby --version con exit0. NO segundo pod install.
  Próximo intento requiere autorización expresa; no ampliar permisos silenciosamente.
- Cinco pendientes conservados; docs/continuidad actualizados con este resultado.
  Sin commits/main/checkpoint/apps/Xcode. Evidencia E1.3-offline en continuidad.
  BLOCKED/NO-GO build19; no E2. Conservar logs y archivos temporales de la operación.

## Drop 1.8.1 · E1.2: prebuilt offline probado; lock exacto bloquea instalación

- ReactNative0.86.3 instalado. Cuatro archives Core/Deps Debug/Release presentes,
  SHA256 y CRCgzip comprobados. Release: slices iPhoneOS ARM64, binarios idénticos
  a Pods de build18. Versionado acreditado por paquete/podspec/lock/procedencia;
  Info.plist del framework dice1.0, no usarlo como prueba de versión0.86.3.
  Hermes250829098.0.17 y slice iPhoneOS ARM64 presentes. Sin extracción/descargas.
- Evaluación real de podspecs, sin pod install y con red denegada: flags
  RCT_USE_RN_DEP=0/RCT_USE_PREBUILT_RNCORE=0 evitan HEAD; rutas locales verificadas
  RCT_USE_LOCAL_RN_DEP y RCT_TESTONLY_RNCORE_TARBALL_PATH fuerzan prebuilt.
  Ambos Building from source:false. No overrides de versión ni respuestas falsas.
- Variables locales cambian source HTTPS→file y eliminan script_phases selector
  Debug/Release en ambos podspecs; sus dependencias/versiones no cambian. Generan
  nuevos checksums frente a los dos SPEC CHECKSUMS fijados. El instalador1.16.2
  verify_no_lockfile_changes! rechaza diferencias con --deployment.
- BLOCKED antes de pod install: restricción de lock inmutable incompatible con
  mecanismos locales directos comprobados. Cero intentos consumidos en E1.2.
  No modificar node_modules, caches o locks. No parchear selectores ni simular Maven.
- Alternativa mínima propuesta: autorizar metadatos de origen/selector/checksum de
  esos dos podspecs para Release local, con versiones/grafo idénticos y diff acotado
  verificado antes de aplicar; requiere ajuste autorizado del lock, no realizado.
- Cinco pendientes conservados; docs/continuidad reciben este registro, tres
  metadatos sin cambios. Main/checkpoint/apps intactos. Sin Xcode/instalación/commit.
  Evidencia E1.2-prebuilt actual en continuidad. NO-GO E1 hasta resolver restricción.

## Drop 1.8.1 · E1.1 detenido en preflight; segundo intento no ejecutado

- Autorización expresa de segundo pod install offline recibida. Rama/HEAD y cinco
  pendientes conservados. Índice global all_pods_versions_a_9_3.txt íntegro como
  archivo regular2359 bytes; SHA256 b6b3057b5644d268c88362ae55e93401652e649a235346a3957d7460c55d89d0.
  Entradas corresponden al shardMD5 a93; contiene SocketRocket, ausente del lock.
- Causa ampliada demostrada en scripts RN locales: artifact_exists ejecuta curl
  HEAD a Maven. Sin red, artifacts_exists=false y setup cambia de prebuilt a
  fuentes, incorporando SocketRocket. El lock conserva React-Core-prebuilt y
  ReactNativeDependencies; obtener el índice no acredita ese grafo congelado.
- No se ejecutó el segundo intento: preflight no puede confirmar correspondencia
  con dependencias fijadas. No copias/cambios de cachés, lockfiles ni fuentes.
  No desbloquear red ni simular comprobaciones HTTP. No nuevo rechazo automático.
- Existen archives locales ReactNativeDependencies0.86.3 debug/release; posible
  ajuste offline con binarios cacheados requiere contrato/autorización adicional,
  verificación de los archives de ambos componentes y resolver sin cambiar grafo.
  No aplicado. E1/E2 siguen BLOCKED; no Xcode/instalación/commit.

## Drop 1.8.1 · D cerrado; E1 bloqueado antes de Xcode

- D cerrado localmente en56ea42a4dab77f3e3251915c23d9c3b0da05b5d4, padre C/C.1.
  Diez rutas exclusivamente;172 Jest y12checks Swift/modo reutilizados por hashes
  coincidentes. Sin push/merge/tags; main/checkpoint/apps intactos.
- Metadatos preparados sin commit:1.8.1/build19, identidad por entorno reprotest.
  Dependencias JSON y gemas sin cambios. Node22.19, Ruby4.0.7/Bundler2.4.22,
  CocoaPods1.16.2 y cinco archives fijados SHA PASS; Python ARM64 y QuickJS presentes.
  Perfil de reprotest verificado, con vencimiento registrado el
  11/11/2026 07:40:54 CDMX, TeamHK927RUDLZ/certificado coincidente.
- Faltan cinco fuentes nuevas de A–D en el proyecto generado Pods. Una preparación
  necesaria pod install --deployment --no-repo-update, red bloqueada, falló64.27s
  antes de generar proyecto: índice CDN all_pods_versions_a_9_3.txt ausente en
  caché privada. No descarga ni cambios de dependencias. Locks y Pods.xcodeproj
  conservan hashes; codegen ignorado regenerado por la preparación fallida.
- Alternativa acreditada: índice ya presente en caché global, reutilizable mediante
  CP_REPOS_DIR oficial. Segundo intento aislado/con caché global solo lectura
  RECHAZADO por revisión automática de aprobación; no llegó a ejecutarse. Exige
  autorización específica para repetir pod install; no encadenar alternativas.
- Xcode/build NO ejecutados, no artefacto19 ni SHA. Info.plist nativo temporal
  restaurado byte a byte; conservar metadatos versionados preparados. Sin renovar
  firma, pruebas host repetidas, acceso a contenedores, builds o instalaciones.
- Evidencia: DropValidationEvidence/v1.8.1-E1-build19-m17y1rj7/RESULT.json.
  BLOCKED E1/NO-GO E2 hasta sincronizar fuentes y verificar candidata firmada.

### E2 previsto, sin ejecutar

Cerrar solo reprotest con autorización E2; identificar versión e inventario real,
SQLite/WAL coherentes, IDs/medios/portadas/relaciones/Cola/progreso/preferencias.
Comparar respaldo previo, proteger diferencias incrementalmente, hashes/integridad
/FK y manifiesto recuperable. Ensayar recuperación en destino host independiente,
con inventario y hashes coincidentes, sin restaurar sobre el iPhone. Revalidar
artefacto19/perfil/firma/dispositivo y ejecutar una sola actualización in-place
únicamente tras autorización. Luego comparar inventario y migración v4→v5.
Build18 no revierte esquema5; conservar backup pre-v5 para recuperación autorizada.
Cinco pruebas físicas focales: importar con etiquetas/portada; completar existente;
persistencia al reabrir; datos anteriores; Cola con v5. No repetir toda1.8.0.
Crash de imágenes sin journal sigue pendiente: pueden quedar restos propios sin
asociar; no ampliar E1 ni limpiar Artwork. E2 NO iniciado.

## Drop 1.8.1 · D revisado para cierre local

- HEAD C/C.1 a1f86134f2e734bac85a1a7d4b35499e510d8fbb; rama local de metadatos.
  Acción explícita «Completar metadatos» para ready/local/archivo compatible y
  disponible, en lista y menú de cuadrícula. Sin selector/reimportación/escaneo.
- Inspección nativa de ImportedMedia validada por ID/ruta/tamaño/duración; reutiliza
  extractor A y presupuesto C10s con un worker propio. JPEG solo memoria nativa
  hasta aplicar. Cancelar/descarte invalidan también solicitudes aún no registradas.
- Lease durante análisis/propuesta; título conservado por defecto. Alert ofrece
  cancelar toda la operación, conservar título o usar el encontrado, callback único.
  Campos válidos/portada válida no se reemplazan; SQL selectivo y único para datos
  e imagen, con identidad/lifecycle/título/ruta/tamaño/referencia anterior guardados.
  Borrado concurrente no recrea registros. Compensación por propiedad de C.
- Cancelación aceptada solo antes de aplicar; invalida respuestas/confirmaciones
  tardías. Al entrar en aplicación no se ofrece cancelar ni se promete rollback
  de una escritura iniciada. No bloquear reproducción; desmontaje cancela si procede.
- RED inicial11 fallos/20PASS; nueva carrera de descarte reproducida1FAIL antes de
  corregir. GREEN172 Jest en seis suites;12 checks nativos por Swift5/6, con MP3,
  M4A con portada y MP4 administrados, hashes intactos. SQLite real/reapertura,
  integridad/FK, Cola/ocurrencias, Colecciones, progreso y completedAt preservados.
- Typecheck completo/bridge ARM64 iOS16.4 Swift5/6 PASS. TS/lint/formato/diff PASS;
  nueve warnings previos en tests y warning previo ArtworkTransfer Swift6 conservados.
  Pruebas de timeout/duplicados/framework del coordinador C reutilizadas por hash;
  no sumarlas a los12 casos nuevos. Ningún caso GREEN omitido o terminado por timeout.
- Evidencia D-existing-7en4kyhr bajo DropValidationEvidence. Reanudación conservó
  los ocho archivos pendientes; corrigió tipos/formato de test y cerró cancelación.
  Sin apps/datos reales, metadatos de versión, migraciones de iPhone, main/push/build.
- Crash: misma limitación de C para temporal/JPEG sin asociación; sin journal nuevo
  ni barrido destructivo. Archivo de portada corrupto preexistente se conserva;
  no se reemplaza automáticamente. Preparación nativa y prueba física siguen en E.
- Revisión de cierre D aprobada por correspondencia exacta de hashes y diff.
  Único commit local D autorizado; E1 tiene autorización independiente vigente.

## Drop 1.8.1 · C/C.1 verificado para cierre local

- Corrección acotada: título promovido y campos descriptivos usan Array.from,
  límite240 por puntos de código, no unidades UTF16 ni grafemas completos.
  Normalización, ausencias y fallback «Archivo de Drop» conservados.
- TDD Unicode RED3 fallos/17 PASS; GREEN20/20 en suite de integración enriquecida.
  Regresión completa afectada145 PASS en seis suites. Nueve casos nuevos incluyen
  borde emoji, fuera del límite, mezcla/CJK/combinantes, longitudes y fallback;
  roundtrip SQLite real sin U+FFFD introducido ni surrogates aislados.
- TypeScript/lint/formato/diff PASS. Siete fuentes/harnesses Swift C idénticos
  a evidencia previa: reutilizadas49 comprobaciones por Swift5/6, typecheck ARM64
  iOS16.4/bridge y operación previa; no compilaciones nativas repetidas.
- Diff completo C/C.1 revisado,13 rutas pertinentes, sin dependencias/metadatos,
  secretos ni recursos privados nuevos. Autorizado un único commit local C/C.1.
  Main/checkpoint1.8.0/apps intactos; no push, merge, tags ni D/E.
- Limitaciones de crash de portadas y memoria interna AVFoundation conservadas;
  preparación nativa y validación física siguen pendientes. GO para solicitar D,
  no iniciarlo. Evidencia C.1 indicada en continuidad; registros C originales intactos.

## Drop 1.8.1 · revisión C detenida (histórico; resuelto por C.1)

- Autorización de cierre C/inicio D recibida. Rama/HEAD y los13 hashes pendientes
  coinciden exactamente con RESULT de C antes de la revisión. Sin cambios ajenos.
- Bloqueo reproducido de C: optionalText usa slice(0,240) sobre unidades UTF16.
  Entrada239 letras+emoji(240 puntos Unicode) queda con surrogate aislado;
  SQLite real en memoria lo guarda como U+FFFD. No hay pérdida de datos de iPhone.
- No cubierto por los136 PASS/49 checks anteriores; no se invalidan sus resultados,
  pero C no se cierra ni commitea. Mismo patrón de título requiere caso focal.
- Propuesta: truncado Unicode con Array.from, ya usado por el repositorio B,
  y pruebas de borde/persistencia. No aplicado; informar antes de modificar código.
- Evidencia C-enriched-0q5i_x4i/REVIEW-UNICODE.json. Sin staging, commit C o D,
  nuevas pruebas de suite, builds, apps, main, push o limpieza. NO-GO hasta corregir.

## Drop 1.8.1 · C integrado y verificado en host, sin commit

- Estado vigente: B/B.1 cerrado en bf72e954cbad4682cba2dfc66bb66ff9e618870a;
  rama codex/v1.8.1-local-metadata. C pendiente de revisión/commit, D/E no iniciados.
  Las anotaciones de bloqueo C siguientes son históricas: contrato10s/compensación
  aprobado posteriormente por el usuario e incorporado al SDD antes de implementar.
- Nuevas importaciones: copia validada → extracción opcional nativa → metadatos
  v5/título → confirmación del medio → JPEG/SQL bajo lease. Sin base64/red ni
  modificación del medio. Reintentos conservan filas previas y borrado no recrea IDs.
- Espera propia10s/cancelación finaliza exactamente una vez; ignora resultados
  tardíos. Un worker aún activo conserva su plaza; nuevas importaciones usan fallback
  hasta liberarla. No afirmar liberación inmediata de memoria del framework.
- Imagen por token/hash/ruta propia, publicación sin sobrescritura y compensación
  solo si no está referenciada. Portadas previas/ajenas y SQL ambiguo se conservan.
  Crash: puede quedar temporal/JPEG sin asociación; recuperación de imágenes no
  implementada. No limpieza general ni promesa de recuperación inmediata.
- RED de coordinación/publicación e integración; GREEN136 Jest en seis suites,
  SQLite real/reapertura/integridad/FK, Colecciones/Cola/progreso. 49 comprobaciones
  nativas por Swift5/6 y harness existente de operación PASS; A1(36) reutilizado
  por hashes idénticos. Typecheck ARM64 iOS16.4 incluye bridge real: PASS5/6.
- TypeScript/lint/formato/diff PASS. Advertencia Swift6 previa en ArtworkTransfer
  mutable conservada; sin cambios del descargador de YouTube. No pruebas omitidas
  ni timeouts en GREEN. Preparación Pods/build/validación física siguen pendientes.
- Evidencia: DropValidationEvidence/v1.8.1-C-enriched-0q5i_x4i/RESULT.json.
  Sin versión/build nuevos(1.8.0/18), commit C, main/tags/push, apps o bases reales.
- GO técnico para revisión y cierre de C; no iniciar D sin autorización.
- Eficiencia: rutas raíz/mobile de dos ensayos iniciales fueron incorrectas; no
  ejecutaron el check previsto. Resultados acreditados usan cwd/config absoluta.
  Harness SQLite corregido para consultar conexión abierta tras la migración.

## Drop 1.8.1 · contrato y base protegida

- Checkpoint 1.8.0 `8e6ade1ba6e60a036623b20af02aa76d25435864` publicado y
  verificado en origin/codex/v1.8.0-local-import. No release, tag ni merge.
- Rama local codex/v1.8.1-local-metadata desde ese checkpoint, reutilizando el
  worktree sin duplicar dependencias. Especificación en
  [metadatos y portadas](local-media-metadata-v1.8.1.md), preparada sin commit.
- Contrato A–E preparado. A autorizado y ejecutado parcialmente; su bloqueo de
  cancelación y su resolución A.1 se registran abajo. SQLite y versión/build
  siguen v4 y 1.8.0/18.
  Actualización explícita por elemento, conservación por defecto y portadas válidas
  sin reemplazo en el MVP. No cambios en apps/datos.

## Drop 1.8.1 · Bloque A parcial, bloqueado por cancelación en curso

- Extractor interno Swift aislado y harness propios añadidos, sin bridge/DB/UI,
  integración de importación ni portadas persistentes. Metadatos ID3/iTunes y
  miniatura local; fallback parcial y guardas de rutas. Trabajo NO listo para integrar.
- RED: 11 fallos de comportamiento esperados y 7 PASS contra contrato vacío.
  Primera implementación GREEN: 18 PASS/0 FAIL. Tipado ARM64 iOS 16.4 aprobado
  con Swift 5 y 6; harness host Swift 6 compila sin diagnósticos.
- Ampliación: 19 comprobaciones pasan antes de una espera sin resolución al
  cancelar extracción de miniatura iniciada. Reproducido en diagnóstico focal
  con timeout de 20 s; detenido solo el harness propio. No hay PASS global de
  la suite ampliada ni cierre del Bloque A. La cancelación previa al inicio pasa.
- Propuesta pendiente de aprobación: adaptador de callbacks de generación con
  token y finalización exactamente una vez; pruebas deterministas de cancelar
  antes/después del registro, durante generación y al coincidir con completion.
  No asumir que cancelar garantiza liberación inmediata del decoder ni del archivo.
- Sin commits, builds de app, instalaciones, datos de iPhone ni cambios de main.
  Evidencia: `DropValidationEvidence/v1.8.1-A-metadata-tp0e2mg2/`.
  NO-GO para B hasta resolver la cancelación y cerrar A. Conservar SDD pendiente.

## Drop 1.8.1 · A.1: cancelación segura, validación host completada

- Sustituida la espera de miniatura por callback de AVFoundation y solicitud
  propia de finalización única. image(at:) es disponible desde iOS16.0; el fallo
  previo no era de disponibilidad. La causa de nuestro bloqueo era depender de
  la finalización del framework incluso después de cancelar; su causa interna
  específica no se demuestra ni se atribuye a todas las versiones/dispositivos.
- DropThumbnailRequest protege resultado/observador con NSLock y los consume una
  sola vez. Resume fuera del lock. Conserva cancelación antes del registro y
  descarta callbacks duplicados/tardíos. Driver confinado a cola serial: registra
  o cancela en orden, admite cancel-before-start y retira referencia al generador.
  La espera propia termina sin callback; no se promete memoria liberada al instante.
- RED determinista en la frontera de cancelación: 9 fallos/2 PASS con la antigua
  semántica de cancelar el framework sin completar la solicitud. GREEN completo:
  36 casos únicos PASS tanto en Swift5 como Swift6, incluidos MP4 real, carreras
  controladas, 128 carreras concurrentes éxito y 128 error, reentrada, callback
  ausente/duplicado/tardío, extracción posterior y medios sin modificaciones.
  Sin omitidos, bloqueos ni timeouts. Typecheck ARM64 iOS16.4 PASS Swift5/6.
- Prueba offline acotada: fixtures locales y URL de red rechazada antes de
  AVFoundation; sin tráfico instrumentado ni prueba nueva en iPhone. No llamar
  a esto una captura de red o validación física. Sin nuevos paquetes.
- Evidencia: `DropValidationEvidence/v1.8.1-A1-cancellation-uuq2cixt/`.
  Las notas A bloqueado anteriores son históricas y no se borran.
- GO técnico para revisar/cerrar A y solicitar B; no commit ni B ejecutados.
  Sin SQLite/modelos/bridge/importación/UI/reproducción/apps modificados. Main y
  checkpoint1.8.0 conservados. Antes de integrar C/E comprobar registro nativo de
  nuevos Swift y vida del archivo frente a tareas canceladas aún limpiando recursos.

## Drop 1.8.1 · cierre local A/A.1 y apertura de B

A/A.1 revisados y cerrados con sus 36 casos únicos PASS en Swift5 y Swift6,
typecheck iOS16.4 y fuentes sin cambios desde la evidencia A1. Sin pruebas
físicas nuevas ni integración. Commit local acotado de extractor/tests/SDD/estado,
sin publicar. B autorizado exclusivamente para modelo/repositorio y SQLitev5;
no C–E, apps, migración de datos reales ni nueva candidata.

## Drop 1.8.1 · B: SQLite v5 implementado; cierre bloqueado por lector nativo

- A/A.1 cerrado en commit local ece7724452d20027346d742a8b175a3942cca828,
  con sus seis archivos pertinentes; sin publicar. Sus fuentes no cambiaron en B.
- B agrega artist/album/genre TEXT NULL y year INTEGER NULL al final de
  library_items. Base nueva v5 directa; v4→v5 cuatro ALTER TABLE ADD COLUMN,
  sin reconstrucción. v1–v3 conservan paso necesario a origen local de v4 y
  reciben las columnas. BEGIN IMMEDIATE, rollback, FK y versión al confirmar.
- Modelo opcional/anulable y updateLocalDescriptiveMetadata por ID: completa
  ausencias en ready/local con un UPDATE atómico; conserva valores válidos,
  ignora NULL/undefined/vacíos y rechaza tipos/años inválidos antes de escribir.
  No modifica título/portada/medio/relaciones/progreso ni recrea filas borradas.
  No integrado al extractor, promoción, UI o reproducción.
- RED 19 fallos esperados/1 PASS; GREEN SQLite/TS 108 PASS en cuatro suites,
  incluidos 20 casos nuevos. SQLite real valida v0/v1/v2/v3/v4→v5, NULL,
  persistencia, Unicode, actualización parcial, rollback tras tercer ALTER,
  muerte de un proceso fixture en transacción y reapertura. integrity_check=ok,
  FK=0 y filas/IDs/Colecciones/ocurrencias/orden/progreso antiguos preservados.
  Preferencias y medios reales fuera del alcance: sin código que los modifique.
- TypeScript/formato/diff PASS; lint focal sin errores, nueve advertencias
  preexistentes de require en pruebas. Avisos SQLite experimental y errores
  transitorios inyectados conservados en logs. No suites Swift de A repetidas.
- BLOCKED material: PlaybackManualQueueRepository.openValidated exige version==3.
  Es consumido por DropPlaybackService; rechaza también v4 de la base anterior.
  Diagnóstico host con el repositorio de producción rechaza v5 con
  incompatibleSchema. No se infiere un fallo físico observado ni pérdida de datos.
- Ese cambio no es un ajuste de tipos y excede el permiso de B para Cola.
  Propuesta pendiente: admitir explícitamente esquemas 3/4/5 verificados,
  conservar validación estricta de tabla/índices/FK y rechazar futuros >=6;
  tests host de lectura/consumo sin cambiar semántica. No aplicado.
- NO-GO para C/cierre de B hasta resolver compatibilidad. Sin commit de B, app
  build, migraciones iPhone, instalaciones, firma, main, tags, push o limpieza.
  Evidencia: `DropValidationEvidence/v1.8.1-B-sqlite5-ajbkgnl4/`.
- Incidente de eficiencia: dos invocaciones iniciales usaron rutas relativas con
  cwd incorrecto y no ejecutaron la prueba prevista; se corrigieron antes del
  resultado acreditado. Usar raíz para ediciones y mobile para comandos Node.

## Drop 1.8.1 · B.1: compatibilidad nativa v3/v4/v5 verificada

- Único cambio funcional: PlaybackManualQueueRepository admite explícitamente
  [3,4,5] en lugar de version==3. Continúan validación estricta de columnas,
  índices, CHECK, FK, lifecycle, IDs, transacciones y errores; futuro v6 rechazado.
  El lector no crea/migra tablas ni cambia user_version. Sin cambios del servicio
  de reproducción, leases, extractor, UI o importación.
- Diagnóstico: usa playback_queue(id,itemId,position,addedAt), su FK CASCADE y
  índices, más library_items(id,lifecycle). El contrato no varía entre v3/v4/v5;
  v4 amplía origen y v5 añade campos descriptivos fuera de esas consultas.
  No hay otras guardas nativas user_version restrictivas en DropLibrary/Playback.
- RED real con lector anterior: v3 PASS, v4/v5 incompatibleSchema. Fixtures
  completos derivados del SQL de producción, con filas sintéticas y metadatos.
  GREEN nativo Swift5/6: tres escenarios completos de versión y cinco grupos
  existentes (esquema/lectura-consumo/rollback/concurrencia/corrupción). Verificados
  vacío, ocurrencias, orden, consumo/compacción, ready/deleting, doble consumo,
  bloqueo, estructuras incompatibles, orfandad y v6; sin pérdida o reparación
  destructiva. Preservados esquema, versión, library_items, Colecciones/relaciones;
  integrity_check=ok y FK=0 en v3/v4/v5.
- Regresión B: 108 PASS en cuatro suites, incluidos leases de Biblioteca.
  TypeScript y diff PASS. Typecheck iOS16.4 ARM64 Swift5/6 PASS como biblioteca,
  tal como el Pod. Un chequeo inicial Swift6 sin parse-as-library aisló el global
  SQLITE_TRANSIENT como main-actor; corregido el modo, sin cambiar ese código.
- Defecto ya presente en checkpoint1.8.0 build18: la guardia rechazaba v4.
  Considerar corrección independiente de 1.8.0 con alcance propio; no se hizo
  backport ni se infiere un fallo físico observado. La corrección no llega a las
  apps instaladas hasta autorizar una futura candidata e instalación.
- B/B.1 listos para revisión/cierre; NO commit ni C iniciados. Pendientes de B
  preservados por hashes. Main, tags, checkpoint1.8.0 y apps intactos.
  Evidencia: `DropValidationEvidence/v1.8.1-B1-native-queue-9ps51nwt/`.

## Drop 1.8.1 · B/B.1 cerrado para commit local

Revisión final: esquema v5 y UPDATE conservador coinciden por hashes con B;
lector nativo explícito v3/v4/v5 y pruebas coinciden con B.1. Los 108 PASS de
regresión y los escenarios Swift5/6 corresponden a estas fuentes sin cambios.
Migración transaccional, cuatro columnas anulables y rechazo v6 conservados.
Commit local exclusivo de los diez archivos de B/documentación, sin publicación.
La guardia incompatible con v4 existe en el checkpoint1.8.0: debe corregirse
antes de cualquier publicación de esa versión. No se hizo backport ahora.

## Drop 1.8.1 · C: preflight detenido antes de implementación

- B cerrado en commit local bf72e954cbad4682cba2dfc66bb66ff9e618870a,
  diez archivos revisados; sin push. Los 108 PASS y escenarios nativos se
  reutilizan tras verificar hashes, no se repiten por un cierre documental.
- C no implementado ni probado. Se detectan dos diferencias de contrato:
  el SDD admite portada no asociada recuperable tras fallo SQL, mientras C pide
  ausencia de huérfanos en errores controlados; y A.1 resuelve la cancelación de
  miniaturas, no demuestra terminación acotada de todas las lecturas de etiquetas.
  No conectar directamente la espera al guardado y declarar esa garantía.
- Propuesta pendiente: presupuesto opcional de 10 s, finalizar operación propia
  con fallback/cancelación y descartar respuestas tardías; JPEG limitado solo
  nativo, publicación por identidad de operación y compensación de archivo propio
  si SQL falla. Distinguir error controlado de cierre abrupto y recuperación;
  no prometer liberación inmediata del framework ni borrar medios válidos.
- SDD recibe propuesta marcada sin aprobar; no modifica los contratos ejecutados.
  Evidencia: `DropValidationEvidence/v1.8.1-C-preflight-m0skm7ii/RESULT.json`.
  NO-GO para D; esperar decisión sobre ajustes de C. No código C, datos, builds,
  instalaciones, cambios de main/tags ni backport de1.8.0.

## Checkpoint vigente · Drop 1.8.0 build 18 en reprotest

Confirmación del usuario, 8/11/2026: comprobaciones manuales principales PASS
para importación MP3, M4A y MP4; reproducción y controles de audio; reproducción
MP4; persistencia de los tres archivos; reproducción offline; búsqueda y orden;
lista/cuadrícula; creación y persistencia de Colecciones; cancelación del selector;
y conservación de datos/migración SQLite v3→v4. Son observaciones del usuario,
no logs instrumentados ni una repetición de la matriz completa.

La comprobación técnica previa a esas importaciones acreditó seis elementos,
seis medios/seis portadas, SQLite v4 íntegra/FK=0 y respaldo v3 recuperable de
20 archivos. Ese inventario es histórico: no se inspeccionó de nuevo el iPhone
tras las importaciones y la creación de Colecciones confirmadas por el usuario.

No constan aquí PASS físicos de proveedor iCloud/externo, archivo incompatible,
cancelación durante copia, recuperación de fallos, doble activación, borrado de
importado, accesibilidad completa ni cierre técnico del inventario posterior.
No se solicitan ni repiten pruebas ahora. Checkpoint de código, no release pública,
ni instalación/validación 1.8.0 en la original. Main y tags se conservan.

Las notas E0/E1/E2 siguientes son una cronología; sus bloqueos y pendientes
anteriores no invalidan los resultados actuales. El checkpoint consolida solo
los siete archivos revisados; fuentes y herramientas coinciden con build 18.

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

## Drop 1.8.0 · Bloque A de importación local

- Rama `codex/v1.8.0-local-import` desde `v1.7.1`
  (`0b1a0bc82d57c7f0ee616124a788816f7e5c6c57`). Contratos en la
  [especificación](local-import-v1.8.0.md), el [plan](local-import-plan-v1.8.0.md)
  y la [matriz de tareas y pruebas](local-import-tasks-v1.8.0.md).
- SQLite v4 admite `sourceKind = 'local'`. La reconstrucción conserva
  identificadores, metadatos, progreso, estados, Colecciones y ocurrencias
  ordenadas de Cola. SQLite verifica las claves foráneas antes de confirmar
  y al abrir la base migrada. Un fallo revierte la actualización.
- RED con 13 fallos esperados. GREEN con 105 pruebas en cinco suites
  afectadas. TypeScript, ESLint focal y formato aprobados. Evidencia en
  `DropValidationEvidence/v1.8.0-sqlite-v4-2026-11-06-5sI3GX`.

## Drop 1.8.0 · Bloque B de importación local

- El origen elige el destino nativo. Descargas siguen en `Media/`. Los
  importados usan `Application Support/Drop/ImportedMedia/<uuid>.<ext>`.
  El mismo resolver atiende Biblioteca, reproducción, exportación y borrado.
- El almacenamiento valida MP4, M4A y MP3 en un temporal propio, sin
  modificar el original. Registra `pending` antes del renombrado exclusivo.
  Los errores transitorios conservan la operación para reconciliarla. Se
  conservan los archivos finales importados sin fila.
- `Media/` y `Artwork/` mantienen su exclusión de respaldo. Se verifica
  la elegibilidad local del medio importado tras el movimiento. La
  realización de un respaldo por iOS queda sin verificar.
- RED con cuatro fallos de Jest y el contrato Swift de rutas. GREEN con
  53 pruebas de Jest y tres suites Swift de host, incluidas las de medios
  sintéticos. Tipado iOS ARM64 de DropLibrary, TypeScript, ESLint focal
  sin errores, formato y diff verificados. Evidencia en
  `DropValidationEvidence/v1.8.0-import-storage-2026-11-06-GkOfZ8`.
- Pendientes sujetos a autorización. Selector de Archivos e integración
  con proveedores, interfaz y validación integrada en iOS.

## Drop 1.8.0 · Bloque C de integración local

- `importPreparedLocalFile` recibe una preparación controlada, sanea el título
  y reutiliza la promoción de B. Identidad nativa estable, una operación activa,
  dobles callbacks coordinados y reintentos recuperables en la misma sesión.
  La duración validada en Swift se confirma en SQLite y el staging aceptado
  se protege durante startup. Las respuestas tardías no recrean una fila borrada.
- La integración demostró que MP3 estaba excluido por la política de UI y
  servicio nativo. Ambos admiten ahora MPEG Layer III. M4A mantiene AAC y
  su preparación rechaza otros codecs, incluido ALAC, para coincidir con el motor.
- RED con 15 fallos Jest esperados, política/servicio Swift y contratos nuevos
  del bridge. Se reprodujo además la aceptación previa de M4A con codec no
  admitido por el motor. GREEN con 73 pruebas Jest en cuatro suites y tres
  suites Swift afectadas, usando medios sintéticos y SQLite real.
  TypeScript y tipado iOS ARM64 de almacenamiento/política aprobados.
  ESLint focal sin errores, formato de fuentes y diff verificados.
  El chequeo adicional del bridge con artefactos del worktree de diagnóstico
  fue rechazado por revisión automática. No se accedió a esos recursos y
  el bridge completo queda pendiente de integración autorizada.
  Evidencia en `DropValidationEvidence/v1.8.0-import-integration-2026-11-06-ewnufvzr`.
- Originales y relaciones de los fixtures se conservan. Los errores temporales,
  colisiones y huérfanos importados mantienen las protecciones de B.
  La reproducción de host ejercitó apertura y preparación del sucesor en el
  motor existente. La integración y ejecución en iPhone siguen pendientes.
- Correspondencia actualizada. D incorpora selector y UI. E verifica integración
  y candidata reprotest con autorización independiente. D se cierra abajo.

## Drop 1.8.0 · Bloque D de selector e interfaz

- Biblioteca incorpora **Importar archivo** en Archivos, debajo de las pestañas
  y junto al uso de espacio. El estado de la operación se comparte entre
  montajes. Se conservan filtros, búsqueda, orden, vista y reproducción actual.
- Selector `UIDocumentPickerViewController`, `asCopy: false`, una selección,
  delegado retenido y callbacks duplicados ignorados. La tarea de preparación
  equilibra el acceso al original y reutiliza lectura coordinada y almacenamiento.
  La cancelación espera al lector y descarta una preparación tardía propia.
- Progreso basado en bytes medidos, validación y guardado diferenciados.
  Los errores se presentan sin rutas personales y el reintento de guardado
  conserva la preparación y su identidad. Foco y anuncios accesibles comprobados
  con mocks, sin anunciar cada porcentaje. El éxito informa de filtros activos.
- RED con cuatro fallos de UI contra la pantalla de C y contrato nativo ausente.
  GREEN con 80 pruebas Jest en tres suites afectadas y dos suites Swift de host.
  TypeScript, ESLint focal sin errores (nueve advertencias preexistentes), formato
  de fuentes, enlaces y diff aprobados. Selector, operación y almacenamiento
  tipados para iOS ARM64 con SDK propio en Swift 5 y 6.
  Host Swift requiere SDK y destino macOS explícitos: el destino implícito
  del sistema (28.0) no tiene biblioteca estándar en el SDK instalado.
  Evidencia en `DropValidationEvidence/v1.8.0-native-import-ui-2026-11-07-yor_fch2`.
- La presentación real, scopes de iCloud/proveedores, foco/VoiceOver, Dynamic Type
  y cancelación durante esperas del proveedor quedan pendientes de iPhone.
  El bridge Expo completo queda para la integración E. No se reutilizaron
  recursos del worktree de diagnóstico ni se generó candidata integrada.
- E requiere autorización independiente. Ambas aplicaciones, datos y respaldos
  permanecen fuera de esta intervención. No se modificaron versión ni build.

## Drop 1.8.0 · E1: preflight de candidata bloqueado

- Rama y HEAD de D verificados, árbol limpio al iniciar. Main y v1.7.1
  conservados. La evidencia de D coincide por hashes; no se repitieron tests.
- Espacio inicial 26.51 GiB. Xcode 26.6, SDK iOS 26.5, ninguna compilación
  concurrente. iPhone disponible y autorizado por el perfil de reprotest.
  Perfil existente de reprotest, Team HK927RUDLZ,
  vigente hasta 11/11/2026 07:40:54 CDMX; su certificado coincide con una
  identidad válida. Sin renovación ni modificaciones de firma.
- **BLOCKED antes de Xcode:** faltan `mobile/ios`, workspace, Pods y DerivedData
  en el worktree actual. También faltan el framework Python y QuickJS nativos
  declarados por el podspec. Node/Expo y Metro locales sí están disponibles.
- El entorno localizado de 1.5.0 queda fuera del checkout y enlaza módulos por
  rutas relativas de ese árbol; su proyecto Pods no incluye los archivos nuevos
  de D. No se utilizó ni modificó, ni se accedió al worktree de diagnóstico.
- Preparar primero un entorno nativo propio y verificable, justificando cualquier
  generación o restauración imprescindible. No arrancar una build con fuentes de
  otro árbol ni reinstalar dependencias por rutina. Cero intentos de compilación;
  versión/build siguen 1.7.1/16. No hay artefacto 1.8.0/build 18 ni instalación.
- E2 queda definido en [la matriz](local-import-tasks-v1.8.0.md), sin ejecutar.
  Migrar v3 → v4 requiere respaldo recuperable coherente previo; reinstalar build
  17 no revierte el esquema. Inventario real pendiente, sin acceso a contenedores.
  Evidencia: `DropValidationEvidence/v1.8.0-E1-preflight-2026-11-07-7rdwpxuf/RESULT.json`.
- El adjunto E1 termina truncado en su apartado de entrega; no se infirió permiso
  para commits. Solo estado y protocolo documental pendientes de commit.

## Drop 1.8.0 · E0: entorno nativo parcialmente preparado

- Prebuild local completado con Expo 57.0.20 y plantilla incluida 57.0.22,
  sin instalación ni clean. React 19.2.3 y React Native 0.86.3 coinciden con
  lockfile/plantilla. Ningún archivo versionado cambió durante la preparación.
- Generados proyecto iOS y esquema Drop/Release propios. Identidad reprotest;
  Info.plist conserva 1.7.1/build 16. Team/firma automática y embed Python
  siguen pendientes de configurar. No se creó DerivedData: lo hará la build E1.
- Restaurados Python 3.13.15/BeeWare b15, QuickJS-NG 0.16.2 y los tres paquetes
  Python fijados, desde cinco distribuciones existentes con SHA verificado.
  Sin descargas. Autolinking resuelve los módulos del checkout actual; el bridge
  compilado y la inclusión efectiva en Pods continúan sin comprobar.
- **BLOCKED en CocoaPods:** Ruby 2.6 del sistema espera darwin26, pero las gemas
  reutilizadas y headers del SDK tienen darwin25. Bundler rechaza las extensiones
  de nkf/json/ffi. Ruby 3.1.7 existente tampoco puede cargar `socket`; la instalación
  local de Bundler falla antes de instalar gemas, incluso su prueba básica sin
  aislamiento falla. No reparar un runtime incompleto mediante aliases o copias
  arbitrarias. Se requiere una reparación/provisión Ruby compatible autorizada.
- Cero `pod install`, builds integradas o instalaciones. Workspace/Pods y las
  fases nativas propias quedan pendientes. La copia privada de gemas Ruby 2.6
  se conserva sin limpiar; no se modificó el entorno de 1.5.0 ni el diagnóstico.
- Espacio inicial 27.36 GiB; al cerrar aproximadamente 25.98 GiB,
  por encima de 24 GiB. La variación observada no atribuye todos los bytes a E0.
  Estado, protocolo E2 y consolidado se actualizan sin descartar los diffs previos.
  No hay commits nuevos. Evidencia: `DropValidationEvidence/v1.8.0-E0-native-2026-11-07-aqrfgu95/RESULT.json`.
- NO-GO para E1 hasta disponer de Ruby y Pods válidos. No iniciar E1/E2 automáticamente.

## Drop 1.8.0 · E0.1: Ruby completo localizado, reserva insuficiente

- macOS 27.2/26B123 ARM64. Homebrew Ruby 4.0.7 existente carga socket, OpenSSL,
  zlib y RubyGems en el entorno aislado previsto, sin rutas de Ruby 2.6/3.1.
  Bundler 2.4.22 existente responde, con advertencias de constantes de plataforma.
  El inventario E0 no había probado este runtime completo; no hace falta otro
  Ruby para el ensayo de compatibilidad. No se modificaron runtimes globales.
- Incompatibilidad demostrada del bundle fijado: CFPropertyList 3.0.9 requiere
  Ruby <3.2 y minitest 5.25.4 excluye Ruby 4. Los paquetes cacheados coinciden
  por SHA con RubyGems. Instalar Ruby 3.3/3.4 por sí solo no resuelve el lock.
- Candidato mínimo, todavía **sin validar ni aplicar**: CFPropertyList 3.0.8 y
  minitest 5.27.0 con Ruby 4 existente, preservando CocoaPods 1.16.2, Xcodeproj
  1.28.1 y Bundler 2.4.22. La versión menor de Minitest no agrega dependencias.
  Se preparó un Gemfile/lock privado y dos archivos .gem oficiales verificados.
  Gemfile/Gemfile.lock reales y todos los archivos funcionales siguen intactos.
- **BLOCKED por almacenamiento antes de instalar:** primera medición 24.80 GiB;
  antes del ensayo 24.37 GiB y guardia de instalación 24.10 GiB frente a
  presupuesto conservador 0.35 GiB más
  reserva 24 GiB; medición posterior 22.59 GiB. No se atribuye la caída a una
  causa no acreditada ni se amplía la auditoría. Cero instalaciones de Ruby/gemas,
  pod install o builds. Para el ensayo se requieren al menos 24.35 GiB; preferir
  25 GiB para el paso posterior de Pods, o un destino externo autorizado.
- Proyecto iOS/esquema y recursos Python/QuickJS de E0 preservados por hashes.
  CocoaPods y el bridge integrado siguen pendientes. Sin limpiar, repetir Prebuild,
  tocar dispositivos, main o tags. Solo se amplían los dos documentos pendientes
  y el consolidado; sin commit. Evidencia: `DropValidationEvidence/v1.8.0-E0.1-ruby-2026-11-07-el4yyzz1/RESULT.json`.
- NO-GO para completar Pods o iniciar E1/E2 hasta recuperar margen y validar el
  ensayo aislado. No presentar la propuesta de dos gemas como un resultado PASS.

## Drop 1.8.0 · E0.1B: ensayo privado de Ruby/CocoaPods aprobado

- Ruby 4.0.7 ARM64, Bundler 2.4.22, CocoaPods 1.16.2 y Xcodeproj 1.28.1
  verificados en el bundle privado. Resolución y ejecución real separadas:
  bundle check PASS y bundle exec pod --version devuelve 1.16.2 con el entorno
  de compatibilidad existente del proyecto. Sin rutas de Ruby 2.6/3.1 cargadas.
- JSON, FFI, NKF, BigDecimal, socket, OpenSSL y zlib cargan y se ejercitan.
  Xcodeproj abre/guarda/reabre solo una copia privada del proyecto Drop.
  El proyecto nativo E0 y Gemfile/Gemfile.lock oficiales permanecen intactos.
- El ensayo demostró que los dos cambios iniciales no bastaban con Ruby 4.
  Propuesta final no aplicada: CFPropertyList 3.0.8, minitest 5.27.0 y declarar
  bigdecimal 4.0.1/benchmark 0.5.0. Estas dos bibliotecas estándar se reutilizaron
  del caché local y se instalaron solo en el destino privado. Sin otras versiones
  modificadas. Se requiere aprobación antes de adoptar el diff oficial.
- RUBYOPT fija Bundler 2.4.22 y carga el cocoapods_compat.rb existente para Logger.
  Se conservan las advertencias de constantes Gem::Platform de Bundler/Ruby4.
  La primera actualización podó dos copias del caché privado por no_prune omitido;
  ambas se repusieron desde originales íntegros y se verificaron por hash.
  Comandos posteriores fijan BUNDLE_NO_PRUNE=true. No se perdió recurso original.
- Espacio inicial 26.02 GiB y al cierre 25.99 GiB, manteniendo 25 GiB.
  Sin pod install, Prebuild, builds, dispositivos, firma, commits ni limpiezas.
  Evidencia: `DropValidationEvidence/v1.8.0-E0.1B-ruby-trial-7oithqzu/RESULT.json` y diffs propuestos.
- GO para revisar/adoptar configuración de herramientas y después completar E0
  con presupuesto nuevo. No iniciar E1: Pods/bridge integrado siguen pendientes.

## Drop 1.8.0 · E0.1C: Ruby 4 adoptado; Pods bloqueados por PATH

- Aplicados exclusivamente los ajustes autorizados: CFPropertyList 3.0.8,
  minitest 5.27.0, bigdecimal 4.0.1 y benchmark 0.5.0. CocoaPods 1.16.2,
  Xcodeproj 1.28.1, Bundler 2.4.22 y todas las demás versiones conservadas.
  Bundler generó el lock localmente; se repuso la plataforma genérica `ruby`
  mediante Bundler. El resultado coincide byte por byte con el ensayo privado.
- Desde el Gemfile oficial: bundle check PASS, bundle exec pod --version
  devuelve 1.16.2 y Xcodeproj carga con Ruby 4.0.7 ARM64. Extensiones requeridas
  cargadas y sin mezcla de Ruby 2.6/3.1. Se conservan los avisos Gem::Platform.
- Podfile, podspecs locales y dependencias JavaScript equivalentes al entorno
  conservado. Se reutilizaron copias independientes verificadas de fuentes y
  artefactos de Pods; se excluyeron proyecto, headers y soporte generados antiguos.
  Podfile.lock fijado preservado. Proyecto propio configurado para reprotest,
  Team HK927RUDLZ/firma automática y fase Python; sin modificar perfiles.
- Único `bundle exec pod install --deployment --no-repo-update`: exit 1 en
  1.01 s, antes del análisis de dependencias. Error exacto: `sh: node: command
  not found`; después `cannot load such file -- ./scripts/autolinking`.
  El PATH aislado preparado por el agente omitió `/usr/local/bin`, donde existe
  Node 22.19.0. Es un error de entorno del intento; no demuestra incompatibilidad
  de CocoaPods/Ruby 4 ni una ausencia real de Expo. Sin segundo intento.
- Workspace y Pods.xcodeproj aún ausentes. Python/QuickJS, esquema Release y
  fuentes Swift propios siguen presentes; integración de módulos/bridge pendiente.
  No certificar inclusión en el target por la mera presencia de fuentes o podspecs.
- Prevención concreta: antes del próximo intento autorizado, incluir
  `/usr/local/bin` en el PATH del hijo y comprobar Node/Expo/RN desde ese mismo
  entorno y directorio. Conservar RUBYOPT y BUNDLE_NO_PRUNE=true; no reparar gemas,
  modificar Podfile ni repetir Prebuild para este error. Revalidar presupuesto.
- Espacio inicial 26.00 GiB; cierre 25.96 GiB. Durante la instalación: 25.966 GiB
  inicial y mínimo/final 25.966 GiB; reserva de 24 GiB respetada.
  Cuatro archivos tracked pendientes: los dos documentos previos preservados y
  Gemfile/Gemfile.lock. Sin commit, cambios de versión, builds, dispositivos ni
  limpieza. Main y v1.7.1 intactos. NO-GO para E1 hasta completar Pods.
- Evidencia: `DropValidationEvidence/v1.8.0-E0.1C-ruby-pods-bqn4zu28/RESULT.json`.


## Drop 1.8.0 · E0.1D: CocoaPods preparado, sin compilación

- PATH del entorno Ruby incorpora `/usr/local/bin`. Node 22.19.0 real en
  `/usr/local/bin/node` cumple engines >=22.13.0 del proyecto y React Native;
  resuelve Expo/RN locales desde mobile. Mismo entorno: Ruby 4.0.7,
  Bundler 2.4.22, CocoaPods 1.16.2 y Xcodeproj 1.28.1; BUNDLE_NO_PRUNE=true.
- Una instalación `pod install --deployment --no-repo-update`, exit 0 en 18.08 s:
  116 dependencias y 115 Pods. Sin actualizaciones de versiones; Gemfile,
  Gemfile.lock y Podfile.lock conservan sus hashes previos. Recursos reutilizados.
- Workspace válido con referencias locales a Drop y Pods. Autolinking registra
  DropLibrary, DropPlayback y OnDeviceYouTube en ExpoModulesProvider; las 36 fuentes
  Swift actuales de los tres módulos están en sus targets. QuickJS incluido;
  Python ARM64 disponible y registrado mediante script XCFramework de CocoaPods,
  además de la fase de embed propia. Firma automática reprotest/Team conservados.
- Advertencias conservadas en log: constantes Gem::Platform y aviso de deprecación
  del uso directo de pod install en React Native. No se ejecutó expo run ni Xcode.
  Preparación satisfactoria no equivale a compilación o bridge físico verificados.
- Espacio antes 25.956 GiB; mínimo 25.941 GiB; final instalación 25.942 GiB.
  Cuatro archivos tracked pendientes, sin staging ni commit; notas anteriores
  preservadas. Main/tag y aplicaciones intactos. GO técnico para reanudar el
  preflight E1 con autorización, numeración/firma/espacio revalidados; no iniciado.
- Evidencia: `DropValidationEvidence/v1.8.0-E0.1D-pods-ls53qpjy/`.


## Drop 1.8.0 · E1: candidata integrada build 18 preparada

- Una compilación Release iPhoneOS ARM64 firmada, exit 0 / BUILD SUCCEEDED en
  480.47 s, dos jobs y vigilancia cada cinco segundos. Sin clean, Prebuild,
  pod install adicional, actualizaciones de aprovisionamiento ni reintentos.
- Reprotest 1.8.0/build 18, Team HK927RUDLZ. Perfil existente
  de reprotest hasta 11/11/2026 07:40:54 CDMX;
  certificado disponible, identidad y dispositivo autorizado comprobados.
  iPhone desconectado: versión instalada y colisión posterior se revalidarán en E2.
- Firma estricta, ARM64, Hermes nuevo, módulos DropLibrary/DropPlayback/
  OnDeviceYouTube y símbolos del picker/operación verificados. Source map conserva
  las fuentes TypeScript actuales de Biblioteca/SQLite/importación. Sin símbolos
  DROP_LOCK_SCREEN_PROBE ni fuentes experimentales en las entradas.
- Espacio antes 25.926 GiB; mínimo/final de build 22.841 GiB. El archivado
  conserva hashes de todos los archivos regulares. No atribuir toda variación
  del volumen a la build. Configuración nativa temporal restaurada; metadatos
  versionados 1.8.0/build 18 preparados sin commit; dependencias sin cambios.
- Advertencias de terceros/deprecación y fases sin outputs conservadas en log.
  No se repitieron suites host. Compilación/enlace no acreditan comunicación
  en ejecución, migración SQLite v4, selector de proveedores ni reproducción real.
- Artefacto/evidencia: `DropValidationEvidence/v1.8.0-E1-build18-reprotest-j25js2s0/`.
  SHA-256 ejecutable: `9dbf6f0142622852ff6ffa142012e69d64676472512f2e34c68644670128490b`. No se instaló ni accedió a contenedores.
- GO para solicitar E2 protegido: cerrar solo reprotest, inventario actual de
  IDs/medios/portadas/colecciones/Cola/progreso/preferencias; comparar y proteger
  incrementalmente SQLite/WAL coherentes y archivos, hashes/integridad/FK;
  revalidar firma/versión y una actualización in-place autorizada. Tras primer
  arranque, comprobar v4 y datos. Una build antigua no revierte la migración.
  Main/tag y aplicaciones intactos; siete archivos tracked pendientes sin commit.

## Drop 1.8.0 · E2: pendiente de conexión del iPhone

- Artefacto build 18, hash y firma revalidados; perfil vigente. Dispositivo
  conocido autorizado por el perfil, pero figura desconectado. No se accedió
  al contenedor, no se capturaron datos ni se intentó instalar.
- BLOCKED hasta conectar/desbloquear el iPhone y mantener cerrada reprotest.
  Respaldo build 17 localizado como candidato; vigencia respecto a datos actuales
  aún no acreditada. No certificar inventario, migración ni interfaz.
- Evidencia: `DropValidationEvidence/v1.8.0-E2-install-o2qy2cgr/RESULT.json`.
  Reanudar preflight/respaldo; la instalación in-place ya tiene autorización
  condicional, sin necesidad de aprobación rutinaria adicional si todo pasa.

## Drop 1.8.0 · E2: reprotest instalada y datos verificados

- Una instalación in-place PASS: 1.7.1/build 17 → 1.8.0/build 18, identidad
  reprotest. Original intacta. Primer arranque confirmado por el usuario sin error.
- Inventario real antes/después: seis LibraryItems, seis medios, seis portadas,
  cero Colecciones/relaciones y Cola vacía. Todas las filas/IDs, progreso,
  completedAt y preferencias conservados. SQLite migró v3→v4, integrity_check=ok,
  FK=0. Archivos no SQLite conservan tamaño/mtime; hashes previos reutilizados.
- Respaldo incremental independiente de 20 archivos con SQLite/WAL coherentes,
  manifiesto/hash completo y recuperación comprobada en una copia APFS aislada.
  La base recuperada v3 contiene exactamente el inventario previo; históricos
  conservados. Build 17 por sí sola no revierte una migración a v4.
- Mac 22.80 GiB inicial → 22.79 GiB final. Usuario informa 96 GB usados de 128 GB
  en iPhone. Sin compilación, limpieza, renovación de firma ni cambios de refs.
  Evidencia/respaldo: `DropValidationEvidence/v1.8.0-E2-install-o2qy2cgr/`.
- Incidentes de herramientas: tunnelState desconectado no implicaba falta de
  acceso; la consulta directa/USB funcionó. Apertura CLI rechazada por orden de
  argumentos antes de ejecutar la app; el usuario realizó el primer arranque.
- Instalación/migración/integridad PASS técnicos. La confirmación manual posterior
  de importación y demás pruebas principales se registra en el checkpoint vigente.
  No instalar otra vez ni inferir resultados de escenarios no confirmados.

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
