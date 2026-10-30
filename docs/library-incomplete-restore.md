# Protección de Biblioteca frente a archivos ausentes o restaurados parcialmente

Estado: parche local para revisión, 28 de octubre de 2026. Base: `v1.4.0`,
commit `7927dec6429bdc85fbc19082ad62c18de99ffa73`.
No constituye un sistema de backup/restauración ni una validación física.

## Defecto reproducido

Antes del parche se ejecutó la regresión `missing ready media preserves relationships,
duplicate occurrences and progress` sobre SQLite real y archivos sintéticos. Falló:
al faltar el archivo de A desaparecieron su registro, su membership y sus dos
ocurrencias de Manual Queue mediante foreign keys. La Collection y B permanecieron.
La reconciliación también podía borrar el medio discrepante, quitar referencias
de portadas y eliminar imágenes durante consultas nativas.

## Contrato del parche

- `ready` describe una importación confirmada y conserva metadata, progreso,
  `completedAt`, memberships y ocurrencias aunque el archivo desaparezca.
- Disponibilidad derivada: `available`, `missing`, `invalid`, `unreadable`.
  No se persiste ni se reutiliza `pending` para un medio confirmado ausente.
- `uri` es nula cuando el archivo no está disponible. `sizeBytes` conserva el
  tamaño esperado; `mediaSizeOnDisk` refleja únicamente una observación actual.
- Biblioteca, Collections y Sin colección incluyen los registros confirmados
  no disponibles; los contadores siguen representando esos registros.
- Las filas muestran una explicación accesible. Reproducir, encolar y exportar
  están bloqueados desde ellas. El borrado explícito y la organización permanecen.
- La disponibilidad se vuelve a consultar al leer o volver a abrir la lista.
  La reaparición no abre el player, no hace autoplay y no consume la cola.
- Inspeccionar y enumerar portadas no borra archivos. Las referencias sobreviven
  a ausencia, truncamiento o error; se utiliza fallback mientras no sean legibles.
- El barrido protege los medios referenciados y las portadas cuyo ID tiene una
  fila propietaria, incluso sin referencia de portada o con lifecycle no listo.
- Los archivos regulares propios sin propietario mantienen la limpieza anterior.
  Nombres de portada ajenos al contrato, directorios y symlinks no se borran por
  enumerarlos. No se interpreta un error de permisos como ausencia confirmada.
- `deleting` conserva la intención de borrado y sus barreras/leases existentes.
  La eliminación explícita puede retirar imágenes inválidas sin decodificarlas.
- `pending`: se inspeccionan destino y origen conocido. Si el origen tiene el
  tamaño esperado se intenta recuperar la promoción. Solo se descarta el registro
  cuando ambas ubicaciones son conocidas como ausentes (o no hay origen registrado).
  Un error transitorio, un move fallido o un archivo parcial se conserva para otro
  arranque. No se añade caducidad automática para casos ambiguos. Un destino solo se acepta
  con tamaño esperado positivo e idéntico; un tamaño esperado desconocido no se
  sustituye silenciosamente por el tamaño encontrado.

La disponibilidad física no certifica la decodificación de todo el medio ni añade
hashes persistentes: las validaciones AVFoundation antes de reproducir permanecen.
No se aceptan tamaños distintos actualizando silenciosamente el tamaño esperado.
Media y Artwork siguen excluidos del backup del sistema; este parche no cambia
esa política ni reconstruye referencias que ya se hubieran perdido anteriormente.

## Schema y límites nativos

Schema v3 sin cambios. Permanecen los lifecycle `pending`, `ready`, `deleting`.
Los lectores Swift y el consumo durable de Manual Queue no cambian. Las migraciones
existentes v1/v2 a v3 se verificaron también con medios sintéticos ausentes.

Se añade `DropLibrary.statPreparedSource`, una consulta limitada al caché propio,
para distinguir ausencia de origen de un fallo de inspección. La nueva política
`DropLibraryFileInspection` usa lecturas sin borrado, límite de 2 MiB, límites de
imagen y decodificación de thumbnail acotada. El podspec incluye `ios/*.swift`.
No se crea un módulo adicional ni se cambian dependencias.

La política nativa y las suites de reproducción se ejecutaron en macOS. Además,
Paths + FileInspection + Storage se comprobaron con el SDK iPhoneOS para ARM64,
incluido UIKit, mediante typecheck Swift 6. Esto NO equivale a una app compilada:
queda pendiente una build integrada de Expo/React Native para verificar el método
nuevo en el bridge y empaquetar Swift y JavaScript juntos.

## Resultados ejecutados

