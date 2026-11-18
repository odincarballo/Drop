# Descargas persistentes · C.3 · transferencia directa y publicación

Base `81df1925812b1ae4629ef987a7e51c4787f292ed`. El alcance es la
transferencia directa en primer plano. YouTube local conserva su motor.

## Contrato

- Un job C.1 apto conserva su ID remoto, tamaño, SHA-256 y ETag fuerte
  derivado. Abrir Drop solo consulta y verifica el diario y el disco.
  Reanudar requiere una acción explícita y confirma el job de nuevo
  antes de solicitar los bytes pendientes. Un checkpoint local completo
  y verificado con comprobante de publicación confirmado puede pasar a
  Biblioteca sin consultar el servidor.
- Cada GET pide un rango simple de hasta 1 MiB, con `If-Range` y
  `Accept-Encoding: identity`. Se exige `206`, ETag exacto,
  `Content-Range` exacto, longitud y tipo esperados y codificación
  identidad. El cuerpo debe terminar en la longitud anunciada. Solo
  entonces se confirma el bloque en C.2. El siguiente GET espera SQLite.
  El último checkpoint exige el SHA-256 completo de C.1.
- Las respuestas incompatibles, los errores de disco y las interrupciones
  conservan el último checkpoint confirmado. Se cancela la petición activa
  al salir de primer plano. La cancelación explícita inicial conserva el
  orden durable de A. Durante la reanudación, interrumpir conserva el
  checkpoint y descartar lo invalida explícitamente antes de limpiar.
  Una generación u offset obsoleto no puede confirmar bytes ni pasar a B.
- Un servidor anterior a C.1, un formato sin contrato o un tamaño por
  encima de la cuota utiliza la descarga convencional. Si una transferencia
  ya iniciada resulta incompatible, corrupta o queda sin espacio, se
  detiene y conserva la acción explícita de reintentar desde cero. Ese
  reintento solicita un nuevo enlace y usa el motor convencional.
  Ningún fallo inicia automáticamente otra transferencia. Los límites de
  C.2 se aplican exclusivamente a la persistencia de parciales.
- El último checkpoint confirma a la vez la intención y el comprobante
  estable de Biblioteca, manteniendo disponible el parcial completo. El
  almacén nativo verifica tamaño, SHA-256 y sello de C.2, sella el mismo
  inodo para B y lo mueve en el mismo volumen mediante renombrado
  exclusivo. La inspección de medios usa la extensión en staging antes
  de publicar en Biblioteca. Repetir la entrega tras un cierre puede
  reconocer el sello previo, el staging de B o el destino ya publicado.
  B conserva su protocolo `pending` → `ready`, su UUID y su comprobante
  de descarte. Al terminar, C.2 retira su checkpoint mediante el descarte
  existente. Biblioteca conserva SQLite v5.
- El descarte confirma su intención en SQLite antes de tocar el archivo.
  Si el archivo entregado por C está dañado en staging, se acredita su
  propiedad mediante los sellos de C y B, el ID y generación del intento
  y la identidad del inodo abierto. Se conserva en un directorio separado
  mediante renombrado exclusivo. Reabrir después del renombrado reconoce
  el archivo apartado, sincroniza los directorios y permite confirmar el
  descarte. Los objetos ajenos y los medios ya publicados se preservan.

## TDD

Servidor HTTP local controlado para respuestas de rango válidas, caída
entre peticiones, reapertura desde el último offset, validadores cambiantes,
200/416, cuerpos cortos, exceso de bytes, codificación, caducidad, cancelación
y omisión de capacidades en un backend anterior a C.1. SQLite y disco
aislados para los cortes entre reserva de handoff, sellado, staging y
publicación única de B. Probar acceso explícito a Reanudar, Reintentar y
Descartar. La ejecución física y las mediciones de red y disco quedan
pendientes.

## Verificación y límites

- RED conservado antes de crear el servicio de transferencia. Esa ejecución
  falló por la ausencia del módulo y todavía no ejecutó aserciones de red.
  Las ejecuciones intermedias y sus errores se conservan como evidencia.
