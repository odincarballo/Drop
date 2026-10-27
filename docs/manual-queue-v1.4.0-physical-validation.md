# Drop v1.4.0 — validación física de Manual Queue

Fecha del informe del usuario: **26 de octubre de 2026**.

## Alcance y procedencia

El usuario confirmó **15/15 pruebas satisfactorias** sobre la segunda Drop de prueba. Son observaciones físicas reportadas por el usuario, no pruebas ejecutadas ni observadas directamente por Codex. No se aportaron capturas ni trazas específicas para cada caso; este documento no las inventa.

La instalación probada utilizó:

- Bundle ID: `com.odincarballo.drop.reprotest`.
- Fuente funcional: `6d800e051236342a589d007baf4cce411271ce43`.
- Versión declarada: **1.3.0 build 6**, aunque contenía el desarrollo de Manual Queue de Drop 1.4.0.
- SHA-256 del ejecutable archivado en D2: `caefd38a4e42ee2f26744086b445424a56aee1345b071e2dfe618d2480558ac7`.

La preparación posterior establece **1.4.0 build 7**. Ese nuevo versionado **no ha sido compilado ni instalado en esta preparación**. Su candidata definitiva necesita una comprobación posterior propia; el hash anterior no identifica una build 7.

## Pruebas físicas reportadas por el usuario

| N.º | Caso                                                               | Resultado reportado |
| --- | ------------------------------------------------------------------ | ------------------- |
| 1   | Visualización de CURRENT y NEXT.                                   | Satisfactorio       |
| 2   | Transición automática entre elementos.                             | Satisfactorio       |
| 3   | Repetición manual A→A desde 0:00.                                  | Satisfactorio       |
| 4   | Transición con iPhone bloqueado y actualización de portada/título. | Satisfactorio       |
| 5   | Reordenación visual de la cola.                                    | Satisfactorio       |
| 6   | Reproducción respetando el nuevo orden.                            | Satisfactorio       |
| 7   | Eliminación individual de una entrada pendiente.                   | Satisfactorio       |
| 8   | Transición respetando la eliminación.                              | Satisfactorio       |
| 9   | Vaciado de cola sin interrumpir CURRENT.                           | Satisfactorio       |
| 10  | Reproducción de video en PiP.                                      | Satisfactorio       |
| 11  | Repetición A→A durante PiP.                                        | Satisfactorio       |
| 12  | Persistencia de la cola después de cerrar la app.                  | Satisfactorio       |
| 13  | Transición video→audio durante PiP.                                | Satisfactorio       |
| 14  | Recuperación del progreso después de reiniciar.                    | Satisfactorio       |
| 15  | Eliminación de Biblioteca de un elemento pendiente.                | Satisfactorio       |

Estos resultados no prueban todos los intercalados de concurrencia ni la persistencia exacta ante cualquier terminación abrupta del proceso.

## Comprobaciones técnicas de Codex en D2

La evidencia local se consultó en `~/Library/Application Support/DropValidationEvidence/v1.4.0-d2-manual-queue-2026-10-26/`: `VALIDATION.json`, respaldos `pre-install/` y comparación `post-upgrade/summary.json`. Es evidencia local de desarrollo, no un artefacto distribuido en este repositorio.

- Build integrada **Release ARM64: BUILD SUCCEEDED** desde la fuente funcional indicada; bridge nativo de reproducción incluido.
- Firma de desarrollo válida; Bundle ID correcto, Team coherente, certificado coincidente con el provisioning e iPhone incluido en el perfil. No se publican identificadores privados del dispositivo ni material de firma.
- Fuentes versionadas comparadas byte por byte con el commit de partida; sin correcciones funcionales durante D2.
- Actualización in-place de reprotest, sin desinstalar ni resetear su contenedor; lanzamiento sin Metro y proceso aún activo en la comprobación posterior.
- Respaldo consistente antes de instalar. SQLite migró **schema v2 → v3**; `integrity_check = ok` y `foreign_key_check` sin filas.
- **2 LibraryItems, 1 Collection y 1 membership** antes y después; filas existentes sin cambios.
- **2 medios y 2 portadas** preservados con hashes idénticos.
- La Drop original `com.odincarballo.mediadrop` no se actualizó ni desinstaló; sus metadatos de instalación permanecieron iguales.

El registro D2 dice `functionalTests: NOT RUN`: describe el trabajo de Codex al instalar y comprobar datos. Las 15 pruebas funcionales posteriores fueron realizadas y confirmadas por el usuario. No hay contradicción entre ambas fuentes de evidencia.

## Comprobaciones de preparación de la candidata

Ejecutadas por Codex el 26 de octubre de 2026 sobre el árbol con versión 1.4.0 build 7:

- `npm test -- --runInBand`: **394 pruebas aprobadas, 1 omitida**; 32 suites aprobadas y 1 omitida. La prueba de backend vivo requiere activación explícita y no se ejecutó.
- `npm run typecheck`, `npm run lint` y `npm run format:check`: satisfactorios; comprobación Prettier de la documentación modificada también satisfactoria.
- `node --test scripts/tests/public_build_config.test.cjs`: **5/5 aprobadas**.
- Configuración pública Expo resuelta para el Bundle ID por defecto y dos valores de entorno distintos: versión 1.4.0, build 7 y selección del identificador desde el entorno correctas. `app.config.js` no cambió.
- Comparación de los JSON con la fuente funcional: únicamente cambiaron los campos de versión/build previstos; dependencias y resto del lockfile intactos.
- `git diff --check` y revisión acotada de secretos/cambios sensibles: sin incidencias.

No se repitieron aquí las suites Swift ni la compilación iOS integrada. Estos checks de preparación no sustituyen la validación de un nuevo artefacto 1.4.0 build 7.

## Comprobaciones pendientes

- Compilar y firmar la candidata **1.4.0 build 7** desde su commit final; verificar identificador, versión, build, arquitectura, provisioning y nuevo SHA-256.
- Probar físicamente esa candidata con autorización de instalación independiente. No actualizar la Drop original como parte de esta preparación.
- VoiceOver y recorrido completo de accesibilidad; revisión exhaustiva de layout, temas y tamaños de texto/dispositivo.
- Escenarios físicos excepcionales de concurrencia: Delete durante consumo, escrituras SQLite bloqueadas/fallidas, ACK tardíos/superseded, mutaciones rápidas y recuperación tras crash en los límites del handoff durable.
- No se atribuye validación independiente de terceros, App Store ni TestFlight a este informe.