| Verificación                               | Resultado                                   |
| ------------------------------------------ | ------------------------------------------- |
| Móvil completo                             | 419 PASS, 0 FAIL, 1 omitida; 33 suites PASS |
| SQLite real, nueva suite de disponibilidad | 19 PASS                                     |
| SQLite real, Collections                   | 14 PASS                                     |
| SQLite real, schema/migraciones            | 27 PASS                                     |
| SQLite real, Manual Queue TypeScript       | 26 PASS                                     |
| Swift 6 estricto, warnings como errores    | 7 harnesses PASS                            |
| FileInspection, imágenes sintéticas reales | 19 aserciones PASS                          |
| Storage con UIKit / iOS ARM64              | Typecheck PASS                              |
| TypeScript / ESLint / Prettier móvil       | PASS                                        |
| Release iOS integrada / pruebas físicas    | NO EJECUTADAS                               |

Las cantidades de suites específicas son subconjuntos del total móvil, no pruebas
adicionales que deban sumarse a las 419. La prueba omitida de backend vivo es opt-in.

La cobertura incluye ausencia individual/total, tamaños 0/menor/mayor, errores
transitorios, portadas ausentes/inválidas/truncadas, reaparición, reinicio simulado,
reconciliación repetida, fallback, exportación bloqueada y borrado con cascades.
Se comparan todas las filas de Biblioteca/Collections/memberships/cola antes y
después; se comprueban `integrity_check`, `foreign_key_check`, progreso, IDs y orden.
La suite nativa de servicio usa el repositorio SQLite de cola real y verifica NEXT físicamente ausente sin consumirlo ni
interrumpir CURRENT, transición al siguiente disponible y reaparición sin autoplay.
La imagen en Jest es una frontera simulada; ImageIO se ejecuta realmente en Swift.

## Comandos

Desde `mobile/`:

```bash
npm test -- --runInBand tests/library-availability.test.ts
npm test -- --runInBand
npm run typecheck
npm run lint
npm run format:check
```

Desde la raíz, las siete suites Swift (solo fixtures temporales):

```bash
set -euo pipefail
out="$(mktemp -d "${TMPDIR:-/tmp}/drop-unit1-swift.XXXXXX")"
library=mobile/modules/drop-library
playback=mobile/modules/drop-playback
run() { local name="$1"; shift; xcrun swiftc -swift-version 6 -strict-concurrency=complete -warnings-as-errors "$@" -o "$out/$name"; "$out/$name"; }
run FileInspection "$library/ios/DropLibraryPaths.swift" "$library/ios/DropLibraryFileInspection.swift" "$library/tests/DropLibraryFileInspectionTests.swift"
run LibraryPaths "$library/ios/DropLibraryPaths.swift" "$library/tests/DropLibraryPathsTests.swift"
run LibraryDatabase "$library/ios/DropLibraryDatabase.swift" "$library/tests/DropLibraryDatabaseTests.swift"
run PlaybackCore "$playback/ios/PlaybackLeaseCoordinator.swift" "$playback/ios/PlaybackPolicy.swift" "$playback/ios/PlaybackProgressRepository.swift" "$playback/tests/PlaybackCoreTests.swift"
run ProgressWrites "$playback/ios/PlaybackLeaseCoordinator.swift" "$playback/ios/PlaybackPolicy.swift" "$playback/ios/PlaybackProgressRepository.swift" "$playback/ios/PlaybackProgressWriteCoordinator.swift" "$playback/tests/PlaybackProgressWriteCoordinatorTests.swift"
run ManualQueue "$playback/ios/PlaybackManualQueueRepository.swift" "$playback/tests/PlaybackManualQueueRepositoryTests.swift"
run PlaybackService "$playback/ios/DropPlaybackService.swift" "$playback/ios/PlaybackLeaseCoordinator.swift" "$playback/ios/PlaybackPolicy.swift" "$playback/ios/PlaybackProgressRepository.swift" "$playback/ios/PlaybackProgressWriteCoordinator.swift" "$playback/ios/PlaybackManualQueueRepository.swift" "$playback/ios/PlaybackNextSelector.swift" "$playback/ios/PlaybackContext.swift" "$playback/ios/PlaybackRatePreference.swift" "$playback/ios/PlaybackSystemBridge.swift" "$playback/tests/PlaybackServiceTests.swift"

```

Comprobación adicional de tipos iOS, sin build de aplicación:

```bash
sdk=$(xcrun --sdk iphoneos --show-sdk-path)
xcrun swiftc -typecheck -swift-version 6 -strict-concurrency=complete -warnings-as-errors \
  -sdk "$sdk" -target arm64-apple-ios16.4 \
  mobile/modules/drop-library/ios/DropLibraryPaths.swift \
  mobile/modules/drop-library/ios/DropLibraryFileInspection.swift \
  mobile/modules/drop-library/ios/DropLibraryStorage.swift
git diff --check
```

