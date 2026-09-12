# Roadmap y estado (v0.9.26)

## Objetivo del producto
Chat de escritorio **híbrido** (Ollama/LM Studio + cloud) con **personalidad visual**, capas generativas **locales** (imagen Forge, música ACE, voz TTS) y un **Harness** que conoce el estado real de la app y actúa por el usuario — sin que tenga que pelearse con Ajustes.

Principios:
1. **Hechos en el host**, conversación en el LLM (no inventar modelos ni "todo OK").
2. **Capas bajo demanda** (VRAM): no arrancar Forge + ACE juntos al boot.
3. **Identidad visual solo cuando el usuario pide "tú"**; "otra persona" no hereda a Niamh.
4. Calidad local primero; cloud como respaldo consciente.

## Hecho (estable)
| Área | Estado |
|------|--------|
| Chat local/cloud + failover | OK |
| Personalidad + ficha visual + galería | OK (regen multi-foto) |
| Imagen Forge local + presets estilo | OK |
| Self vs otra persona (intent) | OK (0.9.24–26) |
| Nombre de imagen + renombrar chat | OK (pulido 0.9.25–26) |
| Música ACE bajo demanda | OK |
| Voz TTS LATAM | OK (auto-play opcional) |
| Harness plan/tools + estado host | OK |
| Actividades (aventura, ajedrez) + compañera | OK base |
| Tester QA + likes/dislikes | OK |
| Scheduler de capas | OK parcial |
| Auto-arranque Forge con progreso en chat | OK (0.9.25) |

## Brechas → objetivo (prioridad)
### P0 — experiencia "tipo Grok/ChatGPT" en generación
1. Consistencia facial (IP-Adapter / ControlNet al avatar) en "foto tuya"
2. Batch 2–4 seeds + elegir mejor (menos two-heads / basura)
3. Revisar imagen por lenguaje natural sin perder sujeto
4. Framing full-body fiable (prompt + tamaño) — reforzado 0.9.26

### P1 — inteligencia Harness
5. Registry de capacidades vivo en **cada** system prompt (ya existe módulo; auditar cobertura)
6. El chat arranca/para capas solo cuando hace falta, con feedback de progreso unificado
7. Memoria de usuario + evolución de relación más visibles y estables
8. Iniciativa no repetitiva (LLM + cooldown por tono) — existe; afinar prompts

### P2 — producto
9. STT / micrófono
10. Empaquetado NSIS + launcher final para usuarios inexpertos
11. Más pesos ControlNet + uso automático
12. Motor de ajedrez más vivo (dificultad adaptativa + chat en partida)

## Evitar
- Arrancar Forge+ACE al mismo tiempo en boot
- Confiar en el LLM para inventarios de modelos
- Aplicar ficha de personaje a sujetos "otra persona"
- Stubs rotos en `@core/generative` exports
