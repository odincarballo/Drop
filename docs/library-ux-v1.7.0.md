# Drop 1.7.0 — Especificación UX/UI de Biblioteca

Estado: contrato aprobado; sin implementación ni validación de 1.7.0.
Base: v1.6.0, `77f87b352ec9738bc57a5ac0579572d392582409`.
Rama: `codex/v1.7.0-library-ux`. No cambia versión ni build en este bloque.

## Objetivo y composición

Reducir la competencia entre controles sin reconstruir Biblioteca ni sus tarjetas.
Un único título principal **Biblioteca**, con accesos existentes a Cola y Ajustes.
Debajo: pestañas visibles **Archivos / Colecciones**. Cambia la etiqueta de
Descargas, sin cambiar sus rutas ni el identificador interno de sección.
En Archivos: **Buscar en Biblioteca**, filtros **Todos / Video / Audio**, selector
lista/cuadrícula y botón **Orden: [criterio actual]**. Conteo discreto
**N visibles de M archivos**; M representa el snapshot completo y N el resultado
combinado de búsqueda y filtro. Carga y error no se presentan como conteos
confirmados de cero; una Biblioteca cargada y vacía sí puede mostrar cero archivos. La sección Colecciones conserva su funcionamiento; los
controles de archivos no se aplican a colecciones.

La información de almacenamiento es secundaria y usa los totales ya calculados
sobre el snapshot completo de archivos, no los resultados filtrados. No se
presenta como espacio libre del iPhone ni exige nuevas consultas físicas.
Se conservan las tarjetas compactas, portadas, acciones y confirmaciones actuales.
Controles agrupados con ajuste de líneas/ancho; ningún alto fijo debe recortar
texto ampliado. Se admite crecimiento vertical y desplazamiento, sin posiciones
absolutas ni nuevos encabezados duplicados. No se añade una navegación paralela.

## Contratos y aceptación funcional

- Un solo snapshot alimenta ambas vistas, búsqueda y filtros. Se conservan la
  normalización y coincidencia de todas las palabras existentes, sin lecturas de
  SQLite ni comprobaciones físicas por carácter. Ninguna interacción duplica datos.
- El botón Orden abre el patrón nativo iOS ya utilizado: seis opciones y Cancelar.
  Expone el criterio actual en el botón y en el menú; Cancelar no modifica nada.
  No se mantienen además los seis botones de ordenamiento desplegados.
- Opciones y algoritmos de `libraryQuery` sin cambios:

  | Opción | Contrato existente |
  | --- | --- |
  | Más recientes | Fecha descendente; desempate por ID descendente |
  | Más antiguos | Fecha ascendente; desempate por ID ascendente |
  | Título A–Z | Título normalizado ascendente; desempate por más reciente |
  | Título Z–A | Título normalizado descendente; desempate por más reciente |
  | Duración ascendente | Duración ascendente; desempate por más reciente |
  | Duración descendente | Duración descendente; desempate por más reciente |

  Duraciones desconocidas al final en ambas direcciones. Se conserva la
  normalización actual; no se sustituye por una nueva comparación de títulos.
- Reproducir explícitamente conserva el orden visible de los elementos
  reproducibles y las guardas de disponibilidad existentes. Buscar, filtrar,
  ordenar o cambiar de vista no inicia ni modifica una sesión activa.
- Lista/cuadrícula se conserva al navegar al reproductor y otras rutas y regresar,
  usando el único `LibraryViewProvider` estable existente.
- Única preferencia nueva: lista/cuadrícula mediante AsyncStorage ya instalado,
  clave independiente `drop.library.view.v1`, valores válidos `list` / `grid`.
  Sin preferencia, valor inválido o error de lectura: lista. No se persisten
  búsqueda, filtros, ordenamiento ni desplazamiento; se conserva su contrato actual.