- GREEN con un servidor HTTP limitado a localhost. Se verificaron 12 casos
  de rangos, interrupción y reanudación desde el checkpoint, cancelación,
  caducidad y rechazo de respuestas incompatibles. El cliente HTTP de las
  pruebas usa sockets Node como doble de `expo/fetch`. La API nativa Expo
  sigue pendiente de ejecución física.
- 186 pruebas móviles distintas acreditadas en ocho suites. Incluyen
  75 de Home, 15 del diario SQLite y la regresión de publicación,
  privacidad, estado, navegación y YouTube local. La prueba nueva del
  checkpoint final fuerza un fallo real de COMMIT, reabre SQLite y
  comprueba que ni el offset final ni el comprobante B se confirmaron.
  Las repeticiones focales se cuentan una sola vez.
- El harness `DropCompletedPartialTests.swift` usa un M4A sintético con
  AVFoundation y disco reales en macOS. Comprueba el mismo inodo desde C
  hasta B, la recuperación del sello previo al renombrado y la repetición
  de staging y publicación. Pasó con Swift 5 y Swift 6 estricto.
  El almacén pasó typecheck Swift 6 estricto para iOS 16.4 ARM64 y el
  bridge completo pasó en Swift 5 usando los módulos existentes.
- TypeScript, formato móvil y `git diff --check` pasaron. El lint focal
  pasó sin errores y conservó dos avisos previos por imports `require`
  de las pruebas. Las evidencias de C.1 y C.2 se conservan y la validación
  del backend en Render continúa pendiente.
- El formato o tamaño fuera del contrato conserva la vía convencional.
  Un fallo durante una transferencia recuperable exige una acción
  explícita para reintentar desde cero. No se cambian las cuotas de C.2.
  La versión anterior del backend usa la vía convencional al omitir los
  campos opcionales de integridad.
- Cada respuesta normal está limitada a un rango de 1 MiB antes de
  entregar bytes al bridge y esperar su checkpoint. Expo puede encolar
  datos nativos antes de que JavaScript consuma la respuesta. El máximo
  de memoria real, la latencia de los checkpoints y el rendimiento bajo
  carga requieren medición física. La comprobación de cabeceras aborta
  respuestas incompatibles y no acredita un límite absoluto de memoria
  frente a un servidor que incumpla su respuesta.
- Quedan pendientes la build integrada, las pruebas en iPhone, Render y
  las mediciones de rendimiento. El protocolo de segundo plano y
  YouTube local quedan fuera de C.3. No se ha cambiado el esquema v2 del
  diario ni el esquema v5 de Biblioteca.

## Corrección del descarte

- RED reprodujo el bloqueo al dañar el mismo inodo después de moverlo
  a staging. La validación rechazó la publicación y dos intentos de
  descarte dejaron ocupado el diario.
- GREEN en macOS con Swift 6 estricto y disco real. Siete casos
  comprobaron el traspaso normal y la reapertura tras sellar, el
  descarte de archivos alterados, truncados a cero o dañados en
  cuarentena previa, y la protección de un reemplazo o destino ajenos.
  Cada renombrado conserva el mismo archivo en el volumen. Los archivos
  apartados siguen ocupando espacio y pueden acumularse. Quedan fuera de
  la cuota de 100 MiB del parcial activo y reducen el espacio libre
  disponible. La retención carece de cuota propia y de limpieza automática.
- Dos regresiones nuevas con SQLite real simularon interrupciones
  después del renombrado y antes de confirmar el descarte en el diario.
  Las reaperturas permitieron terminar el descarte e iniciar otra
  descarga y conservaron la fila y el medio publicados anteriormente.
  Pasaron 48 pruebas focales y se reutilizaron las otras 140 acreditadas.
  TypeScript, lint focal y formato pasaron. Swift 5 para el bridge y
  Swift 6 estricto para el almacén pasaron typecheck en iOS 16.4 ARM64.
