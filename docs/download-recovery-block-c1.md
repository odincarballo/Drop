# Descargas persistentes · C.1 · contrato del archivo final

Base: `16de8d2638d088f92b8d0c343cc1642e363bb25e`. El alcance es el archivo
final de un job del backend, servido al cliente autenticado.

## Contrato y criterios de aceptación

- Antes de anunciar `COMPLETED`, el backend calcula una vez SHA-256 sobre
  los bytes del resultado final, después de cualquier conversión o mux.
  El resultado del job conserva tamaño, nombre, MIME y hash. El job no
  reemplaza ni vuelve a generar ese archivo. En la misma pasada registra un
  SHA-256 por bloque alineado de 256 KiB, en memoria. Al servir, valida el
  descriptor abierto antes de enviar cabeceras y comprueba cada bloque antes
  de entregar sus bytes desde ese mismo archivo abierto. Un cambio detectado
  antes de las cabeceras devuelve `404 FILE_EXPIRED`. Si se detecta durante
  el cuerpo, la transferencia termina incompleta y nunca entrega el bloque
  alterado. Sustituir la ruta no cambia el descriptor de una lectura admitida.
- `GET /jobs/{id}` conserva el contrato anterior y añade `fileSha256`
  (hexadecimal en minúsculas) y `fileContentType`. Ambos son nulos mientras
  no exista un resultado completado. `fileSize` sigue siendo el tamaño
  de la representación completa y `downloadUrl` mantiene la ruta actual.
- `GET /jobs/{id}/file` conserva autenticación, tipo, nombre de archivo,
  política de caché y respuesta completa `200`. Usa el ETag fuerte
  `"sha256-<fileSha256>"`. Un rango de bytes válido con un `If-Range`
  coincidente devuelve `206` con `Content-Range` y longitud del fragmento.
  Un validador distinto, débil o basado en fecha produce una respuesta
  completa `200`. Solo el ETag fuerte permite condicionar una continuación.
  Un rango sintácticamente inválido devuelve `400`, y un rango fuera del
  archivo, `416` con el tamaño total. Se valida el conjunto entero, incluidos
  rangos múltiples. C consume rangos simples sobre bytes sin compresión;
  el hash anunciado corresponde al archivo completo.
- El TTL configurado se mide desde la finalización del job. Una vez
  vencido se rechazan nuevas lecturas, aunque la limpieza no haya pasado.
  `FILE_EXPIRED` y `JOB_NOT_FOUND` son resultados `404` esperados.
  Una lectura ya admitida mantiene su archivo hasta terminar o fallar.
  Cancelar impide nuevas lecturas y difiere el borrado mientras haya una
  respuesta activa. El barrido de archivos huérfanos también respeta los
  espacios que pertenecen a jobs vivos en el proceso.
- El cliente anterior puede seguir consultando y descargando sin enviar
  cabeceras de rango. El hash se verifica en el cliente cuando se
  implemente C.2 y el transporte correspondiente. Un `200` nunca se
  tratará como continuación. Los jobs siguen siendo locales al proceso y
  no se recuperan tras un reinicio del backend.

## RED → GREEN

Usar Starlette fijado en `backend/uv.lock` y un servidor HTTP local con
artefactos sintéticos. Probar GET completo, rangos, validadores diferentes,
expiración, cancelación, integridad y clientes previos. Pausar una respuesta
con una barrera determinista y ejecutar ambos recolectores antes de
reanudarla. Verificar también la liberación de la lectura ante un error de
envío. Render y sus intermediarios se validarán por separado.

Las regresiones de la revisión sustituyen la ruta en el envío de cabeceras,
sobrescriben y truncan el inode después del primer bloque, y comprueban
rangos malformados, sufijos y respuestas multipartes. Una cancelación
durante una lectura libera la reserva y el descriptor de la respuesta.
El trabajador conserva su descriptor duplicado hasta que termina la
lectura del bloque y lo cierra aunque el cliente ya se haya desconectado.
