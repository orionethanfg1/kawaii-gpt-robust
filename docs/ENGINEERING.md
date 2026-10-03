# Ingeniería — carril estable (post 0.10.10)

**Objetivo:** tratar KawaiiGPT como producto de ingeniería: contratos, módulos, criterios de hecho, sin features decorativas hasta cerrar la base.

**Versión de trabajo:** 0.10.10 + APP_REVISION (rev.a, rev.b, …)

## Reglas (no negociables)

1. Criterio de hecho medible por bloque (pasa / no pasa).
2. No romper build; no wipe de userData; chat local usable.
3. Max 2 carriles activos a la vez.
4. Nada nuevo gordo en useChat / image-ipc / forge-runtime: extraer módulo o plugin.
5. Feature nueva (p. ej. identity-match) solo después de E0+E1 verdes o en paralelo bajo contrato de plugin aislado.

## Inventario de calor (LOC aprox., 2026-10)

| Archivo | LOC | Estado |
|---------|-----|--------|
| main/index.ts | ~100 | Bootstrap OK (M4) |
| appAgent.ts | ~355 | Orquestador OK (M2) |
| SettingsModal.tsx | ~571 | Shell + panels (M3) |
| useChat.ts | ~1.6k | Aún caliente; no crecer |
| image-ipc.ts | ~1.2k | E1: resolve extraído |
| forge-runtime.ts | ~1.4k | Candidato E1 |

IPC modular: src/main/ipc/ (forge, catalog, web, plugins, ...).

## Carril E — Ingeniería

| ID | Entrega | Criterio de hecho |
|----|---------|-------------------|
| **E0** | Higiene de repo | version/revision alineados; docs ENGINEERING+ROADMAP;  release:check documentado |
| **E1** | Presupuesto de monolitos | HECHO: forge-api-resolve.ts + image-ipc tryA1111 usa resolveForgeApiForGeneration |
| **E2** | Contratos automatizados | HECHO rev.d: verify-step1 + smoke-step3 cubren R2, forge-api-resolve, ensureForgeReady, image-size/subject-prompt |
| **E3** | Checklist release 0.10.x | HECHO rev.e: RELEASE-0.10.md + limitaciones en CHANGELOG |
| **E4** | Plugin identity-match | Solo cuando E0-E2 no esten en rojo; pre-helper + post-score bajo plugins/|

## Carril producto (después o en paralelo fino)

- Identidad Balanced + refs (no reabrir FaceID a ciegas)
- Forge mensaje de error real (ensureForgeReady) — validar en máquina usuario
- R2 — hecho rev.b; validar con Ollama cargado

## Comandos de calidad

- npm run verify:step1
- npm run smoke:step3
- npm run release:check
- npm test

## Definición de avance

Un bloque está **hecho** solo si:
1. Código en repo
2. Criterio de hecho comprobado (script o prueba manual listada)
3. CHANGELOG / revisión actualizada


### E-SMOKE+
Static contracts in scripts/smoke-step3.mjs and verify-step1.mjs for initiative, Forge humanize, identity-match.
