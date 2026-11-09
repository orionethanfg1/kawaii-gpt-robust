# Plan canónico: Kawaii persistente, Jarvis y companion

**Estado:** plan de producto e implementación secuencial; no significa que la arquitectura objetivo esté implementada.
**Fecha de revisión:** 2026-11-09
**Baseline documental original:** `9dd8b61` (`v0.12.0-beta`, rev.hx); sustituido por la ejecución B0 indicada abajo.
**Baseline de ejecución B0:** `ce4374b7c25f83bf92a49e1d06bed3362ecacee8` (`v0.12.0-beta`), Windows 11 Pro build 26300, Node `v24.19.0`, npm `12.0.2`; árbol de trabajo limpio al iniciar.
**Fuente de verdad para el objetivo persistente:** este documento. El código y las pruebas actuales mandan sobre cualquier estado aspiracional de otros documentos.

## 1. Objetivo de producto

> **Kawaii es un asistente personal local-first que, con autorización, conserva objetivos y contexto entre conversaciones, interpreta señales permitidas de la actividad del usuario y decide si conviene ayudar, preguntar o esperar, manteniendo una personalidad y una relación continuas bajo límites controlables por el usuario.**

Kawaii deja de ser exclusivamente reactivo, pero no se convierte en un proceso que razona sin parar, observa todo el equipo o actúa por cuenta propia sin límites.

### Distinciones necesarias

- **Persistencia** significa que objetivos, tareas, memoria y estado sobreviven a conversaciones y reinicios según una política explícita. No implica que el LLM deba permanecer cargado o ejecutar inferencias constantemente.
- **Presencia** significa que puede reanudar una tarea o hacer un seguimiento útil a partir de un evento autorizado; no que espíe el escritorio.
- **Iniciativa** significa que el sistema crea una propuesta contextual para preguntar, recordar o ayudar. No convierte una propuesta en permiso para ejecutar una acción.
- **Aprendizaje** en esta etapa significa actualizar recuerdos y preferencias con evidencia, correcciones, confianza y caducidad; no modificar automáticamente pesos, código o permisos.

### Principios no negociables

1. Utilidad Jarvis y tono companion conviven en el mismo turno y comparten el residente LLM disponible; el tono nunca sustituye una tarea clara.
2. Solo se observan fuentes seleccionadas y visibles para el usuario. No se añade keylogging, captura global, lectura silenciosa de contenido ni telemetría privada.
3. Las acciones de escritura, borrado, comunicación externa o cambio de configuración requieren autorización definida por política; una aprobación se vincula a la acción exacta.
4. El usuario puede pausar la iniciativa, silenciarla por fuente/objetivo, corregir u olvidar recuerdos y revisar por qué se le interrumpió.
5. Si faltan modelo, datos o permisos, Kawaii debe esperar o explicar la limitación; nunca inventar que observó, recordó, ejecutó o verificó algo.
6. La app impone límites y valida hechos; el modelo aporta razonamiento, lenguaje y elección contextual dentro de esos límites.

## 2. Arquitectura objetivo

```text
Fuentes explícitamente autorizadas
  (chat, objetivos, agenda, biblioteca opt-in, estado de capas, eventos locales)
        ↓
Ingesta de eventos tipados y deduplicados
        ↓
Persistencia local versionada
  (estado conversacional / eventos / objetivos / memorias / propuestas)
        ↓
Pre-filtro determinista y barato
  cooldown, quiet hours, relevancia, permisos, modelo ocupado, duplicados
        ↓ solo si merece evaluación
DecisionPacket + un residente LLM, si está disponible
        ↓
Silencio | pregunta | recordatorio | propuesta de acción
        ↓ aprobación según riesgo
Harness y tools existentes → ejecución idempotente y auditada
        ↓
Resultado, corrección, rechazo o silencio → actualizar estado con evidencia
```

La agenda/scheduler mantiene tiempos y reintentos; no decide el significado. El event log registra hechos de la aplicación, no una copia indiscriminada de la actividad del usuario. El modelo puede estar descargado cuando el coste de memoria lo justifique: eventos y tareas siguen siendo durables, y una propuesta pendiente se evalúa cuando vuelva a haber modelo/runtime.

### Contratos conceptuales

Antes de crear tipos, inspeccionar los existentes en DecisionPacket, `agenda`, `assistantMemory`, `userMemory`, episodios, scheduler y harness. Extenderlos sin duplicar la verdad.

| Contrato | Campos mínimos | Regla |
|---|---|---|
| `AgentEvent` | id, tipo, occurredAt, source, subjectId, payload tipado, schemaVersion | idempotencia por id; sin contenido privado innecesario |
| `Goal` | id, texto, estado, owner, prioridad, horizonte, source, updatedAt | diferenciar meta aprobada por el usuario de una sugerencia |
| `Observation` | eventId, resumen mínimo, confianza, permisos, expiresAt | sin permiso o caducada → no entra al razonamiento |
| `MemoryRecord` | id, dominio usuario/asistente, valor, evidencia, confianza, origen, TTL, estado | separar memoria personal del personaje y permitir corrección/olvido |
| `InitiativeProposal` | id, motivo, objetivo relacionado, evidencia, acción propuesta, expiry, dedupeKey | por defecto es una propuesta no ejecutada |
| `Approval` | proposalId, actionHash, scope, decision, expiresAt | aprobar una versión distinta de la acción no la autoriza |
| `ActionRun` | id, proposalId, idempotencyKey, status, result summary, timestamps | estados explícitos; retries no duplican efectos |

