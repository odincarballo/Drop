# Estado operativo de Drop

Actualizado: 29 de octubre de 2026. Snapshot humano: verificar Git antes de actuar.
No contiene autorizaciones nuevas ni resultados inferidos.

- **Bloque actual:** protocolo transversal, independiente de Unidad 1.
- **Rama:** `codex/engineering-workflow`, basada en main
  `7927dec6429bdc85fbc19082ad62c18de99ffa73`; protocolo local; integración pendiente.
- **Estable/main:** v1.4.0 build 7, mismo commit base; tag v1.4.0 protegido.
- **Unidad 1 limpia:** `fix/library-incomplete-restore-clean`, commit
  `c4134d41cb0e60256fca29aa7e2bf826a7a693bf`, pendiente de integración autorizada.
  27 archivos, 291 fuentes, build ARM64 unsigned y validación física instrumentada
  12/12 PASS documentadas. No equivale a instalación del parche normal en original.
- **Original de trabajo:** `fix/library-incomplete-restore` conserva cambios locales
  e instrumentación; no usarlo como fuente de producción ni descartarlos.
- **Evidencia Unidad 1:** archivo local bajo `DropValidationEvidence`, carpeta
  `unit1-production-patch-2026-10-29-v9mc_9is/recovery/VALIDATION.json`.
  Ejecutable normal: `a5e8d575497720abe496332fdf0d6959fe62dc90838325922e581111ccaea3df`.
- **Incidencia separada:** NOT_READY de origen exacto pendiente; sin regresión de
  Biblioteca demostrada. No aplicar corrección especulativa.
- **Permisos de este bloque:** revisión final y un commit local autorizados.
  Sin merge, push, instalaciones ni modificaciones de datos/dispositivos.
- **Validación final:** 23 pruebas Python y 9 host Node PASS; cuatro escenarios
  CLI controlados PASS, incluida interrupción y cambio de entradas. Formato,
  ejemplos y diff verificados. No se ejecutó build iOS ni prueba física.
- **Siguiente acción:** solicitar/revisar autorización de integración del protocolo.
  Unidad 1 se retoma por separado; ninguna integración está ejecutada.

## Registro ligero de eficiencia

| Fecha      | Incidente verificado                                               | Prevención                                                     |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 2026-10-29 | App normal perdida tras desaparición de `/tmp`; hubo que regenerar | Checkout durable y archivo automático antes de retirar entorno |
| 2026-10-29 | `eslint .` amplió alcance; seis errores reproducidos en base       | Usar lint Expo; registrar chequeos adicionales separados       |
| 2026-10-29 | Formato global recorrió 81 archivos de gemas/cachés                | Formato sobre fuentes Git con reglas intactas                  |
| 2026-10-29 | Verificador supuso un nombre antiguo de framework Hermes           | Inspección de bytecode/dependencias reales                     |

Añadir solo incidencias accionables; no duplicar conversaciones ni logs.
