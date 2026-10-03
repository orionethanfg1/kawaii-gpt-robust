# Roadmap — ingeniería primero

**Actual:** v0.10.10 rev.b (trabajo)

## Principio
1. Carril **E** (ingeniería) antes que features grandes nuevas.
2. Cada feature extrae módulo o plugin; no crecer useChat / image-ipc / forge-runtime.
3. Versionado: [VERSIONING.md](./VERSIONING.md) — misma base 0.10.10 + rev.n para hotfixes.

Detalle de reglas: [ENGINEERING.md](./ENGINEERING.md)

## Hecho (base 0.10)

- M1–M4 monolitos principales
- P0.1 iniciativa, P0.2 ensureForgeReady, P0.3 web, P2.1 plugins panel, D1 backups
- R2 unload Ollama antes de Forge (rev.b)
- Face prompt corrections (commit 54c4898 — multiple faces, violet eyes, same person)

## En curso / validar en máquina

| ID | Qué | Notas |
|----|-----|-------|
| V1 | Forge desde chat | Mensaje de error real + R2 visible |
| V2 | Autorretrato | Face corrections + refs; no solo tags |

## Siguiente — Carril E

| ID | Bloque | Prioridad |
|----|--------|-----------|
| **E0** | Higiene repo + docs ingeniería | Ahora |
| **E1** | forge-api-resolve (image-ipc) | Hecho rev.c |
| **E2** | verify/smoke R2 + resolve | Hecho rev.d |
| **E3** | Release checklist 0.10.x honesto | Hecho rev.e |
| **E4** | Plugin identity-match (pre+post) | Tras E0–E2 |

## Más adelante (1.0)

- Pack instalable, E2E Playwright, memoria evolutiva, plugins terceros

## No priorizar

- Refactor total de useChat de un golpe
- Paridad ChatGPT / biometría legal
- Catálogo HF completo
