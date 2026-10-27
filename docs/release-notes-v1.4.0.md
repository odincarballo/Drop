# Drop v1.4.0 build 7 — notas de la candidata

Preparación de candidata; no constituye una publicación estable ni una GitHub Release. El nuevo versionado 1.4.0 build 7 todavía requiere su propia compilación y verificación antes de instalarse.

## Manual Queue

- Cola manual persistente de ocurrencias pendientes, accesible desde Biblioteca y el reproductor.
- Añadir al principio o al final, reordenar, quitar una entrada o vaciar pendientes sin interrumpir CURRENT.
- Repeticiones independientes del mismo LibraryItem; una repetición manual A→A empieza desde 0:00.
- Integración nativa con un único AVQueuePlayer: CURRENT → Manual Queue → Playback Context. El avance nativo continúa sin JavaScript activo.
- Reproducción en segundo plano y PiP, manteniendo los mecanismos existentes de progreso, Now Playing y protección de archivos.
- SQLite conserva la cola; Swift prepara y consume la ocurrencia correspondiente cuando pasa a CURRENT. Un fallo de reconciliación posterior al commit se comunica como actualización pendiente, no como rollback del guardado.
- Migración aditiva de schema v2 a v3, sin duplicar medios ni alterar Library, Collections o sus memberships existentes.

## Validación y límites

El usuario reportó **15/15 pruebas físicas satisfactorias** del código funcional `6d800e051236342a589d007baf4cce411271ce43`, instalado en reprotest como **1.3.0 build 6**. D1/D2 comprobaron la compilación integrada y D2 verificó firma, migración y preservación de datos. La build 7 aún no hereda una validación de artefacto por ese hecho. Véase el [informe de validación física](manual-queue-v1.4.0-physical-validation.md).

Quedan pendientes VoiceOver, verificaciones físicas excepcionales de concurrencia y la candidata definitiva con el nuevo versionado. No se añaden Playlists, Shuffle, Repeat global, Next/Previous manual ni temporizador de apagado. No se anuncia distribución App Store/TestFlight.
