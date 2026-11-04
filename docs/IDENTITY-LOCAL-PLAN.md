# Identidad local tipo ChatGPT — plan integrado

**Objetivo:** que el chat local ancle una persona (foto + ficha) y la **repita de forma fiable** al cambiar ropa/escena, con orquestación transparente (como ChatGPT) y **control fino local** (FaceID, multi-ref, filtros).

**No es biometría ni verificación de identidad.** Es identidad generativa con
ranking orientativo de candidatos mediante embeddings.

---

## Ventaja vs proveedores cloud

| Eje | Cloud típico | Kawaii local (meta) |
|-----|--------------|---------------------|
| Privacidad | Foto en terceros | Todo en disco / userData |
| Offline | No | Sí (Forge + LLM local) |
| Peso FaceID / checkpoint | Opaco | Configurable |
| Multi-ref + galería | Limitado al hilo | Persistente (`kawaii-character-v1`) |
| Filtro post-gen | Raro | Plugin Python similitud |
| Coste por imagen | API | Solo electricidad / VRAM |
| Fallo de red | Rompe | Failover local/cloud del **chat**; imagen local sigue |

---

## Stack de identidad (capas)

```
Chat (intención + SceneSpec)
  → Política: ¿autorretrato / misma persona?
  → Refs: avatar + galería (1–3)
  → Forge: FaceID Plus v2 (peso ~0.8–0.85) + checkpoint de identidad fijo
  → Plugin Python opcional: FaceID Plus + ArcFace → ranking relativo de candidatos
  → Si no hay scorer: conservar candidato y avisar; nunca inventar un score
  → Guardar en galería / última del hilo
```

### Tecnologías (prioridad realista en ~12 GB VRAM)

| Prioridad | Técnica | Rol | VRAM / coste |
|-----------|---------|-----|--------------|
| **P0** | IP-Adapter **FaceID Plus v2** (ya en Forge) | Ancla facial flexible | +~15 % tiempo |
| **P0** | Multi-ref + ficha + SceneSpec | Orquestación tipo ChatGPT | CPU/LLM |
| **P1** | **Plugin `face_similarity`** (InsightFace / ArcFace) | Ranking relativo de caras detectables; no certifica identidad | CPU, modelo local opcional |
| **P1** | Checkpoint fijo + candidatos secuenciales + ranking opcional | Elegir el mejor candidato medido | Tiempo de generación |
| **P2** | InstantID (SDXL) o PuLID (si migráis base) | Más lock facial | +VRAM |
| **P3** | LoRA del personaje (5–15 fotos) | Máxima fidelidad a largo plazo | Entrenamiento 1 vez |

**Default de producto:** FaceID Plus v2 + referencias secundarias controladas + ranking opcional.
InstantID/PuLID/LoRA = opcionales cuando el usuario pida “más precisión” o haya VRAM.

---

## Plugins Python — refinamiento

Hoy `tools/` es scripts sueltos (`forge_probe`, `faceid_check`, …). Objetivo: **catálogo de plugins** que el host/chat pueda invocar.

### Contrato de plugin

```text
tools/<id>.py
  --json  → stdout una línea JSON: { "ok": bool, "tool": str, "summary": str, ... }
  exit 0 siempre que el fallo sea “de negocio”; exit ≠0 solo crash
```

| Plugin | Estado | Función |
|--------|--------|---------|
| `forge_probe` | existe | API Forge, checkpoints, ControlNet |
| `faceid_check` | existe | Archivos FaceID en disco |
| `prompt_scene_preview` | existe | Preview SceneSpec |
| `clean_diagnostics` | existe | Limpieza |
| **`face_similarity`** | **nuevo (P1)** | score ref vs generada |
| `identity_policy` | plan | ¿Forzar FaceID? pesos sugeridos |
| `pick_best_of_batch` | plan | elige imagen con mejor score |

### Runtime

- Invocación vía `python-ipc` / harness host (mismo patrón que probes actuales).
- Dependencias pesadas (**insightface**, onnxruntime, OpenCV, NumPy) = **opcionales**: si faltan, se devuelve estado sin score.
- `buffalo_l` debe estar instalado localmente; el scorer no descarga paquetes ni modelos y no envía imágenes fuera del equipo.
- Se puntúa el lote con una sola carga del modelo; sin método ArcFace aceptado no se ordena por sustitutos como histogramas de color.
- El coseno no usa un umbral universal ni se presenta como “misma persona”; no dispara regeneración automática.

---

## Fases de implementación

### I0 — Política en app (sin deps nuevas) · **siguiente código**
- [x] Autorretrato / soy yo → FaceID obligatorio (0.9.97)
- [x] Refs multi: avatar + galería (pickIdentityReferenceUrls)
- [x] `preferredIdentityCheckpoint` en settings (se guarda al generar autorretrato)
- [ ] Meta UI: `FaceID · score pendiente` / `sin FaceID (solo texto)`
- [ ] “Última imagen del hilo” como ref al decir “cámbiale el fondo”

### I1 — Plugin similitud · **ventaja calidad**
- [x] `tools/face_similarity.py` (JSON out)
- [x] Tool host `score_face_match` + `python:runToolScript`
- [x] Tras batch: ranking relativo con ArcFace cuando está disponible; una carga por lote
- [x] Sin score o dependencia: no usar proxy ni inferir coincidencia
- [ ] Calibrar cualquier criterio de aceptación con un conjunto local anotado y evaluación humana; no hay umbral universal
- [ ] Feedback 👍/👎 solo después de definir consentimiento, retención y protocolo de evaluación

### I2 — Rendimiento
- [ ] No cargar InsightFace hasta la primera gen con identidad
- [ ] Cache embedding del avatar (no recomputar cada vez)
- [ ] Batch paralelo solo si VRAM libre (layer-scheduler)
- [ ] Preferir SD1.5+FaceID en 8–12 GB; SDXL/InstantID solo si hay margen

### I3 — Nivel “personaje permanente”
- [ ] Export set de 5–15 refs → guía LoRA (script / doc; entrenamiento opcional)
- [ ] Evaluar InstantID si el stack pasa a SDXL de forma estable

---

## Relación con Hito 3

| Bloque Hito 3 | Encaje |
|---------------|--------|
| 3.A Fiabilidad | dataUrl, errores Forge |
| 3.B Framing/ropa | SceneSpec sin diluir cara |
| **3.C Identidad** | **este documento = ampliación de 3.C** |
| Memoria / character store | `kawaii-character-v1` + backups |

---

## Métricas de éxito

1. ≥ 80 % de autorretratos “aceptables” sin regen manual (evaluación humana ciega; el score no sustituye este criterio).
2. Cambio de outfit/escena **sin** cambiar de persona percibida.
3. Offline: gen con identidad sin API cloud.
4. Si falta FaceID: mensaje claro + `ensure_faceid`, nunca silencio.

---

## Principio de ingeniería

> **Perder la cara del personaje es un bug de producto**, igual que perder la ficha en settings.
> Respaldo de refs, política FaceID y filtro de similitud son la red de seguridad.
