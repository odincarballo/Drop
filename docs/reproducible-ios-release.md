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
