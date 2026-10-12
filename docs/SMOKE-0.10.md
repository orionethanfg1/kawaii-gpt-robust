# Smoke 0.10.0

```bash
npm run verify:step1
npm run smoke:step3
```

Manual (detallado): [RELEASE-0.10.md](./RELEASE-0.10.md)

1. Arranque limpio
2. hola → respuesta
3. self-check / corre tests internos
4. busca en la web … → web:N o web:0
5. gracias linda → sin harness
6. recupera ajustes → informe score
7. foto tuya → meta identidad
8. Plugins panel → disco + builtin


Ver también: [ENGINEERING.md](./ENGINEERING.md) (carril E).


## E2 contratos (automatico)

npm run verify:step1
npm run smoke:step3
npm run release:check

Checklist completo y limitaciones: [RELEASE-0.10.md](./RELEASE-0.10.md) (E3).


## E-SMOKE+ (rev.k)

\`npm run release:check\` incluye:
- initiative waitMinOverride / hook resolveDelayMs
- humanize stripForgeScare / forgeFocus
- identity-match plugin + tools
- health_forge no JSON-ok en stopped


## S1 — Chat local estable (checklist manual)

1. LM Studio o Ollama con un modelo 8–14B cargado; servidor en marcha.
2. Enviar 10 mensajes cortos seguidos («hola», «cómo estás», «cuenta hasta 3», …).
3. Criterio: sin banner «modelo local no respondió» si hubo texto; sin freeze; sin borrar la respuesta.
4. Un mensaje largo (~200 palabras pedidas): debe completar o cortar limpio, no error falso.
5. «corre un autodiagnóstico» → informe host, no narrativa 1/6 inventada.
