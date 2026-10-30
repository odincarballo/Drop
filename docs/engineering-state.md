# Estado operativo de Drop

Actualizado: 30 de octubre de 2026. Snapshot humano: verificar Git antes de actuar.
No contiene autorizaciones nuevas ni resultados inferidos.

- **Estado:** corrección `/live/{videoId}` cerrada funcionalmente en prueba
  aislada; release 1.4.1 build 9 preparado localmente. **No desplegado** en
  la aplicación original. Compilación, firma e instalación de build 9 pendientes.
- **Git:** main permanece en `3c745cf9a790a28b3e6e5c7c1122a0dac12888d2`,
  árbol `e2f2b6a90eb37de7e415d99f427efe31c48096cd`. Ese commit incorpora
  exclusivamente normalización Python y sus pruebas. Release independiente:
  `codex/release-v1.4.1-build9`, basado en main; obtener SHA y árbol con Git.
  Sin integración del release en main, push ni tags nuevos. El tag v1.4.0
  conserva `7927dec6429bdc85fbc19082ad62c18de99ffa73`.
- **Versionado preparado:** Expo y package 1.4.1; iOS buildNumber 9.
  `mobile/app.config.js` mantiene Bundle ID por entorno; futura original:
  `com.odincarballo.mediadrop`, Team `HK927RUDLZ`. No fijar identidades de
  prueba en fuentes. Expo generará Info.plist/proyecto nativo desde esta
  configuración en el checkout de build; todavía no se ha generado ni compilado.
- **Parche:** `/live/{videoId}` se normaliza a `/watch?v={videoId}` con
  validaciones de URL existentes; se conservan los rechazos `is_live`,
  `is_upcoming` y `post_live`. No habilita directos activos ni evade restricciones.
- **Automatización aprobada:** 54 pruebas Python PASS y 27 móviles PASS sobre
  los hashes del parche integrado. Evidencia `youtube-live-normalization-2026-10-30-b2366s24`
  bajo `DropValidationEvidence`. No se repiten por cambios de metadatos y
  documentación; la candidata definitiva requiere su propia build verificable.
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
- **Original instalada:** continúa en **1.4.0 build 8**, fuente
  `3dab34bb01b2eace6fa14778d5113513693b8076`, árbol
  `4689d14b232d60b667477ad494937b18355ccb25`. Último despliegue PASS in-place;
  15 LibraryItems, 15 medios, 15 portadas, 1 Collection, 0 memberships y cola
  vacía documentados entonces. Durante prueba aislada: identidad y 253 entradas
  del inventario conservaron metadatos; no se volvieron a copiar SQLite ni
  medios originales para verificar hashes. No inferir inventario actual íntegro
  de ese control limitado. Revalidar y respaldar antes de otra instalación.
- **Original y respaldos preservados:** evidencia de build
  `original-build8-signed-2026-10-30-m0w9vd3m`, instalación
  `original-build8-inplace-2026-10-30-mk02dlzp/FINAL-RESULT.json`, respaldo previo
  `drop-original-v1.4.0-build7-pre-build8-updated-2026-10-30-o_5lpbje`, todos bajo
  `DropValidationEvidence`. No restaurar automáticamente ni sobrescribir copias.
- **Firma original:** provisioning vence **04/11/2026, 11:30:36 CDMX**
  (2026-11-04T17:30:36Z). Misma cuenta, Team, App ID, dispositivo autorizado,
  certificado vigente con clave privada y entitlements compatibles requeridos
  para build 9. No se renovó el perfil, no se firmó ni instaló en este bloque.
  La firma de live141test no sustituye la original. Solicitar perfil nuevo en
  Xcode con autorización posterior; automatic signing puede reutilizar el
  vigente y no garantiza renovación. Si exige autenticación, usar Settings →
  Accounts con la misma cuenta; detener ante cambio inesperado de identidad,
  permisos o certificado. Verificar el perfil efectivamente emitido.
- **Unidad 1 y protocolo:** integrados en `9058c430eb55cd3c506e5d75bc330aecd8e4f99a`;
  commits originales `c4134d41cb0e60256fca29aa7e2bf826a7a693bf` y
  `7186eb8037ecad21bb1d5fa1f00c7f7085b7f59b` preservados. Protección de
  Biblioteca desplegada en build 8; schema v3 sin cambios en este release.
- **Incidencia independiente:** NOT_READY no apareció en la sesión aislada;
  origen histórico pendiente de investigación. No se declara corregido.
- **Protección:** árbol instrumentado `fix/library-incomplete-restore` y ambos
  Markdown locales sin seguimiento se conservan fuera de este release. Original,
  reprotest y app aislada no se modifican durante esta preparación.
- **Próxima acción:** recuperar margen con limpieza autorizada por separado si
  hace falta; preparar checkout exacto del commit de release, dependencias y
  manifiesto de build. Exigir 24 GiB justo antes de Xcode, supervisión cada 5 s,
  parada a 15 GiB y máximo 2 jobs, sin limpieza automática. Renovación de perfil,
  build y firma requieren el bloque posterior autorizado. Instalación exige
  autorización independiente y respaldo actualizado. No iniciar 1.5.0.

## Registro ligero de eficiencia

| Fecha      | Incidente verificado                                               | Prevención                                                     |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 2026-10-29 | App normal perdida tras desaparición de `/tmp`; hubo que regenerar | Checkout durable y archivo automático antes de retirar entorno |
| 2026-10-29 | `eslint .` amplió alcance; seis errores reproducidos en base       | Usar lint Expo; registrar chequeos adicionales separados       |
| 2026-10-29 | Formato global recorrió 81 archivos de gemas/cachés                | Formato sobre fuentes Git con reglas intactas                  |
| 2026-10-29 | Verificador supuso un nombre antiguo de framework Hermes           | Inspección de bytecode/dependencias reales                     |

Añadir solo incidencias accionables; no duplicar conversaciones ni logs.
