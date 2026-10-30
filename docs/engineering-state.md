# Estado operativo de Drop

Actualizado: 29 de octubre de 2026. Snapshot humano: verificar Git antes de actuar.
No contiene autorizaciones nuevas ni resultados inferidos.

- **Bloque actual:** preparación local de Drop 1.4.0 build 8 para la original.
- **Rama:** `release/v1.4.0-build8`, worktree `release-v1.4.0-build8`.
  Obtener SHA actual con Git; no hay build firmada ni instalación de build 8.
- **Main integrado:** `9058c430eb55cd3c506e5d75bc330aecd8e4f99a`, árbol
  `921ca16f8ba2e739b6385b40c4bc76fc23ec9008`. Unidad 1 y protocolo integrados
  mediante fast-forward local; main permanece sin cambios en este bloque.
- **Commits originales preservados:** Unidad 1
  `c4134d41cb0e60256fca29aa7e2bf826a7a693bf` y protocolo
  `7186eb8037ecad21bb1d5fa1f00c7f7085b7f59b`.
  Tag v1.4.0 sigue apuntando a `7927dec6429bdc85fbc19082ad62c18de99ffa73`.
- **Versionado candidato:** 1.4.0 build 8; solo cambia buildNumber en app.json.
  Paquete/lock, dependencias, schema v3 y código funcional sin cambios.
  Bundle ID original `com.odincarballo.mediadrop` y Team `HK927RUDLZ` se
  resolverán externamente. No fijar identificadores de prueba en producción.
- **Respaldo aprobado:** carpeta durable de `DropValidationEvidence`
  `drop-original-v1.4.0-build7-pre-build8-2026-10-29-8g8m5oft`.
  Original instalada 1.4.0 build 7; 14 LibraryItems ready, 14 medios,
  14 portadas, 1 Collection, 0 memberships y 0 entradas de Manual Queue.
  Schema v3; integridad ok, FK=0, metadatos/progreso y 28 hashes coincidentes.
  Snapshot normalizado local y copia cruda conservados; sin restauración física.
  Cambios posteriores de la Biblioteca exigirán revalidación/captura actualizada.
- **Pruebas funcionales previas:** integración con 419 tests móviles PASS,
  uno omitido; SQLite real y 7 harnesses Swift estrictos PASS; 23 Python,
  9 host Node, TypeScript, lint Expo y formato PASS. Este bloque no cambia
  entradas funcionales ni repite esas suites. Validar configuración Expo y diff.
- **Instrumentación:** ausente en la candidata normal; statPreparedSource
  conservado. El árbol `fix/library-incomplete-restore` sigue instrumentado,
  con cambios locales protegidos: no copiarlo ni descartarlo. Ambos Markdown
  locales protegidos permanecen fuera de este worktree.
- **Build e instalación:** PENDIENTES. La build unsigned histórica de Unidad 1
  no acredita este nuevo commit ni permite instalar la original.
  Seguir engineering-workflow.md y reproducible-ios-release.md, con Ruby
  compatible y Bundler 2.4.22. Antes de Xcode exigir >=24 GiB tras preparar
  dependencias, vigilancia cada 5 s, parada a 15 GiB y -jobs 2.
  Si falta espacio: detener y reportar; no limpiar automáticamente.
  El modo build del supervisor existente solo permite unsigned/reprotest;
  no alterar esa protección para firmar la original. Planificar supervisión
  externa autorizada y verificación independiente de firma/artefacto.
- **Incidencia independiente:** NOT_READY sigue con origen exacto pendiente;
  sin regresión de Biblioteca demostrada ni corrección especulativa.
- **Permisos actuales:** solo preparación y un commit local en esta rama.
  Sin merge/push/tags, build, firma, instalaciones ni datos del iPhone.
- **Siguiente paso:** revisar el commit y autorizar por separado la compilación
  firmada. Instalación requiere otra autorización y revalidación de los 14
  elementos; si cambiaron desde el respaldo, preparar una captura actualizada.

## Registro ligero de eficiencia

| Fecha      | Incidente verificado                                               | Prevención                                                     |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 2026-10-29 | App normal perdida tras desaparición de `/tmp`; hubo que regenerar | Checkout durable y archivo automático antes de retirar entorno |
| 2026-10-29 | `eslint .` amplió alcance; seis errores reproducidos en base       | Usar lint Expo; registrar chequeos adicionales separados       |
| 2026-10-29 | Formato global recorrió 81 archivos de gemas/cachés                | Formato sobre fuentes Git con reglas intactas                  |
| 2026-10-29 | Verificador supuso un nombre antiguo de framework Hermes           | Inspección de bytecode/dependencias reales                     |

Añadir solo incidencias accionables; no duplicar conversaciones ni logs.
