**Ver también:** [PLAN-EVOLUCION.md](./PLAN-EVOLUCION.md) (routing por capacidades, memoria sin reentrenar, SceneSpec).

# Hito 3 — Plan al 100% (actualizado con capturas)

## Evidencia de fallos

| Petición | Resultado | Causa probable |
|----------|-----------|----------------|
| Foto tuya / vestido azul | Cara ≠ avatar; ropa roja | FaceID ausente o peso/ref bloquean outfit |
| «Aquí tienes la imagen» vacío | Sin adjunto | Éxito sin `dataUrl` |
| **Cuerpo entero + ojos azules** | Solo primer plano | Sesgo SD a face; framing/AR/tags débiles |
| **Chica en catsuit** | Retrato sin prenda | Outfit no anclado; negative/style de portrait |

## Cómo lo resuelven otros

**Stable Diffusion (comunidad):**
- `(full body:1.4)` **al inicio** del prompt
- Anclas inferiores: `shoes`, `feet visible`, `standing on floor`
- Negatives: `close-up, headshot, cropped legs, missing feet`
- Canvas **vertical** (p.ej. 768×1152), no cuadrado
- Quitar del positive: `portrait`, `85mm`, `close-up`

**Midjourney / OpenArt:**
- AR alto primero (`2:3`, `9:16`)
- “full body” en las **primeras 10 palabras**
- Nombrar calzado + suelo para forzar pies en frame

**ChatGPT / moda AI:**
- Describir prenda con material/corte (`catsuit`, `tight`, `full coverage`)
- Pedir “entire figure visible” de forma explícita

## Qué nos faltaba (gap)

1. **Framing → tamaño** no siempre aplicado en el path de chat  
2. Tags de cuerpo entero poco pesados y **después** de identity/style portrait  
3. **Outfit genérico** (catsuit, etc.) sin extractor dedicado  
4. Presets de estilo con **85mm / portrait** que ganan al full body  
5. FaceID / identity (otro eje; ver 3.B)

## Fases (orden de ataque)

### 3.A Fiabilidad — P0
- [x] No éxito sin `dataUrl` (0.9.48)
- [ ] Progress + errores tipados (Forge / timeout / sin modelo)
- [ ] Logs de prompt final en meta (debug en UI avanzado)

### 3.B Composición / encuadre / ropa — P0 (núcleo de estas capturas)
- [x] `(full body:1.5)` + pies/suelo + negatives anti-closeup (0.9.49)
- [x] `recommendSdParams` según framing en chat (0.9.49)
- [x] `extractOutfitTags` (catsuit, vestido+color, pantalón…) (0.9.49)
- [x] Framing `cuerpo entero` + lead order full-first (0.9.49)
- [ ] Tests unitarios: “cuerpo entero” → framing full + size alto; “catsuit” → tags
- [ ] enable_hr / hires soft opcional en Forge para full body

### 3.C Identidad facial — P0

> Plan ampliado (tipo ChatGPT local + plugins): [IDENTITY-LOCAL-PLAN.md](./IDENTITY-LOCAL-PLAN.md)

- [ ] Política: autorretrato → FaceID ON + multi-ref
- [ ] Plugin  post-gen (opcional)
- [ ] Auto-regen si score bajo
- [x] Almacén identidad 

- [x] Peso dinámico, Plus v2, batch auto, ropa baja peso
- [ ] Banner si no hay modelo FaceID en ControlNet
- [ ] Preferir crop de cara del avatar
- [ ] ADetailer opcional

### 3.D Revisión NL — P0/P1
- [x] Colores de vestido amplios
- [ ] “otro intento” → nueva seed + batch
- [ ] No reinyectar outfit viejo al contradecir

### 3.E UX chat — P1
- [ ] Regenerar / Más cuerpo / Más cara
- [ ] Mostrar encuadre detectado (“full · 768×1152”)

### 3.F Avanzado — P2
- Character LoRA, InstantID/SDXL, métricas de similitud

## Criterios de aceptación ampliados

1. “Cuerpo entero” → se ve **de cabeza a pies** en ≥2/3 del batch (no solo busto).  
2. “Catsuit” / “vestido azul” → prenda **dominante** en el frame.  
3. “Foto tuya” + avatar + FaceID → identidad reconocible.  
4. Fallo de gen → error explícito, nunca éxito vacío.  
5. Offline con stack instalado → gen local OK.

## Próximo sprint recomendado

1. Tests de `parseImageIntent` + `extractOutfitTags` + `composeImagePrompt`  
2. Banner FaceID missing  
3. Meta `imageFraming` + botón Regenerar en chat  
4. Hires fix ligero en Forge para full body  
