# Plugins de KawaiiGPT Robust

La app es el **agente** entre el usuario y los modelos. Los plugins amplían herramientas reales (host / Python), no sustituyen la voz humana del companion.

## Añadir un plugin

1. Crea `plugins/<id>/plugin.json`
2. Si `runtime` es `python`, pon el script en `tools/` (o `entry` relativo)
3. Si es `builtin`, implementa el tool en el harness (`executeAppTool` / main IPC)
4. Reinicia la app → aparece en **Plugins** y en `list_plugins`

### Manifiesto mínimo

```json
{
  "id": "mi-plugin",
  "name": "Mi plugin",
  "version": "1.0.0",
  "runtime": "builtin",
  "tools": [{ "name": "mi_tool", "description": "Qué hace en una frase" }],
  "phrases": ["ejecuta mi tool"],
  "category": "sistema",
  "summary": "Descripción corta para humanos"
}
```

### Principios

- El usuario habla en natural; el modelo + harness eligen tools.
- Resultados de tools se **humanizan** en el chat (no dumps crudos).
- Ver `docs/PLUGINS.md`, `docs/HUMAN-PRIORITY.md`, `docs/MODEL-AGENCY.md`.

## Plugins incluidos

| id | runtime | uso |
|----|---------|-----|
| web-search | builtin | Búsqueda web |
| face-score | python | Similitud facial |
| identity-match | python | Refs + score identidad |


## API para terceros (validación)

- Schema: `plugins/plugin.schema.json`
- Core: `validatePluginManifest` / `normalizePluginManifest` (`src/core/plugins/validate.ts`)
- IPC: `plugins:validate` → `{ ok, issues, normalized }`
- Manifiestos inválidos **no** se cargan; `enabled: false` los omite
- Campos opcionales: `author`, `homepage`, `kawaiiMinVersion`, `enabled`

### Checklist

1. `id` estable y único  
2. Al menos un `tools[].name`  
3. Si `runtime: python`, define `entry`  
4. Frases naturales en español (el companion las usa, no suenes a robot)  
5. Reinicia la app y comprueba el panel Plugins  
