# Auditoría de arquitectura (v0.9.83)

## Fortalezas
- Separación **main / core / renderer** con `core` testeable.
- IPC con namespace (`forge:`, `music:`, `voice:`) y registro `registerXIpc()`.
- Router determinista, circuit-breaker, hechos de host (no inventados por el LLM).

## Monolitos residuales (por tamaño LOC)

| Archivo | ~LOC | Riesgo | Acción |
|---------|------|--------|--------|
| `hooks/useChat.ts` | 2300 | Alto | Extraer host-only / harness / streaming a `chat/pipeline/*` |
| `services/appAgent.ts` | 1750 | Alto | Partir tools, status, host-plan, formatters |
| `SettingsModal.tsx` | 1900 | Medio | Tabs → componentes ya parciales; lazy load |
| `SetupWizard.tsx` | 1900 | Medio | Pasos a archivos por step |
| `main/index.ts` | 1400→↓ | Medio | Sigue: sd, machine, secrets, git, shell |
| `main/music-runtime.ts` | 1500 | Medio | OK como servicio; no mezclar IPC |
| `main/forge-runtime.ts` | 1400 | Medio | Idem |
| `chatOrchestrator.ts` | 1400 | Medio | Providers/routing ya en core; OK |
| `ImageGenPanel.tsx` | 1300 | Medio | Subcomponentes de opciones/batch |
| `preload/index.ts` | 820 | Bajo | Generar tipos desde mapa de canales |

## Principios para próximos avances
1. **IPC = adaptador** (máx ~30 líneas/handler); lógica en `*-runtime` / `core`.
2. **Un dominio = un `register*Ipc`**.
3. **useChat no ejecuta tools** — solo orquesta mensajes; tools en `appAgent` / host pipeline.
4. **Humanize obligatorio** antes de mostrar observaciones al usuario.
5. **No añadir LOC a index.ts** — solo `registerX()`.

## Hecho en 0.9.80–0.9.82
- music, voice, layers, forge, catalog IPC módulos.
- Fix humanize LMS (helpers + fallback anti-JSON).

## 0.9.83
- hostChatPaths + host-formatters
- IPC: git, python, machine, secrets
- Pendiente: sd:* IPC, useChat onDone harness extract, appAgent executeAppTool split