- La hidratación no bloquea reproducción, descargas ni navegación. Una selección
  explícita actualiza inmediatamente la UI y prevalece sobre una lectura tardía.
  No escribir el valor inicial antes de resolver la lectura. Serializar o coordinar
  escrituras para que, cuando tienen éxito, la última selección sea la almacenada,
  aunque cambien rápidamente. Un fallo no rompe la UI ni se declara guardado;
  la siguiente selección puede intentar guardarse. Evitar callbacks obsoletos al
  desmontar el propietario. No añadir otro provider o sistema de preferencias.
- No modificar SQLite, LibraryItem, motores, descargas, Manual Queue ni contratos
  nativos. No introducir dependencias ni persistencia permanente adicional.

## Accesibilidad y estados

Controles modificados con etiquetas VoiceOver, estado seleccionado y objetivos
interactivos de al menos 44 × 44 puntos. Lista/cuadrícula identificables sin
requerir color. Conservar temas claro, oscuro y sistema, contraste legible,
Dynamic Type, títulos largos y pantallas pequeñas. Compactar no oculta acciones.
El menú debe permitir descubrir todas las opciones, cancelar y recuperar el foco.
Buscar mantiene edición, limpieza accesible y manejo del teclado sin superponer
controles ni cambiar innecesariamente el foco al filtrar. Conservar los estados
separados de carga, error, Biblioteca vacía y búsqueda sin resultados.
Las pruebas host de etiquetas no acreditan VoiceOver ni disposición física.

## Bloques y matriz SDD + TDD

| Bloque | Criterios verificables | Evidencia reutilizada y casos imprescindibles |
| --- | --- | --- |
| A — Composición | Un título; accesos y pestañas conservados; buscador, filtros, conteo y Orden presentes en ambas vistas; seis opciones y cancelar sin mutación | Adaptar `library-screen.test.tsx`: composición, selección/cancelación del menú, criterio actual, conteos filtrados y estados. Reutilizar casos de búsqueda/filtros/contexto y `library-query.test.ts` para algoritmos sin cambios. Pruebas de rutas afectadas de `main-navigation.test.tsx`, sin duplicar motores. |
| B — Preferencia | Navegación conserva vista y un nuevo montaje recupera la elección; fallback seguro; última selección prevalece | Pruebas focales del provider con AsyncStorage simulado: ausencia, inválido, rechazo, lectura diferida con selección reciente, ausencia de escritura inicial, escrituras rápidas ordenadas, fallo de escritura y desmontaje. Adaptar el caso de navegación que antes esperaba lista tras un nuevo montaje. |
| C — Integrada en reprotest | Una candidata coherente conserva datos y permite comprobar UX real y persistencia | Reutilizar PASS de 1.6.0 solo donde las entradas relevantes sigan equivalentes. Verificar físicamente pantallas pequeñas, texto ampliado, temas, VoiceOver/foco, teclado, menú completo/cancelación, vistas durante navegación y tras reiniciar reprotest, y contexto de reproducción. No repetir descargas extensas ni pruebas ajenas. |

Aplicar TDD a los comportamientos nuevos: definir caso, comprobar fallo pertinente,
implementar mínimo y ejecutar pruebas directamente afectadas, tipos, lint, formato
focal y diff. Ninguna prueba se ejecuta en el Bloque 0. No sumar resultados históricos
solapados ni dar PASS físico a partir de mocks. Comparar criterios sobre datos
controlados; los órdenes de duración no se acreditan solo por observar sus botones.

## Cierre y límites

Bloque 0 listo cuando este contrato y el [estado operativo](engineering-state.md)
sean coherentes y estén aprobados. No hay decisiones bloqueantes pendientes.
Implementación A/B, commits, compilación e instalación requieren su autorización
correspondiente. C usará reprotest existente, con protección de sus datos; no crea
una tercera identidad. No modifica la original como parte de esa validación.
Las mejoras futuras de tarjetas, desplazamiento o motores quedan fuera de alcance.
