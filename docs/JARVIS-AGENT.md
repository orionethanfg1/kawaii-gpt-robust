# Capa agente (Jarvis) — diseño

Complementa `MISSION.md` y `ROADMAP.md` fase Agente.

## Principio

```
Usuario → Chat (persona) → Harness (tools + límites) → Host (archivos / SO)
                ↑
         Un solo LLM residente (tools + vision + reasoning cuando exista)
```

El modelo **elige**; la app **valida y ejecuta**.

## Archivos

1. **Inventario** (solo lectura): `list_library` cubre user-uploads, chat-attachments, app-context, images, wardrobe, backups.
2. **Descripción / clasificación**: `describe_file` (preview + visión local si es imagen), `classify_file` (heurística tags).
3. **Mutación** (A2, rev.fn): `copy_file` / `move_file` / `rename_file` / `delete_file` (papelera). Solo `userData`. Requiere `dryRun` o `confirm:true` + aprobación UI. Audit en `backups/file-audit.log`.
4. **Borrado**: preferir papelera del SO; nunca `rm -rf` de raíces del sistema.

## Bandeja y agenda

- Ventana cerrable a tray; proceso mínimo despierto para timers de agenda.
- Notificación: payload `{ convId, messageId? }` → `show()` + `setActive(convId)`.

## Comandos de host

| Permitido (v1) | No permitido (v1) |
|----------------|-------------------|
| `showItemInFolder` | Shell arbitrario |
| Abrir URL http(s) | Escritura fuera de allowlist |
| Abrir path de biblioteca | Instalar software silencioso |
| Diff + aplicar texto en archivo opted-in | Keylogging / captura global |

## Relación con Gemma 4 / similares

Apto como orquestador si expone tool_use + (ideal) vision. La app debe:

- Pasar schemas de tools claros
- Devolver observaciones **reales** (anti-alucinación ya en harness)
- No cargar un segundo modelo solo para “agente”