Si la persistencia actual no permite transacciones, migraciones y actualización atómica de estos datos, proponer un ADR de almacenamiento local antes de sustituirla. No mover datos existentes ni introducir una base de datos en el primer bloque.

## 3. Reutilización y límites del trabajo ya planeado

| Existente | Se conserva / extiende | No se debe inferir |
|---|---|---|
| DecisionPacket D0–D3 y capas de sistema | añadir señales de objetivos/eventos con razón y confianza | que todos los campos estén conectados a todos los flujos |
| Iniciativa N1, quiet hours, topes y snooze | usarla como salida del planificador con límites visibles | que N1 equivalga a observación persistente |
| `agenda` y main scheduler | almacenar seguimientos y vencimientos durables si el contrato actual los soporta | que timers en RAM sobrevivan al cierre/reinicio |
| Memoria dual, episodios, reconciliación y olvido | añadir procedencia, caducidad y vínculo a objetivos sin mezclar dominios | que «auto-harvest» signifique recuerdo correcto |
| Harness, allowlist, tickets y audit de archivos | reutilizar autorización y ejecución host-owned | que una propuesta del LLM sea consentimiento |
| Tray / notificaciones | entregar avisos aprobados y abrir conversación relacionada | que esté validado al salir, reiniciar o en build empaquetada |
| Idle review X9 | mantenerla como revisión local de bajo impacto con propuesta | que sea una política general de agencia |
| Orchestrator X0–X9 | seguir extrayendo módulos verticalmente | que “deflate completo” certifique continuidad persistente |
| Estabilidad Jarvis/companion G0–G7 | sus gates de archivos, memoria, agenda e imagen son prerequisitos | que un test unitario sustituya E2E o smoke manual |

Documentos complementarios: [DECISION-LAYER-AND-JARVIS-COMPANION.md](./DECISION-LAYER-AND-JARVIS-COMPANION.md), [JARVIS-AGENT.md](./JARVIS-AGENT.md), [JARVIS-COMPANION-STABILIZATION-PLAN.md](./JARVIS-COMPANION-STABILIZATION-PLAN.md), [COMPANION-MEMORY-RELIABILITY-PLAN.md](./COMPANION-MEMORY-RELIABILITY-PLAN.md), [MEMORY-STACK.md](./MEMORY-STACK.md), [HARNESS.md](./HARNESS.md) y [ROADMAP.md](./ROADMAP.md).

## 4. Secuencia de bloques

Los bloques siguientes son hitos grandes que agrupan trabajo coherente. Cada uno se entrega en slices revisables: contrato/prueba, implementación, integración y validación. No mezclar varios dominios en un cambio indivisible solo para reducir el número de commits. Cada bloque tiene feature flag cuando cambia comportamiento visible y puede revertirse sin borrar datos.

**Regla de avance:** el gate del bloque actual debe pasar antes de abrir el siguiente. Los fallos preexistentes se registran contra una línea base, pero no se convierten en aprobaciones automáticas. Un riesgo crítico de privacidad, pérdida de datos o acción no autorizada bloquea el avance.

### B0 — Baseline, inventario de regresiones y contratos reales

**Objetivo:** saber qué funciona en el commit actual antes de añadir agencia.

- Congelar commit, plataforma, versión Node/npm, configuración de runtime y estado limpio/sucio.
- Ejecutar build, typecheck, suites selectivas y completas; guardar logs completos, códigos de salida, omitidos y errores agrupados.
- Inventariar capacidades con cinco estados: `implementada y E2E probada`, `implementada y probada en módulo`, `implementada no verificada en entorno`, `parcial`, `planeada`.
- Reproducir cada función reportada como rota con pasos, datos iniciales, resultado esperado/obtenido y clasificación: regresión, expectativa obsoleta, entorno, migración o indeterminado.
- Congelar una matriz de flujos actuales: respuesta normal, iniciativa/silencio, conversación tras reinicio, memoria usuario/asistente, agenda, notificación, lectura/continuación documental, aprobación/rechazo de tool, cancelación y salida.

**Pruebas:** comandos existentes (`npm run build`, `npm run typecheck`, `npm test`, `npm run release:check`, `npm run test:e2e` cuando su entorno esté disponible) más smoke manual de `SMOKE-0.12.md` y `COMPANION-SMOKE.md`.

**Salida:** tabla baseline con evidencia reproducible y lista de fallos priorizada. Si no puede reproducirse un reporte, dejarlo abierto; no adivinar ni corregir expectativas para silenciarlo.

#### Evidencia de ejecución — 2026-11-09

