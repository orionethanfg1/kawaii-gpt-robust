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