## Validación posterior mínima, aún pendiente

1. Revisar el parche y preparar una build iOS integrada de prueba sin instalarla.
2. Antes de cualquier instalación: autorización y respaldo verificado de reprotest.
3. Usar exclusivamente fixtures desechables para ausencia parcial y reaparición;
   no quitar archivos existentes del usuario ni sustituir su base para provocarlas.
4. Comprobar filas/contadores, acciones deshabilitadas, Delete explícito y recuperación
   al volver a la lista, sin autoplay. Repetir el caso de NEXT ausente con CURRENT activo.
5. Comparar SQLite, memberships, ocurrencias y archivos de las fixtures; comprobar
   VoiceOver y regresión básica de exportación/reproducción de un archivo disponible.

No se accedió a contenedores del iPhone ni a respaldos reales durante esta unidad.
No se hicieron instalaciones, commits, push, cambios de versión ni de dependencias.
`main`, `v1.4.0` y ambos Markdown protegidos permanecen intactos.

## Archivos del parche

- `docs/library-incomplete-restore.md`
- `mobile/modules/drop-library/ios/DropLibraryFileInspection.swift`
- `mobile/modules/drop-library/ios/DropLibraryModule.swift`
- `mobile/modules/drop-library/ios/DropLibraryStorage.swift`
- `mobile/modules/drop-library/tests/DropLibraryFileInspectionTests.swift`
- `mobile/modules/drop-playback/tests/PlaybackServiceTests.swift`
- `mobile/src/app/library.tsx`
- `mobile/src/app/player/[id].tsx`
- `mobile/src/app/queue.tsx`
- `mobile/src/components/LibraryItemRow.tsx`
- `mobile/src/hooks/useLibraryItemActions.ts`
- `mobile/src/models/library.ts`
- `mobile/src/services/collections.ts`
- `mobile/src/services/fileExport.ts`
- `mobile/src/services/library.ts`
- `mobile/src/utils/playbackContext.ts`
- `mobile/tests/collection-items-screen.test.tsx`
- `mobile/tests/collections.test.ts`
- `mobile/tests/file-export.test.ts`
- `mobile/tests/library-availability.test.ts`
- `mobile/tests/library-screen.test.tsx`
- `mobile/tests/library.test.ts`
- `mobile/tests/mini-player.test.tsx`
- `mobile/tests/playback-context.test.ts`
- `mobile/tests/playback-provider.test.tsx`
- `mobile/tests/player-screen.test.tsx`
- `mobile/tests/queue-screen.test.tsx`

## Revisión final de Unidad 1, sin compilación integrada

La auditoría detectó un caso límite verificable: un `pending` con tamaño esperado
cero y un destino no vacío pasaba a `ready` y reemplazaba ese tamaño esperado.
La nueva regresión SQLite falló antes de la corrección (1 FAIL) y pasó después.
Ahora se conserva ese registro y su archivo sin reescribirlos. No cambia schema.
Se ejecutó de nuevo la suite móvil completa (419 PASS, 1 omitida), las siete
suites Swift estrictas, TypeScript y ESLint. Los resultados físicos y la build
integrada continúan pendientes; no se accedió a aplicaciones del dispositivo.

## Procedimiento preparado para compilar el árbol exacto sin commit

**Solo procedimiento: no se ha creado el checkout ni ejecutado la build.**
El espacio medido en esta revisión es insuficiente para preparar dependencias.
La siguiente fase necesita autorización y una nueva medición tras resolver espacio.

1. Congelar la fuente en `fix/library-incomplete-restore`, base
   `7927dec6429bdc85fbc19082ad62c18de99ffa73`. Verificar de nuevo `git status`,
   rama, HEAD y `git diff --check`. Exigir exactamente los 23 archivos modificados
   y los cuatro nuevos enumerados en este documento; detenerse ante diferencias.
   Los dos Markdown protegidos no forman parte de esa lista.
2. Generar un manifiesto SHA-256 del contenido **de todos los archivos versionados
   actuales más los cuatro nuevos del parche**, con rutas relativas y permisos
   de ejecución. Registrar por separado la base Git y el digest del manifiesto.
   No incluir `.env` locales, archivos ignorados, dependencias, datos ni los dos
   documentos protegidos. El manifiesto se guarda fuera del checkout fuente.
3. Crear después un clon local temporal independiente, sin hardlinks, desde esa
   base (`git clone --no-hardlinks` y selección del commit solo en el clon).
   Sobreponer exclusivamente los 27 archivos de la lista mediante copia que
   preserve permisos. No usar stash, `git add`, commits temporales ni copiar el
   directorio completo de desarrollo. No copiar archivos desde el repo histórico.
