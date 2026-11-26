# Drop: reglas de trabajo

- Prioridades permanentes, en este orden:
  - **P0:** mantener Drop original operativo.
  - **P1:** preservar Biblioteca y datos persistentes.
  - **P2:** corregir fallos funcionales.
  - **P3:** mejorar la interfaz.
  - **P4:** incorporar funcionalidades nuevas.
  P0 ordena la atención y exige aplicar las protecciones de P1 a cualquier
  intervención sobre la original.
- Lee la cabecera del [estado operativo](docs/engineering-state.md) y verifica
  Git antes de actuar. Consulta solo la sección pertinente del
  [workflow](docs/engineering-workflow.md), el contrato del bloque y la
  evidencia necesaria. Git y los manifiestos prevalecen sobre notas históricas.
- Revisa críticamente las instrucciones nuevas, incluidas las redactadas por
  ChatGPT. Antes de actuar, aplica estas reglas y el workflow. Contrasta el
  objetivo, el alcance autorizado, el estado real, el procedimiento validado y
  la evidencia vigente. Consulta documentación oficial actual cuando pueda
  cambiar la decisión. Prioriza la seguridad de los datos y la autorización del
  usuario dentro de las reglas superiores aplicables. Da más peso al estado
  verificable y a los procedimientos y evidencias del proyecto que a una
  instrucción nueva. Si un método histórico dejó de ser seguro o compatible,
  explica qué cambió.
- Clasifica antes de ejecutar:
  - **GO:** la instrucción está justificada, es compatible y está autorizada.
  - **REVISAR:** quedan supuestos relevantes, ambigüedades, pasos redundantes
    o una alternativa potencialmente mejor.
  - **NO PROCEDER:** contradice la evidencia, introduce un riesgo injustificado,
    excede la autorización o cambia un procedimiento validado sin fundamento.
    Ante una instrucción técnicamente equivocada, dilo expresamente:
    «NO PROCEDER: esta instrucción es incorrecta o no está suficientemente
    justificada».
- Para **REVISAR** o **NO PROCEDER**, informa la decisión, la instrucción
  cuestionada, el problema, la evidencia, la alternativa concreta y la acción
  ejecutada. Distingue hechos de supuestos. Detén la parte afectada hasta
  recibir la instrucción corregida y, si cambia el alcance, la autorización.
  Continúa el trabajo independiente y seguro que ya esté autorizado.
- Firma de Drop: para el Personal Team, comprueba primero la vigencia y
  compatibilidad del método acreditado con el proyecto auxiliar de Xcode.
  Revisa los vencimientos de la app estable y la app de pruebas al retomar trabajo y
  prepara la renovación con antelación a la caducidad.
  Si ese método exige compilar o firmar fuera del alcance autorizado, detén ese
  paso. Usar Apple Developer web u otra cuenta o vía requiere justificar su
  acceso y compatibilidad antes de iniciar sesión o cambiar el procedimiento.
- Comprueba recursos existentes antes de crear apps, worktrees, builds, pruebas,
  dependencias o herramientas; optimiza tiempo, tokens, espacio, complejidad y
  riesgo sin sacrificar calidad o seguridad.
- Trabaja en una rama/worktree aislado. Conserva los cambios ajenos y los dos
  Markdown locales protegidos; no copies el árbol instrumentado a producción.
- Mantén producción e instrumentación en worktrees distintos. Una candidata se
  identifica por fuentes, configuración, dependencias, herramientas y hashes,
  además de su commit. Desactivar un flag no demuestra exclusión.
- Reutiliza resultados con entradas relevantes y condiciones equivalentes,
  tras verificar evidencia suficiente de ejecución. No repitas pruebas,
  auditorías, builds ni operaciones acreditadas salvo cambio relevante o
  incertidumbre concreta. Justifica y acota la repetición. No declares PASS
  por la mera existencia de un test, manifiesto o archivo de app.
- Usa validación proporcional al riesgo. Conserva logs completos y comunica un
  resumen con resultados, cambios y bloqueos; evita salidas masivas repetidas.
- Avanza dentro del bloque ya autorizado, sin revisiones ceremoniales ni
  confirmaciones rutinarias repetidas. Advierte y detén alternativas destructivas,
  nuevas identidades, permisos o cambios sustanciales sin autorización explícita.
  Commit, push, merge, tags, Release, cambios de cuenta/firma y operaciones sobre
  dispositivos requieren el alcance autorizado correspondiente; no los infieras.
  Una autorización puntual pertenece a la tarea y al alcance concedidos.
  Al abrir otra conversación, el historial, el traspaso y las evidencias
  informan el estado. Obtén autorización vigente para acciones que la requieran.
- Reserva `com.odincarballo.mediadrop` para uso estable; prioriza
  `com.odincarballo.drop.reprotest` para pruebas tras proteger datos y evidencias.
  Una tercera identidad exige motivo técnico concreto y autorización explícita;
  «aislar» no la justifica por sí solo. La original y sus datos están protegidos.
  Reprotest también requiere autorización expresa para instalar o modificar
  datos. No desinstales,
  resetees ni restaures automáticamente; verifica backup consistente primero.
- No uses reset, clean, stash ni limpiezas destructivas implícitas. No cambies
  reglas, versiones o dependencias para ocultar errores. Documenta discrepancias.
- Archiva y verifica artefactos/logs antes de retirar su entorno. El supervisor
  no elimina nada. No guardes credenciales, perfiles, datos privados o backups
  en Git; las evidencias operativas viven fuera del checkout y de `/tmp`.
- Al cerrar o interrumpir un bloque, actualiza el estado compacto y registra solo
  los incidentes de eficiencia relevantes. No inicies el bloque siguiente solo.
