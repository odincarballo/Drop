# Drop: Release iOS desde checkout limpio

Partir de un clon o worktree temporal sin `mobile/ios`, `node_modules`, Pods,
`vendor` ni DerivedData. La Mac necesita Xcode con licencia aceptada, Node según
`mobile/.nvmrc`, Ruby/RubyGems, acceso a Internet y una identidad de firma válida
del Team `HK927RUDLZ`. La identidad y el perfil de Apple son credenciales del
equipo de desarrollo: nunca se guardan en Git.

Desde `mobile/`:

```bash
bash scripts/build_release_from_clean_checkout.sh
```

El script comprueba que no hay artefactos ni `.env` ignorados, ejecuta `npm ci`,
descarga y verifica las dependencias fijadas del motor, instala Bundler 2.4.22
si falta, e instala las gemas de `Gemfile.lock` bajo `mobile/vendor/bundle`.
Después genera `ios/` con Expo, configura el target de aplicación que corresponda
al bundle ID versionado, instala Pods con `bundle exec` y compila Release ARM64
con un DerivedData nuevo en `ios/build/clean-release`.
La instalación de Pods usa su propio `mobile/.cocoapods` y desactiva la caché
compartida de frameworks de React Native; no se apoya en descargas previas de
la Mac.

Los valores públicos de producción se leen de `.env.production.example`:
`EXPO_PUBLIC_APP_ENV=production`, la URL HTTPS del backend para recursos directos,
timeout y frecuencia de consulta. El análisis y la descarga de YouTube siguen
siendo on-device. No se versiona ni se necesita un bearer token para compilar;
el token de uso de recursos directos permanece en SecureStore del dispositivo.

El destino predeterminado es `generic/platform=iOS`. Para firmar contra un iPhone
de desarrollo específico, definir `DROP_IOS_DESTINATION` con su identificador
Xcode. `DROP_DEVELOPMENT_TEAM` permite indicar el Team de firma; por defecto es
`HK927RUDLZ`. Ninguna de esas variables contiene credenciales.

El script no instala la app ni borra un proyecto iOS existente. Si falta la
identidad o el perfil de firma, Xcode debe fallar con su error de firma; no se
reemplaza por material privado versionado.

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

## Candidata v1.1.0 build 3

La fuente de verdad del versionado iOS es `mobile/app.json`: `version=1.1.0`,
`ios.buildNumber=3`. `mobile/package.json` y la entrada raíz de
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

Esta es una **candidata**, no una aprobación definitiva: no instalar, hacer
commit, push, merge, tag ni publicar una GitHub Release como parte de su
preparación. El temporizador de apagado queda fuera de v1.1.0.