4. Comparar hashes y permisos de **cada fuente del manifiesto** contra el clon;
   comprobar también la ausencia de ambos documentos protegidos y de extras
   fuente inesperados. El clon contendrá el parche sin commit: HEAD por sí solo
   no identifica la candidata; la identidad es base + manifiesto del árbol.
   Repetir la comparación del original y del clon antes y después de compilar.
   Cualquier variación invalida la candidata.
5. Desde `mobile/` del clon, usar Node fijado en `.nvmrc`, `/usr/bin/ruby`
   compatible y Bundler 2.4.22. Verificar las versiones y que los ejecutables
   `gem`, `bundle` y Ruby usan ese mismo intérprete, sin cambiar lockfiles.
   Establecer explícitamente:

   ```bash
   export DROP_BUNDLE_IDENTIFIER=com.odincarballo.drop.reprotest
   export DROP_DEVELOPMENT_TEAM=HK927RUDLZ
   export EXPO_PUBLIC_API_URL=https://mediadrop-api.onrender.com
   export EXPO_PUBLIC_APP_ENV=production
   export EXPO_NO_DOTENV=1
   ```

   No heredar tokens, secretos ni `.env` del proyecto estable. Validar la
   configuración con `node scripts/public_build_config.cjs`. La fuente debe
   seguir declarando versión `1.4.0`, build iOS `7` y Bundle ID dinámico.

6. Seguir la secuencia manual vigente del README y del script reproducible:
   `npm ci --no-audit --no-fund`, comprobación de política de tamaños con
   `node scripts/generate_download_size_policy.mjs --check`, runtime fijado con
   `node scripts/prepare_on_device_youtube.mjs`, Bundler 2.4.22 bajo
   `vendor/bundle` con `install --frozen`, Expo prebuild con
   `EXPO_USE_PRECOMPILED_MODULES=0`, configuración nativa con
   `scripts/configure_on_device_youtube.rb` y Pods usando `cocoapods_compat.rb`,
   `CP_HOME_DIR` propio y `RCT_SKIP_CACHES=1` como en el procedimiento versionado.
   Nada de esto se ha ejecutado para esta revisión. Medir espacio antes de las
   etapas pesadas y de Xcode; detenerse si el margen acordado no se mantiene.
7. Preferir la comprobación **sin firma Apple** documentada en
   `docs/reproducible-ios-release.md`. El script integral requiere firma y no
   tiene un modo sin firma que deba inventarse. Resolver workspace y scheme con
   el script existente; ejecutar solo en el clon:

   ```bash
   workspace="$(bundle _2.4.22_ exec ruby scripts/ios_application_project.rb --workspace)"
   scheme="$(bundle _2.4.22_ exec ruby scripts/ios_application_project.rb --scheme)"
   set -o pipefail
   EXPO_USE_PRECOMPILED_MODULES=0 NODE_ENV=production EXPO_PUBLIC_APP_ENV=production \
     xcodebuild -workspace "$workspace" -scheme "$scheme" \
     -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
     -derivedDataPath ios/build/unit1-unsigned -jobs 2 ARCHS=arm64 \
     CODE_SIGNING_ALLOWED=NO EXPANDED_CODE_SIGN_IDENTITY_NAME='Ad Hoc' \
     EXPANDED_CODE_SIGN_IDENTITY='-' build 2>&1 | tee ../unit1-build.log
   ```

   Las variables ad hoc son necesarias para extensiones Python/BeeWare; no
   convierten la app en una candidata instalable ni validan provisioning.

8. Exigir `BUILD SUCCEEDED`, ARM64, Info.plist con Bundle ID reprotest, versión
   1.4.0 y build 7, compilación de `DropLibraryModule` y del helper nuevo,
   inclusión por `ios/*.swift` y registro de `AsyncFunction("statPreparedSource")`
   consistente con el consumidor TypeScript. Guardar logs, toolchain, manifiesto
   y hash del ejecutable. **Compilar y registrar el método no prueba su invocación
   end-to-end desde JavaScript:** ese resultado exige una prueba física posterior
   autorizada con respaldo de reprotest. No instalar como parte de esta fase.

Si no se puede disponer del margen local requerido sin retirar recursos que se
necesitan, usar un volumen externo APFS con espacio suficiente para el clon,
Pods, runtime y DerivedData, o una Mac de build autorizada. Limitar `-jobs 2`
reduce presión de memoria; no sustituye el espacio de disco ni justifica afirmar
que una build integrada pasó. Evitar descargar un runtime de simulador: el destino
es dispositivo físico genérico.
