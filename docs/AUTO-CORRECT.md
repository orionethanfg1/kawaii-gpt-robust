# AC1 — Autocorrección segura

## Flujo
1. **Detectar** — tool host falla (`recordToolFailure` + resultado del plan).
2. **Proponer** — `proposeRecoveryAfterFailure` → mensaje es-MX + `nextTools`.
3. **Ejecutar** — si `safeAuto` y `shouldSkipTool` no bloquea: un follow-up (`start_forge`, `start_ollama`, `ensure_faceid`, …) vía `approve` + `executeAppTool`.
4. **No repetir** — `failure-memory` cooldown; si el recovery también falla, no martillar.

## Qué es seguro auto
- `start_forge` / `start_ollama` / `ensure_faceid` (instalación conocida) cuando el fallo previo lo indica.
- Nunca `delete_model` ni acciones destructivas.

## Qué no hace
- No inventa tools nuevas.
- No sustituye la voz del personaje: el mensaje de recovery se humaniza y el LLM puede reformular.
- No reabre FaceID “a ciegas” en generación; solo instala/arranca cuando el diagnóstico lo pide.

## Módulo
`src/core/agent/auto-correct.ts` — sin tocar el monolito de chat.


## AC2 — Plan breve + segundo paso seguro

- `planSteps` en la propuesta (1–3 pasos en es-MX)
- `formatRecoveryProposal` incluye el plan y avisa si hará auto-follow
- Tras un `safeAuto` exitoso, un 2º tool solo si es de lectura/salud:
  `health_forge | get_app_status | check_local_runtime | list_installed_models | probe_forge`
- Más reglas: web_search, pistas LM Studio, status con capa caída
