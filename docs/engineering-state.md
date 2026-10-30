# Estado operativo de Drop

Actualizado: 30 de octubre de 2026. Snapshot humano: verificar Git antes de actuar.
No contiene autorizaciones nuevas ni resultados inferidos.

- **Estado:** Drop 1.4.0 build 8 cerrada localmente; Unidad 1 completada,
  validada y desplegada en la aplicación original.
- **Git local:** main y `release/v1.4.0-build8` comparten el commit documental
  de cierre tras fast-forward. Obtener SHA/árbol con Git. Sin push ni GitHub
  Release; las referencias remotas no se actualizan por este cierre.
  El tag v1.4.0 conserva `7927dec6429bdc85fbc19082ad62c18de99ffa73`.
- **Trazabilidad:** Unidad 1 `c4134d41cb0e60256fca29aa7e2bf826a7a693bf`
  y protocolo `7186eb8037ecad21bb1d5fa1f00c7f7085b7f59b` integrados en
  `9058c430eb55cd3c506e5d75bc330aecd8e4f99a`.
- **Fuente exacta de la app instalada:**
  `3dab34bb01b2eace6fa14778d5113513693b8076`, árbol
  `4689d14b232d60b667477ad494937b18355ccb25`.
  El nuevo commit documental no fue compilado ni instalado. La app original
  es `com.odincarballo.mediadrop`, Team `HK927RUDLZ`, versión 1.4.0 build 8.
  SHA-256 del ejecutable firmado:
  `d12863faac8782624b723f916baada3734000634455e7e4d4a6ec8e6de82f968`.
- **Build verificada:** Release iPhoneOS ARM64, firma válida, certificado y
  entitlements compatibles con la instalación anterior. Hermes y
  statPreparedSource integrados; sin panel/helper/exportaciones de fixtures.
  Evidencia durable en `DropValidationEvidence`:
  `original-build8-signed-2026-10-30-m0w9vd3m/VALIDATION.json`,
  app `original-build8-signed-2026-10-30-m0w9vd3m/Drop.app`.
- **Instalación:** PASS in-place, sin uninstall/reset/restauración. Antes y
  después: 15 LibraryItems, 15 medios, 15 portadas, 1 Collection,
  0 memberships, 0 entradas de Manual Queue; SQLite v3 íntegro y FK=0.
  IDs/metadatos/progreso/relaciones y 30 hashes conservados antes de reproducir.
  Usuario confirmó Biblioteca, portadas y reproducción sin errores ni fixtures.
  Lectura posterior verificó como único cambio el progreso del elemento elegido;
  el resto de datos y relaciones quedó intacto. Reprotest no se modificó.
  Informe: `original-build8-inplace-2026-10-30-mk02dlzp/FINAL-RESULT.json`.
- **Respaldo previo actualizado y preservado:**
  `drop-original-v1.4.0-build7-pre-build8-updated-2026-10-30-o_5lpbje`,
  bajo `DropValidationEvidence`; 15 elementos, medios y portadas, schema v3,
  copia cruda, snapshot normalizado y hashes verificados. Conserva build 7;
  el progreso legítimo del smoke posterior está en la evidencia de instalación.
  Respaldos anteriores también preservados. Para otra actualización, contrastar
  el estado actual y capturar cambios posteriores; no restaurar automáticamente.
- **Vencimiento de provisioning:** 04/11/2026, 11:30:36 CDMX
  (2026-11-04T17:30:36Z). No se renovó ni se volvió a firmar durante instalación.
  Revisar antes de vencer; renovación/refirma requieren su autorización propia.
- **Validación histórica conservada:** 419 tests móviles PASS, uno omitido;
  SQLite real, 7 harnesses Swift estrictos, 23 Python, 9 host Node y checks
  estáticos PASS en la integración. Validación física instrumentada 12/12
  documentada previamente; no se repitió sobre la original. El cierre actual
  es documental: no repite suites, builds o pruebas físicas.
- **Incidencia independiente:** NOT_READY no apareció en este smoke, pero su
  origen histórico exacto sigue pendiente. No se declara corregido.
- **Árbol instrumentado:** `fix/library-incomplete-restore` conserva su trabajo
  local; no copiarlo a producción ni descartarlo. Ambos Markdown protegidos
  permanecen sin seguimiento y fuera de los commits de release.
- **Próximo objetivo:** Drop 1.4.1, pendiente de definición de alcance y
  autorización. No se crea rama ni se inicia implementación. Conservar el
  workflow transversal, validación proporcional y límites de almacenamiento.

## Registro ligero de eficiencia

| Fecha      | Incidente verificado                                               | Prevención                                                     |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 2026-10-29 | App normal perdida tras desaparición de `/tmp`; hubo que regenerar | Checkout durable y archivo automático antes de retirar entorno |
| 2026-10-29 | `eslint .` amplió alcance; seis errores reproducidos en base       | Usar lint Expo; registrar chequeos adicionales separados       |
| 2026-10-29 | Formato global recorrió 81 archivos de gemas/cachés                | Formato sobre fuentes Git con reglas intactas                  |
| 2026-10-29 | Verificador supuso un nombre antiguo de framework Hermes           | Inspección de bytecode/dependencias reales                     |

Añadir solo incidencias accionables; no duplicar conversaciones ni logs.
