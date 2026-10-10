# Drop: Release iOS desde checkout limpio

Partir de un clon o worktree temporal sin `mobile/ios`, `node_modules`, Pods,
`vendor` ni DerivedData. La Mac necesita Xcode con licencia aceptada, Node según
`mobile/.nvmrc`, Ruby 2.6–3.1, Bundler 2.4.22, acceso a Internet y una identidad
de firma válida del Team elegido por quien construye la app. El lock actual
incluye `CFPropertyList` 3.0.9, incompatible con Ruby 3.2 o superior: comprobar
`ruby --version` y seleccionar un intérprete compatible antes del bootstrap.
La identidad y el perfil de Apple no se guardan en Git.

Definir explícitamente los valores propios antes de compilar. La URL debe ser
el origen HTTPS de un backend bajo control del fork; no usar la URL de ejemplo.
Desde `mobile/`:

```bash
export DROP_DEVELOPMENT_TEAM='<TU_TEAM_ID>'
export DROP_BUNDLE_IDENTIFIER='<TU_BUNDLE_ID>'
export EXPO_PUBLIC_API_URL='<TU_BACKEND_HTTPS_ORIGIN>'
bash scripts/build_release_from_clean_checkout.sh
```

El script comprueba que no hay artefactos ni `.env` ignorados, ejecuta `npm ci`,
descarga y verifica las dependencias fijadas del motor, instala Bundler 2.4.22
si falta, e instala las gemas de `Gemfile.lock` bajo `mobile/vendor/bundle`.
Después genera `ios/` con Expo, configura el target de aplicación que corresponda
al Bundle ID resuelto por `mobile/app.config.js`, instala Pods con `bundle exec` y compila Release ARM64
con un DerivedData nuevo en `ios/build/clean-release`.
La instalación de Pods usa su propio `mobile/.cocoapods` y desactiva la caché
compartida de frameworks de React Native; no se apoya en descargas previas de
la Mac.
`mobile/ios/Podfile.lock` se genera dentro de un directorio ignorado y no se
versiona. Una instalación limpia de Pods demuestra que sus dependencias se
resuelven hoy, no que dos instalaciones futuras produzcan un grafo idéntico.

`.env.production.example` es solo una plantilla y **no se carga** en Release.
El script exige Team, Bundle ID y URL de backend explícitos, rechaza ejemplos
y valida la URL antes de instalar dependencias. Establece
`EXPO_PUBLIC_APP_ENV=production`; conserva los timeouts y la frecuencia de
consulta existentes salvo configuración explícita. El análisis y la descarga
de YouTube siguen siendo on-device. No se versiona ni se necesita un Bearer token para compilar;
el token de uso de recursos directos permanece en SecureStore del dispositivo.

El destino predeterminado es `generic/platform=iOS`. Para firmar contra un iPhone
de desarrollo específico, definir `DROP_IOS_DESTINATION` con su identificador
Xcode. `DROP_DEVELOPMENT_TEAM` no tiene fallback al Team original. Quien deba
actualizar la instalación original de Drop debe indicar explícitamente su Team
y Bundle ID originales en su entorno local. Ninguna de esas variables contiene
credenciales.

El script no instala la app ni borra un proyecto iOS existente. Si falta la
identidad o el perfil de firma, Xcode debe fallar con su error de firma; no se
reemplaza por material privado versionado.

## Comprobación de compilación sin firma de Apple

Para comprobar la compilación en un checkout limpio sin un Apple Team real,
seguir los pasos manuales del README hasta terminar `pod install`, con un
Bundle ID distinto del de Drop y un origen HTTPS de prueba. Después, desde
`mobile/`, ejecutar:

```bash
EXPO_USE_PRECOMPILED_MODULES=0 NODE_ENV=production EXPO_PUBLIC_APP_ENV=production \
  xcodebuild -workspace ios/Drop.xcworkspace -scheme Drop \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build/clean-release CODE_SIGNING_ALLOWED=NO \
  EXPANDED_CODE_SIGN_IDENTITY_NAME='Ad Hoc' \
  EXPANDED_CODE_SIGN_IDENTITY='-' build
```

El empaquetado de BeeWare firma ad hoc los frameworks de extensión de Python;
por eso necesita esas dos variables incluso cuando la firma de la app está
desactivada. El resultado **no es instalable en iPhone** y no verifica la firma
real ni el script integral `build_release_from_clean_checkout.sh`, que requiere
un Team y un perfil propios. Una URL de prueba solo demuestra que la
configuración se propaga: no verifica un backend Drop operativo.

## Referencia histórica: candidata 1.0.1

Para la Release Candidate 1.0.1, generar el checkout limpio desde el **HEAD
final ya confirmado** de `feature/v1.0.1-reliability`, no desde el directorio
de desarrollo con cambios pendientes. Verificar en `Drop.app/Info.plist`:
`CFBundleDisplayName=Drop`, `CFBundleShortVersionString=1.0.1`,
`CFBundleVersion=2` y `CFBundleIdentifier=com.odincarballo.mediadrop`.
Comprobar además firma `HK927RUDLZ`, arquitectura ARM64 y presencia de Hermes,
CPython 3.13.15, yt-dlp 2026.08.19, QuickJS-NG 0.16.2 y los módulos
`on-device-youtube` y `drop-file-export`. No instalar ni etiquetar esta build
como `v1.0.1` antes de aprobar la Release Candidate.

## Referencia histórica: candidata v1.1.0 build 3

La fuente de verdad del versionado iOS es `mobile/app.json`: `version=1.1.0`,
`ios.buildNumber=3`; el Bundle ID actual se resuelve por `mobile/app.config.js`.
`mobile/package.json` y la entrada raíz de
`mobile/package-lock.json` deben conservar la misma versión del paquete. No
editar `mobile/ios` manualmente: Expo genera ese directorio desde la
configuración versionada en el checkout aislado.

Preparar el checkout aislado con **todos los archivos fuente del árbol actual**,
incluidos los cambios aún sin commit, y comprobar su igualdad byte por byte
antes y después de compilar. Ejecutar allí el script anterior. La Release debe
terminar en `BUILD SUCCEEDED`; comprobar arquitectura ARM64, firma válida del
Team `HK927RUDLZ`, `CFBundleIdentifier=com.odincarballo.mediadrop`,
`CFBundleShortVersionString=1.1.0` y `CFBundleVersion=3` en el `Info.plist` de
la `Drop.app` resultante. Registrar SHA-256 de `Drop.app/Drop` y conservar app y
log para la validación física.

Estas instrucciones registran el checkpoint de aquella candidata y no son el
procedimiento vigente de publicación pública. El temporizador de apagado
quedó fuera de v1.1.0.
