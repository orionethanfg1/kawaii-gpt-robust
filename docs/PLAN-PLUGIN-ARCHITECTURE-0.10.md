# Plan rediseñado — plugins primero (hacia 0.10 / 1.0)

**Regla primordial:** avanzar en paralelo bloques de producto **y** arquitectura de plugins, con **prioridad absoluta** a pasos seguros (build OK, sin wipe de datos, chat usable).

**Principio de diseño:** la app es un **host delgado** (Electron + chat + routing + IPC).  
La potencia vive en **plugins** descubribles, versionados y, en lo posible, **escritos fuera del monolito** (Python hoy; Node/WASM/binarios después).

---

## 1. Por qué plugins (no más monolito)

| Problema actual | Con plugins |
|-----------------|-------------|
| `useChat` / `appAgent` / `main` crecen en cada feature | Feature = carpeta plugin + manifiesto |
| Web, FaceID, Forge, scores mezclados en core | Cada uno es un plugin con contrato estable |
| Terceros no pueden extender sin fork | Manifiesto + sandbox IPC |
| Regresiones al tocar “todo” | Fallo de un plugin ≠ tumbar el chat |

Referencia de mercado (misma idea, no copiar código):

- **LM Studio:** tools vía plugins / MCP (`web_search`, `fetch_url`).
- **Ollama:** tools + API web opcional; el modelo *llama* tools, el host *ejecuta*.
- **Open WebUI:** búsqueda/RAG como módulos configurables (SearXNG, etc.).

---

## 2. Arquitectura objetivo

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (chat UI)                                      │
│  - pide capabilities al host                             │
│  - muestra tools / fuentes / progreso                    │
└───────────────────────┬─────────────────────────────────┘
                        │ IPC seguro
┌───────────────────────▼─────────────────────────────────┐
│  Host core (delgado)                                     │
│  - routing local/cloud                                   │
│  - registry de plugins (manifiesto)                      │
│  - permisos, timeouts, telemetría                        │
│  - executeTool(name, args) → resultado JSON              │
└───────┬─────────────────────────────┬───────────────────┘
        │                             │
   ┌────▼────┐                  ┌─────▼─────┐
   │ Builtin │                  │ External  │
   │ (TS)    │                  │ Python /  │
   │ chat,   │                  │ script /  │
   │ models  │                  │ MCP later │
   └─────────┘                  └───────────┘
