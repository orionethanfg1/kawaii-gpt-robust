# KawaiiGPT — Harness de agente

## Idea

El **modelo no configura la app por magia**: un *harness* (código de la app) le da:

1. **Estado vivo** (Ollama, Forge, keys, modelos instalados, rol de relación).
2. **Herramientas** con efectos reales (`set_provider_mode`, `start_forge`, `set_local_model`, …).
3. **Bucle** observar → decidir → ejecutar → ver resultado.

Ya existe una base en `src/core/agent` + `appAgent.ts` (protocolo `<<<APP_ACTION>>>`).
En 0.8.20 se añaden `AgentRuntime`, `runAgentLoop`, `AgentAuditLog`, `ModelRegistry`, sincronizacion de catalogo, `LocalRuntimeAdapter`, routing por capacidades y `EvolutionStore`.

## Capas recomendadas

| Capa | Qué hace | Estado |
|------|----------|--------|
| A. Estado en system prompt | Snapshot corto cada turno | Hecho |
| B. Tools de configuración | Cambiar modo, modelo, Forge, diagnóstico | Hecho (v1) |
| C. Router de modelos por tarea | Elegir local pequeño / 14B / cloud según petición | Parcial (smart route) |
| D. Bucle multi-paso | Varias tools en un turno con confirmación | Runtime y loop hechos; segundo turno LLM pendiente |
| E. Selección de modelo por intención | “código”→coder, “rol”→uncensored, “rápido”→3B | Pendiente |
| F. Confirmación UI en cambios sensibles | Keys, borrar datos | Aprobación no modal para Ollama/Forge hecha; claves/borrado pendiente |

## Política de resumen de contexto

- **Local**: conserva el historial completo cuando cabe; reduce solo por presupuesto o `CONTEXT_OVERFLOW`.
- **Cloud**: resumen por modelo cuando el historial es largo (ahorra tokens de API).

## Próximos pasos de implementación

1. Catálogo de *task → model hints* (chat, code, roleplay, image-prompt).
2. Tool `recommend_model` + `set_local_model` en el mismo turno.
3. Tras tool result, un segundo micro-paso del LLM solo si hace falta.
4. No entrenar un modelo propio: mejorar harness + prompts + tools.

## Contratos nuevos

- `src/core/agent/runtime.ts`: registro y ejecucion limitada de herramientas. Riesgos `read`, `reversible`, `resource` y `destructive`.
- `src/core/agent/evolution.ts`: propuestas `pending|approved|rejected|applied`; nunca aplica cambios por si misma.
- `src/core/models/registry.ts`: catalogo local, recomendaciones por capacidad y activacion solo de modelos conocidos.
- `src/core/models/catalog-sync.ts`: actualizacion remota validada con fallback a cache y catalogo embebido.
- `src/core/agent/loop.ts`: bucle reusable que devuelve observaciones entre turnos.
- `src/core/agent/audit.ts`: auditoría en memoria con redacción de secretos.
- `src/core/providers/runtime.ts`: contrato para runtimes locales desacoplados.
- `src/core/routing/capability.ts`: routing por capacidad y hardware.

El siguiente trabajo debe conectar `runAgentLoop` al segundo turno real del LLM, mover auditoría y herramientas sensibles al proceso main, implementar descarga/borrado de modelos con checksum y crear el runtime portable llama.cpp.