| Comando | Resultado | Evidencia / interpretación |
|---|---|---|
| `npm run build` | **PASS**, código 0 | Build Electron/Vite completado. |
| `npm run typecheck` | **FAIL**, código 2 | 396 diagnósticos TypeScript en 120 archivos. Principales: TS6133 (183), TS2322 (41), TS2339 (36), TS2345 (29); también hay símbolos inexistentes, imports/export incompatibles y tipos incompletos. Ejemplos observados: `humanize-host-reply.ts` refiere `ok`/`summary` no declarados y `context-eviction.ts` accede a `ingestComplete`, ausente en `DocReadingState`. |
| `npm test` | **FAIL**, código 1 | 146 archivos de prueba: 106 pasan y 40 fallan; 566 pruebas: 516 pasan y 50 fallan. Los fallos alcanzan conversación/memoria/iniciativa, documentos/continuación, identidad de imagen, proveedores/routing y otros módulos. También aparecen errores de entorno de pruebas (`localStorage is not defined`) y un import no resuelto (`./intimacy-memory`); no se atribuyen automáticamente a fallos de producción. |
| `npm run release:check` | **FAIL**, código 1 | `verify:step1` pasa. `smoke:step3` falla solo en la expectativa de que `buildDocumentsWithState` aparezca en `runChatOrchestrationTurn.ts`: la implementación actual delega a `turn-document-path.ts`, y la función está en `document-attach.ts`. Esto apunta a una comprobación estática desactualizada tras la extracción; se registra, no se modifica durante B0. |
| `npm run test:e2e` (sin activar) | **SKIP**, código 0 | Los 3 casos quedan omitidos por diseño si falta `KAWAII_E2E=1`; el resultado no se cuenta como aprobación. |
| `npm run dev` + E2E habilitado | **PASS**, 3/3 | El renderer respondió HTTP 200 y pasaron los chequeos de carga del `body`, presencia de input/wizard y ausencia del banner fatal. Fue necesario instalar Chromium de Playwright en el entorno. Es un smoke superficial de UI, no valida enviar mensajes, streaming, persistencia ni integraciones. |
| `git diff --check` | **PASS**, código 0 | Sin errores de whitespace al capturar el baseline. |

Los logs completos de la ejecución quedaron en `%TEMP%` como `kawaii-b0-build.log`, `kawaii-b0-typecheck.log`, `kawaii-b0-tests.log`, `kawaii-b0-release-check.log`, `kawaii-b0-e2e.log` y `kawaii-b0-e2e-live.log`; no se añadieron logs generados al repositorio.

**Inventario sustentado por esta ejecución:** hay build funcional; existen suites de módulo para chat/orquestación, memoria/companion, iniciativa, lectura documental, identidad de imagen y proveedores/model routing, pero el resultado de sus pruebas es mixto y no certifica el flujo integrado. El E2E disponible cubre solo la carga básica del renderer. No se asigna a una capacidad el estado “E2E probada” fuera de esos tres chequeos.

**Pendiente para cerrar B0:** no se ejecutaron los recorridos manuales de [SMOKE-0.12.md](./SMOKE-0.12.md) ni [COMPANION-SMOKE.md](./COMPANION-SMOKE.md), porque requieren validar el comportamiento real de la app, servicios/modelos y acciones del usuario. Tampoco se recibieron en esta ejecución pasos concretos para las regresiones recientes reportadas; deben añadirse a la matriz y reproducirse antes de clasificarlas. Por tanto, B0 tiene baseline automatizado registrado, pero su inventario funcional y diagnóstico manual siguen **incompletos**. No se corrigió código ni se rebajó ninguna expectativa.

#### Evidencia adicional — memoria e iniciativa, 2026-11-09

Se contrastaron los comentarios nuevos de [SMOKE-0.12.md](./SMOKE-0.12.md) y [COMPANION-SMOKE.md](./COMPANION-SMOKE.md) con código y con el registro local `backups/memory-write.log`. Este registro audita candidatos/escrituras y ejemplos breves; **no es una exportación del estado íntegro actual**.

