# Drop v1.1.0 — resiliencia acotada de descargas YouTube

Esta rama añade reintentos únicamente a las transferencias YouTube con respuesta
HTTP 206 por rangos: Solo video, Solo audio y Video + audio. No cambia el análisis,
los recursos directos, los límites de 50/25 MiB, el mux ni la normalización M4A.

- Hasta dos reintentos adicionales por rango y cuatro por trabajo. Video y audio
  de un mismo trabajo combinado comparten los cuatro.
- La primera entrada a retry inicia un presupuesto monotónico de 30 segundos.
  Incluye backoff e intentos de recuperación, pero no sustituye los timeouts
  normales. Backoff cancelable: 0,5 s y 1,5 s. Un 503 puede indicar un
  `Retry-After` numérico o fecha HTTP estrictamente válidos; si excede el
  presupuesto, falla sin reintentar antes de lo solicitado.
- HTTP reintentable: 408, 500, 502, 503 y 504. Transporte reintentable:
  `NSURLErrorTimedOut` (-1001), `NSURLErrorCannotConnectToHost` (-1004),
  `NSURLErrorNetworkConnectionLost` (-1005) y
  `NSURLErrorNotConnectedToInternet` (-1009). También se reintenta un cuerpo
  206 verificado que termina antes de completar el rango anunciado.
- No se reintentan 403, 416, 429, 501, 505, errores TLS/certificado,
  cancelación, fallos de integridad/MIME/tamaño ni `*_DNS_INVALID`.
  Los fallos DNS aún no se separan con certeza entre resolución transitoria y
  rechazo de seguridad; retry DNS queda pendiente. Las comprobaciones de IP
  pública y SSRF no se relajan.
- Antes de repetir un rango, el parcial se trunca al último offset cuyos bytes
  constituyen rangos completos. Se repite el mismo rango y URL de trabajo,
  exigiendo otra vez 206, MIME, `Content-Range`, tamaño total y límite por
  pista. Si el servidor proporciona ETag fuerte, debe permanecer idéntico.
  Sin un validador fuerte no es posible demostrar identidad absoluta del
  recurso solamente con longitud y `Content-Range`.
- El fallback 200 inicial permanece como en v1.0.1. Un cuerpo 200 parcial no
  se reanuda ni se combina con otro cuerpo. No hay reextracción de URL firmada
  a mitad de transferencia ni reintento automático de 403.
- Los detalles técnicos reciben solamente fase/categoría y datos controlados:
  código de transporte permitido, estado HTTP si existió, rango/índice,
  offset verificado, intento, reintentos globales, tiempo restante, host
  `googlevideo.com` validado y longitud/rango de respuesta validados. No se
  envían URL, query, ETag, cookies ni headers arbitrarios a React Native.

Las pruebas automatizadas usan un `URLProtocol` simulado contra el manager
real para comprobar respuestas parciales, retries, cancelación, presupuesto
compartido y ausencia de bytes duplicados.

## Validación física en iPhone

1. Descarga normal: correcta.
2. Cambio de Wi-Fi a datos móviles: la descarga se recuperó. En una prueba se
   mostró «Problema de conexión. Reintentando…».
3. Cambio de Wi-Fi a datos móviles y de vuelta a Wi-Fi: la descarga continuó
   sin reinicio manual y recuperó velocidad al volver a Wi-Fi.
4. Video + audio 360p durante un cambio de red: archivo completo, sin
   corrupción ni pérdida de sincronización.
5. Pérdida total de conexión: fallo controlado, sin publicar un archivo
   incompleto. Se observó `AUDIO_CONNECTION_RETRIES_EXHAUSTED` en el rango 21,
   intento 3, offset verificado 5 242 880 bytes, 2 retries globales usados,
   27 s de presupuesto restante, transporte `-1009` y status HTTP no
   disponible. Se agotaron los **2 retries de ese rango**; no se agotó el
   límite global de **4 retries por trabajo**.
6. Nuevo intento tras restaurar la conexión: descarga completa, audio y
   duración correctos.

La validación física cubre estos casos observados, no todos los estados HTTP
ni todas las interrupciones simuladas en las pruebas automatizadas.
