# Tabla de scores Auto (fuente de verdad)

Implementación: `scoreModelForTask` en `task-route.ts`.  
Valores relativos (más alto = mejor). El hardware entra vía `scoreModelFit` (~0–20 tras `/5`).

| Tarea | Capacidad requerida | Bonos principales | Penalizaciones |
|-------|---------------------|-------------------|----------------|
| **chat** | — | 7–15B +8; reason/tools/vision leves | ≥24B −18; 16–23B −4; embed −50 |
| **code** | code (+25 / −20) | code +12, reason +4 | vision-only −4; 27B+ −15 |
| **vision** | vision (+25 / −20) | vision +15 | sin vision −20 |
| **summary** | — | reason +6, chat +2 | 27B+ −15 |
| **reason** | — | reason/thinking/qwen3 +12 | 27B+ −8 (más tolerante) |
| **tools** | — | tools +8, reason +6 | — |
| **intimacy** | — | abliterated/uncensor/dolphin/hermes **+40** | qwen/llama/gemma alineados **−18**; RP nsfw solo +8 |

### Preferencia companion (opt-in adulto)

Si `preferUncensoredCompanion`: abliterated family **+14** en chat/decision/intimacy.

### Hardware budget

`hardwareModelBudget` (C1): comfort / ok / skip según RAM. El router no elige modelos en `skip` si hay alternativa.

### minDelta (cambio de modelo)

| Tarea | minDelta |
|-------|----------|
| vision, code | 1 |
| resto | 2 |
| intimacy (resolveIntimate) | 0 |

### Precedencia pin vs Auto (R4)

Ver `docs/adr/002-auto-route-precedence.md`.