- El registro contiene 213 eventos entre el 30 de octubre y el 9 de noviembre: 193 de `assistant` y 20 de `user`. Hay fragmentos narrativos/de roleplay guardados como gustos o hábitos de la asistente; del lado del usuario hay frases relacionales/narrativas que aparecen como gustos, favoritos de comida/bebida y facts. Esto confirma independientemente el comentario de A1: la recolección funciona, pero su precisión es insuficiente.
- El 9 de noviembre se registró el mismo conjunto de cuatro candidatos de gustos en tres eventos entre las 11:28:00 y 11:28:08; otro candidato también aparece en tres eventos entre las 11:24:08 y 11:24:18. No se asume que sea exactamente el mismo turno hasta seguir los call sites, pero sí es evidencia de escrituras redundantes que deben hacerse idempotentes.
- El campo `persistOk` del audit log no demuestra persistencia durable. `safeSettingsStorage` captura errores de `localStorage` sin devolver fallo al middleware; el colector comprueba principalmente el estado Zustand en RAM y el mirror también silencia sus errores. Por ello, el registro puede afirmar `true` sin confirmar una lectura posterior de la clave persistida.
- Hay más de un punto de recolección del mismo texto: éxito/parcial en `orchestratorRun.ts` y finalización/flush tardío en `postReplyFinalize.ts`. La respuesta puede pasar varias veces por el colector; el contrato actual no lleva un idempotency key por turno.
- El extractor de asistente acepta frases cortas con pocos filtros semánticos; likes sí tiene clasificación temática, pero hábitos usa filtros más débiles, relational solo un filtro genérico y límites/notas de voz no se validan con la misma evidencia. La recolección del usuario incluye una heurística de comida/bebida que puede tomar contexto cercano como alimento, replicar un mismo candidato en varias categorías y producir facts derivados.
- La revisión automática de consistencia vuelve a extraer de los últimos 40 mensajes del chat activo, sin usar metadatos de turno para excluir continuaciones, acciones de app o segmentos de roleplay. Repetir una extracción heurística no aporta evidencia independiente de que el hecho sea cierto.
- El LLM no consulta un índice de memoria por sí solo: el host preselecciona e inyecta contexto mediante reglas; los episodios usan coincidencia de tokens y peso por recencia. En conversación general puede entrar el primer gusto/favorito aunque no tenga relación con la consulta; en chats largos se añaden facts recientes por fallback. El uso del LLM actual es una extracción de asistente opcional en segundo plano, no recuperación semántica. No hay un contrato común de procedencia, confianza, vigencia o resolución de contradicciones que limite qué contexto llega al modelo.
- La iniciativa confirmada por el comentario A2 es un problema distinto de la memoria: en `useConversationInitiative.ts`, primero se usa `buildInitiativeDecisionMessages`, que no recibe objetivo, foco ni bloque de memoria. El bloque con objetivos y gustos se prepara solo para el segundo intento de generación, cuando el primer paso no produjo texto. Además, el paso de decisión instruye al modelo a preferir hablar tras una hora. Esto favorece mensajes genéricos y repetición, y no está conectado de forma fiable a retomar trabajo real. El reporte manual de “solo pregunta por cambiar la foto principal” queda como síntoma reproducido por el usuario, no como causa atribuida a una rama específica.

**Límite de inspección de datos:** la app Electron seguía abierta mientras se hizo esta revisión. La memoria vive en `localStorage` (`kawaii-settings-v2`) y el registro LevelDB pertenece a Chromium; no se leyó ni copió la base activa para evitar una lectura inconsistente. Por tanto, no se afirma haber validado cada valor que actualmente aparece en Ajustes → Memoria. Para cerrar esa verificación hace falta una exportación de solo lectura de ambas memorias y del mirror desde la app, con hora, versión y conteos; se debe comparar por identidad de registro/categoría y sin borrar ni corregir automáticamente.

#### Orden de corrección propuesto — memoria confiable antes de ampliarla

Estos slices son un track de calidad dentro de B1/B3; no se debe añadir más recolección ni iniciativa hasta que los gates M0–M3 pasen.

| Slice | Alcance | Gate verificable |
|---|---|---|
| **M0 — Snapshot y contención** | Exportar sin modificar `userMemory`, `assistantMemory`, mirror, episodios y archivo overflow; hacer backup, normalizar solo para comparar, reportar duplicados/contradicciones/origen desconocido. Evitar la lectura concurrente de LevelDB. No eliminar datos ni auto-“sanearlos” en segundo plano. Pausar la promoción automática de candidatos de baja confianza si puede activarse como flag reversible. | Export reimportable; conteos y hash del snapshot; diff de revisión legible; ningún registro cambia antes de aprobación. |
| **M1 — Una escritura por turno, evidencia y persistencia real** | Elegir un único punto post-finalización para recolectar respuesta completa; retirar los call sites redundantes o hacerlos idempotentes con `conversationId + assistantTurnId + extractorVersion`. Registrar candidato, lado, categoría, evidencia/turno, señal explícita, confianza, decisión y estado; no guardar conversación completa. `persistOk` solo es verdadero tras confirmar serialización y readback de almacenamiento; un fallo debe propagarse a UI/log y no quedar como éxito. Enriquecimiento LLM debe validar la misma evidencia y versión, y no reinsertar memoria olvidada/corregida por una tarea tardía. | Reintento, doble `onDone`, respuesta parcial y flush tardío producen una sola escritura; simulación de quota/fallo/rehidratación muestra error real; forget/correct vence a cualquier job atrasado. |
| **M2 — Precisión, separación de dominios y limpieza revisable** | Reemplazar la aceptación por longitud/listas negras con extracción contextual: rol correcto, primera persona literal, negación/corrección, distinción usuario/asistente, cita/adjunto/herramienta/continuación, texto narrativo y roleplay. Conservar evidencia mínima. Admitir auto-guardado solo para señales explícitas de alta confianza; resto queda como candidato revisable. Separar estable (identidad/preferencia/instrucción), relacional, meta/proyecto, episodio y estado temporal con caducidad; `userMemory` nunca se copia a `assistantMemory`. Sanear listas y archivos overflow con la misma política y previsualizar la migración antes de confirmarla. | Corpus anonimizado derivado de los falsos positivos del audit + positivos explícitos en español; medir precisión/recall por categoría y falsos cruces de identidad; ninguna frase escénica/temporal entra como preferencia estable; correcciones y olvido no reaparecen. |
| **M3 — Recuperación útil y acotada para el LLM** | Crear una consulta de memoria tipada desde el turno: identidad, preferencias, objetivo/proyecto, relación o episodio. Recuperar primero por filtros de dominio/estado/vigencia y luego por relevancia, evidencia/confianza y recencia; aplicar presupuesto de tokens. No usar fallback a “primer gusto/fact” si no hay match. Si se usa LLM para clasificar o rerankear, solo puede seleccionar IDs de candidatos suministrados por la app; el host verifica IDs, permisos y estado y el modelo no escribe la memoria durante retrieval. Mantener fallback determinista/local. | Tests muestran recuerdos relevantes, no irrelevantes; usuario y asistente no se confunden; conflictos se marcan y no se resuelven inventando; presupuesto estable en chat corto/largo y con el modelo apagado. |
| **M4 — Ampliar objetivos/progreso y reanudar iniciativa** | Con M1–M3 estables, conservar `Goal` explícito con estado, fuente, aceptación, progreso, último avance y siguiente paso; añadir episodios con evidencia y caducidad en vez de convertir el chat entero en facts. El gate de iniciativa debe descartar primero permisos, quiet hours, snooze, duplicados, falta de progreso útil y modelo ausente; después elegir un objetivo elegible con DecisionPacket y ofrecer pregunta/propuesta/silencio. El perfil visual nunca es un nudge por defecto sin relación con una petición pendiente. | Escenarios sintéticos cubren proyecto retomado, meta completada, corrección, silencio, reinicio, falta de modelo y rechazo; iniciativa cita el objetivo/avance real o calla, no repite una plantilla y no ejecuta acciones. |

