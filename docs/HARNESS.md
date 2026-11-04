# Harness — inteligencia de la app

## Qué es
El **Harness** es la capa de control de KawaiiGPT: conoce el **estado real** (capas, modelos, fallos) y puede **actuar** (Forge, Ollama, routing) sin que el usuario abra Ajustes.

Principio de diseño (fiabilidad):
- **Hechos en el host** (código): inventarios, estado de capas, listas de modelos.
- **LLM**: conversación, personalidad, planes operativos cuando aportan valor.
- Nunca confiar en el modelo para inventar nombres de modelos o “todo OK”.

## Estado actual (v0.9.20)

| Pieza | Estado | Notas |
|-------|--------|--------|
| Protocolo APP_PLAN / APP_ACTION | OK | Strip de markup en UI (`stripHarnessMarkup`) |
| Plan host heurístico | OK | `suggestPlanFromUserGoal` |
| Plan adaptativo | OK | `refinePlanWithLiveStatus` (no `start_forge` si ya corre) |
| Memoria de fallos | OK | Cooldown; no reintenta a ciegas |
| Memoria de éxitos / preferencias | OK | Modelo local preferido + tools que funcionaron |
| Auto-route por tarea | OK | code/vision/chat → mejor tag instalado |
| Estado + lista de modelos | OK | **100% host** (`forceStatusAndModelsReport`) |
| Segundo turno observaciones | OK | Anti-alucinación; host reescribe listas malas |
| Iniciativa | Guardas | No interrumpe diagnósticos ni inventa inventarios |
| Log de plan (UI avanzada) | OK | Colapsable bajo el mensaje; oculto en Smart |

## Inventario (estado / modelos)
Si el usuario pide estado o lista de modelos, `sendMessage` **intercepta** y llama:

1. `get_app_status`
2. `list_installed_models`
3. `check_local_runtime` / `health_forge` (best-effort)
4. `formatHostStatusAndModelsReply` → viñetas por capa + modelos con rol (chat/visión/código)

No hay segundo LLM en ese camino.

## Planificador multi-paso
1. Modelo emite `<<<APP_PLAN>>>` o varias `<<<APP_ACTION>>>`.
2. Si no emite tags pero el goal es operativo → plan host.
3. `refinePlanWithLiveStatus` reescribe pasos según Forge/Ollama/música vivos.
4. `executePlan` + aprobación de acciones costosas + failure memory.
5. Observaciones → segundo turno natural (o host si es inventario).

## Log de plan (UI avanzada)
Si `uiComplexity === 'advanced'`, bajo mensajes con `meta.harnessLog` / `meta.planSummary` aparece un panel **⚙️ Harness** colapsado por defecto con el plan y las acciones ejecutadas. En modo Smart no se muestra.

## Próximos pasos
- STT / micrófono como tool de entrada
- Más tools de capas (pausa ACE, ControlNet) con el mismo patrón host-owned facts
