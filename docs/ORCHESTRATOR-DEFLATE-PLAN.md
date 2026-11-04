# Plan: desinflar el orquestador de chat

> **Estado rev.gd: bloques X0–X9 marcados completos.** Meta de tamaño del turn (&lt;1000 / &lt;500) sigue como mantenimiento continuo.


**Objetivo:** dejar `runChatOrchestrationTurn.ts` como **conductor delgado** (~300–500 líneas a medio plazo), sin rewrite big-bang y sin romper Jarvis/companion.

**Prioridad global (igual que el plan general):**  
estabilidad → DecisionPacket / Jarvis → companion → extensiones.

Complementa: `DECISION-LAYER-AND-JARVIS-COMPANION.md`, `ROADMAP.md`, `HARNESS.md`.

---

## 1. Principios

1. **Extraer, no reescribir** — un slice vertical por PR/rev; comportamiento igual al inicio.
2. **Módulos puros primero** — sin Zustand/IPC cuando se pueda (como `decision-packet.ts`).
3. **Facades finas** — si hace falta store/IPC, un archivo `*.ts` en `services/` con API mínima.
4. **Tests del módulo** antes o junto al cableado; `gate:g0` / release:check no regresa.
5. **Prohibido** meter features nuevas en el monolito: o van al módulo nuevo o esperan extracción.

### Forma objetivo

```text
runChatOrchestrationTurn.ts          # orden del turno + abort + paint hooks
  decision-packet.ts                 # D0 ✓
  turn-system-layers.ts              # extraSystem: time, harness, library, vision hints
  turn-document-path.ts              # lectura progresiva / DOC_READ / sigue
  turn-route-and-model.ts            # auto-route, sticky, intimacy hint
  turn-stream.ts (o provider existing)# stream, continue, thinking strip
  postReplyFinalize.ts               # ya parcial ✓
  turn-initiative-hooks.ts           # solo señales post-stream (opcional)
```

Cada archivo: **&lt; ~250 líneas** preferible; una responsabilidad.

---


## X0 — Inventario actual (`runChatOrchestrationTurn.ts`)

| Zona (aprox.) | Responsabilidad | Estado extracción |
|---------------|-----------------|-------------------|
| L93–160 | Setup abort, docHeavy, recovery, history APP→system | En orquestador |
| L163–230 | **DecisionPacket** D0/D1 | ✓ módulo `decision-packet.ts` |
| L280–340 | Tiempo + harness + library | ✓ **X1** `turn-system-layers.ts` (rev.fx) |
| ~370–550 | Attachment guard + vision + wardrobe offer | Pendiente (X1b o con X2) |
| ~640–950 | Path documentos / progressive / DOC_READ | **X2** |
| ~1020–1150 | Auto-route / sticky model | **X4** |
| ~1150–1700 | Stream, paint, onDone, continue | **X3** |
| postReply* | Finalize / harness tools | Parcial externo |

Hito: ~1889 → ~1787 líneas tras X1 (−~100). Meta &lt; 1000 luego &lt; 500.


## 2. Bloques de extracción (orden)

### Fase S — Estabilidad del proceso (antes de features)

| ID | Bloque | Qué sale del orquestador | Criterio de hecho |
|----|--------|---------------------------|-------------------|
| **X0** | Inventario ✓ | Mapa comentario o doc: zonas del archivo actual (líneas / responsabilidades) | Lista en este doc o ADR corta |
| **X1** | `turn-system-layers` ✓ | Tiempo local/clima, harness min vs full, library gated por packet, hints de media/vision **sin** llamar al LLM | extraSystem construido solo vía API; orquestador 1 llamada |
| **X2** | `turn-document-path` | forceDoc, chunks, inject docs, DOC_READ memory, auto-chain flags | Chat íntimo sin docs = mismo comportamiento; “sigue” = path docs |
| **X3** | Stream timeout / continue ✓ (helpers) | Watchdog, continue text, strip thinking — agrupar helpers ya dispersos | No cortes fantasma; tests stream si existen |