**Validación transversal:** cada slice incluye pruebas unitarias, integración de persistencia/rehidratación y un E2E que recorra envío → finalización → extracción → revisión → recuperación en turno posterior. Añadir métricas de precisión por campo (no solo cantidad de recuerdos), tasa de promoción/rechazo, duplicados, fallos de readback y pertinencia de recuperación. Mantener fixtures sin PII; los extractos del registro real no deben copiarse a tests ni commits sin anonimización. Las suites de memoria que fallaron en B0 son parte del baseline y no se deben marcar “resueltas” hasta volver a pasar: `assistant-memory`, `assistant-memory-b2`, `assistant-memory-reconcile`, `collect-assistant-memory`, `companion-memory-b5-b6` y `user-memory`.

### B1 — Barrera contra regresiones del producto existente

**Objetivo:** proteger contratos actuales antes de extenderlos.

- Convertir los casos esenciales de la matriz B0 en pruebas de integración usando proveedores, reloj, scheduler, storage y notificaciones falsos.
- Añadir E2E para el camino real: enviar → streaming → postReplyFinalize → guardar → rehidratar → mostrar; y para aprobación/rechazo de acción.
- Verificar cancelación, timeout, modelo apagado, proceso reiniciado, storage corrupto, cuota llena y respuesta incompleta.
- Añadir prueba de wiring/import en el arranque para módulos que el bundle necesita; CI debe fallar si un test requerido se omite.
- Mantener por separado fallos preexistentes y regresiones nuevas mediante comparación contra el baseline de B0.

**Gate:** build y tests del área pasan; E2E esencial no está omitido; fallos conocidos tienen dueño/issue y no se ocultan con `|| true`, skips silenciosos o expectativas debilitadas.

### B2 — Modelo de estado, migraciones y persistencia durable

**Objetivo:** representar continuidad de forma versionada sin perder settings, chats, memoria, agenda ni bibliotecas.

- Auditar `settingsStore`, character store, chats, episodios, memoria, agenda y backup/recovery. Elaborar mapa de fuente de verdad y mecanismo de persistencia actual.
- Definir contratos mínimos de `Goal`, `AgentEvent`, `Observation`, `InitiativeProposal` y estado de ejecución.
- Especificar migraciones idempotentes, validación de esquema, backup previo, rollback/recovery y política de retención antes de cambiar storage.
- Persistir un registro acotado de eventos/tareas y checkpoints de trabajo. Usar almacenamiento transaccional solo tras ADR que compare opciones locales y soporte del stack actual.
- Guardar resúmenes/refs, no prompts completos, imágenes o conversaciones por defecto. Datos sensibles requieren consentimiento y controles separados.

**Automático:** migrar datos viejos/nuevos repetidamente, exportar/importar, crash entre pasos, backup/restore, deduplicación, consistencia de versiones y límites de tamaño.
**Gate:** migración de fixture previo preserva datos; segundo arranque no repite migración ni duplica eventos; rollback/recovery demostrado.

### B3 — Objetivos y memoria con procedencia

**Objetivo:** que “lo que estamos intentando lograr” sobreviva al chat sin convertir inferencias en hechos.

