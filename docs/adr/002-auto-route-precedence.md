# ADR 002 — Precedencia pin / Auto / intimacy

**Estado:** aceptado  
**Fecha:** 2026-10-15

## Matriz

| Condición | ¿Auto cambia modelo? | Notas |
|-----------|----------------------|--------|
| `autoModelRouting === false` | No | Motivo: desactivado |
| `providerMode === 'cloud'` | No | Solo cloud |
| Sin modelos locales | No | |
| **`localModelPinned` + `localModel`** | **No**, salvo excepción intimacy | Pin de Proveedores |
| Pin + tarea **intimacy** + (`localModelIntimate` o abliterated en catálogo) | **Sí → modelo íntimo** | El pin no bloquea cercanía adulta consensuada |
| Sticky intimacy activo + opt-in + tarea chat | Trata como intimacy | TTL 2 min, por conversación |
| Resto | `pickBestInstalledForTask` | minDelta según tarea |

## Excepción pin + intimacy (R4)

El usuario fijó un modelo (p. ej. qwen3-14b) para estabilidad, pero el opt-in adulto y el mensaje íntimo deben poder usar abliterated.  
Si no hay candidato íntimo, se respeta el pin.

## Sticky (R5)

- Se arma al resolver ruta intimacy.  
- Se limpia al **cambiar de chat** o **apagar opt-in adulto**.  
- No cruza conversaciones (`__kawaiiIntimateStickyConvId`).
