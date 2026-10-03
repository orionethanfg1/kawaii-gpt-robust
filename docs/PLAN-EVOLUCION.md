# Plan de evolución — KawaiiGPT Robust

**Fecha:** 2026-09-27 · **Versión app de referencia:** 0.9.50+  
**Principio:** no reentrenar el LLM base; **evolucionar el sistema** (memoria, routing, prompts, feedback).

---

## 1. Selección de modelo: capacidades primero (visión / código / razonar)

### Problema
Si el usuario descarga modelos con **Visión**, **código/archivos** o **razonamiento**, Auto no debe quedarse en un chat genérico (p. ej. qwen2.5:14b) solo por latencia. Hay que **usar la capacidad cuando la tarea la pide** y, en modo Auto general, preferir el instalado **más completo que quepa en el equipo**.

### Criterio de diseño
| Situación | Qué elegir |
|-----------|------------|
| Usuario **fijó** modelo (pin) | Respetar pin |
| Tarea **visión** (foto adjunta / “qué hay en la imagen”) | Mejor instalado con cap `vision` que quepa en RAM/VRAM |
| Tarea **código** | Mejor con cap `code` / coder |
| Tarea **tools / harness** | Preferir `tools` + `reason` si existen |
| Tarea **chat** general + Auto | Entre instalados que **entren**, maximizar: reason > tools > vision (bonus) > calidad chat; **penalizar** solo por no caber o ser absurdo de lento |
| Hardware justo | No forzar 27B+ si RAM/VRAM no dan; elegir el más capaz **dentro del presupuesto** |

### Implementación (bloque **M1**)
1. Unificar `scoreModelForTask` con `inferModelCapabilities` + `scoreHardwareFit` (ya existen en `capabilities.ts`).
2. Auto (mejor local): `prefer: 'balanced'` con bonus por reason/tools/vision **si caben**.
3. UI: badges Razonar / Herramientas / Visión en el modelo activo y en el motivo de ruta (“elegido por visión”).
4. Telemetría: si un modelo con vision falla o es lento, sesgo negativo **solo para visión**, no para chat.

**Aceptación:** con un VL y un 14B chat instalados, “describe esta foto” → VL; pin manual no se pisa.

---

## 2. Imagen: escena completa (no solo ID / ropa)

### Problema
El generador ignora cuerpo entero, outfits y escena. El LLM de chat a veces responde “aquí tienes la imagen” sin dirigir bien a SD.

### Enfoque (como productos serios)
**Dos etapas host-owned:**
1. **Director de escena** (LLM local con buen instruction-following / reason si está disponible):  
   Usuario NL → **JSON de escena** (sujeto, identidad self/other, framing, pose, ropa, materiales, fondo, luz, cámara, mood, negative hints).
2. **Composer determinista** (código): JSON → tags SD + tamaño + FaceID weight + ControlNet + batch.

El LLM **no** inventa inventarios de la app; solo estructura la escena. El host valida y rellena defaults.

### Lujo de detalle (campos del JSON)
- `subject`, `isSelf`, `framing` (close|half|full|wide)
- `pose`, `expression`
- `clothing[]` (prenda, color, material, fit)
- `hair`, `eyes` (solo si other o override explícito; self → identity lock)
- `environment`, `timeOfDay`, `lighting`, `camera`
- `mustInclude[]` / `mustAvoid[]`
- `aspectHint`

### Implementación (bloque **I1–I3**, Hito 3)
| ID | Trabajo |
|----|---------|
| I1 | Schema `SceneSpec` + parser LLM (JSON) + fallback regex actual |
| I2 | `sceneSpecToSdPrompt` (orden: framing → outfit → escena → estilo; full body primero) |
| I3 | FaceID dinámico; banner si falta modelo; progress en chat |
| I4 | Tests: cuerpo entero, catsuit, vestido azul, self+override ropa |

**Aceptación:** “cuerpo entero… catsuit… calle de noche” → full frame + prenda + noche en ≥2/3 del batch.

---

## 3. Memoria / “aprendizaje” sin reentrenar