- Mantener separados: objetivo declarado, objetivo aceptado, tarea activa, memoria estable, episodio contextual y propuesta inferida.
- Reutilizar memoria dual y agenda; enlazar cada recuerdo/objetivo a fuente, fecha, confianza, estado y mecanismo de corregir/olvidar.
- Permitir revisión del resumen y estado de una meta; no dejar que inferencias no confirmadas se conviertan en compromisos permanentes.
- Establecer expiración para señales contextuales y evitar que el historial de episodios recupere información caducada como vigente.

**Gate:** declarar, retomar, completar, pausar, corregir y olvidar objetivo; comprobar separación de memorias y persistencia después de reiniciar.

### B4 — Observación local opt-in y event-driven

**Objetivo:** dar contexto entre conversaciones sin vigilancia ni sondeo costoso.

- Implementar primero fuentes que la app ya conoce (objetivos, agenda, progreso de documentos iniciados, salud de sus capas, acciones explícitas del harness).
- Para cada fuente, UI de permiso, alcance, propósito, retención, pausa y borrado. Opt-in explícito por fuente; default apagado para nueva observación.
- Capturar cambios por eventos/temporizadores acotados, no poll continuo ni captura de pantalla. No inferir que una aplicación está abierta si no existe señal permitida.
- Marcar freshness y confianza. Eventos tardíos, duplicados, inválidos o sin autorización se descartan con razón auditable.

**Gate:** cada evento puede rastrearse a una fuente autorizada; revocar un permiso detiene la ingesta y borra/retiene datos según la elección visible del usuario.

### B5 — Decisión de iniciativa: silencio, pregunta o propuesta

**Objetivo:** conectar objetivos y observaciones con iniciativa útil, reutilizando N1/DecisionPacket.

- Un filtro determinista descarta primero: evento repetido, objetivo ya cerrado, observación caducada, quiet hours, snooze, límite diario, app ocupada, modelo no disponible o bajo beneficio esperado.
- Solo candidatos restantes llegan al DecisionPacket/modelo residente. La salida validada es `silence | ask | propose_action`; nunca texto libre que autoejecute una tool.
- Contexto mínimo y explicabilidad: relación con un objetivo, evidencia resumida, razón de contacto y momento de vencimiento.
- Exigir que la propuesta pueda ser rechazada, pospuesta, silenciada por fuente o desactivada globalmente. Los rechazos e ignorados reducen frecuencia con una regla explícita, no se interpretan como consentimiento.
- El modelo cargado se usa cuando está disponible y el candidato pasa los filtros; la memoria ocupada por sí sola no justifica una inferencia periódica.

**Gate:** escenarios iguales producen decisiones reproducibles con reloj/modelo falsos; límite de intervenciones, quiet hours, dedupe y silencio pasan pruebas de calendario y reinicio.

### B6 — Scheduler, tray y reanudación después de reinicio

**Objetivo:** que seguimiento y notificación se ajusten a un contrato honesto de ciclo de vida.

- Definir diferencias de ventana minimizada, app en bandeja, salida explícita, crash, cierre de sesión y apagado del sistema.
- Persistir trabajos y leases; al arrancar, recuperar vencidos, deduplicar entregas, aplicar expiración y evitar tormenta de notificaciones.
- Notificación profunda conserva `goalId`/`proposalId`/conversación y valida que el objeto siga vigente al abrir.
- Decidir mediante ADR qué se garantiza con scheduler interno y qué requiere mecanismo del SO. Mostrar claramente la limitación si el proceso está cerrado.

**Gate:** exactly-once lógico bajo entrega al menos una vez (idempotency key); prueba en Windows empaquetado para tray, notificación, click, snooze, cancelación y reinicio.

### B7 — Ejecución de acciones con autorización exacta

**Objetivo:** convertir propuestas aprobadas en tareas host limitadas y recuperables.

- Reutilizar harness, allowlist, path-boundary, mutation tickets, confirmación y audit log; el renderer/LLM no es autoridad de permisos.
- Ejecutar acciones de lectura inocuas solo dentro de fuente/alcance consentidos. Escritura/borrado/externas requieren confirmación explícita por acción salvo política preautorizada, estrecha, revocable y probada.
- Vincular aprobación a parámetros exactos, destino, hash, expiración e idempotency key; revalidar permiso al ejecutar.
- Mostrar vista previa/diff, estado `pending/running/succeeded/failed/cancelled`, resultado y rollback cuando aplique.
- No habilitar shell arbitrario, código libre, instalar software silencioso, autoeditar la app ni autoampliar permisos.

**Gate:** tests de rechazo, acción modificada tras aprobación, replay, duplicado, ruta traversal/symlink, fallo parcial y cancelación no causan efecto no autorizado.

### B8 — Interfaz de continuidad y control del usuario

**Objetivo:** que la presencia sea comprensible, no sorprendente.

