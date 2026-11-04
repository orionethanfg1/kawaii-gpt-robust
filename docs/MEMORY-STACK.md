# Memory stack (M0-M5)

Modular user/assistant memory for KawaiiGPT Robust.

Propósito de companion, relación y etapa: [COMPANION-EVOLUTION.md](./COMPANION-EVOLUTION.md).

Fiabilidad de memoria del asistente (plan por etapas B0–B6): [COMPANION-MEMORY-RELIABILITY-PLAN.md](./COMPANION-MEMORY-RELIABILITY-PLAN.md).

**B2b (diferido):** ánimo («hoy me siento…») del asistente y del usuario; el del usuario es **sensible** y en UI solo tras «Mostrar».

| Block | Module | Role |
|-------|--------|------|
| M0 | dual-memory.ts, assistant-memory.ts | Dual view + migration |
| M1 | memory-backup-gate.ts | Snapshot before clear; restore vs fresh |
| M2 | memory-onboarding.ts, OnboardingChips | Sparse soft questions + chips |
| M3 | extractAssistantSelfFacts | Assistant individuality from 1st person |
| M4 | relationship-confidence.ts | Stage + nickname propose/accept/reject |
| M5 | MemoryChipBar.tsx | Shared chips UI + smoke contracts |

## Settings fields

- userMemory — user facts/likes
- assistantMemory — character likes/habits
- memoryGatePending — show restore banner
- memoryOnboarding — active, step, dismissed
- relationshipState — stage, turnsTogether, accepted/rejected nicknames

## Rules

1. Propose is not write (nicknames only after accept)
2. Clear user does not clear assistant
3. Snapshot before destructive clear
4. One social initiative window (onboarding or nickname or day nudge)
5. Selective prompts — no full dump every turn

## Smoke

npm run smoke:step3
npm run verify:step1
npm test -- src/core/conversation/


## Tuning (rev.bg)

- Initiative interval scales with relationship stage
- Nickname candidates depend on character personality text

## Agenda y tiempo (plan)

La conciencia temporal (mood con `at`, «hace cuánto») y la **agenda** (`talk` / `reminder`) se especifican en [COMPANION-MEMORY-RELIABILITY-PLAN.md](./COMPANION-MEMORY-RELIABILITY-PLAN.md) §9.
No viven dentro de `assistantMemory.likes`.
