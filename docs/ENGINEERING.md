<!-- product law -->
**Product law:** [HUMAN-PRIORITY.md](./HUMAN-PRIORITY.md) — technical work must not robotize the chat. [MODEL-AGENCY.md](./MODEL-AGENCY.md) — prefer model reasoning/vision/tools over app-only shortcuts.

Propósito de producto (companion, relación, autodiagnóstico): [COMPANION-EVOLUTION.md](./COMPANION-EVOLUTION.md).

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
| useChat.ts | ~0.5k | P1: fases + runChatOrchestrationTurn + postReplyFinalize |
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


### E-TC
Run `npm run typecheck` (full) or `npm run typecheck:gate` (skip if no typescript). Fix errors in touched modules first; residual project-wide debt is tracked but not a 0.10.10 blocker if smoke+verify pass.


## Post-identidad (rev.az+)

**Identidad baseline congelada** (FaceID 0.88, I2×3, tags, 2 refs). No reabrir microajustes de prompt salvo bugs de build/cancelación/score.

### Siguiente carril producto

| ID | Bloque | Criterio |
|----|--------|----------|
| **MEM-Evo** | Memoria evolutiva en cada turno | extract+merge en envío; panel refleja likes/hechos |
| **INI-H** | Iniciativa sin etiqueta «plantilla» | meta limpia; LLM cuando runtime lo permita |
| **PLUG-1** | Contrato plugins estable | plugin.json + host tools documentados |



## M0 + M1 — Dual memory + backup gate (rev.bb)

| Módulo | Rol |
|--------|-----|
| `assistant-memory.ts` | Gustos/hábitos del personaje |
| `dual-memory.ts` | migrateToDual, isUserMemorySparse |
| `memory-backup-gate.ts` | Snapshot al borrar; offer restore vs fresh |

Settings: `assistantMemory`, `memoryGatePending`, `relationshipState` (shell).
Panel Memoria: banner restaurar / empezar de nuevo tras clear.


## M2 — Onboarding (rev.bc)

- `memory-onboarding.ts`: steps name → nickname → like → dislike → done
- Chips in chat (`OnboardingChips`); free text still merges via extract
- System prompt soft when sparse; blocked while `memoryGatePending`
- "Empezar de nuevo" tras clear activa onboarding


## M3 — Assistant memory extract (rev.bd)

- `extractAssistantSelfFacts` / `ingestAssistantReply` on finished assistant turns
- Panel Memoria: tabs Usuario | Asistente
- Prompt already injects `buildAssistantMemoryPrompt` when data exists


## M4 — Relationship confidence (rev.be)

- `relationship-confidence.ts`: stage, propose/accept/reject nicknames, cooldown 6h
- Initiative may propose «¿te llamo X?» when stage ≥ acquaintance and not in onboarding
- Chips for pending nickname; rejects go to blacklist
- System prompt adjusts formality by stage


## M5 — MemoryChipBar + smoke (rev.bf)

- Shared  used by onboarding / nickname chips
-  contracts
-  /  include M0–M5 needles


## Afinar (rev.bg) — initiative + nicknames

- `initiativeMinutesForTone`: bases retocadas + factor por `relationshipStage` (mín. 6 min)
- Nickname pool por personalidad (warm / playful / calm / celtic / kawaii)
- Propuesta de apodo: min turns y cooldown por stage; rotación de candidato por turnos