- Panel de objetivos activos, último progreso, próximas revisiones, fuente de señal y estado de seguimiento.
- Centro de propuestas/notificaciones con `por qué ahora`, `qué evidencia`, `qué pasará`, `aprobar`, `rechazar`, `posponer`, `silenciar` y `olvidar`.
- Indicador inequívoco de observación activa y controles globales/por fuente; historial exportable/borrable sin revelar secretos.
- Mantener la voz companion en el texto, no en la pantalla de permisos: la autorización debe ser neutral y específica.

**Gate:** prueba de usabilidad con alguien que no implementó la función; entiende permiso, fuente, efecto y cómo pausar/revocar sin leer documentación.

### B9 — Evaluación, rollout y optimización de recursos

**Objetivo:** demostrar que la iniciativa mejora continuidad sin penalizar estabilidad, privacidad o experiencia.

- Feature flag inicial apagada para nuevas fuentes y acciones. Rollout interno → opt-in beta → expansión solo con gates aprobados.
- Dataset sintético/local de secuencias: señal útil, irrelevante, repetida, antigua, contradictoria, opt-out, app cerrada, modelo ocupado, restart/crash.
- Métricas locales agregadas y opt-in: propuestas mostradas/aceptadas/pospuestas/rechazadas, duplicados, falsos seguimientos, fallos y latencia. Nunca exportar contenido privado por defecto.
- Medir RAM/VRAM, CPU, wakeups, uso de disco, latencia y consumo de batería en reposo y al evaluar. Presupuesto por dispositivo; reducir o descargar modelo cuando exceda límites.
- Objetivos de producto se fijan antes del experimento; no calibrar umbrales mirando solo ejemplos exitosos.

**Gate:** no pérdida de memoria ni acciones no autorizadas; no duplicados tras restart; se cumple el presupuesto de recursos acordado; tasa de intervenciones molestas dentro del umbral acordado con el usuario.

## 5. Prevención de regresiones: política de cambio y gates

### Por qué se rompen funciones (evidencia y alcance)

Esto es un diagnóstico de proceso, no una explicación causal de cada síntoma. No se proporcionó una lista concreta de funciones rotas; B0 debe reproducir cada caso antes de adjudicar causa.

| Evidencia observada en el repo | Riesgo que implica | Control requerido |
|---|---|---|
| El último commit inspeccionado, `9dd8b61` (2026-11-07), toca 64 paths en varias áreas: streaming/documentos, memoria, iniciativa, imágenes, IPC/UI y documentación. | Cuesta aislar qué cambio rompió un flujo; varias regresiones pueden ocultarse en el mismo commit/revisión. No prueba que cada archivo tenga un defecto. | Slices verticales por contrato/flujo; test antes de modificar; commits/revisiones pequeños con causa y gate. |
| El historial documentado contiene correcciones explícitas: `rev.hu` restauró `initiative` que faltaba y repuso fallback; `rev.hs` corrigió `await import` en callback sync y reasignación de `const`; `rev.hj` corrigió lote de imagen `[3,2,3]` a `[1,2,3]`; `rev.hk` fijó referencia canónica, prompts contradictorios y fail-closed. | Imports/wiring, límites sync/async, colecciones mutables y prompts construidos en etapas son puntos con contratos implícitos y alto radio de impacto. | Smoke de arranque/imports, tests de integración del flujo completo, typecheck/build en cada cambio y validación del payload justo antes del proveedor. |
| El changelog registra `rev.hv` (iniciativa solo LLM, fallback de plantilla eliminado) seguido por `rev.hu` (módulo faltante restaurado y fallback reintroducido). | El comportamiento de iniciativa cambió entre revisiones cercanas y el fallback fue parte del contrato de disponibilidad. | Tests explícitos para modelo ausente/timeout/resultado SILENCIO y decisión documentada sobre fallback permitido; no esconder fallos con texto genérico. |
| `SMOKE-0.12.md` aún tiene casos P0/P1 sin marcar. `tests/e2e/smoke.spec.ts` comprueba shell/input/banner fatal, no los recorridos de continuidad, memoria o agencia. | Build/unit tests no detectan roturas visibles entre IPC, store, scheduler, UI y reinicio. | Hacer que CI exija E2E de recorridos críticos; “skip” debe aparecer como pendiente, nunca como verde. |
| Documentos conservan estados/versiones distintos: `MISSION.md` dice que algunas capacidades están planificadas, mientras `CAPABILITIES-0.12.md` las describe como implementadas; el plan de estabilización cita un baseline histórico. | Se pueden modificar interfaces ya disponibles o asumir que una capacidad está verificada cuando solo existe parcialmente. | B0 crea inventario de estado con evidencia; ROADMAP enlaza la fuente canónica y los snapshots históricos se etiquetan como tales. |
| Los errores reportados no especifican función/reproducción y el árbol actual está limpio en el baseline inspeccionado. | No es válido culpar a un commit o declarar resueltas regresiones no reproducidas. | Guardar repro/telemetría mínima, revisión exacta y comportamiento esperado/obtenido antes del fix. |

### Gate obligatorio para cada slice

