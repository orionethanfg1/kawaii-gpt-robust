> **ARCHIVO HISTÓRICO — no usar para desarrollo actual.**
> Fuente de verdad: `docs/MISSION.md`, `docs/ROADMAP.md`, `docs/BETA-0.12.md`, `docs/SMOKE-0.12.md`.

> **Obsoleto para 0.12+.** Ver `docs/BETA-0.12.md` y `docs/SMOKE-0.12.md`.

# Smoke hacia 0.11

```bash
npm run verify:step1
npm run smoke:step3
npm test -- --run src/core/chat/think-auto.test.ts
npm run release:check
```

## Checklist manual (prioridad humana)

1. Arranque → hola (respuesta natural, sin JSON de host).
2. Think: ciclo off → on → auto en el botón 🧠 del input.
3. Auto + "por qué…" / código → panel 💭 si el runtime expone thinking.
4. Adjuntar libro/PDF largo → modo documento + extracto progresivo; pedir "sigue".
5. Busca en la web… → pie web:N o web:0 consciente.
6. Cerrar Ollama → diagnóstico humano; start_ollama sin JSON crudo (arranque diferido / ~20s wait).
7. Agenda recordatorio corto → dispara sin robotizar el tono.

## Empaquetado (cuando toque)

- `npm run build` + empaquetado Electron habitual del repo.
- No subir versión de producto a 0.11 hasta pasar release:check + checklist manual.
