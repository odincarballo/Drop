# Drop: reglas de trabajo

- Lee [el estado operativo](docs/engineering-state.md) y verifica Git antes de
  actuar. Git y los manifiestos prevalecen sobre notas históricas.
- Sigue [el workflow](docs/engineering-workflow.md); los comandos vigentes viven
  allí y en los scripts existentes. No reconstruyas contexto ya registrado.
- Trabaja en una rama/worktree aislado. Conserva los cambios ajenos y los dos
  Markdown locales protegidos; no copies el árbol instrumentado a producción.
- Mantén producción e instrumentación en worktrees distintos. Una candidata se
  identifica por fuentes, configuración, dependencias, herramientas y hashes,
  además de su commit. Desactivar un flag no demuestra exclusión.
- Reutiliza resultados solo tras verificar sus entradas y evidencia de ejecución.
  Repite lo afectado por cambios reales o incertidumbre concreta. No declares
  PASS por la mera existencia de un test, manifiesto o archivo de app.
- Usa validación proporcional al riesgo. Conserva logs completos y comunica un
  resumen con resultados, cambios y bloqueos; evita salidas masivas repetidas.
- Avanza dentro del bloque ya autorizado. No vuelvas a pedir el mismo permiso.
  Commit, push, merge, tags, Release, cambios de cuenta/firma y operaciones sobre
  dispositivos requieren el alcance autorizado correspondiente; no los infieras.
- `com.odincarballo.mediadrop` y sus datos están protegidos. Reprotest también
  requiere autorización expresa para instalar o modificar datos. No desinstales,
  resetees ni restaures automáticamente; verifica backup consistente primero.
- No uses reset, clean, stash ni limpiezas destructivas implícitas. No cambies
  reglas, versiones o dependencias para ocultar errores. Documenta discrepancias.
- Archiva y verifica artefactos/logs antes de retirar su entorno. El supervisor
  no elimina nada. No guardes credenciales, perfiles, datos privados o backups
  en Git; las evidencias operativas viven fuera del checkout y de `/tmp`.
- Al cerrar o interrumpir un bloque, actualiza el estado compacto y registra solo
  los incidentes de eficiencia relevantes. No inicies el bloque siguiente solo.
