# Backend de pruebas para Drop reprotest

Esta configuración sirve tres enlaces sintéticos mediante el backend de C.1.
Los dos enlaces de C.4 usan la misma fixture M4A pequeña. El token, la URL
asignada y la evidencia de despliegue se conservan fuera de Git.

| Enlace que se pega en reprotest | Caso |
| --- | --- |
| `https://media.example.net/c4-synthetic.m4a` | Reanudación. El job trae SHA-256 y tipo; un GET con Range válido e If-Range fuerte devuelve 206. |
| `https://media.example.net/c4-performance-99mib.m4a` | Rendimiento. Los metadatos y los rangos siguen el contrato C.1. |
| `https://media.example.net/c4-legacy.m4a` | Descarga convencional automática. El job omite SHA-256 y tipo; el cliente solicita el archivo completo. |

Los dos enlaces de C.4 entregan 2 440 018 bytes con SHA-256
`76c73ce767d3cfa93778ccbd70fc250d1c5568a57ca3229f96de07a4be8ccaf6`.
La fixture es audio sintético de 96 segundos preparado para C.4.
En modo normal las rutas parciales incluyen una espera de tres segundos para facilitar
una interrupción controlada. El servicio rechaza enlaces ajenos y nunca
resuelve ni descarga contenido de Internet.

## Configuración de Render

- Workspace Hobby dedicado y sin medio de pago. Un Web Service Free.
- Fuente en una rama aislada de pruebas. Despliegues automáticos en **Off**.
- Runtime Docker. Contexto `./backend`, Dockerfile
  `./backend/Dockerfile.reprotest` relativo a la raíz del repo. Un worker,
  una instancia, puerto `PORT` de Render y health check `/ready`.
- Definir `MEDIADROP_API_TOKEN` como secreto de Render, único y aleatorio
  de al menos 32 caracteres. La comprobación `/ready` solo indica
  disponibilidad. Toda la API, incluido `/health`, requiere el token.
- Conservar la URL HTTPS administrada de Render. El Blueprint de producción
  permanece en su propio workspace y no se sincroniza para este servicio.

## Validación y mantenimiento

1. Antes de acudir al iPhone, despertar el servicio con `GET /ready`.
   Free puede dormir tras 15 minutos de inactividad y perder los jobs.
2. Conservar por sesión el commit desplegado y los estados HTTP. Verificar
   401 sin token, 206 con Range e If-Range en la fixture nominal, y
   200 sin Range en la fixture de compatibilidad. Validar tamaño y SHA del
   archivo reconstruido y del archivo completo.
3. Para C.4 usar únicamente reprotest. Tras autorizar por separado el
   cambio de origen, iniciar la prueba de compatibilidad con una sesión
   limpia. Analizar el segundo enlace y pulsar **Descargar** una vez. En
   Render, corroborar un GET sin rangos; en Biblioteca, una nueva entrada.
4. Para otras funciones, añadir fixtures sintéticas permitidas a la rama
   de pruebas y desplegar manualmente un SHA revisado en el mismo servicio.
   Mantener los secretos fuera de los logs. La auditoría registra ruta
   tipificada, ID del job, rango, validador, estado y bytes.

## Contrato de ampliación para rendimiento

- Admitir `c4-performance-99mib.m4a` (103 809 024 bytes, SHA-256
  `250bba1a0ff2f113e94a73d189a3eae16887d620406a0815ca7870419652cdb2`)
  junto a los dos enlaces existentes. Generarlo en la imagen de reprotest
  a partir de la fixture pequeña, añadiendo una caja MP4 `free` de ceros.
  Verificar tamaños y hashes y servir ambos archivos en bloques desde disco.
- El modo explícito `REPROTEST_PERFORMANCE=1` quita la espera artificial de
  tres segundos en rangos. El modo normal conserva la espera y el caso
  legacy conserva su respuesta convencional. Mantener el token, la lista
  cerrada de URLs y el límite de un job activo en ambos modos.
- En modo rendimiento, reservar 180 peticiones por 60 s y al menos 900 s
  de TTL desde la finalización. La transferencia grande necesita 99 rangos
  de 1 MiB y la pequeña necesita 3. Ejecutar un caso a la vez. Si ambos se
  completan en la misma ventana, quedarían 78 solicitudes para análisis,
  creación, consultas al job y demás comprobaciones. Espaciar esas
  consultas para no agotar el cupo.

**Estado local.** RED reprodujo el rechazo `FIXTURE_ONLY` para la fixture
grande. GREEN reconstruyó ambas fixtures con rangos e If-Range, comprobó
caducidad, autenticación, modo legacy y rechazo de una fixture alterada.
Tres casos pasaron. Evidencia en
`../Drop-reprotest-fixtures-evidence.GyyI7zEz/`. Empaquetado Docker y
validación HTTPS en Render pendientes de su propio alcance.
