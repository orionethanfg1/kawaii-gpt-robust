# Plan canónico: Kawaii persistente, Jarvis y companion

**Estado:** plan de producto e implementación secuencial; no significa que la arquitectura objetivo esté implementada.
**Fecha de revisión:** 2026-11-09
**Baseline documental inspeccionado:** `9dd8b61` (`v0.12.0-beta`, rev.hx); árbol de trabajo limpio.
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