```

### Contrato mínimo de un plugin (`plugin.json`)

```json
{
  "id": "web-search",
  "name": "Web Search",
  "version": "1.0.0",
  "runtime": "python|node|builtin",
  "entry": "main.py",
  "tools": [
    {
      "name": "web_search",
      "description": "Busca en la web y devuelve títulos, snippets y URLs",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "max_results": { "type": "integer", "default": 5 }
        },
        "required": ["query"]
      }
    }
  ],
  "permissions": ["net"],
  "phrases": ["busca en la web", "buscar en internet"]
}
```

### Runtime Python (ya empezado)

Hoy: `tools/*.py` + `python:runToolScript`.  
Meta 0.10: **un directorio `plugins/`** con subcarpetas, cada una con manifiesto + entry, descubiertas al arranque.

### Runtime futuro (1.0, no bloquea 0.10)

- Node scripts aislados  
- MCP stdio (compatible LM Studio / Claude Desktop)  
- Binarios firmados opcionales  

---

## 3. Qué queda *dentro* del core (no plugin)

Solo lo que debe ser estable y siempre presente:

1. Ventana chat + mensajes + meta (incl. `web:N hits`, fuentes)  
2. Router local/cloud + circuit breaker  
3. Settings / character store / backups / recovery  
4. Registry + IPC de plugins  
5. Proveedores Ollama / LM / cloud  
6. Seguridad: allowlist de tools, timeout, sin shell arbitrario por defecto  

Todo lo demás (web, FaceID score, Forge probe, catálogo HF, docx, etc.) → **plugin**.

---

## 4. Roadmap por fases

### Fase P0 — Base plugin (bloquea calidad 0.10, seguro)

| ID | Entrega | Criterio de hecho |
|----|---------|-------------------|
| P0.1 | `plugins/` + carga de manifiestos | Lista en panel Plugins sin hardcode eterno |
| P0.2 | `executePluginTool(id, tool, args)` unificado | Un solo camino IPC |
| P0.3 | Migrar **web_search** a plugin (Python o builtin TS) | Pie `web:N hits` N>0 en red normal |
| P0.4 | Migrar **face_similarity** (ya Python) al contrato | Score en meta imagen |
| P0.5 | Documentar “cómo crear un plugin” (1 página) | Otro dev puede añadir tool sin tocar React |

### Fase 0.10 — Producto (prioridad usuario)

| ID | Entrega | Nota |
|----|---------|------|
| V0.10.1 | Web usable (plugin P0.3) | Aceptación: hits > 0 o error claro |
| V0.10.2 | Identidad autorretrato usable o aviso honesto | FaceID + refs |
| V0.10.3 | Chat local/cloud estable | Sin failover absurdo |
| V0.10.4 | Smoke E2E mínimo | abrir → mensaje → respuesta |
| V0.10.5 | Panel Plugins = registry real | No solo lista estática |

**Definición 0.10:** V0.10.1–4 verdes + build limpio + sin wipe de config.

### Fase P1 — Plugins de potencia (paralelo a 0.10.x)

| Plugin | Lenguaje | Valor |
|--------|----------|-------|
| `web-search` | Python/TS | Cascada SearXNG/DDG/Wiki + opcional Brave key |
| `web-fetch` | Python | Leer URL → markdown (como LM tools) |
| `face-id` / `face-score` | Python | InsightFace opcional |
| `forge-control` | Python | probe / ensure FaceID / checkpoints |
| `model-score` | Python/TS | DB scores locales |
| `docx-read` | Python | Leer .docx en chat |
| `diagnostics` | Python | logs, clear exports |

### Fase 1.0 — Ecosistema

- MCP bridge (plugins de terceros LM/Claude)  
- Firma / permisos granulares  
- Marketplace local (carpeta compartida)  
- InstantID / LoRA personaje como plugin de imagen  

---

## 5. Orden de trabajo recomendado (paralelo, seguro)

```
Semana lógica 1 (ahora)
  ├─ P0.1 Registry mínimo (manifiestos en plugins/)
  ├─ P0.3 Web como plugin + SearXNG URL en settings
  └─ V0.10.2 Identidad (sin tocar web)

Semana lógica 2
  ├─ P0.2 IPC unificado
  ├─ V0.10.3 Router estable
  └─ P0.4 Face score bajo contrato

Semana lógica 3
  ├─ V0.10.4 E2E smoke
  ├─ P0.5 Docs para terceros
  └─ Tag 0.10.0
```

Cada pasada: **1–2 ítems P0/V0.10** que compilen; nada que borre `userData` ni rompa strings IPC.

---

## 6. Relación con el plan anterior (B1–B8)

| Antes | Ahora |
|-------|--------|
| B1 Feedback | Core (sigue; no plugin obligatorio) |
| B2–B3 Identidad / score | Plugin `face-*` + core de refs |
| B4 Routing | Core |
| B5–B8 Imagen avanzada / pack | Plugins imagen + 1.0 |
| Web ad-hoc en orchestrator | **Plugin `web-search`** (dejar de engordar orchestrator) |

---

## 7. Criterios de aceptación para un plugin “de calidad”

1. Manifiesto válido + tools con schema  
2. Timeout y error JSON `{ ok, summary, data? }`  
3. Sin acceso a secrets salvo permiso declarado  
4. Frases de activación opcionales (host catalog)  
5. Aparece en panel Plugins y en “qué puedes hacer”  
6. Test mínimo (unit o “dile al chat: ejecuta X”)

---

## 8. Qué *no* hacer

- Meter lógica pesada nueva en `useChat.ts` / `main/index.ts`  
- Plugins con `shell: true` por defecto  
- Depender solo de DDG Instant Answer  
- Esperar a 1.0 para modularizar: **P0 es parte del camino a 0.10**

---

*Documento vivo. Prioridad: P0.1 + P0.3 + V0.10.1 en las próximas pasadas seguras, en paralelo con identidad y estabilidad del chat.*
