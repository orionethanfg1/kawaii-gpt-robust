# Plan de bloques — hacia 0.10 / 1.0 (actualizado 2026-09-30)

Basado en: identidad I0/I1 (0.9.97–0.9.98), backups, recovery, y registros de error de uso real.

## Registros de error (evidencia)

| # | Qué pidió el usuario | Qué hizo la app | Causa probable |
|---|----------------------|-----------------|----------------|
| E1 | «dame un resumen de los comentarios» | LLM interpretó comentarios del chat, no 👍/👎 | Detección de informe exigía informe/exportar |
| E2 | «likes y unlikes, resumen» | Misma confusión | unlikes/resumen poco cubiertos |
| E3 | «foto tuya» autorretrato | Cara genérica distinta del avatar | Ref FaceID no aplicada o débil |
| E4 | FaceID ausente (histórico) | Solo texto | ControlNet / reinicio Forge |
| E5 | Harness colgado (histórico) | UX confusa | Mitigado; vigilar |
| E6 | Wipe ajustes (histórico) | Defaults | character store + recovery |
| E7 | «he estado avanzando…» | Estado de capas espontáneo | `/estado/` en wantsStatus |
| E8 | FaceID 3 refs, cara genérica | Otra persona | Likes contaminaban refs |

Corrección: detección feedback ampliada (0.9.99).

## Razonamiento del modelo

1. Datos de app (likes, Forge, FaceID, rutas) → **host / tools**, no inventar.
2. Escena creativa / ambigüedad de imagen → **LLM con reasoning** si el modelo lo tiene.
3. Petición operativa ambigua («comentarios») → host-first.
4. No usar 27B sin aviso.

## Bloques pendientes

### B1 Feedback (P0)
- [x] Informe exportable
- [x] Detección resumen/comentarios/unlikes
- [x] Explicar likes (host) + detección resumen
- [x] 👍 imagen → liked-image-memory (+ dataUrl si cabe)

### B2 Ref visual autorretrato (P0)
- [x] Meta imageHasReference / imageRefCount + aviso si self sin FaceID
- [x] Aviso honesto self sin FaceID / sin ref
- [x] Liked dataUrls en pickIdentityReferenceUrls
- [ ] Meta UI: N refs · FaceID

### B3 Score batch (I1 resto)
- [x] Plugin + score_face_match
- [x] Rankear batch por face_similarity si hay deps (sin auto-regen aún)

### B4 Routing + reasoning
- [x] Host-first feedback (prev)
- [x] Task `reason` + boost reasoning models
- [x] Penalización 27B+ en chat casual

### B5 Hito 3 framing/errores
### B6 Ruteo Ollama/LM
### B7 E2E → **0.10**
### B8 LoRA/InstantID → camino **1.0**

## Versiones

| Versión | Bloques | Criterio |
|---------|---------|----------|
| 0.10 | B1–B4, B6, B7 (~6–8) | Feedback OK; ref real o aviso; routing; smoke |
| 1.0 | +B5 +B8 +pack (~10–14 más) | Identidad estable; offline; instalador |

Orden: B1 → B2 → B4 → B3 → B6 → B7 (0.10) → B5/B8 (1.0).
