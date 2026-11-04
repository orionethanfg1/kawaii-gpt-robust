# Capa de decisión + convivencia Jarvis / Companion

**Estado:** plan de producto e ingeniería (0.12.x → 0.13)  
**Prioridad:** 1) estabilidad de la app · 2) modo Jarvis (utilidad) · 3) companion coherente que convive, no compite.

Complementa: `MISSION.md`, `JARVIS-AGENT.md`, `ROADMAP.md`, `HARNESS.md`, `PLUGINS.md`.

---

## 1. Principio de convivencia

```
Usuario
  → DecisionPacket (señales baratas; opcional semántica)
  → Orquestador / harness (un solo LLM residente)
       ├─ lado Jarvis: tools, archivos, agenda, web, imagen, host acotado
       └─ lado Companion: tono, memoria afectiva, escena, iniciativa
  → Host (IPC, allowlist, confirmación, audit)
```

- **Jarvis** decide *qué hacer* (ruta, tools, riesgo, qué inyectar al prompt).
- **Companion** decide *cómo decirlo* (persona, vínculo, escena).
- Un solo modelo en VRAM ejecuta ambos lados; no un “modelo Jarvis” + un “modelo novia” a la vez.
- Instrucciones de app (`[APP]`, harness, continue-doc) **nunca** se presentan como voz del usuario.

Si hay tarea clara (archivo, código, lectura, agenda) → utilidad primero; el tono companion se mantiene sin sustituir la tarea.  
Si hay charla / vínculo / escena → companion primero; tools solo si el usuario o el DecisionPacket lo piden.

---

## 2. Reutilizar lo ya construido (no reinventar)

| Pieza existente | Rol en el plan |
|-----------------|----------------|
| `classifyChatTask` / task-route / auto-route | Semilla de `task` + `modelHint` |
| `intimacy-stage` / `intimacy-memory` / chip cercanía | `scene`, sticky, exit |
| Harness + `list_installed_models` anti-alucinación | Observaciones reales |
| Tools A1–A4 (inventario, describe, mutate+ticket, edit) | Brazo Jarvis archivos |
| Plugins Python (identity, face, …) | Extensión on-demand, no hot path |
| Ingesta docs / map-reduce / biblioteca | Contexto bajo demanda, no en cada mensaje |
| Memory write log + sanitize | Estabilidad de memoria |
| path-boundary + mutation tickets | Seguridad Jarvis |
| Tray + agenda snapshot | Residencia SO |
| Unload / single-resident LMS/Ollama | Estabilidad VRAM |

**Regla:** todo avance nuevo debe *consumir o extender* estas piezas, no duplicar diccionarios en Python y TS.

---

## 3. DecisionPacket (contrato único)

Objeto interno (TypeScript primero), relleno **antes** de armar el prompt y de elegir modelo:

```ts
type DecisionPacket = {
  task: 'chat' | 'intimacy' | 'code' | 'docs' | 'files' | 'image' | 'agenda' | 'review' | 'mixed'
  risk: 'low' | 'high'           // mutación, adulto, escritura
  scene: 'none' | 'hold' | 'soften' | 'exit'
  needsVision: boolean
  needsWeb: boolean
  needsTools: boolean
  modelHint: 'sticky' | 'chat' | 'intimate' | 'coder' | 'vision'
  inject: {
    library: boolean
    docs: boolean
    fullHarness: boolean
    intimacyBlock: boolean
  }
  reason: string                 // trazabilidad obligatoria
  confidence: 'high' | 'low'
}
```

- Cada campo tiene **reason** (o un `reason` global) para depurar y tests.
- `inject.*` evita inflar prefill (docs/harness solo cuando toca).
- `confidence: low` → no forzar cambio de modelo; no mutar sin confirmación.

### Fases de implementación

