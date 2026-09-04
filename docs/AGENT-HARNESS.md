# KawaiiGPT — Harness de agente (plan)

## Idea

El **modelo no configura la app por magia**: un *harness* (código de la app) le da:

1. **Estado vivo** (Ollama, Forge, keys, modelos instalados, rol de relación).
2. **Herramientas** con efectos reales (`set_provider_mode`, `start_forge`, `set_local_model`, …).
3. **Bucle** observar → decidir → ejecutar → ver resultado.

Ya existe una base en `src/core/agent` + `appAgent.ts` (protocolo `<<<APP_ACTION>>>`).

## Capas recomendadas

| Capa | Qué hace | Estado |
|------|----------|--------|
| A. Estado en system prompt | Snapshot corto cada turno | Hecho |
| B. Tools de configuración | Cambiar modo, modelo, Forge, diagnóstico | Hecho (v1) |
| C. Router de modelos por tarea | Elegir local pequeño / 14B / cloud según petición | Parcial (smart route) |
| D. Bucle multi-paso | Varias tools en un turno con confirmación | Pendiente |
| E. Selección de modelo por intención | “código”→coder, “rol”→uncensored, “rápido”→3B | Pendiente |
| F. Confirmación UI en cambios sensibles | Keys, borrar datos | Pendiente |

## Política de resumen de contexto

- **Local**: sin resumen por LLM; solo empaquetado heurístico (ventana + memoria de usuario + rol).
- **Cloud**: resumen por modelo cuando el historial es largo (ahorra tokens de API).

## Próximos pasos de implementación

1. Catálogo de *task → model hints* (chat, code, roleplay, image-prompt).
2. Tool `recommend_model` + `set_local_model` en el mismo turno.
3. Tras tool result, un segundo micro-paso del LLM solo si hace falta.
4. No entrenar un modelo propio: mejorar harness + prompts + tools.
