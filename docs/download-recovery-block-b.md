# Descargas persistentes · Bloque B

Base `38de0601b39b8d6cfb06fd90aac95186484ba467`. El flujo comprende
archivos completos de descarga directa y YouTube local. La restauración lee
el registro y ofrece una acción local de verificación y guardado. No
reinicia el motor ni solicita el archivo al servidor.

- Al comenzar el guardado, el registro del Bloque A confirma la propiedad
  del intento por ID y generación. SQLite v1 conserva el tamaño esperado y
  admite una prueba opcional de publicación. Un registro de A sigue siendo
  legible. La prueba contiene un UUID de Biblioteca, extensión, tamaño y
  SHA-256. No contiene rutas de origen, credenciales ni metadatos externos.
- El productor debe haber confirmado la finalización. El bridge comprueba
  la pertenencia al job, el tamaño esperado y el contenedor reproducible.
  Calcula SHA-256 por bloques sobre un descriptor de archivo regular y
  sella el objeto con un atributo extendido. El sello vincula ID y generación
  del intento, UUID del activo, extensión y SHA-256 con dispositivo, inodo,
  fecha de creación, tamaño y fecha de modificación. Se rechazan enlaces.
  Un renombrado exclusivo en el mismo volumen hace visible el objeto sellado
  en Application Support. La reapertura exige el sello y la identidad de
  disco aunque falte el comprobante SQLite. Si el cierre precede al
  renombrado, el archivo en caché queda fuera de la recuperación.
- La prueba se confirma antes de insertar la fila `pending` de Biblioteca.
  Se reutiliza el mismo UUID, con un marcador de staging en
  `sourceCacheRelativePath`. La reconciliación histórica preserva la fila
  y deja la verificación de estas descargas a su propietario. La publicación
  valida la identidad, mueve sin sobrescribir y calcula SHA-256 sobre el
  objeto en el destino. Una reserva nativa excluye los movimientos y borrados
  de Drop sobre ese destino hasta que concluya la transacción de Biblioteca.
  Dentro de la transacción se comprueba nuevamente la identidad y estabilidad
  del objeto antes de confirmar `ready`. Un fallo deja la fila en `pending`
  y el comprobante disponible. La reapertura después del movimiento verifica
  el mismo destino. Una fila `ready` se reconoce sin insertarla otra vez ni
  reparar sus datos.
- Los metadatos normales se conservan en el flujo vivo y desde `pending`.
  Si el cierre precede a `pending`, la recuperación usa un título genérico y
  el ID de video seguro cuando existe.
- La cancelación explícita que gana antes de la reserva de guardado invalida
  el resultado tardío. Después de reservar el guardado se conserva la
  frontera de cancelación de A. Guardar y descartar se serializan. El
  descarte confirma primero la intención en `drop-downloads.sqlite` por ID
  y generación. La reapertura presenta «Finalizar descarte» y deshabilita la
  recuperación. La limpieza mueve de forma exclusiva el temporal sellado a
  cuarentena, verifica allí su identidad y SHA-256 y lo retira bajo el mismo
  bloqueo de archivos. Ante una sustitución conserva el objeto. Una fila
  `pending` propia sin destino se retira en Biblioteca. Si ya hay un destino,
  se preservan tanto el archivo como su fila. Si se interrumpe la limpieza
  física, la retirada de `pending` o el cierre del intento, la intención
  persistida permite finalizar el descarte de forma idempotente.
- Un fallo de disco o SQLite deja el último estado confirmado. Los errores
  muestran mensajes seguros. Los archivos sin prueba, ausentes, con hash
  incorrecto o con un destino en colisión quedan sin publicar.
  Si falla la reserva de publicación directa, se conserva el archivo de
  caché y no se solicita el borrado del job remoto. Su vigencia sigue
  dependiendo del servidor. La coordinación de las dos bases es un
  protocolo de recuperación por estados y transacciones independientes.
  La reserva de archivo cubre los escritores de Drop. El SHA-256 acredita
  los bytes sellados y la inspección comprueba la estructura inicial del
  medio. La ejecución del bridge, el sello en el contenedor real, la
  reproducción completa y el cierre del proceso en iPhone quedan pendientes.

## Pruebas

SQLite real para ambos registros y fixtures de disco para los límites del
bridge. Forzar interrupciones antes y después de `pending`, después del
movimiento y al confirmar `ready`. Comprobar reapertura, rechazo de
corrupción del mismo tamaño, sustitución de inodo, exclusión de un
borrado concurrente, falta de espacio, cancelación y colisiones. Forzar
fallos de UPDATE y COMMIT antes de la limpieza, cierres después de
confirmar el descarte y durante su limpieza, y fallos al cerrar el
registro. Comprobar que otro UUID, otra generación, un enlace o un
nombre sin sello se preservan y que las reaperturas repiten el descarte
sin publicar ni iniciar transferencias.