| Fase | Qué | Dónde | Estabilidad |
|------|-----|-------|-------------|
| **D0** | Definir tipo + builder que solo *agrega* señales actuales (classify + intimacy + flags adjunto) | `src/core/agent/decision-packet.ts` | Sin cambio de UX |
| **D1** | Orquestador consume `inject` y `modelHint` (deja de dispersar ifs) | `runChatOrchestrationTurn` / route | Regresión controlada |
| **D2** | Log `[decision] task=… reason=…` (como memory-write) | main/renderer | Observable |
| **D3** | Tests G0: packet para fixtures (intimacy, docs continue, code, files) | vitest | |
| **D4** | Opcional: plugin Python embeddings (rutas ES) solo si `confidence: low` o setting on | `tools/` + IPC | Off by default |
| **D5** | Idle **review**: auditar memorias/ficha/biblioteca (reglas ± modelo ligero cuando GPU libre) | scheduler / tray idle | Nunca en path caliente |

Python **no** es el decisor por defecto en cada mensaje; es **extensión** (D4/D5) alineada con plugins existentes.

---

## 4. Prioridad: estabilidad → Jarvis → companion

### P0 Estabilidad (antes de más agencia)

- [ ] Un solo residente LLM (ya parcial; vigilar iniciativa + chat)
- [ ] Prefill acotado (`inject` estricto)
- [ ] Chip escena / `scenePhase` alineados (rev.ft+)
- [ ] Memoria sin ruido RP (sanitize; usuario puede curar)
- [ ] Mutaciones solo ticket + path-boundary
- [ ] Persistencia chats/settings sin QuotaExceeded (disk spill)
- [ ] `gate:g0` / release:check en verde

### P1 Jarvis (utilidad)

- [ ] DecisionPacket D0–D3 cableado al orquestador
- [ ] Tools archivos usables desde lenguaje natural con aprobación
- [ ] Biblioteca + app-context conscientes en prompt **solo** si `inject.library`
- [ ] Agenda durable; click notificación → chat (validado en dev)
- [ ] Comandos host allowlist (abrir carpeta, path biblioteca)
- [ ] Errores de modelo (vision, uncensored, timeout) con mensaje accionable

### P2 Companion (convive)

- [ ] Tono / memoria / escena **después** de DecisionPacket (no al revés)
- [ ] Iniciativas: timer post-stream; menos plantilla; no spamear guardarropa
- [ ] INTIMACY_* protegido en trim; chip honesto
- [ ] Guardarropa / avatar: persistencia primary, clasificación sin duplicar

### P3 Extensión semántica / idle (opcional)

- [ ] D4 plugin embeddings multilíngüe
- [ ] D5 revisor idle de memorias (propuestas, no auto-borrado agresivo)

---

## 5. Cómo el LLM “complementa ambos lados”

System prompt en capas (orden fijo):

1. **Identidad + tono companion** (corto)
2. **Decision / modo** (1 bloque derivado del packet: “ahora prioriza utilidad archivos” vs “ahora prioriza vínculo”)
3. **Tools disponibles** solo si `needsTools`
4. **Memoria / intimidad / docs** solo si `inject.*`
5. **Historial delgado**

El modelo no elige cargar otro checkpoint; el harness aplica `modelHint` con sticky y single-resident.

---

## 6. Criterios de aceptación

| Escenario | Esperado |
|-----------|----------|
| Charla íntima | `task=intimacy` o `chat`, chip en escena si aplica, sin lista de carpetas |
| “Organiza mis adjuntos” | `task=files`, harness/tools, dry-run o aprobación |
| “Sigue el libro” | `task=docs`, inject docs, mensaje system no user |
| Código | `modelHint=coder` si disponible y no pin de intimidad |
| Idle 30 min | Opcional review; no iniciativa cada 30 s |

---

## 7. Fuera de alcance inmediato

- Segundo LLM decisor en VRAM en cada turno
- Shell libre / RCE
- Auto-modificar el binario de la app
- Semantic router cloud-only como dependencia dura

---

*Documento vivo: actualizar al cerrar D0–D5 y al publicar 0.13.*


## Relación con desinflar el orquestador

Ver `docs/ORCHESTRATOR-DEFLATE-PLAN.md`. DecisionPacket es el primer módulo puro; siguen `turn-system-layers` y paths docs/route sin hinchar `runChatOrchestrationTurn.ts`.
