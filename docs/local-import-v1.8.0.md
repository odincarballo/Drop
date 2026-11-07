# Drop 1.8.0 · Especificación de importación local

Estado: SDD listo para revisión. Base publicada: `v1.7.1`, build 16,
`0b1a0bc82d57c7f0ee616124a788816f7e5c6c57`. Esta documentación vive en
`codex/v1.8.0-local-import`. Reprotest 1.7.1 build 17 sigue siendo la
instalación del diagnóstico, cuyo código queda fuera de esta rama.
Siguiente paso sujeto a autorización: bloque A de la
[lista de tareas](local-import-tasks-v1.8.0.md).

## Alcance y experiencia

En la pestaña Biblioteca, el usuario elige **Importar archivo**. El selector
de Archivos permite elegir un archivo de audio o video. Drop muestra el estado
de la operación, prepara una copia privada y la incorpora a Biblioteca. El
archivo original sigue en su ubicación y conserva su contenido. Drop muestra
el nuevo elemento, pero deja la reproducción actual y la Cola como están.

El MVP admite un archivo por operación. Los candidatos son MP4 de video y
M4A o MP3 de audio, siempre que sean archivos completos, autocontenidos, sin
protección y reproducibles en el dispositivo con AVFoundation. El formato
admitido combina contenedor y contenido real. Un sufijo admitido por sí solo
no basta. AAC crudo, otros contenedores, importación múltiple, transcodificación,
edición avanzada, sincronización, importación automática y restauración de
respaldos quedan fuera del MVP.

Archivos puede ofrecer documentos en el iPhone, iCloud Drive o un proveedor
externo. Un documento remoto puede necesitar conexión para que su proveedor lo
entregue. Una vez confirmada la importación, la copia de Drop es reproducible
sin red ni acceso al proveedor, incluso después de cerrar y reabrir la app.

## Criterios de aceptación

| ID | Comportamiento observable |
| --- | --- |
| IMP-01 | Biblioteca abre el selector del sistema. Solo se admite una selección y una operación de importación a la vez. Cancelar el selector devuelve al usuario a Biblioteca sin crear datos ni mostrar un error. |
| IMP-02 | Un audio o video válido aparece una vez en Biblioteca después de confirmar la copia y su fila. Muestra título a partir del nombre del archivo, tipo detectado, duración válida y la portada genérica existente. La portada embebida no es necesaria en el MVP. |
| IMP-03 | La copia se conserva tras reiniciar y se reproduce sin conexión desde Biblioteca. El origen queda intacto. Drop no necesita volver a abrir ni conservar la URL de origen. |
| IMP-04 | Un permiso denegado, proveedor no disponible, archivo desaparecido, formato incompatible, archivo vacío o corrupto, falta de espacio o fallo de persistencia recibe un mensaje comprensible y permite volver a Biblioteca. |
| IMP-05 | Durante la copia se muestra progreso si el tamaño es fiable y un estado indeterminado mientras el proveedor prepara el archivo. Se puede cancelar hasta el inicio de la confirmación. Después se muestra **Guardando en Biblioteca**. VoiceOver anuncia el estado y la acción disponible sin leer cada avance. |
| IMP-06 | Un fallo o cierre durante la copia no publica archivos parciales. Tras el inicio de la confirmación, Drop recupera el mismo elemento si tiene una copia válida o deja un fallo recuperable. No crea otro registro al reanudar la confirmación. |
| IMP-07 | Importar dos veces de forma deliberada crea dos elementos independientes. Dos archivos con el mismo nombre no se sobrescriben. Una pulsación duplicada o una respuesta tardía del selector no crea una segunda importación. |
| IMP-08 | Tras actualizar desde una Biblioteca anterior, se mantienen elementos, rutas, identificadores, progreso, portadas, colecciones y orden de la Cola. Una migración fallida deja el esquema anterior íntegro. Un esquema desconocido se rechaza sin repararlo. |
| IMP-09 | Los importados son elegibles para el respaldo ordinario de iOS. La interfaz aconseja conservar el original y ofrece la exportación a Archivos que ya existe. La elegibilidad depende de la configuración y el resultado del respaldo del usuario. |
| IMP-10 | La nueva fila sigue los filtros y el orden de Biblioteca. Si un filtro la oculta, el mensaje de éxito lo indica sin cambiar filtros, pestañas o modo lista/cuadrícula. |

## Duplicados y copias de seguridad

El nombre y el tamaño no identifican contenido. Un hash de todo el archivo
podría detectar coincidencias byte a byte, pero exigiría comparar también con
medios anteriores y decidir qué hacer con cada coincidencia. El MVP preserva
cada selección intencional como una copia con UUID propio y protege la
operación individual frente a doble envío. El título de dos registros puede
coincidir.

La copia importada puede terminar siendo la única que el usuario conserve.
Separarla de las descargas excluidas del respaldo evita que herede esa
exclusión. El respaldo portable y su restauración quedan para 1.9.0
provisional. La exportación individual ya disponible sirve para guardar otra
copia, sin prometer recuperación de Biblioteca completa.

## Referencias

[Plan técnico](local-import-plan-v1.8.0.md) ·
[Tareas y pruebas](local-import-tasks-v1.8.0.md) ·
[Respaldo de datos de apps en iOS](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup)