*Prioridad S1–S6 del plan general se benefician de X1–X3 (prefill, docs, stream).*

### Fase D — DecisionPacket (continuación)

| ID | Bloque | Notas |
|----|--------|--------|
| **D0–D1** | Packet + consumo inject | ✓ rev.fv |
| **D2** | Log estable + opcional memory-write style ring | Ya hay `console.info`; opcional persist |
| **D3** | Tests packet + layers + stream + doc path “no library en chat” | Vitest |

### Fase J — Jarvis (utilidad en módulos propios)

| ID | Bloque | Notas |
|----|--------|--------|
| **X4** | `turn-route-and-model` ✓ | score/route/sticky; packet.modelHint; **single-resident** |
| **X5** | Tools / agent block ✓ | `buildAppAgentSystemBlock` + tool loop **fuera** del turn file |
| **X6** | File NL path ✓ | Quiere files → packet ya; ejecución tools en harness existente |

### Fase C — Companion

| ID | Bloque | Notas |
|----|--------|--------|
| **X7** | Post-stream initiative signals ✓ | Timer arranca al **fin** de stream; no lógica de plantillas en orquestador |
| **X8** | Intimacy inject ✓ | Solo si `inject.intimacyBlock`; módulo intimacy ya existe |

### Fase E — Extensiones

| ID | Bloque | Notas |
|----|--------|--------|
| **X9** | Idle review / embeddings ✓ | Nunca dentro del orquestador de turno |

---

## 3. Orden de ejecución recomendado (próximas revs)

1. **X0** — inventario rápido (1 rev docs, sin riesgo).  
2. **X1** — `turn-system-layers.ts` (mayor reducción de ruido + alinea con inject).  
3. **X2** — path de documentos.  
4. **X3** — stream/continue helpers.  
5. **D3** — tests.  
6. **X4** — route/model + single-resident (S1 + Jarvis).  
7. **X5–X6** — agent/tools.  
8. **X7–X8** — companion.  
9. **X9** — idle.

No paralelizar X1+X2+X4 en un solo diff: más difícil de bisectar.

---

## 4. Reglas de tamaño (mantenibilidad)

| Señal | Acción |
|-------|--------|
| Archivo de turn &gt; 800 líneas | Priorizar siguiente X* |
| Nueva feature toca 3+ concerns en el turn | Primero extraer, luego feature |
| Copy-paste de regex de docs/files | Debe vivir en packet o módulo de path |

---

## 5. Criterios de aceptación globales

- [ ] `runChatOrchestrationTurn.ts` &lt; 1000 líneas (hito intermedio); meta &lt; 500.  
- [ ] Cada módulo X* con test mínimo o smoke en tester.  
- [ ] `npm run release:check` / readiness sin bloqueo P0.  
- [ ] Chat íntimo no recibe library/docs salvo packet.  
- [ ] Un solo modelo residente no regresa a “doble load” por la extracción.

---

## 6. Fuera de alcance

- Microfrontends o partir el renderer en packages.  
- Reescribir providers LMS/Ollama desde cero.  
- Mover UI (MessageBubble) en la misma oleada que X1–X3.

---

*Documento vivo: marcar X0–X9 al cerrar cada rev.*


### Progreso rev.fy

X2 `turn-document-path.ts` · X3 `turn-stream-helpers.ts` · D3 tests · orquestador ~1460 líneas.


### Progreso rev.fz

X4 `turn-route-and-model.ts` — sticky en doc turns · orquestador ~1426 líneas.


### Progreso rev.ga

X5 `turn-agent-tools.ts` + gate `needsTools` en postReplyHarness · chat puro no ejecuta host tools.


### Progreso rev.gb

X6 `turn-file-nl.ts` — protocolo NL→APP_ACTION; harness full en task=files; FILE_INTENT ampliado.


### Progreso rev.gc

X7 stream-done → initiative · X8 intimacy inject gated by packet.


### Progreso rev.gd

X9 idle-review (pure) + idleReviewRuntime — harvest/consistency fuera del turn.
