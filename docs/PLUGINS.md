# Plugins (C1/C2)

## Estructura

```
plugins/
  web-search/plugin.json    # builtin IPC web:search
  face-score/plugin.json    # python tools/face_similarity.py
```

## Manifiesto mínimo

```json
{
  "id": "mi-plugin",
  "name": "Mi plugin",
  "runtime": "builtin",
  "tools": [{ "name": "my_tool", "description": "..." }],
  "phrases": ["ejecuta mi tool"]
}
```

## API

- Main: `plugins:list` → manifiestos en disco
- Renderer: `window.kawaii.pluginsList()`
- Panel Plugins fusiona `CAPABILITY_PLUGINS` + disco

## Añadir tool host

1. `plugin.json` en `plugins/<id>/`
2. Handler en `executeAppTool` (o python:runToolScript)
3. Opcional: entrada en `CAPABILITY_PLUGINS` para frases por defecto offline

## Futuro (P2)
- Ejecutar tool desde panel sin pasar por frase.
- Runtime python aislado por plugin.
- Marketplace opcional (1.0+).


## P2.1 — Ejecutar desde el panel

1. Abre **Plugins** en el chat.
2. En cada capacidad: **▶ tool** ejecuta ese tool vía harness host.
3. **Ejecutar todo** lanza hasta 6 tools del manifiesto.
4.  usa la frase del plugin como  si no hay otra.
5. El resultado se humaniza cuando hay observaciones parseables.

## PLUG (0.10.x → 0.11)

- `list_plugins` tool host + `plugins:catalog` IPC
- Catálogo unificado: `@core/plugins/tool-catalog`
- Panel: badges disco/builtin; copy orientado a modelo-agente
- Autoría: `plugins/README.md`

### Uso en chat

- «qué plugins hay» / «lista plugins» → harness `list_plugins`
- Panel ▶ tool → `kawaii:run-host-tools`


## API terceros (rev.db+)

- Schema: `plugins/plugin.schema.json`
- `validatePluginManifest` + IPC `plugins:validate`
- Campos: author, homepage, kawaiiMinVersion, enabled
