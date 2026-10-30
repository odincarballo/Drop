# Estado operativo de Drop

Actualizado: 29 de octubre de 2026. Snapshot humano: verificar Git antes de actuar.
No contiene autorizaciones nuevas ni resultados inferidos.

- **Bloque actual:** candidata local de integración de Unidad 1 y protocolo.
- **Rama:** `integration/library-protection-workflow`; worktree aislado
  `library-protection-workflow-integration`. Obtener su SHA actual con Git.
- **Base/main:** `7927dec6429bdc85fbc19082ad62c18de99ffa73`, v1.4.0 build 7.
  Main y tag v1.4.0 permanecen protegidos y sin cambios.
- **Commits aprobados conservados:** Unidad 1
  `c4134d41cb0e60256fca29aa7e2bf826a7a693bf` y protocolo
  `7186eb8037ecad21bb1d5fa1f00c7f7085b7f59b`, ambos hijos de la base.
  Integrados sin conflictos y sin reescribirlos; solo se actualiza este estado
  respecto de su combinación exacta. La integración en main no se ha realizado.
- **Protección de Biblioteca:** los 27 archivos normales coinciden por SHA-256 y
  permisos con el manifiesto aprobado. Schema v3, Collections, Manual Queue,
  versión/build y dependencias sin cambios. Sin instrumentación en producción;
  `statPreparedSource` permanece registrado en Swift y declarado en TypeScript.
- **Original de trabajo:** `fix/library-incomplete-restore` conserva sus cambios
  locales e instrumentación. No usar como fuente de producción ni descartarlos.
  Los dos documentos locales protegidos permanecen fuera de esta candidata.
- **Validación combinada ejecutada:** 419 tests móviles PASS, uno omitido;
  33 suites PASS, incluida SQLite real. Siete harnesses Swift 6 estrictos PASS
  (19 aserciones de imágenes); 23 tests Python y 9 host Node PASS.
  TypeScript, lint Expo sin caché y formato oficial de fuentes PASS.
  No se repitieron pruebas físicas ni se instalaron aplicaciones.
- **Evidencia actual:** carpeta local de `DropValidationEvidence`
  `integration-unit1-workflow-2026-10-29-2qjs_d7c`; comandos, logs,
  procedencia, manifiesto y resultado final fuera de Git.
- **Evidencia anterior:** Unidad 1 en
  `unit1-production-patch-2026-10-29-v9mc_9is/recovery/VALIDATION.json`.
  Se verificaron sus 291 fuentes de origen y los 3824 archivos del artefacto.
  Ejecutable histórico: `a5e8d575497720abe496332fdf0d6959fe62dc90838325922e581111ccaea3df`.
  La validación física instrumentada 12/12 es histórica; no se repitió aquí.
  El informe `library-incomplete-restore.md` conserva sus hitos iniciales.
- **Build combinada:** NO ejecutada ni acreditada mediante reutilización. Las
  entradas completas cambiaron (tooling y script de formato en package.json),
  aunque las fuentes runtime de Unidad 1 coinciden. El artefacto unsigned previo
  no es una candidata instalada ni una build del commit de integración.
  Antes de cualquier nueva Xcode: mínimo 24 GiB, vigilancia cada 5 s y parada
  a 15 GiB; no limpiar automáticamente. El espacio actual está bajo 24 GiB.
- **Incidencia separada:** NOT_READY de origen exacto pendiente; sin regresión de
  Biblioteca demostrada. No aplicar corrección especulativa.
- **Permisos de este bloque:** preparar/validar integración y commits solo en
  esta rama. Sin cambios en main, push, tags, instalaciones ni datos de apps.
- **Siguiente acción:** revisar la candidata local y autorizar por separado su
  integración en main. Ninguna autorización de instalación está implícita.

## Registro ligero de eficiencia

| Fecha      | Incidente verificado                                               | Prevención                                                     |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 2026-10-29 | App normal perdida tras desaparición de `/tmp`; hubo que regenerar | Checkout durable y archivo automático antes de retirar entorno |
| 2026-10-29 | `eslint .` amplió alcance; seis errores reproducidos en base       | Usar lint Expo; registrar chequeos adicionales separados       |
| 2026-10-29 | Formato global recorrió 81 archivos de gemas/cachés                | Formato sobre fuentes Git con reglas intactas                  |
| 2026-10-29 | Verificador supuso un nombre antiguo de framework Hermes           | Inspección de bytecode/dependencias reales                     |

Añadir solo incidencias accionables; no duplicar conversaciones ni logs.
