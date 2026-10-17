# Release checklist — 0.10.10 (honesto)

**Base:** 0.10.10 · **Revisión de trabajo:** ver APP_REVISION / pie de la app  
**Tag de producto 0.10.x:** no requiere web perfecta ni paridad ChatGPT.

## 1. Automático (obligatorio verde)



- [ ] verify-step1 OK
- [ ] smoke-step3 OK
- [ ] Arranque  /  sin error esbuild/transform

## 2. Manual — núcleo chat

- [ ] «hola» → respuesta streaming (local o cloud)
- [ ] Preferencia local / offline: responde sin red si hay Ollama o LM Studio
- [ ] «corre tests internos» o self-check → ticks sin romper el hilo
- [ ] «gracias linda» → **sin** bubble harness de estado de capas
- [ ] «recupera ajustes» → informe score; **no** wipe de avatar/ficha

## 3. Manual — web

- [ ] «busca en la web …» → pie  o  con explicación
- [ ] Si N=0, el modelo **no** debe fingir que buscó con éxito

*Limitación aceptada:* backends públicos pueden fallar; SearXNG local mejora hits pero no es obligatorio para el tag.

## 4. Manual — imagen / Forge

- [ ] «haz una foto tuya» → meta con refs / FaceID applied **o** aviso explícito si no hay FaceID/Forge
- [ ] Al arrancar Forge desde chat: progreso legible (R2 unload si había LLM grande; no quedarse en «0% (error)» sin mensaje)
- [ ] Sujeto no humano (p. ej. dragón) **no** debe heredar FaceID del avatar
- [ ] Historial: imágenes siguen viéndose tras reinicio (ruta disco / kawaii-media), sin llenar localStorage de base64

*Limitaciones aceptadas:*
- Hi-Res / lado largo ~2K puede ser lento u OOM en GPU ~8–12 GB
- LM Studio no tiene unload público fiable (R2 es sobre todo Ollama)
- Score InsightFace es opcional; sin él el pie puede decir FaceID applied sin similitud numérica

## 5. Manual — plugins / iniciativa

- [ ] Panel Plugins → builtin + disco; ▶ tool ejecuta algo visible
- [ ] Minimizar app → iniciativa (si está activa) → toast → clic vuelve a la ventana

## 6. Limitaciones explícitas del 0.10.x (no son bugs del checklist)

| Tema | Estado 0.10.x |
|------|----------------|
| Identity-match plugin (pre+post) | No cerrado — E4 |
| Typecheck global limpio | Puede haber errores fuera de los módulos tocados |
| Pack NSIS firmado / auto-update | Camino 1.0 |
| Paridad visual ChatGPT | No prometida |
| Biometría legal | No aplica |

## Criterio de “listo para usar 0.10.10”

1. Automático verde  
2. Chat usable local y/o cloud  
3. Recovery no destruye personaje  
4. Imagen: aviso honesto o generación con meta  
5. Web: pie honesto  

No bloquean el uso diario: typecheck residual, web 0 hits ocasional, FaceID imperfecto si las refs son malas.
