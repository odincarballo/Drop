# Descargas persistentes · Bloque A

Base `0e2d1ccbfc604263cc74f17e583d955c101b3d2f`. El propietario sigue siendo
DownloadSessionProvider. El alcance termina en recuperar estado y ofrecer
acciones explícitas. El guardado recuperado corresponde al Bloque B.

- SQLite independiente en `drop-downloads.sqlite`, con `user_version=1`.
  La tabla `download_attempt` admite una fila (`slot=1`) y guarda el ID,
  la generación y un payload JSON versionado y validado. El payload conserva
  origen, selección mínima, estado, fase, progreso anterior, código de error
  cerrado e ID remoto cuando existe. La base de Biblioteca queda en v5.
- El repositorio serializa las operaciones en una conexión dedicada. Reserva,
  actualización y borrado usan `BEGIN IMMEDIATE` y confirman antes de publicar
  su resultado. Las escrituras sobre un registro existente comparan ID y
  generación. Un intento pendiente impide otro inicio de cualquiera de los
  motores. Un reintento explícito desde cero obtiene un ID propio.
- La reserva se confirma antes del POST o del inicio nativo. Si falla
  la escritura, el rollback conserva el último estado confirmado. No se migra
  el registro experimental de AsyncStorage.
- Antes de reservar se captura la generación de primer plano. Después de
  confirmar y comprobar ID y generación de la fila, una transición de ciclo
  de vida invalida el inicio aunque Drop ya haya vuelto a estar activo.
  En iOS, YouTube valida de nuevo el estado y su generación nativa en la cola
  principal que procesa la salida a segundo plano. El POST directo comprueba
  la generación también después de obtener la credencial, antes de enviar.
  Si se impide el inicio, se registra una interrupción y se muestra solo
  tras confirmar SQLite. Si falla esa escritura, queda el estado confirmado
  anterior y se muestra un aviso seguro. Volver a primer plano no reintenta.
- Tras inicializar el almacén, la hidratación solo lee el registro. Un intento
  pendiente aparece interrumpido, con progreso histórico. Una fila inválida se
  omite. Un fallo de lectura impide nuevos inicios hasta volver a leer el almacén.
- Un job directo conocido se consulta bajo una acción explícita. Un resultado
  completado se informa como reportado por el servidor. Un job ausente o vencido
  requiere un enlace nuevo. Si faltaba el ID se explica la incertidumbre. Las
  consultas de recuperación no crean jobs, transfieren ni guardan archivos.
- YouTube guarda el ID canónico, el modo y los identificadores seguros de
  formato. Reintentar vuelve a analizar el enlace canónico bajo una acción
  explícita. Descargar requiere una nueva confirmación tras el análisis.
- Cancelar confirma primero una marca durable y una nueva generación. Si falla
  la transacción, la operación sigue activa y se puede intentar cancelar de
  nuevo. Un callback obsoleto no reactiva el intento. Guardar marca el límite
  de cancelación del flujo vivo. Descartar invalida el registro sin tocar
  archivos de Biblioteca.
- Un pegado pendiente impide iniciar una descarga. Reemplazar la entrada
  invalida la solicitud de pegado. Al recibir el resultado se comprueba que
  sigue vigente y que la sesión admite cambios.
- Credenciales, mensajes externos, URLs, cabeceras, rutas y parciales quedan
  fuera del registro. Las rutas de recuperación muestran textos cerrados y la
  limpieza emite códigos fijos. El flujo de Cola queda intacto.

## RED → GREEN

Sembrar un registro y montar un nuevo proveedor para cubrir la interrupción,
el progreso histórico, el job existente y el caducado, la creación incierta,
la marca de cancelación y el registro incompleto o corrupto. Comprobar que la
restauración no crea jobs ni publica elementos. Forzar cancelación antes de que
responda un POST y comprobar el orden durable y el aislamiento de callbacks.
Usar entradas con parámetros privados para verificar la lista cerrada de datos
almacenados. Reutilizar las pruebas de navegación, Biblioteca y Cola afectadas.

La revisión A.1 reprodujo seis casos RED. La validación focal posterior pasó
120 pruebas en seis suites. El harness de persistencia provoca un fallo real
de SQLite en COMMIT y comprueba rollback, lectura, reapertura y reintento.
Las pruebas de integración difieren la respuesta del portapapeles y hacen
competir ambos motores. La validación física sigue pendiente. El registro
recupera el estado del intento. La recuperación de archivos completos y la
reanudación de bytes pertenecen a otros bloques.