1. Enunciar una sola hipótesis y contrato afectado; guardar reproducción o test fallido antes del fix cuando sea viable.
2. Confirmar llamadas, reexports, imports, IPC/preload, tipos y persistencia que participan en el flujo.
3. Añadir/actualizar unit test del módulo y test de integración de productor → consumidor; para una ruta visible, actualizar E2E.
4. Ejecutar selector dirigido, `npm run build`, gates de tipo/calidad exigidos por baseline y `npm run release:check` según alcance.
5. En prueba con error, abortar, reiniciar y migrar datos: asegurar estados recuperables, no duplicate side effects, UI finalizada y mensajes explícitos.
6. Actualizar changelog/docs/status solo con evidencia ejecutada; anotar plataforma/modelo cuando un test manual dependa de ellos.
7. Revisar `git diff` y superficie tocada; no mezclar refactor masivo, cambio de política y feature en el mismo slice.

Si `typecheck` global ya falla, registrar baseline comparable, corregir primero diagnósticos nuevos de archivos tocados y mantener una lista de deuda preexistente. No afirmar que pasó por usar `typecheck:gate` reducido.

## 6. Matriz de aceptación de producto

| ID | Escenario | Éxito |
|---|---|---|
| P1 | Usuario retoma un proyecto tras días | Kawaii enlaza objetivo y progreso reales, reconoce incertidumbre y pregunta si se desea continuar. |
| P2 | No hay evento útil / quiet hours / snooze | Permanece en silencio; no usa el modelo por un tick vacío. |
| P3 | Evento duplicado o antiguo tras reiniciar | Se deduplica o caduca; no aparece seguimiento repetido. |
| P4 | Usuario desactiva fuente o iniciativa | No se vuelve a leer/usarla hasta nuevo consentimiento. |
| P5 | No hay LLM disponible | Estado se conserva; no inventa recomendación ni bloquea chat normal. |
| P6 | Propuesta de editar/mover/borrar | Explica acción exacta; espera aprobación; rechazo no causa cambios. |
| P7 | Aprobación expirada o acción modificada | Se solicita aprobación nueva; no se ejecuta la versión alterada. |
| P8 | Reinicio/actualización/crash durante tarea | Recovery idempotente; resultado y estado visibles; sin pérdida ni doble efecto. |
| P9 | Conversación companion con tarea clara | Completa primero la tarea; conserva tono sin desviar a RP o iniciativa social. |
| P10 | Memoria corregida/olvidada | Store, prompt y vista reflejan la corrección; no reaparece desde backups/episodios sin aviso. |

## 7. Guía de continuación para otra IA

Este plan es autocontenido. Para continuar sin acceso a conversaciones previas:

1. Lee este documento y luego `docs/ROADMAP.md`, `docs/DECISION-LAYER-AND-JARVIS-COMPANION.md`, `docs/JARVIS-COMPANION-STABILIZATION-PLAN.md` y el documento del bloque asignado.
2. Confirma la revisión real y `git status`; la revisión del encabezado es histórica, no una suposición sobre el checkout futuro.
3. Identifica el primer bloque sin evidencia de salida. No empieces directamente por una feature posterior.
4. Inspecciona código/test actuales; no confíes en que las rutas de archivos o estados de la tabla siguen iguales.
5. Implementa un slice de ese bloque solamente, conservando compatibilidad y migraciones; no limpies cambios ajenos.
6. Ejecuta los gates del bloque y devuelve: revisión inicial/final, archivos, decisiones, comandos/códigos de salida, pruebas omitidas/fallidas, pasos manuales, riesgos restantes y próximo bloque desbloqueado.
7. Si falta acceso a archivos/modelos/hardware, no afirmes éxito: deja el gate como pendiente e indica la evidencia exacta que necesita la persona.

**Estado al publicar este plan:** arquitectura y orden documentados; no se implementaron aquí objetivos persistentes nuevos ni observadores. Siguiente paso: B0, incluyendo los casos concretos de regresiones que el usuario observe y el estado actual de pruebas.

## 8. Investigación y referencias técnicas

Patrones usados para diseñar el plan; no se propone añadir estas bibliotecas como dependencia:

- [LangGraph: Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) distingue checkpoints de estado corto por hilo de stores para datos durables entre hilos; explica reanudación y recuperación ante interrupciones. Aplicación aquí: estado conversacional/tareas y memoria a largo plazo son capas distintas; la persistencia en RAM no satisface reanudación después de reiniciar.
- [Microsoft Durable Functions overview](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-overview) describe workflows con estado, checkpoints, retries y recovery. Aplicación aquí: tareas durables, recuperación y reintentos idempotentes; Kawaii puede implementarlos con su scheduler/store local sin adoptar Azure.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) plantea gestión de riesgos y evaluación a lo largo del diseño, desarrollo y uso. Aplicación aquí: permisos, fuentes, evidencia, evaluación y revisión continua forman parte del producto, no de un parche al final.
- [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation) y [xAI Imagine](https://docs.x.ai/developers/model-capabilities/imagine) sirven de referencia comparativa para flujos conversacionales/edición, pero no demuestran que un sistema local deba observar el equipo ni que una API externa garantice identidad.

Estas fuentes describen patrones y capacidades; los gates de este documento deben validarse contra el runtime real de Kawaii.