### Qué NO haremos por defecto
- Fine-tune completo del GGUF en cada PC del usuario (coste, riesgo, complejidad).
- Sustituir el modelo base por uno “personal” opaco.

### Qué SÍ (evolución del sistema — estándar 2025–2026)

Industria (RAG preferente, memoria grafo, feedback sparse, prefijos): personalización **training-free** o con adaptadores opcionales.

| Capa | Qué es | Estado app |
|------|--------|------------|
| **A. Memoria estructurada** | Hechos, likes, focus, personas, resumen de vínculo | Parcial (`user-memory`) |
| **B. Memoria episódica** | Resumen por conversación + recuperación al abrir temas | Débil |
| **C. Preferencias de imagen** | “Le gusta batch 3”, “prefiere full body”, colores que pidió | Casi no |
| **D. Feedback explícito** | 👍/👎, “no eres tú”, “más parecida” → ajusta pesos/prompt | Parcial likes |
| **E. RAG local** | Índice de mensajes/hechos del usuario (embeddings locales) | No |
| **F. (Opcional tarde)** | LoRA/prefijo **opcional** generado offline si el usuario lo activa | No |

### Principio
El **modelo base no cambia de pesos** en el flujo normal.  
**Evoluciona** el *contexto inyectado*, las *reglas de routing*, los *defaults de imagen* y la *memoria recuperada* — igual que ChatGPT “recuerda” sin reentrenar GPT en tu laptop.

### Implementación (bloque **P1–P3**)
1. **P1** — Ampliar `userMemory`: preferencias de imagen, estilo de respuesta, “no hacer X”.  
2. **P2** — Tras cada N mensajes o al cerrar chat: resumen episódico host-side → store.  
3. **P3** — Recuperación: al generar prompt de sistema, top-k hechos + último resumen relevante (embebido local opcional).  
4. **P4** — Feedback 👎 en imagen → bajar FaceID / forzar batch / anotar “falló outfit”.  
5. **P5 (opcional)** — Export/import de memoria; “olvidar esto”.

**Aceptación:** tras decir “me llamo X y odio el rojo en fotos”, semanas después self-gen evita rojo y usa el nombre sin re-explicar.

---

## 4. Roadmap unificado (prioridad)

### Sprint A — Routing inteligente (1–2 iteraciones)
- [x] M1: Auto por capacidades + hardware (0.9.51)  
- [ ] Pin ya hecho (0.9.50); UI motivo “por visión/código/reason”  
- [ ] Tests de score con VL + coder + chat instalados  

### Sprint B — Hito 3 imagen al 100% (2–4 iteraciones)
- [x] I1 SceneSpec heurístico + I1b JSON LLM parser (refine opcional)  
- [ ] I2 Composer escena rica  
- [x] I3 FaceID missing banner + progress (0.9.52)  
- [ ] I4 Tests aceptación cuerpo/ropa/self  
- [ ] (ya) full body tags, outfit extract, no éxito vacío  

### Sprint C — Memoria evolutiva (2–3 iteraciones)
- [ ] P1–P3 memoria + recuperación  
- [ ] P4 feedback → defaults  
- [ ] Panel “Lo que sé de ti” editable  

### Sprint D — Producto
- STT, instalador NSIS, stream local IPC, llama.cpp embebido (medio plazo)

---

## 5. Filosofía en una frase

> **El cerebro (GGUF) es plug-in; la inteligencia de la app es routing + memoria + dirección de escena + governor.**  
> Así “evoluciona” sin reentrenar: cada sesión deja el sistema más alineado contigo, no un checkpoint nuevo.

---

## 6. Métricas de éxito

1. Auto elige modelo con la **capacidad pedida** cuando está instalada y cabe.  
2. Escenas complejas se reflejan en la imagen (framing + outfit + entorno).  
3. Preferencias de usuario **persisten** entre chats sin fine-tune.  
4. Pin manual nunca se pisa; Auto documenta el *porqué* del modelo.

## Identidad local (2026-09)

Ver [IDENTITY-LOCAL-PLAN.md](./IDENTITY-LOCAL-PLAN.md): FaceID + multi-ref + plugin similitud + ventaja offline vs cloud.
