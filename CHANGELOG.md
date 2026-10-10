## 0.10.10 rev.bb — M0+M1 dual memory + backup gate

- assistant-memory / dual-memory / memory-backup-gate modules
- Snapshot user memory before clear; restore vs start fresh in settings panel
- Settings: assistantMemory, memoryGatePending, relationshipState shell
- Orchestrator injects assistant memory prompt when present

## 0.10.10 rev.x

### E-ORCH-2
- orchestratorRun.ts (runOn + cloud queue)
- orchestratorTypes.ts

## 0.10.10 rev.w

### chatOrchestrator modular
- orchestratorProviders.ts
- orchestratorWebSearch.ts

## 0.10.10 rev.v

### Monoliths
- chatMusicFlow extract from useChat

## 0.10.10 rev.u

### Checkpoints message + capability replies
- modelsCount fallback disco/sync (sd-models 500)
- chatCapabilityReplies extract

## 0.10.10 rev.t

### Fix Forge start from chat
- Preflight GPU no bloquea arranque
- Probe API antes de preflight
- ensureForgeReady: más puertos + strip GPU scare

## 0.10.10 rev.s

### E-USECHAT-2 + E-IMG-GEN
- chatMediaPlan.ts
- image-ipc-generate.ts + shell image-ipc

## 0.10.10 rev.r

### useChat modular (parcial)
- chatNotify.ts, chatLocalShortcuts.ts
- useChat ~1326 LOC (antes ~1583)

## 0.10.10 rev.q

### image-ipc modular
- image-pollinations.ts
- image-ipc-meta.ts (health/models/folders)
- image-ipc.ts ~generate only + secureStore via globalThis

## 0.10.10 rev.p

### E-FORGE-RT
- forge-launch.ts: root, python, webui-user, bat launcher
- forge-runtime ~935 LOC (ciclo vida)
- fix orphan syntax post-ports extract

## 0.10.10 rev.o

### E-FORGE-RT (parcial)
- Nuevo src/main/forge-ports.ts (puertos + probe/scan health)
- forge-runtime reexporta; ~200 LOC menos de proceso puro

## 0.10.10 rev.n

### E-FAILMEM
- start_forge nunca bloqueado por cooldown
- éxito Forge limpia fallos de la familia health/start/probe
- mensajes sin URL :7890; humanize oculta omit health si start OK

## 0.10.10 rev.m

### Fix health Forge puerto muerto
- refreshForgeHealth: limpia baseUrl muerto (:7890); mensaje genérico 7860-7890
- strip fetch failed @ URL en humanize y health_forge
- Versiones: package + shared + renderer alineados 0.10.10 rev.m

## 0.10.10 rev.l

### E-TC
- scripts/typecheck-gate.mjs (tsc web+node si typescript instalado)
- engines node >=20
- npm run typecheck:gate

## 0.10.10 rev.k

### E-SMOKE+
- smoke-step3: contratos E-INIT, E-HMSG2, E4, planner, health_forge
- verify-step1: mismos contratos

## 0.10.10 rev.j

### E4 identity-match
- plugins/identity-match + tools/identity_match.py (analyze + score)
- host tools analyze_identity_refs, score_identity_match
- registry + catalog

## 0.10.10 rev.i

### E-HMSG2
- health_forge: ok solo si running; sin JSON; stopped=fail
- strip GPU NVIDIA scare
- LM Studio no se sugiere en flujos Forge

## 0.10.10 rev.h

### E-INIT fix fuerte
- Timer por tiempo absoluto desde ultimo mensaje user (no reset por settings genéricos)
- Streaming: reintento 4s, no reinicio del intervalo completo
- Modo fijo: sin horario silencioso; idle ~40% del intervalo
- Plantilla inmediata si modelo es LM Studio (id con /); Ollama LLM timeout 12s
- Harness no bloquea iniciativa; console.debug [initiative]

## 0.10.10 rev.g

### E-HMSG + E-INTENT
- planner: revisa Ollama/LM/Forge -> get_app_status
- start_forge human summary (R2 note not error)
- humanize start_forge/health_forge
- catalog phrases

## 0.10.10 rev.f

### E-INIT iniciativa
- shouldSendInitiative: waitMinOverride + minUserIdleMs (modo fijo 1 min ya no choca con gate de 3 min)
- useConversationInitiative: no reinicia el timer en cada pointer/key (solo mensajes user + settings)
- maxPerDay 8; reanuda al salir de actividad (mini-juego)
- Test: fixed mode short idle

## 0.10.10 rev.e

### E3 checklist release honesto
- docs/RELEASE-0.10.md reescrito para 0.10.10 (auto + manual + limitaciones)
- Criterio de uso diario separado de “perfecto”

### Limitaciones 0.10.x (declaradas)
- Plugin identity-match (E4) pendiente
- Typecheck global puede fallar fuera de módulos recientes
- R2 unload prioritario en Ollama; LM Studio best-effort
- Hi-Res 2K puede saturar VRAM baja
- FaceID sin score InsightFace no garantiza similitud numérica

## 0.10.10 rev.d

### E2 contratos automatizados
- verify-step1: R2 unload, forge-runtime skipUnload, ensureForgeReady, preload models:unloadLocal, forge-api-resolve, image-ipc wire, image-size, subject-prompt
- smoke-step3: archivos + recover_settings/web_search en hostTools + R2/resolve
- npm run release:check = verify + smoke (ambos OK)

## 0.10.10 rev.c

### E1 ingeniería
- Nuevo : resolveForgeApiForGeneration (status → scan → start → probe)
-  tryA1111 delega en ese módulo (~40 LOC menos de lógica duplicada)

### Aprendizaje face corrections r2
- Módulos pequeños con contrato claro (mismo estilo que image-size / subject-prompt)

## 0.10.10 rev.b — engineering docs

### Ingeniería
- docs/ENGINEERING.md: carril E0–E4, inventario LOC, reglas de módulo
- ROADMAP reorientado: ingeniería antes que features nuevas
- package.json kawaiiRevision alineado a b

